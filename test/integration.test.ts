import * as fs from 'fs';
import * as path from 'path';
import { convertPdfToTiff } from '../src/converter';

const SAMPLE_PDF  = path.join(__dirname, 'samples', 'sample.pdf');
const OUTPUT_DIR  = path.join(__dirname, 'output');

afterEach(() => {
  // Clean up any TIFF files created during tests
  if (fs.existsSync(OUTPUT_DIR)) {
    fs.readdirSync(OUTPUT_DIR)
      .filter((f) => f.endsWith('.tiff'))
      .forEach((f) => fs.unlinkSync(path.join(OUTPUT_DIR, f)));
  }
});

describe('convertPdfToTiff — integration', () => {
  it('converts all pages and returns correct result shape', async () => {
    const result = await convertPdfToTiff(SAMPLE_PDF, OUTPUT_DIR);

    expect(result.success).toBe(true);
    expect(result.totalPages).toBeGreaterThanOrEqual(1);
    expect(result.convertedPages).toBe(result.totalPages);
    expect(result.outputFiles.length).toBe(result.totalPages);
    expect(result.error).toBeUndefined();
  }, 120_000);

  it('creates TIFF files on disk for every page', async () => {
    const result = await convertPdfToTiff(SAMPLE_PDF, OUTPUT_DIR);

    for (const filePath of result.outputFiles) {
      expect(fs.existsSync(filePath)).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);
    }
  }, 120_000);

  it('default output filenames follow pattern page-N.tiff', async () => {
    const result = await convertPdfToTiff(SAMPLE_PDF, OUTPUT_DIR);

    result.outputFiles.forEach((filePath, idx) => {
      const basename = path.basename(filePath);
      expect(basename).toBe(`page-${idx + 1}.tiff`);
    });
  }, 120_000);

  it('respects custom filePrefix option', async () => {
    const result = await convertPdfToTiff(SAMPLE_PDF, OUTPUT_DIR, { filePrefix: 'doc' });

    result.outputFiles.forEach((filePath, idx) => {
      expect(path.basename(filePath)).toBe(`doc-${idx + 1}.tiff`);
    });
  }, 120_000);

  it('works with all three compression modes', async () => {
    const modes = ['none', 'packbits', 'lzw'] as const;
    for (const compression of modes) {
      const subDir = path.join(OUTPUT_DIR, compression);
      const result = await convertPdfToTiff(SAMPLE_PDF, subDir, { compression });
      expect(result.success).toBe(true);
      expect(result.outputFiles.length).toBeGreaterThanOrEqual(1);
      // clean up sub directory
      result.outputFiles.forEach((f) => fs.unlinkSync(f));
      fs.rmdirSync(subDir, { recursive: true });
    }
  }, 300_000);

  it('creates output directory automatically if missing', async () => {
    const newDir = path.join(OUTPUT_DIR, 'auto-created');
    if (fs.existsSync(newDir)) fs.rmdirSync(newDir, { recursive: true });

    const result = await convertPdfToTiff(SAMPLE_PDF, newDir);

    expect(fs.existsSync(newDir)).toBe(true);
    expect(result.success).toBe(true);
    // cleanup
    result.outputFiles.forEach((f) => fs.unlinkSync(f));
    fs.rmdirSync(newDir);
  }, 120_000);

  it('throws for a non-existent PDF path', async () => {
    await expect(convertPdfToTiff('/no/such/file.pdf', OUTPUT_DIR)).rejects.toThrow(
      'PDF file not found'
    );
  });

  it('throws for an invalid scale value', async () => {
    await expect(convertPdfToTiff(SAMPLE_PDF, OUTPUT_DIR, { scale: -1 })).rejects.toThrow(
      'Invalid scale value'
    );
  });
});
