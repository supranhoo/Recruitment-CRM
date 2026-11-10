/**
 * Check-in plan (Admin > Check-in plan). A timeline of touchpoints between the accepted offer and 90 days after joining.
 * Each touchpoint says WHEN (an anchor date plus days), WHAT TO ASK (up to 4 questions) and WHAT TO TELL (approved facts).
 * One row per touchpoint per version in the Checkin_Plan sheet; a save appends a whole new version (append-only, like TAT_Rules).
 * v161 plans and shows the dates only. It places no call and writes nothing to a card.
 */
const CHECKIN_PLAN_ = 'Checkin_Plan';
const CHECKIN_COLS_ = ['Plan_ID', 'Version_ID', 'Effective_From', 'Status', 'Touch_ID', 'Seq', 'Title', 'Anchor', 'Offset_Days', 'Must', 'Channel', 'Max_Attempts', 'Active', 'Ask_JSON', 'Inform_JSON', 'Note', 'Created_By', 'Created_At'];
const CHECKIN_ANCHORS_ = ['Offer_Accepted_On', 'EDOJ', 'Actual_DOJ'];
const CHECKIN_ANCHOR_NAMES_ = { Offer_Accepted_On: 'offer accepted', EDOJ: 'expected joining date', Actual_DOJ: 'actual joining date' };
const CHECKIN_TYPES_ = ['yesno', 'text', 'number', 'choice'];
const CHECKIN_RISKS_ = ['', 'Green', 'Amber', 'Red'];
const CHECKIN_MIN_GAP_ = 2;
const CHECKIN_MAX_ASK_ = 4;
const CHECKIN_MAX_INFORM_ = 6;
const CHECKIN_REASON_MIN_ = 10;
const CHECKIN_FIELDS_ = ['name', 'role', 'joining_date', 'days_to_joining'];
/** Money and terms are never spoken by a check-in call (the agent does not state or negotiate them). */
const CHECKIN_FORBIDDEN_ = /\b(ctc|salary|package|lpa|lakh|compensation|increment|hike|grade|bonus)\b|₹|\brs\.?\s*\d/i;

/** The first draft of the plan. Wording is for the Head of HR to edit; it is stored as version V1. */
function checkinDefaults_() {
  function q(id, text, type, signal, risk) { return { id: id, q: text, type: type, signal: signal || '', risk: risk || '' }; }
  return [
    { id: 'C1', title: 'Welcome after acceptance', anchor: 'Offer_Accepted_On', offset: 2, must: 'No', attempts: 2,
      ask: [q('c1a', 'You have accepted our offer for {role}. Is everything clear with you so far?', 'yesno', 'No means confusion about the offer', 'Amber'),
        q('c1b', 'Have you spoken to your current employer about resigning?', 'choice', 'Not yet is normal; Counter-offer or Declined is a risk', '')],
      inform: ['We are happy to have you join as {role}.', 'Your expected joining date is {joining_date}.', 'Your recruiter will stay in touch before you join.'] },
    { id: 'C2', title: 'Resignation and release check', anchor: 'Offer_Accepted_On', offset: 7, must: 'No', attempts: 2,
      ask: [q('c2a', 'Have you submitted your resignation?', 'yesno', 'No after a week needs attention', 'Amber'),
        q('c2b', 'Has your employer made any counter-offer or asked you to reconsider?', 'yesno', 'Yes is a backout risk', 'Red'),
        q('c2c', 'What is your expected last working day?', 'text', 'A date later than the joining date is a risk', '')],
      inform: ['Please share your relieving letter as soon as you receive it.'] },
    { id: 'C3', title: 'Mid-notice pulse', anchor: 'EDOJ', offset: -14, must: 'No', attempts: 2,
      ask: [q('c3a', 'Are you still on track to join on {joining_date}?', 'yesno', 'No means the date or the decision is at risk', 'Red'),
        q('c3b', 'Do you have any concern or question we can help with?', 'text', 'Any concern needs a person to follow up', 'Amber'),
        q('c3c', 'Do you have any other offer or pending interview?', 'yesno', 'Yes is a backout risk', 'Amber')],
      inform: ['Please keep your documents ready for joining.'] },
    { id: 'C4', title: 'Joining logistics', anchor: 'EDOJ', offset: -3, must: 'Yes', attempts: 2,
      ask: [q('c4a', 'Will you be able to join on {joining_date}?', 'yesno', 'No is critical', 'Red'),
        q('c4b', 'Do you have all your joining documents ready?', 'yesno', 'No means a document follow-up', 'Amber')],
      inform: ['Your joining date is {joining_date}, in {days_to_joining} days.', 'Please carry the documents listed in your joining mail.', 'Your recruiter will share the reporting details.'] },
    { id: 'C5', title: 'Joining-day confirmation', anchor: 'EDOJ', offset: -1, must: 'Yes', attempts: 2,
      ask: [q('c5a', 'Will you join tomorrow as planned?', 'yesno', 'No is critical', 'Red'),
        q('c5b', 'Is there anything that could stop you from joining?', 'text', 'Any blocker needs a person today', 'Amber')],
      inform: ['We look forward to seeing you tomorrow.'] },
    { id: 'C6', title: 'Day-1 welcome', anchor: 'Actual_DOJ', offset: 1, must: 'No', attempts: 1, active: 'No',
      ask: [q('c6a', 'How did your first day go?', 'text', '', ''), q('c6b', 'Did you get what you needed to get started?', 'yesno', 'No needs an Onboarding follow-up', 'Amber')],
      inform: ['The Onboarding team is there to help you settle in.'] },
    { id: 'C7', title: 'Month 1 check-in', anchor: 'Actual_DOJ', offset: 30, must: 'No', attempts: 2,
      ask: [q('c7a', 'How are you settling in?', 'text', '', ''), q('c7b', 'Have you met your buddy and your manager?', 'yesno', 'No needs an Onboarding follow-up', 'Amber'),
        q('c7c', 'Is there anything you need support with?', 'text', 'Any ask needs a person to follow up', 'Amber')],
      inform: [] },
    { id: 'C8', title: 'Month 2 check-in', anchor: 'Actual_DOJ', offset: 60, must: 'No', attempts: 2,
      ask: [q('c8a', 'Is your role and what is expected of you clear?', 'yesno', 'No is a concern', 'Amber'),
        q('c8b', 'Is there anything you need support with?', 'text', 'Any ask needs a person to follow up', 'Amber')],
      inform: [] },
    { id: 'C9', title: 'Month 3 check-in', anchor: 'Actual_DOJ', offset: 90, must: 'No', attempts: 2,
      ask: [q('c9a', 'How do you feel about the role and the team after three months?', 'text', '', ''),
        q('c9b', 'Do you have any concern we should know about?', 'text', 'A concern needs a person to follow up', 'Amber'),
        q('c9c', 'Do you see yourself continuing here?', 'yesno', 'No is a retention risk', 'Red')],
      inform: [] }
  ];
}

function checkinRowOut_(t, vid, eff, now, by, note, idStart, i) {
  return [ 'CP-' + ('0000' + (idStart + i)).slice(-4), vid, eff, 'Active', t.id, i + 1, t.title, t.anchor, t.offset, t.must, 'Voice', t.attempts, t.active,
    JSON.stringify(t.ask), JSON.stringify(t.inform), note, by, now ];
}

/** Creates the sheet and seeds version V1 (the default plan, effective for all dates). Safe to call again. */
function checkinSchema_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CHECKIN_PLAN_);
  if (!sh) { sh = ss.insertSheet(CHECKIN_PLAN_); sh.getRange(1, 1, 1, CHECKIN_COLS_.length).setValues([CHECKIN_COLS_]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F'); sh.setFrozenRows(1); }
  if (sh.getLastRow() > 1) return;
  const now = new Date(), eff = parseYmd_(TAT_BASE_EFF_);
  const rows = checkinDefaults_().map(function (t, i) {
    t.active = t.active || 'Yes';
    return checkinRowOut_(t, 'V1', eff, now, 'system', 'First draft of the plan, for the Head of HR to edit', 1, i);
  });
  sh.getRange(2, 1, rows.length, CHECKIN_COLS_.length).setValues(rows);
  dropStale_(CHECKIN_PLAN_);
}

function checkinParse_(s, fallback) { try { const v = JSON.parse(s || ''); return Array.isArray(v) ? v : fallback; } catch (e) { return fallback; } }

/** All versions, newest first: {id, eff, note, by, at, status, touches[]}. */
function checkinVersions_() {
  checkinSchema_();
  const by = {};
  readTable_(CHECKIN_PLAN_, true).rows.forEach(function (r) {
    const id = String(r.Version_ID || '');
    const v = by[id] = by[id] || { id: id, eff: ymd_(r.Effective_From) || TAT_BASE_EFF_, note: String(r.Note || ''), by: String(r.Created_By || ''),
      at: r.Created_At instanceof Date ? fmt_(r.Created_At, TZ, 'd MMM yyyy, HH:mm') : '', status: String(r.Status || 'Active'), touches: [] };
    v.touches.push({ id: String(r.Touch_ID), seq: Number(r.Seq) || 0, title: String(r.Title || ''), anchor: String(r.Anchor || ''), offset: Number(r.Offset_Days) || 0,
      must: String(r.Must || 'No'), attempts: Number(r.Max_Attempts) || 1, active: String(r.Active || 'Yes'), ask: checkinParse_(r.Ask_JSON, []), inform: checkinParse_(r.Inform_JSON, []) });
  });
  return Object.keys(by).map(function (k) { by[k].touches.sort(function (a, b) { return a.seq - b.seq; }); return by[k]; })
    .sort(function (a, b) { return Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, '')); });
}

/** The version in force on a day: the Active version with the latest effective date on or before it. */
function checkinInForce_(versions, day) {
  const live = versions.filter(function (v) { return v.status === 'Active' && v.eff <= day; }).sort(function (a, b) { return a.eff < b.eff ? 1 : a.eff > b.eff ? -1 : Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, '')); });
  return live[0] || null;
}

/* ---------------------------------------------------------------- the dates (pure, no sheet access) ---------------------------- */

function checkinAddDays_(ymd, n) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.toISOString().slice(0, 10);
}
function checkinDow_(ymd) { const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/); return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay(); }
function checkinDiff_(a, b) {
  const x = String(a).match(/^(\d{4})-(\d{2})-(\d{2})/), y = String(b).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return Math.round((Date.UTC(+x[1], +x[2] - 1, +x[3]) - Date.UTC(+y[1], +y[2] - 1, +y[3])) / 86400000);
}

/**
 * The calls one card would get. anchors: {Offer_Accepted_On, EDOJ, Actual_DOJ} as yyyy-MM-dd or ''. today: yyyy-MM-dd.
 * Returns [{id, title, anchor, due, status, reason}] in plan order. status: Planned, Waiting (anchor not known yet), Skipped.
 * A call is not back-filled once its day has passed. A call with no calls-free day is moved off Sunday (before joining: to the
 * Saturday before; after joining: to the Monday after). A call that would fall less than CHECKIN_MIN_GAP_ days after the
 * previous kept one is dropped unless it is marked Must. A call before joining that would fall after the expected joining date
 * or before the offer was accepted is dropped.
 */
function checkinSchedule_(touches, anchors, today) {
  const out = []; let lastKept = '';
  (touches || []).forEach(function (t) {
    const o = { id: t.id, title: t.title, anchor: t.anchor, due: '', status: 'Planned', reason: '' };
    out.push(o);
    if (t.active === 'No') { o.status = 'Skipped'; o.reason = 'Switched off in the plan'; return; }
    const base = anchors[t.anchor];
    if (!base) { o.status = 'Waiting'; o.reason = 'Waits for the ' + CHECKIN_ANCHOR_NAMES_[t.anchor]; return; }
    let due = checkinAddDays_(base, t.offset);
    if (checkinDow_(due) === 0) due = checkinAddDays_(due, t.anchor === 'Actual_DOJ' ? 1 : -1);
    if (t.anchor !== 'Actual_DOJ') {
      if (anchors.EDOJ && due > anchors.EDOJ) { o.status = 'Skipped'; o.reason = 'Falls after the expected joining date'; return; }
      if (anchors.Offer_Accepted_On && due <= anchors.Offer_Accepted_On) { o.status = 'Skipped'; o.reason = 'Falls on or before the day the offer was accepted'; return; }
    }
    o.due = due;
    if (due < today) { o.status = 'Skipped'; o.reason = 'The day has passed'; return; }
    if (t.must !== 'Yes' && lastKept && Math.abs(checkinDiff_(due, lastKept)) < CHECKIN_MIN_GAP_) { o.status = 'Skipped'; o.reason = 'Too close to the previous call'; return; }
    lastKept = due;
  });
  return out;
}

/** The words a candidate would hear: placeholders filled from the card. */
function checkinFill_(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, function (m, k) { return vars[k] == null || vars[k] === '' ? '…' : String(vars[k]); });
}
function checkinVars_(name, role, joiningDate, today) {
  const days = joiningDate ? checkinDiff_(joiningDate, today) : '';
  return { name: String(name || '').trim().split(/\s+/)[0] || '', role: role || '', joining_date: joiningDate ? fmtYmdLong_(joiningDate) : '', days_to_joining: days === '' || days < 0 ? '' : days };
}
function fmtYmdLong_(ymd) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], p = String(ymd).split('-');
  return p.length < 3 ? String(ymd) : (+p[2]) + ' ' + M[+p[1] - 1] + ' ' + p[0];
}

/** Sample dates shown in the editor's preview. */
function checkinSampleAnchors_(today, noticeDays) {
  const acc = checkinAddDays_(today, 0), edoj = checkinAddDays_(acc, noticeDays);
  return { Offer_Accepted_On: acc, EDOJ: edoj, Actual_DOJ: edoj };
}

/* ---------------------------------------------------------------- validation of a proposed plan -------------------------------- */

function checkinCheckText_(text, label) {
  const s = String(text == null ? '' : text).trim();
  if (CHECKIN_FORBIDDEN_.test(s)) throw new Error(label + ': a check-in call never speaks about pay or terms. Remove the words about salary, CTC, grade or similar.');
  const bad = (s.match(/\{(\w+)\}/g) || []).map(function (x) { return x.slice(1, -1); }).filter(function (k) { return CHECKIN_FIELDS_.indexOf(k) < 0; });
  if (bad.length) throw new Error(label + ': {' + bad[0] + '} is not a known field. Use ' + CHECKIN_FIELDS_.map(function (k) { return '{' + k + '}'; }).join(', ') + '.');
  return s;
}

/** Validates and cleans the proposed touchpoints. Returns the list as stored. */
function checkinTouches_(d) {
  const list = (d && d.touches) || [];
  if (!list.length) throw new Error('The plan needs at least one call.');
  if (list.length > 20) throw new Error('A plan can have at most 20 calls.');
  const seen = {};
  return list.map(function (t, i) {
    const id = String(t.id || '').trim().toUpperCase();
    if (!/^C\d{1,2}$/.test(id)) throw new Error('Call ' + (i + 1) + ': the id must look like C1, C2 …');
    if (seen[id]) throw new Error('Two calls share the id ' + id + '.'); seen[id] = true;
    const title = clean_(String(t.title || '')).trim().slice(0, 80);
    if (title.length < 3) throw new Error(id + ': give the call a title.');
    const anchor = String(t.anchor || '');
    if (CHECKIN_ANCHORS_.indexOf(anchor) < 0) throw new Error(id + ': choose when it is counted from.');
    const offset = Number(t.offset);
    if (!(offset === Math.round(offset) && offset >= -365 && offset <= 365)) throw new Error(id + ': days must be a whole number from -365 to 365.');
    if (anchor === 'Actual_DOJ' && offset < 0) throw new Error(id + ': a call counted from the actual joining date cannot be before it.');
    if (anchor === 'Offer_Accepted_On' && offset < 1) throw new Error(id + ': a call counted from the offer acceptance must be at least 1 day after.');
    const attempts = Number(t.attempts);
    if (!(attempts >= 1 && attempts <= 3 && attempts === Math.round(attempts))) throw new Error(id + ': attempts must be 1, 2 or 3.');
    const ask = (t.ask || []).map(function (a, j) {
      const lab = id + ' question ' + (j + 1), q = checkinCheckText_(clean_(String(a.q || '')), lab);
      if (q.length < 5 || q.length > 300) throw new Error(lab + ': write the question in 5 to 300 characters.');
      const type = String(a.type || 'text'), risk = String(a.risk || '');
      if (CHECKIN_TYPES_.indexOf(type) < 0) throw new Error(lab + ': unknown answer type.');
      if (CHECKIN_RISKS_.indexOf(risk) < 0) throw new Error(lab + ': the risk must be Green, Amber, Red or empty.');
      return { id: id.toLowerCase() + String.fromCharCode(97 + j), q: q, type: type, signal: clean_(String(a.signal || '')).slice(0, 200), risk: risk };
    });
    if (ask.length > CHECKIN_MAX_ASK_) throw new Error(id + ': at most ' + CHECKIN_MAX_ASK_ + ' questions per call.');
    const inform = (t.inform || []).map(function (s, j) { const x = checkinCheckText_(clean_(String(s || '')), id + ' information ' + (j + 1)); return x; }).filter(Boolean);
    inform.forEach(function (x, j) { if (x.length > 300) throw new Error(id + ' information ' + (j + 1) + ': keep it under 300 characters.'); });
    if (inform.length > CHECKIN_MAX_INFORM_) throw new Error(id + ': at most ' + CHECKIN_MAX_INFORM_ + ' facts per call.');
    if (String(t.active) !== 'No' && !ask.length && !inform.length) throw new Error(id + ': an active call needs a question or a fact to tell.');
    return { id: id, title: title, anchor: anchor, offset: offset, must: t.must === 'Yes' ? 'Yes' : 'No', attempts: attempts, active: t.active === 'No' ? 'No' : 'Yes', ask: ask, inform: inform };
  });
}

/* ---------------------------------------------------------------- APIs --------------------------------------------------------- */

function checkinView_(u) { if (!can_(u, 'lead') && !can_(u, 'checkin_plan_edit')) throw new Error('Only a TA Lead, the Head of HR or the admin can see the check-in plan.'); }
function checkinEdit_(u) { if (!can_(u, 'checkin_plan_edit')) throw new Error('Only the Head of HR or the admin can change the check-in plan.'); }

function apiCheckinPlan() {
  const u = currentUser_(); ensureSchema_(); checkinView_(u);
  const versions = checkinVersions_(), today = ymd_(new Date()), cur = checkinInForce_(versions, today);
  return { canEdit: can_(u, 'checkin_plan_edit'), today: today, anchors: CHECKIN_ANCHORS_.map(function (a) { return { id: a, name: CHECKIN_ANCHOR_NAMES_[a] }; }),
    fields: CHECKIN_FIELDS_, maxAsk: CHECKIN_MAX_ASK_, maxInform: CHECKIN_MAX_INFORM_, minGap: CHECKIN_MIN_GAP_, current: cur ? cur.id : '', versions: versions };
}

/** What the proposed plan would do for a sample candidate. Nothing is saved. */
function apiCheckinPreview(d) {
  const u = currentUser_(); ensureSchema_(); checkinEdit_(u);
  d = d || {};
  const touches = checkinTouches_(d), today = ymd_(new Date()), notice = Math.max(10, Math.min(120, Number(d.notice) || 45));
  const anchors = checkinSampleAnchors_(today, notice), sched = checkinSchedule_(touches, anchors, today);
  const vars = checkinVars_('Asha Rao', 'Sales Executive', anchors.EDOJ, today);
  // Dates after joining are shown from the sample joining date, as if the person had joined on schedule.
  return { notice: notice, accepted: anchors.Offer_Accepted_On, edoj: anchors.EDOJ, calls: sched.map(function (s, i) {
    const t = touches[i];
    return { id: s.id, title: s.title, due: s.due, status: s.status, reason: s.reason, ask: t.ask.map(function (a) { return checkinFill_(a.q, vars); }), inform: t.inform.map(function (x) { return checkinFill_(x, vars); }) };
  }) };
}

function apiCheckinSave(d) {
  const u = currentUser_(); ensureSchema_(); checkinEdit_(u);
  d = d || {};
  const touches = checkinTouches_(d), note = clean_(String(d.note || '')).trim().slice(0, 300);
  if (note.length < CHECKIN_REASON_MIN_) throw new Error('Say why the plan is changing, in at least ' + CHECKIN_REASON_MIN_ + ' characters.');
  const eff = ymd_(d.eff) || ymd_(new Date());
  if (eff < ymd_(new Date())) throw new Error('A plan cannot start in the past. Pick today or a later date.');
  checkinSchema_();
  const version = withLock_(function () {
    const t = readTable_(CHECKIN_PLAN_, true);
    const vmax = t.rows.reduce(function (mx, r) { return Math.max(mx, Number(String(r.Version_ID || '').replace(/\D/g, '')) || 0); }, 0);
    const imax = t.rows.reduce(function (mx, r) { return Math.max(mx, Number(String(r.Plan_ID || '').replace(/\D/g, '')) || 0); }, 0);
    const vid = 'V' + (vmax + 1), sc = t.headers.indexOf('Status') + 1;
    t.rows.forEach(function (r) {
      // A version starting the same day replaces the earlier one for that day; older versions stay as history.
      if (String(r.Status || 'Active') === 'Active' && (ymd_(r.Effective_From) || TAT_BASE_EFF_) === eff) t.sheet.getRange(r._row, sc).setValue('Superseded');
    });
    const now = new Date();
    const vals = touches.map(function (x, i) { return checkinRowOut_(x, vid, parseYmd_(eff), now, u.email, note, imax + 1, i); });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, vals.length, t.headers.length).setValues(vals);
    return vid;
  });
  dropStale_(CHECKIN_PLAN_);
  audit_(u, CHECKIN_PLAN_, version, 'Create', 'plan', '', touches.length + ' calls from ' + eff + ': ' + note);
  return { version: version };
}

/** The check-in dates for one card (read only). Shown on the card; it places and changes nothing. */
function apiCheckinFor(appId) {
  const u = currentUser_(); ensureSchema_();
  const a = appOf_(appId), l = lineOf_(a.Line_ID) || {}, c = candRow_(a.Candidate_ID) || {};
  const today = ymd_(new Date()), cur = checkinInForce_(checkinVersions_(), today);
  if (!cur) return { version: '', calls: [] };
  const anchors = { Offer_Accepted_On: ymd_(a.Offer_Accepted_On), EDOJ: ymd_(l.EDOJ) || ymd_(a.EDOJ), Actual_DOJ: ymd_(a.Actual_DOJ) || ymd_(l.Actual_DOJ) };
  const live = String(a.Status) === 'Active' && ['Prejoin', 'Joined', 'Onboarded'].indexOf(String(a.Stage)) >= 0;
  const sched = live ? checkinSchedule_(cur.touches, anchors, today) : [];
  return { version: cur.id, live: live, anchors: anchors, calls: sched.map(function (s) { return { id: s.id, title: s.title, due: s.due, status: s.status, reason: s.reason }; }) };
}
