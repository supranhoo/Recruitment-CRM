/**
 * Switch-over check (Phase 3). Before the switch-over date, open and offered positions whose typed
 * offer / joining / backout details disagree with the candidate pipeline are listed here with the
 * actions that fix them, so that from the switch-over every figure can come from candidate moves.
 */

function reconcileSchema_() {
  addColumns_(T.MRF.name, ['Reconciled_On', 'Reconciled_By', 'Reconcile_Note']);
}

function stageIdx_(s) { return STAGES.indexOf(String(s)); }
function sameName_(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }

/** Positions (open or offered) whose typed details disagree with the pipeline. recruiter '' = everyone. */
function reconcileScan_(recruiter, includeReviewed) {
  const cands = {}; readTable_(T.CAND.name).rows.forEach(function (c) { cands[c.Candidate_ID] = c; });
  const appsBy = {}; readTable_(T.APP.name).rows.forEach(function (a) { (appsBy[a.Line_ID] = appsBy[a.Line_ID] || []).push(a); });
  const out = [];
  readTable_(T.MRF.name).rows.forEach(function (l) {
    if (recruiter && !sameName_(l.Recruiter, recruiter)) return;
    const st = positionStatus_(l);
    if (st === 'Removed') return;
    if (st !== 'Open' && st !== 'Offered') return;
    if (l.Reconciled_On && !includeReviewed) return;
    const apps = appsBy[l.Line_ID] || [];
    const live = apps.filter(function (a) { return ['Active', 'On hold'].indexOf(String(a.Status)) >= 0; });
    const holders = live.filter(function (a) { return String(a.Status) === 'Active' && cands[a.Candidate_ID] && stageIdx_(a.Stage) >= stageIdx_('Offer'); });
    const offer = ymd_(l.Offer_Date), bo = ymd_(l.Backout_Date);
    const issues = [];
    live.filter(function (a) { return !cands[a.Candidate_ID]; }).forEach(function (a) {
      issues.push({ code: 'orphan', app: a.App_ID, text: 'Pipeline card ' + a.App_ID + ' (' + (STAGE_NAMES[a.Stage] || a.Stage) + ') has no candidate record \u2014 the candidate was deleted.' });
    });
    if (st === 'Offered' && !holders.length) {
      issues.push({ code: 'offer_unlinked', text: 'Offer recorded on the position' + (offer ? ' (offer dated ' + offer + ')' : '') + ', but no candidate holds it in the pipeline.'
        + (bo && (!offer || bo <= offer) ? ' A backout on ' + bo + ' is also recorded, so another candidate probably backed out before this offer.' : '') });
    }
    if (st === 'Open' && bo) {
      issues.push({ code: 'legacy_backout', text: 'A backout on ' + bo + ' was recorded by reopening the position. Under policy 9.5 a backout now raises a replacement MRF.' });
    }
    live.filter(function (a) { return String(a.Status) === 'Active' && cands[a.Candidate_ID] && stageIdx_(a.Stage) >= stageIdx_('Joined'); }).forEach(function (a) {
      if (!l.Actual_DOJ) issues.push({ code: 'joined_open', app: a.App_ID, text: cands[a.Candidate_ID].Name + ' is at ' + STAGE_NAMES[a.Stage] + ' in the pipeline, but the position has no joining date.' });
    });
    if (CLOSED_HINT_RE_.test(String(l.Remarks || ''))) {
      issues.push({ code: 'maybe_closed', text: 'The remarks suggest this position was closed or put on hold by the department, but its status is still ' + st + '. If so, use \u201cClose without hiring\u201d.' });
    }
    if (!issues.length) return;
    const c = cands[l.Candidate_ID];
    out.push({
      line: { Line_ID: l.Line_ID, MRF_No: String(l.MRF_No || ''), Position: String(l.Position || ''), Dept: String(l.Dept || ''), Grade: String(l.Grade || ''),
        Recruiter: String(l.Recruiter || ''), status: st, Offer_Sent: String(l.Offer_Sent || ''), Offer_Date: offer, EDOJ: ymd_(l.EDOJ), Backout_Date: bo,
        Candidate_ID: String(l.Candidate_ID || ''), candName: c ? String(c.Name) : '', Remarks: String(l.Remarks || '').slice(0, 300),
        reviewed: ymd_(l.Reconciled_On), note: String(l.Reconcile_Note || '') },
      issues: issues,
      apps: live.map(function (a) { const cc = cands[a.Candidate_ID]; return { App_ID: a.App_ID, Candidate_ID: a.Candidate_ID, name: cc ? String(cc.Name) : '', stage: String(a.Stage), status: String(a.Status) }; })
    });
  });
  return out.sort(function (a, b) { return a.line.Recruiter.localeCompare(b.line.Recruiter) || a.line.MRF_No.localeCompare(b.line.MRF_No); });
}

function apiReconcileList() {
  const u = currentUser_(); ensureSchema_();
  return { cutover: cutover_(), lead: isLead_(u), items: reconcileScan_(isLead_(u) ? '' : u.recruiter, false) };
}

/** Finds a candidate by id, or adds a minimal record (name, optional mobile) for someone never entered in the app. */
function reconcileCandidate_(spec, line, u) {
  spec = spec || {};
  if (spec.candidateId) {
    ensureActiveCandidate_(spec.candidateId, u);
    const c = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === spec.candidateId; })[0];
    if (!c) throw new Error('Candidate ' + spec.candidateId + ' was not found.');
    return c;
  }
  const name = clean_(String(spec.name || '')).trim();
  const mobile = String(spec.mobile || '').replace(/\D/g, '');
  if (!name) throw new Error('Pick the candidate or type their name.');
  if (mobile && mobile.length !== 10) throw new Error('Mobile should be 10 digits.');
  if (mobile) {
    const dup = readTable_(T.CAND.name).rows.filter(function (x) { return String(x.Mobile || '').replace(/\D/g, '') === mobile; })[0];
    if (dup) return dup;
  }
  return insert_(T.CAND, { Name: name, Mobile: mobile, Line_ID: line.Line_ID, Position: line.Position, Dept: line.Dept, Sourced_By: line.Recruiter,
    Notes: 'Added at the pipeline switch-over check' }, u);
}
function reconcileApp_(cand, line, u) {
  const a = readTable_(T.APP.name, true).rows.filter(function (x) { return x.Candidate_ID === cand.Candidate_ID && x.Line_ID === line.Line_ID; })[0];
  if (a) return a;
  const app = insert_(T.APP, { Candidate_ID: cand.Candidate_ID, Line_ID: line.Line_ID, MRF_No: line.MRF_No, Recruiter: line.Recruiter,
    Stage: 'Sourced', Status: 'Active', Stage_Since: new Date(), Risk: '' }, u);
  appendHistory_(app, '', 'Sourced', '', 'Added at the pipeline switch-over check', u);
  return app;
}
function reconcileDate_(v, label, required) {
  if (!v) { if (required) throw new Error('Add the ' + label + '.'); return null; }
  const d = parseYmd_(v);
  if (!d || isNaN(d)) throw new Error('Check the ' + label + '.');
  if (ymd_(d) > ymd_(new Date()) && label !== 'expected joining date') throw new Error('The ' + label + ' cannot be in the future.');
  return d;
}
function markReconciled_(lineId, note, u) {
  update_(T.MRF, lineId, { Reconciled_On: new Date(), Reconciled_By: u.email, Reconcile_Note: clean_(String(note || '')).slice(0, 300) }, u);
}

/**
 * Records who holds the offer on a position. d = { holder: {appId | candidateId | name, mobile}, stage: 'Offer'|'Prejoin',
 * offerDate, edoj, acceptedOn, backout: null | { candidateId | name, mobile, date, reason, offerDate } }.
 * With backout, the earlier candidate's backout is recorded under policy 9.5 first: the position is replaced and
 * the offer holder is recorded on the replacement MRF.
 */
function apiReconcileOffer(lineId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  let line = requireLineEdit_(u, lineId);
  requireNotReplaced_(line);
  if (['Open', 'Offered'].indexOf(positionStatus_(line)) < 0) throw new Error('Only open or offered positions can be checked here.');
  const stage = d.stage === 'Prejoin' ? 'Prejoin' : 'Offer';
  const offerDate = reconcileDate_(d.offerDate, 'offer date', true);
  const edoj = reconcileDate_(d.edoj, 'expected joining date', false);
  const accepted = stage === 'Prejoin' ? reconcileDate_(d.acceptedOn || d.offerDate, 'offer acceptance date', true) : null;
  if (accepted && ymd_(accepted) < ymd_(offerDate)) throw new Error('The acceptance date cannot be before the offer date.');
  const holderApp0 = d.holder && d.holder.appId ? readTable_(T.APP.name).rows.filter(function (a) { return a.App_ID === d.holder.appId && a.Line_ID === lineId; })[0] : null;
  const holderCand = holderApp0 ? reconcileCandidate_({ candidateId: holderApp0.Candidate_ID }, line, u) : reconcileCandidate_(d.holder, line, u);
  const origId = line.Line_ID;
  if (d.backout) {
    const bdate = reconcileDate_(d.backout.date, 'backout date', true);
    if (ymd_(bdate) > ymd_(offerDate)) throw new Error('The earlier backout must be on or before this offer date (' + ymd_(offerDate) + ').');
    const aOffer = reconcileDate_(d.backout.offerDate, 'earlier offer date', false);
    const aCand = reconcileCandidate_(d.backout, line, u);
    if (aCand.Candidate_ID === holderCand.Candidate_ID) throw new Error('The candidate who backed out and the one holding the offer must be different people.');
    const appA = reconcileApp_(aCand, line, u);
    const reason = clean_(String(d.backout.reason || 'Backed out')).slice(0, 200);
    update_(T.APP, appA.App_ID, { Stage: 'Offer', Status: 'Withdrawn', Status_Reason: reason, Backout_Date: bdate, Backout_Reason: reason, Offer_Date: aOffer || '', Stage_Since: bdate }, u);
    appendHistory_(appA, String(appA.Stage), 'Offer', 'Reconciled', 'Offer recorded at the switch-over check' + (aOffer ? ' (offer dated ' + ymd_(aOffer) + ')' : ''), u);
    appendHistory_(appA, 'Offer', 'Offer', 'Backout', reason, u);
    const repl = createReplacement_(line, appA, bdate, reason, u);
    update_(T.MRF, origId, { Offer_Sent: 'Yes', Offer_Date: aOffer || '', EDOJ: '' }, u);
    markReconciled_(origId, 'Earlier backout recorded under policy 9.5', u);
    line = lineOf_(repl.Line_ID);
  }
  const live = liveOfferHolder_(line.Line_ID, '');
  const appB = reconcileApp_(holderCand, line, u);
  if (live && live !== String(holderCand.Name)) throw new Error(live + ' already holds the offer on ' + (line.MRF_No || line.Line_ID) + '.');
  const patch = { Stage: stage, Status: 'Active', Status_Reason: '', Stage_Since: accepted || offerDate, Offer_Date: offerDate, EDOJ: edoj || '' };
  if (accepted) { patch.Offer_Accepted_On = accepted; patch.Risk = 'Green'; }
  update_(T.APP, appB.App_ID, patch, u);
  appendHistory_(appB, String(appB.Stage), stage, 'Reconciled', 'Offer dated ' + ymd_(offerDate) + ' recorded at the switch-over check', u);
  update_(T.MRF, line.Line_ID, { Offer_Sent: 'Yes', Offer_Date: offerDate, EDOJ: edoj || line.EDOJ || '', Candidate_ID: holderCand.Candidate_ID }, u);
  if (!holderCand.Line_ID) update_(T.CAND, holderCand.Candidate_ID, { Line_ID: line.Line_ID }, u);
  markReconciled_(line.Line_ID, 'Offer holder recorded', u);
  return apiReconcileList();
}

/** Converts a backout recorded the old way (position reopened) into a policy 9.5 backout with a replacement MRF. */
function apiReconcileBackout(lineId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const line = requireLineEdit_(u, lineId);
  requireNotReplaced_(line);
  if (positionStatus_(line) !== 'Open') throw new Error('Only reopened (open) positions can be converted.');
  const bdate = reconcileDate_(d.date || ymd_(line.Backout_Date), 'backout date', true);
  const reason = clean_(String(d.reason || 'Backed out')).slice(0, 200);
  const aCand = reconcileCandidate_(d.candidateId || d.name ? d : { name: 'Candidate who backed out (name not recorded)' }, line, u);
  const appA = reconcileApp_(aCand, line, u);
  update_(T.APP, appA.App_ID, { Stage: 'Offer', Status: 'Withdrawn', Status_Reason: reason, Backout_Date: bdate, Backout_Reason: reason, Stage_Since: bdate }, u);
  appendHistory_(appA, String(appA.Stage), 'Offer', 'Reconciled', 'Earlier offer recorded at the switch-over check', u);
  appendHistory_(appA, 'Offer', 'Offer', 'Backout', reason, u);
  const repl = createReplacement_(line, appA, bdate, reason, u);
  markReconciled_(line.Line_ID, 'Earlier backout recorded under policy 9.5', u);
  markReconciled_(repl.Line_ID, 'Raised at the switch-over check', u);
  return apiReconcileList();
}

/** The pipeline shows the candidate joined but the position has no joining date: record it (closes the position). */
function apiReconcileJoined(appId, doj) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId);
  const line = requireLineEdit_(u, app.Line_ID);
  requireNotReplaced_(line);
  const d = reconcileDate_(doj, 'joining date', true);
  update_(T.APP, appId, { Actual_DOJ: d }, u);
  update_(T.CAND, app.Candidate_ID, { DOJ: d }, u);
  update_(T.MRF, line.Line_ID, { Offer_Sent: 'Yes', Actual_DOJ: d, Candidate_ID: app.Candidate_ID, Offer_Date: line.Offer_Date || app.Offer_Date || d }, u);
  appendHistory_(app, app.Stage, app.Stage, 'Reconciled', 'Joining date ' + ymd_(d) + ' recorded at the switch-over check', u);
  markReconciled_(line.Line_ID, 'Joining recorded', u);
  return apiReconcileList();
}

/** Removes a pipeline card that should not be there (deleted candidate, test record). History is kept. */
function apiReconcileRemove(appId, reason) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId);
  requireLineEdit_(u, app.Line_ID);
  const why = clean_(String(reason || '')).trim() || 'Removed at the switch-over check';
  update_(T.APP, appId, { Status: 'Removed', Status_Reason: why.slice(0, 200), Risk: '' }, u);
  appendHistory_(app, app.Stage, app.Stage, 'Removed', why, u);
  return apiReconcileList();
}

/** Keeps the position as it is (for example an old backout that is best left as history). */
function apiReconcileReviewed(lineId, note) {
  const u = currentUser_(); ensureSchema_();
  requireLineEdit_(u, lineId);
  if (!String(note || '').trim()) throw new Error('Add a short note on why this position is fine as it is.');
  markReconciled_(lineId, note, u);
  return apiReconcileList();
}

/**
 * Head / admin correction: a candidate was linked to a position by mistake. The card is removed (history kept)
 * without recording a backout, and the position goes back to the switch-over check so the right person can be linked.
 */
function apiUnlinkApp(appId, reason) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can correct a wrong link.');
  const why = clean_(String(reason || '')).trim();
  if (!why) throw new Error('Add the reason for the correction.');
  const app = appOf_(appId);
  const line = lineOf_(app.Line_ID);
  if (!line) throw new Error('Position not found.');
  update_(T.APP, appId, { Status: 'Removed', Status_Reason: ('Linked in error: ' + why).slice(0, 200), Risk: '' }, u);
  appendHistory_(app, app.Stage, app.Stage, 'Unlinked', 'Linked in error: ' + why, u);
  const patch = { Reconciled_On: '', Reconciled_By: '', Reconcile_Note: '' };
  if (String(line.Candidate_ID) === String(app.Candidate_ID)) patch.Candidate_ID = '';
  if (line.Actual_DOJ && app.Actual_DOJ && ymd_(line.Actual_DOJ) === ymd_(app.Actual_DOJ)) patch.Actual_DOJ = '';
  update_(T.MRF, line.Line_ID, patch, u);
  daySnapDropAll_();
  return apiPipeline(line.Line_ID);
}
