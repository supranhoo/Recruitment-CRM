/**
 * Several recruiters on one position. MRF.Recruiter stays the position's lead recruiter (every KPI, TAT clock and task still credits that
 * person in v163). The sheet Position_Recruiters adds the lead as a row and any number of tagged recruiters, each with the day they joined and
 * the day they were taken off (never deleted). A card (Applications) also records the recruiter who added the candidate (Owner_Recruiter).
 * Who may do what: see canWorkCard_ / requireCardAct_ in Auth.gs.
 */
const PR_ = { name: 'Position_Recruiters', id: 'PR_ID', prefix: 'PR-', width: 5 };
const PR_COLS_ = ['PR_ID', 'Line_ID', 'Recruiter', 'Role', 'Assigned_On', 'Ended_On', 'Status', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
const PR_MAX_TAGGED_ = 8;

function posRecSchema_() {
  addSheet_(PR_.name, PR_COLS_);
  addColumns_(T.APP.name, ['Owner_Recruiter']);
  addColumns_(T.HIST.name, ['Acted_For', 'Actor_Name']);
  _tables = {}; dropTableCache_();
  const sh = ss_().getSheetByName(PR_.name);
  if (sh.getLastRow() < 2) posRecBackfillLeads_();
  posRecBackfillOwners_();
}

/** One Lead row for every position that has a recruiter. */
function posRecBackfillLeads_() {
  const lines = readTable_(T.MRF.name, true).rows, now = new Date(), rows = [];
  lines.forEach(function (l) {
    const name = String(l.Recruiter || '').trim(); if (!name) return;
    rows.push([PR_.prefix + String(rows.length + 1).padStart(PR_.width, '0'), String(l.Line_ID), name, 'Lead', l.Assigned_On instanceof Date ? l.Assigned_On : '', '', 'Active', 'migration', now, 'migration', now]);
  });
  if (!rows.length) return;
  const sh = ss_().getSheetByName(PR_.name);
  sh.getRange(2, 1, rows.length, PR_COLS_.length).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('IDMAX_' + PR_.name, String(rows.length));
  dropStale_(PR_.name);
}

/** The recruiter who added each existing card: the candidate's sourcing name, else the position's recruiter at the time. Fills blanks only. */
function posRecBackfillOwners_() {
  const t = readTable_(T.APP.name, true), c = t.headers.indexOf('Owner_Recruiter') + 1;
  if (!c || !t.rows.length) return;
  const cands = {}; readTable_(T.CAND.name, true).rows.forEach(function (r) { cands[String(r.Candidate_ID)] = String(r.Sourced_By || '').trim(); });
  const last = t.sheet.getLastRow(); if (last < 2) return;
  const col = t.sheet.getRange(2, c, last - 1, 1).getValues();
  let changed = 0;
  t.rows.forEach(function (a) {
    const i = a._row - 2; if (i < 0 || i >= col.length || String(col[i][0] || '').trim()) return;
    const who = cands[String(a.Candidate_ID)] || String(a.Recruiter || '').trim();
    if (who) { col[i][0] = plainCell_(who); changed++; }
  });
  if (changed) { t.sheet.getRange(2, c, col.length, 1).setValues(col); dropStale_(T.APP.name); }
}

function posRecRows_() {
  try { return readTable_(PR_.name).rows; } catch (e) { return []; }
}
/** {Line_ID: [tagged recruiter names]} for the active tags. */
function posRecMap_() {
  if (_tables.__prmap) return _tables.__prmap;   // v165: built once per run
  const m = {};
  posRecRows_().forEach(function (r) {
    if (String(r.Status) !== 'Active' || String(r.Role) !== 'Tagged') return;
    (m[String(r.Line_ID)] = m[String(r.Line_ID)] || []).push(String(r.Recruiter));
  });
  _tables.__prmap = m;
  return m;
}
function posRecTagged_(lineId) { return posRecMap_()[String(lineId)] || []; }

/** Keeps the Lead row equal to MRF.Recruiter. Ends the old lead, converts a tag into the lead, and refreshes the cards' copy of the lead's name. */
function posRecSetLead_(lineId, name, u) {
  name = String(name || '').trim();
  const rows = posRecRows_().filter(function (r) { return String(r.Line_ID) === String(lineId) && String(r.Status) === 'Active'; });
  const lead = rows.filter(function (r) { return String(r.Role) === 'Lead'; })[0];
  if (lead && String(lead.Recruiter).trim().toLowerCase() === name.toLowerCase()) return;
  const today = new Date();
  if (lead) update_(PR_, lead.PR_ID, { Status: 'Ended', Ended_On: today }, u);
  rows.forEach(function (r) { if (String(r.Role) === 'Tagged' && String(r.Recruiter).trim().toLowerCase() === name.toLowerCase()) update_(PR_, r.PR_ID, { Status: 'Ended', Ended_On: today }, u); });
  if (name) insert_(PR_, { Line_ID: String(lineId), Recruiter: name, Role: 'Lead', Assigned_On: today, Status: 'Active' }, u);
  readTable_(T.APP.name).rows.forEach(function (a) {
    if (String(a.Line_ID) === String(lineId) && String(a.Status) === 'Active' && String(a.Recruiter || '') !== name) update_(T.APP, a.App_ID, { Recruiter: name }, u);
  });
}

/** Ends every tag a person holds (used when a user is deactivated). */
function posRecEndAllFor_(name, u) {
  const today = new Date(); let n = 0;
  posRecRows_().forEach(function (r) {
    if (String(r.Status) === 'Active' && String(r.Role) === 'Tagged' && String(r.Recruiter).trim().toLowerCase() === String(name).trim().toLowerCase()) { update_(PR_, r.PR_ID, { Status: 'Ended', Ended_On: today }, u); n++; }
  });
  return n;
}

function apiPosRecList(lineId) {
  const u = currentUser_(); ensureSchema_();
  const l = lineOf_(lineId); if (!l) throw new Error('Position ' + lineId + ' was not found.');
  const rows = posRecRows_().filter(function (r) { return String(r.Line_ID) === String(lineId); })
    .map(function (r, i) { return { name: String(r.Recruiter), role: String(r.Role), status: String(r.Status), since: ymd_(r.Assigned_On), until: ymd_(r.Ended_On), i: i }; });
  const history = rows.slice().sort(function (a, b) { return a.since === b.since ? b.i - a.i : (a.since < b.since ? 1 : -1); });
  return { lead: String(l.Recruiter || ''), tagged: rows.filter(function (r) { return r.role === 'Tagged' && r.status === 'Active'; }).map(function (r) { return r.name; }), history: history, canTag: isLead_(u),
    pick: activeRecruiterNames_() };
}
function activeRecruiterNames_() {
  return readTable_('M_Recruiters').rows.filter(function (r) { return String(r.Active || 'Yes') !== 'No' && String(r.Recruiter || '').trim(); }).map(function (r) { return String(r.Recruiter).trim(); });
}

/** Sets the tagged recruiters of a position (not the lead). TA Lead, Head of HR and Admin only. */
function apiPosRecSet(lineId, names) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can tag recruiters on a position.');
  const l = lineOf_(lineId); if (!l) throw new Error('Position ' + lineId + ' was not found.');
  const lead = String(l.Recruiter || '').trim().toLowerCase(), valid = {};
  activeRecruiterNames_().forEach(function (n) { valid[n.toLowerCase()] = n; });
  const want = [];
  (names || []).forEach(function (n) {
    const k = String(n || '').trim().toLowerCase(); if (!k || k === lead || want.some(function (w) { return w.toLowerCase() === k; })) return;
    if (!valid[k]) throw new Error(String(n) + ' is not an active recruiter.');
    want.push(valid[k]);
  });
  if (want.length > PR_MAX_TAGGED_) throw new Error('At most ' + PR_MAX_TAGGED_ + ' recruiters can be tagged on one position.');
  const have = posRecRows_().filter(function (r) { return String(r.Line_ID) === String(lineId) && String(r.Status) === 'Active' && String(r.Role) === 'Tagged'; });
  const today = new Date();
  have.forEach(function (r) { if (!want.some(function (w) { return w.toLowerCase() === String(r.Recruiter).trim().toLowerCase(); })) update_(PR_, r.PR_ID, { Status: 'Ended', Ended_On: today }, u); });
  want.forEach(function (w) {
    if (!have.some(function (r) { return String(r.Recruiter).trim().toLowerCase() === w.toLowerCase(); })) insert_(PR_, { Line_ID: String(lineId), Recruiter: w, Role: 'Tagged', Assigned_On: today, Status: 'Active' }, u);
  });
  return apiPosRecList(lineId);
}

/* ---------------------------------------------------------------- split credit (v164) ----------------------------------------------
 * Setting SPLIT_CREDIT_FROM (a date). Empty = every figure is credited exactly as before (the lead recruiter only). From the date, a
 * position that has a recruiter tagged on or after it is "split": card events go to the card's recruiter, position measures also go to
 * each active tagged recruiter (team totals count the position once). A position with no such tag is never affected.
 */
function splitFrom_() {
  const v = settings_().SPLIT_CREDIT_FROM, d = ymd_(v) || String(v || '').replace(/^'/, '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}
/** {split, by: {Line_ID: {tagged: [{name, from}], known: {lowercase name: true}, split: bool}}}, built once per run. */
function posCreditIdx_() {
  if (_tables.__posrec) return _tables.__posrec;
  const split = splitFrom_(), idx = { split: split, by: {} };
  if (split) posRecRows_().forEach(function (r) {
    const nm = String(r.Recruiter || '').trim(); if (!nm) return;
    const e = idx.by[String(r.Line_ID)] = idx.by[String(r.Line_ID)] || { tagged: [], known: {}, split: false };
    e.known[nm.toLowerCase()] = true;
    const from = ymd_(r.Assigned_On);
    if (String(r.Role) === 'Tagged' && from && from >= split) {
      e.split = true;
      if (String(r.Status) === 'Active') e.tagged.push({ name: nm, from: from });
    }
  });
  _tables.__posrec = idx;
  return idx;
}
/** True when the position is credited in the split way. */
function lineSplit_(l) {
  const e = l && posCreditIdx_().by[String(l.Line_ID)];
  return !!(e && e.split);
}
/** The active tagged recruiters who earn position credit: [{name, from}] (empty unless the position is split). */
function posTaggedCredits_(l) {
  const e = l && posCreditIdx_().by[String(l.Line_ID)];
  return e && e.split ? e.tagged : [];
}
/**
 * Who a card's events count for. The position's lead recruiter (exactly l.Recruiter, as before) unless the position is split and the card's
 * recruiter is a person on that position, then that person.
 */
function cardCredit_(l, app) {
  if (!l || !app || !lineSplit_(l)) return l && l.Recruiter;
  const owner = String(app.Owner_Recruiter || '').trim(), lead = String(l.Recruiter || '').trim();
  if (!owner || owner.toLowerCase() === lead.toLowerCase()) return l.Recruiter;
  return posCreditIdx_().by[String(l.Line_ID)].known[owner.toLowerCase()] ? owner : l.Recruiter;
}
