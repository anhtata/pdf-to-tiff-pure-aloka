import * as path from 'path';
import { loadPdf } from '../src/pdf-loader';
import { renderPageToPixels } from '../src/canvas-renderer';

const SAMPLE_PDF = path.join(__dirname, 'samples', 'sample.pdf');

describe('canvas-renderer', () => {
  it('renders page 1 and returns RGBA pixel buffer', async () => {
    const { document, metadata } = await loadPdf(SAMPLE_PDF, 1.0);
    const pixels = await renderPageToPixels(document, 1, 1.0);

    const { widthPx, heightPx } = metadata.pages[0];
    expect(pixels.width).toBe(widthPx);
    expect(pixels.height).toBe(heightPx);
    // RGBA = 4 bytes per pixel
    expect(pixels.data.length).toBe(widthPx * heightPx * 4);

    await document.destroy();
  });

  it('RGBA buffer contains non-zero values (not all black)', async () => {
    const { document } = await loadPdf(SAMPLE_PDF, 1.0);
    const pixels = await renderPageToPixels(document, 1, 1.0);

    // Sum all pixel channel values — a non-zero sum means the page has content
    let sum = 0;
    for (let i = 0; i < pixels.data.length; i++) {
      sum += pixels.data[i];
    }
    expect(sum).toBeGreaterThan(0);

    await document.destroy();
  });

  it('scaled render produces proportionally larger buffer', async () => {
    const { document } = await loadPdf(SAMPLE_PDF, 1.0);
    const px1 = await renderPageToPixels(document, 1, 1.0);
    const px2 = await renderPageToPixels(document, 1, 2.0);

    expect(px2.width).toBeGreaterThan(px1.width);
    expect(px2.height).toBeGreaterThan(px1.height);
    // pixel count should be roughly 4× at 2× scale
    expect(px2.data.length).toBeGreaterThan(px1.data.length);

    await document.destroy();
  });
});
