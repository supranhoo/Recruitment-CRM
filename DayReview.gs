/**
 * Daily recruiter summary: what each recruiter did on a given day.
 * Combines the recruiter's own note and task list (Daily_Summary), their activity
 * counts per position (Daily_Funnel), offers and joinings (MRF), candidates added,
 * and the changes they made in the app (Audit_Log).
 */
const DAY_STAGES = ['CV_Sourced', 'CV_Reviewed', 'HR_1st_Round', 'CV_Shared_Dept', 'Shortlisted_Dept', 'Interviews_Done', 'Selected_Final', 'Offers', 'Joined'];

/*
 * Scorecard from candidate moves (from the switch-over date). CVs sourced and CVs reviewed stay typed in the
 * Daily log; every other column is counted from the stage history and lists the candidates behind the number.
 */
const TYPED_METRICS_ = ['CV_Sourced', 'CV_Reviewed'];
const PIPE_METRICS_ = ['HR_1st_Round', 'CV_Shared_Dept', 'Shortlisted_Dept', 'Interviews_Done', 'Selected_Final', 'Offers', 'Joined'];
function scorecardDerived_(date) { return String(date) >= cutover_(); }
function pipelineMetrics_(h) {
  const o = String(h.Outcome || ''), to = String(h.To_Stage || ''), from = String(h.From_Stage || '');
  if (String(h.Changed_By) === 'migration' || /^(Reconciled|Moved|Unlinked|Removed)$/.test(o)) return [];
  if (o === 'Backout') return ['Backouts'];
  if (from === to) return [];
  const m = [];
  if (to === 'Screened') m.push('HR_1st_Round');
  if (to === 'Shared') m.push('CV_Shared_Dept');
  if (to === 'Confirmed') { m.push('Shortlisted_Dept'); if (/^Suitable/i.test(o)) m.push('Interviews_Done', 'Selected_Final'); }   // fast-track: the department's written confirmation is the interview and the selection
  if (to === 'Technical' || to === 'HR') m.push('Interviews_Done');
  if (to === 'HR' && /select/i.test(o)) m.push('Selected_Final');
  if (to === 'Offer') m.push('Offers');
  if (to === 'Joined') m.push('Joined');
  return m;
}
/**
 * Scorecard events between two dates (inclusive), credited to the position's recruiter.
 * Cards removed as linked in error (or at the switch-over clean-up) count for nothing. A backward move by the
 * head never counts, and it cancels the earlier forward moves it undid (even on earlier days).
 */
function pipelineEvents_(from, to) {
  const lines = {}; readTable_(T.MRF.name).rows.forEach(function (l) { lines[l.Line_ID] = l; });
  const removed = {}; readTable_(T.APP.name).rows.forEach(function (a) { if (String(a.Status) === 'Removed') removed[a.App_ID] = true; });
  const rows = readTableFrom_(T.HIST.name, 'Changed_At', from).rows.filter(function (h) { const d = ymd_(h.Changed_At); return d && d >= from && !removed[h.App_ID]; })
    .sort(function (a, b) { return (a.Changed_At instanceof Date ? a.Changed_At.getTime() : 0) - (b.Changed_At instanceof Date ? b.Changed_At.getTime() : 0); });
  const cands = candNames_(rows.map(function (h) { return h.Candidate_ID; }));
  const out = [], byApp = {};
  rows.forEach(function (h) {
    const fi = STAGES.indexOf(String(h.From_Stage)), ti = STAGES.indexOf(String(h.To_Stage));
    if (fi >= 0 && ti >= 0 && ti < fi) {
      (byApp[h.App_ID] || []).forEach(function (ev) { if (STAGES.indexOf(ev.stage) > ti) ev.void = true; });
      return;
    }
    pipelineMetrics_(h).forEach(function (m) {
      const l = lines[h.Line_ID] || {}, c = cands[h.Candidate_ID] || {};
      const ev = { day: ymd_(h.Changed_At), metric: m, stage: String(h.To_Stage), recruiter: String(l.Recruiter || h.Recruiter || ''), line: String(h.Line_ID), app: String(h.App_ID),
        name: String(c.Name || h.Candidate_ID), position: String(l.Position || ''), mrf: String(l.MRF_No || ''), dept: String(l.Dept || ''),
        grade: String(l.Grade || ''), outcome: String(h.Outcome || ''), time: fmt_(h.Changed_At, TZ, 'HH:mm') };
      out.push(ev); (byApp[h.App_ID] = byApp[h.App_ID] || []).push(ev);
    });
  });
  return out.filter(function (ev) { return !ev.void && ev.day <= to; });
}

function recruiterByEmail_() {
  const map = {};
  readTable_('Users').rows.forEach(function (r) {
    if (r.Email) map[String(r.Email).trim().toLowerCase()] = String(r.Recruiter_Name || r.Name).trim();
  });
  return map;
}

function dayData_(date, onlyRecruiter) {
  const byEmail = recruiterByEmail_();
  const lines = readTable_(T.MRF.name).rows;
  const lineById = {};
  lines.forEach(function (l) { lineById[l.Line_ID] = l; });
  const recs = {};
  const blank = function (name) {
    const f = {}; DAY_STAGES.forEach(function (k) { f[k] = 0; });
    return { recruiter: name, overview: '', tasks: [], summaryId: '', updatedAt: '', funnel: f, backouts: 0,
      byPosition: {}, work: {}, candidates: [], offers: [], joined: [], people: {} };
  };
  const get = function (name) {
    name = String(name || 'Unassigned').trim() || 'Unassigned';
    if (onlyRecruiter && name.toLowerCase() !== onlyRecruiter.toLowerCase()) return null;
    return recs[name] = recs[name] || blank(name);
  };
  readTable_('M_Recruiters').rows.forEach(function (r) { if (String(r.Active) !== 'No') get(r.Recruiter); });

  const derived = scorecardDerived_(date);
  readTableFrom_(T.FUNNEL.name, 'Entry_Date', date).rows.forEach(function (e) {
    if (ymd_(e.Entry_Date) !== date) return;
    const r = get(e.Recruiter); if (!r) return;
    const l = lineById[e.Line_ID] || {};
    const g = r.byPosition[e.Line_ID] = r.byPosition[e.Line_ID] || { line: e.Line_ID, mrf: String(e.MRF_No || l.MRF_No || ''),
      position: String(l.Position || ''), dept: String(l.Dept || ''), grade: String(l.Grade || ''), remarks: [] };
    (derived ? TYPED_METRICS_ : FUNNEL_METRICS).forEach(function (m) {
      const n = Number(e[m]) || 0;
      g[m] = (g[m] || 0) + n; r.funnel[m] += n;
    });
    if (e.Remarks) g.remarks.push(String(e.Remarks));
    if (e.FB_From_Dept) (g.feedback = g.feedback || []).push(String(e.FB_From_Dept));
  });

  if (derived) {
    pipelineEvents_(date, date).forEach(function (ev) {
      const r = get(ev.recruiter); if (!r) return;
      (r.people[ev.metric] = r.people[ev.metric] || []).push({ name: ev.name, position: ev.position, mrf: ev.mrf, line: ev.line, app: ev.app, outcome: ev.outcome, time: ev.time });
      if (ev.metric === 'Backouts') { r.backouts++; return; }
      r.funnel[ev.metric]++;
      const g = r.byPosition[ev.line] = r.byPosition[ev.line] || { line: ev.line, mrf: ev.mrf, position: ev.position, dept: ev.dept, grade: ev.grade, remarks: [] };
      g[ev.metric] = (g[ev.metric] || 0) + 1;
      const brief = { line: ev.line, mrf: ev.mrf, position: ev.position, dept: ev.dept, name: ev.name };
      if (ev.metric === 'Offers') r.offers.push(brief);
      if (ev.metric === 'Joined') r.joined.push(brief);
    });
  } else {
    lines.forEach(function (l) {
      const r = get(l.Recruiter); if (!r) return;
      const brief = { line: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), dept: String(l.Dept) };
      if (ymd_(l.Offer_Date) === date) { r.funnel.Offers++; r.offers.push(brief); }
      if (ymd_(l.Actual_DOJ) === date) { r.funnel.Joined++; r.joined.push(brief); }
      if (ymd_(l.Backout_Date) === date) r.backouts++;
    });
  }

  readTableFrom_(T.CAND.name, 'Created_At', date).rows.forEach(function (c) {
    if (ymd_(c.Created_At) !== date || String(c.Created_By) === 'migration') return;
    const r = get(byEmail[String(c.Created_By).toLowerCase()] || c.Sourced_By); if (!r) return;
    r.candidates.push({ id: c.Candidate_ID, name: String(c.Name), position: String(c.Position || '') });
  });

  const label = function (a) {
    const s = String(a.Sheet), act = String(a.Action), f = String(a.Field), nv = String(a.New_Value);
    if (s === T.CAND.name) {
      if (act === 'Create') return 'Candidates added';
      if (f === 'CV_File_URL') return 'CVs uploaded';
      if (/Tech_Result|HR_Result/.test(f) && nv) return 'Interview results recorded';
      if (/Psychometric/.test(f)) return 'Psychometric tests updated';
      return 'Candidate records updated';
    }
    if (s === T.MRF.name) {
      if (act === 'Create') return 'MRF positions added';
      if (f === 'Offer_Sent' && nv === 'Yes') return 'Offers marked sent';
      if (f === 'Offer_Date' && nv) return 'Offer dates recorded';
      if (f === 'Actual_DOJ' && nv) return 'Joinings recorded';
      if (f === 'Backout_Date' && nv) return 'Backouts recorded';
      if (/^BGV_/.test(f)) return 'BGV details updated';
      if (/Panel/.test(f)) return 'Interview panels set';
      if (/Position_Status|Standard_TAT|Exemption_Days|Final_TAT|TAT_End_Date|Days_Taken|TAT_Result/.test(f)) return '';
      return 'Position details updated';
    }
    if (s === T.FUNNEL.name && act === 'Create') return 'Activity entries logged';
    if (s === T.PANEL.name && act === 'Create') return 'Panel unavailability logged';
    if (s === 'M_Panel_Members' && act === 'Create') return 'Panel members added';
    return '';
  };
  const seen = {};
  readTableFrom_('Audit_Log', 'Timestamp', date).rows.forEach(function (a) {
    if (ymd_(a.Timestamp) !== date) return;
    const name = byEmail[String(a.User).toLowerCase()];
    if (!name) return;
    const r = get(name); if (!r) return;
    const l = label(a); if (!l) return;
    const key = name + '|' + l + '|' + a.Record_ID;
    if (seen[key]) return;
    seen[key] = true;
    r.work[l] = (r.work[l] || 0) + 1;
  });

  readTable_('Daily_Summary').rows.forEach(function (s) {
    if (ymd_(s.Summary_Date) !== date) return;
    const r = get(s.Recruiter); if (!r) return;
    r.overview = String(s.Overview || '');
    try { r.tasks = JSON.parse(String(s.Tasks_JSON || '[]')); } catch (e) { r.tasks = []; }
    r.summaryId = String(s.Summary_ID);
    r.updatedAt = s.Updated_At instanceof Date ? fmt_(s.Updated_At, TZ, 'd MMM, HH:mm') : '';
  });

  lines.forEach(function (l) {
    if (['Open', 'Offered'].indexOf(statusAsOf_(l, date)) < 0) return;
    const r = get(l.Recruiter); if (!r) return;
    r.byPosition[l.Line_ID] = r.byPosition[l.Line_ID] || { line: l.Line_ID, mrf: String(l.MRF_No || ''), position: String(l.Position || ''), dept: String(l.Dept || ''), grade: String(l.Grade || ''), remarks: [], noActivity: true };
  });
  const dsList = dayStatusList_();
  const dsLines = []; Object.keys(recs).forEach(function (k) { Object.keys(recs[k].byPosition).forEach(function (id) { if (lineById[id]) dsLines.push(lineById[id]); }); });
  const dsMap = dayStatusMap_(dsLines, date);
  Object.keys(recs).forEach(function (k) { Object.keys(recs[k].byPosition).forEach(function (id) {
    const g = recs[k].byPosition[id]; g.day = dsMap[id] || null;
    if (g.noActivity && FUNNEL_METRICS.some(function (m) { return g[m]; })) g.noActivity = false;
  }); });
  const out = Object.keys(recs).map(function (k) {
    const r = recs[k];
    r.byPosition = Object.keys(r.byPosition).map(function (id) { return r.byPosition[id]; })
      .sort(function (a, b) { return ((a.noActivity ? 1 : 0) - (b.noActivity ? 1 : 0)) || ((b.CV_Reviewed || 0) + (b.CV_Sourced || 0) - (a.CV_Reviewed || 0) - (a.CV_Sourced || 0)) || String(a.position).localeCompare(String(b.position)); });
    r.dayStatusList = dsList;
    r.work = Object.keys(r.work).map(function (w) { return { label: w, count: r.work[w] }; }).sort(function (a, b) { return b.count - a.count; });
    r.active = DAY_STAGES.some(function (s) { return r.funnel[s] > 0; }) || r.work.length > 0 || !!r.overview || r.tasks.length > 0;
    return r;
  }).filter(function (r) { return r.recruiter !== 'Unassigned' || r.active; })
    .sort(function (a, b) { return (b.active - a.active) || a.recruiter.localeCompare(b.recruiter); });

  const moves = pipelineMoves_(date);
  out.forEach(function (r) { r.moves = moves[r.recruiter] || {}; if (Object.keys(r.moves).length) r.active = true; });
  readTable_(T.MRF.name).rows.forEach(function (l) {
    const s = positionStatus_(l); if ((CLOSED_OUTCOMES_.indexOf(s) < 0 && s !== 'Removed') || !l.Closure_Reason) return;
    if (ymd_(s === 'No Vacancy' ? l.No_Vacancy_Date : l.Not_Needed_Date) !== date) return;
    const r = get(String(l.Recruiter || '')); if (!r) return;
    (r.closures = r.closures || []).push({ mrf: String(l.MRF_No || l.Line_ID), position: String(l.Position || ''), outcome: s, reason: String(l.Closure_Reason), by: String(l.Closure_Requested_By || '') });
    r.active = true;
  });
  readTable_(T.MRF.name).rows.forEach(function (l) {
    if (String(l.Fill_Type || '') !== 'Internal' || ymd_(l.Internal_Decided_On) !== date) return;
    const r = get(String(l.Recruiter || '')); if (!r) return;
    (r.closures = r.closures || []).push({ mrf: String(l.MRF_No || l.Line_ID), position: String(l.Position || ''), outcome: 'Filled internally', reason: String(l.Internal_Employee || '') + (l.Internal_Effective_Date ? ' \u00b7 effective ' + fmt_(l.Internal_Effective_Date, TZ, 'd MMM yyyy') : '') + (l.Closure_Reason ? ' \u00b7 ' + String(l.Closure_Reason) : ''), by: String(l.Closure_Requested_By || '') });
    r.active = true;
  });
  const dt = dayTasks_(date);
  out.forEach(function (r) {
    const k = r.recruiter.toLowerCase();
    r.todo = { acts: dt.acts[k] || { done: 0, chased: 0, snoozed: 0 }, missed: dt.missed[k] || [] };
    if (r.todo.missed.length || r.todo.acts.done || r.todo.acts.chased) r.active = true;
  });
  const team = {}; DAY_STAGES.forEach(function (k) { team[k] = out.reduce(function (s, r) { return s + r.funnel[k]; }, 0); });
  const people = {}; out.forEach(function (r) { Object.keys(r.people || {}).forEach(function (m) { people[m] = (people[m] || []).concat(r.people[m].map(function (p) { return Object.assign({ recruiter: r.recruiter }, p); })); }); });
  return { date: date, stages: DAY_STAGES, recruiters: out, team: team, people: people, derived: derived, cutover: cutover_(),
    missedTotal: out.reduce(function (s, r) { return s + r.todo.missed.length; }, 0) };
}

/** Recruiters see their own day; the head and admin can see everyone. */
function apiDaySummary(date) {
  const u = currentUser_(); ensureSchema_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Pick a date.');
  const past = date < ymd_(new Date());
  let full = past ? daySnapGet_(date) : null;
  if (full && (full.recruiters || []).some(function (r) { return !r.dayStatusList; })) full = null;
  if (!full) { full = dayData_(date, ''); if (past) daySnapPut_(date, full); }
  return isLead_(u) ? full : dayForRecruiter_(full, u.recruiter);
}

/** Same result as dayData_(date, recruiter), taken from the whole-team data. */
function dayForRecruiter_(full, recruiter) {
  const want = String(recruiter || '').trim().toLowerCase();
  const recs = full.recruiters.filter(function (r) { return r.recruiter.toLowerCase() === want; });
  const team = {}; full.stages.forEach(function (k) { team[k] = recs.reduce(function (s, r) { return s + r.funnel[k]; }, 0); });
  const people = {}; recs.forEach(function (r) { Object.keys(r.people || {}).forEach(function (m) { people[m] = (people[m] || []).concat(r.people[m]); }); });
  return { date: full.date, stages: full.stages, recruiters: recs, team: team, people: people, derived: full.derived, cutover: full.cutover,
    missedTotal: recs.reduce(function (s, r) { return s + ((r.todo && r.todo.missed.length) || 0); }, 0) };
}

/*
 * Pre-computed daily review for past days. Past days rarely change, so the whole-team result is kept
 * (up to 6 hours) and rebuilt only when a write touches that day: a daily-log entry or day note for it,
 * or a position's offer / joining / backout date moving to or from it. Reassignments and team-list
 * changes clear every day. Today is always computed live.
 */
function daySnapVer_() {
  const c = CacheService.getScriptCache();
  let v = c.get('daysnap_ver');
  if (!v) { v = String(Date.now()); c.put('daysnap_ver', v, 21600); }
  return v;
}
/** The code version is part of the key, so a release never serves days cached by older code. */
const DAYSNAP_CODE_ = 'v58';
function daySnapKey_(date) { return 'daysnap_' + DAYSNAP_CODE_ + '_' + daySnapVer_() + '_' + date; }
function daySnapGet_(date) {
  try { const s = CacheService.getScriptCache().get(daySnapKey_(date)); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function daySnapPut_(date, data) {
  try { const s = JSON.stringify(data); if (s.length < 95000) CacheService.getScriptCache().put(daySnapKey_(date), s, 21600); } catch (e) { }
}
function daySnapDropAll_() {
  try { CacheService.getScriptCache().put('daysnap_ver', String(Date.now()), 21600); } catch (e) { }
}
function daySnapTouch_(table, changes, created, rec) {
  try {
    if (table === 'Users' || table === 'M_Recruiters') return daySnapDropAll_();
    const own = table === T.FUNNEL.name ? 'Entry_Date' : table === 'Daily_Summary' ? 'Summary_Date' : table === T.CAND.name ? 'Created_At' : '';
    const moving = table === T.MRF.name ? ['Offer_Date', 'Actual_DOJ', 'Backout_Date'] : [];
    const labels = table === T.MRF.name ? ['Recruiter', 'Position', 'Dept', 'Grade', 'MRF_No', 'Approval_Status', 'BGV_Prev_Org_Date', 'BGV_Required'] : [];
    if (!own && !moving.length) return;
    const dates = {};
    const src = created || rec;
    if (own && src && ymd_(src[own])) dates[ymd_(src[own])] = true;
    (changes || []).forEach(function (c) {
      if (labels.indexOf(c[0]) >= 0) dates.ALL = true;
      if (moving.indexOf(c[0]) >= 0 || c[0] === own) { if (c[1]) dates[String(c[1]).slice(0, 10)] = true; if (c[2]) dates[String(c[2]).slice(0, 10)] = true; }
    });
    if (created) moving.forEach(function (f) { const d = ymd_(created[f]); if (d) dates[d] = true; });
    if (dates.ALL) return daySnapDropAll_();
    const keys = Object.keys(dates).map(daySnapKey_);
    if (keys.length) CacheService.getScriptCache().removeAll(keys);
  } catch (e) { }
}

/** Saves a recruiter's day note and task list. Recruiters can update today and yesterday. */
function apiSaveDaySummary(data) {
  const u = currentUser_(); ensureSchema_();
  const date = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a date.');
  const today = ymd_(new Date());
  if (date > today) throw new Error('You cannot write a summary for a future date.');
  const yesterday = fmt_(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
  if (!isLead_(u) && date < yesterday) throw new Error('You can update today and yesterday only. Ask a TA Lead or the Head of HR to change older days.');
  const recruiter = isLead_(u) && data.recruiter ? String(data.recruiter) : u.recruiter;
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).slice(0, 40).map(function (t) {
    return { t: String(t.t || '').slice(0, 200), d: !!t.d };
  }).filter(function (t) { return t.t.trim(); });
  const patch = { Summary_Date: parseYmd_(date), Recruiter: recruiter, Overview: clean_(String(data.overview || '').slice(0, 3000)),
    Tasks_JSON: JSON.stringify(tasks) };
  const existing = readTable_('Daily_Summary', true).rows.filter(function (s) {
    return ymd_(s.Summary_Date) === date && String(s.Recruiter).toLowerCase() === recruiter.toLowerCase();
  })[0];
  const rec = existing ? update_(T.DAY, existing.Summary_ID, patch, u) : insert_(T.DAY, patch, u);
  return { summaryId: String(rec.Summary_ID), savedAt: fmt_(new Date(), TZ, 'HH:mm') };
}

/* ---------------- Day's Status (v56) ----------------
 * Each position's status on a given day: worked out automatically from the position (the Positions statuses),
 * which the recruiter can override with any active status from the list (Admin → Day's Status) and a note.
 * An override carries forward until the automatic status changes or the override is cleared. */
const DSTAT_SYSTEM_ = [['Open', 'blue'], ['Offered', 'orange'], ['Closed', 'green'], ['Replaced', 'purple'], ['On Hold', 'grey'], ['Not Needed', 'red'], ['No Vacancy', 'red']];
const DSTAT_COLOURS_ = ['blue', 'orange', 'green', 'purple', 'grey', 'red', 'teal', 'amber'];
T.DSTAT = { name: 'Day_Status', id: 'Day_Status_ID', prefix: 'DS-', width: 6, dates: [], editable: [] };
function dayStatusSchema_() {
  addSheet_('M_Day_Status', ['Status', 'Colour', 'Kind', 'Active', 'Sort', 'Description']);
  addSheet_(T.DSTAT.name, ['Day_Status_ID', 'Date', 'Line_ID', 'Status', 'Auto_Status', 'Note', 'Set_By', 'Set_At']);
  addColumns_(T.MRF.name, ['Fill_Type', 'Internal_Employee', 'Internal_Emp_Code', 'Internal_From_Dept', 'Internal_Decided_On', 'Internal_Effective_Date']);
  const t = readTable_('M_Day_Status', true);
  const have = {}; t.rows.forEach(function (r) { have[String(r.Status)] = true; });
  const add = DSTAT_SYSTEM_.filter(function (s) { return !have[s[0]]; }).map(function (s, i) { return [s[0], s[1], 'Automatic', 'Yes', t.rows.length + i + 1, 'Worked out from the position']; });
  if (add.length) t.sheet.getRange(t.sheet.getLastRow() + 1, 1, add.length, 6).setValues(add);
  dropStale_('M_Day_Status');
}
function dayStatusList_() {
  return readTable_('M_Day_Status').rows.map(function (r) {
    return { status: String(r.Status), colour: DSTAT_COLOURS_.indexOf(String(r.Colour)) >= 0 ? String(r.Colour) : 'grey', kind: String(r.Kind) === 'Automatic' ? 'Automatic' : 'Manual',
      active: String(r.Active) !== 'No', sort: Number(r.Sort) || 99, description: String(r.Description || '') };
  }).sort(function (a, b) { return a.sort - b.sort; });
}
/** A position's status as it stood on a date (today: the live status). '' = not yet received / approved. */
function statusAsOf_(l, d) {
  if (String(l.Approval_Status || '').trim().toUpperCase() === 'CREATED IN ERROR') return '';
  if (d >= ymd_(new Date())) return positionStatus_(l);
  const y = function (v) { return v instanceof Date ? ymd_(v) : ''; };
  const rep = y(l.Replaced_On); if (rep && rep <= d) return 'Replaced';
  if (String(l.Fill_Type || '') === 'Internal') { const e = y(l.Internal_Effective_Date), dc = y(l.Internal_Decided_On); if (e && e <= d) return 'Closed'; if (dc && dc <= d) return 'Offered'; }
  const doj = y(l.Actual_DOJ); if (doj && doj <= d) return 'Closed';
  const a = String(l.Approval_Status || '').trim().toUpperCase();
  const cl = a === 'NO VACANCY' ? y(l.No_Vacancy_Date) : (a === 'NOT NEEDED' || a === 'ON HOLD') ? y(l.Not_Needed_Date) : '';
  if (cl && cl <= d) return a === 'NO VACANCY' ? 'No Vacancy' : a === 'NOT NEEDED' ? 'Not Needed' : 'On Hold';
  const re = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g; let m; const log = String(l.Hold_Log || '');
  while ((m = re.exec(log))) { if (d >= m[1] && d < m[2]) return 'On Hold'; }
  const start = y(l.Approved_On) || y(l.Receipt_Date);
  if (!start || start > d) return '';
  const sent = String(l.Offer_Sent).toUpperCase() === 'YES', off = y(l.Offer_Date);
  if (sent && off && off <= d) return 'Offered';
  if (sent && !off && !doj && positionStatus_(l) === 'Offered') return 'Offered';
  return 'Open';
}
/** Day's status for many lines on one date: {lineId: {auto, status, override, note, by, since, colour}}. */
function dayStatusMap_(lines, d) {
  const list = dayStatusList_(), colour = {}, active = {};
  list.forEach(function (s) { colour[s.status] = s.colour; active[s.status] = s.active; });
  const ov = {};
  readTable_(T.DSTAT.name).rows.forEach(function (r) {
    const dt = ymd_(r.Date); if (!dt || dt > d) return;
    const cur = ov[r.Line_ID]; if (!cur || dt > cur._d || (dt === cur._d && ms_(r.Set_At) > ms_(cur.Set_At))) ov[r.Line_ID] = Object.assign({ _d: dt }, r);
  });
  const out = {};
  lines.forEach(function (l) {
    const auto = statusAsOf_(l, d), o = ov[l.Line_ID];
    const use = o && String(o.Status) && String(o.Auto_Status) === auto && active[String(o.Status)] && String(o.Status) !== auto;
    const st = use ? String(o.Status) : auto;
    out[l.Line_ID] = { auto: auto, status: st, override: !!use, note: use ? String(o.Note || '') : '', by: use ? String(o.Set_By || '') : '', since: use ? o._d : '', colour: colour[st] || 'grey' };
  });
  return out;
}
function apiDayStatusConfig() { currentUser_(); ensureSchema_(); return dayStatusList_(); }
function apiSaveDayStatusConfig(list) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can change the Day\u2019s Status list.');
  withLock_(function () {
    const t = readTable_('M_Day_Status', true), h = t.headers, col = function (k) { return h.indexOf(k) + 1; };
    const byName = {}; t.rows.forEach(function (r) { byName[String(r.Status).toLowerCase()] = r; });
    const adds = [];
    (list || []).forEach(function (x, i) {
      const name = clean_(String(x.status || '')).replace(/\s+/g, ' ').trim(), colourV = DSTAT_COLOURS_.indexOf(String(x.colour)) >= 0 ? String(x.colour) : 'grey';
      const desc = clean_(String(x.description || '')).trim().slice(0, 200), sort = i + 1;
      if (!name) throw new Error('Every status needs a name.');
      if (name.length > 40) throw new Error('Keep status names under 40 characters (' + name.slice(0, 20) + '\u2026).');
      const r = byName[name.toLowerCase()];
      if (r) {
        const sys = String(r.Kind) === 'Automatic';
        const act = sys ? 'Yes' : (x.active === false ? 'No' : 'Yes');
        const before = [String(r.Colour), String(r.Active), String(r.Description || ''), Number(r.Sort)].join('|');
        if (before !== [colourV, act, desc, sort].join('|')) {
          t.sheet.getRange(r._row, col('Colour')).setValue(colourV); t.sheet.getRange(r._row, col('Active')).setValue(act);
          t.sheet.getRange(r._row, col('Description')).setValue(jdmSafeText_(desc)); t.sheet.getRange(r._row, col('Sort')).setValue(sort);
          audit_(u, 'M_Day_Status', name, 'Update', 'Status', before, [colourV, act, desc, sort].join('|'));
        }
      } else {
        if (!x.isNew) return;
        adds.push([jdmSafeText_(name), colourV, 'Manual', x.active === false ? 'No' : 'Yes', sort, jdmSafeText_(desc)]);
        byName[name.toLowerCase()] = { Status: name };
        audit_(u, 'M_Day_Status', name, 'Create', 'Status', '', name);
      }
    });
    if (adds.length) t.sheet.getRange(t.sheet.getLastRow() + 1, 1, adds.length, 6).setValues(adds);
    dropStale_('M_Day_Status');
  });
  daySnapDropAll_();
  return dayStatusList_();
}
/** Sets (or clears, with status '') the day's status of a position for a date (default today). */
function apiSetDayStatus(lineId, status, note, date) {
  const u = currentUser_(); ensureSchema_();
  const line = lineOf_(lineId);
  if (!line) throw new Error('Position ' + lineId + ' was not found.');
  if (!canEditLine_(u, line)) throw new Error('Only the position\u2019s recruiter, a TA Lead or the Head of HR can set its day\u2019s status.');
  const today = ymd_(new Date()), d = date || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d > today) throw new Error('Pick today or an earlier date.');
  if (!isLead_(u) && d < addDays_(today, -1)) throw new Error('Recruiters can set the status for today and yesterday; ask a lead for older days.');
  const auto = statusAsOf_(line, d);
  status = String(status || '').trim(); note = clean_(String(note || '')).trim().slice(0, 300);
  if (status && status !== auto) {
    const s = dayStatusList_().filter(function (x) { return x.status === status; })[0];
    if (!s || !s.active) throw new Error('Pick a status from the list.');
    if (!note) throw new Error('Add a short note explaining the status.');
  }
  withLock_(function () {
    const t = readTable_(T.DSTAT.name, true);
    const ex = t.rows.filter(function (r) { return String(r.Line_ID) === String(lineId) && ymd_(r.Date) === d; })[0];
    const row = { Date: parseYmd_(d), Line_ID: String(lineId), Status: status === auto ? '' : status, Auto_Status: auto, Note: note, Set_By: u.email, Set_At: new Date() };
    if (ex) update_(T.DSTAT, ex.Day_Status_ID, row, u); else insert_(T.DSTAT, row, u);
  });
  daySnapDropAll_();
  return dayStatusMap_([line], d)[lineId];
}
/** My day: the recruiter's open positions with today's status. */
function apiMyDayStatuses(who) {
  const u = currentUser_(); ensureSchema_();
  const rec = isLead_(u) && who ? String(who) : u.recruiter;
  const today = ymd_(new Date());
  const lines = readTable_(T.MRF.name).rows.filter(function (l) { return String(l.Recruiter || '').trim().toLowerCase() === String(rec || '').trim().toLowerCase() && ['Open', 'Offered'].indexOf(positionStatus_(l)) >= 0; });
  const map = dayStatusMap_(lines, today);
  return { date: today, list: dayStatusList_(), rows: lines.map(function (l) { return Object.assign({ line: String(l.Line_ID), mrf: String(l.MRF_No || ''), position: String(l.Position || ''), dept: String(l.Dept || ''), grade: String(l.Grade || '') }, map[l.Line_ID]); })
    .sort(function (a, b) { return a.position.localeCompare(b.position); }) };
}
