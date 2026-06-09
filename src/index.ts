/**
 * pdf-to-tiff-pure-aloka
 * Pure Node.js PDF to TIFF converter — no native bindings, no system dependencies.
 *
 * @example
 * ```ts
 * import { convertPdfToTiff } from 'pdf-to-tiff-pure-aloka';
 *
 * const result = await convertPdfToTiff('document.pdf', './output', {
 *   scale: 2.0,
 *   compression: 'lzw',
 *   filePrefix: 'doc',
 * });
 * console.log(result.outputFiles); // ['./output/doc-1.tiff', './output/doc-2.tiff']
 * ```
 */

export { convertPdfToTiff } from './converter';
export type {
  ConversionOptions,
  ConversionResult,
  PdfMetadata,
  PageMetadata,
  PixelBuffer,
  TiffCompression,
} from './types';
