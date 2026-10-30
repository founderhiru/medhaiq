// Runs inside a worker_thread with memory limits. Never imported directly.
const { parentPort, workerData } = require('worker_threads');

async function run() {
  const { kind, buffer, maxPages } = workerData;
  // Own, exactly-sized ArrayBuffer: pdf.js reads `.buffer` and ignores
  // byteOffset, so a pooled Buffer slice (any file under ~4 KB) would be read
  // as garbage ("bad XRef entry").
  const u8 = new Uint8Array(buffer.length);
  u8.set(buffer);
  const buf = Buffer.from(u8.buffer, 0, u8.length);
  if (kind === 'pdf') {
    // lib/pdf-parse.js directly: the package index has a debug branch that
    // reads a test file when it believes it is the entry module.
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const pages = [];
    const res = await pdfParse(u8, {
      max: maxPages + 1,
      pagerender: (pageData) => pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
        .then((tc) => {
          let lastY; let text = '';
          for (const item of tc.items) {
            if (lastY === item.transform[5] || lastY === undefined) text += item.str;
            else text += `\n${item.str}`;
            lastY = item.transform[5];
          }
          pages.push(text);
          return text;
        }),
    });
    return { pages, totalPages: res.numpages };
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return { pages: [r.value || ''], totalPages: 1 };
  }
  throw new Error('unsupported');
}

run().then((out) => parentPort.postMessage({ ok: true, ...out }))
  .catch((e) => parentPort.postMessage({ ok: false, error: String((e && e.message) || e).slice(0, 120) }));
