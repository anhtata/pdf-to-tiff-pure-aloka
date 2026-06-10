import * as path from 'path';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PixelBuffer } from './types';

// pureimage is a pure-JS HTML5 Canvas implementation — no ESM export available
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PImage = require('pureimage') as PureImageModule; // no-var-requires: pureimage has no ESM export

/** Minimal typings for pureimage that we use at runtime */
interface PureImageBitmap {
  width: number;
  height: number;
  data: Buffer; // raw RGBA bytes stored as a Node.js Buffer
  getContext(type: '2d'): PureImage2DContext;
}

interface PureImage2DContext {
  [key: string]: unknown;
}

interface PureImageFont {
  load(): Promise<void>;
}

interface PureImageModule {
  make(width: number, height: number): PureImageBitmap;
  registerFont(filePath: string, family: string): PureImageFont;
}

// ---------------------------------------------------------------------------
// Font registration — must run once before any render.
// LiberationSans (Helvetica metric-compatible, Apache 2.0) ships inside
// pdfjs-dist so no extra dependency is needed. We register it under every
// common alias pdfjs may request so pureimage does not silently skip text.
// ---------------------------------------------------------------------------
let fontsRegistered = false;

async function ensureFontsRegistered(): Promise<void> {
  if (fontsRegistered) return;
  fontsRegistered = true;

  const stdFontsDir = path.join(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts'
  );

  // Map every common PDF sans-serif font name to the LiberationSans TTFs
  // that ship inside pdfjs-dist (Helvetica metric-compatible, Apache 2.0).
  // pdfjs-dist standard_fonts only contains LiberationSans variants, so all
  // sans-serif aliases point to the appropriate weight/style file.
  const variants: Array<{ file: string; family: string }> = [
    // Helvetica
    { file: 'LiberationSans-Regular.ttf',    family: 'Helvetica'             },
    { file: 'LiberationSans-Bold.ttf',        family: 'Helvetica-Bold'        },
    { file: 'LiberationSans-Italic.ttf',      family: 'Helvetica-Oblique'     },
    { file: 'LiberationSans-BoldItalic.ttf',  family: 'Helvetica-BoldOblique' },
    // Arial (common substitute name used in some PDFs)
    { file: 'LiberationSans-Regular.ttf',    family: 'Arial'                 },
    { file: 'LiberationSans-Bold.ttf',        family: 'Arial-Bold'            },
    { file: 'LiberationSans-Italic.ttf',      family: 'Arial-Italic'          },
    { file: 'LiberationSans-BoldItalic.ttf',  family: 'Arial-BoldItalic'      },
    // LiberationSans (direct name — pureimage may request it explicitly)
    { file: 'LiberationSans-Regular.ttf',    family: 'LiberationSans'        },
    { file: 'LiberationSans-Bold.ttf',        family: 'LiberationSans-Bold'   },
    { file: 'LiberationSans-Italic.ttf',      family: 'LiberationSans-Italic' },
    { file: 'LiberationSans-BoldItalic.ttf',  family: 'LiberationSans-BoldItalic' },
    // sans-serif generic (browser/pureimage fallback family name)
    { file: 'LiberationSans-Regular.ttf',    family: 'sans-serif'            },
  ];

  for (const { file, family } of variants) {
    try {
      const fnt = PImage.registerFont(path.join(stdFontsDir, file), family);
      await fnt.load();
    } catch {
      // Non-fatal: if a font variant fails to load, pureimage falls back to its
      // built-in Vera font. Text will still render, just with a different face.
    }
  }
}

/**
 * Patches a pureimage 2D context with Canvas API methods that pdfjs-dist calls
 * but pureimage does not implement. Applied to every canvas context — both the
 * main page canvas and auxiliary canvases created by the CanvasFactory — so
 * that pdfjs never throws on missing methods during image XObject decoding.
 */
function patchContext(ctx: Record<string, unknown>): void {
  // setLineDash / getLineDash — used for dashed strokes; no-op is safe.
  if (typeof ctx['setLineDash'] !== 'function') {
    ctx['setLineDash'] = (): void => { /* no-op: pureimage renders all strokes solid */ };
    ctx['getLineDash'] = (): number[] => [];
  }
  // createImageData — pdfjs uses this to blit decoded image XObjects (JPEG2000, JBIG2, etc.).
  // Must return a real pureimage Bitmap so that pureimage's putImageData (which calls
  // src.calculateIndex internally via _pasteSubBitmap) does not throw.
  if (typeof ctx['createImageData'] !== 'function') {
    ctx['createImageData'] = (w: number, h: number): PureImageBitmap => PImage.make(w || 1, h || 1);
  }
  // createPattern — used for tiling patterns; null causes pdfjs to skip gracefully.
  if (typeof ctx['createPattern'] !== 'function') {
    ctx['createPattern'] = (): null => null;
  }
  // getTransform — pureimage returns a plain object from asDomMatrix() that lacks DOMMatrix
  // mutation methods. pdfjs calls .invertSelf() on the result to compute inverse transforms
  // for coordinate mapping. Wrap getTransform so every returned object has invertSelf().
  if (typeof ctx['getTransform'] === 'function') {
    const origGetTransform = ctx['getTransform'] as () => Record<string, unknown>;
    ctx['getTransform'] = function (): Record<string, unknown> {
      const m = origGetTransform.call(ctx);
      if (typeof m['invertSelf'] !== 'function') {
        m['invertSelf'] = function (): Record<string, unknown> {
          // Standard 2D affine inversion: matrix [a b c d e f]
          const a = (m['a'] as number) ?? 1;
          const b = (m['b'] as number) ?? 0;
          const c = (m['c'] as number) ?? 0;
          const d = (m['d'] as number) ?? 1;
          const e = (m['e'] as number) ?? 0;
          const f = (m['f'] as number) ?? 0;
          const det = a * d - b * c;
          if (det !== 0) {
            m['a'] =  d / det;
            m['b'] = -b / det;
            m['c'] = -c / det;
            m['d'] =  a / det;
            m['e'] = (c * f - d * e) / det;
            m['f'] = (b * e - a * f) / det;
          }
          return m;
        };
      }
      return m;
    };
  }
}

/**
 * A pureimage-backed CanvasFactory for pdfjs-dist.
 * Pass this to `pdfjs.getDocument({ canvasFactory })` so that pdfjs never
 * falls through to its default which tries to `require('canvas')`.
 */
export const pureImageCanvasFactory = {
  create(w: number, h: number): { canvas: PureImageBitmap; context: unknown } {
    const c = PImage.make(w || 1, h || 1);
    const ctx = c.getContext('2d') as Record<string, unknown>;
    patchContext(ctx);
    return { canvas: c, context: ctx };
  },
  reset(canvasAndContext: { canvas: PureImageBitmap; context: unknown }, w: number, h: number): void {
    canvasAndContext.canvas = PImage.make(w || 1, h || 1);
    const ctx = canvasAndContext.canvas.getContext('2d') as Record<string, unknown>;
    patchContext(ctx);
    canvasAndContext.context = ctx;
  },
  destroy(canvasAndContext: { canvas: PureImageBitmap; context: unknown }): void{
    canvasAndContext.canvas = PImage.make(1, 1);
    canvasAndContext.context = null;
  },
};

/**
 * Renders a single PDF page to an RGBA pixel buffer using pureimage as the Canvas backend.
 */
export async function renderPageToPixels(
  document: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<PixelBuffer> {
  // Ensure Helvetica / Arial / LiberationSans fonts are registered with pureimage
  // so pdfjs text operators (Tf/Tj/TJ) render correctly instead of falling back
  // to pureimage's built-in bitmap font.
  await ensureFontsRegistered();

  let page: PDFPageProxy;
  try {
    page = await document.getPage(pageNumber);
  } catch (err) {
    throw new Error(`Cannot get page ${pageNumber}: ${(err as Error).message}`);
  }

  const viewport = page.getViewport({ scale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  // Create a pure-JS canvas of the required size
  const canvas: PureImageBitmap = PImage.make(width, height);
  const context = canvas.getContext('2d');

  // Fill background with white before rendering (avoids transparent/black pages).
  // IMPORTANT: call beginPath() FIRST so that pureimage's internal path array
  // (this.path) is initialised as [] rather than undefined. pureimage.save()
  // saves whatever this.path is at that moment; if it is undefined, restore()
  // will put it back to undefined and subsequent pdfjs moveTo/rect calls crash
  // on "Cannot read properties of undefined (reading 'push')".
  const ctxRaw = context as Record<string, unknown>;
  if (typeof ctxRaw['beginPath'] === 'function') {
    (ctxRaw['beginPath'] as () => void)();
  }
  if (typeof ctxRaw['fillRect'] === 'function') {
    ctxRaw['fillStyle'] = '#ffffff';
    (ctxRaw['fillRect'] as (x: number, y: number, w: number, h: number) => void)(0, 0, width, height);
  }

  // Patch canvas methods that pureimage does not implement but pdfjs calls.
  // Missing methods cause silent render failures or thrown errors mid-page.
  patchContext(ctxRaw);

  // Custom CanvasFactory backed by pureimage so pdfjs never tries to require()
  // the native 'canvas' npm package when it needs to create auxiliary canvases
  // (e.g. for image XObjects, patterns, or annotation layers).
  // patchContext is applied to every auxiliary context so that pdfjs image
  // XObject decoding (createImageData etc.) works on these canvases too.
  const pureImageCanvasFactory = {
    create(w: number, h: number): { canvas: PureImageBitmap; context: unknown } {
      const c = PImage.make(w || 1, h || 1);
      const ctx = c.getContext('2d') as Record<string, unknown>;
      patchContext(ctx);
      return { canvas: c, context: ctx };
    },
    reset(canvasAndContext: { canvas: PureImageBitmap; context: unknown }, w: number, h: number): void {
      canvasAndContext.canvas = PImage.make(w || 1, h || 1);
      const ctx = canvasAndContext.canvas.getContext('2d') as Record<string, unknown>;
      patchContext(ctx);
      canvasAndContext.context = ctx;
    },
    destroy(canvasAndContext: { canvas: PureImageBitmap; context: unknown }): void {
      canvasAndContext.canvas = PImage.make(1, 1);
      canvasAndContext.context = null;
    },
  };

  // Render PDF page onto the canvas.
  // AnnotationMode.ENABLE_FORMS (2) ensures AcroForm barcode fields and other
  // form annotations are rendered into the canvas (not just page content stream).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderParams: any = {
    canvasContext: context,
    viewport,
    annotationMode: 2, // AnnotationMode.ENABLE_FORMS
    canvasFactory: pureImageCanvasFactory,
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const renderTask = page.render(renderParams);

  try {
    await renderTask.promise;
  } catch (err) {
    throw new Error(`Render failed for page ${pageNumber}: ${(err as Error).message}`);
  }

  page.cleanup();

  // Extract RGBA data from pureimage's internal Buffer.
  // pureimage stores pixel data as a plain Node.js Buffer: 4 bytes per pixel (RGBA).
  const rawBuffer: Buffer = canvas.data;
  const rgbaData = new Uint8ClampedArray(
    rawBuffer.buffer,
    rawBuffer.byteOffset,
    rawBuffer.byteLength
  );

  return { data: rgbaData, width, height };
}

