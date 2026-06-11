import { encodeToTiff } from '../src/tiff-encoder';
import type { PixelBuffer, TiffCompression } from '../src/types';
import * as UTIF from 'utif';

/** Creates a minimal synthetic RGBA pixel buffer for testing */
function makeSyntheticPixels(width = 4, height = 4): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;     // R
    data[i + 1] = 0;   // G
    data[i + 2] = 0;   // B
    data[i + 3] = 255; // A (opaque)
  }
  return { data, width, height };
}

/** Checks that a Buffer starts with the TIFF magic bytes (little-endian: 49 49 2A 00) */
function isTiffBuffer(buf: Buffer): boolean {
  return (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) || // LE
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)    // BE
  );
}

const compressionModes: TiffCompression[] = ['none', 'packbits', 'lzw'];

describe('tiff-encoder', () => {
  compressionModes.forEach((mode) => {
    it(`encodes with compression="${mode}" and produces valid TIFF magic bytes`, () => {
      const pixels = makeSyntheticPixels(8, 8);
      const buf = encodeToTiff(pixels, mode);

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(0);
      expect(isTiffBuffer(buf)).toBe(true);
    });
  });

  it('LZW output is smaller than uncompressed for a uniform image', () => {
    const pixels = makeSyntheticPixels(32, 32);
    const noneSize = encodeToTiff(pixels, 'none').length;
    const lzwSize  = encodeToTiff(pixels, 'lzw').length;
    // For a solid-color image, LZW should compress well
    expect(lzwSize).toBeLessThan(noneSize);
  });

  it('throws when pixel data length does not match width × height × 4', () => {
    const badPixels: PixelBuffer = {
      data: new Uint8ClampedArray(10), // wrong size
      width: 4,
      height: 4,
    };
    expect(() => encodeToTiff(badPixels, 'lzw')).toThrow('Pixel buffer size mismatch');
  });
});

describe('binarize option', () => {
  /** Converts a Node.js Buffer to an ArrayBuffer for utif */
  function bufToArrayBuffer(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  /** Reads the first numeric value of a SHORT (Uint16) TIFF IFD tag */
  function tagNum(ifd: UTIF.IFD, key: string): number {
    return (ifd[key] as unknown as Uint16Array)[0];
  }

  const compressionModes: TiffCompression[] = ['none', 'packbits', 'lzw'];

  compressionModes.forEach((mode) => {
    it(`binarize=true with compression="${mode}" produces valid TIFF magic bytes`, () => {
      const pixels = makeSyntheticPixels(8, 8);
      const buf = encodeToTiff(pixels, mode, true);
      expect(buf).toBeInstanceOf(Buffer);
      expect(isTiffBuffer(buf)).toBe(true);
    });
  });

  it('binarized output IFD has BitsPerSample=1, PhotometricInterpretation=0 (WhiteIsZero), SamplesPerPixel=1', () => {
    const pixels = makeSyntheticPixels(16, 16);
    const buf = encodeToTiff(pixels, 'none', true);
    const ifds = UTIF.decode(bufToArrayBuffer(buf));
    const ifd = ifds[0];
    expect(tagNum(ifd, 't258')).toBe(1);  // BitsPerSample = 1
    expect(tagNum(ifd, 't262')).toBe(0);  // PhotometricInterpretation: WhiteIsZero
    expect(tagNum(ifd, 't277')).toBe(1);  // SamplesPerPixel = 1
  });

  it('1-bit mono output is smaller than 8-bit RGB output for the same image (no compression)', () => {
    const pixels = makeSyntheticPixels(32, 32);
    const colorSize = encodeToTiff(pixels, 'none', false).length;
    const monoSize  = encodeToTiff(pixels, 'none', true).length;
    expect(monoSize).toBeLessThan(colorSize);
  });

  it('binarize=false (default) still produces BitsPerSample=8 RGB output (non-regression)', () => {
    const pixels = makeSyntheticPixels(16, 16);
    const buf = encodeToTiff(pixels, 'none', false);
    const ifds = UTIF.decode(bufToArrayBuffer(buf));
    const ifd = ifds[0];
    expect(tagNum(ifd, 't258')).toBe(8);  // BitsPerSample = 8
    expect(tagNum(ifd, 't262')).toBe(2);  // PhotometricInterpretation: RGB
  });
});
