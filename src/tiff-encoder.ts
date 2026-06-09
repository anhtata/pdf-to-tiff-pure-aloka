import type { PixelBuffer, TiffCompression } from './types';

// TIFF compression tag constants (TIFF 6.0 spec)
const COMPRESSION_NONE     = 1;
const COMPRESSION_LZW      = 5;
const COMPRESSION_PACKBITS = 32773;

/**
 * Encodes a pixel buffer as a TIFF file and returns a Node.js Buffer ready to write to disk.
 * This module writes the TIFF binary structure directly without any native dependencies.
 *
 * @param pixels      - RGBA pixel buffer from the Canvas renderer
 * @param compression - Compression algorithm to apply
 */
export function encodeToTiff(pixels: PixelBuffer, compression: TiffCompression): Buffer {
  const { data, width, height } = pixels;

  if (data.length !== width * height * 4) {
    throw new Error(
      `Pixel buffer size mismatch: expected ${width * height * 4} bytes, got ${data.length}`
    );
  }

  const raw = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  let imageData: Uint8Array;
  let compressionTag: number;

  switch (compression) {
    case 'none':
      imageData = raw;
      compressionTag = COMPRESSION_NONE;
      break;
    case 'packbits':
      imageData = packbitsCompress(raw);
      compressionTag = COMPRESSION_PACKBITS;
      break;
    case 'lzw':
      imageData = lzwCompress(raw);
      compressionTag = COMPRESSION_LZW;
      break;
  }

  return writeTiff(imageData, width, height, compressionTag);
}

// ---------------------------------------------------------------------------
// TIFF binary writer
// ---------------------------------------------------------------------------

/**
 * Builds a valid TIFF file (little-endian, single strip, RGBA 8-bit) from
 * compressed (or raw) image data.
 */
function writeTiff(
  imageData: Uint8Array,
  width: number,
  height: number,
  compression: number
): Buffer {
  // IFD tags — must be sorted ascending by tag number per TIFF 6.0 spec
  // Type constants: 3=SHORT (uint16), 4=LONG (uint32)
  const ifd: Array<{ tag: number; type: number; values: number[] }> = [
    { tag: 256, type: 4, values: [width] },               // ImageWidth
    { tag: 257, type: 4, values: [height] },              // ImageLength
    { tag: 258, type: 3, values: [8, 8, 8, 8] },          // BitsPerSample (RGBA)
    { tag: 259, type: 3, values: [compression] },         // Compression
    { tag: 262, type: 3, values: [2] },                   // PhotometricInterpretation: RGB
    { tag: 273, type: 4, values: [0] },                   // StripOffsets (filled below)
    { tag: 277, type: 3, values: [4] },                   // SamplesPerPixel: 4 (RGBA)
    { tag: 278, type: 4, values: [height] },              // RowsPerStrip: all rows
    { tag: 279, type: 4, values: [imageData.length] },    // StripByteCounts
    { tag: 284, type: 3, values: [1] },                   // PlanarConfiguration: chunky
    { tag: 338, type: 3, values: [2] },                   // ExtraSamples: unassociated alpha
  ];

  const TYPE_BYTES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

  // Header: 8 bytes.  Image data immediately after.
  const IMAGE_OFFSET = 8;
  // IFD follows image data (aligned to even byte boundary — TIFF requirement)
  const ifdBase = IMAGE_OFFSET + imageData.length;
  const ifdBaseAligned = ifdBase % 2 !== 0 ? ifdBase + 1 : ifdBase;

  // IFD size: 2 (entry count) + N*12 (entries) + 4 (next-IFD offset)
  const IFD_SIZE = 2 + ifd.length * 12 + 4;

  // Values that don't fit in the 4-byte inline field go into an "extras" area
  let extraOffset = ifdBaseAligned + IFD_SIZE;
  const extras: Array<{ ifdIdx: number; values: number[]; type: number; offset: number }> = [];

  ifd.forEach((entry, idx) => {
    const tbytes = TYPE_BYTES[entry.type] ?? 1;
    const totalBytes = tbytes * entry.values.length;
    if (totalBytes > 4) {
      extras.push({ ifdIdx: idx, values: entry.values, type: entry.type, offset: extraOffset });
      extraOffset += totalBytes;
      if (extraOffset % 2 !== 0) extraOffset++;
    }
  });

  // Now we know image offset — patch StripOffsets
  ifd.find((e) => e.tag === 273)!.values = [IMAGE_OFFSET];

  const buf = Buffer.alloc(extraOffset, 0);

  // TIFF header
  buf.writeUInt16LE(0x4949, 0);          // Byte order: little-endian "II"
  buf.writeUInt16LE(42, 2);              // TIFF magic number
  buf.writeUInt32LE(ifdBaseAligned, 4);  // Offset to first IFD

  // Image data
  buf.set(imageData, IMAGE_OFFSET);

  // IFD entry count
  let pos = ifdBaseAligned;
  buf.writeUInt16LE(ifd.length, pos);
  pos += 2;

  // IFD entries (12 bytes each)
  ifd.forEach((entry, idx) => {
    const tbytes   = TYPE_BYTES[entry.type] ?? 1;
    const totalBytes = tbytes * entry.values.length;

    buf.writeUInt16LE(entry.tag, pos);           pos += 2;
    buf.writeUInt16LE(entry.type, pos);          pos += 2;
    buf.writeUInt32LE(entry.values.length, pos); pos += 4;

    const extra = extras.find((e) => e.ifdIdx === idx);
    if (extra) {
      buf.writeUInt32LE(extra.offset, pos);
    } else {
      // Inline value — write into the 4-byte value field (unused bytes stay 0)
      let vp = pos;
      void totalBytes; // suppress lint warning
      for (const v of entry.values) {
        if (entry.type === 3) { buf.writeUInt16LE(v, vp); vp += 2; }
        else if (entry.type === 4) { buf.writeUInt32LE(v, vp); vp += 4; }
        else { buf[vp++] = v; }
      }
    }
    pos += 4;
  });

  // Next IFD offset: 0 = no more IFDs
  buf.writeUInt32LE(0, pos);

  // Extra data sections (e.g. BitsPerSample [8,8,8,8])
  for (const extra of extras) {
    let ep = extra.offset;
    for (const v of extra.values) {
      if (extra.type === 3) { buf.writeUInt16LE(v, ep); ep += 2; }
      else if (extra.type === 4) { buf.writeUInt32LE(v, ep); ep += 4; }
      else { buf[ep++] = v; }
    }
  }

  return buf;
}

// ---------------------------------------------------------------------------
// PackBits (RLE) compression — TIFF spec Appendix C
// ---------------------------------------------------------------------------

/**
 * Compresses data using the PackBits run-length encoding scheme.
 *
 * Header byte semantics (as signed int8):
 *   0  to  127 → copy the next (n+1) bytes literally
 *  -1  to -127 → repeat the next single byte (-n+1) times
 */
function packbitsCompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  const len = data.length;
  let i = 0;

  while (i < len) {
    // Count run of identical bytes (max 128 per spec)
    let runLen = 1;
    while (runLen < 128 && i + runLen < len && data[i + runLen] === data[i]) {
      runLen++;
    }

    if (runLen >= 2) {
      // Encoded run: header = -(runLen-1) as unsigned byte, then one copy
      out.push((-(runLen - 1)) & 0xff);
      out.push(data[i]);
      i += runLen;
    } else {
      // Literal run: scan while no run of 2+ identical bytes is ahead
      let litLen = 1;
      while (litLen < 128 && i + litLen < len) {
        const ahead = data[i + litLen];
        const next  = data[i + litLen + 1];
        if (next !== undefined && ahead === next) break;
        litLen++;
      }
      out.push(litLen - 1); // header: 0..127
      for (let j = 0; j < litLen; j++) out.push(data[i + j]);
      i += litLen;
    }
  }

  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// TIFF LZW compression — TIFF 6.0 spec, Section 13
// Big-endian (MSB-first) bit packing, variable-width codes 9–12 bits.
// ---------------------------------------------------------------------------

const LZW_CLEAR = 256;
const LZW_EOI   = 257;

function lzwCompress(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let bitBuf    = 0;
  let bitCount  = 0;
  let codeWidth = 9;

  /** Emit `code` into a MSB-first bit stream */
  function emit(code: number): void {
    bitBuf = (bitBuf << codeWidth) | code;
    bitCount += codeWidth;
    while (bitCount >= 8) {
      bitCount -= 8;
      out.push((bitBuf >>> bitCount) & 0xff);
    }
  }

  let table = new Map<string, number>();
  let nextCode = 0;

  function resetTable(): void {
    table = new Map();
    for (let b = 0; b < 256; b++) table.set(String.fromCharCode(b), b);
    nextCode = LZW_EOI + 1; // 258
    codeWidth = 9;
  }

  resetTable();
  emit(LZW_CLEAR);

  if (data.length === 0) {
    emit(LZW_EOI);
    if (bitCount > 0) out.push((bitBuf << (8 - bitCount)) & 0xff);
    return new Uint8Array(out);
  }

  let current = String.fromCharCode(data[0]);

  for (let i = 1; i < data.length; i++) {
    const ch       = String.fromCharCode(data[i]);
    const extended = current + ch;

    if (table.has(extended)) {
      current = extended;
    } else {
      emit(table.get(current)!);

      if (nextCode < 4096) {
        table.set(extended, nextCode++);
        // Per TIFF spec: increase code width before the first code that would
        // overflow the current width (i.e., when nextCode exceeds 2^codeWidth).
        if (nextCode > (1 << codeWidth) && codeWidth < 12) {
          codeWidth++;
        }
      } else {
        // Table full at 4096 entries → emit CLEAR and restart
        emit(LZW_CLEAR);
        resetTable();
      }

      current = ch;
    }
  }

  emit(table.get(current)!);
  emit(LZW_EOI);

  // Flush remaining bits (left-aligned in the last byte)
  if (bitCount > 0) out.push((bitBuf << (8 - bitCount)) & 0xff);

  return new Uint8Array(out);
}
