import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { loadPdf } from './pdf-loader';

/**
 * Extracts all text content from a PDF file.
 *
 * @param pdfPath - Absolute or relative path to the source PDF file
 * @returns Concatenated text of all pages, separated by double newlines
 *
 * @throws Error if the PDF cannot be loaded (invalid path, corrupt file, empty PDF).
 *
 * @example
 * ```ts
 * import { convertPdfToText } from 'pdf-to-tiff-pure-aloka';
 *
 * const text = await convertPdfToText('document.pdf');
 * console.log(text);
 * ```
 */
export async function convertPdfToText(pdfPath: string): Promise<string> {
  // scale=1.0 — viewport dimensions are irrelevant for text extraction
  const { document, metadata } = await loadPdf(pdfPath, 1.0);

  const pageTexts: string[] = [];

  for (let i = 1; i <= metadata.numPages; i++) {
    const page = await document.getPage(i);
    const content = await page.getTextContent();

    const pageText = content.items
      .filter((item): item is TextItem => 'str' in item)
      .map((item) => item.str)
      .join(' ');

    pageTexts.push(pageText);
    page.cleanup();
  }

  await document.destroy();

  return pageTexts.join('\n\n');
}
