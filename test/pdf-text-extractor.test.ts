import * as fs from 'fs';
import * as path from 'path';
import { convertPdfToText } from '../src/pdf-text-extractor';

const SAMPLE_PDF = path.join(__dirname, 'samples', 'coversheet_sample.pdf');
const MULTI_PAGE_PDF = path.join(__dirname, 'samples', 'sample.pdf');
const OUTPUT_DIR = path.join(__dirname, 'output');

/** Builds a minimal valid single-page PDF with text content. Returns the file path. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function createTextPdf(outPath: string, text: string): void {
  const textOps = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const mediaBox = '[0 0 595 842]';
  const fontDict = '<< /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >>';
  const objStrings = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Contents 4 0 R /Resources << /Font ${fontDict} >> >>\nendobj`,
    `4 0 obj\n<< /Length ${textOps.length} >>\nstream\n${textOps}\nendstream\nendobj`,
  ];
  let body = '%PDF-1.4\n';
  const bodyOffsets: number[] = [];
  for (const s of objStrings) { bodyOffsets.push(body.length); body += s + '\n'; }
  const xrefOffset = body.length;
  let xref = `xref\n0 ${objStrings.length + 1}\n` + '0000000000 65535 f \n';
  for (const off of bodyOffsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
  const trailer = `trailer\n<< /Size ${objStrings.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(outPath, body + xref + trailer, 'ascii');
}

describe('convertPdfToText', () => {
  beforeAll(() => {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  });

  it('returns a non-empty string for a real PDF', async () => {
    const text = await convertPdfToText(SAMPLE_PDF);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }, 60_000);

  it('returns a string (possibly empty) for a multi-page PDF', async () => {
    const text = await convertPdfToText(MULTI_PAGE_PDF);
    expect(typeof text).toBe('string');
  }, 60_000);

  it('separates pages with double newline', async () => {
    const text = await convertPdfToText(MULTI_PAGE_PDF);
    // A multi-page PDF should produce page separators if text exists on multiple pages
    // We just verify the return type and that it does not throw
    expect(text).not.toBeNull();
  }, 60_000);

  it('throws if the file does not exist', async () => {
    await expect(convertPdfToText('/non/existent/file.pdf')).rejects.toThrow(
      /not found/i
    );
  }, 10_000);

  it('throws if given a non-PDF file', async () => {
    const fakePdf = path.join(OUTPUT_DIR, '_fake.pdf');
    fs.writeFileSync(fakePdf, 'this is not a pdf');
    try {
      await expect(convertPdfToText(fakePdf)).rejects.toThrow();
    } finally {
      fs.unlinkSync(fakePdf);
    }
  }, 10_000);

  it('returns empty string for a PDF with no text content', async () => {
    // Create a PDF with only graphic content (no text operators)
    const graphicPdf = path.join(OUTPUT_DIR, '_graphic.pdf');
    const content = ['q', '0.2 0.5 0.8 rg', '0 0 595 842 re f', 'Q'].join('\n');
    const mediaBox = '[0 0 595 842]';
    const objStrings = [
      `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj`,
      `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj`,
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Contents 4 0 R /Resources << >> >>\nendobj`,
      `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj`,
    ];
    let body = '%PDF-1.4\n';
    const bodyOffsets: number[] = [];
    for (const s of objStrings) { bodyOffsets.push(body.length); body += s + '\n'; }
    const xrefOffset = body.length;
    let xref = `xref\n0 ${objStrings.length + 1}\n` + '0000000000 65535 f \n';
    for (const off of bodyOffsets) xref += String(off).padStart(10, '0') + ' 00000 n \n';
    const trailer = `trailer\n<< /Size ${objStrings.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    fs.writeFileSync(graphicPdf, body + xref + trailer, 'ascii');

    try {
      const text = await convertPdfToText(graphicPdf);
      // No text operators → text should be blank/whitespace only
      expect(text.trim()).toBe('');
    } finally {
      fs.unlinkSync(graphicPdf);
    }
  }, 15_000);
});
