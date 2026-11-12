/**
 * Candidate history (the History section of the candidate profile).
 * One read-only call gathers everything the system keeps about a candidate across ALL of their cards (positions): the cards,
 * the stage history, interviews, screenings with their answers, voice calls, follow-ups, changes to the candidate record and the
 * CV files. Nothing here writes, and nothing is deleted anywhere when a card is moved or its status changes: records are
 * re-pointed to the new position and keep the position they were created on in Origin_Line_ID.
 */

const HIST_CVS_ = { name: 'Candidate_CVs', cols: ['Candidate_ID', 'File_URL', 'File_Name', 'Uploaded_By', 'Uploaded_At', 'Source'] };
const HIST_TEXT_MAX_ = 6000;
const HIST_KINDS_ = ['stage', 'interview', 'screening', 'voice', 'followup', 'change'];

function histSchema_() {
  schemaOnce_('hist', function () {
    addSheet_(HIST_CVS_.name, HIST_CVS_.cols);
    ['Interviews', 'Followups', 'Screenings'].forEach(function (n) { addColumns_(n, ['Origin_Line_ID']); });
  });
}
function histCut_(v, n) { v = String(v == null ? '' : v); return v.length > n ? v.slice(0, n) + '…' : v; }
function histMs_(v) { return v instanceof Date && !isNaN(v) ? v.getTime() : 0; }
function histWhen_(v) { return v instanceof Date && !isNaN(v) ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v == null ? '' : v); }
function histJson_(v, fb) { try { const o = JSON.parse(String(v || '')); return o && typeof o === 'object' ? o : fb; } catch (e) { return fb; } }

/**
 * Builds the merged timeline and the interview results by position from plain rows. Pure: no sheet access.
 * src: { lines: {Line_ID: 'MRF Position'}, apps: [{App_ID, Line_ID}], stage: [Stage_History rows], ivs: [Interviews rows], scrs: [{row, items, answers}],
 *        calls: [Voice_Calls rows], fus: [Followups rows], audit: [{At, By, Field, Old, New}] }.
 * Returns { events: [...newest first], results: [...] }.
 */
function histBuild_(src) {
  const lines = src.lines || {}, appLine = {};
  (src.apps || []).forEach(function (a) { appLine[String(a.App_ID)] = String(a.Line_ID); });
  const label = function (lineId) { return lines[String(lineId)] || String(lineId || ''); };
  const origin = function (r) {
    const o = String(r.Origin_Line_ID || '').trim();
    return o && o !== String(r.Line_ID) ? label(o) : '';
  };
  const ev = [];
  (src.stage || []).forEach(function (h) {
    const moved = String(h.Outcome) === 'Moved';
    ev.push({ kind: 'stage', ms: histMs_(h.Changed_At), at: histWhen_(h.Changed_At), by: String(h.Changed_By || ''), app: String(h.App_ID), position: label(appLine[String(h.App_ID)] || h.Line_ID),
      from: String(h.From_Stage || ''), to: String(h.To_Stage || ''), outcome: String(h.Outcome || ''), note: String(h.Note || ''), moved: moved,
      title: moved ? 'Moved to another position' : String(h.From_Stage) === String(h.To_Stage) ? (String(h.Outcome) || 'Update') : String(h.To_Stage) });
  });
  (src.ivs || []).forEach(function (i) {
    ev.push({ kind: 'interview', ms: histMs_(i.Start) || histMs_(i.Created_At), at: histWhen_(i.Start || i.Created_At), by: String(i.Created_By || ''), app: String(i.App_ID), position: label(i.Line_ID), origin: origin(i),
      title: String(i.Round || 'Interview') + ' interview', status: String(i.Status || ''), mode: String(i.Mode || ''), panel: String(i.Panel || ''), attendance: String(i.Attendance_Confirmed || ''),
      unavailable: String(i.Unavailable || ''), note: String(i.Notes || '') });
  });
  (src.scrs || []).forEach(function (s) {
    const r = s.row, items = s.items || [], ans = s.answers || {}, list = [];
    items.forEach(function (it) {
      if (!it || it.sec === 'P') return;
      const x = ans[it.id]; if (!x) return;
      const a = String(x.a == null ? '' : x.a).trim(); if (!a && !x.r) return;
      list.push({ q: histCut_(it.q || it.id, 160), a: histCut_(a, 300), r: String(x.r || '') });
    });
    ev.push({ kind: 'screening', ms: histMs_(r.Updated_At) || histMs_(r.Created_At), at: histWhen_(r.Updated_At || r.Created_At), by: String(r.Updated_By || r.Created_By || ''), app: String(r.App_ID), position: label(r.Line_ID), origin: origin(r),
      title: 'Screening ' + (String(r.Status) === 'Complete' ? 'completed' : 'draft'), band: String(r.Band || ''), pct: Number(r.Score_Pct) || 0, met: Number(r.Met) || 0, total: Number(r.Total) || 0, gaps: Number(r.Gaps) || 0,
      sqVersion: Number(r.SQ_Version) || 0, note: String(r.Note || ''), answers: list, sharedWith: String(r.Shared_With || '') });
  });
  (src.calls || []).forEach(function (c) {
    const vars = histJson_(c.Final_Vars_JSON, {});
    ev.push({ kind: 'voice', ms: histMs_(c.Started_At), at: histWhen_(c.Started_At), by: String(c.Started_By || ''), app: String(c.App_ID), position: label(c.Line_ID), origin: origin(c), call: String(c.Call_ID),
      title: 'Voice screening call', status: String(c.Status || ''), outcome: String(c.Outcome || ''), secs: Math.round(Number(c.Duration_Sec) || 0), summary: histCut_(vars.call_summary, 800),
      disposition: String(vars.call_disposition || ''), answersText: histCut_(vars.screening_answers, 2500), transcript: histCut_(c.Transcript, HIST_TEXT_MAX_), recording: String(c.Recording_URL || ''), note: String(c.Status_Note || '') });
  });
  (src.fus || []).forEach(function (f) {
    ev.push({ kind: 'followup', ms: histMs_(f.FU_Date) || histMs_(f.Created_At), at: histWhen_(f.FU_Date || f.Created_At), by: String(f.By || ''), app: String(f.App_ID), position: label(f.Line_ID), origin: origin(f),
      title: 'Joining follow-up', mode: String(f.Mode || ''), response: String(f.Response || ''), risk: String(f.Risk || ''), next: histWhen_(f.Next_Date), note: String(f.Note || '') });
  });
  (src.audit || []).forEach(function (a) {
    ev.push({ kind: 'change', ms: histMs_(a.At), at: histWhen_(a.At), by: String(a.By || ''), app: '', position: '', title: String(a.Label || a.Field), oldV: String(a.Old || ''), newV: String(a.New || '') });
  });
  ev.sort(function (a, b) { return b.ms - a.ms; });
  const results = [];
  (src.stage || []).forEach(function (h) {
    const to = String(h.To_Stage);
    if ((to === 'Technical' || to === 'HR') && String(h.From_Stage) !== to) {
      results.push({ app: String(h.App_ID), position: label(appLine[String(h.App_ID)] || h.Line_ID), round: to, outcome: String(h.Outcome || ''), at: histWhen_(h.Changed_At), ms: histMs_(h.Changed_At), by: String(h.Changed_By || ''), note: String(h.Note || '') });
    }
  });
  results.sort(function (a, b) { return b.ms - a.ms; });
  return { events: ev, results: results };
}

/** The CV files of a candidate, newest first, the current one marked. Falls back to the file on the candidate row when no version was ever recorded. */
function histCvList_(rows, currentUrl) {
  const out = (rows || []).map(function (r) {
    return { url: String(r.File_URL || ''), name: String(r.File_Name || ''), by: String(r.Uploaded_By || ''), at: histWhen_(r.Uploaded_At), ms: histMs_(r.Uploaded_At), source: String(r.Source || ''), current: String(r.File_URL || '') === String(currentUrl || '') && !!currentUrl };
  }).sort(function (a, b) { return b.ms - a.ms; });
  if (currentUrl && !out.some(function (x) { return x.current; })) out.unshift({ url: String(currentUrl), name: '', by: '', at: '', ms: 0, source: 'File on the profile', current: true });
  return out;
}
/** Records the file being replaced (once, when no version exists yet) and the new file. Called before the candidate row is updated. */
function histCvRecord_(u, candidateId, newUrl, newName, oldUrl, source) {
  histSchema_();
  const t = readTable_(HIST_CVS_.name, true), has = t.rows.some(function (r) { return String(r.Candidate_ID) === String(candidateId); }), now = new Date();
  const rows = [];
  if (!has && oldUrl) rows.push([candidateId, oldUrl, '', '', '', 'Earlier file (date unknown)']);
  rows.push([candidateId, newUrl, String(newName || ''), u.email, now, source || 'Uploaded']);
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows.map(function (r) { return t.headers.map(function (h, i) { return r[HIST_CVS_.cols.indexOf(h)] === undefined ? '' : r[HIST_CVS_.cols.indexOf(h)]; }); }));
  dropStale_(HIST_CVS_.name);
}

/** Everything the profile's History section shows for one candidate (live or archived). Read only. */
function apiCandidateHistory(candidateId) {
  currentUser_(); ensureSchema_(); histSchema_();
  const id = String(candidateId || '');
  if (!id) throw new Error('Pick a candidate.');
  const apps = readTable_(T.APP.name).rows.filter(function (a) { return String(a.Candidate_ID) === id; });
  const lines = {}, lineRow = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { lineRow[String(l.Line_ID)] = l; lines[String(l.Line_ID)] = (l.MRF_No ? l.MRF_No + ' ' : '') + String(l.Position || ''); });
  const mine = function (r) { return String(r.Candidate_ID) === id; };
  const appIds = {}; apps.forEach(function (a) { appIds[String(a.App_ID)] = 1; });
  const stage = readTable_(T.HIST.name).rows.filter(function (h) { return mine(h) || appIds[String(h.App_ID)]; });
  const ivs = readTable_(T.INT.name).rows.filter(function (r) { return mine(r) || appIds[String(r.App_ID)]; });
  const fus = readTable_(T.FU.name).rows.filter(function (r) { return mine(r) || appIds[String(r.App_ID)]; });
  const scrs = readTable_(T.SCR.name).rows.filter(function (r) { return mine(r) || appIds[String(r.App_ID)]; })
    .map(function (r) { return { row: r, items: histJson_(r.Items_JSON, []), answers: histJson_(r.Answers_JSON, {}) }; });
  const calls = ss_().getSheetByName('Voice_Calls') ? readTable_('Voice_Calls').rows.filter(function (r) { return mine(r) || appIds[String(r.App_ID)]; }) : [];
  const wl = TL_FIELDS_.Candidates, audit = [];
  let auditFrom = ''; apps.forEach(function (a) { const c = ymd_(a.Created_At); if (c && (!auditFrom || c < auditFrom)) auditFrom = c; });
  if (!auditFrom) auditFrom = ymd_(new Date(Date.now() - 365 * 86400000));
  readTableFrom_('Audit_Log', 'Timestamp', auditFrom).rows.forEach(function (r) {
    if (String(r.Sheet) !== 'Candidates' || String(r.Record_ID) !== id) return;
    const f = String(r.Field); if (!f || !wl[f]) return;
    audit.push({ At: r.Timestamp, By: String(r.User || ''), Field: f, Label: wl[f], Old: tlValue_('Candidates', f, r.Old_Value), New: tlValue_('Candidates', f, r.New_Value) });
  });
  const built = histBuild_({ lines: lines, apps: apps, stage: stage, ivs: ivs, scrs: scrs, calls: calls, fus: fus, audit: audit });
  const cand = candRow_(id) || {};
  const cvRows = ss_().getSheetByName(HIST_CVS_.name) ? readTable_(HIST_CVS_.name).rows.filter(function (r) { return String(r.Candidate_ID) === id; }) : [];
  const cards = apps.map(function (a) {
    const l = lineRow[String(a.Line_ID)] || {};
    return { app: String(a.App_ID), line: String(a.Line_ID), mrf: String(l.MRF_No || a.MRF_No || ''), position: String(l.Position || ''), dept: String(l.Dept || ''), recruiter: String(a.Recruiter || l.Recruiter || ''),
      stage: String(a.Stage || ''), status: String(a.Status || ''), reason: String(a.Status_Reason || ''), since: histWhen_(a.Stage_Since), offerDate: ymd_(a.Offer_Date), offerCtc: String(a.Offer_CTC || ''),
      edoj: ymd_(a.EDOJ), doj: ymd_(a.Actual_DOJ), backout: ymd_(a.Backout_Date), created: ymd_(a.Created_At), ms: histMs_(a.Created_At) };
  }).sort(function (x, y) { return y.ms - x.ms; });
  return { id: id, cards: cards, events: built.events.slice(0, 600), truncated: built.events.length > 600, results: built.results, cvs: histCvList_(cvRows, cand.CV_File_URL || ''), kinds: HIST_KINDS_ };
}
