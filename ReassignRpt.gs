/**
 * Reassigned positions report (v172). For every position that has had more than one recruiter: how long each recruiter held it, what they
 * achieved while they held it, and the original start and original joining date of the position across its replacement chain.
 * Read-only; leads only. Stints come from Position_Recruiters (v163); earlier reassignments are rebuilt from the Audit_Log change log
 * and flagged; with neither, the report says the history was not recorded rather than guessing.
 * A stint runs from its start day up to, but not including, the day it ended: the day of the reassignment belongs to the new recruiter.
 * The still-active stint includes today. Working days are Monday to Saturday, less the days the position was on hold.
 */
const REASSIGN_MAX_ = 300;
const REASSIGN_METRICS_ = ['recv', 'rev', 'shared', 'short', 'intv', 'sel', 'offers', 'joined', 'backouts'];

function rsDay_(v) { return ymd_(v) || ''; }

/** Calendar days in [from, to) . */
function rsDays_(from, to) { return from && to && to > from ? daysBetween_(from, to) : 0; }

/** Mon to Sat days in [from, to) that are not inside a hold range ([[a,b]] inclusive dates). */
function rsWorkDays_(from, to, holds) {
  let n = 0, d = from, guard = 0;
  while (d && to && d < to && guard++ < 4000) {
    const p = d.split('-'), wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    if (wd !== 0 && !holds.some(function (h) { return d >= h[0] && d <= h[1]; })) n++;
    d = addDays_(d, 1);
  }
  return n;
}
function rsHoldDays_(from, to, holds) {
  let n = 0, d = from, guard = 0;
  while (d && to && d < to && guard++ < 4000) {
    if (holds.some(function (h) { return d >= h[0] && d <= h[1]; })) n++;
    d = addDays_(d, 1);
  }
  return n;
}

/** The funnel columns of the report from one pipeline event (null = not a report column). */
function rsMetricOfEvent_(metric) {
  return { Sourced: 'recv', Screened: 'rev', Shared: 'shared', Confirmed: 'short', Technical: 'intv', HR: 'intv', Docs: 'sel' }[metric] || null;
}
/** The same columns from a typed Daily-log row. */
function rsTypedCounts_(row, day) {
  const typed = typedMetrics_(day), out = {};
  const map = { CV_Sourced: 'recv', CV_Reviewed: 'rev', CV_Shared_Dept: 'shared', Shortlisted_Dept: 'short', Interviews_Done: 'intv', Selected_Final: 'sel' };
  Object.keys(map).forEach(function (k) { if (typed.indexOf(k) >= 0 && Number(row[k])) out[map[k]] = Number(row[k]); });
  return out;
}

/** { Line_ID: { day: {metric: n} } } from the typed log and the pipeline, counted exactly as the Daily review does for each day. */
function rsCountIndex_(from, to) {
  const idx = {};
  const add = function (line, day, m, n) { const l = idx[line] = idx[line] || {}, d = l[day] = l[day] || {}; d[m] = (d[m] || 0) + n; };
  readTableFrom_(T.FUNNEL.name, 'Entry_Date', from).rows.forEach(function (r) {
    const day = rsDay_(r.Entry_Date); if (!day || day < from || day > to) return;
    const c = rsTypedCounts_(r, day); Object.keys(c).forEach(function (m) { add(String(r.Line_ID), day, m, c[m]); });
  });
  const cut = cutover_(), f0 = from > cut ? from : cut;
  if (to >= f0) pipelineEvents_(f0, to).forEach(function (ev) {
    const m = rsMetricOfEvent_(ev.metric); if (!m || derivedMetrics_(ev.day).indexOf(ev.metric) < 0) return;
    add(String(ev.line), ev.day, m, 1);
  });
  return idx;
}

/** The stints of a position, oldest first: [{name, role, from, to (exclusive, '' while active), active, source}]. */
function rsStints_(line, prRows, auditRows, today) {
  const start = tatStart_(line) || rsDay_(line.Receipt_Date);
  const own = prRows.filter(function (r) { return String(r.Line_ID) === String(line.Line_ID); }).map(function (r) {
    return { name: String(r.Recruiter || '').trim(), role: String(r.Role), from: rsDay_(r.Assigned_On) || start, to: rsDay_(r.Ended_On), active: String(r.Status) === 'Active', source: 'stint record', by: String(r.Created_By || '') };
  }).filter(function (s) { return s.name; });
  const leads = own.filter(function (s) { return s.role === 'Lead'; }).sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
  if (!leads.length && String(line.Recruiter || '').trim()) leads.push({ name: String(line.Recruiter).trim(), role: 'Lead', from: rsDay_(line.Assigned_On) || start, to: '', active: true, source: 'current recruiter', by: '' });
  // reassignments made before the stint records existed: the Audit_Log has old -> new with the time
  const changes = auditRows.filter(function (a) { return String(a.Record_ID) === String(line.Line_ID) && String(a.Field) === 'Recruiter' && String(a.Old_Value || '').trim(); })
    .map(function (a) { return { oldV: String(a.Old_Value).trim(), newV: String(a.New_Value || '').trim(), day: rsDay_(a.Timestamp) }; })
    .sort(function (a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : 0; });
  const firstFrom = leads.length ? leads[0].from : today, rebuilt = [];
  let prev = start;
  changes.forEach(function (c) {
    if (c.day <= firstFrom && !leads.some(function (s) { return s.name.toLowerCase() === c.oldV.toLowerCase() && s.from === prev && s.to === c.day; }) && c.day > (prev || '')) {
      rebuilt.push({ name: c.oldV, role: 'Lead', from: prev, to: c.day, active: false, source: 'change log', by: '' });
    }
    prev = c.day;
  });
  const tagged = own.filter(function (s) { return s.role !== 'Lead'; });
  return { stints: rebuilt.concat(leads), tagged: tagged, incomplete: !rebuilt.length && leads.length > 0 && leads[0].by === 'migration' && leads[0].from > start };
}

/** Root, forward chain, original start and joiners of the replacement chain a position belongs to. */
function rsChain_(line, byId, childOf, cands) {
  let root = line, guard = 0;
  while (String(root.Parent_Line_ID || '').trim() && byId[root.Parent_Line_ID] && guard++ < 20) root = byId[root.Parent_Line_ID];
  const chain = [root]; guard = 0;
  let cur = root;
  while (guard++ < 20) { const nx = childOf[String(cur.Line_ID)]; if (!nx || chain.indexOf(nx) >= 0) break; chain.push(nx); cur = nx; }
  const joins = chain.filter(function (l) { return rsDay_(l.Actual_DOJ); }).map(function (l) { return { on: rsDay_(l.Actual_DOJ), who: String((cands[l.Candidate_ID] || {}).Name || l.Candidate_ID || ''), mrf: String(l.MRF_No || '') }; })
    .sort(function (a, b) { return a.on < b.on ? -1 : a.on > b.on ? 1 : 0; });
  return {
    chain: chain.map(function (l) { return { mrf: String(l.MRF_No || ''), status: positionStatus_(l), line: String(l.Line_ID) }; }),
    received: rsDay_(root.Receipt_Date), start: tatStart_(root) || rsDay_(root.Receipt_Date),
    firstJoin: joins[0] || null, lastJoin: joins.length > 1 && joins[joins.length - 1].on !== joins[0].on ? joins[joins.length - 1] : null
  };
}

/** The whole report from plain inputs (so it can be tested without sheets). d = {lines, prRows, auditRows, counts, cands, today, from, to, recruiter, lineId}. */
function reassignBuild_(d) {
  const byId = {}, childOf = {};
  d.lines.forEach(function (l) { byId[String(l.Line_ID)] = l; });
  d.lines.forEach(function (l) { const p = String(l.Parent_Line_ID || '').trim(); if (p) childOf[p] = l; });
  const out = [];
  d.lines.forEach(function (l) {
    if (positionStatus_(l) === 'Removed') return;
    if (d.lineId && String(l.Line_ID) !== String(d.lineId)) return;
    const st = rsStints_(l, d.prRows, d.auditRows, d.today), all = st.stints;
    if (all.length < 2) return;
    // in scope when a reassignment (a stint after the first) starts inside the range
    const inRange = all.slice(1).some(function (s) { return s.from >= d.from && s.from <= d.to; });
    if (!inRange && !d.lineId) return;
    if (d.recruiter && !all.concat(st.tagged).some(function (s) { return s.name.toLowerCase() === String(d.recruiter).toLowerCase(); })) return;
    const holds = holdRanges_(l), cnt = d.counts[String(l.Line_ID)] || {};
    const dated = { offers: rsDay_(l.Offer_Date), joined: rsDay_(l.Actual_DOJ), backouts: rsDay_(l.Backout_Date) };
    const rows = all.concat(st.tagged).map(function (s) {
      const end = s.to || addDays_(d.today, 1), from = s.from;
      const c = {}; REASSIGN_METRICS_.forEach(function (m) { c[m] = 0; });
      Object.keys(cnt).forEach(function (day) { if (day >= from && day < end) Object.keys(cnt[day]).forEach(function (m) { c[m] += cnt[day][m]; }); });
      Object.keys(dated).forEach(function (m) { if (dated[m] && dated[m] >= from && dated[m] < end) c[m] += 1; });
      const days = rsDays_(from, end), work = rsWorkDays_(from, end, holds), hold = rsHoldDays_(from, end, holds);
      const per = {}; ['recv', 'rev', 'shared', 'short', 'intv'].forEach(function (m) { per[m] = work > 0 ? Math.round(c[m] / work * 10) / 10 : null; });
      return { name: s.name, role: s.role, from: from, to: s.to, active: !!s.active && !s.to, days: days, hold: hold, workDays: work, counts: c, perDay: per, source: s.source };
    });
    const ch = rsChain_(l, byId, childOf, d.cands);
    const lead = rows.filter(function (r) { return r.role === 'Lead'; });
    out.push({ line: String(l.Line_ID), mrf: String(l.MRF_No || ''), position: String(l.Position || ''), grade: String(l.Grade || ''), dept: String(l.Dept || ''), status: positionStatus_(l),
      recruiter: String(l.Recruiter || ''), reassigned: lead.length - 1, received: ch.received, start: ch.start, firstJoin: ch.firstJoin, lastJoin: ch.lastJoin, chain: ch.chain,
      totals: { days: lead.reduce(function (a, r) { return a + r.days; }, 0), workDays: lead.reduce(function (a, r) { return a + r.workDays; }, 0) },
      stints: rows, incomplete: st.incomplete });
  });
  out.sort(function (a, b) { return a.mrf < b.mrf ? 1 : a.mrf > b.mrf ? -1 : 0; });
  return { positions: out.slice(0, REASSIGN_MAX_), truncated: out.length > REASSIGN_MAX_, total: out.length };
}

/** Reassigned positions (leads). opts = {from, to, recruiter, lineId}; default range = the current financial year. */
function apiReassignReport(opts) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see this report.');
  opts = opts || {};
  const today = ymd_(new Date()), now = new Date(), fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || '')) ? String(opts.from) : fy + '-04-01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to || '')) ? String(opts.to) : today;
  if (to < from) throw new Error('The end date is before the start date.');
  const lines = readTable_(T.MRF.name).rows;
  const prRows = posRecRows_();
  const auditRows = readTableFrom_('Audit_Log', 'Timestamp', '').rows.filter(function (a) { return String(a.Sheet) === T.MRF.name && String(a.Field) === 'Recruiter'; });
  const counts = rsCountIndex_('2025-04-01', today);
  const ids = []; lines.forEach(function (l) { if (rsDay_(l.Actual_DOJ) && l.Candidate_ID) ids.push(l.Candidate_ID); });
  const cands = candNames_(ids);
  const r = reassignBuild_({ lines: lines, prRows: prRows, auditRows: auditRows, counts: counts, cands: cands, today: today, from: from, to: to, recruiter: String(opts.recruiter || ''), lineId: String(opts.lineId || '') });
  r.from = from; r.to = to; r.today = today; r.recruiters = activeRecruiterNames_();
  return r;
}
