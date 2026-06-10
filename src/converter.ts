import * as fs from 'fs';
import * as path from 'path';
import { loadPdf } from './pdf-loader';
import { renderPageToPixels } from './canvas-renderer';
import { encodeToTiff } from './tiff-encoder';
import type { ConversionOptions, ConversionResult } from './types';

const DEFAULT_SCALE = 3.0; // ~216 DPI — sharper default for document scanning
const DEFAULT_COMPRESSION = 'lzw';
const DEFAULT_PREFIX = 'page';

/**
 * Converts every page of a PDF file into individual TIFF files.
 *
 * @param pdfPath   - Absolute or relative path to the source PDF file
 * @param outputDir - Directory where TIFF files will be written (created if missing)
 * @param options   - Optional settings: scale, compression, filePrefix
 * @returns ConversionResult with output file paths and success status
 *
 * @throws Error if the PDF cannot be loaded (invalid path, corrupt file, empty PDF).
 *         I/O errors during TIFF writing are caught and returned in the result.
 *
 * @example
 * ```ts
 * import { convertPdfToTiff } from 'pdf-to-tiff-pure-aloka';
 *
 * const result = await convertPdfToTiff('input.pdf', './output');
 * console.log(result.outputFiles); // ['./output/page-1.tiff', './output/page-2.tiff']
 * ```
 */
export async function convertPdfToTiff(
  pdfPath: string,
  outputDir: string,
  options: ConversionOptions = {}
): Promise<ConversionResult> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const compression = options.compression ?? DEFAULT_COMPRESSION;
  const prefix = options.filePrefix ?? DEFAULT_PREFIX;

  // Validate scale range
  if (scale <= 0 || scale > 10) {
    throw new Error(`Invalid scale value "${scale}". Must be between 0 (exclusive) and 10 (inclusive).`);
  }

  // Load the PDF document — throws descriptively on failure
  const { document, metadata } = await loadPdf(pdfPath, scale);

  // Ensure the output directory exists
  const absOutputDir = path.resolve(outputDir);
  try {
    fs.mkdirSync(absOutputDir, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create output directory "${absOutputDir}": ${(err as Error).message}`);
  }

  const outputFiles: string[] = [];
  let convertedPages = 0;

  for (let i = 1; i <= metadata.numPages; i++) {
    const filename = metadata.numPages === 1 ? `${prefix}.tiff` : `${prefix}-${i}.tiff`;
    const outputPath = path.join(absOutputDir, filename);
    try {
      // Step 1: Render PDF page → RGBA pixel buffer
      const pixels = await renderPageToPixels(document, i, scale);

      // Step 2: Encode RGBA buffer → TIFF binary
      const tiffBuffer = encodeToTiff(pixels, compression);

      // Step 3: Write TIFF to disk
      fs.writeFileSync(outputPath, tiffBuffer);

      outputFiles.push(outputPath);
      convertedPages++;
    } catch (err) {
      // Non-fatal: record failure but continue with remaining pages
      console.error(`[pdf-to-tiff] Error on page ${i}: ${(err as Error).message}`);
    }
  }

  // Clean up the PDF document resources
  await document.destroy();

  const success = convertedPages === metadata.numPages;

  return {
    success,
    totalPages: metadata.numPages,
    convertedPages,
    outputFiles,
    ...(success ? {} : { error: `${metadata.numPages - convertedPages} page(s) failed to convert` }),
  };
}
