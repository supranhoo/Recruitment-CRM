/**
 * Background verification (BGV) tracker. Every hire in scope has up to two cases:
 *   Previous employer: the candidate's earlier employers, started within 3 days after the offer (Policy 9.1.1).
 *   Current employer: the employer the candidate is leaving, checked only after joining, started within 2 days of joining.
 * The position's recruiter owns the cases; TA Leads, the Head of HR and Admin oversee them; the Head of HR (or Admin)
 * decides on discrepancies. Vendors do the checks and the recruiter coordinates them. The settings (who is in scope,
 * deadlines, limits) are versions in BGV_Rules. The dates on the position (BGV_Prev_Org_Date, BGV_Current_Org_Date)
 * are kept in step with the cases, so the KPI scorecard and the to-dos keep working unchanged.
 */
const BGV_CASES_ = { name: 'BGV_Cases', id: 'Case_ID', prefix: 'BGV-', width: 5 };
const BGV_CHECKS_ = { name: 'BGV_Checks', id: 'Check_ID', prefix: 'BGC-', width: 5 };
const BGV_LOG_ = { name: 'BGV_Log', id: 'Log_ID', prefix: 'BGL-', width: 6 };
const BGV_VENDORS_ = { name: 'BGV_Vendors', id: 'Vendor_ID', prefix: 'VND-', width: 3 };
const BGV_RULES_ = 'BGV_Rules';
const BGV_CASE_COLS_ = ['Case_ID', 'Type', 'Line_ID', 'MRF_No', 'App_ID', 'Candidate_ID', 'Candidate_Name', 'Position', 'Grade', 'Dept', 'Recruiter',
  'Trigger_Date', 'Due_Date', 'Result_Due', 'Consent_On', 'Consent_File', 'Vendor_ID', 'Vendor_Ref', 'Initiated_On', 'Initiation_Proof_File', 'Status',
  'Outcome', 'Report_On', 'Report_File', 'Decision', 'Decision_By', 'Decision_On', 'Decision_Note', 'Closed_On', 'Remarks', 'Legacy', 'Rules_Version',
  'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
const BGV_CHECK_COLS_ = ['Check_ID', 'Case_ID', 'Check_Type', 'Subject', 'Period', 'Status', 'Finding', 'Verified_On', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
const BGV_LOG_COLS_ = ['Log_ID', 'Case_ID', 'At', 'By', 'Kind', 'Old_Status', 'New_Status', 'Note'];
const BGV_VENDOR_COLS_ = ['Vendor_ID', 'Name', 'Contact_Person', 'Email', 'Phone', 'Checks_Offered', 'Std_TAT_Days', 'Active', 'Contract_End', 'Note',
  'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
const BGV_RULE_COLS_ = ['Version_ID', 'Effective_From', 'Status', 'Config_JSON', 'Reason', 'Remark', 'Created_By', 'Created_At'];
const BGV_TYPES_ = ['Previous employer', 'Current employer'];
const BGV_STATUSES_ = ['Not started', 'Awaiting consent', 'Initiated', 'In progress', 'Insufficiency', 'Report received', 'Under review', 'Closed', 'Cancelled'];
const BGV_OUTCOMES_ = ['Clear', 'Minor discrepancy', 'Major discrepancy', 'Unable to verify', 'Waived'];
const BGV_CHECK_STATUSES_ = ['Pending', 'In progress', 'Verified', 'Discrepancy', 'Unable to verify', 'Not applicable'];
const BGV_LOG_KINDS_ = ['Note', 'Chaser', 'Call', 'Email', 'Vendor update', 'Candidate'];
const BGV_DECISIONS_ = { 'Previous employer': ['Proceed with the offer', 'Hold the offer', 'Withdraw the offer'], 'Current employer': ['No action', 'Warning', 'Review of employment', 'Terminate employment'] };
/** Where a case may go from each status (the page offers only these). */
const BGV_NEXT_ = {
  'Not started': ['Awaiting consent', 'Initiated', 'Cancelled'],
  'Awaiting consent': ['Initiated', 'Cancelled'],
  'Initiated': ['In progress', 'Insufficiency', 'Report received', 'Cancelled'],
  'In progress': ['Insufficiency', 'Report received', 'Cancelled'],
  'Insufficiency': ['In progress', 'Report received', 'Cancelled'],
  'Report received': ['Under review', 'In progress'],
  'Under review': ['Closed', 'In progress'],
  'Closed': ['Under review'],
  'Cancelled': []
};

/* ---------------------------------------------------------------- rules (versions) -------------------------- */

function bgvDefaultRules_() {
  return { scope: { managerPlus: true, flagged: true }, prevInitDays: 3, currInitDays: 2, resultBeforeJoinDays: 2, shortGapDays: 5, vendorTatDays: 7,
    chaserDays: 3, reviewDays: 2, decisionDays: 2, amberPct: 80, retentionReportYears: 3, retentionNonJoinerMonths: 6,
    defaultChecks: ['Employment', 'Conduct', 'Last drawn pay'], optionalChecks: ['Education', 'Identity', 'Address', 'Criminal'] };
}
const BGV_RULE_NUMS_ = [['prevInitDays', 'Previous employer: start within (days after the offer)', 0, 30], ['currInitDays', 'Current employer: start within (days after joining)', 0, 30],
  ['resultBeforeJoinDays', 'Previous employer: report needed (days before joining)', 0, 30], ['shortGapDays', 'Offer to joining shorter than (days): report needed 1 day before joining', 1, 60],
  ['vendorTatDays', 'Vendor turnaround per check (days)', 1, 60], ['chaserDays', 'Chaser after no update for (days)', 1, 30], ['reviewDays', 'Review and close within (days of the report)', 0, 30],
  ['decisionDays', 'Head of HR decides within (days)', 0, 30], ['amberPct', 'Amber warning at (% of the limit)', 50, 99],
  ['retentionReportYears', 'Keep reports for (years)', 1, 15], ['retentionNonJoinerMonths', 'Keep data of candidates who do not join for (months)', 1, 60]];

function bgvRulesRows_() {
  return readTable_(BGV_RULES_, true).rows.map(function (r) {
    let cfg = {}; try { cfg = JSON.parse(String(r.Config_JSON || '{}')); } catch (e) { }
    return { id: String(r.Version_ID), no: Number(String(r.Version_ID).replace(/\D/g, '')) || 0, eff: ymd_(r.Effective_From), status: String(r.Status || ''), cfg: cfg,
      reason: String(r.Reason || ''), remark: String(r.Remark || ''), by: String(r.Created_By || ''), at: r.Created_At instanceof Date ? fmt_(r.Created_At, TZ, 'd MMM yyyy, HH:mm') : '' };
  });
}
/** The rules in force on a day: the latest active version that has taken effect (the built-in defaults if there is none). */
function bgvRules_(day) {
  const d = day || ymd_(new Date());
  let v = null;
  try { v = bgvRulesRows_().filter(function (x) { return x.status === 'Active' && x.eff && x.eff <= d; }).sort(function (a, b) { return a.eff < b.eff ? 1 : a.eff > b.eff ? -1 : b.no - a.no; })[0]; } catch (e) { }
  const cfg = Object.assign(bgvDefaultRules_(), v ? v.cfg : {});
  cfg.scope = Object.assign({ managerPlus: true, flagged: true }, cfg.scope || {});
  return { id: v ? v.id : 'built-in', eff: v ? v.eff : '', cfg: cfg };
}

/* ---------------------------------------------------------------- schema and migration ---------------------- */

function bgvSchema_() {
  addSheet_(BGV_CASES_.name, BGV_CASE_COLS_);
  addSheet_(BGV_CHECKS_.name, BGV_CHECK_COLS_);
  addSheet_(BGV_LOG_.name, BGV_LOG_COLS_);
  addSheet_(BGV_VENDORS_.name, BGV_VENDOR_COLS_);
  const ss = ss_();
  let sh = ss.getSheetByName(BGV_RULES_);
  if (!sh) {
    sh = ss.insertSheet(BGV_RULES_);
    sh.getRange(1, 1, 1, BGV_RULE_COLS_.length).setValues([BGV_RULE_COLS_]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
    sh.setFrozenRows(1);
  }
  if (sh.getLastRow() <= 1) {
    const now = new Date(), o = { Version_ID: 'BGR-V1', Effective_From: new Date(now.getFullYear(), now.getMonth(), now.getDate()), Status: 'Active', Config_JSON: JSON.stringify(bgvDefaultRules_()),
      Reason: 'Initial setup', Remark: 'Policy 9.1.1 and the BGV plan agreed with the Head of HR', Created_By: 'system', Created_At: now };
    sh.getRange(2, 1, 1, BGV_RULE_COLS_.length).setValues([BGV_RULE_COLS_.map(function (h) { return o[h]; })]);
  }
  dropStale_(BGV_RULES_);
}

/** Appends many rows to a sheet in one write (no lock: callers hold it). Rows are objects keyed by column. */
function bgvAppend_(def, cols, objs) {
  if (!objs.length) return;
  const t = readTable_(def.name, true);
  const now = new Date();
  const vals = objs.map(function (o) {
    o[def.id] = nextId_(def, t.rows);
    t.rows.push(o);
    if (cols.indexOf('Created_At') >= 0 && !o.Created_At) { o.Created_At = now; o.Updated_At = now; }
    return cols.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  });
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, vals.length, cols.length).setValues(vals);
  dropStale_(def.name);
}

function bgvCandidateNames_() {
  const m = {};
  readTable_(T.CAND.name).rows.forEach(function (c) { m[c.Candidate_ID] = String(c.Name || ''); });
  return m;
}

/** The result-due date for a previous-employer case: 2 days before joining, or 1 day when the offer comes close to it. */
function bgvResultDue_(offer, doj, cfg) {
  if (!doj) return '';
  const gap = offer ? daysBetween_(offer, doj) : 99;
  return addDays_(doj, -(gap < cfg.shortGapDays ? 1 : cfg.resultBeforeJoinDays));
}

/**
 * Makes sure every hire in scope has its cases and keeps them in step with the position. Safe to run any time: it creates
 * what is missing, follows a change of recruiter, and cancels cases that were never started when BGV is no longer required
 * or the candidate backed out. Returns how many cases it created.
 */
function bgvEnsureCases_(onlyLine) {
  const rules = bgvRules_(), cfg = rules.cfg;
  const lines = readTable_(T.MRF.name).rows.filter(function (l) { return !onlyLine || l.Line_ID === onlyLine; });
  const sheetT = readTable_(BGV_CASES_.name, true), cases = sheetT.rows;
  const byKey = {}, byLine = {};
  cases.forEach(function (c) { const k = c.Line_ID + '|' + c.Type; (byKey[k] = byKey[k] || []).push(c); (byLine[c.Line_ID] = byLine[c.Line_ID] || []).push(c); });
  const names = bgvCandidateNames_();
  const apps = {}; readTable_(T.APP.name).rows.forEach(function (a) { if (String(a.Status) === 'Active' || String(a.Status) === 'Withdrawn') (apps[a.Line_ID] = apps[a.Line_ID] || []).push(a); });
  const fresh = [], checks = [], logs = [];
  const setCell = function (row, col, val) { const c = sheetT.headers.indexOf(col); if (c >= 0) sheetT.sheet.getRange(row, c + 1).setValue(val); };
  const sys = 'system', now = new Date();
  lines.forEach(function (l) {
    const status = positionStatus_(l);
    const required = bgvRequired_(l, cfg);
    const offer = ymd_(l.Offer_Date), doj = ymd_(l.Actual_DOJ), edoj = ymd_(l.EDOJ);
    const mine = byLine[l.Line_ID] || [];
    // owner follows the position
    mine.forEach(function (c) {
      if (['Closed', 'Cancelled'].indexOf(String(c.Status)) < 0 && String(c.Recruiter) !== String(l.Recruiter || '')) { setCell(c._row, 'Recruiter', String(l.Recruiter || '')); c.Recruiter = String(l.Recruiter || ''); }
    });
    // the candidate backed out (any open case), or BGV is no longer required (cases never started): cancel
    mine.forEach(function (c) {
      const st = String(c.Status);
      if (['Closed', 'Cancelled'].indexOf(st) >= 0) return;
      const backedOut = !!l.Backout_Date || status === 'Replaced';
      if (backedOut || (!required && ['Not started', 'Awaiting consent'].indexOf(st) >= 0)) {
        setCell(c._row, 'Status', 'Cancelled'); setCell(c._row, 'Closed_On', now);
        setCell(c._row, 'Remarks', (String(c.Remarks || '') + ' ' + (backedOut ? 'Cancelled: the candidate backed out.' : 'Cancelled: BGV is no longer required.')).trim());
        c.Status = 'Cancelled';
        logs.push({ Case_ID: c.Case_ID, At: now, By: sys, Kind: 'Status', Old_Status: st, New_Status: 'Cancelled', Note: backedOut ? 'The candidate backed out.' : 'BGV is no longer required for this position.' });
      }
    });
    if (!required || l.Backout_Date || String(l.Fill_Type || '') === 'Internal' || ['Offered', 'Closed'].indexOf(status) < 0) return;
    const cand = String(l.Candidate_ID || '');
    const app = (apps[l.Line_ID] || []).filter(function (a) { return a.Candidate_ID === cand && STAGES.indexOf(String(a.Stage)) >= STAGES.indexOf('Offer'); })[0];
    const make = function (type, trigger, due, resultDue) {
      const open = (byKey[l.Line_ID + '|' + type] || []).filter(function (c) { return String(c.Status) !== 'Cancelled' && String(c.Candidate_ID || '') === cand; });
      if (open.length) return;
      const legacyDate = type === BGV_TYPES_[0] ? ymd_(l.BGV_Prev_Org_Date) : ymd_(l.BGV_Current_Org_Date);
      const o = { Type: type, Line_ID: l.Line_ID, MRF_No: String(l.MRF_No || ''), App_ID: app ? app.App_ID : '', Candidate_ID: cand, Candidate_Name: names[cand] || '',
        Position: String(l.Position || ''), Grade: String(l.Grade || ''), Dept: String(l.Dept || ''), Recruiter: String(l.Recruiter || ''),
        Trigger_Date: parseYmd_(trigger), Due_Date: parseYmd_(due), Result_Due: resultDue ? parseYmd_(resultDue) : '', Rules_Version: rules.id,
        Status: legacyDate ? 'Initiated' : 'Not started', Initiated_On: legacyDate ? parseYmd_(legacyDate) : '', Legacy: legacyDate ? 'Yes' : '',
        Remarks: type === BGV_TYPES_[0] ? String(l.BGV_Remarks || '') : '', Created_By: sys, Updated_By: sys };
      if (type === BGV_TYPES_[0] && l.BGV_Prev_Org_File) o.Report_File = String(l.BGV_Prev_Org_File);
      if (type === BGV_TYPES_[1] && l.BGV_Current_Org_File) o.Initiation_Proof_File = String(l.BGV_Current_Org_File);
      fresh.push(o);
    };
    if (offer) make(BGV_TYPES_[0], offer, addDays_(offer, cfg.prevInitDays), bgvResultDue_(offer, doj || edoj, cfg));
    if (doj && status === 'Closed') make(BGV_TYPES_[1], doj, addDays_(doj, cfg.currInitDays), '');
  });
  if (fresh.length) {
    bgvAppend_(BGV_CASES_, BGV_CASE_COLS_, fresh);
    fresh.forEach(function (c) {
      cfg.defaultChecks.forEach(function (t) { checks.push({ Case_ID: c.Case_ID, Check_Type: t, Status: 'Pending', Created_By: sys, Updated_By: sys }); });
      logs.push({ Case_ID: c.Case_ID, At: now, By: sys, Kind: 'Created', New_Status: c.Status, Note: (c.Legacy ? 'Carried over from the position’s BGV fields. ' : '') + (c.Type === BGV_TYPES_[0] ? 'Case opened at the offer.' : 'Case opened at joining.') });
    });
    bgvAppend_(BGV_CHECKS_, BGV_CHECK_COLS_, checks);
  }
  if (logs.length) bgvAppend_(BGV_LOG_, BGV_LOG_COLS_, logs);
  if (cases.length) dropStale_(BGV_CASES_.name);
  return fresh.length;
}
function bgvRequired_(l, cfg) {
  const flag = String(l.BGV_Required || 'Auto');
  if (flag === 'No') return false;
  if (flag === 'Yes') return cfg.scope.flagged !== false;
  return !!cfg.scope.managerPlus && managerPlus_(l.Grade, l.Position);
}
/** Runs the sweep inside the lock, at most every 10 minutes (the page calls it when the tracker opens). */
function bgvSweep_(force) {
  const props = PropertiesService.getScriptProperties(), last = Number(props.getProperty('BGV_SWEEP_AT') || 0);
  if (!force && Date.now() - last < 600000) return 0;
  const n = withLock_(function () { return bgvEnsureCases_(); });
  props.setProperty('BGV_SWEEP_AT', String(Date.now()));
  return n;
}
/** Called after a card moves to Offer or Joined, or a position's dates change: opens the cases for that line. */
function bgvTouchLine_(lineId) { try { withLock_(function () { bgvEnsureCases_(lineId); }); } catch (e) { console.error('BGV cases: ' + e); } }

/* ---------------------------------------------------------------- reading ----------------------------------- */

function bgvIsOwner_(u, c) { return String(c.Recruiter || '').trim().toLowerCase() === String(u.recruiter || '').trim().toLowerCase(); }
function bgvCanWork_(u, c) { return isLead_(u) || bgvIsOwner_(u, c); }
function bgvRequireWork_(u, c) { if (!bgvCanWork_(u, c)) throw new Error('Only ' + c.Recruiter + ', a TA Lead or the Head of HR can work on this BGV case.'); }

/** Red / Amber / Green for an open case, and why. */
function bgvRag_(c, cfg, today) {
  const st = String(c.Status);
  if (['Closed', 'Cancelled'].indexOf(st) >= 0) return { rag: '', why: '' };
  const amber = (cfg.amberPct || 80) / 100;
  const worst = [];
  const add = function (rag, why) { worst.push({ rag: rag, why: why }); };
  if (['Not started', 'Awaiting consent'].indexOf(st) >= 0) {
    const due = ymd_(c.Due_Date);
    if (due && today > due) add('Red', 'Should have started by ' + due + ' (' + daysBetween_(due, today) + ' day' + (daysBetween_(due, today) === 1 ? '' : 's') + ' late)');
    else if (due && daysBetween_(today, due) <= 1) add('Amber', 'Start by ' + due);
  } else if (['Initiated', 'In progress', 'Insufficiency'].indexOf(st) >= 0) {
    const init = ymd_(c.Initiated_On);
    if (init) {
      const days = daysBetween_(init, today), lim = cfg.vendorTatDays;
      if (days > lim) add('Red', days + ' days since it started (limit ' + lim + ')');
      else if (days >= Math.ceil(lim * amber)) add('Amber', days + ' of ' + lim + ' days used');
    }
    const rd = ymd_(c.Result_Due);
    if (rd && today > rd) add('Red', 'Report was needed by ' + rd);
    else if (rd && daysBetween_(today, rd) <= 1) add('Amber', 'Report needed by ' + rd);
  } else if (['Report received', 'Under review'].indexOf(st) >= 0) {
    const rep = ymd_(c.Report_On);
    if (rep) {
      const days = daysBetween_(rep, today), lim = cfg.reviewDays;
      if (days > lim) add('Red', 'Report is ' + days + ' days old and not closed (limit ' + lim + ')');
      else if (days >= Math.ceil(lim * amber)) add('Amber', 'Close the review by ' + addDays_(rep, lim));
    }
  }
  const red = worst.filter(function (x) { return x.rag === 'Red'; })[0], amb = worst.filter(function (x) { return x.rag === 'Amber'; })[0];
  return red || amb || { rag: 'Green', why: '' };
}

/** A case for the page. Anyone sees the status; findings, files and decisions only the owner and leads. */
function bgvOut_(c, u, cfg, today, full) {
  const worker = bgvCanWork_(u, c);
  const d = function (v) { return ymd_(v); };
  const rag = bgvRag_(c, cfg, today);
  const o = { id: String(c.Case_ID), type: String(c.Type), line: String(c.Line_ID), mrf: String(c.MRF_No || ''), app: String(c.App_ID || ''), candId: String(c.Candidate_ID || ''),
    candidate: String(c.Candidate_Name || ''), position: String(c.Position || ''), grade: String(c.Grade || ''), dept: String(c.Dept || ''), recruiter: String(c.Recruiter || ''),
    trigger: d(c.Trigger_Date), due: d(c.Due_Date), resultDue: d(c.Result_Due), initiated: d(c.Initiated_On), status: String(c.Status), rag: rag.rag, why: rag.why, mine: bgvIsOwner_(u, c), canWork: worker,
    legacy: String(c.Legacy) === 'Yes', closed: d(c.Closed_On) };
  if (worker) {
    o.outcome = String(c.Outcome || ''); o.decision = String(c.Decision || ''); o.report = d(c.Report_On); o.vendor = String(c.Vendor_ID || ''); o.vendorRef = String(c.Vendor_Ref || '');
    o.consent = d(c.Consent_On); o.needsDecision = bgvNeedsDecision_(c);
  }
  if (full && worker) {
    o.remarks = String(c.Remarks || ''); o.decisionBy = String(c.Decision_By || ''); o.decisionOn = d(c.Decision_On); o.decisionNote = String(c.Decision_Note || '');
    o.consentFile = String(c.Consent_File || ''); o.reportFile = String(c.Report_File || ''); o.proofFile = String(c.Initiation_Proof_File || ''); o.rules = String(c.Rules_Version || '');
  }
  return o;
}

function bgvCaseRow_(id) {
  const c = readTable_(BGV_CASES_.name).rows.filter(function (r) { return String(r.Case_ID) === String(id); })[0];
  if (!c) throw new Error('BGV case ' + id + ' was not found.');
  return c;
}

/** The BGV tracker: every case (status only for other people's), with counts. Opens the cases for new hires first. */
function apiBgvList() {
  const u = currentUser_(); ensureSchema_();
  try { bgvSweep_(false); } catch (e) { console.error('BGV sweep: ' + e); }
  const rules = bgvRules_(), cfg = rules.cfg, today = ymd_(new Date());
  const rows = readTable_(BGV_CASES_.name).rows.map(function (c) { return bgvOut_(c, u, cfg, today, false); })
    .sort(function (a, b) { return Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, '')); });
  const mine = rows.filter(function (r) { return r.mine; });
  const open = function (list) { return list.filter(function (r) { return ['Closed', 'Cancelled'].indexOf(r.status) < 0; }); };
  const month = today.slice(0, 7);
  const sum = function (list) {
    return { open: open(list).length, toStart: list.filter(function (r) { return ['Not started', 'Awaiting consent'].indexOf(r.status) >= 0; }).length,
      red: open(list).filter(function (r) { return r.rag === 'Red'; }).length, amber: open(list).filter(function (r) { return r.rag === 'Amber'; }).length,
      inProgress: list.filter(function (r) { return ['Initiated', 'In progress', 'Insufficiency'].indexOf(r.status) >= 0; }).length,
      toReview: list.filter(function (r) { return ['Report received', 'Under review'].indexOf(r.status) >= 0; }).length,
      toDecide: list.filter(function (r) { return r.needsDecision; }).length,
      closedMonth: list.filter(function (r) { return r.status === 'Closed' && String(r.closed).slice(0, 7) === month; }).length };
  };
  return { rules: { id: rules.id, cfg: cfg }, today: today, lead: isLead_(u), decide: can_(u, 'bgv_decide'), admin: u.role === ROLES.ADMIN, me: u.recruiter,
    rows: rows.slice(0, 1500), mine: sum(mine), all: sum(rows), vendors: bgvVendorsOut_(), types: BGV_TYPES_, statuses: BGV_STATUSES_ };
}

/** Status lines for a candidate's card, a profile or a position (anyone may see the status). kind: 'line' or 'candidate'. */
function apiBgvFor(kind, id) {
  const u = currentUser_(); ensureSchema_();
  const col = kind === 'candidate' ? 'Candidate_ID' : 'Line_ID', cfg = bgvRules_().cfg, today = ymd_(new Date());
  return readTable_(BGV_CASES_.name).rows.filter(function (c) { return String(c[col]) === String(id) && String(c.Status) !== 'Cancelled'; })
    .map(function (c) { const o = bgvOut_(c, u, cfg, today, false); return { id: o.id, type: o.type, status: o.status, due: o.due, rag: o.rag, why: o.why, recruiter: o.recruiter, canWork: o.canWork, outcome: o.outcome || '' }; });
}

/** One case with its checks and timeline. Only the owner, TA Leads, the Head of HR and Admin can open it. */
function apiBgvCase(id) {
  const u = currentUser_(); ensureSchema_();
  const c = bgvCaseRow_(id);
  bgvRequireWork_(u, c);
  const cfg = bgvRules_().cfg, today = ymd_(new Date());
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v || ''); };
  const checks = readTable_(BGV_CHECKS_.name).rows.filter(function (r) { return String(r.Case_ID) === String(id); })
    .map(function (r) { return { id: String(r.Check_ID), type: String(r.Check_Type), subject: String(r.Subject || ''), period: String(r.Period || ''), status: String(r.Status), finding: String(r.Finding || ''), verified: ymd_(r.Verified_On) }; });
  const log = readTable_(BGV_LOG_.name).rows.filter(function (r) { return String(r.Case_ID) === String(id); })
    .map(function (r) { return { at: at(r.At), by: String(r.By || ''), kind: String(r.Kind || ''), from: String(r.Old_Status || ''), to: String(r.New_Status || ''), note: String(r.Note || '') }; }).reverse();
  const o = bgvOut_(c, u, cfg, today, true);
  o.next = BGV_NEXT_[o.status] || [];
  return { c: o, checks: checks, log: log, vendors: bgvVendorsOut_(), decide: can_(u, 'bgv_decide'), lead: isLead_(u), decisions: BGV_DECISIONS_[o.type] || [], outcomes: BGV_OUTCOMES_,
    checkStatuses: BGV_CHECK_STATUSES_, logKinds: BGV_LOG_KINDS_, optionalChecks: cfg.optionalChecks, rules: cfg };
}

/* ---------------------------------------------------------------- working a case ---------------------------- */

function bgvLog_(u, caseId, kind, from, to, note) {
  bgvAppend_(BGV_LOG_, BGV_LOG_COLS_, [{ Case_ID: caseId, At: new Date(), By: u.email, Kind: kind, Old_Status: from || '', New_Status: to || '', Note: clean_(String(note || '')).slice(0, 500) }]);
}
function bgvDate_(v, label, allowFuture) {
  const s = ymd_(v);
  if (!s) throw new Error('Add the ' + label + '.');
  if (!allowFuture && s > ymd_(new Date())) throw new Error('The ' + label + ' cannot be in the future.');
  return s;
}
/** Keeps the position's two BGV dates in step with its cases (the KPI scorecard and to-dos read them). */
function bgvMirror_(c, u) {
  const line = lineOf_(c.Line_ID);
  if (!line) return;
  const col = c.Type === BGV_TYPES_[0] ? 'BGV_Prev_Org_Date' : 'BGV_Current_Org_Date';
  const mine = ymd_(c.Initiated_On), cur = ymd_(line[col]);
  if (mine && mine !== cur) update_(T.MRF, line.Line_ID, (function () { const p = {}; p[col] = parseYmd_(mine); return p; })(), u);
}

/** Edits what the recruiter records: consent, vendor and reference, dates, outcome and remarks. */
function apiBgvSave(id, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const c = bgvCaseRow_(id);
  bgvRequireWork_(u, c);
  if (['Closed', 'Cancelled'].indexOf(String(c.Status)) >= 0 && !isLead_(u)) throw new Error('This case is ' + String(c.Status).toLowerCase() + '. Only a TA Lead or the Head of HR can change it.');
  const patch = {}, notes = [];
  if ('consentOn' in d) { patch.Consent_On = d.consentOn ? parseYmd_(bgvDate_(d.consentOn, 'consent date')) : ''; notes.push('Consent ' + (d.consentOn ? 'recorded for ' + d.consentOn : 'cleared')); }
  if ('vendor' in d) {
    const v = String(d.vendor || '');
    if (v && v !== 'DIRECT' && !bgvVendorsOut_().some(function (x) { return x.id === v; })) throw new Error('Choose a vendor from the list.');
    patch.Vendor_ID = v; notes.push('Vendor: ' + (v || 'none'));
  }
  if ('vendorRef' in d) patch.Vendor_Ref = clean_(String(d.vendorRef || '')).slice(0, 80);
  if ('initiatedOn' in d) { patch.Initiated_On = d.initiatedOn ? parseYmd_(bgvDate_(d.initiatedOn, 'start date')) : ''; notes.push('Start date ' + (d.initiatedOn || 'cleared')); }
  if ('reportOn' in d) { patch.Report_On = d.reportOn ? parseYmd_(bgvDate_(d.reportOn, 'report date')) : ''; notes.push('Report date ' + (d.reportOn || 'cleared')); }
  if ('outcome' in d) {
    const o = String(d.outcome || '');
    if (o && BGV_OUTCOMES_.indexOf(o) < 0) throw new Error('Unknown outcome.');
    if (o === 'Waived' && !isLead_(u)) throw new Error('Only a TA Lead or the Head of HR can waive a BGV case.');
    patch.Outcome = o; notes.push('Outcome: ' + (o || 'none'));
  }
  if ('remarks' in d) patch.Remarks = clean_(String(d.remarks || '')).slice(0, 1000);
  if (!Object.keys(patch).length) return apiBgvCase(id);
  patch.Updated_By = u.email;
  const rec = update_(BGV_CASES_, id, patch, u);
  bgvLog_(u, id, 'Note', '', '', notes.join('. '));
  bgvMirror_(rec, u);
  return apiBgvCase(id);
}

/**
 * Moves a case to its next status. d: { on (a date), vendor, vendorRef, outcome, note }.
 * Starting needs the consent date and a vendor (or "DIRECT"); a report needs its date; closing needs an outcome, and
 * a discrepancy or an unverified result also needs the Head of HR's decision.
 */
function apiBgvStatus(id, to, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const c = bgvCaseRow_(id), from = String(c.Status);
  bgvRequireWork_(u, c);
  if ((BGV_NEXT_[from] || []).indexOf(to) < 0) throw new Error('A ' + from.toLowerCase() + ' case cannot move to "' + to + '".');
  if (from === 'Closed' && !isLead_(u)) throw new Error('Only a TA Lead or the Head of HR can reopen a closed case.');
  const patch = { Updated_By: u.email };
  if (to === 'Initiated') {
    if (!c.Consent_On && !d.consentOn) throw new Error('Record the candidate’s consent date first. Nothing is checked without consent.');
    if (d.consentOn) patch.Consent_On = parseYmd_(bgvDate_(d.consentOn, 'consent date'));
    const vendor = String(d.vendor || c.Vendor_ID || '');
    if (!vendor) throw new Error('Choose the vendor (or "Direct" if BFCL verifies without one).');
    if (vendor !== 'DIRECT' && !bgvVendorsOut_().some(function (x) { return x.id === vendor; })) throw new Error('Choose a vendor from the list.');
    patch.Vendor_ID = vendor; patch.Vendor_Ref = clean_(String(d.vendorRef || c.Vendor_Ref || '')).slice(0, 80);
    patch.Initiated_On = parseYmd_(bgvDate_(d.on || ymd_(new Date()), 'start date'));
    if (!readTable_(BGV_CHECKS_.name).rows.some(function (r) { return String(r.Case_ID) === String(id) && String(r.Status) !== 'Not applicable'; })) throw new Error('Add at least one check before starting.');
  }
  if (to === 'Report received') {
    if (!c.Initiated_On) throw new Error('This case has no start date yet.');
    patch.Report_On = parseYmd_(bgvDate_(d.on || ymd_(new Date()), 'report date'));
    if (ymd_(patch.Report_On) < ymd_(c.Initiated_On)) throw new Error('The report date cannot be before the start date.');
  }
  if (to === 'Closed') {
    const outcome = String(d.outcome || c.Outcome || '');
    if (!outcome) throw new Error('Record the outcome first.');
    if (BGV_OUTCOMES_.indexOf(outcome) < 0) throw new Error('Unknown outcome.');
    if (['Minor discrepancy', 'Major discrepancy', 'Unable to verify'].indexOf(outcome) >= 0 && !c.Decision) throw new Error('This result needs the Head of HR’s decision before the case can be closed.');
    if (outcome === 'Waived' && !isLead_(u)) throw new Error('Only a TA Lead or the Head of HR can waive a BGV case.');
    const open = readTable_(BGV_CHECKS_.name).rows.filter(function (r) { return String(r.Case_ID) === String(id) && ['Pending', 'In progress'].indexOf(String(r.Status)) >= 0; });
    if (open.length && outcome !== 'Waived') throw new Error(open.length + ' check' + (open.length === 1 ? ' is' : 's are') + ' still open. Mark each as verified, discrepancy, unable to verify or not applicable.');
    patch.Outcome = outcome; patch.Closed_On = new Date();
  }
  if (to === 'Cancelled') { if (!String(d.note || '').trim()) throw new Error('Give the reason for cancelling.'); patch.Closed_On = new Date(); }
  if (from === 'Closed') patch.Closed_On = '';
  patch.Status = to;
  const rec = update_(BGV_CASES_, id, patch, u);
  bgvLog_(u, id, 'Status', from, to, d.note || '');
  bgvMirror_(rec, u);
  return apiBgvCase(id);
}

/** Adds a note, a chaser, a call or an email to the timeline. */
function apiBgvNote(id, kind, note) {
  const u = currentUser_(); ensureSchema_();
  const c = bgvCaseRow_(id);
  bgvRequireWork_(u, c);
  if (BGV_LOG_KINDS_.indexOf(kind) < 0) throw new Error('Unknown kind of entry.');
  note = clean_(String(note || '')).trim();
  if (note.length < 3) throw new Error('Write the note.');
  bgvLog_(u, id, kind, '', '', note);
  update_(BGV_CASES_, id, { Updated_By: u.email }, u);
  return apiBgvCase(id);
}

/** Adds or updates a check. d: { id, type, subject, period, status, finding, verifiedOn }. */
function apiBgvCheckSave(id, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const c = bgvCaseRow_(id), cfg = bgvRules_().cfg;
  bgvRequireWork_(u, c);
  if (['Closed', 'Cancelled'].indexOf(String(c.Status)) >= 0) throw new Error('This case is ' + String(c.Status).toLowerCase() + '. Reopen it to change its checks.');
  const type = String(d.type || '').trim();
  const known = cfg.defaultChecks.concat(cfg.optionalChecks);
  if (!d.id && known.indexOf(type) < 0) throw new Error('Choose one of the checks: ' + known.join(', ') + '.');
  const status = String(d.status || 'Pending');
  if (BGV_CHECK_STATUSES_.indexOf(status) < 0) throw new Error('Unknown check status.');
  if (['Discrepancy', 'Unable to verify'].indexOf(status) >= 0 && String(d.finding || '').trim().length < 3) throw new Error('Describe what was found.');
  const patch = { Subject: clean_(String(d.subject || '')).slice(0, 160), Period: clean_(String(d.period || '')).slice(0, 80), Status: status, Finding: clean_(String(d.finding || '')).slice(0, 600),
    Verified_On: ['Verified', 'Discrepancy', 'Unable to verify'].indexOf(status) >= 0 ? parseYmd_(bgvDate_(d.verifiedOn || ymd_(new Date()), 'verification date')) : '', Updated_By: u.email };
  if (d.id) {
    const row = readTable_(BGV_CHECKS_.name).rows.filter(function (r) { return String(r.Check_ID) === String(d.id) && String(r.Case_ID) === String(id); })[0];
    if (!row) throw new Error('That check was not found.');
    update_(BGV_CHECKS_, d.id, patch, u);
    bgvLog_(u, id, 'Check', '', '', row.Check_Type + ': ' + status);
  } else {
    patch.Case_ID = id; patch.Check_Type = type;
    insert_(BGV_CHECKS_, patch, u);
    bgvLog_(u, id, 'Check', '', '', type + ' check added');
  }
  return apiBgvCase(id);
}

/** The Head of HR's (or Admin's) decision on a discrepancy or an unverified result. */
function apiBgvDecide(id, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  if (!can_(u, 'bgv_decide')) throw new Error('Only the Head of HR or the admin can decide on a BGV discrepancy.');
  const c = bgvCaseRow_(id);
  if (['Report received', 'Under review'].indexOf(String(c.Status)) < 0) throw new Error('A decision is recorded once the report is in (status Report received or Under review).');
  if (['Minor discrepancy', 'Major discrepancy', 'Unable to verify'].indexOf(String(c.Outcome)) < 0) throw new Error('Only a discrepancy or an unverified result needs a decision. Record the outcome first.');
  const decision = String(d.decision || '');
  if ((BGV_DECISIONS_[c.Type] || []).indexOf(decision) < 0) throw new Error('Choose one of the decisions.');
  const note = clean_(String(d.note || '')).trim();
  if (note.length < 10) throw new Error('Write the reason for the decision (at least 10 characters).');
  update_(BGV_CASES_, id, { Decision: decision, Decision_By: u.email, Decision_On: new Date(), Decision_Note: note.slice(0, 600), Updated_By: u.email }, u);
  bgvLog_(u, id, 'Decision', '', '', decision + '. ' + note);
  return apiBgvCase(id);
}

/* ---------------------------------------------------------------- vendors ----------------------------------- */

function bgvVendorsOut_() {
  return readTable_(BGV_VENDORS_.name).rows.map(function (v) {
    return { id: String(v.Vendor_ID), name: String(v.Name || ''), contact: String(v.Contact_Person || ''), email: String(v.Email || ''), phone: String(v.Phone || ''), checks: String(v.Checks_Offered || ''),
      tat: Number(v.Std_TAT_Days) || 0, active: String(v.Active) !== 'No', end: ymd_(v.Contract_End), note: String(v.Note || '') };
  }).sort(function (a, b) { return (b.active - a.active) || a.name.localeCompare(b.name); });
}
/** Adds or updates a vendor (TA Lead, Head of HR, Admin). Vendors are deactivated, never deleted. */
function apiBgvVendorSave(d) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can change the BGV vendors.');
  d = d || {};
  const name = clean_(String(d.name || '')).trim();
  if (name.length < 2) throw new Error('Enter the vendor’s name.');
  const tat = Number(d.tat);
  if (d.tat !== '' && d.tat != null && !(tat >= 1 && tat <= 60)) throw new Error('Standard turnaround must be 1 to 60 days.');
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email))) throw new Error('Enter a valid email address.');
  if (!d.id && bgvVendorsOut_().some(function (v) { return v.name.toLowerCase() === name.toLowerCase(); })) throw new Error('A vendor named ' + name + ' already exists.');
  const patch = { Name: name, Contact_Person: clean_(String(d.contact || '')).slice(0, 80), Email: clean_(String(d.email || '')).slice(0, 100), Phone: clean_(String(d.phone || '')).slice(0, 30),
    Checks_Offered: clean_(String(d.checks || '')).slice(0, 200), Std_TAT_Days: d.tat === '' || d.tat == null ? '' : tat, Active: d.active === false || d.active === 'No' ? 'No' : 'Yes',
    Contract_End: d.end ? parseYmd_(d.end) : '', Note: clean_(String(d.note || '')).slice(0, 300) };
  if (d.id) update_(BGV_VENDORS_, String(d.id), patch, u); else insert_(BGV_VENDORS_, patch, u);
  return bgvVendorsOut_();
}

/* ---------------------------------------------------------------- rules editing (Admin) --------------------- */

function apiBgvRules() {
  const u = currentUser_(); ensureSchema_();
  const act = bgvRules_();
  return { active: { id: act.id, eff: act.eff, cfg: act.cfg }, canEdit: u.role === ROLES.ADMIN, nums: BGV_RULE_NUMS_, today: ymd_(new Date()),
    versions: bgvRulesRows_().sort(function (a, b) { return b.no - a.no; }).map(function (v) { return { id: v.id, eff: v.eff, status: v.status, reason: v.reason, remark: v.remark, by: v.by, at: v.at, cfg: v.cfg }; }) };
}
/** Saves a new version of the rules. d: { values, scope: {managerPlus, flagged}, eff, reason, remark }. Admin only. */
function apiBgvRulesSave(d) {
  const u = currentUser_(); ensureSchema_();
  requireAdmin_(u);
  d = d || {};
  const cur = bgvRules_().cfg, cfg = JSON.parse(JSON.stringify(cur));
  BGV_RULE_NUMS_.forEach(function (n) {
    if (!(n[0] in (d.values || {}))) return;
    const v = Number(d.values[n[0]]);
    if (!(v >= n[2] && v <= n[3] && v === Math.round(v))) throw new Error(n[1] + ': enter a whole number from ' + n[2] + ' to ' + n[3] + '.');
    cfg[n[0]] = v;
  });
  if (d.scope) cfg.scope = { managerPlus: d.scope.managerPlus !== false, flagged: d.scope.flagged !== false };
  const eff = ymd_(d.eff), today = ymd_(new Date());
  if (!eff) throw new Error('Pick the date the new rules take effect.');
  if (eff < today) throw new Error('The rules can take effect from today or a later date, not the past.');
  const reason = clean_(String(d.reason || '')).trim();
  if (['Policy change', 'Correction', 'Other'].indexOf(reason) < 0) throw new Error('Choose the reason for the change.');
  const remark = clean_(String(d.remark || '')).trim();
  if (remark.length < 10) throw new Error('Write a remark of at least 10 characters: what changed and why.');
  const changes = BGV_RULE_NUMS_.filter(function (n) { return cfg[n[0]] !== cur[n[0]]; }).map(function (n) { return n[1] + ': ' + cur[n[0]] + ' → ' + cfg[n[0]]; });
  if (JSON.stringify(cfg.scope) !== JSON.stringify(cur.scope)) changes.push('Scope changed');
  if (!changes.length) throw new Error('Nothing changed.');
  const id = withLock_(function () {
    const rows = bgvRulesRows_(), vid = 'BGR-V' + (rows.reduce(function (m, r) { return Math.max(m, r.no); }, 0) + 1);
    const sh = sheet_(BGV_RULES_), heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const o = { Version_ID: vid, Effective_From: parseYmd_(eff), Status: 'Active', Config_JSON: JSON.stringify(cfg), Reason: reason, Remark: (remark + ' | ' + changes.join('; ')).slice(0, 1500), Created_By: u.email, Created_At: new Date() };
    sh.getRange(sh.getLastRow() + 1, 1, 1, heads.length).setValues([heads.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    dropStale_(BGV_RULES_);
    return vid;
  });
  audit_(u, BGV_RULES_, id, 'Create', 'rules', '', reason + ' from ' + eff + ': ' + changes.join('; '));
  return apiBgvRules();
}

/* ---------------------------------------------------------------- monitoring (phase 2) ---------------------- */

const BGV_DISCREPANT_ = ['Minor discrepancy', 'Major discrepancy', 'Unable to verify'];
/** A reported discrepancy (or an unverified result) that the Head of HR has not decided yet. */
function bgvNeedsDecision_(c) {
  return ['Report received', 'Under review'].indexOf(String(c.Status)) >= 0 && BGV_DISCREPANT_.indexOf(String(c.Outcome)) >= 0 && !c.Decision;
}
function bgvSheet_() { return !!ss_().getSheetByName(BGV_CASES_.name); }

/** Counts for the Overview: decisions waiting for the Head of HR, and cases past a limit (the user's own, or all for leads). */
function bgvSummary_(u) {
  const out = { decide: 0, late: 0 };
  if (!bgvSheet_()) return out;
  const cfg = bgvRules_().cfg, today = ymd_(new Date()), lead = isLead_(u);
  readTable_(BGV_CASES_.name).rows.forEach(function (c) {
    if (['Closed', 'Cancelled'].indexOf(String(c.Status)) >= 0) return;
    if (can_(u, 'bgv_decide') && bgvNeedsDecision_(c)) out.decide++;
    if ((lead || bgvIsOwner_(u, c)) && bgvRag_(c, cfg, today).rag === 'Red') out.late++;
  });
  return out;
}

/** Cases that block a to-do's target: { 'LINE|Type': caseId } for open cases (so a task can open the case itself). */
function bgvOpenCaseMap_() {
  const m = {};
  if (!bgvSheet_()) return m;
  readTable_(BGV_CASES_.name).rows.forEach(function (c) { if (['Closed', 'Cancelled'].indexOf(String(c.Status)) < 0) m[c.Line_ID + '|' + c.Type] = String(c.Case_ID); });
  return m;
}

/** To-dos for the position's recruiter (called by the to-do engine): consent, chaser, report before joining, review. */
function bgvTasks_(add) {
  if (!bgvSheet_()) return;
  const cfg = bgvRules_().cfg, now = Date.now();
  const logs = {};
  readTable_(BGV_LOG_.name).rows.forEach(function (g) {
    const t = g.At instanceof Date ? g.At.getTime() : 0, id = String(g.Case_ID);
    if (String(g.By) !== 'system' && t > (logs[id] || 0)) logs[id] = t;
  });
  const lbl = function (c) { return [c.Candidate_Name || 'Candidate', c.Position, c.MRF_No].filter(Boolean).join(' · '); };
  readTable_(BGV_CASES_.name).rows.forEach(function (c) {
    const st = String(c.Status), id = String(c.Case_ID), base = { recruiter: String(c.Recruiter || ''), line: String(c.Line_ID), app: String(c.App_ID || ''), open: { type: 'bgv', id: id } };
    const mk = function (kind, extra) { return Object.assign({ key: kind + '|' + id }, base, extra); };
    const ms = function (v) { return v instanceof Date && !isNaN(v) ? v.getTime() : 0; };
    if (['Not started', 'Awaiting consent'].indexOf(st) >= 0 && !c.Consent_On && String(c.Legacy) !== 'Yes' && ms(c.Trigger_Date)) {
      add('bgv_consent', mk('bgv_consent', { title: 'Get the candidate’s consent for BGV (' + c.Type.toLowerCase() + ')', context: lbl(c) + ' · start by ' + ymd_(c.Due_Date), startMs: ms(c.Trigger_Date) }));
    }
    if (['Initiated', 'In progress', 'Insufficiency'].indexOf(st) >= 0 && ms(c.Initiated_On)) {
      const last = Math.max(ms(c.Initiated_On), logs[id] || 0), days = Math.floor((now - ms(c.Initiated_On)) / 86400000);
      add('bgv_chase', mk('bgv_chase', { title: (st === 'Insufficiency' ? 'Chase the candidate: BGV insufficiency' : 'Chase the vendor: BGV update') + ' (' + c.Type.toLowerCase() + ')',
        context: lbl(c) + ' · started ' + days + ' day' + (days === 1 ? '' : 's') + ' ago' + (c.Vendor_Ref ? ' · ref ' + c.Vendor_Ref : ''), startMs: last, forceCritical: days > cfg.vendorTatDays, critAt: ms(c.Initiated_On) + (cfg.vendorTatDays + 1) * 86400000 }));
    }
    if (c.Type === BGV_TYPES_[0] && c.Result_Due && ['Initiated', 'In progress', 'Insufficiency'].indexOf(st) >= 0) {
      add('bgv_result', mk('bgv_result', { title: 'Previous-employer BGV report is needed before joining', context: lbl(c) + ' · report needed by ' + ymd_(c.Result_Due), startMs: ms(c.Result_Due) - 86400000 }));
    }
    if (['Report received', 'Under review'].indexOf(st) >= 0 && !bgvNeedsDecision_(c) && ms(c.Report_On)) {
      add('bgv_review', mk('bgv_review', { title: 'Review the BGV report and close the case (' + c.Type.toLowerCase() + ')', context: lbl(c) + ' · report received ' + ymd_(c.Report_On), startMs: ms(c.Report_On) }));
    }
  });
}

/* ---- reports (TA Lead, Head of HR, Admin) ---- */

function bgvDay_(v) { return v instanceof Date && !isNaN(v) ? ymd_(v) : ''; }
function bgvAvg_(a) { return a.length ? Math.round(a.reduce(function (s, x) { return s + x; }, 0) / a.length * 10) / 10 : null; }
function bgvPct_(n, d) { return d ? Math.round(n / d * 1000) / 10 : null; }

/** The numbers for a group of cases: start on time, days to start, verification and review time, results, open and red. */
function bgvAgg_(list, cfg, today) {
  const o = { cases: list.length, onTime: 0, late: 0, overdue: 0, pending: 0, open: 0, red: 0, amber: 0, discrepancies: 0, decisionWaiting: 0, resultOk: 0, resultLate: 0 };
  const start = [], ver = [], rev = [], within = [];
  list.forEach(function (c) {
    const due = bgvDay_(c.Due_Date), init = bgvDay_(c.Initiated_On), rep = bgvDay_(c.Report_On), trig = bgvDay_(c.Trigger_Date), closed = bgvDay_(c.Closed_On), rd = bgvDay_(c.Result_Due);
    if (init) { if (due && init > due) o.late++; else o.onTime++; if (trig) start.push(daysBetween_(trig, init)); }
    else if (due && today > due) o.overdue++; else o.pending++;
    if (init && rep) { const d = daysBetween_(init, rep); ver.push(d); within.push(d <= cfg.vendorTatDays ? 1 : 0); }
    if (rep && closed) rev.push(daysBetween_(rep, closed));
    if (c.Type === BGV_TYPES_[0] && rd) { if (rep) { if (rep <= rd) o.resultOk++; else o.resultLate++; } else if (today > rd) o.resultLate++; }
    const st = String(c.Status);
    if (['Closed', 'Cancelled'].indexOf(st) < 0) { o.open++; const r = bgvRag_(c, cfg, today).rag; if (r === 'Red') o.red++; else if (r === 'Amber') o.amber++; }
    if (BGV_DISCREPANT_.indexOf(String(c.Outcome)) >= 0) o.discrepancies++;
    if (bgvNeedsDecision_(c)) o.decisionWaiting++;
  });
  o.pctOnTime = bgvPct_(o.onTime, o.onTime + o.late + o.overdue);
  o.avgStart = bgvAvg_(start); o.avgVerify = bgvAvg_(ver); o.avgReview = bgvAvg_(rev);
  o.pctWithinVendor = bgvPct_(within.reduce(function (s, x) { return s + x; }, 0), within.length);
  o.pctResultOk = bgvPct_(o.resultOk, o.resultOk + o.resultLate);
  return o;
}
function bgvGroup_(list, keyFn, cfg, today) {
  const g = {};
  list.forEach(function (c) { const k = keyFn(c); (g[k] = g[k] || []).push(c); });
  return Object.keys(g).sort().map(function (k) { return Object.assign({ key: k }, bgvAgg_(g[k], cfg, today)); });
}

/**
 * BGV reports for leads: a scorecard by recruiter, by month and by type; vendor scorecard; open cases by department;
 * discrepancies with their checks. f = { from, to } on the date the case opened (default: the last 180 days).
 */
function apiBgvReports(f) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see the BGV reports.');
  f = f || {};
  const cfg = bgvRules_().cfg, today = ymd_(new Date()), to = ymd_(f.to) || today, from = ymd_(f.from) || addDays_(today, -180);
  if (from > to) throw new Error('The start of the period is after its end.');
  const all = readTable_(BGV_CASES_.name).rows;
  const list = all.filter(function (c) { const t = bgvDay_(c.Trigger_Date); return String(c.Status) !== 'Cancelled' && t >= from && t <= to; });
  const vendors = {}; bgvVendorsOut_().forEach(function (v) { vendors[v.id] = v.name; });
  const checks = {}; readTable_(BGV_CHECKS_.name).rows.forEach(function (k) { (checks[k.Case_ID] = checks[k.Case_ID] || []).push(k); });
  const disc = list.filter(function (c) { return BGV_DISCREPANT_.indexOf(String(c.Outcome)) >= 0; }).map(function (c) {
    return { id: String(c.Case_ID), type: String(c.Type), candidate: String(c.Candidate_Name || ''), position: String(c.Position || ''), recruiter: String(c.Recruiter || ''), outcome: String(c.Outcome),
      decision: String(c.Decision || ''), decisionBy: String(c.Decision_By || ''), status: String(c.Status),
      checks: (checks[c.Case_ID] || []).filter(function (k) { return ['Discrepancy', 'Unable to verify'].indexOf(String(k.Status)) >= 0; }).map(function (k) { return { type: String(k.Check_Type), subject: String(k.Subject || ''), status: String(k.Status), finding: String(k.Finding || '') }; }) };
  });
  const dept = bgvGroup_(list.filter(function (c) { return ['Closed', 'Cancelled'].indexOf(String(c.Status)) < 0; }), function (c) { return String(c.Dept || '(none)'); }, cfg, today)
    .map(function (x) { return { dept: x.key, open: x.open, red: x.red, amber: x.amber }; });
  return { from: from, to: to, cfg: cfg, total: bgvAgg_(list, cfg, today),
    byRecruiter: bgvGroup_(list, function (c) { return String(c.Recruiter || 'Unassigned'); }, cfg, today),
    byType: bgvGroup_(list, function (c) { return String(c.Type); }, cfg, today),
    byMonth: bgvGroup_(list, function (c) { return bgvDay_(c.Trigger_Date).slice(0, 7); }, cfg, today),
    byVendor: bgvGroup_(list, function (c) { const v = String(c.Vendor_ID || ''); return v === 'DIRECT' ? 'Direct (no vendor)' : v ? (vendors[v] || v) : 'No vendor yet'; }, cfg, today),
    byDept: dept, discrepancies: disc };
}

/** One paragraph block for the weekly email (open, past a limit, awaiting a decision, worst recruiters). */
function bgvWeekly_() {
  if (!bgvSheet_()) return null;
  const cfg = bgvRules_().cfg, today = ymd_(new Date());
  const open = readTable_(BGV_CASES_.name).rows.filter(function (c) { return ['Closed', 'Cancelled'].indexOf(String(c.Status)) < 0; });
  const red = open.filter(function (c) { return bgvRag_(c, cfg, today).rag === 'Red'; });
  const by = {}; red.forEach(function (c) { by[c.Recruiter] = (by[c.Recruiter] || 0) + 1; });
  return { open: open.length, red: red.length, decide: open.filter(bgvNeedsDecision_).length,
    byRecruiter: Object.keys(by).map(function (k) { return { recruiter: k, red: by[k] }; }).sort(function (a, b) { return b.red - a.red; }).slice(0, 8) };
}

/** Cases past their start-by date and not started, for Admin > Data checks (opens the position). */
function bgvLateCases_() {
  if (!bgvSheet_()) return [];
  const cfg = bgvRules_().cfg, today = ymd_(new Date());
  return readTable_(BGV_CASES_.name).rows.filter(function (c) { return ['Not started', 'Awaiting consent'].indexOf(String(c.Status)) >= 0 && bgvRag_(c, cfg, today).rag === 'Red'; })
    .map(function (c) { return { id: String(c.Line_ID), label: String(c.MRF_No || '') + ' · ' + String(c.Position || '') + ' (' + String(c.Recruiter || '') + ')', detail: c.Type + ': ' + bgvRag_(c, cfg, today).why + ' [' + c.Case_ID + ']' }; });
}
