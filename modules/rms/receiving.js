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
const missing = (i) => (i.checklist || []).filter((c) => !c.ok);

// Auditors who accept or reject: ATL, Team Members, SA and Admin (not JO or OSA Staff).
export const canDecide = (refs) => hasRole(refs, 'atl', 'member', 'sa', 'admin');
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
export function itemsFor(r, o) {
  const base = r.perOffice ? ((o && o.lists && o.lists[r.id]) || []) : (r.checklist || []);
  return [...base, ...(o && o.note ? [o.note] : [])];
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
  const n1 = laterNote(i.receivedAt, i.encodedAt, i.receivedByName);
  ev.push({ at: i.receivedAt, who: n1 ? '' : i.receivedByName, text: `1st submission · ${have} of ${total} document${total === 1 ? '' : 's'} submitted${have === total ? ' · all submitted' : ''}${n1 ? ' (' + n1 + ')' : ''}` });
  const late = {};
  ck.filter((c) => c.ok && c.late).forEach((c) => { (late[c.at] = late[c.at] || []).push(c); });
  Object.keys(late).sort().forEach((at, k) => {
    const got = late[at]; have += got.length;
    const names = got.length > 5 ? got.slice(0, 5).map((c) => c.item).join('; ') + `; and ${got.length - 5} more` : got.map((c) => c.item).join('; ');
    const nl = laterNote(at, got[0].encodedAt, got[0].byName);
    ev.push({ at, who: nl ? '' : got[0].byName || '', text: `${ordinal(k + 2)} submission · +${got.length} late document${got.length > 1 ? 's' : ''} (${names})${have === total ? ' · all submitted' : ` · ${total - have} still missing`}${nl ? ' (' + nl + ')' : ''}` });
  });
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
        <span><small>${esc(fmtDT(i.receivedAt))}</small></span><span><small>${n - m.length} of ${n} submitted${m.length ? '<br>Missing: ' + (m.length > 3 ? m.slice(0, 3).map((c) => esc(c.item)).join('; ') + `; and ${m.length - 3} more` : m.map((c) => esc(c.item)).join('; ')) : ''}</small></span>
        <span class="acts"><button class="btn sm primary" data-decide="${i.id}">Accept / Reject</button><button class="btn sm" data-view="${i.id}">View</button></span></div>`; }).join('')}</section>` : ''}
    ${lacking.length ? `<section class="panel"><div class="panel-head"><h2>Accepted, Still Missing Documents · ${lacking.length}</h2></div>
      ${lacking.map((i) => row(i, `<button class="btn sm" data-late="${i.id}">Add Late Documents</button><button class="btn sm" data-view="${i.id}">View</button>`)).join('')}</section>` : ''}
    <section class="panel"><div class="panel-head"><h2>${jo ? 'Received by You' : 'Recently Received'}</h2></div>
      ${recent.length ? `<div class="t-head" style="${cols}"><span>Tracking No.</span><span>Office · Item</span><span>Received</span><span>Status</span><span></span></div>
        ${recent.map((i) => row(i, `<button class="btn sm" data-view="${i.id}">View</button>${i._new ? '' : `<button class="btn sm" data-slip="${i.id}">Slip</button>`}${lacksDocs(i) ? `<button class="btn sm" data-late="${i.id}">Late Docs</button>` : ''}`)).join('')}`
        : `<div class="empty"><b>${g === 'all' ? 'Nothing received yet' : 'Nothing received in this group'}</b>${g === 'all' ? 'Use + Receive Documents to record the first submission.' : 'Choose All groups to see everything.'}</div>`}</section>`;
}

export function wireReceiving(refs, rms, q, rerender) {
  $('#rcv-new').onclick = () => receiveForm(refs, rms);
  const gs = $('#rcv-g'); if (gs) gs.onchange = () => { location.hash = '#/rms/receiving' + (gs.value === 'all' ? '' : '?g=' + encodeURIComponent(gs.value)); };
  $$('[data-decide]').forEach((b) => { b.onclick = () => decide(refs, rms, b.dataset.decide); });
  $$('[data-late]').forEach((b) => { b.onclick = () => addLate(refs, rms, b.dataset.late); });
  $$('[data-view]').forEach((b) => { b.onclick = () => viewItem(refs, rms, b.dataset.view); });
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
  let out = null;
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
        const items = itemsFor(r, o);
        const many = items.length > LONG;
        $('#f-list', bg).innerHTML = (r.perOffice && !(o.lists && (o.lists[r.id] || []).length)
          ? `<p class="warn-t">No ${esc((r.lineLabel || 'line').toLowerCase())}s are listed for this office yet. Add them in Office Setup (${esc(r.code)}).</p>` : '')
          + (r.perOffice && (r.checklist || []).length ? `<small>Each ${esc((r.lineLabel || 'line').toLowerCase())} includes: ${esc(r.checklist.join(', '))}</small>` : '')
          + (many ? `<input class="input" id="f-find" placeholder="Search ${items.length} ${r.perOffice ? esc((r.lineLabel || 'line').toLowerCase()) + 's' : 'items'}">` : '')
          + `<div class="rcv-items${many ? ' long' : ''}">${items.map((t, k) => `<label data-t="${esc(t.toLowerCase())}"><input type="checkbox" name="ck" value="${k}"> ${esc(t)}</label>`).join('')}</div>`
          + `<div class="btn-row"><button type="button" class="btn sm" id="f-all">Tick all</button>${many ? '<button type="button" class="btn sm" id="f-none">Untick all</button>' : ''}</div>`;
        $('#f-all', bg).onclick = () => { $$('input[name=ck]', bg).forEach((x) => { x.checked = true; }); state(); };
        if ($('#f-none', bg)) $('#f-none', bg).onclick = () => { $$('input[name=ck]', bg).forEach((x) => { x.checked = false; }); state(); };
        if ($('#f-find', bg)) $('#f-find', bg).oninput = () => { const v = $('#f-find', bg).value.trim().toLowerCase(); $$('.rcv-items label', bg).forEach((l) => { l.hidden = v && !l.dataset.t.includes(v); }); };
        $$('input[name=ck]', bg).forEach((x) => { x.onchange = state; });
        dueHint(); state(); decState();
      };
      const dueHint = () => { const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value); const p = $('#f-per', bg).value; const d = r && p ? dueDate(r, p) : null;
        const when = new Date($('#f-date', bg).value || now);
        $('#f-due', bg).textContent = d ? `Due ${fmtDate(d)}${when > d ? ' · received late' : ' · on time'}` : ''; };
      const state = () => {
        const all = $$('input[name=ck]', bg), ticked = all.filter((x) => x.checked).length;
        $('#f-state', bg).innerHTML = !all.length ? '' : ticked === all.length ? `<b class="ok-t">All ${all.length} submitted</b>`
          : `<b class="warn-t">${ticked} of ${all.length} submitted</b> · ${all.length - ticked} missing`;
      };
      // The decision at receipt: JO and OSA Staff always For Verification; auditors choose, except for bulk reports.
      const decState = () => {
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
      $('#f-off', bg).onchange = fillReports; $('#f-rep', bg).onchange = fillPeriods; $('#f-per', bg).onchange = dueHint; $('#f-date', bg).onchange = dueHint;
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
        const items = itemsFor(r, o);
        if (!items.length) { toast(`No ${(r.lineLabel || 'line').toLowerCase()}s are listed for this office yet. Add them in Office Setup.`, 'bad'); return false; }
        const ticked = new Set($$('input[name=ck]:checked', bg).map((x) => +x.value));
        if (!ticked.size) { toast('Tick at least one document received.', 'bad'); return false; }
        const at = base.receivedAt;
        const checklist = items.map((t, k) => ({ item: t, ok: ticked.has(k), at: ticked.has(k) ? at : '' }));
        const allIn = checklist.every((c) => c.ok);
        const yr = +period.slice(0, 4);
        const choice = auditor && !r.bulk ? ($('input[name=rdec]:checked', bg)?.value || 'verify') : 'verify';
        const dRem = $('#f-drem', bg) ? $('#f-drem', bg).value.trim() : '';
        if (choice === 'reject' && !dRem) { toast('Enter the reason for rejecting it.', 'bad'); return false; }
        out = { ...base, reportId: r.id, reportCode: r.code, period, checklist, ...trackingNo(rms, o, r.code, yr), ...(allIn ? { completedAt: at } : {}),
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
  const id = newId('rcv');
  await store.save('rms_items', id, out, by(refs));
  let saved = { id, ...out }, confirmed = DEMO;
  // Connected: the AMS database gives the tracking number, so two people receiving at once never share a number.
  if (!DEMO && navigator.onLine) {
    toast('Getting the tracking number from the AMS database…');
    for (let k = 0; k < 3 && !confirmed; k++) {
      const problems = await syncNow();
      const rec = await store.get('rms_items', id);
      if (!rec) { toast('Not saved: ' + (problems[0] || 'the database refused it.'), 'bad'); return; }
      if (!rec.pending) { saved = { id, ...rec.data }; confirmed = true; }
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
    await store.save('rms_items', id, { ...data, ...t, status: 'accepted', decision }, by(refs));
    toast(`Accepted · ${t.trackingNo || data.trackingNo}.`, 'ok');
  } else {
    await store.save('rms_items', id, { ...data, status: 'rejected', decision }, by(refs));
    toast('Rejected and recorded. The period still counts as not submitted.', 'ok');
  }
}

/* ---------- late documents ---------- */
async function addLate(refs, rms, id) {
  const i = rms.items.find((x) => x.id === id);
  let picked = null, when = null;
  const res = await modal({
    title: 'Add Late Documents · ' + numberOf(i),
    // Long lists (e.g. 75 bank accounts): only the missing ones, with a search box.
    body: (() => { const many = i.checklist.length > LONG, miss = i.checklist.map((c, k) => ({ c, k })).filter((x) => !x.c.ok);
      return `<p>Tick the missing documents that came in.</p>
      <div class="field" style="max-width:300px"><label for="l-date">Date received</label><input class="input" type="datetime-local" id="l-date" value="${localInput(new Date())}" max="${localInput(new Date())}">
        <span class="hint">Now, or the date on the RECEIVED stamp when encoding later.</span></div>
      ${many ? `<p><b>${i.checklist.length - miss.length} of ${i.checklist.length} already submitted.</b> Missing: ${miss.length}</p><input class="input" id="l-find" placeholder="Search the missing ones">` : ''}
      <div class="rcv-list"><div class="rcv-items${many ? ' long' : ''}">${many ? miss.map(({ c, k }) => `<label data-t="${esc(c.item.toLowerCase())}"><input type="checkbox" name="late" value="${k}"> ${esc(c.item)}</label>`).join('')
        : i.checklist.map((c, k) => c.ok ? `<label class="done">✓ ${esc(c.item)} <small>received ${esc(fmtDate(c.at))}</small></label>` : `<label><input type="checkbox" name="late" value="${k}"> ${esc(c.item)}</label>`).join('')}</div>
        ${many ? '<div class="btn-row"><button type="button" class="btn sm" id="l-all">Tick all shown</button></div>' : ''}</div>`; })(),
    onOpen: (bg) => {
      if ($('#l-find', bg)) $('#l-find', bg).oninput = () => { const v = $('#l-find', bg).value.trim().toLowerCase(); $$('.rcv-items label', bg).forEach((l) => { l.hidden = v && !l.dataset.t.includes(v); }); };
      if ($('#l-all', bg)) $('#l-all', bg).onclick = () => { $$('.rcv-items label', bg).forEach((l) => { if (!l.hidden) $('input', l).checked = true; }); };
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: 'save', check: (bg) => {
      picked = $$('input[name=late]:checked', bg).map((x) => +x.value);
      if (!picked.length) { toast('Tick the documents received.', 'bad'); return false; }
      when = readWhen($('#l-date', bg).value);
      if (when.err) { toast(when.err, 'bad'); return false; }
      if (when.iso < i.receivedAt) { toast('The date cannot be before the first submission (' + fmtDate(i.receivedAt) + ').', 'bad'); return false; }
      return true; } }]
  });
  if (res !== 'save') return;
  const at = when.iso, encodedAt = new Date().toISOString();
  const checklist = i.checklist.map((c, k) => picked.includes(k) ? { ...c, ok: true, at, encodedAt, late: true, by: by(refs), byName: myName(refs) } : c);
  const done = checklist.every((c) => c.ok);
  const { id: _x, _new: _n, ...data } = i;
  // The status (For Verification / Accepted) stays; the history shows this as the next submission.
  const lastIn = checklist.reduce((m, c) => (c.at > m ? c.at : m), '');
  await store.save('rms_items', id, { ...data, checklist, ...(done ? { completedAt: lastIn } : {}) }, by(refs));
  toast(done ? 'Saved. All documents are now submitted.' : 'Saved. Still missing some documents.', 'ok');
}

/* ---------- view one item ---------- */
function viewItem(refs, rms, id) {
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
    ${i.remarks ? row('Remarks', esc(i.remarks)) : ''}` });
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
    ${i.kind === 'report' ? `${i.checklist.length > LONG
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
