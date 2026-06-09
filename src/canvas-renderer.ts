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

interface PureImageModule {
  make(width: number, height: number): PureImageBitmap;
}

/**
 * Renders a single PDF page to an RGBA pixel buffer using pureimage as the Canvas backend.
 */
export async function renderPageToPixels(
  document: PDFDocumentProxy,
  pageNumber: number,
  scale: number
): Promise<PixelBuffer> {
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

  // Render PDF page onto the canvas
  const renderTask = page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
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

