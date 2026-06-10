import * as fs from 'fs';
import * as path from 'path';
import { convertPdfToTiff } from '../src/converter';

const SAMPLE_PDF  = path.join(__dirname, 'samples', 'coversheet_sample.pdf');
const MULTI_PAGE_PDF = path.join(__dirname, 'samples', 'sample.pdf');
const OUTPUT_DIR  = path.join(__dirname, 'output');

/** Builds a minimal valid single-page PDF and writes it to a temp file. Returns the file path. */
function createSinglePagePdf(outPath: string): void {
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
  fs.writeFileSync(outPath, body + xref + trailer, 'ascii');
}

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

  it('multi-page: default output filenames follow pattern page-N.tiff', async () => {
    const result = await convertPdfToTiff(MULTI_PAGE_PDF, OUTPUT_DIR);

    expect(result.totalPages).toBeGreaterThan(1);
    result.outputFiles.forEach((filePath, idx) => {
      const basename = path.basename(filePath);
      expect(basename).toBe(`page-${idx + 1}.tiff`);
    });
  }, 120_000);

  it('single-page: default output filename has no page-number suffix', async () => {
    const singlePagePdf = path.join(OUTPUT_DIR, '_single.pdf');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    createSinglePagePdf(singlePagePdf);
    try {
      const result = await convertPdfToTiff(singlePagePdf, OUTPUT_DIR);
      expect(result.totalPages).toBe(1);
      expect(result.outputFiles).toHaveLength(1);
      expect(path.basename(result.outputFiles[0])).toBe('page.tiff');
    } finally {
      fs.unlinkSync(singlePagePdf);
    }
  }, 120_000);

  it('multi-page: respects custom filePrefix option', async () => {
    const result = await convertPdfToTiff(MULTI_PAGE_PDF, OUTPUT_DIR, { filePrefix: 'doc' });

    expect(result.totalPages).toBeGreaterThan(1);
    result.outputFiles.forEach((filePath, idx) => {
      expect(path.basename(filePath)).toBe(`doc-${idx + 1}.tiff`);
    });
  }, 120_000);

  it('single-page: custom filePrefix has no page-number suffix', async () => {
    const singlePagePdf = path.join(OUTPUT_DIR, '_single.pdf');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    createSinglePagePdf(singlePagePdf);
    try {
      const result = await convertPdfToTiff(singlePagePdf, OUTPUT_DIR, { filePrefix: 'scan' });
      expect(result.totalPages).toBe(1);
      expect(path.basename(result.outputFiles[0])).toBe('scan.tiff');
    } finally {
      fs.unlinkSync(singlePagePdf);
    }
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
      fs.rmSync(subDir, { recursive: true });
    }
  }, 300_000);

  it('single-page coversheet: TIFF contains non-white pixel content (not blank)', async () => {
    // Use compression:'none' to rule out any decompression issue — raw pixels only
    const result = await convertPdfToTiff(SAMPLE_PDF, OUTPUT_DIR, { compression: 'none' });
    expect(result.success).toBe(true);
    expect(result.outputFiles).toHaveLength(1);

    const tiffBuf = fs.readFileSync(result.outputFiles[0]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const UTIF = require('utif') as typeof import('utif');
    const ifds = UTIF.decode(tiffBuf);
    UTIF.decodeImage(tiffBuf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);

    // Count pixels that are noticeably darker than white (real ink/content).
    // Threshold < 200 avoids false-positives from JPEG/anti-aliasing artefacts,
    // and also catches all-black images (would score 0 non-white-ish pixels).
    // A real coversheet should have at least 100 such content pixels.
    let contentPixels = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i] < 200 && rgba[i + 1] < 200 && rgba[i + 2] < 200) {
        contentPixels++;
      }
    }
    expect(contentPixels).toBeGreaterThan(100);
  }, 120_000);

  it('creates output directory automatically if missing', async () => {
    const newDir = path.join(OUTPUT_DIR, 'auto-created');
    if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true });

    const result = await convertPdfToTiff(SAMPLE_PDF, newDir);

    expect(fs.existsSync(newDir)).toBe(true);
    expect(result.success).toBe(true);
    // cleanup
    result.outputFiles.forEach((f) => fs.unlinkSync(f));
    fs.rmSync(newDir, { recursive: true, force: true });
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
