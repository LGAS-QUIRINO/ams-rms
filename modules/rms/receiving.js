// Records Management · Receiving (agreed 17–18 Oct 2026).
// Report Submission or Communication → checklist → tracking number (complete) or pending code (incomplete, for the auditor to
// accept or reject) → small acknowledgment slip. Late documents are added to the same tracking number with their dates.
import { store, newId } from '../../js/store.js';
import { esc, pill, modal, toast, $, $$ } from '../../js/ui.js';
import { pdfToLines, parseDetails } from './pdfread.js';
import { scopesFor, visibleOffices, periodsOf, periodLabel, dueDate, span, fmtDT, fmtDate, jobOrderOnly, hasRole } from './rms.js';

const by = (refs) => refs.me?.data.email || '';
const myName = (refs) => refs.me?.data.name || '';
const missing = (i) => (i.checklist || []).filter((c) => !c.ok);

// Who decides on incomplete submissions: ATL, Team Members, SA and Admin (not JO or OSA Staff).
export const canDecide = (refs) => hasRole(refs, 'atl', 'member', 'sa', 'admin');

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
// Pending codes for incomplete submissions: their own series per office, so tracking numbers stay for accepted ones only.
function pendingCode(rms, office, reportCode) {
  const n = Math.max(0, ...rms.items.filter((i) => i.officeId === office.id && i.pendingSeries).map((i) => i.pendingSeries)) + 1;
  return { pendingCode: `${office.code}-${reportCode}-P-${String(n).padStart(4, '0')}`, pendingSeries: n };
}
export const numberOf = (i) => i.trackingNo || i.pendingCode || '';

export function statusPill(i) {
  if (i.kind === 'comm') return pill('Received', 'blue');
  if (i.status === 'complete') return pill('Complete', 'ok');
  if (i.status === 'pending') return pill('Pending acceptance', 'warn');
  if (i.status === 'accepted') return pill('Accepted – incomplete', 'warn');
  if (i.status === 'rejected') return pill('Rejected', 'bad');
  return pill(i.status || '');
}

/* ================= Receiving page ================= */
export function receivingHtml(refs, rms, q) {
  const scopes = scopesFor(refs);
  if (!scopes.length) return `<div class="msg bad">No team is assigned to you yet. Ask the Admin to set your team in Users &amp; Roles.</div>`;
  const offs = visibleOffices(refs, rms, scopes.map((s) => s.id));
  const offIds = new Set(offs.map((o) => o.id));
  const jo = jobOrderOnly(refs);
  const teams = refs.me ? (refs.me.data.teamIds || []) : [];
  const mine = rms.items.filter((i) => (offIds.has(i.officeId) || (!i.officeId && (teams.includes(i.teamId) || hasRole(refs, 'admin', 'sa', 'osa')))) && (!jo || i.receivedBy === by(refs)));
  const recent = [...mine].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 15);
  const pending = canDecide(refs) ? rms.items.filter((i) => offIds.has(i.officeId) && i.status === 'pending') : [];
  const lacking = rms.items.filter((i) => offIds.has(i.officeId) && i.status === 'accepted');
  const off = (id) => offs.find((o) => o.id === id);
  const rep = (id) => rms.reports.find((r) => r.id === id);
  const what = (i) => i.kind === 'comm' ? 'Communication · ' + esc(i.subject || '') : esc((rep(i.reportId)?.code || '') + ' · ' + periodLabel(i.period));
  const cols = 'grid-template-columns:minmax(190px,1.2fr) minmax(170px,1fr) 120px 150px 150px';
  const row = (i, acts) => `<div class="t-row" style="${cols}"><span class="mono"><b>${esc(numberOf(i))}</b></span>
    <span>${esc(i.kind === 'comm' && !i.officeId ? i.fromOutside : off(i.officeId)?.label || '')}<br><small>${what(i)}</small></span>
    <span><small>${esc(fmtDT(i.receivedAt))}</small></span><span>${statusPill(i)}</span><span class="acts">${acts}</span></div>`;
  return `<div class="hello"><div><h1>Receiving</h1><p>Record what the offices submit. Complete submissions get a tracking number; incomplete ones get a pending code for the auditor to accept or reject.</p></div>
      <button class="btn primary" type="button" id="rcv-new">+ Receive Documents</button></div>
    ${pending.length ? `<section class="panel"><div class="panel-head"><h2>Waiting for the Auditor's Decision · ${pending.length}</h2></div>
      <div class="t-head" style="${cols}"><span>Pending Code</span><span>Office · Report</span><span>Received</span><span>Missing</span><span></span></div>
      ${pending.map((i) => `<div class="t-row" style="${cols}"><span class="mono"><b>${esc(i.pendingCode)}</b></span><span>${esc(off(i.officeId)?.label || '')}<br><small>${what(i)}</small></span>
        <span><small>${esc(fmtDT(i.receivedAt))}</small></span><span><small>${missing(i).map((c) => esc(c.item)).join('; ')}</small></span>
        <span class="acts"><button class="btn sm primary" data-decide="${i.id}">Accept / Reject</button></span></div>`).join('')}</section>` : ''}
    ${lacking.length ? `<section class="panel"><div class="panel-head"><h2>Accepted, Still Missing Documents · ${lacking.length}</h2></div>
      ${lacking.map((i) => row(i, `<button class="btn sm" data-late="${i.id}">Add Late Documents</button>`)).join('')}</section>` : ''}
    <section class="panel"><div class="panel-head"><h2>${jo ? 'Received by You' : 'Recently Received'}</h2></div>
      ${recent.length ? `<div class="t-head" style="${cols}"><span>Tracking No. / Pending Code</span><span>Office · Item</span><span>Received</span><span>Status</span><span></span></div>
        ${recent.map((i) => row(i, `<button class="btn sm" data-view="${i.id}">View</button><button class="btn sm" data-slip="${i.id}">Slip</button>`)).join('')}`
        : '<div class="empty"><b>Nothing received yet</b>Use + Receive Documents to record the first submission.</div>'}</section>`;
}

export function wireReceiving(refs, rms, q, rerender) {
  $('#rcv-new').onclick = () => receiveForm(refs, rms);
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
      </div>
      <div id="comm-part" hidden>

        <div class="field"><label><input type="checkbox" id="f-outside"> From outside (e.g. COA Regional Office II), not one of the offices</label></div>
        <div class="field" id="f-outside-box" hidden><label for="f-from">From</label><input class="input" id="f-from" placeholder="e.g. COA Regional Office II"></div>
        <div class="field"><label for="f-subj">Subject / Description</label><input class="input" id="f-subj" placeholder="e.g. Letter on the conduct of exit conference"></div>
        <div class="field" style="max-width:220px"><label for="f-pages">Pages / Attachments (optional)</label><input class="input" id="f-pages" placeholder="e.g. 3 pages"></div>
      </div>
      <div class="two"><div class="field"><label for="f-by">Received From (name)</label><input class="input" id="f-by" list="f-by-list" placeholder="e.g. Juan P. Reyes"><datalist id="f-by-list"></datalist></div>
        <div class="field"><label for="f-des">Designation</label><input class="input" id="f-des" placeholder="e.g. Barangay Treasurer"></div></div>
      <div class="field"><label for="f-rem">Remarks (optional)</label><input class="input" id="f-rem"></div>
      <p class="hint">Received by <b>${esc(myName(refs))}</b> · ${esc(fmtDT(now))} (recorded automatically)</p>`,
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
        $('#f-rep', bg).innerHTML = reps.map((r) => `<option value="${r.id}">${esc(r.code + ' · ' + r.name)}</option>`).join('') || '<option value="">No reports ticked for this office</option>';
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
        const items = [...(r.checklist || []), ...(o.note ? [o.note] : [])];
        $('#f-list', bg).innerHTML = items.map((t, k) => `<label><input type="checkbox" name="ck" value="${k}"> ${esc(t)}</label>`).join('')
          + `<div class="btn-row"><button type="button" class="btn sm" id="f-all">Tick all</button></div>`;
        $('#f-all', bg).onclick = () => { $$('input[name=ck]', bg).forEach((x) => { x.checked = true; }); state(); };
        $$('input[name=ck]', bg).forEach((x) => { x.onchange = state; });
        dueHint(); state();
      };
      const dueHint = () => { const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value); const p = $('#f-per', bg).value; const d = r && p ? dueDate(r, p) : null;
        $('#f-due', bg).textContent = d ? `Due ${fmtDate(d)}${now > d ? ' · this is late' : ''}` : ''; };
      const state = () => {
        const all = $$('input[name=ck]', bg), ticked = all.filter((x) => x.checked).length;
        $('#f-state', bg).innerHTML = !all.length ? '' : ticked === all.length ? '<b class="ok-t">Complete</b> · a tracking number will be given.'
          : `<b class="warn-t">Incomplete</b> (${all.length - ticked} missing) · a pending code will be given for the auditor to accept or reject.`;
      };
      const kindState = () => { const k = kind(); $('#rep-part', bg).hidden = k !== 'report'; $('#comm-part', bg).hidden = k !== 'comm'; };
      $$('input[name=kind]', bg).forEach((x) => { x.onchange = kindState; });
      $('#f-outside', bg).onchange = () => { const o = $('#f-outside', bg).checked; $('#f-outside-box', bg).hidden = !o; $('#f-mun', bg).disabled = o; $('#f-off', bg).disabled = o; };
      // Open on the municipality used last, or else the first one with offices ready to receive.
      let last = ''; try { last = localStorage.getItem('rms-last-mun') || ''; } catch (e) { /* ignore */ }
      const ready = scopes.find((s) => s.id === last) || scopes.find((s) => offs.some((o) => o.munId === s.id && o.code));
      if (ready) $('#f-mun', bg).value = ready.id;
      $('#f-mun', bg).onchange = () => { try { localStorage.setItem('rms-last-mun', $('#f-mun', bg).value); } catch (e) { /* ignore */ } fillOffices(); };
      $('#f-off', bg).onchange = fillReports; $('#f-rep', bg).onchange = fillPeriods; $('#f-per', bg).onchange = dueHint;
      $('#f-by', bg).onchange = () => { const opt = [...$('#f-by-list', bg).options].find((x) => x.value === $('#f-by', bg).value); if (opt && !$('#f-des', bg).value) $('#f-des', bg).value = opt.textContent; };
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
      const base = { kind, receivedAt: new Date().toISOString(), receivedBy: by(refs), receivedByName: myName(refs), submittedBy, submittedDesignation: designation,
        remarks: $('#f-rem', bg).value.trim(), officeId: o ? o.id : '', officeCode: o ? o.code : '', teamId: o ? o.teamId : (refs.me?.data.teamIds || [])[0] || '', munId: o ? o.munId : '' };
      if (kind === 'report') {
        const r = rms.reports.find((x) => x.id === $('#f-rep', bg).value);
        if (!r) { toast('This office has no report ticked. Tick its reports in Office Setup first.', 'bad'); return false; }
        const period = $('#f-per', bg).value;
        const items = [...(r.checklist || []), ...(o.note ? [o.note] : [])];
        const ticked = new Set($$('input[name=ck]:checked', bg).map((x) => +x.value));
        if (!ticked.size) { toast('Tick at least one document received.', 'bad'); return false; }
        const at = base.receivedAt;
        const checklist = items.map((t, k) => ({ item: t, ok: ticked.has(k), at: ticked.has(k) ? at : '' }));
        const complete = checklist.every((c) => c.ok);
        const yr = +period.slice(0, 4);
        out = { ...base, reportId: r.id, reportCode: r.code, period, checklist, status: complete ? 'complete' : 'pending',
          ...(complete ? { ...trackingNo(rms, o, r.code, yr), completedAt: at } : pendingCode(rms, o, r.code)) };
      } else {
        const subject = $('#f-subj', bg).value.trim();
        if (!subject) { toast('Enter the subject or a short description.', 'bad'); return false; }
        const fromOutside = outside ? $('#f-from', bg).value.trim() : '';
        if (outside && !fromOutside) { toast('Enter who it is from.', 'bad'); return false; }
        // Outside senders have no office code: their series uses OUT (e.g. OUT-2026-0004).
        const pseudo = o || { id: 'outside', code: 'OUT' };
        out = { ...base, officeId: o ? o.id : '', fromOutside, subject, pages: $('#f-pages', bg).value.trim(), status: 'received',
          ...trackingNo(rms, pseudo, '', new Date().getFullYear()) };
      }
      return true;
    } }]
  });
  if (res !== 'save') return;
  const id = newId('rcv');
  await store.save('rms_items', id, out, by(refs));
  const saved = { id, ...out };
  const again = await modal({
    title: out.trackingNo ? 'Saved · Tracking Number' : 'Saved · Pending Code',
    body: `<div class="rcv-done ${out.trackingNo ? '' : 'pend'}"><small>${out.trackingNo ? 'TRACKING NUMBER' : 'PENDING CODE'}</small><b>${esc(numberOf(out))}</b></div>
      <p>${out.trackingNo ? 'Write this number on the RECEIVED stamp, then print the slip for the submitter.' : 'Incomplete. Write this code on the RECEIVED stamp and print the slip. The auditor will accept or reject it; a tracking number is given once accepted.'}</p>`,
    buttons: [{ label: 'Done', value: null }, { label: 'Receive Another', value: 'again' }, { label: 'Print Slip', cls: 'primary', value: 'slip' }]
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
    title: 'Accept or Reject · ' + i.pendingCode,
    body: `<p><b>${esc(off?.label || '')}</b> · ${esc(i.reportCode + ' · ' + periodLabel(i.period))}<br><small>Received ${esc(fmtDT(i.receivedAt))} by ${esc(i.receivedByName)} · received from ${esc(i.submittedBy)}${i.submittedDesignation ? ', ' + esc(i.submittedDesignation) : ''}</small></p>
      <div><span class="legend">Checklist</span><ul class="rcv-ck">${i.checklist.map((c) => `<li class="${c.ok ? 'ok' : 'miss'}">${esc(c.item)}</li>`).join('')}</ul></div>
      <div class="rcv-type"><label><input type="radio" name="dec" value="accept" checked> Accept – give it a tracking number (missing documents to follow)</label><label><input type="radio" name="dec" value="reject"> Reject – return to the submitter</label></div>
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
  const { id: _x, ...data } = i;
  if (out.action === 'accept') {
    const t = trackingNo(rms, { id: i.officeId, code: i.officeCode }, i.reportCode, +i.period.slice(0, 4));
    await store.save('rms_items', id, { ...data, ...t, status: 'accepted', decision }, by(refs));
    toast(`Accepted. Tracking number ${t.trackingNo}.`, 'ok');
  } else {
    await store.save('rms_items', id, { ...data, status: 'rejected', decision }, by(refs));
    toast('Rejected and recorded. The period still counts as not submitted.', 'ok');
  }
}

/* ---------- late documents ---------- */
async function addLate(refs, rms, id) {
  const i = rms.items.find((x) => x.id === id);
  let picked = null;
  const res = await modal({
    title: 'Add Late Documents · ' + i.trackingNo,
    body: `<p>Tick the missing documents received now. Today's date is recorded for each.</p>
      <div class="rcv-list">${i.checklist.map((c, k) => c.ok ? `<label class="done">✓ ${esc(c.item)} <small>received ${esc(fmtDate(c.at))}</small></label>` : `<label><input type="checkbox" name="late" value="${k}"> ${esc(c.item)}</label>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: 'save', check: (bg) => {
      picked = $$('input[name=late]:checked', bg).map((x) => +x.value);
      if (!picked.length) { toast('Tick the documents received.', 'bad'); return false; } return true; } }]
  });
  if (res !== 'save') return;
  const at = new Date().toISOString();
  const checklist = i.checklist.map((c, k) => picked.includes(k) ? { ...c, ok: true, at, late: true, by: by(refs) } : c);
  const done = checklist.every((c) => c.ok);
  const { id: _x, ...data } = i;
  await store.save('rms_items', id, { ...data, checklist, status: done ? 'complete' : 'accepted', ...(done ? { completedAt: at } : {}) }, by(refs));
  toast(done ? 'All documents received. Now complete.' : 'Saved. Still missing some documents.', 'ok');
}

/* ---------- view one item ---------- */
function viewItem(refs, rms, id) {
  const i = rms.items.find((x) => x.id === id);
  const off = visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).find((o) => o.id === i.officeId);
  const row = (k, v) => `<div class="kvrow"><small>${k}</small><span>${v}</span></div>`;
  modal({ title: numberOf(i), body: `${row('Status', statusPill(i))}${row('Office', esc(i.fromOutside || off?.label || ''))}
    ${i.kind === 'comm' ? row('Subject', esc(i.subject)) + (i.pages ? row('Pages', esc(i.pages)) : '') : row('Report', esc(i.reportCode + ' · ' + periodLabel(i.period)))}
    ${row('Received', esc(fmtDT(i.receivedAt)) + ' by ' + esc(i.receivedByName))}
    ${row('Received from', esc(i.submittedBy) + (i.submittedDesignation ? ', ' + esc(i.submittedDesignation) : ''))}
    ${i.pendingCode && i.trackingNo ? row('Pending code', `<span class="mono">${esc(i.pendingCode)}</span>`) : ''}
    ${i.checklist ? row('Checklist', `<ul class="rcv-ck">${i.checklist.map((c) => `<li class="${c.ok ? 'ok' : 'miss'}">${esc(c.item)}${c.late ? ` <small>· late, ${esc(fmtDate(c.at))}</small>` : ''}</li>`).join('')}</ul>`) : ''}
    ${i.decision ? row('Decision', `${i.decision.action === 'accept' ? 'Accepted' : 'Rejected'} by ${esc(i.decision.byName)} · ${esc(fmtDT(i.decision.at))}${i.decision.remarks ? '<br><small>' + esc(i.decision.remarks) + '</small>' : ''}`) : ''}
    ${i.remarks ? row('Remarks', esc(i.remarks)) : ''}` });
}

/* ---------- acknowledgment slip (quarter of a letter-size sheet) ---------- */
export function printSlip(refs, rms, i) {
  const off = visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).find((o) => o.id === i.officeId);
  const team = refs.team[i.teamId]?.data;
  const teamLine = team ? (team.officeCode ? 'Audit Team ' + team.officeCode : team.name) + ' · Province of Quirino' : 'Province of Quirino';
  const rep = rms.reports.find((r) => r.id === i.reportId);
  const okList = (i.checklist || []).filter((c) => c.ok), miss = (i.checklist || []).filter((c) => !c.ok);
  const pend = !i.trackingNo;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(numberOf(i))}</title><style>
    @page{size:letter; margin:0.4in} body{margin:0; font-family:Arial,Helvetica,sans-serif; color:#111}
    .slip{width:4.25in; min-height:5.5in; padding:0.22in 0.26in; box-sizing:border-box; font-size:9.5pt; line-height:1.3; display:flex; flex-direction:column; border:1px dashed #aaa}
    .hd{display:flex; align-items:center; gap:8px; border-bottom:1.5px solid #111; padding-bottom:6px} .hd img{width:0.5in; height:0.5in}
    .t1{font:700 10pt "Times New Roman",serif} .t2{font-size:8pt}
    .title{text-align:center; font-weight:700; letter-spacing:1.5px; font-size:10pt; margin:8px 0 6px}
    .no{text-align:center; border:1.5px ${pend ? 'dashed' : 'solid'} #111; padding:5px 4px; margin-bottom:8px} .no small{display:block; font-size:7.5pt; letter-spacing:1px} .no b{font:700 13pt Consolas,"Courier New",monospace}
    .kv{display:grid; grid-template-columns:0.95in 1fr; gap:2px 6px; font-size:9pt; margin-bottom:6px} .kv span:nth-child(odd){color:#444}
    .sec{font-weight:700; font-size:8.5pt; letter-spacing:.6px; border-bottom:1px solid #999; margin:6px 0 3px}
    ul{margin:0; padding:0; list-style:none; font-size:9pt} li{padding:1px 0 1px 16px; position:relative} li.ok:before{content:"✓"; position:absolute; left:2px; font-weight:700} li.miss:before{content:"✗"; position:absolute; left:2px; font-weight:700}
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
    ${i.kind === 'report' ? `<div class="sec">RECEIVED</div><ul>${okList.map((c) => `<li class="ok">${esc(c.item)}${c.late ? ' (' + esc(fmtDate(c.at)) + ')' : ''}</li>`).join('')}</ul>
      <div class="sec">MISSING</div><ul>${miss.length ? miss.map((c) => `<li class="miss">${esc(c.item)}</li>`).join('') : '<li>None</li>'}</ul>
      ${pend ? `<div class="note">Incomplete. Subject to the Auditor's acceptance. Please submit the missing documents; a tracking number is given once accepted.</div>` : ''}` : ''}
    <div class="foot"><span>Status: <b>${i.kind === 'comm' ? 'Received' : i.status === 'complete' ? 'Complete' : i.status === 'rejected' ? 'Rejected' : 'Incomplete'}</b></span><div class="sig"><b>${esc(i.receivedByName)}</b><br>Received by</div></div>
    </div><script>window.onload=()=>{window.focus();window.print();}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups for this site to print the slip.', 'bad');
  w.document.open(); w.document.write(html.replace('src="img/coa-logo.png"', `src="${new URL('img/coa-logo.png', location.href).href}"`)); w.document.close();
}
