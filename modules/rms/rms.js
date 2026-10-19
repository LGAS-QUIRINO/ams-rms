// Records Management module (AMS). Built so far: Overview, Submission Monitor, Setup (Report Library, Office Setup).
// Designs approved 17 Oct 2026. Receiving, Logbook, Records & Storage, Borrow Log and RCI Encoding come next.
import { store, newId } from '../../js/store.js';
import { esc, pill, modal, toast, $, $$ } from '../../js/ui.js';
import { roleLine } from '../../js/views/admin.js';
import { moduleFrame } from '../../js/frame.js';
import { receivingHtml, wireReceiving, numberOf, statusPill, isVerify, lacksDocs, historyHtml, checklistHtml, itemsFor } from './receiving.js';

// Load this module's look once.
if (!document.querySelector('link[data-rms]')) {
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'modules/rms/rms.css'; l.dataset.rms = '1'; document.head.appendChild(l);
}

const FREQ = ['Monthly', 'Quarterly', 'Semi-annual', 'Annual', 'As needed'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const byName = (a, b) => a.name.localeCompare(b.name);
export const hasRole = (refs, ...r) => !!refs.me && (refs.me.data.roles || []).some((x) => r.includes(x));
const by = (refs) => refs.me?.data.email || '';

/* ---------- who may do what ---------- */
const canEditLibrary = (refs) => hasRole(refs, 'admin', 'osa');
const seesAllTeams = (refs) => hasRole(refs, 'admin', 'sa', 'osa');
// Team Staff (JO) only: Receiving, Records & Storage and Borrow Log.
export const jobOrderOnly = (refs) => !!refs.me && (refs.me.data.roles || []).length > 0 && refs.me.data.roles.every((r) => r === 'staff');
function myTeams(refs) {
  if (seesAllTeams(refs)) return refs.teams.map((t) => t.id);
  return refs.me ? (refs.me.data.teamIds || []) : [];
}
// Municipalities this person may see (Team Members and Team Staff can be limited to ticked ones).
function mayViewMun(refs, munId, teamId) {
  if (seesAllTeams(refs)) return true;
  const d = refs.me?.data; if (!d || !(d.teamIds || []).includes(teamId)) return false;
  if ((d.roles || []).includes('atl')) return true;
  return !(d.munIds || []).length || d.munIds.includes(munId);
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
  const [reports, offices, items, settings, groups] = await Promise.all([store.list('rms_reports'), store.list('rms_offices'), store.list('rms_items'), store.get('rms_settings', 'office'), store.get('rms_settings', 'groups')]);
  const now = new Date();
  return { reports: reports.map((r) => ({ id: r.id, ...r.data })), offices: offices.map((o) => ({ id: o.id, ...o.data })),
    // _new: received on this computer but not yet sent to the AMS database (its number is not yet confirmed).
    items: items.map((i) => ({ id: i.id, ...i.data, ...(i.pending && !i.version ? { _new: true } : {}) })),
    // Report groups made by the team (Report Library), in their set order.
    groups: (groups && groups.data && groups.data.list) || [],
    startPeriod: (settings && settings.data && settings.data.startPeriod) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` };
}
const dueText = (r) => !r.due || r.due.kind === 'none' ? 'No set due date'
  : r.due.kind === 'after' ? `${r.due.days} days after the period ends` : `Day ${r.due.day} of the following period`;

/* ---------- periods, due dates and status ---------- */
// Reporting periods of a report in a year: monthly '2026-09', quarterly '2026-Q3', semi-annual '2026-H2', annual '2026'.
export function periodsOf(r, year) {
  if (r.frequency === 'Monthly') return MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  if (r.frequency === 'Quarterly') return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
  if (r.frequency === 'Semi-annual') return [`${year}-H1`, `${year}-H2`];
  if (r.frequency === 'Annual') return [String(year)];
  return [];
}
// [first month, last month] (1–12) and year of a period.
export function span(p) {
  const y = +p.slice(0, 4), t = p.slice(5);
  if (!t) return [y, 1, 12];
  if (t[0] === 'Q') { const q = +t[1]; return [y, q * 3 - 2, q * 3]; }
  if (t[0] === 'H') { const h = +t[1]; return [y, h * 6 - 5, h * 6]; }
  return [y, +t, +t];
}
export function periodLabel(p) {
  const [y, a, b] = span(p);
  if (a === b) return `${MONTHS_LONG[a - 1]} ${y}`;
  const t = p.slice(5);
  return t ? `${t[0] === 'Q' ? 'Q' + t[1] : (t[1] === '1' ? '1st Half' : '2nd Half')} ${y}` : `CY ${y}`;
}
const periodShort = (p) => { const [, a, b] = span(p); const t = p.slice(5); return a === b ? MONTHS[a - 1] : t ? (t[0] === 'Q' ? 'Q' + t[1] : 'H' + t[1]) : 'Year'; };
export function dueDate(r, p) {
  if (!r.due || r.due.kind === 'none') return null;
  const [y, , b] = span(p);
  if (r.due.kind === 'after') { const end = new Date(y, b, 0); end.setDate(end.getDate() + r.due.days); end.setHours(23, 59, 59); return end; }
  const d = new Date(y, b, Math.min(r.due.day, new Date(y, b + 1, 0).getDate())); d.setHours(23, 59, 59); return d;
}
export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
export const fmtDT = (d) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

// Status of one office's report for one period:
// untracked (before monitoring starts) · nodue · notdue · verify · complete · late · incomplete · overdue
function cellStatus(rms, office, r, p, now = new Date()) {
  { const [y, , e] = span(p); if (`${y}-${String(e).padStart(2, '0')}` < rms.startPeriod) return { s: 'untracked' }; }
  // Rejected submissions do not count; the latest of the rest decides.
  const got = rms.items.filter((i) => i.officeId === office.id && i.reportId === r.id && i.period === p && i.status !== 'rejected')
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))[0];
  const due = dueDate(r, p);
  if (got) {
    if (isVerify(got)) return { s: 'verify', item: got, due };
    if (lacksDocs(got)) return { s: 'incomplete', item: got, due };
    return { s: due && new Date(got.completedAt || got.receivedAt) > due ? 'late' : 'complete', item: got, due };
  }
  const [y, , b] = span(p);
  if (!due) return { s: new Date(y, b, 0) < now ? 'nodue' : 'notdue', due };
  return { s: now > due ? 'overdue' : 'notdue', due };
}
const MARK = { complete: '✓', late: 'L', verify: 'V', incomplete: '½', overdue: '!', notdue: '·', untracked: '—', nodue: '·' };
const STATUS_TEXT = { complete: 'Accepted, all submitted', late: 'Accepted, all submitted but late', verify: 'Received, for verification', incomplete: 'Accepted, missing documents', overdue: 'Overdue', notdue: 'Not yet due', untracked: 'Before monitoring started', nodue: 'Not yet submitted (no set due date)' };
const STATUS_PILL = { complete: 'ok', late: 'late', verify: 'blue', incomplete: 'warn', overdue: 'bad' };

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
// Province and municipalities this person may see, Province first.
export function scopesFor(refs) {
  const teams = myTeams(refs);
  const ok = (l) => teams.includes(l.data.teamId) && mayViewMun(refs, l.id, l.data.teamId);
  const prov = refs.lgus.find((l) => l.data.kind === 'province' && ok(l));
  const muns = refs.lgus.filter((l) => l.data.kind === 'municipality' && ok(l)).sort((a, b) => a.data.name.localeCompare(b.data.name));
  return [...(prov ? [prov] : []), ...muns];
}
// All offices (with their display names) this person may see, in display order.
export function visibleOffices(refs, rms, scopeIds) {
  return scopeIds.flatMap((sid) => auditeesOf(refs, rms, sid).flatMap((a) => [a.main ? { ...a.main, label: a.name, munId: sid } : null,
    ...a.extra.filter((o) => o.active !== false).map((o) => ({ ...o, label: o.name + ' · ' + a.name, munId: sid }))]).filter(Boolean));
}
function overdueAll(refs, rms, year) {
  const offs = visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id));
  const out = [];
  rms.reports.filter((r) => r.active !== false).forEach((r) => periodsOf(r, year).forEach((p) => offs.forEach((o) => {
    if ((o.reportIds || []).includes(r.id) && cellStatus(rms, o, r, p).s === 'overdue') out.push({ o, r, p });
  })));
  return out;
}

/* ---------- page frame ---------- */
function navItems(refs, overdueN, pendingN) {
  if (jobOrderOnly(refs)) return [
    { key: 'receiving', label: 'Receiving', icon: 'inbox', href: '#/rms/receiving' },
    { key: 'records', label: 'Records & Storage', icon: 'box', soon: true },
    { key: 'borrow', label: 'Borrow Log', icon: 'swap', soon: true }];
  return [
    { key: 'overview', label: 'Overview', icon: 'overview', href: '#/rms/overview' },
    { key: 'monitor', label: 'Submission Monitor', icon: 'grid', href: '#/rms/monitor', count: overdueN },
    { key: 'receiving', label: 'Receiving', icon: 'inbox', href: '#/rms/receiving', count: pendingN },
    { key: 'logbook', label: 'Logbook', icon: 'book', soon: true },
    { key: 'records', label: 'Records & Storage', icon: 'box', soon: true },
    { key: 'borrow', label: 'Borrow Log', icon: 'swap', soon: true },
    { section: true, label: 'SETUP' },
    { key: 'library', label: 'Report Library', icon: 'library', href: '#/rms/setup/library' },
    { key: 'offices', label: 'Office Setup', icon: 'building', href: '#/rms/setup/offices' }];
}

export async function render(ctx) {
  const { app, refs, q, parts } = ctx;
  const rms = await loadRms();
  const year = new Date().getFullYear();
  const jo = jobOrderOnly(refs);
  let view = parts[0] || 'overview';
  if (view === 'setup') view = parts[1] === 'offices' ? 'offices' : 'library';
  if (jo && !['receiving'].includes(view)) view = 'receiving';
  const overdue = jo ? [] : overdueAll(refs, rms, year);
  const crumbs = { overview: 'Overview', monitor: 'Submission Monitor', library: 'Report Library', offices: 'Office Setup', receiving: 'Receiving' };
  const offIds = new Set(visibleOffices(refs, rms, scopesFor(refs).map((s) => s.id)).map((o) => o.id));
  const pendingN = jo ? 0 : rms.items.filter((i) => isVerify(i) && offIds.has(i.officeId)).length;
  const body = view === 'receiving' ? receivingHtml(refs, rms, q)
    : view === 'monitor' ? monitorHtml(refs, rms, q)
    : view === 'library' ? libraryHtml(refs, rms, q)
    : view === 'offices' ? officesHtml(refs, rms, q)
    : overviewHtml(refs, rms, overdue);
  const me = refs.me ? refs.me.data : { name: ctx.session.name || ctx.session.email };
  const roleText = [refs.me?.data.position, roleLine(refs)].filter(Boolean).join(' · ');
  app.innerHTML = moduleFrame({ title: 'Records<br>Management', items: navItems(refs, overdue.length, pendingN), active: view, crumb: crumbs[view] || 'Overview', me, roleText, body });
  $$('[data-soon]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); toast(`${a.dataset.soon} comes next. It is not built yet.`); }; });
  if (view === 'offices') wireOffices(refs, rms, q);
  else if (view === 'library') wireLibrary(refs, rms);
  else if (view === 'monitor') wireMonitor(refs, rms, q);
  else if (view === 'receiving') wireReceiving(refs, rms, q, ctx.rerender);
}

/* ================= Overview ================= */
function greet() { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 18 ? 'Good Afternoon' : 'Good Evening'; }
function overviewHtml(refs, rms, overdue) {
  const me = refs.me?.data;
  const first = me ? (me.nickname || String(me.name).split(/\s+/).find((w) => !/^(ATTY|ENGR|DR|MR|MS|MRS)\.?$/i.test(w)) || '') : '';
  const nice = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
  const scopes = scopesFor(refs);
  const offs = visibleOffices(refs, rms, scopes.map((s) => s.id));
  const offIds = new Set(offs.map((o) => o.id));
  const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const mine = rms.items.filter((i) => offIds.has(i.officeId));
  const thisMonth = mine.filter((i) => String(i.encodedAt || i.receivedAt).slice(0, 7) === ym).length;
  const verify = mine.filter(isVerify);
  const lacking = mine.filter((i) => lacksDocs(i) && !isVerify(i));
  const incomplete = [...verify, ...lacking];
  const teamNames = [...new Set(myTeams(refs).map((t) => refs.team[t]?.data.name).filter(Boolean))].join(', ');
  const recent = [...mine].sort((a, b) => String(b.encodedAt || b.receivedAt).localeCompare(String(a.encodedAt || a.receivedAt))).slice(0, 8);
  const rep = (id) => rms.reports.find((r) => r.id === id);
  const office = (id) => offs.find((o) => o.id === id);
  // Overdue grouped by report and period.
  const groups = {};
  overdue.forEach(({ r, p }) => { const k = r.id + '|' + p; groups[k] = groups[k] || { r, p, n: 0 }; groups[k].n++; });
  const top = Object.values(groups).sort((a, b) => b.n - a.n || a.p.localeCompare(b.p)).slice(0, 5);
  const noCode = scopes.reduce((n, s) => n + auditeesOf(refs, rms, s.id).filter((a) => !a.main || !a.main.code).length, 0);
  const cols = 'grid-template-columns:minmax(190px,1.2fr) minmax(160px,1fr) 120px 110px';
  return `<div class="hello"><div><h1>${greet()}${nice ? ', ' + esc(nice) : ''}</h1><p>${esc(teamNames || 'Records Management')} · ${MONTHS_LONG[now.getMonth()]} ${now.getFullYear()} · ${offs.length} submitting office${offs.length === 1 ? '' : 's'}</p></div>
      <div class="btn-row"><a class="btn" href="#/rms/monitor">Open Submission Monitor</a><a class="btn primary" href="#/rms/receiving?new=1">+ Receive Documents</a></div></div>
    <div class="stats">
      <div class="stat"><span>Received This Month</span><b>${thisMonth}</b><small>tracking numbers issued</small></div>
      <a class="stat" href="#/rms/receiving"><span>For Verification</span><b class="${verify.length ? 'warn' : ''}">${verify.length}</b><small>${lacking.length} accepted with missing documents</small></a>
      <a class="stat" href="#/rms/monitor?show=overdue"><span>Overdue</span><b class="${overdue.length ? 'bad' : ''}">${overdue.length}</b><small>past due, not yet submitted</small></a>
      <div class="stat"><span>Borrowed Out</span><b class="dim">—</b><small>comes with the Borrow Log</small></div>
    </div>
    <div class="mgrid">
      <section class="panel">
        <div class="panel-head"><h2>Recently Received</h2></div>
        ${recent.length ? `<div class="t-head" style="${cols}"><span>Tracking No.</span><span>Office · Report</span><span>Received</span><span>Status</span></div>
          ${recent.map((i) => `<div class="t-row" style="${cols}"><span class="mono">${esc(numberOf(i))}</span><span>${esc(i.fromOutside || office(i.officeId)?.label || '')}<br><small>${i.reportId ? esc((rep(i.reportId)?.code || '') + ' · ' + periodLabel(i.period)) : 'Communication · ' + esc(i.subject || '')}</small></span><span><small>${esc(fmtDate(i.receivedAt))}</small></span><span>${statusPill(i)}</span></div>`).join('')}`
          : '<div class="empty"><b>Nothing received yet</b>Items appear here once Receiving is in use.</div>'}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Needs Attention</h2></div>
        ${top.map((g) => `<a class="actrow" href="#/rms/monitor?r=${encodeURIComponent(g.r.id)}&y=${g.p.slice(0, 4)}&show=overdue"><b>${g.n} office${g.n > 1 ? "s" : ""}</b> ${g.n > 1 ? "have" : "has"} not submitted their ${esc(periodLabel(g.p))} ${esc(g.r.code)}.<small>Overdue since ${esc(fmtDate(dueDate(g.r, g.p)))} · consider demand letters</small></a>`).join('')}
        ${incomplete.slice(0, 3).map((i) => `<a class="actrow" href="#/rms/receiving"><b class="mono">${esc(numberOf(i))}</b> ${isVerify(i) ? 'is waiting for verification by the auditor' : 'is still missing documents'}.<small>${esc(office(i.officeId)?.label || '')} · received ${esc(fmtDate(i.receivedAt))}</small></a>`).join('')}
        ${noCode ? `<a class="actrow" href="#/rms/setup/offices"><b>${noCode} auditee${noCode > 1 ? 's' : ''}</b> still ${noCode > 1 ? 'have' : 'has'} no office code.<small>Office Setup</small></a>` : ''}
        ${!rms.reports.length ? `<a class="actrow" href="#/rms/setup/library"><b>The Report Library is empty.</b><small>The Admin or SA Staff add the reports first.</small></a>` : ''}
        ${!top.length && !incomplete.length && !noCode && rms.reports.length ? '<div class="empty"><b>All clear</b>Nothing needs attention right now.</div>' : ''}
      </section>
    </div>`;
}

/* ---------- report groups ---------- */
// The group name of a report ('' when it has none, or its group was removed).
const groupName = (rms, r) => rms.groups.find((g) => g.id === r.groupId)?.name || '';
// Reports in group order (as set in the Report Library), then by code; ungrouped last.
function byGroup(rms, reports) {
  const rank = (r) => { const k = rms.groups.findIndex((g) => g.id === r.groupId); return k < 0 ? 1e6 : k; };
  return [...reports].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
}
// <option>s grouped under <optgroup> headings when groups are in use.
function groupedOptions(rms, reports, selected) {
  const opt = (x) => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${esc(x.code + ' · ' + x.name)}</option>`;
  if (!reports.some((r) => groupName(rms, r))) return reports.map(opt).join('');
  const out = []; let cur = null;
  byGroup(rms, reports).forEach((r) => { const g = groupName(rms, r) || 'No group'; if (g !== cur) { if (cur !== null) out.push('</optgroup>'); out.push(`<optgroup label="${esc(g)}">`); cur = g; } out.push(opt(r)); });
  return out.join('') + '</optgroup>';
}

/* ================= Submission Monitor ================= */
// For reports with an office's own list (e.g. BRS per bank account): how many lines are in, e.g. "62/75".
const countOf = (x) => { const it = x.st && x.st.item; if (!it || !x.c.r.perOffice || !(it.checklist || []).length) return '';
  const ck = it.checklist; return `<small class="cnt">${ck.filter((c) => c.ok).length}/${ck.length}</small>`; };
function monitorHtml(refs, rms, q) {
  const scopes = scopesFor(refs);
  if (!scopes.length) return `<div class="msg bad">No team is assigned to you yet. Ask the Admin to set your team in Users &amp; Roles.</div>`;
  const reports = byGroup(rms, rms.reports.filter((r) => r.active !== false && r.frequency !== 'As needed'));
  if (!reports.length) return `<div class="hello"><div><h1>Submission Monitor</h1><p>Which office submitted what, period by period.</p></div></div>
    <section class="panel"><div class="empty"><b>No reports to monitor yet</b>The Admin or SA Staff add reports in the Report Library, and the teams tick them for their offices in Office Setup.</div></section>`;
  const scopeId = q.get('m') === 'all' || !q.get('m') ? 'all' : (scopes.some((s) => s.id === q.get('m')) ? q.get('m') : 'all');
  const now = new Date();
  const year = +(q.get('y') || now.getFullYear());
  const mode = q.get('v') === 'report' ? 'report' : 'month';
  const show = q.get('show') || 'all';
  const rid = reports.some((r) => r.id === q.get('r')) ? q.get('r') : reports[0].id;
  const r = reports.find((x) => x.id === rid);
  const month = Math.min(12, Math.max(1, +(q.get('mo') || (now.getFullYear() === year ? now.getMonth() || 1 : 12))));
  const scopeIds = scopeId === 'all' ? scopes.map((s) => s.id) : [scopeId];
  const offs = visibleOffices(refs, rms, scopeIds);
  const label = (s) => s.data.kind === 'province' ? 'Province of Quirino' : s.data.name;
  // Columns: periods of one report (By Month) or the reports for one month (By Report).
  const columns = mode === 'month' ? periodsOf(r, year).map((p) => ({ key: p, head: periodShort(p), r, p }))
    : reports.map((x) => ({ key: x.id, head: x.code, r: x, p: periodsOf(x, year).find((p) => { const [, a, b] = span(p); return month >= a && month <= b; }) }));
  let rows = offs.filter((o) => columns.some((c) => (o.reportIds || []).includes(c.r.id)));
  const cells = (o) => columns.map((c) => (o.reportIds || []).includes(c.r.id) && c.p ? { c, st: cellStatus(rms, o, c.r, c.p, now) } : { c, st: null });
  const grid = rows.map((o) => ({ o, cs: cells(o) }));
  const shown = grid.filter((g) => show === 'all' ? true : g.cs.some((x) => x.st && x.st.s === show));
  // By Report: a heading row naming each report group over its columns.
  const groupRow = mode === 'report' && reports.some((x) => groupName(rms, x)) ? (() => {
    const spans = []; columns.forEach((c) => { const n = groupName(rms, c.r) || 'No group'; const last = spans[spans.length - 1]; if (last && last.n === n) last.k++; else spans.push({ n, k: 1 }); });
    return `<tr class="grp"><th></th>${spans.map((x) => `<th colspan="${x.k}">${esc(x.n)}</th>`).join('')}</tr>`; })() : '';
  const tally = {}; grid.forEach((g) => g.cs.forEach((x) => { if (x.st) tally[x.st.s] = (tally[x.st.s] || 0) + 1; }));
  const qs = (patch) => { const o = { m: scopeId, r: rid, y: year, v: mode, mo: month, show, ...patch }; return '#/rms/monitor?' + Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'); };
  const years = [now.getFullYear(), now.getFullYear() - 1];
  return `<div class="hello"><div><h1>Submission Monitor</h1><p>Which office submitted what, period by period. Click a cell to see its details.</p></div>
      <button class="btn" type="button" id="mon-print">Print</button></div>
    <section class="panel">
      <div class="mon-filters">
        <label>Municipality<select class="input" data-f="m"><option value="all">All my municipalities</option>${scopes.map((s) => `<option value="${s.id}" ${s.id === scopeId ? 'selected' : ''}>${esc(label(s))}</option>`).join('')}</select></label>
        ${mode === 'month' ? `<label>Report<select class="input" data-f="r">${groupedOptions(rms, reports, rid)}</select></label>`
          : `<label>Month<select class="input" data-f="mo">${MONTHS_LONG.map((m, i) => `<option value="${i + 1}" ${i + 1 === month ? 'selected' : ''}>${m}</option>`).join('')}</select></label>`}
        <label>Year<select class="input" data-f="y">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <label>Show<select class="input" data-f="show"><option value="all">All offices</option><option value="overdue" ${show === 'overdue' ? 'selected' : ''}>With overdue only</option><option value="verify" ${show === 'verify' ? 'selected' : ''}>For verification only</option><option value="incomplete" ${show === 'incomplete' ? 'selected' : ''}>Missing documents only</option></select></label>
        <div class="seg"><a href="${qs({ v: 'month' })}" class="${mode === 'month' ? 'on' : ''}">By Period</a><a href="${qs({ v: 'report' })}" class="${mode === 'report' ? 'on' : ''}">By Report</a></div>
      </div>
      <div class="mon-sum">${pill('✓ Complete ' + (tally.complete || 0), 'ok')}${pill('L Late ' + (tally.late || 0), 'late')}${pill('V For verification ' + (tally.verify || 0), 'blue')}${pill('½ Missing documents ' + (tally.incomplete || 0), 'warn')}${pill('! Overdue ' + (tally.overdue || 0), 'bad')}${pill('· Not yet due ' + ((tally.notdue || 0) + (tally.nodue || 0)))}${tally.untracked ? pill('— Before monitoring ' + tally.untracked) : ''}</div>
      ${shown.length ? `<div class="mon-wrap"><table class="mon"><thead>${groupRow}<tr><th>Office · Code</th>${columns.map((c) => `<th>${esc(c.head)}</th>`).join('')}</tr></thead><tbody>
        ${shown.map((g) => `<tr><th><b>${esc(g.o.label)}</b><small class="mono">${esc(g.o.code || 'no office code')}</small></th>${g.cs.map((x) => x.st
          ? `<td class="c ${x.st.s}" data-cell="${esc(g.o.id)}|${esc(x.c.r.id)}|${esc(x.c.p)}" title="${esc(STATUS_TEXT[x.st.s])}">${MARK[x.st.s]}${countOf(x)}</td>` : '<td class="c na"></td>').join('')}</tr>`).join('')}
        </tbody></table></div>`
        : `<div class="empty"><b>${rows.length ? 'Nothing to show for this filter' : 'No office submits this report yet'}</b>${rows.length ? 'Try Show: All offices.' : 'Tick the report for the offices in Office Setup.'}</div>`}
      <div class="note">Monitoring starts with ${esc(periodLabel(rms.startPeriod))}; earlier periods show “—”. ${mode === 'month' ? esc(r.code + ' is ' + r.frequency.toLowerCase() + ', due ' + dueText(r).toLowerCase() + '.') : 'Quarterly, semi-annual and annual reports show the period that includes the chosen month.'}</div>
    </section>
    <section class="panel" id="cell-detail" hidden></section>`;
}

function wireMonitor(refs, rms, q) {
  $$('[data-f]').forEach((s) => { s.onchange = () => {
    const p = new URLSearchParams(location.hash.split('?')[1] || ''); p.set(s.dataset.f, s.value); location.hash = '#/rms/monitor?' + p.toString(); }; });
  const pr = $('#mon-print'); if (pr) pr.onclick = () => window.print();
  $$('[data-cell]').forEach((td) => { td.onclick = () => {
    $$('td.c.picked').forEach((x) => x.classList.remove('picked')); td.classList.add('picked');
    const [oid, rid, p] = td.dataset.cell.split('|');
    const o = rms.offices.find((x) => x.id === oid), r = rms.reports.find((x) => x.id === rid);
    const st = cellStatus(rms, o, r, p);
    const box = $('#cell-detail'); box.hidden = false;
    const row = (k, v) => `<div class="t-row" style="grid-template-columns:150px 1fr"><small>${k}</small><span>${v}</span></div>`;
    const it = st.item;
    box.innerHTML = `<div class="panel-head"><h2>${esc(o.name)} · ${esc(r.code)} · ${esc(periodLabel(p))}</h2><span class="r">${pill(STATUS_TEXT[st.s], STATUS_PILL[st.s] || '')}</span></div>
      ${row('Due', st.due ? esc(fmtDate(st.due)) : 'No set due date')}
      ${it ? row(it.trackingNo ? 'Tracking No.' : 'Pending Code', `<span class="mono">${esc(numberOf(it))}</span> ${statusPill(it)}`) + row('Received', `${esc(fmtDate(it.receivedAt))}${it.receivedByName ? ' by ' + esc(it.receivedByName) : ''}${it.submittedBy ? ' · received from ' + esc(it.submittedBy) : ''}`)
        + row('Checklist', it.checklist ? checklistHtml(it) : '—')
        + row('History', historyHtml(it))
        : row('Received', st.s === 'untracked' ? 'Before monitoring started' : 'Nothing received yet')}
      ${row('Checklist required', r.perOffice ? `${itemsFor(r, o).length} ${esc((r.lineLabel || 'line').toLowerCase())}s (Office Setup)` : (r.checklist || []).map(esc).join(' · '))}`;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }; });
}

/* ================= Report Library ================= */
function libraryHtml(refs, rms, q) {
  const edit = canEditLibrary(refs);
  const used = (id) => rms.offices.filter((o) => (o.reportIds || []).includes(id)).length;
  const list = byGroup(rms, rms.reports);
  const cols = 'grid-template-columns:84px minmax(200px,1.6fr) minmax(170px,1fr) 90px 110px 56px';
  const inGroup = (gid) => rms.reports.filter((r) => r.groupId === gid).length;
  // Group headings between the rows when groups are in use.
  const useGroups = list.some((r) => groupName(rms, r));
  let curG = null;
  const head = (r) => { if (!useGroups) return ''; const g = groupName(rms, r) || 'No group'; if (g === curG) return ''; curG = g; return `<div class="rep-grp">${esc(g)}</div>`; };
  return `<div class="page">
    <div class="page-head"><div><h1>Report Library</h1><p>Office-wide list of reports the auditees submit. Kept by the Admin and SA Staff; used by all teams. It starts empty and grows as reports are added.</p></div>
      ${edit ? '<button class="btn primary" id="add-report">+ Add Report</button>' : ''}</div>
    <section class="panel rms-start"><div class="panel-head"><h2>Monitoring Starts With</h2>
        ${edit ? `<span class="r btn-row"><select class="input" id="st-m">${MONTHS_LONG.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}" ${rms.startPeriod.slice(5) === String(i + 1).padStart(2, '0') ? 'selected' : ''}>${m}</option>`).join('')}</select>
          <select class="input" id="st-y">${[0, 1, 2].map((k) => new Date().getFullYear() - k).map((y) => `<option ${rms.startPeriod.slice(0, 4) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <button class="btn" id="st-save">Save</button></span>` : `<span class="r"><b>${esc(periodLabel(rms.startPeriod))}</b></span>`}</div>
      <div class="note">The Submission Monitor tracks submissions from this month onward. Earlier periods show “—” instead of overdue.</div></section>
    <section class="panel" style="margin-top:20px"><div class="panel-head"><h2>Report Groups · ${rms.groups.length}</h2>${edit ? '<span class="r"><button class="btn" id="edit-groups">Edit Groups</button></span>' : ''}</div>
      ${rms.groups.length ? `<div class="note chips">${rms.groups.map((g) => pill(g.name + ' · ' + inGroup(g.id), 'blue')).join('')}</div>`
        : `<div class="note">No groups yet. The team decides its own groups (for example by what the reports contain), then assigns each report to one. Groups organize Receiving, the Submission Monitor and later the encoding.</div>`}</section>
    <section class="panel" style="margin-top:20px">
      <div class="panel-head"><h2>Reports · ${list.filter((r) => r.active !== false).length}</h2>${list.length ? '<span class="r"><label class="sr-only" for="find-rep">Search reports</label><input class="input" id="find-rep" placeholder="Search reports" style="width:200px"></span>' : ''}</div>
      ${list.length ? `<div class="t-head" style="${cols}"><span>Code</span><span>Report</span><span>Schedule</span><span>Checklist</span><span>Used by</span><span></span></div>
        <div id="rep-list">${list.map((r) => { const n = used(r.id); return `${head(r)}<div class="t-row ${r.active === false ? 'removed' : ''}" style="${cols}" data-find="${esc((r.code + ' ' + r.name).toLowerCase())}">
          <span class="mono"><b>${esc(r.code)}</b></span><span><b>${esc(r.name)}</b>${r.bulk ? ' ' + pill('Bulk', 'blue') : ''}${r.basis ? `<br><small>${esc(r.basis)}</small>` : ''}${r.active === false ? ' ' + pill('Inactive') : ''}</span>
          <span>${esc(r.frequency)}<br><small>${esc(dueText(r))}</small></span>
          <span>${r.perOffice ? `Per office<br><small>one line per ${esc((r.lineLabel || 'line').toLowerCase())}</small>` : `${(r.checklist || []).length} item${(r.checklist || []).length === 1 ? '' : 's'}`}</span>
          <span><small>${n ? n + ' office' + (n > 1 ? 's' : '') : 'Not used yet'}</small></span>
          <span>${edit ? `<button class="btn sm" data-edit-rep="${r.id}">Edit</button>` : `<button class="btn sm" data-view-rep="${r.id}">View</button>`}</span></div>`; }).join('')}</div>`
      : `<div class="empty"><b>No reports yet</b>${edit ? 'Add the first report with its code, schedule and checklist. Teams can then tick it for their offices.' : 'The Admin or SA Staff add the reports here. Teams can then tick them for their offices.'}</div>`}
    </section></div>`;
}

function wireLibrary(refs, rms) {
  const add = $('#add-report'); if (add) add.onclick = () => editReport(refs, rms, null);
  const eg = $('#edit-groups'); if (eg) eg.onclick = () => editGroups(refs, rms);
  const st = $('#st-save'); if (st) st.onclick = async () => {
    await store.save('rms_settings', 'office', { startPeriod: $('#st-y').value + '-' + $('#st-m').value }, by(refs));
    toast('Monitoring start saved.', 'ok'); };
  $$('[data-edit-rep]').forEach((b) => { b.onclick = () => editReport(refs, rms, b.dataset.editRep); });
  $$('[data-view-rep]').forEach((b) => { b.onclick = () => viewReport(rms, b.dataset.viewRep); });
  const f = $('#find-rep'); if (f) f.oninput = () => { const v = f.value.trim().toLowerCase(); $$('#rep-list .t-row').forEach((r) => { r.hidden = v && !r.dataset.find.includes(v); }); $$('#rep-list .rep-grp').forEach((h) => { h.hidden = !!v; }); };
}

// The team's report groups: add, rename, reorder, remove. Reports in a removed group show under "No group".
async function editGroups(refs, rms) {
  const list = rms.groups.map((g) => ({ ...g }));
  let out = null;
  const res = await modal({
    title: 'Report Groups',
    body: `<p class="hint">Name the groups the way the team works, for example by what the reports contain. Each report is then assigned to one group in its Edit window.</p>
      <div class="list-edit" id="g-items"></div>`,
    onOpen: (bg) => {
      const keep = () => { $$('[data-g]', bg).forEach((x) => { list[+x.dataset.g].name = x.value; }); };
      const draw = () => {
        $('#g-items', bg).innerHTML = list.map((g, i) => { const n = rms.reports.filter((r) => r.groupId === g.id).length; return `<div><span class="n">${i + 1}.</span><input class="input txt" data-g="${i}" value="${esc(g.name)}" aria-label="Group name">
            <small class="hint">${n} report${n === 1 ? '' : 's'}</small>
            <button type="button" class="mini" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button>
            <button type="button" class="mini" data-rm="${i}" aria-label="Remove">×</button></div>`; }).join('')
          + `<div><input class="input" id="g-new" placeholder="+ New group name, then press Enter"></div>`;
        $$('[data-rm]', bg).forEach((b) => { b.onclick = () => { keep(); list.splice(+b.dataset.rm, 1); draw(); }; });
        $$('[data-up]', bg).forEach((b) => { b.onclick = () => { keep(); const i = +b.dataset.up; [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); }; });
        const nw = $('#g-new', bg);
        nw.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); keep(); const v = nw.value.trim(); if (v) { list.push({ id: newId('grp'), name: v }); draw(); $('#g-new', bg).focus(); } } };
      };
      draw();
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save Groups', cls: 'primary', value: 'save', check: (bg) => {
      $$('[data-g]', bg).forEach((x) => { list[+x.dataset.g].name = x.value.trim(); });
      const nw = $('#g-new', bg).value.trim(); if (nw) list.push({ id: newId('grp'), name: nw });
      if (list.some((g) => !g.name)) { toast('Every group needs a name.', 'bad'); return false; }
      const names = list.map((g) => g.name.toLowerCase());
      if (new Set(names).size !== names.length) { toast('Two groups have the same name.', 'bad'); return false; }
      out = list; return true;
    } }]
  });
  if (res !== 'save') return;
  await store.save('rms_settings', 'groups', { list: out }, by(refs));
  toast('Report groups saved.', 'ok');
}

function viewReport(rms, id) {
  const r = rms.reports.find((x) => x.id === id);
  modal({ title: `${r.code} · ${r.name}`, body: `<p><b>Schedule:</b> ${esc(r.frequency)} · ${esc(dueText(r))}</p><p><b>Group:</b> ${esc(groupName(rms, r) || 'No group')}${r.bulk ? ' · Bulk (always For Verification)' : ''}</p>${r.basis ? `<p><b>Legal basis:</b> ${esc(r.basis)}</p>` : ''}
    ${r.perOffice ? `<p><b>Checklist:</b> each office has its own list (one line per ${esc((r.lineLabel || 'line').toLowerCase())}), set in Office Setup.</p>` : ''}
    <div><span class="legend">${r.perOffice ? 'Each line includes' : 'Checklist'}</span><ol class="rms-ol">${(r.checklist || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ol></div>` });
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
      <div class="two"><div class="field"><label for="r-basis">Legal Basis (optional)</label><input class="input" id="r-basis" value="${esc(r.basis || '')}" placeholder="e.g. COA Circular No. ___"></div>
        <div class="field"><label for="r-group">Group</label><select class="input" id="r-group"><option value="">No group</option>${rms.groups.map((g) => `<option value="${g.id}" ${r.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
          <span class="hint">${rms.groups.length ? 'Groups are set in Report Groups.' : 'No groups yet. Add them with Edit Groups.'}</span></div></div>
      <div class="two"><div class="field"><label for="r-freq">Frequency</label><select class="input" id="r-freq">${FREQ.map((f) => `<option ${r.frequency === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="field"><label for="r-due">Due</label><select class="input" id="r-due">
          <option value="after" ${r.due.kind === 'after' ? 'selected' : ''}>Within a number of days after the period ends</option>
          <option value="day" ${r.due.kind === 'day' ? 'selected' : ''}>On a set day of the following period</option>
          <option value="none" ${r.due.kind === 'none' ? 'selected' : ''}>No set due date</option></select>
          <div class="rms-due-n"><input class="input" id="r-due-n" type="number" min="1" max="31" value="${esc(r.due.days || r.due.day || 10)}"><span id="r-due-unit" class="hint"></span></div>
          <span class="hint">Used to flag late and missing submissions.</span></div></div>
      <div class="field rcv-per"><label><input type="checkbox" id="r-per" ${r.perOffice ? 'checked' : ''}> Each office has its own list (e.g. BRS: one line per bank account)</label>
        <div class="rms-due-n" id="r-per-box"><label for="r-line" class="hint">Each line is a</label><input class="input" id="r-line" style="width:200px" value="${esc(r.lineLabel || 'Bank account')}"></div>
        <span class="hint">The office's lines (e.g. the Province's 75 bank accounts) are entered in Office Setup. At receiving, the JO ticks which lines came in.</span></div>
      <div><span class="legend" id="r-items-legend">Checklist (documents that make up this report)</span>
        <div class="list-edit" id="r-items"></div>
        <span class="hint">During receiving, the receiver ticks which of these were actually submitted.</span></div>
      <div class="field"><label><input type="checkbox" id="r-bulk" ${r.bulk ? 'checked' : ''}> Bulk report (e.g. with DVs): always received For Verification, even when an auditor receives it</label></div>
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
      const perState = () => { const on = $('#r-per', bg).checked; $('#r-per-box', bg).hidden = !on;
        $('#r-items-legend', bg).textContent = on ? 'What each line includes (a reminder for the receiver; optional)' : 'Checklist (documents that make up this report)'; };
      $('#r-per', bg).onchange = perState; perState();
      const dueState = () => { const k = $('#r-due', bg).value; $('.rms-due-n', bg).hidden = k === 'none'; $('#r-due-unit', bg).textContent = k === 'after' ? 'days after the period ends' : 'day of the following period'; };
      $('#r-due', bg).onchange = dueState; draw(); dueState();
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save Report', cls: 'primary', value: 'save', check: (bg) => {
      const pending = $('#r-new', bg).value.trim(); if (pending) items.push(pending);
      const code = $('#r-code', bg).value.trim().toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9]{1,10}$/.test(code)) { toast('Enter a report code: letters and numbers only, up to 10.', 'bad'); return false; }
      if (rms.reports.some((x) => x.id !== id && x.code === code)) { toast(`Report code ${code} is already used.`, 'bad'); return false; }
      const name = $('#r-name', bg).value.trim(); if (!name) { toast('Enter the report name.', 'bad'); return false; }
      const per = $('#r-per', bg).checked, lineLabel = $('#r-line', bg).value.trim() || 'Line';
      if (!per && !items.length) { toast('Add at least one document to the checklist.', 'bad'); return false; }
      const kind = $('#r-due', bg).value, n = parseInt($('#r-due-n', bg).value, 10);
      if (kind !== 'none' && !(n >= 1 && n <= 31)) { toast('Enter the number of days (1 to 31).', 'bad'); return false; }
      out = { code, name, basis: $('#r-basis', bg).value.trim(), frequency: $('#r-freq', bg).value,
        due: kind === 'none' ? { kind } : kind === 'after' ? { kind, days: n } : { kind, day: n }, checklist: items, active: id ? $('#r-active', bg).value === 'yes' : true,
        groupId: $('#r-group', bg).value, bulk: $('#r-bulk', bg).checked, perOffice: per, ...(per ? { lineLabel } : {}) };
      return true;
    } }]
  });
  if (res !== 'save') return;
  await store.save('rms_reports', id || newId('rep'), out, by(refs));
  toast(id ? 'Report saved.' : 'Report added. Teams can now tick it for their offices.', 'ok');
}

/* ================= Office Setup ================= */
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
  const chips = (o) => (o && (o.reportIds || []).length) ? (o.reportIds.map(repCode).filter(Boolean).sort((x, y) => x.code.localeCompare(y.code)).map((r) => {
    if (!r.perOffice) return pill(r.code, r.active === false ? '' : 'blue');
    const n = ((o.lists || {})[r.id] || []).length;
    return pill(`${r.code} · ${n}`, n ? 'blue' : 'warn'); }).join('')) : '<small>—</small>';
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
      <div id="o-lists"></div>
      <div class="field"><label for="o-note">Extra requirement for this office only (optional)</label><input class="input" id="o-note" value="${esc(o.note || '')}" placeholder="e.g. Copy of resolution for the 20% DF projects"></div>
      ${isExtra && extra !== 'new' ? `<div class="field"><label for="o-active">Status</label><select class="input" id="o-active"><option value="yes" ${o.active !== false ? 'selected' : ''}>Active</option><option value="no" ${o.active === false ? 'selected' : ''}>Inactive (no longer submits)</option></select></div>` : ''}`,
    // Reports with an office's own list (e.g. BRS): one box per ticked report, one line per bank account.
    onOpen: (bg) => {
      const typed = { ...(o.lists || {}) };
      const draw = () => {
        $$('textarea[data-list]', bg).forEach((t) => { typed[t.dataset.list] = t.value.split('\n').map((x) => x.trim()).filter(Boolean); });
        const ticked = $$('input[name=rep]:checked', bg).map((x) => rms.reports.find((r) => r.id === x.value)).filter((r) => r && r.perOffice);
        $('#o-lists', bg).innerHTML = ticked.map((r) => { const lines = typed[r.id] || [];
          return `<div class="field"><label for="ol-${r.id}">${esc(r.code)} · ${esc(r.lineLabel || 'Line')}s of this office <small class="hint" data-n="${r.id}">${lines.length} listed</small></label>
            <textarea class="input mono" id="ol-${r.id}" data-list="${r.id}" rows="${Math.min(10, Math.max(4, lines.length + 1))}" placeholder="One per line, e.g. General Fund – LBP 1234-5678-90">${esc(lines.join('\n'))}</textarea>
            <span class="hint">One ${esc((r.lineLabel || 'line').toLowerCase())} per line. You can paste a column from Excel.</span></div>`; }).join('');
        $$('textarea[data-list]', bg).forEach((t) => { t.oninput = () => { const n = t.value.split('\n').filter((x) => x.trim()).length; $(`[data-n="${t.dataset.list}"]`, bg).textContent = n + ' listed'; }; });
      };
      $$('input[name=rep]', bg).forEach((x) => { x.addEventListener('change', draw); });
      draw();
      bg._lists = () => { const out = { ...typed }; $$('textarea[data-list]', bg).forEach((t) => { out[t.dataset.list] = [...new Set(t.value.split('\n').map((x) => x.trim()).filter(Boolean))]; }); return out; };
    },
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', value: 'save', check: (bg) => {
      const code = $('#o-code', bg).value.trim().toUpperCase().replace(/\s+/g, '');
      const name = isExtra ? $('#o-name', bg).value.trim() : '';
      if (isExtra && !name) { toast('Enter the office name.', 'bad'); return false; }
      if (!code) { toast('Enter the office code.', 'bad'); return false; }
      if (!/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(code) || code.length > 20) { toast('Office code: letters, numbers and single hyphens only (e.g. MAD-ABB).', 'bad'); return false; }
      const mine = extra === 'new' ? null : isExtra ? o.id : a.main?.id;
      const dup = rms.offices.find((x) => x.id !== mine && x.code === code);
      if (dup) { toast(`Office code ${code} is already used by ${dup.name}.`, 'bad'); return false; }
      out = { code, ...(isExtra ? { name } : {}), reportIds: $$('input[name=rep]:checked', bg).map((x) => x.value), note: $('#o-note', bg).value.trim(), lists: bg._lists(),
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
