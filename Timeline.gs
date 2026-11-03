/**
 * Where was each step of a candidate's card updated? Read-only, for the stage tabs on the card (leads only).
 *
 * The facts come from the card (Applications), the screening (Screenings), the interviews (Interviews) and the candidate's
 * interview fields (Candidates). The changes come from Stage_History (every stage move and status change) and from Audit_Log
 * (one row per changed field). Only fields on the whitelist below are ever returned, so a CTC, contact or other unrelated edit
 * on the same candidate never reaches the screen. Nothing is written.
 */
const TL_CAP_ = 500;               // most audit rows used for one card
const TL_VALUE_MAX_ = 300;         // longest old/new value returned
const TL_RATING_ = { M: 'Met', P: 'Partly', G: 'Gap' };

/** Per sheet: audited field -> label. Anything else in Audit_Log is ignored. */
const TL_FIELDS_ = {
  Applications: { Dept_Confirm_On: 'Department confirmed on', Dept_Confirm_By: 'Confirmed by (department)', Dept_Confirm_File: 'Department’s written confirmation',
    /* stage and status changes are read from Stage_History, which records each of them once */ },
  Screenings: { Answers_JSON: 'Answers and ratings', Items_JSON: 'Question list', Note: 'Screening note', Status: 'Screening status', Band: 'Fit band', Score_Pct: 'Score (%)',
    Met: 'Met', Partly: 'Partly met', Gaps: 'Gaps', SQ_Version: 'Questions version', JD_Version: 'JD version',
    Shared_On: 'Shared on', Shared_With: 'Shared with', Share_Reason: 'Reason for sharing' },
  Interviews: { Round: 'Round', Mode: 'Mode', Start: 'Interview date', Duration_Min: 'Duration (min)', Location: 'Location', Panel: 'Panel', Status: 'Interview status',
    Attendance_Confirmed: 'Attendance confirmed', Unavailable: 'Panel unavailable', Notes: 'Notes' },
  Candidates: { Tech_Interview_Date: 'Technical interview date', Tech_Interview_By: 'Technical interview by', Tech_Result: 'Technical result',
    HR_Interview_Date: 'HR interview date', HR_Interview_By: 'HR interview by', HR_Result: 'HR result',
    Psychometric_Status: 'Psychometric test status', Psychometric_Date: 'Psychometric test date', Psychometric_Score: 'Psychometric score' }
};
/** Which audited fields (and which stage moves) each tab shows. 'all' shows every whitelisted field and every move. */
const TL_TABS_ = {
  cv: { fields: { Screenings: ['Answers_JSON', 'Items_JSON', 'Note', 'Status', 'Band', 'Score_Pct', 'Met', 'Partly', 'Gaps', 'SQ_Version', 'JD_Version'] }, stages: ['Sourced', 'Screened'] },
  shared: { fields: { Screenings: ['Shared_On', 'Shared_With', 'Share_Reason'] }, stages: ['Shared'] },
  dept: { fields: { Applications: ['Dept_Confirm_On', 'Dept_Confirm_By', 'Dept_Confirm_File'] }, stages: ['Confirmed'] },
  tech: { fields: { Candidates: ['Tech_Interview_Date', 'Tech_Interview_By', 'Tech_Result', 'Psychometric_Status', 'Psychometric_Date', 'Psychometric_Score'],
    Interviews: ['Round', 'Mode', 'Start', 'Duration_Min', 'Location', 'Panel', 'Status', 'Attendance_Confirmed', 'Unavailable', 'Notes'] }, stages: ['Technical'] }
};

function tlWhen_(d) { return d instanceof Date && !isNaN(d) ? fmt_(d, TZ, 'd MMM yyyy, HH:mm') : String(d == null ? '' : d); }
function tlDay_(d) { return d instanceof Date && !isNaN(d) ? fmt_(d, TZ, 'd MMM yyyy') : String(d == null ? '' : d).slice(0, 10); }
function tlCut_(v) { v = String(v == null ? '' : v); return v.length > TL_VALUE_MAX_ ? v.slice(0, TL_VALUE_MAX_) + '…' : v; }
function tlJson_(v, fallback) { try { const o = JSON.parse(String(v || '')); return o && typeof o === 'object' ? o : fallback; } catch (e) { return fallback; } }

/** One answer as text: the answer and its rating. */
function tlAnswer_(x) {
  if (!x) return '';
  const a = String(x.a == null ? '' : x.a).trim(), r = TL_RATING_[x.r] || '';
  return a && r ? a + ' [' + r + ']' : a || (r ? '[' + r + ']' : '');
}

/** The per-question changes between two Answers_JSON values (question text from the card's own question list). */
function tlAnswerDiff_(oldJ, newJ, items) {
  const o = tlJson_(oldJ, null), n = tlJson_(newJ, null);
  if (!o && !n) return [];
  if (!o || !n) return [{ label: 'Answers and ratings', oldV: o ? 'recorded' : '', newV: n ? 'recorded' : '' }];
  const q = {}; (items || []).forEach(function (it) { if (it && it.id) q[it.id] = String(it.q || it.id); });
  const out = [], ids = Object.keys(o).concat(Object.keys(n).filter(function (k) { return !(k in o); }));
  ids.forEach(function (id) {
    const a = tlAnswer_(o[id]), b = tlAnswer_(n[id]);
    if (a !== b) out.push({ label: 'Answer: ' + tlCut_(q[id] || id).slice(0, 90), oldV: tlCut_(a), newV: tlCut_(b) });
  });
  return out;
}

/** A file or long text value shown in a short form. */
function tlValue_(sheet, field, v) {
  v = String(v == null ? '' : v);
  if (/_File$/.test(field)) return v ? 'a file' : '';
  if (sheet === 'Applications' && field === 'Stage') return STAGE_NAMES[v] || v;
  return tlCut_(v);
}

/**
 * Everything the stage tabs need for one card. Lead only (TA Lead, Head of HR, admin). Reads once; writes nothing.
 * Returns {appId, route, stage, status, auditFrom, capped, tabs:{cv,shared,dept,tech,all}}; each tab has
 * facts [[label, value]], changes [{ms, at, by, kind, ...}] newest first, and notes (what is not recorded).
 */
function apiAppTimeline(appId) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see where a card was updated.');
  const app = appOf_(appId), line = lineOf_(app.Line_ID) || {};
  const route = routeOf_(line), fast = route === 'Fast-track';
  const created = ymd_(app.Created_At);
  const hist = readTableFrom_(T.HIST.name, 'Changed_At', created).rows.filter(function (h) { return String(h.App_ID) === String(appId); })
    .sort(function (a, b) { return ms_(a.Changed_At) - ms_(b.Changed_At); });
  const scr = scrOf_(appId);
  const scrFull = scr ? scrClient_(scr, true) : null;
  const ivs = readTable_(T.INT.name).rows.filter(function (i) { return String(i.App_ID) === String(appId); }).sort(function (a, b) { return ms_(a.Start) - ms_(b.Start); });
  const cand = candRowFast_(app.Candidate_ID) || readTable_(T.CAND.name).rows.filter(function (c) { return c.Candidate_ID === app.Candidate_ID; })[0] || {};

  // Audit rows of the four records of this card, from the day the card was created.
  const ids = { Applications: {}, Screenings: {}, Interviews: {}, Candidates: {} };
  ids.Applications[String(appId)] = 1; if (scr) ids.Screenings[String(scr.Screen_ID)] = 1; ivs.forEach(function (i) { ids.Interviews[String(i.Interview_ID)] = 1; });
  ids.Candidates[String(app.Candidate_ID)] = 1;
  let auditFrom = created || (hist.length ? ymd_(hist[0].Changed_At) : '');
  if (!auditFrom) auditFrom = ymd_(new Date(Date.now() - 180 * 86400000));   // an old card without a creation date: the last six months
  const audit = [];
  let capped = false;
  const arows = readTableFrom_('Audit_Log', 'Timestamp', auditFrom).rows;
  for (let k = arows.length - 1; k >= 0; k--) {   // newest first, so the cap drops the oldest
    const r = arows[k], sh = String(r.Sheet), wl = TL_FIELDS_[sh];
    if (!wl || !ids[sh][String(r.Record_ID)]) continue;
    const field = String(r.Field);
    if (field && !wl[field]) continue;   // not on the whitelist: never returned
    if (!field && String(r.Action) !== 'Create') continue;
    if (audit.length >= TL_CAP_) { capped = true; break; }
    audit.push(r);
  }

  // Changes, as flat items: a stage move / status change, or a field edit.
  const items = [];   // {ms, at, by, kind:'move'|'field', stage (for moves), sheet, field, label, oldV, newV, from, to, outcome, note}
  hist.forEach(function (h) {
    items.push({ ms: ms_(h.Changed_At), at: tlWhen_(h.Changed_At), by: String(h.Changed_By), kind: 'move', from: String(h.From_Stage), to: String(h.To_Stage),
      outcome: String(h.Outcome || ''), note: String(h.Note || ''), sheet: 'Stage_History', field: '' });
  });
  audit.forEach(function (r) {
    const sh = String(r.Sheet), field = String(r.Field), base = { ms: ms_(r.Timestamp), at: tlWhen_(r.Timestamp), by: String(r.User), kind: 'field', sheet: sh, field: field };
    if (!field) {   // a record was created
      const lab = sh === 'Screenings' ? 'Screening started' : sh === 'Interviews' ? 'Interview scheduled' : sh === 'Applications' ? 'Card created' : '';
      if (lab) items.push(Object.assign(base, { label: lab, oldV: '', newV: '' }));
      return;
    }
    if (sh === 'Screenings' && field === 'Answers_JSON') {
      const items0 = scrFull && scrFull.items ? scrFull.items : [];
      const diffs = tlAnswerDiff_(r.Old_Value, r.New_Value, items0);
      if (!diffs.length) items.push(Object.assign(base, { label: 'Answers and ratings', oldV: '', newV: 'saved, no answer changed' }));
      diffs.forEach(function (d) { items.push(Object.assign({}, base, d)); });
      return;
    }
    if (sh === 'Screenings' && field === 'Items_JSON') { items.push(Object.assign(base, { label: 'Question list', oldV: '', newV: 'restarted on a newer question list' })); return; }
    items.push(Object.assign(base, { label: TL_FIELDS_[sh][field], oldV: tlValue_(sh, field, r.Old_Value), newV: tlValue_(sh, field, r.New_Value) }));
  });
  items.sort(function (a, b) { return b.ms - a.ms; });

  const pick = function (tab) {
    const def = TL_TABS_[tab];
    return items.filter(function (it) {
      if (!def) return true;   // all activity
      if (it.kind === 'move') return def.stages.indexOf(it.to) >= 0 || (def.stages.indexOf(it.from) >= 0 && it.from === it.to);
      const f = def.fields[it.sheet];
      if (!f) return false;
      if (!it.field) return it.sheet !== 'Applications';   // a created screening or interview shows in the tab that reads it; the card itself only in All activity
      return f.indexOf(it.field) >= 0;
    }).map(function (it) { const o = Object.assign({}, it); delete o.sheet; delete o.field; return o; });
  };
  const moveInto = function (stage) { let m = null; hist.forEach(function (h) { if (String(h.To_Stage) === stage && String(h.From_Stage) !== stage) m = h; }); return m; };
  const moveFact = function (stage, label) {
    const m = moveInto(stage);
    return m ? [[label, tlWhen_(m.Changed_At) + ' by ' + String(m.Changed_By)]] : [];
  };

  // Facts and "not recorded" lines for each tab.
  const cv = { facts: [], notes: [] }, shared = { facts: [], notes: [] }, dept = { facts: [], notes: [] }, tech = { facts: [], notes: [] }, all = { facts: [], notes: [] };
  if (scrFull) {
    cv.facts.push(['Screening', (scrFull.status === 'Complete' ? 'Complete' : 'Draft') + (scrFull.band ? ' · ' + scrFull.band : '')]);
    cv.facts.push(['Result', scrFull.met + ' of ' + scrFull.total + ' met · ' + scrFull.partly + ' partly · ' + scrFull.gaps + ' gaps · ' + scrFull.pct + '%']);
    if (scrFull.koFailed.length) cv.facts.push(['Knock-out not met', scrFull.koFailed.join(', ')]);
    cv.facts.push(['Questions', 'version ' + scrFull.sqVersion + (scrFull.jdVersion ? ' · JD ' + scrFull.jdVersion : '')]);
    cv.facts.push(['Started', tlWhen_(scr.Created_At) + ' by ' + String(scr.Created_By || '')]);
    cv.facts.push(['Last saved', tlWhen_(scr.Updated_At) + ' by ' + String(scr.Updated_By || '')]);
    if (scrFull.note) cv.facts.push(['Screening note', tlCut_(scrFull.note)]);
    (scrFull.items || []).forEach(function (it) {
      if (it.sec === 'P') return;
      const ans = tlAnswer_((scrFull.answers || {})[it.id]);
      cv.facts.push([tlCut_(it.q || it.id).slice(0, 110), ans || '—']);
    });
  } else {
    cv.facts.push(['Screening', 'Not recorded on the confirmed questions yet']);
    const sc = tlJson_(app.Screening_JSON, {});
    Object.keys(sc).forEach(function (q) { cv.facts.push([tlCut_(q).slice(0, 110), tlCut_(sc[q]) || '—']); });
  }
  cv.facts = moveFact('Screened', 'Moved to Screened').concat(cv.facts);
  cv.notes.push('Edits made directly in Google Sheets are not in the history.');

  if (scr && (scr.Shared_On || scr.Shared_With)) {
    shared.facts.push(['Shared on', tlWhen_(scr.Shared_On)]);
    shared.facts.push(['Shared with', String(scr.Shared_With || '—')]);
    if (scr.Share_Reason) shared.facts.push(['Reason for sharing', tlCut_(scr.Share_Reason)]);
  } else shared.facts.push(['Shared with the department', 'Not recorded' + (moveInto('Shared') ? ' on the screening (see the move below)' : '')]);
  shared.facts = shared.facts.concat(moveFact('Shared', 'Moved to ' + (fast ? 'Sent to department' : 'Shared with department')));
  shared.notes.push('The e-mail itself (subject, text, address as sent, attachments) is not stored by the app.');

  const cm = moveInto('Confirmed');
  const res = cm ? String(cm.Outcome || '') : '';
  if (app.Dept_Confirm_By || res) {
    dept.facts.push(['Department’s decision', res || 'Not recorded']);
    dept.facts.push(['Confirmed by (department)', String(app.Dept_Confirm_By || 'Not recorded')]);
    dept.facts.push(['Date of the confirmation', app.Dept_Confirm_On ? tlDay_(app.Dept_Confirm_On) : 'Not recorded']);
  } else if (cm) {
    dept.facts.push(['Department’s decision', 'Moved to Dept confirmed without the result being recorded']);
    dept.notes.push('This card was confirmed before the result, the department person and the date became fields (release 145). Only the move below and its note exist.');
  } else dept.facts.push(['Department confirmation', 'Not recorded yet']);
  if (cm) { dept.facts.push(['Recorded by', tlWhen_(cm.Changed_At) + ' by ' + String(cm.Changed_By)]); if (cm.Note) dept.facts.push(['Note', tlCut_(cm.Note)]); }
  dept.hasPaper = !!String(app.Dept_Confirm_File || '').trim();
  dept.facts.push(['Written confirmation', dept.hasPaper ? 'Attached' : 'Not attached']);

  const tdate = ymd_(cand.Tech_Interview_Date), tres = String(cand.Tech_Result || '');
  tech.facts.push(['Technical interview', tdate || tres ? (tdate ? tlDay_(cand.Tech_Interview_Date) : 'date not recorded') + (cand.Tech_Interview_By ? ' · by ' + String(cand.Tech_Interview_By) : '') + (tres ? ' · ' + tres : '') : 'Not recorded']);
  tech.facts = moveFact('Technical', 'Moved to Technical interview').concat(tech.facts);
  const ps = String(cand.Psychometric_Status || '');
  if (ps || ymd_(cand.Psychometric_Date) || cand.Psychometric_Score) tech.facts.push(['Psychometric test', [ps, ymd_(cand.Psychometric_Date) ? tlDay_(cand.Psychometric_Date) : '', cand.Psychometric_Score ? 'score ' + cand.Psychometric_Score : ''].filter(String).join(' · ')]);
  ivs.filter(function (i) { return String(i.Round) !== 'HR'; }).forEach(function (i) {
    tech.facts.push(['Scheduled interview', (i.Start instanceof Date ? tlWhen_(i.Start) : '') + ' · ' + String(i.Mode || '') + ' · ' + String(i.Status || '') + (i.Attendance_Confirmed === 'Yes' ? ' · attendance confirmed' : '') + ' · booked by ' + String(i.Created_By || '')]);
  });
  tech.notes.push('The interview result is stored on the candidate and in the move above; the scheduled interview itself has no result record.');
  tech.notes.push('The HR interview (optional) is in All activity.');

  all.notes.push('Every stage move and status change, and every edit shown in the other tabs, plus the HR interview fields.');
  all.notes.push('Edits made directly in Google Sheets are not in the history.');

  return { appId: String(appId), route: route, stage: String(app.Stage), status: String(app.Status), auditFrom: auditFrom, capped: capped,
    tabs: { cv: Object.assign(cv, { changes: pick('cv') }), shared: Object.assign(shared, { changes: pick('shared') }), dept: Object.assign(dept, { changes: pick('dept') }),
      tech: Object.assign(tech, { changes: pick('tech') }), all: Object.assign(all, { changes: pick('all') }) } };
}
