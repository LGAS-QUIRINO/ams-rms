// Records Management · Receiving (agreed 17–18 Oct 2026; For Verification rule agreed 18 Oct 2026).
// Report Submission or Communication → checklist of what was submitted → tracking number at receipt → small acknowledgment slip.
// Reports received by the JO are For Verification until an auditor accepts or rejects them. An auditor receiving on their own
// account may accept, reject or leave it For Verification (bulk reports are always For Verification). Late documents are added to
// the same tracking number with their dates, and the submission history keeps every step.
import { store, newId } from '../../js/store.js';
import { esc, pill, modal, toast, $, $$ } from '../../js/ui.js';
import { pdfToLines, parseDetails } from './pdfread.js';
import { DEMO } from '../../js/config.js';
import { syncNow } from '../../js/sync.js';
import { scopesFor, visibleOffices, periodsOf, periodLabel, dueDate, span, fmtDT, fmtDate, jobOrderOnly, hasRole } from './rms.js';

const by = (refs) => refs.me?.data.email || '';
const myName = (refs) => refs.me?.data.name || '';
// A document counts as in when submitted, or marked N/A (optional parts only, e.g. BRS parts that do not apply).
export const isIn = (c) => !!(c.ok || c.na);
// Stored compactly: for per-account entries the name ("account · part") is not repeated; it is rebuilt when loaded.
// (Large BRS records otherwise pass the 50,000-character limit of a Google Sheets cell.)
export function packItem(d) {
  if (!d || !isGrouped(d.checklist)) return d;
  return { ...d, checklist: d.checklist.map((c) => { if (!(c.line && c.part)) return c; const { item: _i, by: _b, ...rest } = c; return rest; }) };
}
export function unpackItem(d) {
  if (!d || !Array.isArray(d.checklist)) return d;
  return { ...d, checklist: d.checklist.map((c) => (c.item || !(c.line && c.part) ? c : { ...c, item: `${c.line} · ${c.part}` })) };
}
const saveItem = (id, data, who, opts) => store.save('rms_items', id, packItem(data), who, opts);

// Adds a batch that came in (ticked documents, N/A parts) to a record, with its date received. A batch dated earlier than
// the record's first submission (back-encoding out of order) becomes the 1st submission; the earlier-entered batch then
// counts as a later one. The tracking number never changes.
export function applyBatch(i, picked, pickedNa, at, who, whoName) {
  const enc = new Date().toISOString(), earlier = at < i.receivedAt;
  const ck = (i.checklist || []).map((c, k) => {
    let x = earlier && c.ok && !c.late ? { ...c, late: true, byName: c.byName || i.receivedByName, encodedAt: c.encodedAt || i.encodedAt } : c;
    if (picked.includes(k)) x = { ...x, ok: true, at, encodedAt: enc, late: !earlier, byName: whoName };
    else if (pickedNa.includes(k)) x = { ...x, na: true, naAt: enc, naBy: whoName };
    return x;
  });
  const { id: _x, _new: _n, ...data } = i;
  const next = { ...data, checklist: ck, ...(earlier ? { receivedAt: at, receivedBy: who, receivedByName: whoName, encodedAt: enc } : {}) };
  if (ck.every(isIn)) next.completedAt = ck.reduce((m, c) => (c.ok && c.at > m ? c.at : m), ''); else delete next.completedAt;
  return next;
}
// The record already received for an office, report and period (not rejected), if any.
export const existingFor = (rms, officeId, reportId, period) => rms.items.filter((i) => i.kind !== 'comm' && i.officeId === officeId && i.reportId === reportId && i.period === period && i.status !== 'rejected')
  .sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))[0] || null;
const missing = (i) => (i.checklist || []).filter((c) => !isIn(c));

// Auditors who accept or reject: ATL, Team Members, SA and Admin (not JO or OSA Staff).
export const canDecide = (refs) => hasRole(refs, 'atl', 'member', 'sa', 'admin');
// Who may correct a received record (wrong ticks, date, period, names): Admin and SA only.
export const canCorrect = (refs) => hasRole(refs, 'admin', 'sa');
// Combining records of the same office, report and period received more than once: Admin only (it removes records).
export const canCombine = (refs) => hasRole(refs, 'admin');
const dupKey = (i) => `${i.officeId}|${i.reportId}|${i.period}`;
export function duplicateGroups(rms, offIds) {
  const g = {};
  rms.items.filter((i) => i.kind !== 'comm' && i.status !== 'rejected' && offIds.has(i.officeId) && !i._new).forEach((i) => { (g[dupKey(i)] = g[dupKey(i)] || []).push(i); });
  return Object.entries(g).filter(([, l]) => l.length > 1).map(([key, l]) => ({ key, list: l.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))) }));
}
// Status helpers. Older records may still say 'pending' (= For Verification) or 'complete' (= accepted).
export const isVerify = (i) => i.kind !== 'comm' && (i.status === 'verify' || i.status === 'pending');
export const isAccepted = (i) => i.status === 'accepted' || i.status === 'complete';
export const lacksDocs = (i) => i.kind !== 'comm' && i.status !== 'rejected' && missing(i).length > 0;

/* ---------- numbers ---------- */
// One running series per office per year, shared by reports and communications: MAD-ABB-RCI-2026-0012 / MAD-ABB-2026-0013.
function nextSeries(rms, officeId, year) {
  const nums = rms.items.filter((i) => (i.seriesKey || i.officeId) === officeId && i.trackingNo && i.trackingYear === year).map((i) => i.series || 0);
  return Math.max(0, ...nums) + 1;
}
function trackingNo(rms, office, reportCode, year) {
  const n = nextSeries(rms, office.id, year);
  return { trackingNo: [office.code, reportCode, year, String(n).padStart(4, '0')].filter(Boolean).join('-'), series: n, trackingYear: year, seriesKey: office.id };
}
// Older records may carry a pending code instead of a tracking number.
export const numberOf = (i) => i.trackingNo || i.pendingCode || '';

export function statusText(i) {
  if (i.kind === 'comm') return 'Received';
  if (isVerify(i)) return 'For Verification';
  if (i.status === 'rejected') return 'Rejected';
  if (isAccepted(i)) return missing(i).length ? 'Accepted – with missing documents' : 'Accepted';
  return i.status || '';
}
export function statusPill(i) {
  const t = statusText(i);
  return pill(t, t === 'Received' || t === 'For Verification' ? 'blue' : t === 'Accepted' ? 'ok' : t === 'Rejected' ? 'bad' : 'warn');
}

/* ---------- checklist of a report for one office ---------- */
// Most reports use the Report Library checklist. A report marked "each office has its own list" (e.g. BRS: one line per bank
// account) uses the office's own list from Office Setup. The office's extra requirement, if any, is added at the end.
// With parts (e.g. BRS: BRS signed, bank statement, list of outstanding checks), every line (bank account) gets its own checklist:
// one entry per line and part, { item: 'GF – LBP 1234 · Bank statement', line, part }.
export function entriesFor(r, o) {
  const parts = r.perOffice ? (r.checklist || []) : [];
  const base = r.perOffice
    ? ((o && o.lists && o.lists[r.id]) || []).flatMap((line) => parts.length ? parts.map((part) => ({ item: `${line} · ${part}`, line, part, ...((r.optional || []).includes(part) ? { optional: true } : {}) })) : [{ item: line }])
    : (r.checklist || []).map((t) => ({ item: t }));
  return [...base, ...(o && o.note ? [{ item: o.note }] : [])];
}
export const itemsFor = (r, o) => entriesFor(r, o).map((e) => e.item);
// Entries with a line and a part, grouped by line (in order): [[line, [{...entry, k}]]].
export const isGrouped = (ck) => (ck || []).some((c) => c.line && c.part);
export function linesOf(ck) {
  const m = new Map();
  (ck || []).forEach((c, k) => { if (c.line && c.part) { if (!m.has(c.line)) m.set(c.line, []); m.get(c.line).push({ ...c, k }); } });
  return [...m.entries()];
}
// Accounts complete / partly submitted / not submitted.
export function lineTally(ck) {
  const rows = linesOf(ck);
  return { rows, total: rows.length, done: rows.filter(([, es]) => es.every(isIn)), part: rows.filter(([, es]) => es.some((e) => e.ok) && !es.every(isIn)), none: rows.filter(([, es]) => !es.some((e) => e.ok)) };
}
// Accordions: one per line, each opening to its parts as checkboxes (name), with a count and Tick all.
function accordionHtml(ck, { name, onlyMissing = false, hideAll = false, checked = (e) => e.ok, naChecked = (e) => !!e.na, open = false }) {
  return linesOf(ck).map(([line, es]) => {
    const shown = onlyMissing ? es.filter((e) => !isIn(e)) : es;
    if (!shown.length) return '';
    return `<details class="acc" data-line="${esc(line)}" data-t="${esc(line.toLowerCase())}" ${hideAll ? 'hidden' : ''} ${open ? 'open' : ''}>
      <summary><span class="acc-l">${esc(line)}</span><span class="acc-n"></span></summary>
      <div class="acc-b">${shown.map((e) => `<div class="part"><label><input type="checkbox" name="${name}" value="${e.k}" ${checked(e) ? 'checked' : ''}> ${esc(e.part)}${e.optional ? ' <small>(optional)</small>' : ''}${e.ok && e.late ? ` <small>· late, ${esc(fmtDate(e.at))}</small>` : ''}</label>
        ${e.optional ? `<label class="na"><input type="checkbox" name="${name}-na" value="${e.k}" ${naChecked(e) ? 'checked' : ''}> N/A</label>` : ''}</div>`).join('')}
        <div class="btn-row"><button type="button" class="btn sm" data-acc-all>Tick all</button></div></div></details>`;
  }).join('');
}
// Keeps each accordion's count up to date; base = parts already submitted before (Late Docs).
function wireAccordions(bg, name, onChange, base = () => 0) {
  const upd = () => $$('details.acc', bg).forEach((d) => {
    const xs = $$(`input[name=${name}]`, d), n = $('.acc-n', d);
    const t = xs.filter((x) => x.checked || ($(`input[name=${name}-na][value="${x.value}"]`, d) || {}).checked).length;
    const have = base(d) + t, of = base(d) + xs.length;
    n.textContent = `${have} of ${of}`; n.className = 'acc-n ' + (have === of ? 'ok' : have ? 'half' : 'none');
  });
  $$('details.acc', bg).forEach((d) => {
    // Submitted and N/A exclude each other.
    $$(`input[name=${name}]`, d).forEach((x) => { x.addEventListener('change', () => { const na = $(`input[name=${name}-na][value="${x.value}"]`, d); if (x.checked && na) na.checked = false; upd(); if (onChange) onChange(); }); });
    $$(`input[name=${name}-na]`, d).forEach((x) => { x.addEventListener('change', () => { if (x.checked) $(`input[name=${name}][value="${x.value}"]`, d).checked = false; upd(); if (onChange) onChange(); }); });
    // Tick all: every part not marked N/A.
    $('[data-acc-all]', d).onclick = () => { $$(`input[name=${name}]`, d).forEach((x) => { const na = $(`input[name=${name}-na][value="${x.value}"]`, d); if (!na || !na.checked) x.checked = true; }); upd(); if (onChange) onChange(); };
  });
  upd();
  return upd;
}
const LONG = 12;
// Date and time for an <input type="datetime-local">, in this computer's time.
const localInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
// Reading the date field: an ISO date, or an error message.
function readWhen(v, now = new Date()) {
  const d = new Date(v);
  if (!v || isNaN(d)) return { err: 'Enter the date received.' };
  if (d - now > 5 * 60000) return { err: 'The date received cannot be in the future.' };
  return { iso: d.toISOString() };
}
// Encoded more than an hour after it was received (e.g. an earlier submission entered now).
const laterNote = (rec, enc, byName) => rec && enc && new Date(enc) - new Date(rec) > 3600000 ? `encoded ${fmtDate(enc)}${byName ? ' by ' + byName : ''}` : '';
export const encodedLater = (i) => !!laterNote(i.receivedAt, i.encodedAt);
// Checklist for screens: every line when short; for long lists (e.g. 75 bank accounts) the count and only what is missing.
export function checklistHtml(i) {
  const ck = i.checklist || [], m = ck.filter((c) => !c.ok);
  if (isGrouped(ck)) {
    // Per account: how many are complete, which lack parts (and which), which were not submitted.
    const t = lineTally(ck), lbl = ((i.lineLabel || 'account') + 's').toLowerCase(), other = ck.filter((c) => !(c.line && c.part));
    const lacks = (es) => es.filter((e) => !isIn(e)).map((e) => e.part).join(', ');
    return `<p><b>${t.done.length} of ${t.total} ${esc(lbl)} complete</b></p>
      ${t.part.length ? `<span class="legend">Missing parts · ${t.part.length}</span><ul class="rcv-ck">${t.part.map(([l, es]) => `<li class="miss">${esc(l)} <small>— no ${esc(lacks(es))}</small></li>`).join('')}</ul>` : ''}
      ${t.none.length ? `<span class="legend">Not submitted · ${t.none.length}</span><ul class="rcv-ck">${t.none.map(([l]) => `<li class="miss">${esc(l)}</li>`).join('')}</ul>` : ''}
      ${other.length ? `<ul class="rcv-ck">${other.map((c) => `<li class="${c.ok ? 'ok' : 'miss'}">${esc(c.item)}</li>`).join('')}</ul>` : ''}
      ${!t.part.length && !t.none.length && !other.some((c) => !c.ok) ? '<p class="ok-t">Nothing missing.</p>' : ''}
      <details><summary>Show every ${esc((i.lineLabel || 'account').toLowerCase())}</summary><ul class="rcv-ck">${t.rows.map(([l, es]) => `<li class="${es.every(isIn) ? 'ok' : 'miss'}">${esc(l)}<br><small>${es.map((e) => (e.ok ? '✓ ' : e.na ? '– ' : '✗ ') + esc(e.part) + (e.na ? ' N/A' : '') + (e.late ? ' (' + esc(fmtDate(e.at)) + ')' : '')).join(' · ')}</small></li>`).join('')}</ul></details>`;
  }
  const line = (c) => `<li class="${c.ok ? 'ok' : 'miss'}">${esc(c.item)}${c.late ? ` <small>· late, ${esc(fmtDate(c.at))}</small>` : ''}</li>`;
  if (ck.length <= LONG) return `<ul class="rcv-ck">${ck.map(line).join('')}</ul>`;
  const late = ck.filter((c) => c.ok && c.late);
  return `<p><b>${ck.length - m.length} of ${ck.length} submitted</b>${late.length ? ` (${late.length} late)` : ''}</p>
    ${m.length ? `<span class="legend">Missing · ${m.length}</span><ul class="rcv-ck">${m.map(line).join('')}</ul>` : '<p class="ok-t">Nothing missing.</p>'}
    <details><summary>Show all ${ck.length}</summary><ul class="rcv-ck">${ck.map(line).join('')}</ul></details>`;
}

/* ---------- submission history ---------- */
const ORD = ['1st', '2nd', '3rd'];
const ordinal = (n) => ORD[n - 1] || n + 'th';
// Every step of one record, oldest first: the first submission, each batch of late documents, and the auditor's decision.
export function historyOf(i) {
  const ck = i.checklist || [], total = ck.length;
  const ev = [];
  if (i.kind === 'comm') { const n = laterNote(i.receivedAt, i.encodedAt, i.receivedByName); return [{ at: i.receivedAt, text: 'Received' + (n ? ' (' + n + ')' : ''), who: n ? '' : i.receivedByName }]; }
  let have = ck.filter((c) => c.ok && !c.late).length;
  // Per account (e.g. BRS): after each submission, how many accounts are complete.
  const grp = isGrouped(ck), lbl = ((i.lineLabel || 'account') + 's').toLowerCase(), inSoFar = new Set(ck.map((c, k) => ((c.ok && !c.late) || c.na ? k : -1)).filter((k) => k >= 0));
  const acct = () => { const rows = linesOf(ck); const d = rows.filter(([, es]) => es.every((e) => inSoFar.has(e.k))).length; return `${d} of ${rows.length} ${lbl} complete`; };
  const n1 = laterNote(i.receivedAt, i.encodedAt, i.receivedByName);
  ev.push({ at: i.receivedAt, who: n1 ? '' : i.receivedByName, text: grp ? `1st submission · ${acct()} (${have} of ${total} parts)${n1 ? ' (' + n1 + ')' : ''}`
    : `1st submission · ${have} of ${total} document${total === 1 ? '' : 's'} submitted${have === total ? ' · all submitted' : ''}${n1 ? ' (' + n1 + ')' : ''}` });
  const late = {};
  ck.forEach((c, k) => { if (c.ok && c.late) (late[c.at] = late[c.at] || []).push({ ...c, k }); });
  Object.keys(late).sort().forEach((at, k) => {
    const got = late[at]; have += got.length;
    // Per account: name the accounts (not every part); otherwise the documents.
    const nm = grp && got.every((c) => c.line) ? [...new Set(got.map((c) => c.line))] : got.map((c) => c.item);
    const names = nm.length > 5 ? nm.slice(0, 5).join('; ') + `; and ${nm.length - 5} more` : nm.join('; ');
    const nl = laterNote(at, got[0].encodedAt, got[0].byName);
    got.forEach((c) => inSoFar.add(c.k));
    ev.push({ at, who: nl ? '' : got[0].byName || '', text: grp ? `${ordinal(k + 2)} submission · +${got.length} late part${got.length > 1 ? 's' : ''} (${names}) · ${acct()}${nl ? ' (' + nl + ')' : ''}`
      : `${ordinal(k + 2)} submission · +${got.length} late document${got.length > 1 ? 's' : ''} (${names})${have === total ? ' · all submitted' : ` · ${total - have} still missing`}${nl ? ' (' + nl + ')' : ''}` });
  });
  (i.corrections || []).forEach((c) => ev.push({ at: c.at, who: c.byName, decision: true, text: `${c.combine ? 'Combined' : 'Corrected'} · ${c.reason}${c.changes && c.changes.length ? ' (' + c.changes.join('; ') + ')' : ''}` }));
  if (i.decision) ev.push({ at: i.decision.at, who: i.decision.byName, decision: true,
    text: (i.decision.action === 'accept' ? 'Accepted' : 'Rejected') + (i.decision.remarks ? ' · ' + i.decision.remarks : '') });
  return ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
export function historyHtml(i) {
  return `<ol class="rcv-hist">${historyOf(i).map((e) => `<li class="${e.decision ? 'dec' : ''}"><b>${esc(fmtDT(e.at))}</b> · ${esc(e.text)}${e.who ? ` <small>by ${esc(e.who)}</small>` : ''}</li>`).join('')}</ol>`;
}

/* ================= Receiving page ================= */
// The report group of an item (from the Report Library), or 'comm' for communications.
export const groupOfItem = (rms, i) => i.kind === 'comm' ? 'comm' : (rms.reports.find((r) => r.id === i.reportId)?.groupId || '');
export function receivingHtml(refs, rms, q) {
  const scopes = scopesFor(refs);
  if (!scopes.length) return `<div class="msg bad">No team is assigned to you yet. Ask the Admin to set your team in Users &amp; Roles.</div>`;
  const offs = visibleOffices(refs, rms, scopes.map((s) => s.id));
  const offIds = new Set(offs.map((o) => o.id));
  const jo = jobOrderOnly(refs);
  const teams = refs.me ? (refs.me.data.teamIds || []) : [];
  const g = q.get('g') || 'all';
  const inGroup = (i) => g === 'all' || groupOfItem(rms, i) === (g === 'none' ? '' : g);
  const mine = rms.items.filter((i) => (offIds.has(i.officeId) || (!i.officeId && (teams.includes(i.teamId) || hasRole(refs, 'admin', 'sa', 'osa')))) && (!jo || i.receivedBy === by(refs)));
  // Most recently entered first (an earlier submission encoded today shows at the top).
  const recent = mine.filter(inGroup).sort((a, b) => String(b.encodedAt || b.receivedAt).localeCompare(String(a.encodedAt || a.receivedAt))).slice(0, 30);
  const verify = canDecide(refs) ? rms.items.filter((i) => offIds.has(i.officeId) && isVerify(i) && inGroup(i)) : [];
  const lacking = rms.items.filter((i) => offIds.has(i.officeId) && lacksDocs(i) && !isVerify(i) && inGroup(i));
  const dups = canCombine(refs) ? duplicateGroups(rms, offIds) : [];
  const off = (id) => offs.find((o) => o.id === id);
  const rep = (id) => rms.reports.find((r) => r.id === id);
  const what = (i) => i.kind === 'comm' ? 'Communication · ' + esc(i.subject || '') : esc((rep(i.reportId)?.code || '') + ' · ' + periodLabel(i.period));
  const cols = 'grid-template-columns:minmax(190px,1.2fr) minmax(170px,1fr) 120px 220px 170px';
  const row = (i, acts) => `<div class="t-row" style="${cols}"><span class="mono"><b>${esc(numberOf(i))}</b>${i._new ? '<br><small class="warn-t">not yet confirmed</small>' : ''}</span>
    <span>${esc(i.kind === 'comm' && !i.officeId ? i.fromOutside : off(i.officeId)?.label || '')}<br><small>${what(i)}</small></span>
    <span><small>${esc(fmtDate(i.receivedAt))}${encodedLater(i) ? '<br><i>encoded later</i>' : '<br>' + esc(new Date(i.receivedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}</small></span><span>${statusPill(i)}</span><span class="acts">${acts}</span></div>`;
  const groups = rms.groups || [];
  const gOpt = (v, t) => `<option value="${esc(v)}" ${g === v ? 'selected' : ''}>${esc(t)}</option>`;
  return `<div class="hello"><div><h1>Receiving</h1><p>Record what the offices submit. Every receipt gets its tracking number right away. Reports received by the JO are For Verification until an auditor accepts or rejects them.</p></div>
      <button class="btn primary" type="button" id="rcv-new">+ Receive Documents</button></div>
    <div class="rcv-filter"><label for="rcv-g">Group</label><select class="input" id="rcv-g">${gOpt('all', 'All groups')}${groups.map((x) => gOpt(x.id, x.name)).join('')}${gOpt('none', 'No group')}${gOpt('comm', 'Communications')}</select></div>
    ${verify.length ? `<section class="panel"><div class="panel-head"><h2>For Verification · ${verify.length}</h2></div>
      <div class="t-head" style="${cols}"><span>Tracking No.</span><span>Office · Report</span><span>Received</span><span>Documents</span><span></span></div>
      ${verify.map((i) => { const m = missing(i), n = (i.checklist || []).length; return `<div class="t-row" style="${cols}"><span class="mono"><b>${esc(numberOf(i))}</b></span><span>${esc(off(i.officeId)?.label || '')}<br><small>${what(i)}</small></span>
        <span><small>${esc(fmtDT(i.receivedAt))}</small></span><span><small>${isGrouped(i.checklist) ? (() => { const t = lineTally(i.checklist); return `${t.done.length} of ${t.total} ${esc(((i.lineLabel || 'account') + 's').toLowerCase())} complete${t.part.length ? `<br>${t.part.length} missing parts` : ''}${t.none.length ? `<br>${t.none.length} not submitted` : ''}`; })() : `${n - m.length} of ${n} submitted`}${isGrouped(i.checklist) ? '' : m.length ? '<br>Missing: ' + (m.length > 3 ? m.slice(0, 3).map((c) => esc(c.item)).join('; ') + `; and ${m.length - 3} more` : m.map((c) => esc(c.item)).join('; ')) : ''}</small></span>
        <span class="acts"><button class="btn sm primary" data-decide="${i.id}">Accept / Reject</button><button class="btn sm" data-view="${i.id}">View</button></span></div>`; }).join('')}</section>` : ''}
    ${dups.length ? `<section class="panel"><div class="panel-head"><h2>Same Period Received More Than Once · ${dups.length}</h2></div>
      <div class="note">Each of these was received as separate records. Combine them into one record (the earliest keeps its tracking number); the others are removed and noted in its history.</div>
      ${dups.map((d) => { const f = d.list[0]; return `<div class="t-row" style="${cols}"><span class="mono">${d.list.map((i) => `<b>${esc(numberOf(i))}</b>`).join('<br>')}</span>
        <span>${esc(off(f.officeId)?.label || '')}<br><small>${what(f)}</small></span><span><small>${d.list.map((i) => esc(fmtDate(i.receivedAt))).join('<br>')}</small></span><span><small>${d.list.length} records</small></span>
        <span class="acts"><button class="btn sm primary" data-combine="${esc(d.key)}">Combine</button></span></div>`; }).join('')}</section>` : ''}
    ${lacking.length ? `<section class="panel"><div class="panel-head"><h2>Accepted, Still Missing Documents · ${lacking.length}</h2></div>
      ${lacking.map((i) => row(i, `<button class="btn sm" data-late="${i.id}">Add Late Documents</button><button class="btn sm" data-view="${i.id}">View</button>`)).join('')}</section>` : ''}
    <section class="panel"><div class="panel-head"><h2>${jo ? 'Received by You' : 'Recently Received'}</h2></div>
      ${recent.length ? `<div class="t-head" style="${cols}"><span>Tracking No.</span><span>Office · Item</span><span>Received</span><span>Status</span><span></span></div>
        ${recent.map((i) => row(i, `<button class="btn sm" data-view="${i.id}">View</button>${i._new ? '' : `<button class="btn sm" data-slip="${i.id}">Slip</button>`}${lacksDocs(i) ? `<button class="btn sm" data-late="${i.id}">Late Docs</button>` : ''}${canCorrect(refs) && !i._new ? `<button class="btn sm" data-fix="${i.id}">Correct</button>` : ''}`)).join('')}`
        : `<div class="empty"><b>${g === 'all' ? 'Nothing received yet' : 'Nothing received in this group'}</b>${g === 'all' ? 'Use + Receive Documents to record the first submission.' : 'Choose All groups to see everything.'}</div>`}</section>`;
}

export function wireReceiving(refs, rms, q, rerender) {
  $('#rcv-new').onclick = () => receiveForm(refs, rms);
  const gs = $('#rcv-g'); if (gs) gs.onchange = () => { location.hash = '#/rms/receiving' + (gs.value === 'all' ? '' : '?g=' + encodeURIComponent(gs.value)); };
  $$('[data-decide]').forEach((b) => { b.onclick = () => decide(refs, rms, b.dataset.decide); });
  $$('[data-late]').forEach((b) => { b.onclick = () => addLate(refs, rms, b.dataset.late); });
  $$('[data-view]').forEach((b) => { b.onclick = () => viewItem(refs, rms, b.dataset.view); });
  $$('[data-fix]').forEach((b) => { b.onclick = () => correctItem(refs, rms, b.dataset.fix); });
  $$('[data-combine]').forEach((b) => { b.onclick = () => combineItems(refs, rms, b.dataset.combine); });
  $$('[data-slip]').forEach((b) => { b.onclick = () => printSlip(refs, rms, rms.items.find((i) => i.id === b.dataset.slip)); });
  if (q.get('new') === '1') { history.replaceState(null, '', '#/rms/receiving'); receiveForm(refs, rms); }
}

/* ---------- receive form ---------- */
async function receiveForm(refs, rms) {
  const scopes = scopesFor(refs);
  const offs = visibleOffices(refs, rms, scopes.map((s) => s.id));
  const label = (s) => s.data.kind === 'province' ? 'Province of Quirino' : s.data.name;
  const now = new Date(), year = now.getFullYear();
  const auditor = canDecide(refs);
  const groupName = (id) => (rms.groups || []).find((x) => x.id === id)?.name || '';
  let out = null, ex = null;   // ex: the record already received for the chosen office, report and period
  const res = await modal({
    title: 'Receive Documents', wide: true,
    body: `<div class="rcv-pdf"><label class="btn sm" for="f-pdf">Upload PDF to fill in</label><input type="file" id="f-pdf" accept="application/pdf,.pdf" hidden>
        <span class="hint" id="f-pdf-hint">Reads the office, report and period, or a letter's subject, sender and signatory. The PDF itself is not saved.</span>
        <button type="button" class="btn sm primary" id="f-ocr" hidden>Read scanned pages</button></div>
      <div class="rcv-type"><label><input type="radio" name="kind" value="report" checked> Report Submission</label><label><input type="radio" name="kind" value="comm"> Communication</label></div>
      <div class="two"><div class="field"><label for="f-mun">Municipality</label><select class="input" id="f-mun">${scopes.map((s) => `<option value="${s.id}">${esc(label(s))}</option>`).join('')}</select></div>
        <div class="field"><label for="f-off">Submitting Office</label><select class="input" id="f-off"></select><span class="hint" id="f-off-hint"></span></div></div>
      <div id="rep-part">
        <div class="two"><div class="field"><label for="f-rep">Report</label><select class="input" id="f-rep"></select></div>
          <div class="field"><label for="f-per">Period</label><select class="input" id="f-per"></select><span class="hint" id="f-due"></span></div></div>
        <div class="rcv-exist" id="f-exist" hidden></div>
        <div><span class="legend">Checklist · tick what was actually submitted</span><div id="f-list" class="rcv-list"></div><span class="hint" id="f-state"></span></div>
        <div id="f-dec" class="rcv-dec">${auditor ? `<span class="legend">Your decision</span>
          <div class="rcv-type"><label><input type="radio" name="rdec" value="verify" checked> For Verification</label><label><input type="radio" name="rdec" value="accept"> Accept</label><label><input type="radio" name="rdec" value="reject"> Reject</label></div>
          <div class="field" id="f-drem-box" hidden><label for="f-drem">Decision remarks <span id="f-dreq">(required for a rejection)</span></label><input class="input" id="f-drem" placeholder="e.g. Accepted; DVs to follow within 5 days"></div>` : ''}
          <span class="hint" id="f-dec-hint"></span></div>
      </div>
      <div id="comm-part" hidden>

        <div class="field"><label><input type="checkbox" id="f-outside"> From outside (e.g. COA Regional Office II), not one of the offices</label></div>
        <div class="field" id="f-outside-box" hidden><label for="f-from">From</label><input class="input" id="f-from" placeholder="e.g. COA Regional Office II"></div>
        <div class="field"><label for="f-subj">Subject / Description</label><input class="input" id="f-subj" placeholder="e.g. Letter on the conduct of exit conference"></div>
        <div class="field" style="max-width:220px"><label for="f-pages">Pages / Attachments (optional)</label><input class="input" id="f-pages" placeholder="e.g. 3 pages"></div>
      </div>
      <div class="two"><div class="field"><label for="f-by">Received From (name)</label><input class="input" id="f-by" list="f-by-list" placeholder="e.g. Juan P. Reyes"><datalist id="f-by-list"></datalist></div>
        <div class="field"><label for="f-des">Designation</label><input class="input" id="f-des" placeholder="e.g. Barangay Treasurer"></div></div>
      <div class="two"><div class="field"><label for="f-date">Date received</label><input class="input" type="datetime-local" id="f-date" value="${localInput(now)}" max="${localInput(now)}">
          <span class="hint">Now, unless you are encoding an earlier submission: then use the date on the RECEIVED stamp.</span></div>
        <div class="field"><label for="f-rem">Remarks (optional)</label><input class="input" id="f-rem"></div></div>
      <p class="hint">Encoded by <b>${esc(myName(refs))}</b> · ${esc(fmtDT(now))} (recorded automatically)</p>`,
    onOpen: (bg) => {
      const kind = () => $('input[name=kind]:checked', bg).value;
      const officesOf = (mid) => offs.filter((o) => o.munId === mid);
      const fillOffices = () => {
        const list = officesOf($('#f-mun', bg).value);
        $('#f-off', bg).innerHTML = list.map((o) => `<option value="${o.id}" ${o.code ? '' : 'disabled'}>${esc(o.label)}${o.code ? ' · ' + esc(o.code) : ' · no office code yet'}</option>`).join('') || '<option value="">No offices set up yet</option>';
        const first = list.find((o) => o.code); if (first) $('#f-off', bg).value = first.id;
        $('#f-off-hint', bg).textContent = list.some((o) => !o.code) ? 'Offices without an office code cannot receive yet (Office Setup).' : '';
        fillReports();
      };
      const office = () => offs.find((o) => o.id === $('#f-off', bg).value);
      const fillReports = () => {
        const o = office();
        const reps = o ? rms.reports.filter((r) => r.active !== false && (o.reportIds || []).includes(r.id)).sort((a, b) => a.code.localeCompare(b.code)) : [];
        // Grouped by the team's report groups, in the order set in the Report Library.
        const order = [...(rms.groups || []).map((x) => x.id), ''];
        const opt = (r) => `<option value="${r.id}">${esc(r.code + ' · ' + r.name)}</option>`;
        const anyGroup = reps.some((r) => r.groupId && groupName(r.groupId));
        $('#f-rep', bg).innerHTML = (anyGroup ? order.map((gid) => { const list = reps.filter((r) => (groupName(r.groupId) ? r.groupId : '') === gid);
          return list.length ? `<optgroup label="${esc(gid ? groupName(gid) : 'No group')}">${list.map(opt).join('')}</optgroup>` : ''; }).join('') : reps.map(opt).join(''))
          || '<option value="">No reports ticked for this office</option>';
        // Usual submitters of this office, to pick from.
        const names = [...new Set(rms.items.filter((i) => o && i.officeId === o.id && i.submittedBy).map((i) => i.submittedBy + '|' + (i.submittedDesignation || '')))];
        $('#f-by-list', bg).innerHTML = names.map((n) => `<option value="${esc(n.split('|')[0])}">${esc(n.split('|')[1])}</option>`).join('');
        fillPeriods();
      };
      const fillPeriods = () => {
        const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value), o = office();
        if (!r || !o) { $('#f-per', bg).innerHTML = ''; $('#f-list', bg).innerHTML = ''; return; }
        const ps = [...periodsOf(r, year - 1), ...periodsOf(r, year)].filter((p) => { const [y, a] = span(p); return new Date(y, a - 1, 1) <= now; });
        const got = new Set(rms.items.filter((i) => i.officeId === o.id && i.reportId === r.id && i.status !== 'rejected').map((i) => i.period));
        // Default: the earliest period not yet received among the latest few, else the latest.
        // Suggest the earliest period not yet received from the monitoring start onward, else the latest.
        const tracked = ps.filter((p) => { const [y, , e] = span(p); return `${y}-${String(e).padStart(2, '0')}` >= rms.startPeriod; });
        const def = tracked.find((p) => !got.has(p)) || ps[ps.length - 1];
        $('#f-per', bg).innerHTML = ps.reverse().map((p) => `<option value="${p}" ${p === def ? 'selected' : ''}>${esc(periodLabel(p))}${got.has(p) ? ' · already received' : ''}</option>`).join('')
          + (r.frequency === 'As needed' ? `<option value="${year}">${year} (as needed)</option>` : '');
        fillList();
      };
      // The same office, report and period already received: this batch is added to that record (same tracking number),
      // and only what is still missing is listed.
      const fillList = () => {
        const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value), o = office(), p = $('#f-per', bg).value;
        if (!r || !o) return;
        ex = p ? existingFor(rms, o.id, r.id, p) : null;
        const box = $('#f-exist', bg);
        if (ex) {
          const t = isGrouped(ex.checklist) ? lineTally(ex.checklist) : null, m = missing(ex).length;
          box.innerHTML = `<b>${esc(periodLabel(p))} ${esc(r.code)} was already received: <span class="mono">${esc(numberOf(ex))}</span></b> (first ${esc(fmtDate(ex.receivedAt))})<br>
            ${t ? `${t.done.length} of ${t.total} ${esc(((ex.lineLabel || 'account') + 's').toLowerCase())} complete so far.` : `${(ex.checklist || []).length - m} of ${(ex.checklist || []).length} submitted so far.`}
            What you tick now is <b>added to that record</b> as its next submission, with the date received below. Only what is still missing is listed.`;
        }
        box.hidden = !ex;
        const ents = ex ? ex.checklist : entriesFor(r, o), items = ents.map((e) => e.item);
        if (ex && !missing(ex).length) { $('#f-list', bg).innerHTML = '<p class="ok-t">Everything for this period is already in. Nothing to add.</p>'; dueHint(); state(); decState(); return; }
        if (isGrouped(ents)) return groupedList(r, o, ents);
        const show = ents.map((e, k) => ({ e, k })).filter(({ e }) => !ex || !isIn(e));
        const many = show.length > LONG;
        $('#f-list', bg).innerHTML = (r.perOffice && !(o.lists && (o.lists[r.id] || []).length)
          ? `<p class="warn-t">No ${esc((r.lineLabel || 'line').toLowerCase())}s are listed for this office yet. Add them in Office Setup (${esc(r.code)}).</p>` : '')
          + (r.perOffice && (r.checklist || []).length ? `<small>Each ${esc((r.lineLabel || 'line').toLowerCase())} includes: ${esc(r.checklist.join(', '))}</small>` : '')
          + (many ? `<input class="input" id="f-find" placeholder="Search ${show.length} ${r.perOffice ? esc((r.lineLabel || 'line').toLowerCase()) + 's' : 'items'}">` : '')
          + `<div class="rcv-items${many ? ' long' : ''}">${show.map(({ e, k }) => `<label data-t="${esc(e.item.toLowerCase())}"><input type="checkbox" name="ck" value="${k}"> ${esc(e.item)}</label>`).join('')}</div>`
          + `<div class="btn-row"><button type="button" class="btn sm" id="f-all">Tick all</button>${many ? '<button type="button" class="btn sm" id="f-none">Untick all</button>' : ''}</div>`;
        $('#f-all', bg).onclick = () => { $$('input[name=ck]', bg).forEach((x) => { x.checked = true; }); state(); };
        if ($('#f-none', bg)) $('#f-none', bg).onclick = () => { $$('input[name=ck]', bg).forEach((x) => { x.checked = false; }); state(); };
        if ($('#f-find', bg)) $('#f-find', bg).oninput = () => { const v = $('#f-find', bg).value.trim().toLowerCase(); $$('.rcv-items label', bg).forEach((l) => { l.hidden = v && !l.dataset.t.includes(v); }); };
        $$('input[name=ck]', bg).forEach((x) => { x.onchange = state; });
        dueHint(); state(); decState();
      };
      // Reports with parts per line (e.g. BRS per bank account): 1) select the accounts that came in, 2) each opens to its parts.
      const groupedList = (r, o, ents) => {
        // With an existing record: accounts already complete are left out; the others show only their missing parts.
        const lines = linesOf(ents).filter(([, es]) => !ex || !es.every(isIn)).map(([l]) => l), lbl = (r.lineLabel || 'Line').toLowerCase(), many = lines.length > 8;
        const other = ents.map((e, k) => ({ ...e, k })).filter((e) => !(e.line && e.part) && (!ex || !isIn(e)));
        $('#f-list', bg).innerHTML = `<small>Each ${esc(lbl)} includes: ${esc(r.checklist.join(', '))}</small>
          <span class="legend">1. Select the ${esc(lbl)}s that came in${ex ? ` (${lines.length} still incomplete)` : ''}</span>
          ${many ? `<input class="input" id="f-find" placeholder="Search ${lines.length} ${esc(lbl)}s">` : ''}
          <div class="rcv-items acct-pick${many ? ' long' : ''}">${lines.map((l, li) => `<label data-t="${esc(l.toLowerCase())}"><input type="checkbox" name="acct" value="${li}"> ${esc(l)}</label>`).join('')}</div>
          <div class="btn-row"><button type="button" class="btn sm" id="f-sel-all">Select all</button><button type="button" class="btn sm" id="f-sel-none">Clear</button></div>
          <span class="legend">2. Tick the parts submitted for each ${esc(lbl)}</span>
          <div id="f-acc">${accordionHtml(ex ? ents : ents.map((e) => ({ ...e, ok: false })), { name: 'ck', hideAll: true, onlyMissing: !!ex, checked: () => false, naChecked: () => false })}<p class="hint" id="f-acc-none">Select a ${esc(lbl)} above.</p></div>
          ${other.length ? `<span class="legend">Also required</span><div class="rcv-items">${other.map((e) => `<label><input type="checkbox" name="ck" value="${e.k}"> ${esc(e.item)}</label>`).join('')}</div>` : ''}`;
        const accs = $$('details.acc', bg);
        const pick = () => {
          const on = new Set($$('input[name=acct]:checked', bg).map((x) => lines[+x.value]));
          accs.forEach((d) => { const show = on.has(d.dataset.line); if (!show) { $$('input[name=ck], input[name=ck-na]', d).forEach((x) => { x.checked = false; }); d.open = false; } d.hidden = !show; });
          $('#f-acc-none', bg).hidden = on.size > 0; updAcc(); state();
        };
        const updAcc = wireAccordions(bg, 'ck', () => state(), (d) => (ex ? ex.checklist.filter((c) => c.line === d.dataset.line && isIn(c)).length : 0));
        $$('input[name=acct]', bg).forEach((x) => { x.onchange = () => { pick(); const d = accs.find((a) => a.dataset.line === lines[+x.value]); if (x.checked && d) d.open = true; }; });
        $('#f-sel-all', bg).onclick = () => { $$('input[name=acct]', bg).forEach((x) => { if (!x.closest('label').hidden) x.checked = true; }); pick(); };
        $('#f-sel-none', bg).onclick = () => { $$('input[name=acct]', bg).forEach((x) => { x.checked = false; }); pick(); };
        if ($('#f-find', bg)) $('#f-find', bg).oninput = () => { const v = $('#f-find', bg).value.trim().toLowerCase(); $$('.acct-pick label', bg).forEach((l) => { l.hidden = v && !l.dataset.t.includes(v); }); };
        $$('.rcv-items:not(.acct-pick) input[name=ck]', bg).forEach((x) => { x.onchange = state; });
        dueHint(); state(); decState();
      };
      const dueHint = () => { const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value); const p = $('#f-per', bg).value; const d = r && p ? dueDate(r, p) : null;
        const when = new Date($('#f-date', bg).value || now);
        $('#f-due', bg).textContent = d ? `Due ${fmtDate(d)}${when > d ? ' · received late' : ' · on time'}` : ''; };
      const state = () => {
        if ($('#f-acc', bg)) {
          const accs = $$('details.acc', bg), sel = accs.filter((d) => !d.hidden);
          const full = sel.filter((d) => $$('input[name=ck]', d).every((x) => x.checked || ($(`input[name=ck-na][value="${x.value}"]`, d) || {}).checked)).length;
          const empty = sel.filter((d) => !$$('input[name=ck]', d).some((x) => x.checked)).length;
          const before = ex ? lineTally(ex.checklist).done.length : 0, total = before + accs.length;
          $('#f-state', bg).innerHTML = `<b class="${before + full === total ? 'ok-t' : 'warn-t'}">${before + full} of ${total} complete</b>${ex ? ` (${before} before + ${full} now)` : ''} · ${sel.length} selected`
            + (sel.length - full - empty ? ` · ${sel.length - full - empty} missing parts` : '') + (empty ? ` · <span class="warn-t">${empty} selected with no parts ticked</span>` : '')
            + ` · ${accs.length - sel.length} still not submitted`;
          return;
        }
        const all = $$('input[name=ck]', bg), ticked = all.filter((x) => x.checked).length, before = ex ? (ex.checklist || []).filter(isIn).length : 0, total = before + all.length;
        $('#f-state', bg).innerHTML = !all.length ? '' : before + ticked === total ? `<b class="ok-t">All ${total} submitted</b>`
          : `<b class="warn-t">${before + ticked} of ${total} submitted</b> · ${total - before - ticked} missing`;
      };
      // The decision at receipt: JO and OSA Staff always For Verification; auditors choose, except for bulk reports.
      const decState = () => {
        $('#f-dec', bg).hidden = !!ex;   // adding to an existing record keeps its status
        const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value);
        const bulk = !!(r && r.bulk);
        $$('input[name=rdec]', bg).forEach((x) => { x.closest('.rcv-type').hidden = bulk; });
        if (bulk) { const v = $('input[name=rdec][value=verify]', bg); if (v) v.checked = true; }
        const choice = $('input[name=rdec]:checked', bg)?.value || 'verify';
        if ($('#f-drem-box', bg)) { $('#f-drem-box', bg).hidden = choice === 'verify'; $('#f-dreq', bg).hidden = choice !== 'reject'; }
        $('#f-dec-hint', bg).textContent = bulk ? `${r.code} is a bulk report: it is always recorded For Verification, for the auditor to go through its contents.`
          : !auditor ? 'It will be recorded For Verification. An auditor accepts or rejects it.'
          : choice === 'verify' ? 'Recorded For Verification; you or another auditor accept or reject it later.' : '';
      };
      $$('input[name=rdec]', bg).forEach((x) => { x.onchange = decState; });
      const kindState = () => { const k = kind(); $('#rep-part', bg).hidden = k !== 'report'; $('#comm-part', bg).hidden = k !== 'comm'; };
      $$('input[name=kind]', bg).forEach((x) => { x.onchange = kindState; });
      $('#f-outside', bg).onchange = () => { const o = $('#f-outside', bg).checked; $('#f-outside-box', bg).hidden = !o; $('#f-mun', bg).disabled = o; $('#f-off', bg).disabled = o; };
      // Open on the municipality used last, or else the first one with offices ready to receive.
      let last = ''; try { last = localStorage.getItem('rms-last-mun') || ''; } catch (e) { /* ignore */ }
      const ready = scopes.find((s) => s.id === last) || scopes.find((s) => offs.some((o) => o.munId === s.id && o.code));
      if (ready) $('#f-mun', bg).value = ready.id;
      $('#f-mun', bg).onchange = () => { try { localStorage.setItem('rms-last-mun', $('#f-mun', bg).value); } catch (e) { /* ignore */ } fillOffices(); };
      $('#f-off', bg).onchange = fillReports; $('#f-rep', bg).onchange = fillPeriods; $('#f-per', bg).onchange = fillList; $('#f-date', bg).onchange = dueHint;
      // Picking a usual submitter fills in the designation right away (not on leaving the field).
      $('#f-by', bg).oninput = () => { const opt = [...$('#f-by-list', bg).options].find((x) => x.value === $('#f-by', bg).value); if (opt && !$('#f-des', bg).value) $('#f-des', bg).value = opt.textContent; };
      // Upload PDF to fill in (reports and communications). Scanned PDFs are read only when the receiver asks.
      let pdfFile = null;
      const applyPdf = async (allowOcr) => {
        const hint = $('#f-pdf-hint', bg), ocrBtn = $('#f-ocr', bg);
        ocrBtn.hidden = true;
        hint.textContent = allowOcr ? 'Reading the scanned pages… this can take a few seconds per page.' : 'Reading the PDF…';
        try {
          const got = await pdfToLines(pdfFile, { allowOcr, onProgress: (pr, page, of) => {
            if (page) hint.textContent = `Reading scanned page ${page} of ${of}…`; else if (pr) hint.textContent = hint.textContent.replace(/ \d+%$/, '') + ` ${Math.round(pr * 100)}%`; } });
          if (got.scanned && !allowOcr) { hint.textContent = 'This PDF is a scan (no text inside). The app can read the scanned pages; results may need checking.'; ocrBtn.hidden = false; return; }
          const d = parseDetails(got.lines, { reports: rms.reports.filter((r) => r.active !== false), offices: offs });
          if (!d.text.trim()) { hint.textContent = 'No readable text was found. Please type the details.'; return; }
          const filled = [];
          const isReport = !!d.report && !d.subject;
          $(`input[name=kind][value=${isReport ? 'report' : 'comm'}]`, bg).checked = true; kindState();
          if (d.office) {
            if (!isReport) { $('#f-outside', bg).checked = false; $('#f-outside', bg).onchange(); }
            $('#f-mun', bg).value = d.office.munId; fillOffices(); $('#f-off', bg).value = d.office.id; fillReports(); filled.push('office');
          } else if (!isReport && d.from) { $('#f-outside', bg).checked = true; $('#f-outside', bg).onchange(); $('#f-from', bg).value = d.from; filled.push('sender'); }
          if (isReport) {
            if ([...$('#f-rep', bg).options].some((o) => o.value === d.report.id)) { $('#f-rep', bg).value = d.report.id; fillPeriods(); filled.push('report'); }
            const per = [...$('#f-per', bg).options].find((o) => o.value === d.period || (d.period && o.value.startsWith(d.period)));
            if (per) { $('#f-per', bg).value = per.value; dueHint(); filled.push('period'); }
          } else {
            if (d.subject) { $('#f-subj', bg).value = d.subject; filled.push('subject'); }
            if (got.pages) $('#f-pages', bg).value = got.pages + ' page' + (got.pages > 1 ? 's' : '');
          }
          if (d.signatory) { $('#f-by', bg).value = d.signatory; filled.push('name'); }
          if (d.designation) $('#f-des', bg).value = d.designation;
          const rem = $('#f-rem', bg); if (!rem.value) rem.value = 'From PDF: ' + pdfFile.name + (got.scanned ? ' (scanned)' : '');
          hint.textContent = filled.length ? `Filled in ${filled.join(', ')} from ${pdfFile.name}${got.scanned ? ' (scanned – please check carefully)' : ''}. Please check before saving.`
            : `Could not find the details in ${pdfFile.name}. Please fill them in.`;
          if (isReport) hint.textContent += ' Tick the checklist yourself.';
        } catch (e) { hint.textContent = 'Could not read this PDF: ' + e.message; }
      };
      $('#f-pdf', bg).onchange = () => { const f = $('#f-pdf', bg).files[0]; if (!f) return; pdfFile = f; $('#f-pdf', bg).value = ''; applyPdf(false); };
      $('#f-ocr', bg).onclick = () => { if (pdfFile) applyPdf(true); };
      fillOffices(); kindState();
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save and Get Number', cls: 'primary', value: 'save', check: (bg) => {
      const kind = $('input[name=kind]:checked', bg).value;
      const outside = kind === 'comm' && $('#f-outside', bg).checked;
      const o = outside ? null : offs.find((x) => x.id === $('#f-off', bg).value);
      if (!outside && (!o || !o.code)) { toast('Choose a submitting office that has an office code.', 'bad'); return false; }
      const submittedBy = $('#f-by', bg).value.trim(), designation = $('#f-des', bg).value.trim();
      if (!submittedBy) { toast('Enter the name in Received From.', 'bad'); return false; }
      const when = readWhen($('#f-date', bg).value);
      if (when.err) { toast(when.err, 'bad'); return false; }
      const encodedAt = new Date().toISOString();
      const base = { kind, receivedAt: when.iso, encodedAt, receivedBy: by(refs), receivedByName: myName(refs), submittedBy, submittedDesignation: designation,
        remarks: $('#f-rem', bg).value.trim(), officeId: o ? o.id : '', officeCode: o ? o.code : '', teamId: o ? o.teamId : (refs.me?.data.teamIds || [])[0] || '', munId: o ? o.munId : '' };
      if (kind === 'report') {
        const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value);
        if (!r) { toast('This office has no report ticked. Tick its reports in Office Setup first.', 'bad'); return false; }
        const period = $('#f-per', bg).value;
        const ents = ex ? ex.checklist : entriesFor(r, o);
        if (!ents.length) { toast(`No ${(r.lineLabel || 'line').toLowerCase()}s are listed for this office yet. Add them in Office Setup.`, 'bad'); return false; }
        const ticked = new Set($$('input[name=ck]:checked', bg).map((x) => +x.value));
        const naSet = new Set($$('input[name=ck-na]:checked', bg).map((x) => +x.value));
        if (!ticked.size && !(ex && naSet.size)) { toast(ex && !missing(ex).length ? 'Everything for this period is already in.' : 'Tick at least one document received.', 'bad'); return false; }
        const bare = $$('details.acc', bg).find((d) => !d.hidden && !$$('input[name=ck], input[name=ck-na]', d).some((x) => x.checked));
        if (bare) { toast(`Tick the parts submitted for ${bare.dataset.line}, or unselect it.`, 'bad'); bare.open = true; return false; }
        if (ex) {   // added to the record already received for this period
          out = { addTo: ex, next: applyBatch(ex, [...ticked], [...naSet].filter((k) => !ticked.has(k)), when.iso, by(refs), myName(refs)) };
          return true;
        }
        const at = base.receivedAt;
        const checklist = ents.map((e, k) => ({ ...e, ok: ticked.has(k), at: ticked.has(k) ? at : '', ...(naSet.has(k) && !ticked.has(k) ? { na: true } : {}) }));
        const allIn = checklist.every(isIn);
        const yr = +period.slice(0, 4);
        const choice = auditor && !r.bulk ? ($('input[name=rdec]:checked', bg)?.value || 'verify') : 'verify';
        const dRem = $('#f-drem', bg) ? $('#f-drem', bg).value.trim() : '';
        if (choice === 'reject' && !dRem) { toast('Enter the reason for rejecting it.', 'bad'); return false; }
        out = { ...base, reportId: r.id, reportCode: r.code, period, checklist, ...(isGrouped(checklist) ? { lineLabel: r.lineLabel || 'Line' } : {}), ...trackingNo(rms, o, r.code, yr), ...(allIn ? { completedAt: at } : {}),
          status: choice === 'accept' ? 'accepted' : choice === 'reject' ? 'rejected' : 'verify',
          ...(choice === 'verify' ? {} : { decision: { action: choice, remarks: dRem, by: by(refs), byName: myName(refs), at: encodedAt } }) };
      } else {
        const subject = $('#f-subj', bg).value.trim();
        if (!subject) { toast('Enter the subject or a short description.', 'bad'); return false; }
        const fromOutside = outside ? $('#f-from', bg).value.trim() : '';
        if (outside && !fromOutside) { toast('Enter who it is from.', 'bad'); return false; }
        // Outside senders have no office code: their series uses OUT (e.g. OUT-2026-0004).
        const pseudo = o || { id: 'outside', code: 'OUT' };
        out = { ...base, officeId: o ? o.id : '', fromOutside, subject, pages: $('#f-pages', bg).value.trim(), status: 'received',
          ...trackingNo(rms, pseudo, '', new Date(when.iso).getFullYear()) };
      }
      return true;
    } }]
  });
  if (res !== 'save') return;
  if (out.addTo) {
    const id = out.addTo.id;
    await saveItem(id, out.next, by(refs));
    let saved = { id, ...out.next };
    if (!DEMO && navigator.onLine) { await syncNow(); const rec = await store.get('rms_items', id); if (rec && !rec.pending) saved = { id, ...unpackItem(rec.data) }; }
    const t = isGrouped(saved.checklist) ? lineTally(saved.checklist) : null, m = missing(saved).length;
    const again = await modal({
      title: 'Added · Same Tracking Number',
      body: `<div class="rcv-done"><small>ADDED TO</small><b>${esc(numberOf(saved))}</b></div>
        <p>${t ? `${t.done.length} of ${t.total} ${esc(((saved.lineLabel || 'account') + 's').toLowerCase())} complete now.` : `${(saved.checklist || []).length - m} of ${(saved.checklist || []).length} submitted now.`}${m ? '' : ' Everything is in.'}</p>
        <p>Print the slip again so the office gets an updated acknowledgment.</p>`,
      buttons: [{ label: 'Done', value: null }, { label: 'Receive Another', value: 'again' }, { label: 'Print Slip', cls: 'primary', value: 'slip' }]
    });
    if (again === 'slip') printSlip(refs, rms, saved);
    if (again === 'again') receiveForm(refs, { ...rms, items: rms.items.map((x) => (x.id === id ? saved : x)) });
    return;
  }
  const id = newId('rcv');
  await saveItem(id, out, by(refs));
  let saved = { id, ...out }, confirmed = DEMO;
  // Connected: the AMS database gives the tracking number, so two people receiving at once never share a number.
  if (!DEMO && navigator.onLine) {
    toast('Getting the tracking number from the AMS database…');
    for (let k = 0; k < 3 && !confirmed; k++) {
      const problems = await syncNow();
      const rec = await store.get('rms_items', id);
      if (!rec) { toast('Not saved: ' + (problems[0] || 'the database refused it.'), 'bad'); return; }
      if (!rec.pending) { saved = { id, ...unpackItem(rec.data) }; confirmed = true; }
    }
  }
  const again = await modal({
    title: confirmed ? 'Saved · Tracking Number' : 'Saved on This Computer · Number Not Yet Confirmed',
    body: `<div class="rcv-done ${confirmed ? '' : 'pend'}"><small>${confirmed ? 'TRACKING NUMBER' : 'NUMBER NOT YET CONFIRMED'}</small><b>${esc(numberOf(saved))}</b></div>
      <p>Status: ${statusPill(saved)}</p>
      ${confirmed ? `<p>Write this number on the RECEIVED stamp, then print the slip for the submitter.${isVerify(saved) ? ' An auditor will accept or reject it.' : ''}</p>`
        : `<p>No connection to the AMS database right now. It is saved on this computer and will be sent automatically; the number may still change when it is sent. Print the slip (Recently Received → Slip) once the number is confirmed.</p>`}`,
    buttons: [{ label: 'Done', value: null }, { label: 'Receive Another', value: 'again' }, ...(confirmed ? [{ label: 'Print Slip', cls: 'primary', value: 'slip' }] : [])]
  });
  if (again === 'slip') printSlip(refs, rms, saved);
  if (again === 'again') receiveForm(refs, { ...rms, items: [...rms.items, saved] });
}

/* ---------- auditor's decision ---------- */
async function decide(refs, rms, id) {
  const i = rms.items.find((x) => x.id === id);
  const off = visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).find((o) => o.id === i.officeId);
  let out = null;
  const res = await modal({
    title: 'Accept or Reject · ' + numberOf(i),
    body: `<p><b>${esc(off?.label || '')}</b> · ${esc(i.reportCode + ' · ' + periodLabel(i.period))}<br><small>Received ${esc(fmtDT(i.receivedAt))} by ${esc(i.receivedByName)} · received from ${esc(i.submittedBy)}${i.submittedDesignation ? ', ' + esc(i.submittedDesignation) : ''}</small></p>
      <div><span class="legend">Checklist · ${i.checklist.filter((c) => c.ok).length} of ${i.checklist.length} submitted</span>${checklistHtml(i)}</div>
      <div class="rcv-type"><label><input type="radio" name="dec" value="accept" checked> Accept${missing(i).length ? ' – missing documents to follow' : ''}</label><label><input type="radio" name="dec" value="reject"> Reject – return to the submitter</label></div>
      <div class="field"><label for="d-rem">Remarks <span id="d-req" hidden>(required for a rejection)</span></label><input class="input" id="d-rem" placeholder="e.g. Accepted; DVs to follow within 5 days"></div>`,
    onOpen: (bg) => { $$('input[name=dec]', bg).forEach((x) => { x.onchange = () => { $('#d-req', bg).hidden = x.value !== 'reject' || !x.checked; }; }); },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save Decision', cls: 'primary', value: 'save', check: (bg) => {
      const action = $('input[name=dec]:checked', bg).value, remarks = $('#d-rem', bg).value.trim();
      if (action === 'reject' && !remarks) { toast('Enter the reason for rejecting it.', 'bad'); return false; }
      out = { action, remarks }; return true;
    } }]
  });
  if (res !== 'save') return;
  const decision = { action: out.action, remarks: out.remarks, by: by(refs), byName: myName(refs), at: new Date().toISOString() };
  const { id: _x, _new: _n, ...data } = i;
  if (out.action === 'accept') {
    // Older records received before this rule may still need their tracking number.
    const t = data.trackingNo ? {} : trackingNo(rms, { id: i.officeId, code: i.officeCode }, i.reportCode, +i.period.slice(0, 4));
    await saveItem(id, { ...data, ...t, status: 'accepted', decision }, by(refs));
    toast(`Accepted · ${t.trackingNo || data.trackingNo}.`, 'ok');
  } else {
    await saveItem(id, { ...data, status: 'rejected', decision }, by(refs));
    toast('Rejected and recorded. The period still counts as not submitted.', 'ok');
  }
}

/* ---------- late documents ---------- */
async function addLate(refs, rms, id) {
  const i = rms.items.find((x) => x.id === id);
  let picked = null, pickedNa = [], when = null;
  const res = await modal({
    title: 'Add Late Documents · ' + numberOf(i),
    // Long lists (e.g. 75 bank accounts): only the missing ones, with a search box.
    body: (() => { const many = i.checklist.length > LONG, miss = i.checklist.map((c, k) => ({ c, k })).filter((x) => !x.c.ok);
      const dateField = `<div class="field" style="max-width:300px"><label for="l-date">Date received</label><input class="input" type="datetime-local" id="l-date" value="${localInput(new Date())}" max="${localInput(new Date())}">
        <span class="hint">Now, or the date on the RECEIVED stamp when encoding later.</span></div>`;
      if (isGrouped(i.checklist)) {
        // Per account: only accounts still lacking something, each opening to its missing parts.
        const t = lineTally(i.checklist), lbl = (i.lineLabel || 'account').toLowerCase(), other = miss.filter((x) => !(x.c.line && x.c.part));
        return `<p>Tick the missing parts that came in.</p>${dateField}
          <p><b>${t.done.length} of ${t.total} ${esc(lbl)}s complete.</b> ${t.part.length} missing parts · ${t.none.length} not submitted</p>
          ${t.part.length + t.none.length > 8 ? `<input class="input" id="l-find" placeholder="Search ${esc(lbl)}s">` : ''}
          <div class="acc-list">${accordionHtml(i.checklist, { name: 'late', onlyMissing: true, checked: () => false })}</div>
          ${other.length ? `<span class="legend">Also required</span><div class="rcv-items">${other.map(({ c, k }) => `<label><input type="checkbox" name="late" value="${k}"> ${esc(c.item)}</label>`).join('')}</div>` : ''}`;
      }
      return `<p>Tick the missing documents that came in.</p>
      <div class="field" style="max-width:300px"><label for="l-date">Date received</label><input class="input" type="datetime-local" id="l-date" value="${localInput(new Date())}" max="${localInput(new Date())}">
        <span class="hint">Now, or the date on the RECEIVED stamp when encoding later.</span></div>
      ${many ? `<p><b>${i.checklist.length - miss.length} of ${i.checklist.length} already submitted.</b> Missing: ${miss.length}</p><input class="input" id="l-find" placeholder="Search the missing ones">` : ''}
      <div class="rcv-list"><div class="rcv-items${many ? ' long' : ''}">${many ? miss.map(({ c, k }) => `<label data-t="${esc(c.item.toLowerCase())}"><input type="checkbox" name="late" value="${k}"> ${esc(c.item)}</label>`).join('')
        : i.checklist.map((c, k) => c.ok ? `<label class="done">✓ ${esc(c.item)} <small>received ${esc(fmtDate(c.at))}</small></label>` : `<label><input type="checkbox" name="late" value="${k}"> ${esc(c.item)}</label>`).join('')}</div>
        ${many ? '<div class="btn-row"><button type="button" class="btn sm" id="l-all">Tick all shown</button></div>' : ''}</div>`; })(),
    onOpen: (bg) => {
      if ($('#l-find', bg)) $('#l-find', bg).oninput = () => { const v = $('#l-find', bg).value.trim().toLowerCase(); $$('.rcv-items label[data-t], details.acc', bg).forEach((l) => { l.hidden = v && !l.dataset.t.includes(v); }); };
      if ($('details.acc', bg)) wireAccordions(bg, 'late', null, (d) => i.checklist.filter((c) => c.line === d.dataset.line && c.ok).length);
      if ($('#l-all', bg)) $('#l-all', bg).onclick = () => { $$('.rcv-items label', bg).forEach((l) => { if (!l.hidden) $('input', l).checked = true; }); };
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: 'save', check: (bg) => {
      picked = $$('input[name=late]:checked', bg).map((x) => +x.value);
      pickedNa = $$('input[name=late-na]:checked', bg).map((x) => +x.value);
      if (!picked.length && !pickedNa.length) { toast('Tick the documents received (or mark optional ones N/A).', 'bad'); return false; }
      when = readWhen($('#l-date', bg).value);
      if (when.err) { toast(when.err, 'bad'); return false; }
      return true; } }]
  });
  if (res !== 'save') return;
  // The status (For Verification / Accepted) stays; the history shows this as the next submission.
  const next = applyBatch(i, picked, pickedNa, when.iso, by(refs), myName(refs)), done = !!next.completedAt;
  await saveItem(id, next, by(refs));
  toast(done ? 'Saved. All documents are now submitted.' : 'Saved. Still missing some documents.', 'ok');
}

/* ---------- view one item ---------- */
async function viewItem(refs, rms, id) {
  const i = rms.items.find((x) => x.id === id);
  const off = visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).find((o) => o.id === i.officeId);
  const row = (k, v) => `<div class="kvrow"><small>${k}</small><span>${v}</span></div>`;
  modal({ title: numberOf(i), body: `${row('Status', statusPill(i))}${row('Office', esc(i.fromOutside || off?.label || ''))}
    ${i.kind === 'comm' ? row('Subject', esc(i.subject)) + (i.pages ? row('Pages', esc(i.pages)) : '') : row('Report', esc(i.reportCode + ' · ' + periodLabel(i.period)))}
    ${row('Received', esc(fmtDate(i.receivedAt) + ', ' + new Date(i.receivedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) + ' by ' + esc(i.receivedByName)
      + (encodedLater(i) ? `<br><small>Encoded later: ${esc(fmtDT(i.encodedAt))}</small>` : ''))}
    ${row('Received from', esc(i.submittedBy) + (i.submittedDesignation ? ', ' + esc(i.submittedDesignation) : ''))}
    ${i.pendingCode && i.trackingNo ? row('Pending code', `<span class="mono">${esc(i.pendingCode)}</span>`) : ''}
    ${i.checklist ? row('Checklist', checklistHtml(i)) : ''}
    ${row('History', historyHtml(i))}
    ${i.remarks ? row('Remarks', esc(i.remarks)) : ''}`,
    buttons: [{ label: 'Close', value: null, cls: canCorrect(refs) && !i._new ? '' : 'primary' }, ...(canCorrect(refs) && !i._new ? [{ label: 'Correct', cls: 'primary', value: 'fix' }] : [])] })
    .then((v) => { if (v === 'fix') correctItem(refs, rms, id); });
}

/* ---------- combining records of the same period (Admin only) ---------- */
// The earliest-received record keeps its tracking number. Every document submitted in any of them is kept with its own
// date (the earliest when it appears in more than one); the other records are removed and listed in the history.
async function combineItems(refs, rms, key) {
  if (!canCombine(refs)) return toast('Only the Admin can combine records.', 'bad');
  const offIds = new Set(visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).map((o) => o.id));
  const grp = duplicateGroups(rms, offIds).find((d) => d.key === key); if (!grp) return;
  const [keep, ...rest] = grp.list;
  const done = (i) => isGrouped(i.checklist) ? (() => { const t = lineTally(i.checklist); return `${t.done.length} of ${t.total} complete`; })() : `${(i.checklist || []).filter(isIn).length} of ${(i.checklist || []).length} submitted`;
  let why = '';
  const res = await modal({
    title: 'Combine Records',
    body: `<p>These were received as separate records for the same office, report and period:</p>
      <ul class="rcv-ck">${grp.list.map((i, k) => `<li class="${k ? 'miss' : 'ok'}"><b class="mono">${esc(numberOf(i))}</b> · received ${esc(fmtDate(i.receivedAt))} · ${esc(done(i))} · ${esc(statusText(i))}${k ? ' — will be removed' : ' — keeps its number'}</li>`).join('')}</ul>
      <div class="field"><label for="cb-why">Reason (required)</label><input class="input" id="cb-why" value="Same period encoded as separate receipts"></div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Combine', cls: 'primary', value: 'go', check: (bg) => { why = $('#cb-why', bg).value.trim(); if (!why) { toast('Enter the reason.', 'bad'); return false; } return true; } }]
  });
  if (res !== 'go') return;
  const first = grp.list[0].receivedAt;
  const ck = (keep.checklist || []).map((c) => ({ ...c }));
  const at = (c, i) => c.at || i.receivedAt;
  const merge = (c, i) => {
    const k = ck.findIndex((x) => x.item === c.item);
    const src = c.ok ? { ...c, at: at(c, i), byName: c.byName || i.receivedByName, encodedAt: c.encodedAt || i.encodedAt } : c;
    if (k < 0) { ck.push(src); return; }
    if (c.ok && (!ck[k].ok || at(c, i) < at(ck[k], keep))) ck[k] = { ...ck[k], ...src };
    else if (c.na && !ck[k].ok && !ck[k].na) ck[k] = { ...ck[k], na: true, naAt: c.naAt, naBy: c.naBy };
  };
  rest.forEach((i) => (i.checklist || []).forEach((c) => merge(c, i)));
  // The earliest date is the 1st submission; documents that came later are late documents.
  const checklist = ck.map((c) => (c.ok ? { ...c, late: c.at > first, ...(c.at > first ? { byName: c.byName || keep.receivedByName } : {}) } : c));
  const accepted = grp.list.find((i) => i.status === 'accepted' || i.status === 'complete');
  const { id: _x, _new: _n, ...data } = keep;
  const next = { ...data, checklist, status: accepted ? 'accepted' : keep.status, ...(accepted && accepted.decision ? { decision: accepted.decision } : {}),
    combined: [...(keep.combined || []), ...rest.map((i) => i.trackingNo || numberOf(i))],
    corrections: [...(keep.corrections || []), { at: new Date().toISOString(), by: by(refs), byName: myName(refs), reason: why, combine: true, changes: [`${rest.map(numberOf).join(', ')} combined into this record`] }] };
  if (checklist.every(isIn)) next.completedAt = checklist.reduce((m, c) => (c.ok && c.at > m ? c.at : m), ''); else delete next.completedAt;
  await saveItem(keep.id, next, by(refs));
  for (const i of rest) { const { id: _y, _new: _m, ...d } = i; await saveItem(i.id, { ...d, mergedInto: numberOf(keep) }, by(refs), { deleted: true }); }
  toast(`Combined into ${numberOf(keep)}.`, 'ok');
}

/* ---------- correcting a received record (Admin and SA only) ---------- */
// Fixes the encoder's mistakes: wrong ticks, date received, period, Received From, remarks. The tracking number never changes,
// and every correction is kept in the history with who made it, when, why and what changed.
async function correctItem(refs, rms, id) {
  if (!canCorrect(refs)) return toast('Only the Admin and the SA can correct a received record.', 'bad');
  const i = rms.items.find((x) => x.id === id);
  const r = rms.reports.find((x) => x.id === i.reportId);
  const isRep = i.kind !== 'comm';
  const y = +String(i.period || i.receivedAt).slice(0, 4);
  const periods = isRep && r ? [...periodsOf(r, y - 1), ...periodsOf(r, y), ...periodsOf(r, y + 1)].filter((p) => { const [py, pa] = span(p); return new Date(py, pa - 1, 1) <= new Date(); }) : [];
  if (isRep && i.period && !periods.includes(i.period)) periods.push(i.period);
  const ck = i.checklist || [], many = ck.length > LONG;
  let out = null;
  const res = await modal({
    title: 'Correct · ' + numberOf(i), wide: true,
    body: `<p class="hint">For mistakes in encoding. The tracking number stays the same, and this correction is kept in the history.</p>
      <div class="two"><div class="field"><label for="c-date">Date received</label><input class="input" type="datetime-local" id="c-date" value="${localInput(i.receivedAt)}" max="${localInput(new Date())}"></div>
        ${isRep ? `<div class="field"><label for="c-per">Period</label><select class="input" id="c-per">${periods.map((p) => `<option value="${p}" ${p === i.period ? 'selected' : ''}>${esc(periodLabel(p))}</option>`).join('')}</select></div>`
          : `<div class="field"><label for="c-subj">Subject</label><input class="input" id="c-subj" value="${esc(i.subject || '')}"></div>`}</div>
      ${isRep && isGrouped(ck) ? `<div><span class="legend">Checklist per ${esc((i.lineLabel || 'account').toLowerCase())} · tick what was actually submitted</span>
        <div class="rcv-list">${linesOf(ck).length > 8 ? '<input class="input" id="c-find" placeholder="Search">' : ''}
          <div class="acc-list">${accordionHtml(ck, { name: 'cfix' })}</div>
          ${ck.some((c) => !(c.line && c.part)) ? `<div class="rcv-items">${ck.map((c, k) => c.line && c.part ? '' : `<label><input type="checkbox" name="cfix" value="${k}" ${c.ok ? 'checked' : ''}> ${esc(c.item)}</label>`).join('')}</div>` : ''}</div>
        <span class="hint" id="c-state"></span></div>`
      : isRep ? `<div><span class="legend">Checklist · tick what was actually submitted</span>
        <div class="rcv-list">${many ? '<input class="input" id="c-find" placeholder="Search">' : ''}
          <div class="rcv-items${many ? ' long' : ''}">${ck.map((c, k) => `<label data-t="${esc(c.item.toLowerCase())}"><input type="checkbox" name="cfix" value="${k}" ${c.ok ? 'checked' : ''}> ${esc(c.item)}${c.ok && c.late ? ` <small>· late, ${esc(fmtDate(c.at))}</small>` : ''}</label>`).join('')}</div></div>
        <span class="hint" id="c-state"></span></div>` : ''}
      <div class="two"><div class="field"><label for="c-by">Received From (name)</label><input class="input" id="c-by" value="${esc(i.submittedBy || '')}"></div>
        <div class="field"><label for="c-des">Designation</label><input class="input" id="c-des" value="${esc(i.submittedDesignation || '')}"></div></div>
      <div class="field"><label for="c-rem">Remarks</label><input class="input" id="c-rem" value="${esc(i.remarks || '')}"></div>
      <div class="field"><label for="c-why">Reason for the correction (required)</label><input class="input" id="c-why" placeholder="e.g. Encoder ticked GF-1234 by mistake; not in the bundle"></div>`,
    onOpen: (bg) => {
      const st = () => { const all = $$('input[name=cfix]', bg); if (!all.length) return; const t = all.filter((x) => x.checked).length; $('#c-state', bg).textContent = `${t} of ${all.length} submitted`; };
      $$('input[name=cfix]', bg).forEach((x) => { x.onchange = st; }); st();
      if ($('#c-find', bg)) $('#c-find', bg).oninput = () => { const v = $('#c-find', bg).value.trim().toLowerCase(); $$('.rcv-items label[data-t], details.acc', bg).forEach((l) => { l.hidden = v && !l.dataset.t.includes(v); }); };
      if ($('details.acc', bg)) wireAccordions(bg, 'cfix', st);
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save Correction', cls: 'primary', value: 'save', check: (bg) => {
      const why = $('#c-why', bg).value.trim();
      if (!why) { toast('Enter the reason for the correction.', 'bad'); return false; }
      const when = readWhen($('#c-date', bg).value);
      if (when.err) { toast(when.err, 'bad'); return false; }
      const changes = [];
      const recAt = new Date(when.iso).getTime() === new Date(i.receivedAt).getTime() ? i.receivedAt : when.iso;
      if (recAt !== i.receivedAt) changes.push(`date received ${fmtDate(i.receivedAt)} → ${fmtDate(recAt)}`);
      const patch = { receivedAt: recAt };
      if (isRep) {
        const per = $('#c-per', bg).value; if (per !== i.period) { changes.push(`period ${periodLabel(i.period)} → ${periodLabel(per)}`); patch.period = per; }
        const on = new Set($$('input[name=cfix]:checked', bg).map((x) => +x.value));
        const naOn = new Set($$('input[name=cfix-na]:checked', bg).map((x) => +x.value));
        const added = [], removed = [], naAdd = [], naOff = [];
        patch.checklist = ck.map((c, k) => {
          let x = c;
          if (on.has(k) && !c.ok) { added.push(c.item); x = { ...c, ok: true, at: recAt, late: false }; }
          else if (!on.has(k) && c.ok) { removed.push(c.item); const { at: _a, late: _l, by: _b, byName: _bn, encodedAt: _e, ...keep } = c; x = { ...keep, ok: false, at: '' }; }
          // First-submission documents follow a corrected date received.
          else if (c.ok && !c.late) x = { ...c, at: recAt };
          if (c.optional) {
            const na = naOn.has(k) && !on.has(k);
            if (na && !c.na) { naAdd.push(c.item); x = { ...x, na: true }; }
            if (!na && c.na) { naOff.push(c.item); const { na: _n, naAt: _na, naBy: _nb, ...keep } = x; x = keep; }
          }
          return x;
        });
        const nm = (l) => l.length > 5 ? l.slice(0, 5).join(', ') + ` and ${l.length - 5} more` : l.join(', ');
        if (added.length) changes.push('ticked ' + nm(added));
        if (removed.length) changes.push('unticked ' + nm(removed));
        if (naAdd.length) changes.push('marked N/A ' + nm(naAdd));
        if (naOff.length) changes.push('no longer N/A ' + nm(naOff));
        const done = patch.checklist.every(isIn);
        patch.completedAt = done ? patch.checklist.reduce((m, c) => (c.at > m ? c.at : m), '') : '';
      } else {
        const subj = $('#c-subj', bg).value.trim(); if (!subj) { toast('Enter the subject.', 'bad'); return false; }
        if (subj !== i.subject) { changes.push('subject'); patch.subject = subj; }
      }
      const sb = $('#c-by', bg).value.trim(), sd = $('#c-des', bg).value.trim(), rem = $('#c-rem', bg).value.trim();
      if (!sb) { toast('Enter the name in Received From.', 'bad'); return false; }
      if (sb !== (i.submittedBy || '') || sd !== (i.submittedDesignation || '')) { changes.push(`received from ${i.submittedBy || '—'} → ${sb}`); patch.submittedBy = sb; patch.submittedDesignation = sd; }
      if (rem !== (i.remarks || '')) { changes.push('remarks'); patch.remarks = rem; }
      if (!changes.length) { toast('Nothing was changed.', 'bad'); return false; }
      out = { patch, changes, why }; return true;
    } }]
  });
  if (res !== 'save') return;
  const { id: _x, _new: _n, ...data } = i;
  const corrections = [...(i.corrections || []), { at: new Date().toISOString(), by: by(refs), byName: myName(refs), reason: out.why, changes: out.changes }];
  const next = { ...data, ...out.patch, corrections };
  if (!next.completedAt) delete next.completedAt;
  await saveItem(id, next, by(refs));
  toast('Correction saved and recorded in the history.', 'ok');
}

/* ---------- acknowledgment slip (quarter of a letter-size sheet) ---------- */
export function printSlip(refs, rms, i) {
  const off = visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).find((o) => o.id === i.officeId);
  const team = refs.team[i.teamId]?.data;
  const teamLine = team ? (team.officeCode ? 'Audit Team ' + team.officeCode : team.name) + ' · Province of Quirino' : 'Province of Quirino';
  const rep = rms.reports.find((r) => r.id === i.reportId);
  const okList = (i.checklist || []).filter((c) => c.ok), miss = (i.checklist || []).filter((c) => !c.ok);
  const pend = !i.trackingNo, ver = isVerify(i);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(numberOf(i))}</title><style>
    @page{size:letter; margin:0.4in} body{margin:0; font-family:Arial,Helvetica,sans-serif; color:#111}
    .slip{width:4.25in; min-height:5.5in; padding:0.22in 0.26in; box-sizing:border-box; font-size:9.5pt; line-height:1.3; display:flex; flex-direction:column; border:1px dashed #aaa}
    .hd{display:flex; align-items:center; gap:8px; border-bottom:1.5px solid #111; padding-bottom:6px} .hd img{width:0.5in; height:0.5in}
    .t1{font:700 10pt "Times New Roman",serif} .t2{font-size:8pt}
    .title{text-align:center; font-weight:700; letter-spacing:1.5px; font-size:10pt; margin:8px 0 6px}
    .no{text-align:center; border:1.5px ${pend ? 'dashed' : 'solid'} #111; padding:5px 4px; margin-bottom:8px} .no small{display:block; font-size:7.5pt; letter-spacing:1px} .no b{font:700 13pt Consolas,"Courier New",monospace}
    .kv{display:grid; grid-template-columns:0.95in 1fr; gap:2px 6px; font-size:9pt; margin-bottom:6px} .kv span:nth-child(odd){color:#444}
    .sec{font-weight:700; font-size:8.5pt; letter-spacing:.6px; border-bottom:1px solid #999; margin:6px 0 3px}
    ul{margin:0; padding:0; list-style:none; font-size:9pt} ul.cols{columns:2; column-gap:10px; font-size:8pt} ul.cols li{break-inside:avoid} li{padding:1px 0 1px 16px; position:relative} li.ok:before{content:"✓"; position:absolute; left:2px; font-weight:700} li.miss:before{content:"✗"; position:absolute; left:2px; font-weight:700}
    .note{font-size:8pt; border:1px solid #999; padding:4px 6px; margin-top:7px; background:#f6f6f6}
    .foot{margin-top:auto; padding-top:10px; display:flex; justify-content:space-between; font-size:8pt; gap:10px} .sig{border-top:1px solid #111; padding-top:2px; text-align:center; min-width:1.6in}
    @media print{ .slip{border:0} }</style></head><body><div class="slip">
    <div class="hd"><img src="img/coa-logo.png" alt=""><div><div class="t1">COMMISSION ON AUDIT</div><div class="t2">${esc(teamLine)}</div></div></div>
    <div class="title">ACKNOWLEDGMENT RECEIPT</div>
    <div class="no"><small>${pend ? 'PENDING CODE' : 'TRACKING NUMBER'}</small><b>${esc(numberOf(i))}</b></div>
    <div class="kv"><span>${i.fromOutside ? 'From' : 'Office'}</span><span><b>${esc(i.fromOutside || off?.label || '')}</b></span>
      ${i.kind === 'comm' ? `<span>Subject</span><span>${esc(i.subject)}${i.pages ? ' · ' + esc(i.pages) : ''}</span>` : `<span>Report</span><span>${esc((rep?.name || i.reportCode) + ' · ' + periodLabel(i.period))}</span>`}
      <span>Received</span><span>${esc(new Date(i.receivedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }))}</span>
      <span>Received from</span><span>${esc(i.submittedBy)}${i.submittedDesignation ? ', ' + esc(i.submittedDesignation) : ''}</span></div>
    ${i.kind === 'report' ? `${isGrouped(i.checklist) ? (() => {
      // Per account: complete count, accounts lacking parts (with the parts), accounts not submitted.
      const t = lineTally(i.checklist), lbl = ((i.lineLabel || 'account') + 's').toLowerCase(), lacks = (es) => es.filter((e) => !isIn(e)).map((e) => e.part).join(', ');
      const lateN = i.checklist.filter((c) => c.ok && c.late).length;
      return `<div class="sec">SUBMITTED</div><ul><li class="ok">${t.done.length} of ${t.total} ${esc(lbl)} complete${lateN ? ` (${lateN} late part${lateN > 1 ? 's' : ''})` : ''}</li></ul>
        ${t.part.length ? `<div class="sec">MISSING PARTS · ${t.part.length}</div><ul>${t.part.map(([l, es]) => `<li class="miss">${esc(l)} — no ${esc(lacks(es))}</li>`).join('')}</ul>` : ''}
        ${t.none.length ? `<div class="sec">NOT SUBMITTED · ${t.none.length}</div><ul class="${t.none.length > 14 ? 'cols' : ''}">${t.none.map(([l]) => `<li class="miss">${esc(l)}</li>`).join('')}</ul>` : ''}
        ${!t.part.length && !t.none.length ? '<div class="sec">MISSING</div><ul><li>None</li></ul>' : ''}`; })() : i.checklist.length > LONG
      // Long lists (e.g. 75 bank accounts): the count submitted, and the missing ones (the full list is in the app).
      ? `<div class="sec">SUBMITTED</div><ul><li class="ok">${okList.length} of ${i.checklist.length}${rep?.lineLabel ? ' ' + esc(rep.lineLabel.toLowerCase()) + 's' : ''}${okList.some((c) => c.late) ? ` (${okList.filter((c) => c.late).length} late)` : ''}</li></ul>
        <div class="sec">MISSING · ${miss.length}</div><ul class="${miss.length > 14 ? 'cols' : ''}">${miss.length ? miss.map((c) => `<li class="miss">${esc(c.item)}</li>`).join('') : '<li>None</li>'}</ul>`
      : `<div class="sec">SUBMITTED</div><ul>${okList.map((c) => `<li class="ok">${esc(c.item)}${c.late ? ' (' + esc(fmtDate(c.at)) + ')' : ''}</li>`).join('')}</ul>
      <div class="sec">MISSING</div><ul>${miss.length ? miss.map((c) => `<li class="miss">${esc(c.item)}</li>`).join('') : '<li>None</li>'}</ul>`}
      ${ver ? `<div class="note">Received subject to verification by the Auditor.${miss.length ? ' Please submit the missing documents, quoting this tracking number.' : ''}</div>`
        : miss.length && i.status !== 'rejected' ? `<div class="note">Please submit the missing documents, quoting this tracking number.</div>` : ''}
      ${i.status === 'rejected' && i.decision?.remarks ? `<div class="note">Rejected: ${esc(i.decision.remarks)}</div>` : ''}` : ''}
    <div class="foot"><span>Status: <b>${esc(statusText(i))}</b></span><div class="sig"><b>${esc(i.receivedByName)}</b><br>Received by</div></div>
    </div><script>window.onload=()=>{window.focus();window.print();}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to print the slip.', 'bad');
  w.document.open(); w.document.write(html.replace('src="img/coa-logo.png"', `src="${new URL('img/coa-logo.png', location.href).href}"`)); w.document.close();
}
