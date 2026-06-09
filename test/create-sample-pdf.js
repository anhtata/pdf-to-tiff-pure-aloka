/**
 * Script to generate a minimal valid 2-page PDF for testing.
 * Uses only vector graphics (no text / no fonts) so the test suite
 * does not need pdfjs standard font data or any native canvas library.
 *
 * Run once: node test/create-sample-pdf.js
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, 'samples');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Graphics-only PDF content:
//   q/Q = save/restore graphics state
//   rg  = set non-stroking (fill) colour (RGB, 0-1 range)
//   re  = rectangle path  (x y w h re)
//   f   = fill
const content1 = [
  'q',
  '0.2 0.5 0.8 rg',    // light-blue fill
  '0 0 595 842 re f',   // full-page background
  '0.9 0.4 0.1 rg',    // orange
  '80 300 435 200 re f',
  '1 1 1 rg',           // white
  '160 360 275 80 re f',
  'Q',
].join('\n');

const content2 = [
  'q',
  '0.1 0.6 0.3 rg',    // green fill
  '0 0 595 842 re f',
  '0.8 0.8 0.1 rg',    // yellow
  '80 200 435 300 re f',
  '1 1 1 rg',
  '160 300 275 100 re f',
  'Q',
].join('\n');

function buildMinimalPdf() {
  const objects = [];

  function addObj(content) {
    objects.push(content);
    return objects.length; // 1-based object number
  }

  const catalogId  = addObj('');
  const pagesId    = addObj('');
  // No font object needed — graphics only
  const page1Id    = addObj('');
  const stream1Id  = addObj('');
  const page2Id    = addObj('');
  const stream2Id  = addObj('');

  const mediaBox = '[0 0 595 842]';

  const objStrings = [
    `1 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj`,
    `2 0 obj\n<< /Type /Pages /Kids [${page1Id} 0 R ${page2Id} 0 R] /Count 2 >>\nendobj`,
    `3 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${mediaBox} /Contents ${stream1Id} 0 R /Resources << >> >>\nendobj`,
    `4 0 obj\n<< /Length ${content1.length} >>\nstream\n${content1}\nendstream\nendobj`,
    `5 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox ${mediaBox} /Contents ${stream2Id} 0 R /Resources << >> >>\nendobj`,
    `6 0 obj\n<< /Length ${content2.length} >>\nstream\n${content2}\nendstream\nendobj`,
  ];

  let body = '%PDF-1.4\n';
  const bodyOffsets = [];
  for (const s of objStrings) {
    bodyOffsets.push(body.length);
    body += s + '\n';
  }

  const xrefOffset = body.length;
  let xref = `xref\n0 ${objStrings.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (const off of bodyOffsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }

  const trailer = `trailer\n<< /Size ${objStrings.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return body + xref + trailer;
}

const pdf = buildMinimalPdf();
const outPath = path.join(outDir, 'sample.pdf');
fs.writeFileSync(outPath, pdf, 'ascii');
console.log(`Created: ${outPath} (${pdf.length} bytes, 2 pages, graphics-only)`);
