// Records Management module (AMS). Screens: Setup (Report Library, Office Setup). Other parts are added one at a time.
// Designs approved 17 Oct 2026.
import { store, newId } from '../../js/store.js';
import { ROLE_NAMES } from '../../js/seed.js';
import { esc, pill, modal, toast, bottomBand, $, $$ } from '../../js/ui.js';
import { roleLine } from '../../js/views/admin.js';

// Load this module's look once.
if (!document.querySelector('link[data-rms]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'modules/rms/rms.css'; l.dataset.rms = '1'; document.head.appendChild(l);
}

const TABS = [
  ['monitor', 'Submission Monitor', false], ['receiving', 'Receiving', false], ['logbook', 'Logbook', false],
  ['records', 'Records &amp; Storage', false], ['borrow', 'Borrow Log', false], ['setup', 'Setup', true]
];
const FREQ = ['Monthly', 'Quarterly', 'Semi-annual', 'Annual', 'As needed'];
const byName = (a, b) => a.name.localeCompare(b.name);
const hasRole = (refs, ...r) => !!refs.me && (refs.me.data.roles || []).some((x) => r.includes(x));
const by = (refs) => refs.me?.data.email || '';

/* ---------- who may do what ---------- */
const canEditLibrary = (refs) => hasRole(refs, 'admin', 'osa');
const seesAllTeams = (refs) => hasRole(refs, 'admin', 'sa', 'osa');
function myTeams(refs) {
  if (seesAllTeams(refs)) return refs.teams.map((t) => t.id);
  return refs.me ? (refs.me.data.teamIds || []) : [];
}
// Office codes and reports per office: ATL and Team Members of that team (members may be limited to ticked municipalities), SA and Admin.
function canEditMun(refs, munTeamId, munId) {
  if (hasRole(refs, 'admin', 'sa')) return true;
  const d = refs.me?.data; if (!d || !(d.teamIds || []).includes(munTeamId)) return false;
  if ((d.roles || []).includes('atl')) return true;
  if ((d.roles || []).includes('member')) return !(d.munIds || []).length || d.munIds.includes(munId);
  return false;
}

/* ---------- data ---------- */
async function loadRms() {
  const [reports, offices] = await Promise.all([store.list('rms_reports'), store.list('rms_offices')]);
  return { reports: reports.map((r) => ({ id: r.id, ...r.data })), offices: offices.map((o) => ({ id: o.id, ...o.data })) };
}
const dueText = (r) => !r.due || r.due.kind === 'none' ? 'No set due date'
  : r.due.kind === 'after' ? `${r.due.days} days after the period ends` : `Day ${r.due.day} of the following period`;

// The auditees of a municipality (or the Province), in display order, each with its main office and any extra offices.
function auditeesOf(refs, rms, scopeId) {
  const lgu = refs.lgu[scopeId]; if (!lgu) return [];
  const list = [];
  const add = (auditeeId, name, teamId, munId) => {
    const main = rms.offices.find((o) => o.auditeeId === auditeeId && o.kind === 'main');
    const extra = rms.offices.filter((o) => o.auditeeId === auditeeId && o.kind === 'extra').sort(byName);
    list.push({ auditeeId, name, teamId, munId, main, extra });
  };
  if (lgu.data.kind === 'province') { add(lgu.id, 'Provincial Government of Quirino', lgu.data.teamId, lgu.id); return list; }
  add(lgu.id, 'Municipality of ' + lgu.data.name, lgu.data.teamId, lgu.id);
  refs.lgus.filter((b) => b.data.kind === 'barangay' && b.data.parentId === lgu.id && b.data.active !== false)
    .sort((a, b) => String(a.data.code).localeCompare(String(b.data.code)))
    .forEach((b) => {
      add(b.id, 'Barangay ' + b.data.name, b.data.teamId, lgu.id);
      if (b.data.hasSk !== false) add('sk-' + b.id, 'SK of ' + b.data.name, b.data.teamId, lgu.id);
    });
  return list;
}

/* ---------- page frame ---------- */
function frame(ctx, active, body) {
  const { refs, session, syncHtml } = ctx;
  const name = refs.me ? refs.me.data.name : (session.name || session.email);
  const ini = String(name).split(/\s+/).filter((w) => /^[A-Z]/i.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return `<div class="topbar">
      <img src="img/coa-logo.png" alt="COA seal">
      <div class="t">RECORDS MANAGEMENT<small>AMS · COA QUIRINO</small></div>
      <nav><a href="#/">← Dashboard</a></nav>
      ${syncHtml}<div class="me"><div class="av">${esc(ini)}</div><span>${esc(name)}<br><small>${esc(roleLine(refs))}</small></span></div>
    </div><div class="tri-bar"></div>
    <div class="rms-subnav">${TABS.map(([k, label, ready]) => ready
      ? `<a href="#/rms/${k}" class="${active === k ? 'on' : ''}">${label}</a>`
      : `<a href="#" class="dim" data-soon="${label}">${label}</a>`).join('')}</div>
    <main class="admin">${body}</main>${bottomBand()}`;
}

export async function render(ctx) {
  const { app, refs, q, parts } = ctx;
  const rms = await loadRms();
  const view = parts[0] || 'setup';
  const sub = parts[1] || (canEditLibrary(refs) ? 'library' : 'offices');
  const setupNav = `<div class="rms-seg"><a href="#/rms/setup/library" class="${sub === 'library' ? 'on' : ''}">Report Library</a><a href="#/rms/setup/offices" class="${sub === 'offices' ? 'on' : ''}">Office Setup</a></div>`;
  let body = '';
  if (view === 'setup' && sub === 'offices') body = setupNav + officesHtml(refs, rms, q);
  else body = setupNav + libraryHtml(refs, rms, q);
  app.innerHTML = frame(ctx, 'setup', body);
  $$('[data-soon]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); toast(`${a.dataset.soon.replace('&amp;', '&')} comes next. Only Setup is built so far.`); }; });
  if (sub === 'offices') wireOffices(refs, rms, q); else wireLibrary(refs, rms);
}

/* ================= Report Library ================= */
function libraryHtml(refs, rms, q) {
  const edit = canEditLibrary(refs);
  const used = (id) => rms.offices.filter((o) => (o.reportIds || []).includes(id)).length;
  const list = [...rms.reports].sort((a, b) => a.code.localeCompare(b.code));
  const cols = 'grid-template-columns:84px minmax(200px,1.6fr) minmax(170px,1fr) 90px 110px 56px';
  return `<div class="page">
    <div class="page-head"><div><h1>Report Library</h1><p>Office-wide list of reports the auditees submit. Kept by the Admin and SA Staff; used by all teams. It starts empty and grows as reports are added.</p></div>
      ${edit ? '<button class="btn primary" id="add-report">+ Add Report</button>' : ''}</div>
    <section class="panel">
      <div class="panel-head"><h2>Reports · ${list.filter((r) => r.active !== false).length}</h2>${list.length ? '<span class="r"><label class="sr-only" for="find-rep">Search reports</label><input class="input" id="find-rep" placeholder="Search reports" style="width:200px"></span>' : ''}</div>
      ${list.length ? `<div class="t-head" style="${cols}"><span>Code</span><span>Report</span><span>Schedule</span><span>Checklist</span><span>Used by</span><span></span></div>
        <div id="rep-list">${list.map((r) => { const n = used(r.id); return `<div class="t-row ${r.active === false ? 'removed' : ''}" style="${cols}" data-find="${esc((r.code + ' ' + r.name).toLowerCase())}">
          <span class="mono"><b>${esc(r.code)}</b></span><span><b>${esc(r.name)}</b>${r.basis ? `<br><small>${esc(r.basis)}</small>` : ''}${r.active === false ? ' ' + pill('Inactive') : ''}</span>
          <span>${esc(r.frequency)}<br><small>${esc(dueText(r))}</small></span>
          <span>${(r.checklist || []).length} item${(r.checklist || []).length === 1 ? '' : 's'}</span>
          <span><small>${n ? n + ' office' + (n > 1 ? 's' : '') : 'Not used yet'}</small></span>
          <span>${edit ? `<button class="btn sm" data-edit-rep="${r.id}">Edit</button>` : `<button class="btn sm" data-view-rep="${r.id}">View</button>`}</span></div>`; }).join('')}</div>`
      : `<div class="empty"><b>No reports yet</b>${edit ? 'Add the first report with its code, schedule and checklist. Teams can then tick it for their offices.' : 'The Admin or SA Staff add the reports here. Teams can then tick them for their offices.'}</div>`}
    </section></div>`;
}

function wireLibrary(refs, rms) {
  const add = $('#add-report'); if (add) add.onclick = () => editReport(refs, rms, null);
  $$('[data-edit-rep]').forEach((b) => { b.onclick = () => editReport(refs, rms, b.dataset.editRep); });
  $$('[data-view-rep]').forEach((b) => { b.onclick = () => viewReport(rms, b.dataset.viewRep); });
  const f = $('#find-rep'); if (f) f.oninput = () => { const v = f.value.trim().toLowerCase(); $$('#rep-list .t-row').forEach((r) => { r.hidden = v && !r.dataset.find.includes(v); }); };
}

function viewReport(rms, id) {
  const r = rms.reports.find((x) => x.id === id);
  modal({ title: `${r.code} · ${r.name}`, body: `<p><b>Schedule:</b> ${esc(r.frequency)} · ${esc(dueText(r))}</p>${r.basis ? `<p><b>Legal basis:</b> ${esc(r.basis)}</p>` : ''}
    <div><span class="legend">Checklist</span><ol class="rms-ol">${(r.checklist || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ol></div>` });
}

async function editReport(refs, rms, id) {
  const r = id ? rms.reports.find((x) => x.id === id) : { code: '', name: '', basis: '', frequency: 'Monthly', due: { kind: 'after', days: 10 }, checklist: [], active: true };
  const items = [...(r.checklist || [])];
  const usedBy = id ? rms.offices.filter((o) => (o.reportIds || []).includes(id)).length : 0;
  let out = null;
  const res = await modal({
    title: id ? 'Edit Report' : 'Add Report',
    body: `<div class="rms-codename"><div class="field"><label for="r-code">Report Code</label><input class="input mono upper" id="r-code" value="${esc(r.code)}" maxlength="10" placeholder="RCI"><span class="hint">Short code used in the tracking number.</span></div>
        <div class="field"><label for="r-name">Report Name</label><input class="input" id="r-name" value="${esc(r.name)}" placeholder="Report of Checks Issued"></div></div>
      <div class="field"><label for="r-basis">Legal Basis (optional)</label><input class="input" id="r-basis" value="${esc(r.basis || '')}" placeholder="e.g. COA Circular No. ___"></div>
      <div class="two"><div class="field"><label for="r-freq">Frequency</label><select class="input" id="r-freq">${FREQ.map((f) => `<option ${r.frequency === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="field"><label for="r-due">Due</label><select class="input" id="r-due">
          <option value="after" ${r.due.kind === 'after' ? 'selected' : ''}>Within a number of days after the period ends</option>
          <option value="day" ${r.due.kind === 'day' ? 'selected' : ''}>On a set day of the following period</option>
          <option value="none" ${r.due.kind === 'none' ? 'selected' : ''}>No set due date</option></select>
          <div class="rms-due-n"><input class="input" id="r-due-n" type="number" min="1" max="31" value="${esc(r.due.days || r.due.day || 10)}"><span id="r-due-unit" class="hint"></span></div>
          <span class="hint">Used to flag late and missing submissions.</span></div></div>
      <div><span class="legend">Checklist (documents that make up this report)</span>
        <div class="list-edit" id="r-items"></div>
        <span class="hint">During receiving, the receiver ticks which of these were actually submitted.</span></div>
      ${id ? `<div class="field"><label for="r-active">Status</label><select class="input" id="r-active"><option value="yes" ${r.active !== false ? 'selected' : ''}>Active</option><option value="no" ${r.active === false ? 'selected' : ''}>Inactive (no longer required)</option></select>
        ${usedBy ? `<span class="hint">Ticked for ${usedBy} office${usedBy > 1 ? 's' : ''}. A changed code applies to tracking numbers made from now on.</span>` : ''}</div>` : ''}`,
    onOpen: (bg) => {
      const draw = () => {
        $('#r-items', bg).innerHTML = items.map((t, i) => `<div><span class="n">${i + 1}.</span><span class="txt">${esc(t)}</span>
            <button type="button" class="mini" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
            <button type="button" class="mini" data-rm="${i}" aria-label="Remove">×</button></div>`).join('')
          + `<div><input class="input" id="r-new" placeholder="+ Add a document to the checklist, then press Enter"></div>`;
        $$('[data-rm]', bg).forEach((b) => { b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); }; });
        $$('[data-up]', bg).forEach((b) => { b.onclick = () => { const i = +b.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); }; });
        const nw = $('#r-new', bg);
        nw.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = nw.value.trim(); if (v) { items.push(v); draw(); $('#r-new', bg).focus(); } } };
      };
      const dueState = () => { const k = $('#r-due', bg).value; $('.rms-due-n', bg).hidden = k === 'none'; $('#r-due-unit', bg).textContent = k === 'after' ? 'days after the period ends' : 'day of the following period'; };
      $('#r-due', bg).onchange = dueState; draw(); dueState();
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save Report', cls: 'primary', value: 'save', check: (bg) => {
      const pending = $('#r-new', bg).value.trim(); if (pending) items.push(pending);
      const code = $('#r-code', bg).value.trim().toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{1,10}$/.test(code)) { toast('Enter a report code: letters and numbers only, up to 10.', 'bad'); return false; }
      if (rms.reports.some((x) => x.id !== id && x.code === code)) { toast(`Report code ${code} is already used.`, 'bad'); return false; }
      const name = $('#r-name', bg).value.trim(); if (!name) { toast('Enter the report name.', 'bad'); return false; }
      if (!items.length) { toast('Add at least one document to the checklist.', 'bad'); return false; }
      const kind = $('#r-due', bg).value, n = parseInt($('#r-due-n', bg).value, 10);
      if (kind !== 'none' && !(n >= 1 && n <= 31)) { toast('Enter the number of days (1 to 31).', 'bad'); return false; }
      out = { code, name, basis: $('#r-basis', bg).value.trim(), frequency: $('#r-freq', bg).value,
        due: kind === 'none' ? { kind } : kind === 'after' ? { kind, days: n } : { kind, day: n }, checklist: items, active: id ? $('#r-active', bg).value === 'yes' : true };
      return true;
    } }]
  });
  if (res !== 'save') return;
  await store.save('rms_reports', id || newId('rep'), out, by(refs));
  toast(id ? 'Report saved.' : 'Report added. Teams can now tick it for their offices.', 'ok');
}

/* ================= Office Setup ================= */
function scopesFor(refs) {
  const teams = myTeams(refs);
  const prov = refs.lgus.find((l) => l.data.kind === 'province' && teams.includes(l.data.teamId));
  const muns = refs.lgus.filter((l) => l.data.kind === 'municipality' && teams.includes(l.data.teamId)).sort((a, b) => a.data.name.localeCompare(b.data.name));
  return [...(prov ? [prov] : []), ...muns];
}

function officesHtml(refs, rms, q) {
  const scopes = scopesFor(refs);
  if (!scopes.length) return `<div class="page"><div class="msg bad">No team is assigned to you yet. Ask the Admin to set your team in Users &amp; Roles.</div></div>`;
  const scopeId = scopes.some((s) => s.id === q.get('m')) ? q.get('m') : scopes.find((s) => s.data.kind === 'municipality')?.id || scopes[0].id;
  const scope = refs.lgu[scopeId];
  const teamName = refs.team[scope.data.teamId]?.data.name || '';
  const rows = auditeesOf(refs, rms, scopeId);
  const edit = canEditMun(refs, scope.data.teamId, scopeId);
  const offices = rows.flatMap((a) => [a.main, ...a.extra]).filter(Boolean);
  const noCode = rows.filter((a) => !a.main || !a.main.code).length;
  const repCode = (rid) => rms.reports.find((r) => r.id === rid);
  const chips = (o) => (o && (o.reportIds || []).length) ? (o.reportIds.map(repCode).filter(Boolean).sort((x, y) => x.code.localeCompare(y.code)).map((r) => pill(r.code, r.active === false ? '' : 'blue')).join('')) : '<small>—</small>';
  const cols = 'grid-template-columns:minmax(190px,1.3fr) 150px minmax(150px,1fr) 128px';
  const label = (s) => s.data.kind === 'province' ? 'Province of Quirino' : s.data.name;
  return `<div class="page">
    <div class="page-head"><div><h1>Office Setup${teamName ? ' · ' + esc(teamName) : ''}</h1><p>Your auditees come from the AMS LGU Master List. Give each an office code, add extra submitting offices where an auditee has more than one, and tick the reports each office submits.</p></div>
      ${edit ? '<div class="btn-row"><button class="btn" id="copy-reps">Copy Reports…</button></div>' : ''}</div>
    <section class="panel">
      <div class="panel-head"><h2>${esc(scope.data.kind === 'province' ? 'Province of Quirino' : 'Municipality of ' + scope.data.name)}</h2>
        <span class="r">${noCode ? pill(`${noCode} of ${rows.length} without office code`, 'warn') : pill('All have office codes', 'ok')}</span></div>
      <div class="filters"><label class="sr-only" for="scope">Municipality</label><select class="input" id="scope">${scopes.map((s) => `<option value="${s.id}" ${s.id === scopeId ? 'selected' : ''}>${esc(label(s))}${seesAllTeams(refs) ? ' · ' + esc(refs.team[s.data.teamId]?.data.name || '') : ''}</option>`).join('')}</select>
        <label class="sr-only" for="find-off">Search offices</label><input class="input" id="find-off" placeholder="Search"></div>
      <div class="t-head" style="${cols}"><span>Auditee · Submitting Office</span><span>Office Code</span><span>Reports</span><span></span></div>
      <div id="off-list">${rows.map((a) => `
        <div class="t-row" style="${cols}" data-find="${esc(a.name.toLowerCase())} ${esc((a.main?.code || '').toLowerCase())}">
          <span><b>${esc(a.name)}</b></span>
          <span>${a.main?.code ? `<span class="mono">${esc(a.main.code)}</span>` : pill('No office code yet', 'warn')}</span>
          <span class="chips">${chips(a.main)}</span>
          <span class="acts">${edit ? `<button class="btn sm" data-off="${esc(a.auditeeId)}">Edit</button>${a.auditeeId.startsWith('brgy-') || a.auditeeId.startsWith('sk-') ? '' : `<button class="btn sm" data-add-off="${esc(a.auditeeId)}" title="Add a submitting office under ${esc(a.name)}">+ Office</button>`}` : ''}</span></div>
        ${a.extra.map((o) => `<div class="t-row sub" style="${cols}" data-find="${esc(a.name.toLowerCase())} ${esc(o.name.toLowerCase())} ${esc(o.code.toLowerCase())}">
          <span>${esc(o.name)}${o.active === false ? ' ' + pill('Inactive') : ''}</span><span class="mono">${esc(o.code)}</span><span class="chips">${chips(o)}</span>
          <span class="acts">${edit ? `<button class="btn sm" data-extra="${o.id}">Edit</button>` : ''}</span></div>`).join('')}`).join('')}</div>
    </section>
    <section class="panel" style="margin-top:20px"><div class="panel-head"><h2>Good to Know</h2></div><div class="note">
      <p>• An office without an office code cannot receive items yet, since no tracking number can be made.</p>
      <p>• Tracking numbers: <span class="mono">MAD-ABB-RCI-2026-0012</span> for reports, <span class="mono">MAD-ABB-2026-0013</span> for communications. One running series per office per year.</p>
      <p>• <b>+ Office</b> (Province and municipalities) adds another submitting office under the auditee, e.g. the Province's hospitals.</p>
      <p class="last">• Missing a report? Ask the Admin or SA Staff to add it to the Report Library.${offices.length ? '' : ''}</p></div></section>
  </div>`;
}

function wireOffices(refs, rms, q) {
  const sel = $('#scope'); if (!sel) return;
  sel.onchange = () => { location.hash = '#/rms/setup/offices?m=' + encodeURIComponent(sel.value); };
  const f = $('#find-off'); if (f) f.oninput = () => { const v = f.value.trim().toLowerCase(); $$('#off-list .t-row').forEach((r) => { r.hidden = v && !r.dataset.find.includes(v); }); };
  const rows = auditeesOf(refs, rms, sel.value);
  $$('[data-off]').forEach((b) => { b.onclick = () => editOffice(refs, rms, rows.find((a) => a.auditeeId === b.dataset.off), null); });
  $$('[data-add-off]').forEach((b) => { b.onclick = () => editOffice(refs, rms, rows.find((a) => a.auditeeId === b.dataset.addOff), 'new'); });
  $$('[data-extra]').forEach((b) => { b.onclick = () => { const o = rms.offices.find((x) => x.id === b.dataset.extra); editOffice(refs, rms, rows.find((a) => a.auditeeId === o.auditeeId), o); }; });
  const cp = $('#copy-reps'); if (cp) cp.onclick = () => copyReports(refs, rms, rows);
}

// Edit the auditee's own office (extra = null), add an extra office (extra = 'new'), or edit an extra office.
async function editOffice(refs, rms, a, extra) {
  const isExtra = !!extra;
  const o = extra === 'new' ? { name: '', code: '', reportIds: [], note: '', active: true } : isExtra ? extra : (a.main || { code: '', reportIds: [], note: '' });
  const active = rms.reports.filter((r) => r.active !== false || (o.reportIds || []).includes(r.id)).sort((x, y) => x.code.localeCompare(y.code));
  let out = null;
  const res = await modal({
    title: extra === 'new' ? 'Add Submitting Office · ' + a.name : isExtra ? o.name + ' · ' + a.name : a.name,
    body: `${isExtra ? `<div class="field"><label for="o-name">Office Name</label><input class="input" id="o-name" value="${esc(o.name)}" placeholder="e.g. District Hospital"></div>` : ''}
      <div class="field"><label for="o-code">Office Code</label><input class="input mono upper" id="o-code" value="${esc(o.code)}" style="max-width:240px" placeholder="${isExtra ? 'e.g. PQ-DDH' : 'e.g. MAD-ABB'}"><span class="hint">Used in every tracking number of this office. Must be unique. Letters, numbers and hyphens.</span></div>
      <div><span class="legend">Reports this office submits</span>
        ${active.length ? `<div class="checks">${active.map((r) => `<label><input type="checkbox" name="rep" value="${r.id}" ${(o.reportIds || []).includes(r.id) ? 'checked' : ''}> <span class="mono">${esc(r.code)}</span>&nbsp;· ${esc(r.name)}</label>`).join('')}</div>`
          : '<span class="hint">The Report Library is still empty. Ask the Admin or SA Staff to add the reports first.</span>'}
        <span class="hint">Only reports in the Report Library are listed.</span></div>
      <div class="field"><label for="o-note">Extra requirement for this office only (optional)</label><input class="input" id="o-note" value="${esc(o.note || '')}" placeholder="e.g. Copy of resolution for the 20% DF projects"></div>
      ${isExtra && extra !== 'new' ? `<div class="field"><label for="o-active">Status</label><select class="input" id="o-active"><option value="yes" ${o.active !== false ? 'selected' : ''}>Active</option><option value="no" ${o.active === false ? 'selected' : ''}>Inactive (no longer submits)</option></select></div>` : ''}`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: 'save', check: (bg) => {
      const code = $('#o-code', bg).value.trim().toUpperCase().replace(/\s+/g, '');
      const name = isExtra ? $('#o-name', bg).value.trim() : '';
      if (isExtra && !name) { toast('Enter the office name.', 'bad'); return false; }
      if (!code) { toast('Enter the office code.', 'bad'); return false; }
      if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code) || code.length > 20) { toast('Office code: letters, numbers and single hyphens only (e.g. MAD-ABB).', 'bad'); return false; }
      const mine = extra === 'new' ? null : isExtra ? o.id : a.main?.id;
      const dup = rms.offices.find((x) => x.id !== mine && x.code === code);
      if (dup) { toast(`Office code ${code} is already used by ${dup.name}.`, 'bad'); return false; }
      out = { code, ...(isExtra ? { name } : {}), reportIds: $$('input[name=rep]:checked', bg).map((x) => x.value), note: $('#o-note', bg).value.trim(),
        active: isExtra && extra !== 'new' ? $('#o-active', bg).value === 'yes' : true };
      return true;
    } }]
  });
  if (res !== 'save') return;
  if (!isExtra) {
    const id = a.main?.id || 'off-' + a.auditeeId;
    await store.save('rms_offices', id, { ...(a.main ? strip(a.main) : {}), auditeeId: a.auditeeId, kind: 'main', name: a.name, teamId: a.teamId, munId: a.munId, ...out }, by(refs));
  } else {
    const id = extra === 'new' ? newId('off') : o.id;
    await store.save('rms_offices', id, { ...(extra === 'new' ? {} : strip(o)), auditeeId: a.auditeeId, kind: 'extra', teamId: a.teamId, munId: a.munId, ...out }, by(refs));
  }
  toast('Office saved.', 'ok');
}

async function copyReports(refs, rms, rows) {
  const offs = rows.flatMap((a) => [a.main ? { ...a.main, label: a.name } : null, ...a.extra.map((o) => ({ ...o, label: o.name + ' · ' + a.name }))]).filter(Boolean);
  const sources = offs.filter((o) => (o.reportIds || []).length);
  if (!sources.length) return toast('Tick the reports of one office first, then copy them to the others.');
  const repCodes = (o) => (o.reportIds || []).map((rid) => rms.reports.find((r) => r.id === rid)?.code).filter(Boolean).join(', ');
  // Targets: every auditee row of this municipality (an office without a code yet gets its reports now and its code later).
  const targets = rows.flatMap((a) => [{ key: a.auditeeId, label: a.name, kind: a.auditeeId.startsWith('sk-') ? 'sk' : a.auditeeId.startsWith('brgy-') ? 'brgy' : 'other', a },
    ...a.extra.map((o) => ({ key: o.id, label: o.name + ' · ' + a.name, kind: 'other', a, extra: o }))]);
  let picked = null, src = null;
  const res = await modal({
    title: 'Copy Reports',
    body: `<div class="field"><label for="c-src">Copy the reports of</label><select class="input" id="c-src">${sources.map((o) => `<option value="${o.id}">${esc(o.label)} (${esc(o.code || 'no code')}) · ${esc(repCodes(o))}</option>`).join('')}</select></div>
      <div><span class="legend">To these offices</span>
        <div class="btn-row" style="margin-bottom:8px"><button type="button" class="btn sm" data-tick="brgy">Tick all barangays</button><button type="button" class="btn sm" data-tick="sk">Tick all SKs</button><button type="button" class="btn sm" data-tick="none">Untick all</button></div>
        <div class="checks rms-targets">${targets.map((t) => `<label data-kind="${t.kind}"><input type="checkbox" name="tgt" value="${esc(t.key)}"> ${esc(t.label)}</label>`).join('')}</div>
        <span class="hint">Copied reports are added to what each office already has. Offices can still be adjusted one by one afterwards.</span></div>`,
    onOpen: (bg) => {
      const count = () => { const n = $$('input[name=tgt]:checked', bg).length; $('.mf .btn.primary', bg).textContent = n ? `Copy to ${n} Office${n > 1 ? 's' : ''}` : 'Copy'; };
      const syncSrc = () => { const sid = $('#c-src', bg).value; $$('input[name=tgt]', bg).forEach((x) => { const t = targets.find((y) => y.key === x.value); const self = (t.extra ? t.extra.id : t.a.main?.id) === sid; x.disabled = self; if (self) x.checked = false; }); count(); };
      $$('[data-tick]', bg).forEach((b) => { b.onclick = () => { $$('.rms-targets label', bg).forEach((l) => { const x = $('input', l); if (x.disabled) return; x.checked = b.dataset.tick === 'none' ? false : l.dataset.kind === b.dataset.tick ? true : x.checked; }); count(); }; });
      $$('input[name=tgt]', bg).forEach((x) => { x.onchange = count; });
      $('#c-src', bg).onchange = syncSrc; syncSrc();
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Copy', cls: 'primary', value: 'copy', check: (bg) => {
      picked = $$('input[name=tgt]:checked', bg).map((x) => x.value); src = rms.offices.find((o) => o.id === $('#c-src', bg).value);
      if (!picked.length) { toast('Tick at least one office to copy to.', 'bad'); return false; }
      return true;
    } }]
  });
  if (res !== 'copy') return;
  for (const key of picked) {
    const t = targets.find((y) => y.key === key);
    if (t.extra) {
      await store.save('rms_offices', t.extra.id, { ...strip(t.extra), reportIds: union(t.extra.reportIds, src.reportIds) }, by(refs));
    } else {
      const a = t.a, cur = a.main;
      await store.save('rms_offices', cur?.id || 'off-' + a.auditeeId, { ...(cur ? strip(cur) : { auditeeId: a.auditeeId, kind: 'main', name: a.name, teamId: a.teamId, munId: a.munId, code: '', note: '' }),
        reportIds: union(cur?.reportIds, src.reportIds) }, by(refs));
    }
  }
  toast(`Reports copied to ${picked.length} office${picked.length > 1 ? 's' : ''}.`, 'ok');
}
const union = (a, b) => [...new Set([...(a || []), ...(b || [])])];
const strip = (o) => { const { id, label, ...rest } = o; return rest; };
