/**
 * All TypeScript types and interfaces for pdf-to-tiff-pure-aloka.
 */

/**
 * Compression mode for the output TIFF file.
 * - `none`     : Uncompressed raw pixel data (largest file, fastest encoding)
 * - `packbits` : PackBits RLE compression (moderate size/speed balance)
 * - `lzw`      : LZW compression (smallest file, slower encoding)
 */
export type TiffCompression = 'none' | 'packbits' | 'lzw';

/**
 * Options passed to convertPdfToTiff().
 */
export interface ConversionOptions {
  /**
   * Render scale multiplier applied to each PDF page's natural viewport.
   * Higher values = higher resolution output but slower rendering and larger files.
   * Default: 1.5
   */
  scale?: number;

  /**
   * TIFF compression algorithm to apply to each output file.
   * Default: 'lzw'
   */
  compression?: TiffCompression;

  /**
   * Optional prefix for output filenames.
   * - Single-page PDF: output is named `${prefix}.tiff` (no page-number suffix).
   * - Multi-page PDF: output files are named `${prefix}-${pageNumber}.tiff`.
   * Default: 'page'
   */
  filePrefix?: string;
}

/**
 * Per-page metadata extracted from the PDF document.
 */
export interface PageMetadata {
  /** 1-based page number */
  pageNumber: number;
  /** Page width in pixels after scale is applied */
  widthPx: number;
  /** Page height in pixels after scale is applied */
  heightPx: number;
}

/**
 * Metadata for the entire PDF document.
 */
export interface PdfMetadata {
  /** Total number of pages in the PDF */
  numPages: number;
  /** Per-page dimension info */
  pages: PageMetadata[];
}

/**
 * Result returned by convertPdfToTiff() after a successful or failed conversion.
 */
export interface ConversionResult {
  /** true if all pages converted successfully */
  success: boolean;
  /** Total number of pages in the source PDF */
  totalPages: number;
  /** Number of pages that were successfully converted */
  convertedPages: number;
  /** Absolute paths to each output TIFF file, in page order */
  outputFiles: string[];
  /** Error message if success is false */
  error?: string;
}

/**
 * Raw pixel buffer extracted from a rendered canvas page.
 * Contains RGBA data: 4 bytes per pixel, row-major order.
 */
export interface PixelBuffer {
  /** RGBA pixel data */
  data: Uint8ClampedArray;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
}
