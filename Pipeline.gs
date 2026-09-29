/**
 * Candidate pipeline: one application per candidate per MRF position, moving through
 * the BFCL hiring steps. Every move is written to Stage_History. Moves that matter to
 * the position (offer, joining, backout) also update the MRF line so TAT and KPIs stay right.
 */
const STAGES = ['Sourced', 'Screened', 'Shared', 'Confirmed', 'Technical', 'HR', 'Docs', 'Offer', 'Prejoin', 'Joined', 'Onboarded'];
const STAGE_NAMES = { Sourced: 'CV received', Screened: 'Screened by recruiter', Shared: 'Shared with department', Confirmed: 'Dept confirmed for interview',
  Technical: 'Technical interview', HR: 'HR interview', Docs: 'Documents verified', Offer: 'Offer released', Prejoin: 'Pre-joining follow-up',
  Joined: 'Joined', Onboarded: 'Onboarded' };
const DOC_SECTIONS = [['A', 'Core joining pack'], ['B', 'Identity, age and address proof'], ['C', 'Education and technical qualification'],
  ['D', 'Employment history and compensation proof'], ['E', 'Payroll, tax, PF and ESI'], ['F', 'Medical, safety and verification'],
  ['G', 'Company declarations and acknowledgements'], ['H', 'Role-specific and operational documents']];

function pipelineSchema_() {
  addColumns_(T.MRF.name, ['JD_Text', 'JD_File', 'MRF_Form_File', 'Justification', 'Budget_CTC', 'Vacancy_Reason', 'Screening_Questions']);
  addSheet_(T.APP.name, ['App_ID', 'Candidate_ID', 'Line_ID', 'MRF_No', 'Recruiter', 'Stage', 'Status', 'Status_Reason', 'Stage_Since',
    'Screening_JSON', 'Docs_JSON', 'Docs_File', 'Offer_CTC', 'Offer_Letter_File', 'Offer_Accepted_On', 'Risk', 'Next_Followup', 'Onboard_JSON',
    'Created_By', 'Created_At', 'Updated_By', 'Updated_At']);
  addSheet_(T.HIST.name, ['Hist_ID', 'App_ID', 'Candidate_ID', 'Line_ID', 'Recruiter', 'From_Stage', 'To_Stage', 'Outcome', 'Note', 'Changed_By', 'Changed_At']);
  addSheet_(T.POST.name, ['Post_ID', 'Line_ID', 'MRF_No', 'Post_Type', 'Channel', 'Posted_On', 'Closes_On', 'Reference', 'Status', 'Notes',
    'Created_By', 'Created_At', 'Updated_By', 'Updated_At']);
  addSheet_(T.FU.name, ['FU_ID', 'App_ID', 'Candidate_ID', 'Line_ID', 'FU_Date', 'Mode', 'Response', 'Risk', 'Next_Date', 'Note', 'By', 'Created_At']);
  _tables = {};
  readTable_(T.CAND.name, true).rows.forEach(function (c) { if (c.Line_ID) ensureApp_(c, { email: 'migration', recruiter: '' }); });
}

function lineOf_(lineId) { return readTable_(T.MRF.name).rows.filter(function (l) { return l.Line_ID === lineId; })[0]; }
function appOf_(appId) {
  const a = readTable_(T.APP.name, true).rows.filter(function (r) { return r.App_ID === appId; })[0];
  if (!a) throw new Error('That pipeline record was not found. Reload the page.');
  return a;
}
function txt_(v) { return v == null ? '' : String(v).trim(); }
function stageFromCandidate_(c) {
  if (ymd_(c.DOJ)) return 'Joined';
  if (txt_(c.HR_Result)) return 'HR';
  if (txt_(c.Tech_Result)) return 'Technical';
  return 'Sourced';
}

function appendHistory_(app, from, to, outcome, note, u) {
  const t = readTable_(T.HIST.name, true);
  let n = 0;
  t.rows.forEach(function (r) { const m = String(r.Hist_ID).match(/(\d+)$/); if (m) n = Math.max(n, +m[1]); });
  const o = { Hist_ID: 'SH-' + String(n + 1).padStart(6, '0'), App_ID: app.App_ID, Candidate_ID: app.Candidate_ID, Line_ID: app.Line_ID,
    Recruiter: app.Recruiter, From_Stage: from, To_Stage: to, Outcome: outcome || '', Note: clean_(String(note || '').slice(0, 1000)),
    Changed_By: u.email, Changed_At: new Date() };
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
  _tables[T.HIST.name] = null;
  PropertiesService.getScriptProperties().setProperty('KPI_DIRTY_AT', String(Date.now()));
}

/** Creates the application for a candidate linked to a position, if there is none yet. */
function ensureApp_(cand, u) {
  const t = readTable_(T.APP.name, true);
  if (t.rows.some(function (a) { return a.Candidate_ID === cand.Candidate_ID && a.Line_ID === cand.Line_ID; })) return null;
  const line = lineOf_(cand.Line_ID);
  if (!line) return null;
  const stage = stageFromCandidate_(cand);
  const rejected = /reject/i.test(txt_(cand.HR_Result) || txt_(cand.Tech_Result));
  const app = insert_(T.APP, { Candidate_ID: cand.Candidate_ID, Line_ID: cand.Line_ID, MRF_No: line.MRF_No, Recruiter: line.Recruiter,
    Stage: stage, Status: rejected ? 'Rejected' : 'Active', Stage_Since: new Date(), Risk: '' }, u);
  appendHistory_(app, '', stage, rejected ? 'Rejected' : '', u.email === 'migration' ? 'Created from existing candidate record' : 'Added to pipeline', u);
  return app;
}

function requireLineEdit_(u, lineId) {
  const l = lineOf_(lineId);
  if (!l) throw new Error('Position ' + lineId + ' was not found.');
  if (!canEditLine_(u, l)) throw new Error('This position belongs to ' + l.Recruiter + '. Only they or the recruitment head can change its pipeline.');
  return l;
}

function appClient_(a) {
  const o = toClient_(a); delete o._row;
  ['Screening_JSON', 'Docs_JSON', 'Onboard_JSON'].forEach(function (k) { try { o[k] = JSON.parse(o[k] || '{}'); } catch (e) { o[k] = {}; } });
  return o;
}

/** Everything the pipeline board needs for one position. */
function apiPipeline(lineId) {
  currentUser_(); ensureSchema_();
  const line = lineOf_(lineId);
  if (!line) throw new Error('Pick a position.');
  const cands = {};
  readTable_(T.CAND.name).rows.forEach(function (c) { cands[c.Candidate_ID] = c; });
  const hist = {};
  readTable_(T.HIST.name).rows.forEach(function (h) {
    if (h.Line_ID !== lineId) return;
    (hist[h.App_ID] = hist[h.App_ID] || []).push({ from: String(h.From_Stage), to: String(h.To_Stage), outcome: String(h.Outcome), note: String(h.Note),
      by: String(h.Changed_By), at: h.Changed_At instanceof Date ? Utilities.formatDate(h.Changed_At, TZ, 'd MMM yyyy, HH:mm') : '', ms: h.Changed_At instanceof Date ? h.Changed_At.getTime() : 0 });
  });
  const fus = {};
  readTable_(T.FU.name).rows.forEach(function (f) {
    if (f.Line_ID !== lineId) return;
    (fus[f.App_ID] = fus[f.App_ID] || []).push(toClient_({ date: f.FU_Date, mode: f.Mode, response: f.Response, risk: f.Risk, next: f.Next_Date, note: f.Note, by: f.By }));
  });
  const apps = readTable_(T.APP.name).rows.filter(function (a) { return a.Line_ID === lineId; }).map(function (a) {
    const o = appClient_(a);
    const c = cands[a.Candidate_ID] || {};
    o.cand = toClient_({ id: c.Candidate_ID, name: c.Name, mobile: c.Mobile, email: c.Email, exp: c.Relevant_Experience, ctc: c.Current_CTC,
      designation: c.Current_Designation, hasCv: c.CV_File_URL ? 'Yes' : '', tech: c.Tech_Result, hr: c.HR_Result, techBy: c.Tech_Interview_By, hrBy: c.HR_Interview_By });
    o.history = (hist[a.App_ID] || []).sort(function (x, y) { return x.ms - y.ms; });
    o.followups = fus[a.App_ID] || [];
    o.sinceMs = a.Stage_Since instanceof Date ? a.Stage_Since.getTime() : 0;
    return o;
  });
  const posts = readTable_(T.POST.name).rows.filter(function (p) { return p.Line_ID === lineId; }).map(function (p) { const o = toClient_(p); delete o._row; return o; });
  const l = toClient_(line); delete l._row;
  let qs = []; try { qs = JSON.parse(String(line.Screening_Questions || '[]')); } catch (e) { qs = []; }
  return { line: l, questions: qs, apps: apps, posts: posts, stages: STAGES, names: STAGE_NAMES, docSections: DOC_SECTIONS, now: Date.now() };
}

function apiAddToPipeline(candidateId, lineId) {
  const u = currentUser_(); ensureSchema_();
  requireLineEdit_(u, lineId);
  const c = readTable_(T.CAND.name).rows.filter(function (r) { return r.Candidate_ID === candidateId; })[0];
  if (!c) throw new Error('Candidate ' + candidateId + ' was not found.');
  const created = ensureApp_(Object.assign({}, c, { Line_ID: lineId, HR_Result: '', Tech_Result: '', DOJ: '' }), u);
  if (!created) throw new Error(c.Name + ' is already in this position\u2019s pipeline.');
  if (!c.Line_ID) update_(T.CAND, candidateId, { Line_ID: lineId }, u);
  return appClient_(created);
}

/**
 * Moves an application to a stage. data carries the stage's details:
 * Screened {answers}, Technical/HR {date, by, result}, Docs {docs, exception}, Offer {offerDate, edoj, ctc},
 * Prejoin {acceptedOn}, Joined {doj}, Onboarded {onboard}; every stage accepts {note}.
 */
function apiMoveStage(appId, toStage, data) {
  const u = currentUser_(); ensureSchema_();
  data = data || {};
  if (STAGES.indexOf(toStage) < 0) throw new Error('Unknown stage.');
  const app = appOf_(appId);
  const line = requireLineEdit_(u, app.Line_ID);
  if (String(app.Status) !== 'Active') throw new Error('This candidate is ' + String(app.Status).toLowerCase() + '. Reactivate them first.');
  const from = String(app.Stage), fi = STAGES.indexOf(from), ti = STAGES.indexOf(toStage);
  if (ti <= fi && !isLead_(u)) throw new Error('Only the recruitment head can move a candidate back to an earlier stage.');
  const patch = { Stage: toStage, Stage_Since: new Date() };
  let outcome = '';
  if (toStage === 'Screened') {
    patch.Screening_JSON = JSON.stringify(data.answers || {});
  }
  if (toStage === 'Technical' || toStage === 'HR') {
    const pre = toStage === 'Technical' ? 'Tech' : 'HR';
    if (!data.date || !data.result) throw new Error('Add the interview date and result.');
    const cp = {}; cp[pre + '_Interview_Date'] = parseYmd_(data.date); cp[pre + '_Interview_By'] = clean_(String(data.by || '')); cp[pre + '_Result'] = data.result;
    update_(T.CAND, app.Candidate_ID, cp, u);
    outcome = data.result;
    if (/reject/i.test(data.result)) { patch.Status = 'Rejected'; patch.Status_Reason = 'Not selected in ' + STAGE_NAMES[toStage].toLowerCase(); }
    if (/hold/i.test(data.result)) { patch.Status = 'On hold'; patch.Status_Reason = 'On hold after ' + STAGE_NAMES[toStage].toLowerCase(); }
  }
  if (toStage === 'Docs') {
    const docs = data.docs || {};
    const open = DOC_SECTIONS.filter(function (s) { return ['Verified', 'NA'].indexOf(docs[s[0]]) < 0; });
    if (open.length && !String(data.exception || '').trim()) throw new Error('Sections ' + open.map(function (s) { return s[0]; }).join(', ') + ' are not verified. Verify them or record the approved exception (Policy 9.3).');
    patch.Docs_JSON = JSON.stringify(docs);
    if (open.length) outcome = 'Conditional: ' + String(data.exception).slice(0, 200);
  }
  if (toStage === 'Offer') {
    if (!data.offerDate) throw new Error('Add the offer letter date.');
    patch.Offer_CTC = clean_(String(data.ctc || ''));
    update_(T.MRF, line.Line_ID, { Offer_Sent: 'Yes', Offer_Date: parseYmd_(data.offerDate), EDOJ: data.edoj ? parseYmd_(data.edoj) : line.EDOJ,
      Candidate_ID: app.Candidate_ID }, u);
  }
  if (toStage === 'Prejoin') {
    if (!data.acceptedOn) throw new Error('Add the date the candidate accepted the offer.');
    patch.Offer_Accepted_On = parseYmd_(data.acceptedOn);
    patch.Risk = 'Green';
  }
  if (toStage === 'Joined') {
    if (!data.doj) throw new Error('Add the actual joining date.');
    update_(T.CAND, app.Candidate_ID, { DOJ: parseYmd_(data.doj) }, u);
    update_(T.MRF, line.Line_ID, { Offer_Sent: 'Yes', Actual_DOJ: parseYmd_(data.doj), Candidate_ID: app.Candidate_ID,
      Offer_Date: line.Offer_Date || parseYmd_(data.doj) }, u);
    patch.Risk = ''; patch.Next_Followup = '';
  }
  if (toStage === 'Onboarded') {
    const ob = data.onboard || {};
    if (!ob.induction || !ob.buddy) throw new Error('Record the induction date and the buddy assigned.');
    patch.Onboard_JSON = JSON.stringify(ob);
  }
  update_(T.APP, appId, patch, u);
  appendHistory_(app, from, toStage, outcome, data.note, u);
  return apiPipeline(app.Line_ID);
}

/** Rejects, holds, withdraws (backs out) or reactivates an application. */
function apiSetAppStatus(appId, status, reason) {
  const u = currentUser_(); ensureSchema_();
  if (['Active', 'Rejected', 'On hold', 'Withdrawn'].indexOf(status) < 0) throw new Error('Unknown status.');
  const app = appOf_(appId);
  const line = requireLineEdit_(u, app.Line_ID);
  if (status !== 'Active' && !String(reason || '').trim()) throw new Error('Give a short reason.');
  const stage = String(app.Stage);
  if (status === 'Withdrawn' && ['Offer', 'Prejoin'].indexOf(stage) >= 0 && String(line.Candidate_ID) === String(app.Candidate_ID)) {
    update_(T.MRF, line.Line_ID, { Offer_Sent: 'No', Backout_Date: new Date(), EDOJ: '', Actual_DOJ: '', Candidate_ID: '' }, u);
  }
  update_(T.APP, appId, { Status: status, Status_Reason: clean_(String(reason || '')), Risk: status === 'Active' ? app.Risk : '' }, u);
  appendHistory_(app, stage, stage, status === 'Withdrawn' && ['Offer', 'Prejoin'].indexOf(stage) >= 0 ? 'Backout' : status, reason, u);
  return apiPipeline(app.Line_ID);
}

/** Saves checklist-type details without moving the stage (documents, onboarding, screening answers). */
function apiSaveAppDetails(appId, data) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId);
  requireLineEdit_(u, app.Line_ID);
  const patch = {};
  if (data.docs) patch.Docs_JSON = JSON.stringify(data.docs);
  if (data.onboard) patch.Onboard_JSON = JSON.stringify(data.onboard);
  if (data.answers) patch.Screening_JSON = JSON.stringify(data.answers);
  if (data.ctc !== undefined) patch.Offer_CTC = clean_(String(data.ctc));
  update_(T.APP, appId, patch, u);
  return apiPipeline(app.Line_ID);
}

/** Pre-joining fail-safe: logs a check-in with the candidate and sets the risk and next check-in. */
function apiAddFollowup(appId, data) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId);
  requireLineEdit_(u, app.Line_ID);
  if (!data.date || !data.mode || !data.risk) throw new Error('Date, mode and risk are required.');
  if (['Green', 'Amber', 'Red'].indexOf(data.risk) < 0) throw new Error('Risk must be Green, Amber or Red.');
  withLock_(function () {
    const t = readTable_(T.FU.name, true);
    let n = 0;
    t.rows.forEach(function (r) { const m = String(r.FU_ID).match(/(\d+)$/); if (m) n = Math.max(n, +m[1]); });
    const o = { FU_ID: 'FU-' + String(n + 1).padStart(5, '0'), App_ID: appId, Candidate_ID: app.Candidate_ID, Line_ID: app.Line_ID,
      FU_Date: parseYmd_(data.date), Mode: data.mode, Response: clean_(String(data.response || '')), Risk: data.risk,
      Next_Date: data.next ? parseYmd_(data.next) : '', Note: clean_(String(data.note || '').slice(0, 1000)), By: u.email, Created_At: new Date() };
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    _tables[T.FU.name] = null;
  });
  update_(T.APP, appId, { Risk: data.risk, Next_Followup: data.next ? parseYmd_(data.next) : '' }, u);
  return apiPipeline(app.Line_ID);
}

/** MRF received on <= JD confirmed on <= screening questions confirmed on, none in the future. */
function checkConfirmDates_(rec) {
  const r = ymd_(rec.Receipt_Date), j = ymd_(rec.JD_Confirmed_Date), q = ymd_(rec.SQ_Confirmed_Date), today = ymd_(new Date());
  if (j && j > today) throw new Error('The JD confirmed date cannot be in the future.');
  if (q && q > today) throw new Error('The screening questions confirmed date cannot be in the future.');
  if (j && r && j < r) throw new Error('The JD confirmed date cannot be before the MRF received date.');
  if (q && !j) throw new Error('Add the JD confirmed date first; screening questions are confirmed after the JD.');
  if (q && q < j) throw new Error('The screening questions confirmed date cannot be before the JD confirmed date.');
}

/** Saves the screening questions and, optionally, the date the department confirmed them. */
function apiSaveScreeningQuestions(lineId, questions, confirmedOn) {
  const u = currentUser_(); ensureSchema_();
  const line = requireLineEdit_(u, lineId);
  const qs = (Array.isArray(questions) ? questions : []).map(function (q) { return String(q || '').trim().slice(0, 300); }).filter(String).slice(0, 25);
  const patch = { Screening_Questions: JSON.stringify(qs) };
  if (confirmedOn !== undefined) {
    if (confirmedOn && !qs.length) throw new Error('Add the screening questions before recording the confirmation date.');
    patch.SQ_Confirmed_Date = confirmedOn ? parseYmd_(confirmedOn) : '';
    checkConfirmDates_({ Receipt_Date: line.Receipt_Date, JD_Confirmed_Date: line.JD_Confirmed_Date, SQ_Confirmed_Date: patch.SQ_Confirmed_Date });
  }
  const rec = update_(T.MRF, lineId, patch, u);
  return { questions: qs, confirmed: ymd_(rec.SQ_Confirmed_Date) };
}

function apiSaveJobPost(data) {
  const u = currentUser_(); ensureSchema_();
  const line = requireLineEdit_(u, data.Line_ID);
  const patch = prepare_(T.POST, data);
  if (!patch.Channel || !patch.Posted_On) throw new Error('Channel and posting date are required.');
  if (patch.Post_Type === 'Internal (IJP)' && patch.Closes_On && daysBetween_(ymd_(patch.Posted_On), ymd_(patch.Closes_On)) < 21) {
    patch.Notes = String(patch.Notes || '') + (patch.Notes ? ' ' : '') + '[IJP window shorter than 15 working days]';
  }
  patch.MRF_No = line.MRF_No;
  if (!patch.Status) patch.Status = 'Live';
  const rec = data.Post_ID ? update_(T.POST, data.Post_ID, patch, u) : insert_(T.POST, patch, u);
  const o = toClient_(rec); delete o._row; return o;
}

/** Alerts across all positions: HOD feedback overdue, joiners at risk, follow-ups due, stage counts. */
function pipelineAlerts_(onlyRecruiter) {
  const today = ymd_(new Date());
  const cands = {};
  readTable_(T.CAND.name).rows.forEach(function (c) { cands[c.Candidate_ID] = c; });
  const lines = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { lines[l.Line_ID] = l; });
  const out = { hodOverdue: [], atRisk: [], dueToday: [], counts: {} };
  STAGES.forEach(function (s) { out.counts[s] = 0; });
  readTable_(T.APP.name).rows.forEach(function (a) {
    if (String(a.Status) !== 'Active') return;
    if (onlyRecruiter && String(a.Recruiter).toLowerCase() !== onlyRecruiter.toLowerCase()) return;
    out.counts[a.Stage] = (out.counts[a.Stage] || 0) + 1;
    const c = cands[a.Candidate_ID] || {}, l = lines[a.Line_ID] || {};
    const brief = { app: a.App_ID, line: a.Line_ID, name: String(c.Name || a.Candidate_ID), position: String(l.Position || ''), recruiter: String(a.Recruiter),
      stage: String(a.Stage), risk: String(a.Risk || ''), next: ymd_(a.Next_Followup) };
    const since = a.Stage_Since instanceof Date ? a.Stage_Since.getTime() : 0;
    if (a.Stage === 'Shared' && since && Date.now() - since > 24 * 3600000) { brief.hours = Math.round((Date.now() - since) / 3600000); out.hodOverdue.push(brief); }
    if (['Offer', 'Prejoin'].indexOf(String(a.Stage)) >= 0) {
      if (/Amber|Red/.test(String(a.Risk))) out.atRisk.push(brief);
      if (brief.next && brief.next <= today) out.dueToday.push(brief);
      if (a.Stage === 'Prejoin' && !brief.next) out.dueToday.push(Object.assign({ missing: true }, brief));
    }
  });
  out.hodOverdue.sort(function (a, b) { return b.hours - a.hours; });
  return out;
}

function apiPipelineAlerts() {
  const u = currentUser_(); ensureSchema_();
  return pipelineAlerts_(isLead_(u) ? '' : u.recruiter);
}

/** Candidate moves per recruiter on a date, from Stage_History (used by the daily review). */
function pipelineMoves_(date) {
  const out = {};
  readTable_(T.HIST.name).rows.forEach(function (h) {
    if (ymd_(h.Changed_At) !== date || String(h.Changed_By) === 'migration') return;
    const r = String(h.Recruiter || 'Unassigned').trim();
    const o = out[r] = out[r] || {};
    const key = h.From_Stage === h.To_Stage ? String(h.Outcome || 'Status change') : String(h.To_Stage);
    o[key] = (o[key] || 0) + 1;
  });
  return out;
}
