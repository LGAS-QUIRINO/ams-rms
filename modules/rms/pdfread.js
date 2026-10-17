// Reading a PDF to fill in the Receiving form (fill-in only; the file is never stored).
// Text PDFs are read directly. Scanned PDFs are read with text recognition (Tesseract) on this computer:
// nothing is uploaded, and after the first use it works offline.

/* ---------- loading the readers (only when first needed) ---------- */
const loaded = {};
function loadScript(src, globalName) {
  if (loaded[src]) return loaded[src];
  loaded[src] = new Promise((resolve, reject) => {
    if (window[globalName]) return resolve(window[globalName]);
    const sc = document.createElement('script'); sc.src = src;
    sc.onload = () => resolve(window[globalName]);
    sc.onerror = () => { delete loaded[src]; reject(new Error('the reader could not load. Check the internet connection the first time.')); };
    document.head.appendChild(sc);
  });
  return loaded[src];
}
async function pdfjs() {
  const lib = await loadScript('lib/pdf.min.js', 'pdfjsLib');
  lib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  return lib;
}
const abs = (p) => new URL(p, location.href).href;

/* ---------- getting the lines of text ---------- */
async function openPdf(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('choose a PDF file');
  const lib = await pdfjs();
  return lib.getDocument({ data: await file.arrayBuffer() }).promise;
}
// Text already inside the PDF, line by line.
async function textLines(doc, maxPages = 3) {
  const lines = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const rows = new Map();
    tc.items.forEach((it) => { const y = Math.round(it.transform[5] / 3); const r = rows.get(y) || []; r.push(it); rows.set(y, r); });
    [...rows.keys()].sort((a, b) => b - a).forEach((y) => {
      const t = rows.get(y).sort((a, b) => a.transform[4] - b.transform[4]).map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
    });
  }
  return lines;
}
// Scanned pages: draw each page as a picture, then recognize the text.
async function ocrLines(doc, maxPages, onProgress) {
  const T = await loadScript('lib/ocr/tesseract.min.js', 'Tesseract');
  const worker = await T.createWorker('eng', 1, {
    workerPath: abs('lib/ocr/worker.min.js'), corePath: abs('lib/ocr/core/'), langPath: abs('lib/ocr/lang'),
    gzip: true, workerBlobURL: false,
    logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); }
  });
  const lines = [];
  try {
    const n = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= n; p++) {
      if (onProgress) onProgress(0, p, n);
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2.2 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const { data } = await worker.recognize(c);
      data.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((l) => lines.push(l));
    }
  } finally { await worker.terminate(); }
  return lines;
}

// { lines, pages, scanned } — scanned PDFs are read only when allowOcr is true.
export async function pdfToLines(file, { allowOcr = false, onProgress } = {}) {
  const doc = await openPdf(file);
  let lines = await textLines(doc);
  const hasText = lines.join(' ').replace(/\s/g, '').length > 40;
  if (hasText) return { lines, pages: doc.numPages, scanned: false };
  if (!allowOcr) return { lines: [], pages: doc.numPages, scanned: true };
  lines = await ocrLines(doc, 2, onProgress);
  return { lines, pages: doc.numPages, scanned: true };
}

/* ---------- finding the details in the text ---------- */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SKIP_HEAD = /^(republic of the philippines|commission on audit|tel\.?|telephone|e-?mail|website|www\.|fax)/i;
const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9Ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

export function parseDetails(lines, { reports = [], offices = [] } = {}) {
  const text = lines.join('\n'), up = norm(text);
  // Subject (letters): "SUBJECT:", "RE:" — plus the next line when the subject continues.
  let subject = '';
  const si = lines.findIndex((l) => /^(subject|re)\s*[:：;]/i.test(l));
  if (si >= 0) {
    subject = lines[si].replace(/^(subject|re)\s*[:：;]\s*/i, '');
    const nx = lines[si + 1] || '';
    if (nx && !/[:：]/.test(nx) && !/^(dear|sir|madam|gentlemen|ma.?am)/i.test(nx) && nx.length < 120 && subject.length > 40) subject += ' ' + nx;
  }
  // Sender: the first letterhead line naming an office.
  const from = (lines.slice(0, 8).find((l) => !SKIP_HEAD.test(l) && /(municipal|municipality|city|province|provincial|barangay|sangguniang|hospital|office|department|regional|region)/i.test(l)) || '').trim();
  // Signatory: an all-capital name (2–7 words) near the end, followed by a designation line.
  let signatory = '', designation = '';
  for (let k = lines.length - 1; k >= Math.max(0, lines.length - 30); k--) {
    const l = lines[k].replace(/\s+/g, ' ').trim();
    const words = l.split(' ');
    if (/^[A-ZÑ][A-ZÑ.\-' ]{4,60}$/.test(l) && words.length >= 2 && words.length <= 7 && !/(PHILIPPINES|COMMISSION|REPUBLIC|OFFICE|MUNICIPALITY|PROVINCE|BARANGAY|REPORT|CERTIFIED|TOTAL|PREPARED|APPROVED|NOTED)/.test(l)) {
      signatory = l;
      const d = (lines[k + 1] || '').trim();
      if (d && d.length < 80 && !/^(cc|copy|attachment|encl|date)/i.test(d)) designation = d;
      break;
    }
  }
  // Report: the report whose name (or code as a word) appears; the longest name wins.
  let report = null;
  [...reports].sort((a, b) => b.name.length - a.name.length).some((r) => {
    if (up.includes(norm(r.name)) || new RegExp(`\\b${norm(r.code)}\\b`).test(up)) { report = r; return true; }
    return false;
  });
  // Period: "for the month of September 2026", "September 2026", "First Quarter 2026", "CY 2026".
  let period = '';
  const low = text.toLowerCase();
  const m = low.match(new RegExp(`(${MONTHS.join('|')})[\\s,]*(?:\\d{1,2}[\\s,-]*)?(?:\\d{1,2}[\\s,]*)?(20\\d\\d)`));
  const q = low.match(/(first|second|third|fourth|1st|2nd|3rd|4th)\s+quarter[\s,a-z]*?(20\d\d)/);
  if (q) { const n = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 }[q[1]]; period = `${q[2]}-Q${n}`; }
  if (m && (!report || report.frequency === 'Monthly' || !period)) period = `${m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`;
  // Office: an office whose name appears in the first part (with its kind, e.g. BARANGAY ABBAG).
  const head = norm(lines.slice(0, 25).join(' '));
  // When several offices are named (a letterhead names the municipality and the barangay), the most specific wins:
  // SK (when the document is an SK's), then barangay, then other offices, then municipality, then province.
  const skDoc = /SANGGUNIANG KABATAAN|\bSK\b/.test(head);
  const rank = (o) => /^sk of/i.test(o.label) ? (skDoc ? 0 : 5) : /^barangay/i.test(o.label) ? 1 : /^municipality/i.test(o.label) ? 3 : /^provincial/i.test(o.label) ? 4 : 2;
  const named = offices.filter((o) => o.code).filter((o) => {
    const base = norm(String(o.label || o.name || '').split(' · ')[0].replace(/^(barangay|municipality of|sk of|provincial government of)\s+/i, ''));
    if (!base || !new RegExp(`\\b${base}\\b`).test(head)) return false;
    const kind = /^barangay/i.test(o.label) ? 'BARANGAY' : /^sk of/i.test(o.label) ? 'SK' : /^municipality/i.test(o.label) ? 'MUNICIPAL' : '';
    return !kind || (kind === 'SK' ? skDoc : head.includes(kind));
  }).sort((a, b) => rank(a) - rank(b));
  const office = named[0] || null;
  return { text, subject: subject.trim(), from, signatory, designation, report, period, office };
}
