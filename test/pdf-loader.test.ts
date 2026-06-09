import * as fs from 'fs';
import * as path from 'path';
import { loadPdf } from '../src/pdf-loader';

const SAMPLE_PDF = path.join(__dirname, 'samples', 'sample.pdf');

describe('pdf-loader', () => {
  it('throws when file does not exist', async () => {
    await expect(loadPdf('/nonexistent/path.pdf', 1.5)).rejects.toThrow('PDF file not found');
  });

  it('throws when file is empty', async () => {
    const emptyPath = path.join(__dirname, 'samples', 'empty.pdf');
    fs.writeFileSync(emptyPath, '');
    try {
      await expect(loadPdf(emptyPath, 1.5)).rejects.toThrow();
    } finally {
      fs.unlinkSync(emptyPath);
    }
  });

  it('throws when file is not a valid PDF', async () => {
    const badPath = path.join(__dirname, 'samples', 'bad.pdf');
    fs.writeFileSync(badPath, 'NOT_A_PDF_CONTENT');
    try {
      await expect(loadPdf(badPath, 1.5)).rejects.toThrow();
    } finally {
      fs.unlinkSync(badPath);
    }
  });

  it('loads a valid PDF and returns correct metadata', async () => {
    const result = await loadPdf(SAMPLE_PDF, 1.5);
    expect(result.metadata.numPages).toBeGreaterThanOrEqual(1);
    expect(result.metadata.pages.length).toBe(result.metadata.numPages);
    expect(result.metadata.pages[0].pageNumber).toBe(1);
    expect(result.metadata.pages[0].widthPx).toBeGreaterThan(0);
    expect(result.metadata.pages[0].heightPx).toBeGreaterThan(0);
    await result.document.destroy();
  });

  it('applies scale correctly to page dimensions', async () => {
    const scale1 = await loadPdf(SAMPLE_PDF, 1.0);
    const scale2 = await loadPdf(SAMPLE_PDF, 2.0);
    const w1 = scale1.metadata.pages[0].widthPx;
    const w2 = scale2.metadata.pages[0].widthPx;
    // At 2× scale, dimensions should be approximately double
    expect(w2).toBeGreaterThan(w1);
    await scale1.document.destroy();
    await scale2.document.destroy();
  });
});
