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
  dropStale_(T.HIST.name);
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
  if (!canEditLine_(u, l)) throw new Error('This position belongs to ' + l.Recruiter + '. Only they, a TA Lead or the Head of HR can change its pipeline.');
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
  const onLine = {}, lineCands = [];
  readTable_(T.APP.name).rows.forEach(function (a) { if (a.Line_ID === lineId) { onLine[a.App_ID] = true; lineCands.push(a.Candidate_ID); } });
  const cands = candNames_(lineCands);
  const hist = {};
  readTable_(T.HIST.name).rows.forEach(function (h) {
    if (!onLine[h.App_ID]) return;
    (hist[h.App_ID] = hist[h.App_ID] || []).push({ from: String(h.From_Stage), to: String(h.To_Stage), outcome: String(h.Outcome), note: String(h.Note),
      by: String(h.Changed_By), at: h.Changed_At instanceof Date ? fmt_(h.Changed_At, TZ, 'd MMM yyyy, HH:mm') : '', ms: h.Changed_At instanceof Date ? h.Changed_At.getTime() : 0 });
  });
  const fus = {};
  readTable_(T.FU.name).rows.forEach(function (f) {
    if (!onLine[f.App_ID]) return;
    (fus[f.App_ID] = fus[f.App_ID] || []).push(toClient_({ date: f.FU_Date, mode: f.Mode, response: f.Response, risk: f.Risk, next: f.Next_Date, note: f.Note, by: f.By }));
  });
  const scrs = {}; readTable_(T.SCR.name).rows.forEach(function (s) { if (onLine[s.App_ID]) scrs[s.App_ID] = scrClient_(s, false); });
  const apps = readTable_(T.APP.name).rows.filter(function (a) { return a.Line_ID === lineId; }).map(function (a) {
    const o = appClient_(a);
    o.screen = scrs[a.App_ID] || null;
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
  l.Position_Status = positionStatus_(line);
  const byId = {}; readTable_(T.MRF.name).rows.forEach(function (x) { byId[x.Line_ID] = x; });
  if (line.Replaced_By && byId[line.Replaced_By]) l.replacedByMrf = String(byId[line.Replaced_By].MRF_No || line.Replaced_By);
  if (line.Parent_Line_ID && byId[line.Parent_Line_ID]) l.parentMrf = String(byId[line.Parent_Line_ID].MRF_No || line.Parent_Line_ID);
  const qs = sqTexts_(line.Screening_Questions);
  return { line: l, questions: qs, docs: pdocState_(lineId), hasFinalSq: !!sqFinalFor_(lineId), hod: hodOf_(line.Dept), apps: apps, posts: posts, stages: STAGES, names: STAGE_NAMES, docSections: DOC_SECTIONS, now: Date.now(), interviews: interviewsFor_(lineId) };
}

function apiAddToPipeline(candidateId, lineId) {
  const u = currentUser_(); ensureSchema_();
  requireActiveLine_(requireLineEdit_(u, lineId));
  ensureActiveCandidate_(candidateId, u);
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
  requireActiveLine_(line);
  if (String(app.Status) !== 'Active') throw new Error('This candidate is ' + String(app.Status).toLowerCase() + '. Reactivate them first.');
  const from = String(app.Stage), fi = STAGES.indexOf(from), ti = STAGES.indexOf(toStage);
  if (ti >= STAGES.indexOf('Offer') && fi < STAGES.indexOf('Offer')) {
    const holder = liveOfferHolder_(line.Line_ID, appId);
    if (holder) throw new Error(holder + ' already holds the offer for this position. Only one live offer is allowed: record their backout first (it creates the replacement MRF), or ask a TA Lead or the Head of HR.');
  }
  if (ti <= fi && !isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can move a candidate back to an earlier stage.');
  if (ti < fi) daySnapDropAll_();
  const patch = { Stage: toStage, Stage_Since: new Date() };
  let outcome = '';
  if (toStage === 'Screened') {
    const scr = scrOf_(appId);
    if (!data._fromScreening && sqFinalFor_(app.Line_ID) && !(scr && String(scr.Status) === 'Complete')) throw new Error('Record the screening first (candidate \u2192 Screening): this position has final screening questions.');
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
    patch.Offer_Date = parseYmd_(data.offerDate);
    patch.EDOJ = data.edoj ? parseYmd_(data.edoj) : (line.EDOJ || '');
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
    patch.Actual_DOJ = parseYmd_(data.doj);
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
function apiSetAppStatus(appId, status, reason, backoutDate) {
  const u = currentUser_(); ensureSchema_();
  if (['Active', 'Rejected', 'On hold', 'Withdrawn'].indexOf(status) < 0) throw new Error('Unknown status.');
  const app = appOf_(appId);
  const line = requireLineEdit_(u, app.Line_ID);
  requireNotReplaced_(line);
  if (status === 'Active') { requireActiveLine_(line); ensureActiveCandidate_(app.Candidate_ID, u); }
  if (status !== 'Active' && !String(reason || '').trim()) throw new Error('Give a short reason.');
  const stage = String(app.Stage);
  if (status === 'Active' && STAGES.indexOf(stage) >= STAGES.indexOf('Offer')) {
    const holder = liveOfferHolder_(line.Line_ID, appId);
    if (holder) throw new Error(holder + ' already holds the offer for this position, so this candidate cannot be reactivated at the offer stage.');
  }
  const backout = status === 'Withdrawn' && ['Offer', 'Prejoin'].indexOf(stage) >= 0;
  const patch = { Status: status, Status_Reason: clean_(String(reason || '')), Risk: status === 'Active' ? app.Risk : '' };
  let when = null;
  if (backout) {
    when = backoutDate ? parseYmd_(backoutDate) : parseYmd_(ymd_(new Date()));
    if (!when || isNaN(when)) throw new Error('Add the backout date.');
    if (ymd_(when) > ymd_(new Date())) throw new Error('The backout date cannot be in the future.');
    if (app.Offer_Date && ymd_(when) < ymd_(app.Offer_Date)) throw new Error('The backout date cannot be before this candidate\u2019s offer date (' + ymd_(app.Offer_Date) + ').');
    patch.Backout_Date = when; patch.Backout_Reason = clean_(String(reason || ''));
  }
  update_(T.APP, appId, patch, u);
  appendHistory_(app, stage, stage, backout ? 'Backout' : status, reason, u);
  if (backout) {
    const repl = createReplacement_(line, app, when, String(reason || ''), u);
    const out = apiPipeline(repl.Line_ID);
    out.replacement = { from: line.Line_ID, fromMrf: String(line.MRF_No || line.Line_ID), to: repl.Line_ID, toMrf: String(repl.MRF_No), moved: repl._moved };
    return out;
  }
  return apiPipeline(app.Line_ID);
}

/** Name of the candidate who holds the live offer on a position (at offer, pre-joining, joined or onboarded), if any. */
function liveOfferHolder_(lineId, exceptAppId) {
  const live = readTable_(T.APP.name).rows.filter(function (a) {
    return a.Line_ID === lineId && a.App_ID !== exceptAppId && String(a.Status) === 'Active' && STAGES.indexOf(String(a.Stage)) >= STAGES.indexOf('Offer');
  })[0];
  if (!live) return '';
  const c = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === live.Candidate_ID; })[0];
  return c ? String(c.Name) : live.Candidate_ID;
}
function requireNotReplaced_(line) {
  if (positionStatus_(line) === 'Removed') throw new Error('This position was removed because it was created in error. A TA Lead or the Head of HR can restore it.');
  if (positionStatus_(line) === 'Replaced') {
    const to = readTable_(T.MRF.name).rows.filter(function (l) { return l.Line_ID === line.Replaced_By; })[0];
    throw new Error('This position was closed after a backout and replaced by ' + (to ? (to.MRF_No || to.Line_ID) : line.Replaced_By) + '. Work on the replacement.');
  }
}

/** Replacement MRF number: J00039 \u2192 J00039-R1 \u2192 J00039-R2. */
function replacementMrfNo_(line) {
  const base = String(line.MRF_No || line.Line_ID).trim();
  const m = base.match(/^(.*)-R(\d+)$/);
  return m ? m[1] + '-R' + (Number(m[2]) + 1) : base + '-R1';
}

/**
 * Policy 9.5: when the selected candidate backs out, the position closes as "Replaced" and a new
 * MRF is raised with a reference to the old one. Its TAT counts from the original start date.
 * Other active candidates on the old position move to the new one.
 */
function createReplacement_(line, app, when, reason, u) {
  const t = readTable_(T.MRF.name, true);
  const skip = ['Line_ID', 'MRF_No', 'Offer_Sent', 'Offer_Date', 'EDOJ', 'Actual_DOJ', 'Backout_Date', 'Candidate_ID', 'Replaced_By', 'Replaced_On',
    'Parent_Line_ID', 'TAT_Start_From', 'No_Vacancy_Date', 'Not_Needed_Date', 'Remarks', 'Position_Status', 'Standard_TAT', 'Exemption_Days', 'Final_TAT',
    'TAT_End_Date', 'Days_Taken', 'TAT_Result', 'BGV_Prev_Org_Date', 'BGV_Current_Org_Date', 'BGV_Remarks', 'BGV_Prev_Org_File', 'BGV_Current_Org_File',
    'Created_By', 'Created_At', 'Updated_By', 'Updated_At', 'Reconciled_On', 'Reconciled_By', 'Reconcile_Note'];
  const obj = {};
  t.headers.forEach(function (h) { if (skip.indexOf(h) < 0 && line[h] !== undefined) obj[h] = line[h]; });
  const c = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === app.Candidate_ID; })[0] || {};
  obj.MRF_No = replacementMrfNo_(line);
  obj.Parent_Line_ID = line.Line_ID;
  obj.TAT_Start_From = parseYmd_(tatStart_(line));
  obj.Approval_Status = 'Approved';
  obj.Offer_Sent = 'No';
  obj.Vacancy_Reason = 'Replacement';
  obj.Remarks = 'Replacement for ' + (line.MRF_No || line.Line_ID) + ' after ' + (c.Name || app.Candidate_ID) + ' backed out on ' + ymd_(when) + (reason ? ' (' + reason + ')' : '') + '.';
  Object.assign(obj, storedTat_(computeTat_(obj, tatContext_())));
  const repl = insert_(T.MRF, obj, u);
  update_(T.MRF, line.Line_ID, { Replaced_By: repl.Line_ID, Replaced_On: when, Backout_Date: when, Candidate_ID: app.Candidate_ID }, u);
  const moved = [];
  readTable_(T.APP.name, true).rows.forEach(function (a) {
    if (a.Line_ID !== line.Line_ID || a.App_ID === app.App_ID || ['Active', 'On hold'].indexOf(String(a.Status)) < 0) return;
    update_(T.APP, a.App_ID, { Line_ID: repl.Line_ID, MRF_No: repl.MRF_No }, u);
    appendHistory_(Object.assign({}, a, { Line_ID: repl.Line_ID }), a.Stage, a.Stage, 'Moved', 'Moved to replacement ' + repl.MRF_No + ' after the backout on ' + (line.MRF_No || line.Line_ID), u);
    readTable_(T.INT.name, true).rows.forEach(function (i) { if (i.App_ID === a.App_ID && i.Status === 'Scheduled') update_(T.INT, i.Interview_ID, { Line_ID: repl.Line_ID }, u); });
    const cc = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === a.Candidate_ID; })[0];
    if (cc && cc.Line_ID === line.Line_ID) update_(T.CAND, a.Candidate_ID, { Line_ID: repl.Line_ID }, u);
    moved.push(a.App_ID);
  });
  repl._moved = moved.length;
  return repl;
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
    dropStale_(T.FU.name);
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
  if (confirmedOn) throw new Error('Record the department\u2019s confirmation in JD & questions (share the questions, then record their reply).');
  const raw = Array.isArray(questions) ? (questions.length && typeof questions[0] === 'object' ? questions : sqParse_(questions)) : (questions && questions.items) || [];
  if (!raw.length) throw new Error('Add at least one screening question.');
  const items = sqNormalize_(raw);
  pdocAdd_(u, lineId, 'SQ', { content: JSON.stringify({ v: 2, items: items }), source: 'Written in the CRM' });
  const rec = lineOf_(lineId);
  return { questions: items.map(function (i) { return i.q; }), items: items, confirmed: ymd_(rec.SQ_Confirmed_Date), state: pdocState_(lineId) };
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
  if (!data.Post_ID) {
    const st = pdocState_(data.Line_ID);
    patch.JD_Version = st.jdFinal ? st.jdFinalVersion : (st.jdVersion || '');
    patch.SQ_Version = st.sqFinal ? st.sqFinalVersion : (st.sqVersion || '');
    if (!st.readyToPost) {
      const reason = String(data.Override_Reason || '').trim();
      if (!reason || !isHeadHr_(u)) throw new Error('Post the job only after the department has validated the JD and the screening questions (' + (st.jdFinal ? '' : 'JD not final') + (!st.jdFinal && !st.sqFinal ? ', ' : '') + (st.sqFinal ? '' : 'questions not final') + '). ' + (isHeadHr_(u) ? 'To post anyway, enter a reason.' : 'The Head of HR can post with a recorded reason.'));
      patch.Override_Reason = clean_(reason).slice(0, 500); patch.Override_By = u.email;
    }
  }
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
  readTableFrom_(T.HIST.name, 'Changed_At', date).rows.forEach(function (h) {
    if (ymd_(h.Changed_At) !== date || String(h.Changed_By) === 'migration') return;
    const r = String(h.Recruiter || 'Unassigned').trim();
    const o = out[r] = out[r] || {};
    const key = h.From_Stage === h.To_Stage ? String(h.Outcome || 'Status change') : String(h.To_Stage);
    o[key] = (o[key] || 0) + 1;
  });
  return out;
}

/* ---------------- JD and screening-question validation with the department (v52) ----------------
 * Every JD and every set of screening questions for a position is kept as a numbered version:
 * Draft -> Shared (with the department) -> Final, or -> Changes requested (a new version follows).
 * Questions can only be written and shared once the JD is final; a revised JD sends final questions back to Re-confirm.
 * A job is posted only with a final JD and final questions (the Head of HR can override with a recorded reason). */
const PDOC_HEADERS_ = ['Doc_ID', 'Line_ID', 'MRF_No', 'Doc_Type', 'Version', 'Status', 'Content', 'File_URL', 'Source', 'Shared_On', 'Shared_With',
  'Response_On', 'Response', 'Dept_Comments', 'Final_On', 'Note', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
T.PDOC = { name: 'Position_Docs', id: 'Doc_ID', prefix: 'PDV-', width: 5, dates: [], editable: [] };
const PDOC_OPEN_ = ['Draft', 'Shared', 'Re-confirm'];
let _pdocSource = '';

function pdocSchema_() {
  addSheet_(T.PDOC.name, PDOC_HEADERS_);
  addColumns_(T.POST.name, ['JD_Version', 'SQ_Version', 'Override_Reason', 'Override_By']);
  pdocMigrate_();
}
/** One-time: positions that already had a JD or questions (and confirmation dates) become version 1. */
function pdocMigrate_() {
  const t = readTable_(T.PDOC.name, true);
  const have = {}; t.rows.forEach(function (r) { have[r.Line_ID + '|' + r.Doc_Type] = true; });
  const now = new Date(), rows = [];
  let n = t.rows.reduce(function (m, r) { const k = Number(String(r.Doc_ID).replace(/\D/g, '')); return k > m ? k : m; }, 0);
  const row = function (o) {
    n++; o.Doc_ID = T.PDOC.prefix + ('00000' + n).slice(-T.PDOC.width); o.Created_By = 'migration'; o.Created_At = now;
    rows.push(PDOC_HEADERS_.map(function (h) { return o[h] === undefined ? '' : jdmSafeText_(o[h]); }));
  };
  readTable_(T.MRF.name, true).rows.forEach(function (l) {
    const jdFinal = l.JD_Confirmed_Date instanceof Date;
    if (!have[l.Line_ID + '|JD'] && (jdFinal || l.JD_File || l.JD_Text)) {
      row({ Line_ID: l.Line_ID, MRF_No: l.MRF_No, Doc_Type: 'JD', Version: 1, Status: jdFinal ? 'Final' : 'Draft', Content: String(l.JD_Text || '').slice(0, 45000),
        File_URL: String(l.JD_File || ''), Source: 'Before the validation workflow', Final_On: jdFinal ? l.JD_Confirmed_Date : '', Response: jdFinal ? 'Validated' : '',
        Response_On: jdFinal ? l.JD_Confirmed_Date : '', Note: jdFinal ? 'JD confirmed date recorded before v52' : '' });
    }
    let qs = []; try { qs = JSON.parse(String(l.Screening_Questions || '[]')); } catch (e) { qs = []; }
    if (!have[l.Line_ID + '|SQ'] && qs.length) {
      const sqFinal = jdFinal && l.SQ_Confirmed_Date instanceof Date;
      row({ Line_ID: l.Line_ID, MRF_No: l.MRF_No, Doc_Type: 'SQ', Version: 1, Status: sqFinal ? 'Final' : 'Draft', Content: JSON.stringify(qs),
        Source: 'Before the validation workflow', Final_On: sqFinal ? l.SQ_Confirmed_Date : '', Response: sqFinal ? 'Validated' : '',
        Response_On: sqFinal ? l.SQ_Confirmed_Date : '', Note: sqFinal ? 'Questions confirmed date recorded before v52' : '' });
    }
  });
  if (rows.length) t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, PDOC_HEADERS_.length).setValues(rows);
  dropStale_(T.PDOC.name); _tables[T.PDOC.name] = undefined;
}
function pdocList_(lineId, type) {
  return readTable_(T.PDOC.name).rows.filter(function (r) { return String(r.Line_ID) === String(lineId) && (!type || String(r.Doc_Type) === type); })
    .sort(function (a, b) { return Number(a.Version) - Number(b.Version); });
}
function pdocFinal_(list) { return list.filter(function (r) { return String(r.Status) === 'Final'; }).slice(-1)[0] || null; }
function pdocLast_(list) { return list.length ? list[list.length - 1] : null; }
function isHeadHr_(u) { return u.role === 'Head of HR' || u.role === 'Admin'; }
function pdocById_(docId) {
  const r = readTable_(T.PDOC.name, true).rows.filter(function (x) { return String(x.Doc_ID) === String(docId); })[0];
  if (!r) throw new Error('That JD or questions version was not found. Refresh the page.');
  return r;
}
function pdocClient_(r) {
  let qs = null, items = null;
  if (String(r.Doc_Type) === 'SQ') { items = sqParse_(String(r.Content || '[]')); qs = items.map(function (i) { return i.q; }); }
  return { id: String(r.Doc_ID), type: String(r.Doc_Type), version: Number(r.Version), status: String(r.Status), content: String(r.Doc_Type) === 'SQ' ? '' : String(r.Content || ''),
    questions: qs, items: items, file: String(r.File_URL || ''), source: String(r.Source || ''), sharedOn: ymd_(r.Shared_On), sharedWith: String(r.Shared_With || ''),
    responseOn: ymd_(r.Response_On), response: String(r.Response || ''), comments: String(r.Dept_Comments || ''), finalOn: ymd_(r.Final_On), note: String(r.Note || ''),
    createdBy: String(r.Created_By || ''), createdOn: ymd_(r.Created_At) };
}
/** Readiness summary used by the pipeline, the posting rule and the to-do engine. */
function pdocState_(lineId) {
  const jd = pdocList_(lineId, 'JD'), sq = pdocList_(lineId, 'SQ');
  const jl = pdocLast_(jd), jf = pdocFinal_(jd), sl = pdocLast_(sq), sf = pdocFinal_(sq);
  const jdFinal = !!jf && jl === jf, sqFinal = !!sf && sl === sf;
  return { jdStatus: jl ? String(jl.Status) : 'None', jdVersion: jl ? Number(jl.Version) : 0, jdFinal: jdFinal, jdFinalVersion: jdFinal ? Number(jf.Version) : 0, jdFinalOn: jdFinal ? ymd_(jf.Final_On) : '',
    jdSharedOn: jl ? ymd_(jl.Shared_On) : '', jdRounds: jd.filter(function (r) { return r.Shared_On instanceof Date; }).length,
    sqStatus: sl ? String(sl.Status) : 'None', sqVersion: sl ? Number(sl.Version) : 0, sqFinal: sqFinal, sqFinalVersion: sqFinal ? Number(sf.Version) : 0, sqFinalOn: sqFinal ? ymd_(sf.Final_On) : '',
    sqSharedOn: sl ? ymd_(sl.Shared_On) : '', sqRounds: sq.filter(function (r) { return r.Shared_On instanceof Date; }).length, sqCount: sl ? (pdocClient_(sl).questions || []).length : 0,
    readyToPost: jdFinal && sqFinal };
}
/** Adds a new draft version. A new JD version supersedes open drafts and the final JD, and sends questions back to Re-confirm. */
function pdocAdd_(u, lineId, type, d) {
  const line = lineOf_(lineId);
  if (!line) throw new Error('Position ' + lineId + ' was not found.');
  const list = pdocList_(lineId, type);
  if (type === 'SQ' && !pdocState_(lineId).jdFinal) throw new Error('Finalise the JD with the department first: screening questions are written from the final JD.');
  const last = pdocLast_(list);
  if (last && String(last.Content || '') === String(d.content || '') && String(last.File_URL || '') === String(d.file || '') && PDOC_OPEN_.indexOf(String(last.Status)) >= 0 && String(last.Status) !== 'Re-confirm') return last;
  const now = new Date();
  const wasFinal = !!pdocFinal_(list);
  withLock_(function () {
    const t = readTable_(T.PDOC.name, true);
    t.rows.filter(function (r) { return String(r.Line_ID) === String(lineId) && String(r.Doc_Type) === type && (PDOC_OPEN_.indexOf(String(r.Status)) >= 0 || String(r.Status) === 'Final'); })
      .forEach(function (r) { r.Status = 'Superseded'; r.Updated_By = u.email; r.Updated_At = now; t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([jdmRow_(T.PDOC.name, t.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; }))]); });
    if (type === 'JD') {
      t.rows.filter(function (r) { return String(r.Line_ID) === String(lineId) && String(r.Doc_Type) === 'SQ'; }).sort(function (a, b) { return Number(b.Version) - Number(a.Version); }).slice(0, 1)
        .forEach(function (r) { if (['Final', 'Shared', 'Draft'].indexOf(String(r.Status)) < 0) return; r.Status = 'Re-confirm'; r.Note = 'The JD was revised (v' + (Number(last ? last.Version : 0) + 1) + '): confirm these questions again.'; r.Updated_By = u.email; r.Updated_At = now; t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([jdmRow_(T.PDOC.name, t.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; }))]); });
    }
    dropStale_(T.PDOC.name);
  });
  _tables[T.PDOC.name] = undefined;
  const rec = insert_(T.PDOC, { Line_ID: String(lineId), MRF_No: String(line.MRF_No || ''), Doc_Type: type, Version: (last ? Number(last.Version) : 0) + 1, Status: 'Draft',
    Content: String(d.content || '').slice(0, 45000), File_URL: String(d.file || ''), Source: String(d.source || ''), Note: wasFinal ? 'Revision after the final version' : '' }, u);
  const patch = {};
  if (type === 'JD' && line.JD_Confirmed_Date) { patch.JD_Confirmed_Date = ''; patch.SQ_Confirmed_Date = ''; }
  if (type === 'SQ') { patch.Screening_Questions = String(d.content || '[]'); if (line.SQ_Confirmed_Date) patch.SQ_Confirmed_Date = ''; }
  if (Object.keys(patch).length) update_(T.MRF, lineId, patch, u);
  _tables[T.PDOC.name] = undefined;
  return rec;
}
function pdocAddJd_(u, lineId, d) { try { return pdocAdd_(u, lineId, 'JD', d); } finally { _pdocSource = ''; } }

function apiDocFlow(lineId) {
  const u = currentUser_(); ensureSchema_();
  const line = lineOf_(lineId);
  if (!line) throw new Error('Position ' + lineId + ' was not found.');
  const hod = readTable_('M_Departments').rows.filter(function (d) { return String(d.Dept).trim() === String(line.Dept).trim(); })[0] || {};
  const st = pdocState_(lineId);
  const posts = readTable_(T.POST.name).rows.filter(function (p) { return p.Line_ID === lineId; }).map(function (p) {
    return { id: String(p.Post_ID), channel: String(p.Channel), postedOn: ymd_(p.Posted_On), status: String(p.Status), jdVersion: String(p.JD_Version || ''), sqVersion: String(p.SQ_Version || ''), override: String(p.Override_Reason || '') };
  });
  const warnings = [];
  posts.filter(function (p) { return p.status !== 'Closed'; }).forEach(function (p) {
    if (st.jdFinalVersion && p.jdVersion && Number(p.jdVersion) !== st.jdFinalVersion) warnings.push(p.channel + ' post (' + p.postedOn + ') uses JD v' + p.jdVersion + '; the final JD is now v' + st.jdFinalVersion + '. Update the post.');
    if (!st.jdFinal && p.jdVersion) warnings.push(p.channel + ' post (' + p.postedOn + ') is live while the JD is being revised.');
  });
  const rules = {}; taskRules_().forEach(function (r) { rules[r.id] = r; });
  return { line: { id: String(line.Line_ID), mrf: String(line.MRF_No || ''), position: String(line.Position), dept: String(line.Dept), grade: String(line.Grade || ''), receipt: ymd_(line.Receipt_Date), status: positionStatus_(line) },
    jd: pdocList_(lineId, 'JD').map(pdocClient_).reverse(), sq: pdocList_(lineId, 'SQ').map(pdocClient_).reverse(), state: st, posts: posts, warnings: warnings,
    canEdit: canEditLine_(u, line), headHr: isHeadHr_(u), hod: { name: String(hod.HOD_Name || ''), email: String(hod.HOD_Email || '') },
    replyHours: rules.dept_reply ? rules.dept_reply.due : 24, suggest: st.jdFinal ? pdocSuggest_(line) : [] };
}
/** Starter screening questions from the final JD: the Create JD draft when there is one, else the policy minimums, plus the standard ones. */
function pdocSuggest_(line) {
  const out = [];
  let dr = null;
  try {
    const rows = readTable_('JDM_Drafts').rows.filter(function (r) { return String(r.Line_ID) === String(line.Line_ID); });
    if (rows.length) dr = JSON.parse(String(rows[rows.length - 1].Draft_JSON || '{}'));
  } catch (e) { dr = null; }
  const g = String(line.Grade || '').trim().toUpperCase();
  const pol = typeof jdmPolicyExp_ === 'function' ? jdmPolicyExp_(g, line.Position) : null;
  out.push(dr && dr.qualification ? 'What is your highest qualification? This role needs: ' + dr.qualification + '.' : 'What is your highest qualification, and in which discipline?');
  const exp = dr && dr.expMin !== '' && dr.expMin != null ? dr.expMin : pol ? pol.degree : null;
  if (exp) out.push('How many years of total experience do you have? The minimum is ' + exp + ' years' + (pol && pol.iti ? ' (' + pol.iti + ' with 12th / ITI)' : '') + '.');
  if (dr && dr.expRelevant) out.push('Describe your experience relevant to this role (' + String(dr.expRelevant).slice(0, 100) + ').');
  if (dr && dr.comps) dr.comps.filter(function (c) { return !c.common && (c.crit === 'Safety-critical' || c.crit === 'Statutory'); }).slice(0, 3)
    .forEach(function (c) { out.push('Describe your hands-on experience with ' + c.name + '.'); });
  out.push('What is your current CTC and your expected CTC?');
  out.push('What is your notice period?');
  out.push('Where are you based now, and are you willing to work at our plant location?');
  return out;
}
/** A new JD version typed in the workflow panel (files come through upload, the JD folder or Create JD). */
function apiDocAddJdText(lineId, text) {
  const u = currentUser_(); ensureSchema_();
  requireLineEdit_(u, lineId);
  text = String(text || '').trim();
  if (text.length < 20) throw new Error('Type the JD (at least a few lines), or attach a file.');
  update_(T.MRF, lineId, { JD_Text: clean_(text).slice(0, 45000) }, u);
  return pdocClient_(pdocAdd_(u, lineId, 'JD', { content: text, source: 'Typed in the CRM' }));
}
function apiDocShare(docId, d) {
  const u = currentUser_(); ensureSchema_();
  const r = pdocById_(docId), line = requireLineEdit_(u, r.Line_ID);
  d = d || {};
  if (['Draft', 'Re-confirm'].indexOf(String(r.Status)) < 0) throw new Error('Only a draft (or questions to re-confirm) can be shared. ' + (String(r.Status) === 'Changes requested' ? 'Add a revised version first.' : 'This version is ' + r.Status + '.'));
  if (String(r.Doc_Type) === 'SQ' && !pdocState_(r.Line_ID).jdFinal) throw new Error('Finalise the JD with the department first: screening questions are shared after the JD is final.');
  const on = d.sharedOn ? parseYmd_(d.sharedOn) : new Date(), today = ymd_(new Date());
  if (ymd_(on) > today) throw new Error('The shared date cannot be in the future.');
  if (line.Receipt_Date instanceof Date && ymd_(on) < ymd_(line.Receipt_Date)) throw new Error('The shared date cannot be before the MRF received date.');
  if (String(r.Doc_Type) === 'SQ' && ymd_(on) < pdocState_(r.Line_ID).jdFinalOn) throw new Error('Questions cannot be shared before the JD was final (' + pdocState_(r.Line_ID).jdFinalOn + ').');
  const who = String(d.sharedWith || '').trim();
  if (!who) throw new Error('Enter who it was shared with (usually the HOD).');
  return pdocClient_(update_(T.PDOC, docId, { Status: 'Shared', Shared_On: on, Shared_With: clean_(who).slice(0, 200) }, u));
}
function apiDocRespond(docId, d) {
  const u = currentUser_(); ensureSchema_();
  const r = pdocById_(docId), line = requireLineEdit_(u, r.Line_ID);
  d = d || {};
  if (String(r.Status) !== 'Shared') throw new Error('Record the department\u2019s reply on a version that was shared with them.');
  const on = d.date ? parseYmd_(d.date) : new Date(), today = ymd_(new Date());
  if (ymd_(on) > today) throw new Error('The reply date cannot be in the future.');
  if (ymd_(on) < ymd_(r.Shared_On)) throw new Error('The reply date cannot be before the date it was shared (' + ymd_(r.Shared_On) + ').');
  const comments = clean_(String(d.comments || '').trim()).slice(0, 4000);
  if (d.response === 'Changes requested') {
    if (!comments) throw new Error('Note the changes the department asked for.');
    return pdocClient_(update_(T.PDOC, docId, { Status: 'Changes requested', Response: 'Changes requested', Response_On: on, Dept_Comments: comments }, u));
  }
  if (d.response !== 'Validated') throw new Error('Choose Validated or Changes requested.');
  if (String(r.Doc_Type) === 'SQ') {
    const st = pdocState_(r.Line_ID);
    if (!st.jdFinal) throw new Error('The JD is no longer final: finalise it before the questions.');
    if (ymd_(on) < st.jdFinalOn) throw new Error('Questions cannot be final before the JD (final on ' + st.jdFinalOn + ').');
  }
  const rec = update_(T.PDOC, docId, { Status: 'Final', Response: 'Validated', Response_On: on, Dept_Comments: comments, Final_On: on }, u);
  const patch = String(r.Doc_Type) === 'JD' ? { JD_Confirmed_Date: on } : { SQ_Confirmed_Date: on, Screening_Questions: String(r.Content || '[]') };
  if (String(r.Doc_Type) === 'JD') { if (r.File_URL) patch.JD_File = String(r.File_URL); if (r.Content) patch.JD_Text = String(r.Content); }
  update_(T.MRF, r.Line_ID, patch, u);
  return pdocClient_(rec);
}
/** The file of any JD version, for the in-app viewer. */
function apiDocFile(docId) {
  currentUser_();
  const r = pdocById_(docId), fid = cvFileId_(r.File_URL);
  if (!fid) throw new Error('This version has no file (typed JD).');
  let file;
  try { file = DriveApp.getFileById(fid); } catch (e) { throw new Error('You do not have access to this file. Ask the CRM admin to run shareWithTeam.'); }
  const blob = file.getBlob();
  if (blob.getBytes().length > 15 * 1024 * 1024) throw new Error('This file is larger than 15 MB. Open it from Drive instead.');
  return { name: file.getName(), mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()), url: file.getUrl() };
}

/* ---------------- Structured screening questions, candidate screening and fitment (v53) ----------------
 * A question set is {v:2, items:[...]}; each item: id, sec (E eligibility / R role fit / P practical), theme, q, type
 * (text / number / yesno), need (what is required, shown to the candidate's assessor), min / max / partly (number rules),
 * expect ('Yes' for yes/no), imp (M / I / N), ko (knock-out, eligibility only), source, good, watch.
 * Older sets (a plain list of questions) are read as role-fit text questions. */
const SQ_SECS_ = ['E', 'R', 'P'], SQ_TYPES_ = ['text', 'number', 'yesno'], SQ_IMPS_ = ['M', 'I', 'N'];
const SQ_WEIGHT_ = { M: 3, I: 2, N: 1 }, SQ_FACTOR_ = { M: 1, P: 0.5, G: 0 };
const SQ_BANDS_ = [[85, 'Strong'], [70, 'Good'], [50, 'Borderline'], [0, 'Weak']];
function sqParse_(content) {
  let v = content;
  if (typeof v === 'string') { try { v = JSON.parse(v || '[]'); } catch (e) { v = []; } }
  if (Array.isArray(v)) return v.filter(function (q) { return String(q || '').trim(); }).map(function (q, i) {
    return { id: 'R' + (i + 1), sec: 'R', theme: '', label: String(q).slice(0, 60), q: String(q), type: 'text', need: '', imp: 'I', ko: false, source: '', good: '', watch: '' };
  });
  return (v && Array.isArray(v.items)) ? v.items : [];
}
function sqTexts_(content) { return sqParse_(content).map(function (i) { return i.q; }); }
function sqCut_(s, n) { s = String(s || '').trim(); if (s.length <= n) return s; const c = s.slice(0, n), i = c.lastIndexOf(' '); return (i > n * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.]+$/, '') + '\u2026'; }
function sqNum_(x) { if (x === '' || x === null || x === undefined) return null; const n = Number(x); return isNaN(n) ? null : n; }
/** Cleans and numbers a question set (E1…, R1…, P1…). */
function sqNormalize_(items) {
  if (!Array.isArray(items)) throw new Error('No questions were sent.');
  const out = [], cnt = { E: 0, R: 0, P: 0 };
  items.forEach(function (it) {
    const q = String(it && it.q || '').trim();
    if (!q) return;
    const sec = SQ_SECS_.indexOf(it.sec) >= 0 ? it.sec : 'R', type = SQ_TYPES_.indexOf(it.type) >= 0 ? it.type : 'text';
    cnt[sec]++;
    const o = { id: sec + cnt[sec], sec: sec, theme: sec === 'R' ? String(it.theme || '').trim().slice(0, 60) : '', label: (String(it.label || '').trim() || q.replace(/\?$/, '')).slice(0, 60), q: q.slice(0, 300), type: type,
      need: String(it.need || '').trim().slice(0, 300), imp: sec === 'P' ? '' : (SQ_IMPS_.indexOf(it.imp) >= 0 ? it.imp : 'I'), ko: sec === 'E' && !!it.ko,
      source: String(it.source || '').trim().slice(0, 160), good: String(it.good || '').trim().slice(0, 400), watch: String(it.watch || '').trim().slice(0, 200) };
    if (type === 'number') { o.min = sqNum_(it.min); o.max = sqNum_(it.max); o.partly = sqNum_(it.partly); }
    if (type === 'yesno') o.expect = it.expect === 'No' ? 'No' : 'Yes';
    out.push(o);
  });
  if (out.length > 30) throw new Error('Keep the screening to 30 questions or fewer.');
  if (!out.some(function (o) { return o.sec !== 'P'; })) throw new Error('Add at least one eligibility or role-fit question.');
  return out;
}
/** Automatic rating for numbers and yes / no; '' when the recruiter must rate. */
function sqAuto_(it, ans) {
  const a = String(ans == null ? '' : ans).trim();
  if (!a || it.sec === 'P') return '';
  if (it.type === 'yesno') return /^y/i.test(a) === (it.expect !== 'No') ? 'M' : 'G';
  if (it.type === 'number') {
    const v = Number(String(a).replace(/[^0-9.]/g, ''));
    if (isNaN(v) || String(a).replace(/[^0-9.]/g, '') === '') return '';
    if (it.min != null) return v >= it.min ? 'M' : 'G';
    if (it.max != null) return v <= it.max ? 'M' : (it.partly != null && v <= it.partly ? 'P' : 'G');
  }
  return '';
}
/** Scores a screening: answers {id: {a, r, o}} (o = rating set by the recruiter over the automatic one). */
function sqScore_(items, answers) {
  answers = answers || {};
  let earned = 0, max = 0, met = 0, partly = 0, gaps = 0, rated = 0, total = 0;
  const ko = [], strengths = [], gapList = [], partList = [];
  const rated_ = {};
  items.forEach(function (it) {
    if (it.sec === 'P') return;
    total++;
    const x = answers[it.id] || {}, auto = sqAuto_(it, x.a);
    const r = x.o && x.r ? x.r : (auto || (it.type === 'text' ? x.r : '') || '');
    rated_[it.id] = r;
    const w = SQ_WEIGHT_[it.imp] || 2;
    max += w;
    if (!r) return;
    rated++; earned += w * SQ_FACTOR_[r];
    const label = it.need ? it.q : it.q;
    if (r === 'M') { met++; if (it.sec === 'R' && it.imp !== 'N') strengths.push(it.id); }
    if (r === 'P') { partly++; partList.push(it.id); }
    if (r === 'G') { gaps++; gapList.push(it.id); if (it.ko) ko.push(it.id); }
  });
  const pct = max ? Math.round(100 * earned / max) : 0, complete = total > 0 && rated === total;
  const band = ko.length ? 'Not eligible' : !complete ? 'Incomplete' : SQ_BANDS_.filter(function (b) { return pct >= b[0]; })[0][1];
  return { pct: pct, band: band, met: met, partly: partly, gaps: gaps, rated: rated, total: total, complete: complete, koFailed: ko, strengths: strengths, gapList: gapList, partList: partList, ratings: rated_ };
}
/** The composed JD behind the final JD version (Create JD), or a fresh composition from the JD Master, or null. */
function sqJdSource_(line) {
  let dr = null;
  try {
    const fin = pdocFinal_(pdocList_(line.Line_ID, 'JD'));
    const rows = readTable_('JDM_Drafts').rows.filter(function (r) { return String(r.Line_ID) === String(line.Line_ID); });
    const match = fin && fin.File_URL ? rows.filter(function (r) { return String(r.File_URL) === String(fin.File_URL); }) : [];
    const use = match.length ? match[match.length - 1] : null;
    if (use) dr = JSON.parse(String(use.Draft_JSON || '{}'));
  } catch (e) { dr = null; }
  if (!dr) { try { dr = apiJdmDraftForLine(line.Line_ID, ''); } catch (e) { dr = null; } }
  return dr;
}
/** Drafts a structured question set from the final JD. */
function sqDraft_(line) {
  const g = String(line.Grade || '').trim().toUpperCase(), gk = typeof jdmGradeKey_ === 'function' ? jdmGradeKey_(g) : g;
  const dr = sqJdSource_(line) || {};
  const pol = typeof jdmPolicyExp_ === 'function' ? jdmPolicyExp_(gk, line.Position) : null;
  const items = [];
  const E = function (o) { items.push(Object.assign({ sec: 'E', imp: 'M', ko: true }, o)); };
  const R = function (o) { items.push(Object.assign({ sec: 'R', imp: 'I', ko: false }, o)); };
  E({ label: 'Qualification', q: 'What is your highest qualification, and in which discipline?', type: 'text', need: dr.qualification || 'As required by the JD', source: dr.qualification ? 'JD qualification' : 'JD' });
  const minExp = pol ? pol.degree : (dr.expMin !== '' && dr.expMin != null ? Number(dr.expMin) : null);
  E({ label: 'Total experience', q: 'How many years of total work experience do you have?', type: 'number', min: minExp,
    need: minExp != null ? minExp + '+ years' + (pol && pol.iti ? ' (' + pol.iti + '+ with 12th / ITI)' : '') : 'As required by the JD',
    source: pol ? 'Recruitment Policy App. F (' + gk + ')' : 'Grade norm' });
  if (dr.expRelevant) {
    const m = String(dr.expRelevant).match(/(\d+(\.\d+)?)/);
    E({ label: 'Relevant experience', q: 'How many years of that experience are directly relevant to this role?', type: 'number', min: m ? Number(m[1]) : null,
      need: sqCut_(String(dr.expRelevant).replace(/^Total:\s*/i, ''), 140), source: 'JD relevant experience' });
  }
  const shiftText = [line.Position, dr.designation, dr.working, dr.summary].join(' ');
  if (/shift/i.test(shiftText) || /^W/.test(gk)) E({ label: 'Rotational shifts', q: 'Are you willing to work rotational shifts, including nights?', type: 'yesno', expect: 'Yes', need: 'Yes', source: 'JD: shift role' });
  E({ label: 'Based at ' + (dr.unit ? dr.unit + ' ' : '') + 'plant', q: 'Are you willing to be based at our ' + (dr.unit ? dr.unit + ' ' : '') + 'plant location?', type: 'yesno', expect: 'Yes', need: 'Yes', source: 'Position location' });
  E({ label: 'Notice period', q: 'What is your notice period (days)?', type: 'number', max: 30, partly: 60, imp: 'I', ko: false, need: 'Up to 30 days (31\u201360 partly)', source: 'Recruitment Policy 20.1 (notice over 30 days adds to TAT)' });
  let comps = [];
  const cdept = dr.compDept || (typeof jdmDeptFor_ === 'function' ? jdmDeptFor_(line.Dept) : '');
  try { if (cdept && typeof jdmCompetenciesAt_ === 'function') comps = jdmCompetenciesAt_(cdept, gk); } catch (e) { comps = []; }
  const dep = comps.filter(function (c) { return !c.common; }).sort(function (a, b) { return b.level - a.level || a.name.localeCompare(b.name); });
  const crit = dep.filter(function (c) { return /Safety|Statutory/i.test(c.crit); }).slice(0, 2);
  const tech = dep.filter(function (c) { return crit.indexOf(c) < 0; }).slice(0, 2);
  const defOf = function (c) { return String(c.def || '').replace(/^[^:]{4,50}:\s*/, '').replace(/^\w/, function (ch) { return ch.toUpperCase(); }); };
  tech.forEach(function (c) { R({ theme: 'Core technical', label: c.name, q: 'Describe your hands-on experience with ' + c.name + '.', type: 'text', imp: 'I', need: defOf(c) || 'Level ' + c.level, good: defOf(c), source: c.name + ' L' + c.level }); });
  crit.forEach(function (c) { R({ theme: 'Safety and statutory', label: c.name, q: 'Walk us through your hands-on work with ' + c.name + ', including the safety steps you follow.', type: 'text', imp: 'M', need: defOf(c) || 'Level ' + c.level, good: defOf(c),
    watch: 'Cannot describe the steps in order, or has bypassed them to save time', source: c.name + ' L' + c.level + ' (' + c.crit.toLowerCase() + ')' }); });
  const stm = [];
  (dr.groups || []).filter(function (gp) { return !/Safety|Housekeeping|5S/i.test(gp.cat); }).sort(function (a, b) { return (b.items || []).length - (a.items || []).length; })
    .forEach(function (gp) { const it = (gp.items || []).filter(function (x) { return String(x.text || '').length > 25; })[0]; if (it && stm.length < 2) stm.push([gp.cat, it.text]); });
  stm.forEach(function (s) { R({ theme: 'Key responsibilities', label: String(s[1]).split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:]$/, ''), q: 'The role requires: \u201c' + String(s[1]).replace(/\.$/, '') + '.\u201d How have you done this in your work?', type: 'text', imp: 'I', need: 'Has done this regularly, with a concrete example', good: 'A specific example with scale, result and own role', source: 'JD: ' + s[0] }); });
  R({ theme: 'Problem solving and leadership', label: 'Problem solving', q: 'Describe a difficult problem you solved at work: what happened, what did you do, what changed?', type: 'text', imp: 'I', need: 'Clear cause, own action and a lasting result', good: 'Root cause, own action, result measured', watch: 'Blames others; no lasting fix', source: 'Problem Solving & Root Cause Analysis' });
  if (dr.reportees || /^M[1-6]$/.test(gk)) R({ theme: 'Problem solving and leadership', label: 'Leading a team', q: 'How many people have you led, and how do you plan their work and develop them?', type: 'text', imp: 'I', need: dr.reportees ? 'Has led a team (' + String(dr.reportees).slice(0, 60) + ')' : 'Has led a team', good: 'Team size, planning routine, training given', source: 'JD reportees / leadership' });
  const core = comps.filter(function (c) { return c.common && /Digital|ERP|MIS/i.test(c.name); })[0];
  if (core) R({ theme: 'Problem solving and leadership', label: 'Records and ERP', q: 'How do you keep records and reports (logbook, ERP / SAP or similar)?', type: 'text', imp: 'N', need: 'Regular, accurate system entries', good: 'Names the system; uses the data to plan', source: core.name + ' L' + core.level });
  [['Current CTC', 'Current CTC (fixed and variable)'], ['Expected CTC', 'Expected CTC'], ['Earliest joining', 'Earliest joining date'], ['Location', 'Current location, and reason for change'],
    ['Currently employed', 'Currently employed? If not, since when'], ['Relatives in BFCL', 'Any relatives working in BFCL? (Policy 17.2)']]
    .forEach(function (p) { items.push({ sec: 'P', label: p[0], q: p[1], type: 'text' }); });
  return sqNormalize_(items);
}
function apiSqDraft(lineId) {
  const u = currentUser_(); ensureSchema_();
  const line = requireLineEdit_(u, lineId);
  if (!pdocState_(lineId).jdFinal) throw new Error('Finalise the JD with the department first: screening questions are drafted from the final JD.');
  return sqDraft_(line);
}

const SCR_HEADERS_ = ['Screen_ID', 'App_ID', 'Line_ID', 'Candidate_ID', 'MRF_No', 'Position', 'SQ_Doc_ID', 'SQ_Version', 'JD_Version', 'Items_JSON', 'Answers_JSON', 'Note',
  'Band', 'Score_Pct', 'Met', 'Partly', 'Gaps', 'Total', 'KO_Failed', 'Status', 'Shared_On', 'Shared_With', 'Share_Reason', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
T.SCR = { name: 'Screenings', id: 'Screen_ID', prefix: 'SCR-', width: 5, dates: [], editable: [] };
function scrSchema_() { addSheet_(T.SCR.name, SCR_HEADERS_); }
function scrOf_(appId) { return readTable_(T.SCR.name).rows.filter(function (r) { return String(r.App_ID) === String(appId); })[0] || null; }
/** The final question version of a position (the questions candidates are screened on), or null. */
function sqFinalFor_(lineId) {
  const f = pdocFinal_(pdocList_(lineId, 'SQ')), l = pdocLast_(pdocList_(lineId, 'SQ'));
  return f && f === l ? f : null;
}
function hodOf_(dept) {
  const h = readTable_('M_Departments').rows.filter(function (d) { return String(d.Dept).trim() === String(dept || '').trim(); })[0] || {};
  return { name: String(h.HOD_Name || ''), email: String(h.HOD_Email || '') };
}
function scrClient_(s, withDetail) {
  if (!s) return null;
  const o = { id: String(s.Screen_ID), appId: String(s.App_ID), lineId: String(s.Line_ID), mrf: String(s.MRF_No || ''), position: String(s.Position || ''), sqVersion: Number(s.SQ_Version) || 0, jdVersion: String(s.JD_Version || ''),
    band: String(s.Band), pct: Number(s.Score_Pct) || 0, met: Number(s.Met) || 0, partly: Number(s.Partly) || 0, gaps: Number(s.Gaps) || 0, total: Number(s.Total) || 0,
    koFailed: String(s.KO_Failed || '') ? String(s.KO_Failed).split(',') : [], status: String(s.Status), sharedOn: ymd_(s.Shared_On), sharedWith: String(s.Shared_With || ''), shareReason: String(s.Share_Reason || ''),
    by: String(s.Updated_By || s.Created_By || ''), on: ymd_(s.Updated_At || s.Created_At), note: String(s.Note || '') };
  if (withDetail) { try { o.items = JSON.parse(String(s.Items_JSON || '[]')); } catch (e) { o.items = []; } try { o.answers = JSON.parse(String(s.Answers_JSON || '{}')); } catch (e) { o.answers = {}; } o.result = sqScore_(o.items, o.answers); }
  return o;
}
/** Everything the screening screen needs for one candidate on one position. */
function apiScreening(appId) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId), line = lineOf_(app.Line_ID);
  const cand = readTable_(T.CAND.name).rows.filter(function (c) { return c.Candidate_ID === app.Candidate_ID; })[0] || {};
  const fin = sqFinalFor_(app.Line_ID), scr = scrOf_(appId), st = pdocState_(app.Line_ID);
  const cur = scrClient_(scr, true);
  return { appId: String(appId), stage: String(app.Stage), status: String(app.Status), canEdit: canEditLine_(u, line) && String(app.Status) === 'Active',
    line: { id: String(line.Line_ID), mrf: String(line.MRF_No || ''), position: String(line.Position), grade: String(line.Grade || ''), dept: String(line.Dept) },
    cand: { id: String(cand.Candidate_ID || ''), name: String(cand.Name || ''), designation: String(cand.Current_Designation || ''), company: String(cand.Current_Company || ''),
      exp: String(cand.Total_Exp_Years || cand.Experience || ''), education: String(cand.Education || ''), location: String(cand.Current_Location || ''), hasCv: !!cand.CV_File_URL },
    finalItems: fin ? sqParse_(String(fin.Content)) : null, finalVersion: fin ? Number(fin.Version) : 0, jdVersion: st.jdFinal ? st.jdFinalVersion : 0,
    screening: cur, newerQuestions: !!(cur && fin && cur.sqVersion && Number(fin.Version) !== cur.sqVersion), hod: hodOf_(line.Dept), recruiter: String(line.Recruiter || '') };
}
/** Saves the screening (answers, ratings, note); complete = every scored question rated. restart = use the current final questions. */
function apiSaveScreening(appId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const app = appOf_(appId), line = requireLineEdit_(u, app.Line_ID);
  if (String(app.Status) !== 'Active') throw new Error('This candidate is ' + String(app.Status).toLowerCase() + '. Reactivate them first.');
  const fin = sqFinalFor_(app.Line_ID), old = scrOf_(appId);
  let items, sqDoc, sqVer;
  if (old && !d.restart) { items = JSON.parse(String(old.Items_JSON || '[]')); sqDoc = String(old.SQ_Doc_ID); sqVer = Number(old.SQ_Version); }
  else {
    if (!fin) throw new Error('This position has no final screening questions yet. Confirm them with the department in JD & questions.');
    items = sqParse_(String(fin.Content)); sqDoc = String(fin.Doc_ID); sqVer = Number(fin.Version);
  }
  const answers = {};
  items.forEach(function (it) {
    const x = (d.answers || {})[it.id] || {};
    const a = clean_(String(x.a == null ? '' : x.a)).slice(0, 500), r = ['M', 'P', 'G'].indexOf(x.r) >= 0 ? x.r : '';
    const auto = sqAuto_(it, a);
    answers[it.id] = { a: a, r: it.sec === 'P' ? '' : (x.o && r ? r : (auto || (it.type === 'text' ? r : ''))), o: !!(x.o && r && auto && r !== auto) };
  });
  const res = sqScore_(items, answers);
  if (d.complete && !res.complete) throw new Error('Rate every eligibility and role-fit answer before completing (' + (res.total - res.rated) + ' left).');
  const st = pdocState_(app.Line_ID);
  const patch = { Line_ID: String(app.Line_ID), Candidate_ID: String(app.Candidate_ID), MRF_No: String(line.MRF_No || ''), Position: String(line.Position), SQ_Doc_ID: sqDoc, SQ_Version: sqVer,
    JD_Version: st.jdFinal ? st.jdFinalVersion : '', Items_JSON: JSON.stringify(items), Answers_JSON: JSON.stringify(answers), Note: clean_(String(d.note || '')).slice(0, 1000),
    Band: res.band, Score_Pct: res.pct, Met: res.met, Partly: res.partly, Gaps: res.gaps, Total: res.total, KO_Failed: res.koFailed.join(','), Status: d.complete || (old && String(old.Status) === 'Complete' && res.complete) ? 'Complete' : 'Draft' };
  if (old && d.restart) { patch.Shared_On = ''; patch.Shared_With = ''; patch.Share_Reason = ''; }
  const rec = old ? update_(T.SCR, old.Screen_ID, patch, u) : insert_(T.SCR, Object.assign({ App_ID: String(appId) }, patch), u);
  if (patch.Status === 'Complete') {
    const map = {}; items.forEach(function (it) { map[it.q] = answers[it.id].a; });
    if (String(app.Stage) === 'Sourced') apiMoveStage(appId, 'Screened', { answers: map, note: 'Screening recorded: ' + res.band + ' (' + res.met + ' of ' + res.total + ' met)', _fromScreening: true });
    else update_(T.APP, appId, { Screening_JSON: JSON.stringify(map) }, u);
  }
  return apiScreening(appId);
}
/** Records that the CV and screening were shared with the department; optionally moves the candidate to Shared. */
function apiScreeningShared(appId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const app = appOf_(appId); requireLineEdit_(u, app.Line_ID);
  const s = scrOf_(appId);
  if (!s || String(s.Status) !== 'Complete') throw new Error('Complete the screening before sharing it with the department.');
  const reason = clean_(String(d.reason || '').trim()).slice(0, 500);
  if (String(s.Band) === 'Not eligible' && !reason) throw new Error('This candidate did not meet a knock-out requirement. Enter the reason for sharing anyway.');
  update_(T.SCR, s.Screen_ID, { Shared_On: new Date(), Shared_With: clean_(String(d.sharedWith || '')).slice(0, 200), Share_Reason: reason }, u);
  const fi = STAGES.indexOf(String(app.Stage));
  if (d.move && fi < STAGES.indexOf('Shared')) apiMoveStage(appId, 'Shared', { note: 'Shared with ' + (d.sharedWith || 'the department') + ': CV and screening (' + s.Band + ')' + (reason ? '. Reason: ' + reason : '') });
  return apiScreening(appId);
}
/** Every screening of a candidate, newest first (candidate profile history). */
function apiCandidateScreenings(candId) {
  currentUser_(); ensureSchema_();
  return readTable_(T.SCR.name).rows.filter(function (s) { return String(s.Candidate_ID) === String(candId); })
    .sort(function (a, b) { return ms_(b.Updated_At || b.Created_At) - ms_(a.Updated_At || a.Created_At); }).map(function (s) { return scrClient_(s, true); });
}
