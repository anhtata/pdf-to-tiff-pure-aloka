# pdf-to-tiff-pure-aloka

> Pure Node.js PDF to TIFF converter — **zero system dependencies, zero native bindings**.  
> Uses `pdfjs-dist` (Mozilla) + `pureimage` + custom TIFF encoder. Works on any OS without installing Ghostscript, Poppler, or ImageMagick.

[![npm version](https://img.shields.io/npm/v/pdf-to-tiff-pure-aloka)](https://www.npmjs.com/package/pdf-to-tiff-pure-aloka)
[![license](https://img.shields.io/npm/l/pdf-to-tiff-pure-aloka)](./LICENSE)
[![node](https://img.shields.io/node/v/pdf-to-tiff-pure-aloka)](https://nodejs.org)

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [convertPdfToTiff()](#convertpdftotiff)
  - [ConversionOptions](#conversionoptions)
  - [ConversionResult](#conversionresult)
- [Examples](#examples)
- [Compression Modes](#compression-modes)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Features

- ✅ **100% pure JavaScript / TypeScript** — no C++ bindings, no native add-ons
- ✅ **No system dependencies** — no Ghostscript, Poppler, or ImageMagick required
- ✅ **Three compression modes** — LZW, PackBits, or uncompressed
- ✅ **TypeScript types included** — full `.d.ts` declarations shipped
- ✅ **One TIFF per PDF page** — `page-1.tiff`, `page-2.tiff`, …
- ✅ **MIT License** — free for commercial and open-source use

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 18.0.0 |
| npm         | ≥ 8.0.0  |

No system libraries needed.

---

## Installation

```bash
npm install pdf-to-tiff-pure-aloka
```

---

## Quick Start

```js
const { convertPdfToTiff } = require('pdf-to-tiff-pure-aloka');

async function main() {
  const result = await convertPdfToTiff('document.pdf', './output');

  if (result.success) {
    console.log(`Converted ${result.convertedPages} pages:`);
    result.outputFiles.forEach(f => console.log(' -', f));
  } else {
    console.error('Conversion failed:', result.error);
  }
}

main();
```

**TypeScript:**
```ts
import { convertPdfToTiff, ConversionOptions } from 'pdf-to-tiff-pure-aloka';

const options: ConversionOptions = {
  scale: 2.0,
  compression: 'lzw',
  filePrefix: 'scan',
};

const result = await convertPdfToTiff('document.pdf', './output', options);
console.log(result.outputFiles);
// Multi-page: → ['./output/scan-1.tiff', './output/scan-2.tiff', ...]
// Single-page: → ['./output/scan.tiff']
```

---

## API Reference

### `convertPdfToTiff()`

```ts
convertPdfToTiff(
  pdfPath: string,
  outputDir: string,
  options?: ConversionOptions
): Promise<ConversionResult>
```

Converts every page of a PDF file into individual TIFF files.

| Parameter  | Type                | Required | Description |
|------------|---------------------|----------|-------------|
| `pdfPath`  | `string`            | ✅ Yes   | Path to the source PDF file (absolute or relative) |
| `outputDir`| `string`            | ✅ Yes   | Directory where TIFF files are written. Created automatically if it does not exist. |
| `options`  | `ConversionOptions` | No       | Optional settings (see below) |

**Throws** `Error` if:
- The PDF file does not exist or cannot be read
- The PDF is corrupt or has no pages
- `scale` is outside the valid range (0 < scale ≤ 10)
- The output directory cannot be created

---

### `ConversionOptions`

```ts
interface ConversionOptions {
  scale?: number;             // Default: 3.0
  compression?: TiffCompression; // Default: 'lzw'
  filePrefix?: string;        // Default: 'page'
}

type TiffCompression = 'none' | 'packbits' | 'lzw';
```

| Option        | Type              | Default    | Description |
|---------------|-------------------|------------|-------------|
| `scale`       | `number`          | `3.0`      | Render scale multiplier. `1.0` = 72 DPI (PDF native), `2.0` = 144 DPI, `3.0` ≈ 216 DPI (**default**), `4.17` ≈ 300 DPI. Valid range: `(0, 10]`. |
| `compression` | `TiffCompression` | `'lzw'`    | TIFF compression algorithm. See [Compression Modes](#compression-modes). |
| `filePrefix`  | `string`          | `'page'`   | Output filename prefix. **Single-page PDFs:** files are named `${prefix}.tiff` (no page number). **Multi-page PDFs:** files are named `${prefix}-${pageNumber}.tiff`. |

---

### `ConversionResult`

```ts
interface ConversionResult {
  success: boolean;       // true if ALL pages converted successfully
  totalPages: number;     // total pages in the PDF
  convertedPages: number; // pages that were successfully written
  outputFiles: string[];  // absolute paths to each TIFF file, in page order
  error?: string;         // set if success is false
}
```

---

## Examples

### Convert with custom DPI (~300 DPI)

```js
const { convertPdfToTiff } = require('pdf-to-tiff-pure-aloka');

const result = await convertPdfToTiff('invoice.pdf', './tiff-output', {
  scale: 4.17,        // 4.17 × 72 DPI ≈ 300 DPI
  compression: 'lzw',
  filePrefix: 'invoice',
});
// Multi-page: → invoice-1.tiff, invoice-2.tiff, ...
// Single-page: → invoice.tiff
```

### Output to current directory

```js
const { convertPdfToTiff } = require('pdf-to-tiff-pure-aloka');

const result = await convertPdfToTiff('document.pdf', './', {
  filePrefix: 'scan',
});

console.log(result.outputFiles);
// Single-page: → ['scan.tiff']
// Multi-page:  → ['scan-1.tiff', 'scan-2.tiff', ...]
```

### Uncompressed output (fastest, largest files)

```js
const result = await convertPdfToTiff('scan.pdf', './raw', {
  compression: 'none',
});
```

### PackBits compression (fast, moderate size)

```js
const result = await convertPdfToTiff('report.pdf', './compressed', {
  compression: 'packbits',
});
```

### Error handling

```js
const { convertPdfToTiff } = require('pdf-to-tiff-pure-aloka');

try {
  const result = await convertPdfToTiff('document.pdf', './output');

  if (!result.success) {
    // Some pages failed (non-fatal per-page errors)
    console.warn(`Warning: ${result.error}`);
    console.log(`Converted ${result.convertedPages}/${result.totalPages} pages`);
  }

  result.outputFiles.forEach(file => {
    console.log('Created:', file);
  });

} catch (err) {
  // Fatal error: file not found, corrupt PDF, invalid options
  console.error('Fatal error:', err.message);
}
```

### Check output file sizes

```js
const fs = require('fs');
const { convertPdfToTiff } = require('pdf-to-tiff-pure-aloka');

const result = await convertPdfToTiff('document.pdf', './output', {
  compression: 'lzw',
});

result.outputFiles.forEach(file => {
  const size = fs.statSync(file).size;
  console.log(`${file} — ${(size / 1024).toFixed(1)} KB`);
});
```

---

## Compression Modes

| Mode       | TIFF Tag | File Size     | Encoding Speed | Best For |
|------------|----------|---------------|----------------|----------|
| `none`     | 1        | Largest       | Fastest        | Debugging, further processing |
| `packbits` | 32773    | Moderate      | Fast           | General purpose |
| `lzw`      | 5        | Smallest      | Moderate       | Storage, archival (**default**) |

> **Tip:** For text-heavy or white-space-heavy documents, LZW achieves the best compression ratio. For photos or complex vector art, the difference between modes is smaller.

---

## Known Limitations

| Limitation | Details |
|------------|---------|
| **Performance** | Rendering is 3–10× slower than system-library solutions (Ghostscript, Poppler) because everything runs in JavaScript. Expect ~1–5 seconds per page depending on complexity. |
| **Font rendering** | PDFs that use unembedded proprietary fonts (e.g. old Vietnamese TCVN3 fonts) may render as empty boxes. Standard fonts (Helvetica, Times, Courier) require the `standardFontDataUrl` option of pdfjs-dist; this package uses best-effort fallback only. |
| **Color accuracy** | Complex color spaces (CMYK, ICC profiles) are handled by pdfjs on a best-effort basis. Slight color shifts are possible. |
| **Memory usage** | Very high-resolution renders (scale > 4.0) of large pages can use significant RAM. Process pages sequentially for large documents. |
| **No multi-page TIFF** | Each page produces a separate `.tiff` file. Multi-page (strips) TIFF is not supported. |

---

## License

[MIT](./LICENSE) © pdf-to-tiff-pure-aloka contributors

