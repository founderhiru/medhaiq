// services/screening/extract.js
//
// Hardened document intake. Untrusted bytes in, plain text pages out.
//   * file type decided by magic bytes, never by filename or client MIME
//   * DOCX: ZIP central directory inspected BEFORE any decompression
//     (entry count, declared sizes, encryption, required part)
//   * PDF: page cap, no-text-layer (scanned) rejection
//   * parsing runs in a worker thread with a memory cap and a hard timeout
//   * nothing is written to disk; the original file is never stored
//   * the filename is never used (it often contains the candidate's name)

const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const cfg = require('../../config/screening');
const { ScreeningError } = require('../../lib/screening-errors');
const { redactResume } = require('../../lib/screening-redact');
const { detectInjection } = require('../../lib/screening-flags');
const { validateIsResume } = require('../resume-preview-validator');

const L = cfg.LIMITS;

function sniff(buf) {
  if (buf.length >= 5 && buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
  return null;
}

// Inspect the ZIP central directory without decompressing anything.
function inspectDocx(buf) {
  const tail = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= tail; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ScreeningError('bad_docx', 422, 'This does not look like a valid Word (.docx) file.');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOff = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    throw new ScreeningError('bad_docx', 422, 'This Word file uses an unsupported format.');
  }
  if (total > L.DOCX_MAX_ENTRIES) throw new ScreeningError('docx_too_complex', 422, 'This Word file is too complex to read safely.');
  if (cdOff + cdSize > buf.length) throw new ScreeningError('bad_docx', 422, 'This does not look like a valid Word (.docx) file.');

  let pos = cdOff;
  let uncompressed = 0;
  let hasDocument = false;
  for (let n = 0; n < total; n += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new ScreeningError('bad_docx', 422, 'This does not look like a valid Word (.docx) file.');
    }
    const flags = buf.readUInt16LE(pos + 8);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    if (flags & 1) throw new ScreeningError('encrypted', 422, 'This file is password-protected. Please upload an unprotected copy.');
    if (size > L.DOCX_MAX_ENTRY_BYTES) throw new ScreeningError('docx_too_large', 422, 'This Word file expands to an unsafe size.');
    uncompressed += size;
    if (uncompressed > L.DOCX_MAX_UNCOMPRESSED_BYTES) throw new ScreeningError('docx_too_large', 422, 'This Word file expands to an unsafe size.');
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (name === 'word/document.xml') hasDocument = true;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (!hasDocument) throw new ScreeningError('bad_docx', 422, 'This does not look like a Word (.docx) document.');
}

function runWorker(kind, buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'extract-worker.js'), {
      workerData: { kind, buffer, maxPages: L.PDF_MAX_PAGES },
      resourceLimits: { maxOldGenerationSizeMb: L.EXTRACT_WORKER_MAX_MB },
    });
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); worker.terminate().catch(() => {}); fn(v); } };
    const timer = setTimeout(() => done(reject, new ScreeningError('extract_timeout', 422, 'This file took too long to read. Try a simpler copy or paste the text.')), L.EXTRACT_TIMEOUT_MS);
    worker.once('message', (m) => {
      if (m && m.ok) done(resolve, m);
      else done(reject, new ScreeningError('unreadable', 422, 'We could not read this file. Try a different copy or paste the text.'));
    });
    worker.once('error', () => done(reject, new ScreeningError('unreadable', 422, 'We could not read this file. Try a different copy or paste the text.')));
    worker.once('exit', (code) => { if (code !== 0) done(reject, new ScreeningError('unreadable', 422, 'We could not read this file. Try a different copy or paste the text.')); });
  });
}

function cleanText(s) {
  return String(s == null ? '' : s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[​-‏‪-‮⁠﻿]/g, '') // zero-width / bidi control chars used to hide text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Returns { pages: string[], sourceType } from raw bytes.
async function extractPagesFromFile(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new ScreeningError('empty_file', 400, 'The file is empty.');
  if (buffer.length > L.FILE_MAX_BYTES) throw new ScreeningError('file_too_large', 413, `Files can be up to ${Math.round(L.FILE_MAX_BYTES / 1048576)} MB.`);
  const type = sniff(buffer);
  if (!type) throw new ScreeningError('unsupported_type', 415, 'Only PDF and Word (.docx) files are supported.');

  if (type === 'zip') {
    inspectDocx(buffer);
    const out = await runWorker('docx', buffer);
    return { pages: [cleanText(out.pages[0])], sourceType: 'docx' };
  }
  const out = await runWorker('pdf', buffer);
  if (out.totalPages > L.PDF_MAX_PAGES) {
    throw new ScreeningError('too_many_pages', 422, `Resumes can be up to ${L.PDF_MAX_PAGES} pages.`);
  }
  const pages = out.pages.map(cleanText);
  if (pages.join('').replace(/\s/g, '').length < 50) {
    throw new ScreeningError('no_text_layer', 422, 'This PDF has no readable text (it may be a scan). Please upload a text-based PDF or a Word file.');
  }
  return { pages, sourceType: 'pdf' };
}

// Pages (raw) → redacted text, page offsets, summary, flags, hash.
function prepareResume(pages, sourceType) {
  const summary = { emails: 0, phones: 0, links: 0, sensitive_fields: 0, name_line: 0 };
  const redactedPages = [];
  pages.forEach((p, i) => {
    const r = redactResume(p, { nameLine: i === 0 });
    redactedPages.push(r.text);
    Object.keys(summary).forEach((k) => { summary[k] += r.summary[k] || 0; });
  });
  let text = '';
  const pageOffsets = [];
  redactedPages.forEach((p, i) => {
    if (i > 0) text += '\n\n';
    pageOffsets.push(text.length);
    text += p;
  });

  if (text.length > L.RESUME_MAX_CHARS) {
    throw new ScreeningError('resume_too_long', 422, `This resume is longer than ${L.RESUME_MAX_CHARS.toLocaleString('en-US')} characters, which is more than we can check reliably.`);
  }
  if (text.replace(/\s/g, '').length < L.RESUME_MIN_CHARS) {
    throw new ScreeningError('resume_too_short', 422, 'There is too little text here to screen.');
  }
  const gate = validateIsResume(pages.join('\n\n'));
  if (!gate.valid) {
    throw new ScreeningError('not_a_resume', 422, 'This does not look like a resume or CV.');
  }
  const fileHash = crypto.createHash('sha256').update(pages.join('\n\n').replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');
  return {
    text,
    pageOffsets,
    pageCount: pages.length,
    redactionSummary: summary,
    injectionFlags: detectInjection(pages.join('\n')),
    fileHash,
    sourceType,
  };
}

function prepareJd(raw) {
  const text = cleanText(raw);
  if (text.length < L.JD_MIN_CHARS) throw new ScreeningError('jd_too_short', 422, 'This job description is too short to work from.');
  if (text.length > L.JD_MAX_CHARS) throw new ScreeningError('jd_too_long', 422, `Job descriptions can be up to ${L.JD_MAX_CHARS.toLocaleString('en-US')} characters.`);
  return text;
}

module.exports = { extractPagesFromFile, prepareResume, prepareJd, cleanText, sniff, inspectDocx };
