/**
 * Closing a position without a hire (cancelled by the department, headcount withdrawn, or put on hold),
 * and resuming a held position. On hold pauses TAT: the days on hold are excluded when the position resumes.
 */
const CLOSED_OUTCOMES_ = ['Not Needed', 'No Vacancy', 'On Hold'];
const OUTCOME_TEXT_ = { 'Not Needed': 'cancelled by the department', 'No Vacancy': 'headcount withdrawn (no vacancy)', 'On Hold': 'put on hold', 'Filled Internally': 'filled internally (transfer / IJP)', 'Created in Error': 'removed (created in error)' };
const INTERNAL_FILL_ = 'Filled Internally', REMOVE_ = 'Created in Error';

function closureSchema_() {
  addColumns_(T.MRF.name, ['Closure_Reason', 'Closure_Requested_By', 'Hold_Days', 'Hold_Log']);
}

/** Positions that are closed without a hire or on hold take no pipeline changes. */
function requireActiveLine_(line) {
  requireNotReplaced_(line);
  const st = positionStatus_(line);
  if (CLOSED_OUTCOMES_.indexOf(st) >= 0) throw new Error('This position is ' + (st === 'On Hold' ? 'on hold. Resume it first.' : 'closed without a hire (' + st + ').'));
}

/**
 * d = { outcome, date, reason, requestedBy, candidates: { appId: 'reject' | 'hold' | 'move:<Line_ID>' } }
 * Candidates not listed are rejected (or kept on hold when the outcome is On Hold).
 */
function apiClosePosition(lineId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const line = requireLineEdit_(u, lineId);
  requireNotReplaced_(line);
  const st = positionStatus_(line);
  if (st !== 'Open' && st !== 'Offered') throw new Error('Only open or offered positions can be closed without a hire.');
  if (String(line.Fill_Type || '') === 'Internal') throw new Error('This position is filled internally (' + String(line.Internal_Employee || '') + '). A lead can undo that first if needed.');
  const outcome = String(d.outcome || '');
  if (CLOSED_OUTCOMES_.indexOf(outcome) < 0 && outcome !== INTERNAL_FILL_ && outcome !== REMOVE_) throw new Error('Pick the outcome.');
  if (outcome === REMOVE_ && !isLead_(u) && readTable_(T.APP.name).rows.some(function (a) { return String(a.Line_ID) === String(lineId); }))
    throw new Error('Candidates were added to this position, so it may not have been created in error. Ask a TA Lead or the Head of HR to remove it, or pick another outcome.');
  const date = parseYmd_(d.date);
  if (!date || isNaN(date)) throw new Error('Add the date.');
  if (ymd_(date) > ymd_(new Date())) throw new Error('The date cannot be in the future.');
  if (line.Receipt_Date && ymd_(date) < ymd_(line.Receipt_Date)) throw new Error('The date cannot be before the MRF was received (' + ymd_(line.Receipt_Date) + ').');
  const reason = clean_(String(d.reason || '')).trim();
  if (!reason) throw new Error('Add the reason.');
  const by = clean_(String(d.requestedBy || '')).trim();
  let eff = null;
  if (outcome === INTERNAL_FILL_) {
    if (!String(d.employee || '').trim()) throw new Error('Enter the employee who fills the position.');
    eff = parseYmd_(d.effectiveOn);
    if (!eff || isNaN(eff)) throw new Error('Add the effective date of the transfer.');
    if (ymd_(eff) < ymd_(date)) throw new Error('The effective date cannot be before the decision date.');
    if (ymd_(eff) > addDays_(ymd_(new Date()), 60)) throw new Error('The effective date can be at most 60 days ahead.');
  }
  const choices = d.candidates || {};
  const apps = readTable_(T.APP.name, true).rows.filter(function (a) { return a.Line_ID === lineId && ['Active', 'On hold'].indexOf(String(a.Status)) >= 0; });
  apps.forEach(function (a) {
    if (String(a.Status) === 'Active' && STAGES.indexOf(String(a.Stage)) >= STAGES.indexOf('Joined')) throw new Error('A candidate has already joined on this position, so it cannot be closed without a hire.');
    if (String(a.Status) === 'Active' && STAGES.indexOf(String(a.Stage)) >= STAGES.indexOf('Offer') && !can_(u, 'withdraw_offer')) throw new Error('A candidate holds an offer on this position. Only the Head of HR or the admin can close it (the offer is then withdrawn by the company).');
  });
  const moveTargets = {};
  Object.keys(choices).forEach(function (k) {
    const c = String(choices[k] || '');
    if (c.indexOf('move:') === 0) {
      const to = lineOf_(c.slice(5));
      if (!to || to.Line_ID === lineId) throw new Error('Pick a different position to move the candidate to.');
      if (!canEditLine_(u, to)) throw new Error('You cannot add candidates to ' + (to.MRF_No || to.Line_ID) + '.');
      if (['Open', 'Offered'].indexOf(positionStatus_(to)) < 0) throw new Error((to.MRF_No || to.Line_ID) + ' is not open.');
      moveTargets[c.slice(5)] = to;
    }
  });
  const note = 'Position ' + OUTCOME_TEXT_[outcome] + ': ' + reason;
  let rejected = 0, held = 0, moved = 0, withdrawn = 0;
  apps.forEach(function (a) {
    const isOffer = String(a.Status) === 'Active' && STAGES.indexOf(String(a.Stage)) >= STAGES.indexOf('Offer');
    let c = String(choices[a.App_ID] || (outcome === 'On Hold' ? 'hold' : 'reject'));
    if (isOffer) c = 'withdraw';
    if (c.indexOf('move:') === 0) {
      const to = moveTargets[c.slice(5)];
      if (readTable_(T.APP.name).rows.some(function (x) { return x.Line_ID === to.Line_ID && x.Candidate_ID === a.Candidate_ID; })) { c = 'reject'; }
      else {
        update_(T.APP, a.App_ID, { Line_ID: to.Line_ID, MRF_No: to.MRF_No, Recruiter: to.Recruiter }, u);
        appendHistory_(Object.assign({}, a, { Line_ID: to.Line_ID }), a.Stage, a.Stage, 'Moved', 'Moved to ' + (to.MRF_No || to.Line_ID) + ' because ' + (line.MRF_No || line.Line_ID) + ' was ' + OUTCOME_TEXT_[outcome], u);
        moved++;
        return;
      }
    }
    if (c === 'withdraw') {
      update_(T.APP, a.App_ID, { Status: 'Withdrawn', Status_Reason: ('Offer withdrawn by the company: ' + note).slice(0, 200), Risk: '' }, u);
      appendHistory_(a, a.Stage, a.Stage, 'Offer withdrawn by company', note, u);
      withdrawn++;
    } else if (c === 'hold') {
      if (String(a.Status) !== 'On hold') update_(T.APP, a.App_ID, { Status: 'On hold', Status_Reason: note.slice(0, 200) }, u);
      appendHistory_(a, a.Stage, a.Stage, 'On hold', note, u);
      held++;
    } else {
      update_(T.APP, a.App_ID, { Status: 'Rejected', Status_Reason: note.slice(0, 200), Risk: '' }, u);
      appendHistory_(a, a.Stage, a.Stage, 'Position closed', note, u);
      rejected++;
    }
  });
  let cancelled = 0;
  readTable_(T.INT.name, true).rows.forEach(function (i) {
    if (i.Line_ID === lineId && i.Status === 'Scheduled') { update_(T.INT, i.Interview_ID, { Status: 'Cancelled', Notes: note.slice(0, 500) }, u); cancelled++; }
  });
  const patch = outcome === INTERNAL_FILL_
    ? { Fill_Type: 'Internal', Internal_Employee: clean_(String(d.employee)).trim().slice(0, 120), Internal_Emp_Code: clean_(String(d.empCode || '')).trim().slice(0, 40),
        Internal_From_Dept: clean_(String(d.fromDept || '')).trim().slice(0, 120), Internal_Decided_On: date, Internal_Effective_Date: eff, Closure_Reason: reason.slice(0, 300), Closure_Requested_By: by.slice(0, 120) }
    : { Approval_Status: outcome, Closure_Reason: reason.slice(0, 300), Closure_Requested_By: by.slice(0, 120) };
  if (outcome === 'No Vacancy') patch.No_Vacancy_Date = date; else if (outcome !== INTERNAL_FILL_) patch.Not_Needed_Date = date;
  if (withdrawn) { patch.Offer_Sent = 'No'; patch.Candidate_ID = ''; patch.EDOJ = ''; }
  const calc = storedTat_(computeTat_(Object.assign({}, line, patch), tatContext_()));
  update_(T.MRF, lineId, Object.assign(patch, calc), u);
  return { line: lineId, outcome: outcome, rejected: rejected, held: held, moved: moved, withdrawn: withdrawn, cancelled: cancelled };
}

/** Resumes a position that was on hold. The hold days are added to Hold_Days and excluded from TAT. */
function apiResumePosition(lineId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const line = requireLineEdit_(u, lineId);
  if (positionStatus_(line) !== 'On Hold') throw new Error('Only positions on hold can be resumed.');
  const date = d.date ? parseYmd_(d.date) : parseYmd_(ymd_(new Date()));
  if (!date || isNaN(date)) throw new Error('Check the resume date.');
  if (ymd_(date) > ymd_(new Date())) throw new Error('The resume date cannot be in the future.');
  const from = ymd_(line.Not_Needed_Date);
  if (from && ymd_(date) < from) throw new Error('The resume date cannot be before the hold started (' + from + ').');
  const days = from ? daysBetween_(from, ymd_(date)) : 0;
  const log = String(line.Hold_Log || '') + (line.Hold_Log ? '\n' : '') + (from || '?') + ' to ' + ymd_(date) + ' (' + days + ' days): ' + String(line.Closure_Reason || '');
  const patch = { Approval_Status: 'Approved', Not_Needed_Date: '', Hold_Days: (Number(line.Hold_Days) || 0) + days, Hold_Log: log.slice(-1500), Closure_Reason: '', Closure_Requested_By: '' };
  const calc = storedTat_(computeTat_(Object.assign({}, line, patch), tatContext_()));
  update_(T.MRF, lineId, Object.assign(patch, calc), u);
  let reactivated = 0;
  if (d.reactivate !== false) {
    readTable_(T.APP.name, true).rows.forEach(function (a) {
      if (a.Line_ID === lineId && String(a.Status) === 'On hold' && /^Position put on hold/.test(String(a.Status_Reason || ''))) {
        update_(T.APP, a.App_ID, { Status: 'Active', Status_Reason: '' }, u);
        appendHistory_(a, a.Stage, a.Stage, 'Active', 'Position resumed on ' + ymd_(date), u);
        reactivated++;
      }
    });
  }
  return { line: lineId, holdDays: days, totalHoldDays: patch.Hold_Days, reactivated: reactivated };
}

/** Open or offered positions whose remarks suggest they were closed or put on hold without the status changing. */
const CLOSED_HINT_RE_ = /\b(cancel+ed|cancel|not required|not needed|no longer required|closed by|position closed|on hold|put on hold|withdrawn|dropped|no vacancy)\b/i;

/** Undo an internal fill recorded by mistake (leads only); the position is open again. */
function apiUndoInternalFill(lineId, reason) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can undo an internal fill.');
  const line = lineOf_(lineId);
  if (!line || String(line.Fill_Type || '') !== 'Internal') throw new Error('This position was not filled internally.');
  reason = clean_(String(reason || '')).trim();
  if (!reason) throw new Error('Add the reason for undoing the internal fill.');
  const patch = { Fill_Type: '', Internal_Employee: '', Internal_Emp_Code: '', Internal_From_Dept: '', Internal_Decided_On: '', Internal_Effective_Date: '', Closure_Reason: '', Closure_Requested_By: '' };
  const calc = storedTat_(computeTat_(Object.assign({}, line, patch), tatContext_()));
  update_(T.MRF, lineId, Object.assign(patch, calc), u);
  audit_(u, T.MRF.name, lineId, 'Update', 'Internal fill undone', String(line.Internal_Employee || ''), reason);
  return { line: lineId, status: calc.Position_Status };
}

/** Restore a position that was removed as created in error (leads only). */
function apiRestorePosition(lineId, reason) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can restore a removed position.');
  const line = lineOf_(lineId);
  if (!line || positionStatus_(line) !== 'Removed') throw new Error('This position is not removed.');
  reason = clean_(String(reason || '')).trim();
  if (!reason) throw new Error('Add the reason for restoring the position.');
  const patch = { Approval_Status: 'Approved', Not_Needed_Date: '', Closure_Reason: '', Closure_Requested_By: '' };
  const calc = storedTat_(computeTat_(Object.assign({}, line, patch), tatContext_()));
  update_(T.MRF, lineId, Object.assign(patch, calc), u);
  audit_(u, T.MRF.name, lineId, 'Update', 'Position restored', String(line.Closure_Reason || ''), reason);
  return { line: lineId, status: calc.Position_Status };
}
