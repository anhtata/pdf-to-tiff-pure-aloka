import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PdfMetadata, PageMetadata } from './types';

// Install global polyfills BEFORE requiring pdfjs-dist.
// pdfjs checks for DOMMatrix/Path2D at require-time; if they're already defined,
// it skips its own (canvas-dependent) polyfill and emits no warning.
installGlobalPolyfills();

// Use legacy build for Node.js compatibility (no worker thread required)
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as typeof import('pdfjs-dist');

// In Node.js there is no worker; disable the worker by setting workerSrc to empty.
// GlobalWorkerOptions is a getter-only property on the module object, so we must
// mutate the existing object rather than replace it.
pdfjs.GlobalWorkerOptions.workerSrc = '';

/** Installs minimal DOMMatrix and Path2D polyfills needed by pdfjs-dist in Node.js. */
function installGlobalPolyfills(): void {
  if (typeof globalThis.DOMMatrix === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as Record<string, any>).DOMMatrix = class DOMMatrix {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      is2D = true;
      isIdentity = true;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length === 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
          this.isIdentity = (this.a === 1 && this.b === 0 && this.c === 0 &&
                              this.d === 1 && this.e === 0 && this.f === 0);
        }
      }
    };
  }

  if (typeof globalThis.Path2D === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as Record<string, any>).Path2D = class Path2D {
      readonly _ops: Array<[string, number[]]> = [];
      moveTo(x: number, y: number): void              { this._ops.push(['moveTo', [x, y]]); }
      lineTo(x: number, y: number): void              { this._ops.push(['lineTo', [x, y]]); }
      closePath(): void                               { this._ops.push(['closePath', []]); }
      arc(x: number, y: number, r: number, sa: number, ea: number, ccw = false): void {
        this._ops.push(['arc', [x, y, r, sa, ea, ccw ? 1 : 0]]);
      }
      bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        this._ops.push(['bezierCurveTo', [cp1x, cp1y, cp2x, cp2y, x, y]]);
      }
      rect(x: number, y: number, w: number, h: number): void {
        this._ops.push(['rect', [x, y, w, h]]);
      }
    };
  }
}

export interface LoadedPdf {
  document: PDFDocumentProxy;
  metadata: PdfMetadata;
}

/**
 * Custom StandardFontDataFactory that reads font files via `fs` rather than
 * `fetch()`. Node.js `fetch()` (and the built-in `NodeStandardFontDataFactory`
 * which uses `fs.readFile`) both fail on `file://` URL *strings*; this factory
 * converts the URL to an actual file path with `fileURLToPath` first.
 */
class FsStandardFontDataFactory {
  private readonly baseUrl: string | null;
  constructor({ baseUrl = null }: { baseUrl?: string | null }) {
    this.baseUrl = baseUrl;
  }
  async fetch({ filename }: { filename: string }): Promise<Uint8Array> {
    if (!this.baseUrl) {
      throw new Error('The standard font "baseUrl" parameter must be specified.');
    }
    const url = `${this.baseUrl}${filename}`;
    const filePath = url.startsWith('file:') ? fileURLToPath(url) : url;
    const buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buffer);
  }
}

/**
 * Loads a PDF file from disk and returns a PDFDocumentProxy plus metadata.
 * Throws a descriptive Error if the file cannot be read or parsed.
 */
export async function loadPdf(pdfPath: string, scale: number): Promise<LoadedPdf> {
  const absPath = path.resolve(pdfPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`PDF file not found: ${absPath}`);
  }

  let data: Uint8Array;
  try {
    data = new Uint8Array(fs.readFileSync(absPath));
  } catch (err) {
    throw new Error(`Failed to read PDF file "${absPath}": ${(err as Error).message}`);
  }

  if (data.length === 0) {
    throw new Error(`PDF file is empty: ${absPath}`);
  }

  let document: PDFDocumentProxy;
  try {
    const standardFontDataUrl = pathToFileURL(
      path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep
    ).href;
    const loadingTask = pdfjs.getDocument({
      data,
      disableFontFace: true,
      standardFontDataUrl,
      StandardFontDataFactory: FsStandardFontDataFactory,
    });
    document = await loadingTask.promise;
  } catch (err) {
    throw new Error(`Failed to parse PDF "${absPath}": ${(err as Error).message}`);
  }

  const numPages = document.numPages;
  if (numPages === 0) {
    throw new Error(`PDF has no pages: ${absPath}`);
  }

  // Collect per-page dimensions
  const pages: PageMetadata[] = [];
  for (let i = 1; i <= numPages; i++) {
    let page: PDFPageProxy;
    try {
      page = await document.getPage(i);
    } catch (err) {
      throw new Error(`Failed to read page ${i} of "${absPath}": ${(err as Error).message}`);
    }
    const viewport = page.getViewport({ scale });
    pages.push({
      pageNumber: i,
      widthPx: Math.ceil(viewport.width),
      heightPx: Math.ceil(viewport.height),
    });
    page.cleanup();
  }

  return {
    document,
    metadata: { numPages, pages },
  };
}
