/**
 * Fast-track hiring route (ADR-046) for W and T levels: a helper or an ITI trainee is called, sent to the department, the
 * department confirms in writing, the onboarding team confirms the hiring, and the person joins and is onboarded.
 *
 *   CV received -> Sent to department -> Department confirmed (written) -> Hiring confirmed -> Joined -> Onboarded
 *
 * The other stages (Screened, Technical, HR, Documents, Pre-joining) are skipped, not removed: the stage list, the history
 * and the reports are the same as for the standard route, so nothing else has to change. Which levels are fast-track is a
 * setting (Admin > Hiring routes); the Head of HR or Admin can set a position's route by hand. The route decides:
 *   - which stages a card offers next and what each asks for;
 *   - that the department's written confirmation (a file) must be attached before the hiring is confirmed;
 *   - that the joining documents are the short W-level list, checked when the person is onboarded;
 *   - that the position does not wait for a final JD or screening questions, and the to-dos that exist only for them stay off;
 *   - that the Onboarding team (new role) can confirm the hiring, record the joining and complete the onboarding of any
 *     fast-track position, whoever its recruiter is.
 */
const FAST_STAGES_ = ['Sourced', 'Shared', 'Confirmed', 'Offer', 'Joined', 'Onboarded'];
const FAST_DEFAULT_LEVELS_ = ['W1', 'W2', 'W3', 'W4', 'W5', 'T', 'T1', 'T2', 'T3', 'T4'];
const FAST_ROUTES_ = ['Fast-track', 'Standard'];
const FAST_CONFIRM_RESULTS_ = ['Suitable', 'Not suitable', 'Hold'];
/** The joining documents for a fast-track hire (keys are kept apart from the standard A-H sections). */
const FAST_DOC_SECTIONS_ = [['W1', 'Aadhaar card'], ['W2', 'PAN card'], ['W3', 'Family details'], ['W4', 'Aadhaar of spouse and children (for ESIC)'],
  ['W5', 'Photographs'], ['W6', 'Basic education documents'], ['W7', 'Identity proof'], ['W8', 'Birth proof']];
/** To-dos that only make sense for the standard route (the JD and questions round trips, CV sharing, interview scheduling). */
const FAST_SKIP_TASKS_ = ['share_jd', 'dept_reply', 'revise_doc', 'share_questions', 'share_cvs', 'schedule_interview', 'confirm_attendance', 'reschedule', 'record_result', 'psychometric', 'offer_acceptance'];

function fastTrackSchema_() {
  addColumns_(T.MRF.name, ['Hiring_Route']);
  addColumns_(T.APP.name, ['Dept_Confirm_On', 'Dept_Confirm_By', 'Dept_Confirm_File', 'Appointment_Date', 'Appointment_Letter_File']);
}

function fastLevels_() {
  const raw = String(settings_().FASTTRACK_LEVELS == null ? '' : settings_().FASTTRACK_LEVELS).trim();
  if (!raw) return FAST_DEFAULT_LEVELS_.slice();
  return raw.split(/[,\s;]+/).map(function (x) { return x.toUpperCase(); }).filter(function (x) { return TAT_LEVELS_.indexOf(x) >= 0; });
}
/** 'Fast-track' or 'Standard': the position's own setting, else by its grade. */
function routeOf_(line) {
  const r = String((line && line.Hiring_Route) || '').trim();
  if (FAST_ROUTES_.indexOf(r) >= 0) return r;
  const g = String((line && line.Grade) || '').trim().toUpperCase();
  return g && fastLevels_().indexOf(g) >= 0 ? 'Fast-track' : 'Standard';
}
function isFast_(line) { return routeOf_(line) === 'Fast-track'; }
function fastDocSections_() { return FAST_DOC_SECTIONS_; }

/** The stage after `stage` on the fast-track route ('' at the end). A card that is on a skipped stage continues from the next fast stage. */
function fastNext_(stage) {
  const i = STAGES.indexOf(String(stage));
  for (let k = 0; k < FAST_STAGES_.length; k++) if (STAGES.indexOf(FAST_STAGES_[k]) > i) return FAST_STAGES_[k];
  return '';
}
/** The stages passed over when a card goes from one stage to another (for the history note). */
function fastSkipped_(from, to) {
  const a = STAGES.indexOf(String(from)), b = STAGES.indexOf(String(to));
  return STAGES.filter(function (s, i) { return i > a && i < b && FAST_STAGES_.indexOf(s) < 0; });
}

/** The Onboarding team may confirm the hiring, record the joining and complete the onboarding of fast-track positions. */
function canOnboardMove_(u, line, toStage) {
  return can_(u, 'onboard') && !!line && isFast_(line) && ['Offer', 'Joined', 'Onboarded'].indexOf(toStage) >= 0;
}

/**
 * The checks and the saved fields for a move on a fast-track position. Returns {patch, outcome, note}; throws when the
 * move is not allowed. The standard stages are checked by apiMoveStage as before.
 */
function fastMove_(u, app, line, toStage, data) {
  const out = { patch: {}, outcome: '', note: '' };
  const skipped = fastSkipped_(app.Stage, toStage);
  if (skipped.length) out.note = 'Fast-track: skipped ' + skipped.map(function (s) { return STAGE_NAMES[s]; }).join(', ') + '.';
  if (toStage === 'Shared') {
    out.patch.Dept_Confirm_On = '';
  }
  if (toStage === 'Confirmed') {
    const res = String(data.result || '');
    if (FAST_CONFIRM_RESULTS_.indexOf(res) < 0) throw new Error('Record the department’s decision: Suitable, Not suitable or Hold.');
    const by = clean_(String(data.by || '')).trim();
    if (!by) throw new Error('Add the name of the person in the department who confirmed.');
    if (!data.date) throw new Error('Add the date of the department’s confirmation.');
    if (ymd_(data.date) > ymd_(new Date())) throw new Error('The confirmation date cannot be in the future.');
    out.patch.Dept_Confirm_On = parseYmd_(data.date); out.patch.Dept_Confirm_By = by;
    out.outcome = res;
    if (res === 'Not suitable') { out.patch.Status = 'Rejected'; out.patch.Status_Reason = 'Not suitable for the department'; }
    if (res === 'Hold') { out.patch.Status = 'On hold'; out.patch.Status_Reason = 'Department put the candidate on hold'; }
  }
  if (toStage === 'Offer') {
    if (!String(app.Dept_Confirm_File || '').trim()) throw new Error('Attach the department’s written confirmation first (open the candidate, “Department confirmed” step). The hiring is confirmed only on that paper.');
    out.patch.Offer_CTC = clean_(String(data.ctc || ''));
    const on = data.offerDate || data.confirmedOn || ymd_(new Date());
    if (ymd_(on) > ymd_(new Date())) throw new Error('The date the hiring was confirmed cannot be in the future.');
    data.offerDate = on;
  }
  if (toStage === 'Joined') {
    if (data.appointmentDate) { if (ymd_(data.appointmentDate) > ymd_(new Date())) throw new Error('The appointment letter date cannot be in the future.'); out.patch.Appointment_Date = parseYmd_(data.appointmentDate); }
    if (data.docs) out.patch.Docs_JSON = JSON.stringify(fastDocs_(data.docs));
  }
  if (toStage === 'Onboarded') {
    const docs = fastDocs_(data.docs || {});
    const open = FAST_DOC_SECTIONS_.filter(function (s) { return ['Verified', 'NA'].indexOf(docs[s[0]]) < 0; });
    if (open.length && !String(data.exception || '').trim()) throw new Error('Joining documents not verified: ' + open.map(function (s) { return s[1]; }).join(', ') + '. Verify them (or mark Not applicable), or record the approved exception.');
    out.patch.Docs_JSON = JSON.stringify(docs);
    if (open.length) out.outcome = 'Conditional: ' + String(data.exception).slice(0, 200);
  }
  return out;
}
/** Keeps only the fast-track document keys with a known state. */
function fastDocs_(docs) {
  const ok = ['Pending', 'Received', 'Verified', 'NA'], o = {};
  FAST_DOC_SECTIONS_.forEach(function (s) { const v = String((docs || {})[s[0]] || 'Pending'); o[s[0]] = ok.indexOf(v) >= 0 ? v : 'Pending'; });
  return o;
}

/* ---------------------------------------------------------------- settings ---------------------------------- */

/** Admin > Hiring routes: which levels use the fast-track route. */
function apiFastTrackConfig() {
  const u = currentUser_(); ensureSchema_();
  const lv = fastLevels_();
  return { levels: TAT_LEVELS_, fast: lv, canEdit: can_(u, 'tat_edit'), defaults: FAST_DEFAULT_LEVELS_, stages: FAST_STAGES_.map(function (s) { return STAGE_NAMES[s]; }), docs: FAST_DOC_SECTIONS_ };
}
function apiFastTrackConfigSave(levels) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'tat_edit')) throw new Error('Only the Head of HR or the admin can change which levels use the fast-track route.');
  const list = (Array.isArray(levels) ? levels : []).map(function (x) { return String(x).toUpperCase(); }).filter(function (x, i, a) { return TAT_LEVELS_.indexOf(x) >= 0 && a.indexOf(x) === i; });
  const before = fastLevels_().join(',');
  setSetting_('FASTTRACK_LEVELS', list.length ? list.join(',') : 'NONE', 'Levels that use the fast-track hiring route');
  audit_(u, 'Hiring routes', '', 'Fast-track levels changed', '', before, list.join(',') || 'none');
  return apiFastTrackConfig();
}
