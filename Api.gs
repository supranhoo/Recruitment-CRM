/**
 * Functions the web page calls through google.script.run.
 * Every one resolves the user first, so nothing is reachable without a Users-sheet entry.
 */

function apiBootstrap() {
  const u = currentUser_();
  ensureSchema_();
  const lists = {};
  readTable_('M_Lists').rows.forEach(function (r) { (lists[r.List] = lists[r.List] || []).push(String(r.Value)); });
  return {
    user: u,
    depts: readTable_('M_Departments').rows.map(function (r) { return { dept: String(r.Dept), bu: String(r.Business_Unit), division: String(r.Division || '') }; }),
    grades: gradesForClient_(),
    tatRules: (function () { const s = settings_(); return tatRulesMap_(Number(s.NOTICE_GRACE_DAYS) || 30, Number(s.TAT_AT_RISK_PCT) || 0.8); })(),
    panel: panelMembers_(false),
    recruiters: readTable_('M_Recruiters').rows.filter(function (r) { return String(r.Active) !== 'No'; }).map(function (r) { return String(r.Recruiter); }),
    lists: lists,
    dbUrl: u.role === ROLES.ADMIN ? ss_().getUrl() : '',
    cutover: cutover_(),
    archiveDays: archiveDays_()
  };
}

/* ---------------- Positions (MRF lines) ---------------- */

function listLine_(l, ctx, u) {
  const c = computeTat_(l, ctx);
  Object.keys(c).forEach(function (k) { l[k] = c[k]; });
  const o = toClient_(l);
  o._canEdit = canEditLine_(u, l);
  delete o._row;
  return o;
}

function apiListPositions() {
  const u = currentUser_();
  const ctx = tatContext_();
  return readTable_(T.MRF.name).rows.map(function (l) { return listLine_(l, ctx, u); });
}

/** One position, computed exactly as in the list (used to refresh a single row after a change). */
function apiGetPosition(lineId) {
  const u = currentUser_();
  const l = readTable_(T.MRF.name).rows.filter(function (x) { return x.Line_ID === lineId; })[0];
  if (!l) throw new Error('Position ' + lineId + ' was not found.');
  return listLine_(l, tatContext_(), u);
}

/**
 * ETag-style fetch for the big lists and the pipeline board. The page sends the version it already has;
 * if the underlying tables have not changed, the answer is {same: true} with no data.
 * Stamps are read before the data is built, so a write during the build can only cause an extra refetch.
 */
const FETCHABLE_ = {
  apiListPositions: { tables: ['MRF', 'M_Grades', 'Settings', 'Users'], per: 'day', packed: true },
  apiListCandidates: { tables: ['Candidates', 'Users'], per: '', packed: true },
  apiListFunnel: { tables: ['Daily_Funnel', 'Users'], per: 'day', packed: true },
  apiPipeline: { tables: ['Applications', 'Stage_History', 'Followups', 'Candidates', 'MRF', 'Job_Posts', 'Interviews', 'M_Panel_Members'], per: 'hour', packed: false }
};
function apiFetch(fn, args, known) {
  const u = currentUser_();
  const spec = FETCHABLE_[fn];
  if (!spec) throw new Error('Unknown list.');
  args = args || [];
  const now = new Date();
  const period = spec.per === 'day' ? ymd_(now) : spec.per === 'hour' ? fmt_(now, TZ, 'yyyy-MM-dd HH') : '';
  const version = [SCHEMA_VERSION, u.email, u.role, fn, JSON.stringify(args), period].concat(tableStamps_(spec.tables)).join('|');
  if (known && known === version) return { v: version, same: true };
  const all = { apiListPositions: apiListPositions, apiListCandidates: apiListCandidates, apiListFunnel: apiListFunnel, apiPipeline: apiPipeline };
  const data = spec.packed ? apiPacked(fn, args) : all[fn].apply(null, args);
  return { v: version, data: data };
}

/**
 * Sends a big list as {cols, rows} instead of one object per row, which repeats every field name.
 * The page rebuilds the objects, so screens see exactly the same data at roughly a third of the size.
 */
function apiPacked(fn, args) {
  const allowed = { apiListPositions: apiListPositions, apiListCandidates: apiListCandidates, apiListFunnel: apiListFunnel };
  if (!allowed[fn]) throw new Error('Unknown list.');
  const list = allowed[fn].apply(null, args || []);
  const cols = [], seen = {};
  list.forEach(function (o) { Object.keys(o).forEach(function (k) { if (!seen[k]) { seen[k] = true; cols.push(k); } }); });
  return { cols: cols, rows: list.map(function (o) { return cols.map(function (k) { return o[k] === undefined ? null : o[k]; }); }) };
}

function apiSavePosition(data) {
  const u = currentUser_();
  const ctx = tatContext_();
  const patch = prepare_(T.MRF, data);
  delete patch.JD_Confirmed_Date; delete patch.SQ_Confirmed_Date;
  if (!patch.Position || !patch.Grade || !patch.Dept || !patch.Receipt_Date) throw new Error('Position, grade, department and MRF receipt date are required.');
  checkConfirmDates_(patch);
  const old = data.Line_ID ? readTable_(T.MRF.name).rows.filter(function (l) { return l.Line_ID === data.Line_ID; })[0] : null;
  checkDesignation_(patch, old);
  assignDates_(patch, old, u);
  if (patch.Approval_Status === 'No Vacancy' && !patch.No_Vacancy_Date) throw new Error('Add the date the position was marked No Vacancy.');
  if ((patch.Approval_Status === 'Not Needed' || patch.Approval_Status === 'On Hold') && !patch.Not_Needed_Date) throw new Error('Add the date the position was marked ' + patch.Approval_Status + '.');
  if (patch.Actual_DOJ && String(patch.Offer_Sent).toUpperCase() !== 'YES') throw new Error('Set Offer sent to Yes before entering the actual joining date.');
  guardPipelineFields_(patch, old, u);
  Object.assign(patch, storedTat_(computeTat_(patch, ctx)));
  let rec;
  if (data.Line_ID) {
    rec = update_(T.MRF, data.Line_ID, patch, u, function (old) {
      if (!canEditLine_(u, old)) throw new Error('This position is assigned to ' + old.Recruiter + '. Only they, a TA Lead or the Head of HR can edit it.');
      if (positionStatus_(old) === 'Removed') throw new Error('This position was removed because it was created in error. A TA Lead or the Head of HR can restore it.');
    });
  } else {
    if (!isLead_(u)) patch.Recruiter = u.recruiter;
    rec = insert_(T.MRF, patch, u);
  }
  const oldText = old ? String(old.JD_Text || '').trim() : '', newText = String(rec.JD_Text || '').trim();
  if (newText && newText !== oldText && 'JD_Text' in patch) pdocAddJd_(u, rec.Line_ID, { content: newText, source: 'Typed on the position form' });
  const o = toClient_(lineOf_(rec.Line_ID) || rec); o._canEdit = true; delete o._row;
  return o;
}

/** Switch-over date (Settings \u2192 PIPELINE_CUTOVER): from then on offers, joinings and backouts are recorded only in the Pipeline. */
function cutover_() { return ymd_(settings_().PIPELINE_CUTOVER) || String(settings_().PIPELINE_CUTOVER || '').slice(0, 10) || '2026-10-05'; }
const PIPELINE_FIELDS_ = [['Offer_Sent', 'Offer sent'], ['Offer_Date', 'Offer letter date'], ['EDOJ', 'Expected joining date'], ['Actual_DOJ', 'Actual joining date'], ['Backout_Date', 'Backout date'], ['Candidate_ID', 'Selected candidate']];
/** After the switch-over, recruiters cannot type offer, joining or backout details on the position form; the head and admin can correct them. */
function guardPipelineFields_(patch, old, u) {
  if (isLead_(u) || ymd_(new Date()) < cutover_()) return;
  if (old && positionStatus_(old) === 'Replaced') throw new Error('This position was closed after a backout and replaced by another MRF. Work on the replacement.');
  if (old && 'Approval_Status' in patch && String(patch.Approval_Status) !== String(old.Approval_Status || '')
    && (CLOSED_OUTCOMES_.indexOf(String(patch.Approval_Status)) >= 0 || CLOSED_OUTCOMES_.indexOf(String(old.Approval_Status)) >= 0)) {
    throw new Error('Use \u201cClose without hiring\u201d or \u201cResume position\u201d to change this status, so the reason and the candidates are handled.');
  }
  PIPELINE_FIELDS_.forEach(function (f) {
    if (!(f[0] in patch)) return;
    const was = old ? old[f[0]] : '', now = patch[f[0]];
    const same = f[0] === 'Offer_Sent' ? String(was || 'No').toUpperCase() === String(now || 'No').toUpperCase()
      : (ymd_(was) || String(was || '')) === (ymd_(now) || String(now || ''));
    if (!same) throw new Error(f[1] + ' is recorded from the candidate pipeline now. Move the candidate in the Pipeline instead, or ask a TA Lead or the Head of HR to correct it.');
  });
}

/**
 * MRF approved on defaults to MRF received on; position assigned on defaults to MRF approved on.
 * Reassigning to another recruiter restarts the clock from the reassignment date.
 * Recruiters can set these dates only while blank; after that only the head or admin can change them.
 */
function assignDates_(patch, old, u) {
  const lead = isLead_(u), today = ymd_(new Date());
  const reassigned = !!(old && String(old.Recruiter || '').trim() && patch.Recruiter && String(old.Recruiter).trim() !== String(patch.Recruiter).trim());
  if (!patch.Approved_On && patch.Approval_Status === 'Approved' && patch.Receipt_Date) patch.Approved_On = patch.Receipt_Date;
  if (reassigned && (!lead || !patch.Assigned_On || ymd_(patch.Assigned_On) === ymd_(old.Assigned_On))) patch.Assigned_On = parseYmd_(today);
  if (!patch.Assigned_On && patch.Approved_On) patch.Assigned_On = patch.Approved_On;
  if (old && !lead) {
    [['Approved_On', 'MRF approved on'], ['Assigned_On', 'Position assigned on']].forEach(function (f) {
      const was = ymd_(old[f[0]]);
      if (was && ymd_(patch[f[0]]) !== was && !(f[0] === 'Assigned_On' && reassigned)) {
        throw new Error(f[1] + ' is already set to ' + was + '. Only a TA Lead, the Head of HR or the admin can change it.');
      }
    });
  }
  const r = ymd_(patch.Receipt_Date), a = ymd_(patch.Approved_On), s = ymd_(patch.Assigned_On);
  if (a && a > today) throw new Error('The MRF approved date cannot be in the future.');
  if (s && s > today) throw new Error('The position assigned date cannot be in the future.');
  if (a && r && a < r) throw new Error('The MRF approved date cannot be before the MRF received date.');
  if (s && a && s < a) throw new Error('The position assigned date cannot be before the MRF approved date.');
}

/** Adds N identical lines for a multi-position MRF (the tracker keeps one row per resource). */
function apiAddPositionLines(data, count) {
  count = Math.min(Math.max(Number(count) || 1, 1), 50);
  const out = [];
  for (let i = 0; i < count; i++) {
    const copy = Object.assign({}, data, { Line_ID: '', No_Of_Positions: 1 });
    out.push(apiSavePosition(copy));
  }
  return out;
}

/* ---------------- Daily funnel ---------------- */

/** Recruiters can change an entry only on the day they saved it; the head and admin can always correct it. */
function canEditEntry_(u, r) {
  return isLead_(u) || (String(r.Created_By).toLowerCase() === u.email && ymd_(r.Created_At) === (u.today || (u.today = ymd_(new Date()))));
}

function apiListFunnel(filter) {
  const u = currentUser_();
  filter = filter || {};
  const from = filter.from || '', to = filter.to || '9999-12-31';
  const today = ymd_(new Date());
  const src = filter.lineId ? readTable_(T.FUNNEL.name) : readTableFrom_(T.FUNNEL.name, 'Entry_Date', from);
  return src.rows.filter(function (r) {
    const d = ymd_(r.Entry_Date);
    if (filter.lineId && r.Line_ID !== filter.lineId) return false;
    if (filter.recruiter && String(r.Recruiter) !== filter.recruiter) return false;
    if (filter.mine && String(r.Created_By).toLowerCase() !== u.email) return false;
    return (!from || d >= from) && d <= to;
  }).map(function (r) { const o = toClient_(r); delete o._row; o.canEdit = canEditEntry_(u, r); return o; })
    .sort(function (a, b) { return a.Entry_Date < b.Entry_Date ? 1 : -1; });
}

function apiSaveFunnel(data) {
  const u = currentUser_();
  const patch = prepare_(T.FUNNEL, data);
  const line = readTable_(T.MRF.name).rows.filter(function (l) { return l.Line_ID === patch.Line_ID; })[0];
  if (!line) throw new Error('Pick the position this activity is for.');
  if (!patch.Entry_Date) throw new Error('Pick the activity date.');
  if (ymd_(patch.Entry_Date) > ymd_(new Date())) throw new Error('The activity date cannot be in the future.');
  FUNNEL_METRICS.forEach(function (m) {
    const n = Number(patch[m] || 0);
    if (isNaN(n) || n < 0 || n % 1) throw new Error(m.replace(/_/g, ' ') + ' must be a whole number, 0 or more.');
    patch[m] = n;
  });
  if (scorecardDerived_(ymd_(patch.Entry_Date)) && FUNNEL_METRICS.some(function (m) { return TYPED_METRICS_.indexOf(m) < 0 && patch[m] > 0; })) {
    throw new Error('From ' + cutover_() + ', HR 1st round, shared, shortlisted, interviews and selected are counted from the candidate pipeline. Enter only CVs sourced and CVs reviewed here.');
  }
  if (!FUNNEL_METRICS.some(function (m) { return patch[m] > 0; }) && !patch.Remarks && !patch.FB_From_Dept) throw new Error('Enter at least one count or a remark.');
  patch.MRF_No = line.MRF_No;
  let rec;
  if (data.Entry_ID) {
    rec = update_(T.FUNNEL, data.Entry_ID, patch, u, function (old) {
      if (!isLead_(u) && String(old.Created_By).toLowerCase() !== u.email) throw new Error('You can only edit entries you logged.');
      if (!canEditEntry_(u, old)) throw new Error('This entry was saved on ' + (old.Created_At instanceof Date ? fmt_(old.Created_At, TZ, 'd MMM yyyy') : String(old.Created_At || 'an earlier day')) + '. Entries can be changed only on the day they are saved. Ask a TA Lead or the Head of HR to correct it.');
    });
  } else {
    patch.Recruiter = u.recruiter;
    rec = insert_(T.FUNNEL, patch, u);
  }
  const o = toClient_(rec); delete o._row;
  return o;
}

/* ---------------- Candidates ---------------- */

const CAND_LIST_FIELDS = ['Candidate_ID', 'Name', 'Position', 'Dept', 'Mobile', 'Email', 'Relevant_Experience', 'Current_CTC',
  'Tech_Result', 'HR_Result', 'CV_Box', 'Sourced_By', 'Source_Channel', 'DOJ', 'Line_ID', 'Possible_Duplicate_Of', 'Created_At', 'CV_File_URL'];

function apiListCandidates() {
  currentUser_();
  return readTable_(T.CAND.name).rows.map(function (r) {
    const o = {};
    CAND_LIST_FIELDS.forEach(function (k) { o[k] = r[k]; });
    return toClient_(o);
  });
}

function apiGetCandidate(id) {
  currentUser_();
  const r = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === id; })[0];
  if (!r) {
    const a = archivedById_(id);
    if (a) return { Candidate_ID: a.id, Name: a.name, Mobile: a.mobile, Email: a.email, Position: a.position, Dept: a.dept, Relevant_Experience: a.exp,
      Current_Designation: a.designation, HR_Result: a.hr, Sourced_By: a.src, CV_File_URL: a.cv, Last_Activity: a.last, Archived_On: a.on, _archived: 'Yes' };
    throw new Error('Candidate ' + id + ' was not found.');
  }
  const o = toClient_(r); delete o._row; return o;
}

function normPhone_(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
  if (d.length === 11 && d[0] === '0') d = d.slice(1);
  return d;
}

function apiSaveCandidate(data, force) {
  const u = currentUser_();
  const patch = prepare_(T.CAND, data);
  if (!patch.Name) throw new Error('Candidate name is required.');
  if (patch.Mobile) {
    patch.Mobile = normPhone_(patch.Mobile);
    if (patch.Mobile.length !== 10) throw new Error('Mobile number must have 10 digits.');
  }
  if (patch.Email) {
    patch.Email = String(patch.Email).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(patch.Email)) throw new Error('That email address does not look right.');
  }
  if (!force) {
    const dups = readTable_(T.CAND.name).rows.filter(function (r) {
      if (r.Candidate_ID === data.Candidate_ID) return false;
      return (patch.Mobile && normPhone_(r.Mobile) === patch.Mobile) || (patch.Email && String(r.Email).toLowerCase() === patch.Email);
    }).map(function (r) { return { id: r.Candidate_ID, name: r.Name, position: r.Position, hr: r.HR_Result }; });
    archiveIndex_().forEach(function (a) {
      if (a.id === data.Candidate_ID) return;
      if ((patch.Mobile && a.mobile === patch.Mobile) || (patch.Email && a.email === patch.Email)) dups.push({ id: a.id, name: a.name, position: a.position, hr: a.hr, archived: true, last: a.last });
    });
    if (dups.length) return { duplicates: dups };
  }
  const rec = data.Candidate_ID ? update_(T.CAND, data.Candidate_ID, patch, u) : insert_(T.CAND, Object.assign({ Sourced_By: u.recruiter }, patch), u);
  if (rec.Line_ID) ensureApp_(rec, u);
  if (data._parsed && typeof data._parsed === 'object') {
    const saved = {}; PARSE_FIELDS_.forEach(function (k) { saved[k] = rec[k] instanceof Date ? ymd_(rec[k]) : rec[k]; });
    logParse_(rec.Candidate_ID, data._parsed, saved, data._parseFile, data._parseChars, u);
  }
  const o = toClient_(rec); delete o._row;
  return { saved: o };
}

/** Saves a CV into the CV folder and links it to the candidate. Max ~10 MB per file. */
function apiUploadCv(candidateId, fileName, mimeType, base64) {
  const u = currentUser_();
  const folderId = settings_().CV_FOLDER_ID;
  if (!folderId) throw new Error('CV folder is not set. Ask the admin to run setup().');
  const cand = readTable_(T.CAND.name).rows.filter(function (r) { return r.Candidate_ID === candidateId; })[0];
  if (!cand) throw new Error('Save the candidate before uploading a CV.');
  const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];
  if (allowed.indexOf(mimeType) < 0) throw new Error('Upload the CV as PDF, Word, JPG or PNG.');
  const ext = (fileName.match(/\.[a-z0-9]+$/i) || [''])[0];
  const safeName = candidateId + '_' + String(cand.Name).replace(/[^\w]+/g, '_') + '_' + fmt_(new Date(), TZ, 'yyyyMMdd') + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, safeName);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  update_(T.CAND, candidateId, { CV_File_URL: file.getUrl() }, u);
  return file.getUrl();
}

function cvFileId_(url) {
  const m = String(url || '').match(/\/d\/([\w-]{20,})/) || String(url || '').match(/[?&]id=([\w-]{20,})/);
  return m ? m[1] : '';
}

/**
 * Returns the candidate's CV as base64 so the app can show it inside the page.
 * The file is read with the signed-in user's own Drive access, so it works no
 * matter which Google account the browser opens Drive links with.
 */
function apiGetCv(candidateId) {
  currentUser_();
  const cand = readTable_(T.CAND.name).rows.filter(function (r) { return r.Candidate_ID === candidateId; })[0];
  if (!cand || !cand.CV_File_URL) throw new Error('No CV has been uploaded for this candidate yet.');
  const id = cvFileId_(cand.CV_File_URL);
  if (!id) throw new Error('The CV link on this record is not a Google Drive file link.');
  let file;
  try { file = DriveApp.getFileById(id); }
  catch (e) { throw new Error('You do not have access to this CV file. Ask the CRM admin to run shareWithTeam.'); }
  const blob = file.getBlob();
  if (blob.getBytes().length > 15 * 1024 * 1024) throw new Error('This CV is larger than 15 MB. Open it from Drive instead.');
  return { name: file.getName(), mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()), url: file.getUrl() };
}

/* ---------------- Panel availability ---------------- */

function apiListPanel() {
  currentUser_(); ensureSchema_();
  return readTable_(T.PANEL.name).rows.map(function (r) {
    const o = toClient_(r); delete o._row;
    o.Kind = panelKind_(r); o.To_Date = ymd_(r.To_Date) || o.Date;
    o.Days = o.Kind === 'Full days' && o.Date ? daysBetween_(o.Date, o.To_Date) + 1 : 1;
    return o;
  }).sort(function (a, b) { return a.Date < b.Date ? 1 : -1; });
}

/** Full days (leave, one or more days) or part of a day (a time slot). Older entries with a time are part of a day. */
function panelKind_(r) { return String(r.Kind || '') || ((r.From_Time || r.To_Time) ? 'Part of a day' : 'Full days'); }
function hhmm_(v) { if (v instanceof Date) return fmt_(v, TZ, 'HH:mm'); const m = String(v || '').match(/(\d{1,2}):(\d{2})/); return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : ''; }

function apiSavePanel(data) {
  const u = currentUser_(); ensureSchema_();
  const patch = prepare_(T.PANEL, data);
  if (!patch.Panel_Member || !patch.Date) throw new Error('Panel member and date are required.');
  patch.Kind = data.Kind === 'Part of a day' ? 'Part of a day' : 'Full days';
  if (patch.Kind === 'Full days') {
    if (!patch.To_Date) patch.To_Date = patch.Date;
    if (ymd_(patch.To_Date) < ymd_(patch.Date)) throw new Error('The last day cannot be before the first day.');
    if (daysBetween_(ymd_(patch.Date), ymd_(patch.To_Date)) > 90) throw new Error('One entry can cover at most 90 days. Add another entry for a longer absence.');
    patch.From_Time = ''; patch.To_Time = '';
  } else {
    patch.To_Date = patch.Date;
    const f = hhmm_(patch.From_Time), t = hhmm_(patch.To_Time);
    if (f && t && t <= f) throw new Error('The end time must be after the start time.');
  }
  const rec = data.Entry_ID ? update_(T.PANEL, data.Entry_ID, patch, u) : insert_(T.PANEL, patch, u);
  const o = toClient_(rec); delete o._row; return o;
}

/**
 * Panel members who are logged as unavailable on a date (and, for part-day entries, at an overlapping time).
 * names: panel member names; start/end: 'HH:mm' (optional).
 */
function panelConflicts_(names, date, start, end) {
  const want = {}; names.forEach(function (n) { want[panelKey_(n)] = n; });
  const out = [];
  readTable_(T.PANEL.name).rows.forEach(function (r) {
    if (String(r.Availability_Status || 'Unavailable') !== 'Unavailable') return;
    const who = want[panelKey_(r.Panel_Member)]; if (!who) return;
    const from = ymd_(r.Date), to = ymd_(r.To_Date) || from, kind = panelKind_(r);
    if (!from || date < from || date > to) return;
    if (kind === 'Part of a day' && start) {
      const f = hhmm_(r.From_Time), t = hhmm_(r.To_Time);
      if (f && t && !(start < t && (end || start) > f)) return;
    }
    out.push({ member: who, from: from, to: to, kind: kind, time: kind === 'Part of a day' ? (hhmm_(r.From_Time) + (r.To_Time ? '\u2013' + hhmm_(r.To_Time) : '')) : '', reason: String(r.Reason || '') });
  });
  return out;
}
function panelConflictText_(c) {
  const d = function (x) { return fmt_(parseYmd_(x), TZ, 'd MMM'); };
  return c.member + ' is unavailable ' + (c.kind === 'Full days' ? (c.from === c.to ? 'on ' + d(c.from) : 'from ' + d(c.from) + ' to ' + d(c.to)) : 'on ' + d(c.from) + (c.time ? ' (' + c.time + ')' : '')) + (c.reason ? ': ' + c.reason : '');
}

/* ---------------- Dashboard ---------------- */

/** Full dashboard calculation. Called only by the snapshot builder in Dashboard.gs, never on page load. */
function computeDashboard_() {
  const ctx = tatContext_();
  const lines = readTable_(T.MRF.name).rows.map(function (l) { return orgTat_(Object.assign({}, l, computeTat_(l, ctx))); });
  const today = ctx.today, monthKey = today.slice(0, 7);
  const since30 = fmt_(new Date(Date.now() - 30 * 86400000), TZ, 'yyyy-MM-dd');
  const since180 = fmt_(new Date(Date.now() - 180 * 86400000), TZ, 'yyyy-MM-dd');

  const k = { open: 0, offered: 0, overdue: 0, atRisk: 0, joinedMonth: 0, achieved180: 0, closed180: 0, backouts180: 0 };
  const byRec = {};
  lines.forEach(function (l) {
    const s = l.Position_Status, r = String(l.Recruiter || 'Unassigned');
    const b = byRec[r] = byRec[r] || { recruiter: r, open: 0, offered: 0, overdue: 0, joined30: 0, cv30: 0, interviews30: 0, selected30: 0 };
    if (s === 'Open') { k.open++; b.open++; }
    if (s === 'Offered') { k.offered++; b.offered++; }
    if (l.TAT_Result === 'Overdue') { k.overdue++; b.overdue++; }
    if (l.TAT_Result === 'At risk') k.atRisk++;
    const doj = ymd_(l.Actual_DOJ);
    if (doj && doj.slice(0, 7) === monthKey) k.joinedMonth++;
    if (doj && doj >= since30) b.joined30++;
    const end = ymd_(l.TAT_End_Date);
    if (s === 'Closed' && end >= since180) { k.closed180++; if (l.TAT_Result === 'Achieved') k.achieved180++; }
    if (ymd_(l.Backout_Date) >= since180) k.backouts180++;
  });

  const funnel = { CV_Sourced: 0, CV_Reviewed: 0, HR_1st_Round: 0, CV_Shared_Dept: 0, Shortlisted_Dept: 0, Interviews_Done: 0, Selected_Final: 0 };
  const cut = cutover_(), todayYmd = ymd_(new Date());
  readTable_(T.FUNNEL.name).rows.forEach(function (f) {
    const day = ymd_(f.Entry_Date);
    if (day < since30) return;
    const typedOnly = day >= cut;
    FUNNEL_METRICS.forEach(function (m) { if (!typedOnly || TYPED_METRICS_.indexOf(m) >= 0) funnel[m] += Number(f[m]) || 0; });
    const b = byRec[String(f.Recruiter)];
    if (b) { b.cv30 += Number(f.CV_Sourced) || 0; if (!typedOnly) { b.interviews30 += Number(f.Interviews_Done) || 0; b.selected30 += Number(f.Selected_Final) || 0; } }
  });
  if (todayYmd >= cut) {
    pipelineEvents_(since30 > cut ? since30 : cut, todayYmd).forEach(function (ev) {
      if (funnel[ev.metric] !== undefined) funnel[ev.metric]++;
      const b = byRec[ev.recruiter];
      if (b && ev.metric === 'Interviews_Done') b.interviews30++;
      if (b && ev.metric === 'Selected_Final') b.selected30++;
    });
  }

  const watch = lines.filter(function (l) { return l.Position_Status === 'Open' || l.Position_Status === 'Offered'; })
    .map(function (l) {
      return toClient_({ Line_ID: l.Line_ID, MRF_No: l.MRF_No, Position: l.Position, Grade: l.Grade, Dept: l.Dept, Recruiter: l.Recruiter,
        Position_Status: l.Position_Status, Days_Taken: l.Days_Taken, Final_TAT: l.Final_TAT, TAT_Result: l.TAT_Result, EDOJ: l.EDOJ });
    })
    .sort(function (a, b) { return (b.Days_Taken / b.Final_TAT) - (a.Days_Taken / a.Final_TAT); });

  return {
    kpi: k,
    tatPct: k.closed180 ? Math.round(100 * k.achieved180 / k.closed180) : null,
    funnel: funnel,
    recruiters: Object.keys(byRec).map(function (r) { return byRec[r]; })
      .filter(function (b) { return b.open + b.offered + b.joined30 + b.cv30 > 0; })
      .sort(function (a, b) { return (b.open + b.offered) - (a.open + a.offered); }),
    watch: watch.slice(0, 12)
  };
}

/* ---------------- Admin ---------------- */

/** Rewrites stored TAT columns for every line (also runs nightly). */
function apiRecomputeAll() {
  requireAdmin_(currentUser_());
  dropTableCache_(); _tables = {};
  if (typeof daySnapDropAll_ === 'function') daySnapDropAll_();
  return recomputeAllTat_();
}

function recomputeAllTat_() {
  return withLock_(function () {
    const t = readTable_(T.MRF.name, true);
    const ctx = tatContext_();
    const cols = ['Position_Status', 'Standard_TAT', 'Exemption_Days', 'Final_TAT', 'TAT_End_Date', 'Days_Taken', 'TAT_Result'];
    const idx = cols.map(function (c) { return t.headers.indexOf(c); });
    const first = Math.min.apply(null, idx), last = Math.max.apply(null, idx);
    const range = t.sheet.getRange(2, first + 1, t.sheet.getLastRow() - 1, last - first + 1);
    const block = range.getValues();
    const byRow = {};
    t.rows.forEach(function (l) { byRow[l._row] = l; });
    block.forEach(function (rowVals, i) {
      const l = byRow[i + 2]; if (!l) return;
      const c = computeTat_(l, ctx);
      cols.forEach(function (col, j) { rowVals[idx[j] - first] = c[col]; });
    });
    range.setValues(block);
    dropStale_(T.MRF.name);
    return t.rows.length;
  });
}

/** Nightly job installed by setup(): keeps TAT columns in the sheet current for anyone reading it directly. */
function nightlyJob() {
  try { backupDb_(); } catch (e) { console.error('Backup failed: ' + e); }
  recomputeAllTat_();
  _tables = {};
  buildSnapshot_('nightly refresh');
}
