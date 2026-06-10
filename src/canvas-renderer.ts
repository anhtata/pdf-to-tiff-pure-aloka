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
  //
  // setLineDash / getLineDash — used for dashed strokes; barcodes use solid
  //   fills (rects) so a no-op is safe. Without this stub pdfjs throws when
  //   it tries to save/restore the dash state around barcode stripes.
  if (typeof ctxRaw['setLineDash'] !== 'function') {
    ctxRaw['setLineDash'] = () => { /* no-op: pureimage renders all strokes solid */ };
    ctxRaw['getLineDash'] = () => [];
  }
  // createImageData — pdfjs uses this to blit decoded image XObjects (JPEG2000,
  //   JBIG2, etc.) that can appear inside barcode capture areas.
  if (typeof ctxRaw['createImageData'] !== 'function') {
    ctxRaw['createImageData'] = (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    });
  }
  // createPattern — used for tiling patterns; a null return causes pdfjs to
  //   skip the pattern fill gracefully rather than throwing.
  if (typeof ctxRaw['createPattern'] !== 'function') {
    ctxRaw['createPattern'] = () => null;
  }

  // Render PDF page onto the canvas.
  // AnnotationMode.ENABLE_FORMS (2) ensures AcroForm barcode fields and other
  // form annotations are rendered into the canvas (not just page content stream).
  const renderTask = page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
    annotationMode: 2, // AnnotationMode.ENABLE_FORMS
  });

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

