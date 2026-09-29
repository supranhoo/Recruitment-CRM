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
    grades: readTable_('M_Grades').rows.map(function (r) { return { grade: String(r.Grade), designations: String(r.Designations), band: String(r.Band), tat: Number(r.Standard_TAT_Days) }; }),
    panel: panelMembers_(false),
    recruiters: readTable_('M_Recruiters').rows.filter(function (r) { return String(r.Active) !== 'No'; }).map(function (r) { return String(r.Recruiter); }),
    lists: lists,
    dbUrl: u.role === ROLES.ADMIN ? ss_().getUrl() : ''
  };
}

/* ---------------- Positions (MRF lines) ---------------- */

function apiListPositions() {
  const u = currentUser_();
  const ctx = tatContext_();
  return readTable_(T.MRF.name).rows.map(function (l) {
    const c = computeTat_(l, ctx);
    Object.keys(c).forEach(function (k) { l[k] = c[k]; });
    const o = toClient_(l);
    o._canEdit = canEditLine_(u, l);
    delete o._row;
    return o;
  });
}

function apiSavePosition(data) {
  const u = currentUser_();
  const ctx = tatContext_();
  const patch = prepare_(T.MRF, data);
  if (!patch.Position || !patch.Grade || !patch.Dept || !patch.Receipt_Date) throw new Error('Position, grade, department and MRF receipt date are required.');
  checkConfirmDates_(patch);
  const old = data.Line_ID ? readTable_(T.MRF.name).rows.filter(function (l) { return l.Line_ID === data.Line_ID; })[0] : null;
  assignDates_(patch, old, u);
  if (patch.Approval_Status === 'No Vacancy' && !patch.No_Vacancy_Date) throw new Error('Add the date the position was marked No Vacancy.');
  if ((patch.Approval_Status === 'Not Needed' || patch.Approval_Status === 'On Hold') && !patch.Not_Needed_Date) throw new Error('Add the date the position was marked ' + patch.Approval_Status + '.');
  if (patch.Actual_DOJ && String(patch.Offer_Sent).toUpperCase() !== 'YES') throw new Error('Set Offer sent to Yes before entering the actual joining date.');
  const c = computeTat_(patch, ctx);
  Object.keys(c).forEach(function (k) { patch[k] = c[k]; });
  let rec;
  if (data.Line_ID) {
    rec = update_(T.MRF, data.Line_ID, patch, u, function (old) {
      if (!canEditLine_(u, old)) throw new Error('This position is assigned to ' + old.Recruiter + '. Only they or the recruitment head can edit it.');
    });
  } else {
    if (!isLead_(u)) patch.Recruiter = u.recruiter;
    rec = insert_(T.MRF, patch, u);
  }
  const o = toClient_(rec); o._canEdit = true; delete o._row;
  return o;
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
        throw new Error(f[1] + ' is already set to ' + was + '. Only the recruitment head or admin can change it.');
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
  return isLead_(u) || (String(r.Created_By).toLowerCase() === u.email && ymd_(r.Created_At) === ymd_(new Date()));
}

function apiListFunnel(filter) {
  const u = currentUser_();
  filter = filter || {};
  const from = filter.from || '', to = filter.to || '9999-12-31';
  return readTable_(T.FUNNEL.name).rows.filter(function (r) {
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
  if (!FUNNEL_METRICS.some(function (m) { return patch[m] > 0; }) && !patch.Remarks && !patch.FB_From_Dept) throw new Error('Enter at least one count or a remark.');
  patch.MRF_No = line.MRF_No;
  let rec;
  if (data.Entry_ID) {
    rec = update_(T.FUNNEL, data.Entry_ID, patch, u, function (old) {
      if (!isLead_(u) && String(old.Created_By).toLowerCase() !== u.email) throw new Error('You can only edit entries you logged.');
      if (!canEditEntry_(u, old)) throw new Error('This entry was saved on ' + (old.Created_At instanceof Date ? Utilities.formatDate(old.Created_At, TZ, 'd MMM yyyy') : String(old.Created_At || 'an earlier day')) + '. Entries can be changed only on the day they are saved. Ask the recruitment head to correct it.');
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
  if (!r) throw new Error('Candidate ' + id + ' was not found.');
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
    if (dups.length) return { duplicates: dups };
  }
  const rec = data.Candidate_ID ? update_(T.CAND, data.Candidate_ID, patch, u) : insert_(T.CAND, Object.assign({ Sourced_By: u.recruiter }, patch), u);
  if (rec.Line_ID) ensureApp_(rec, u);
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
  const safeName = candidateId + '_' + String(cand.Name).replace(/[^\w]+/g, '_') + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd') + ext;
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
  currentUser_();
  return readTable_(T.PANEL.name).rows.map(function (r) { const o = toClient_(r); delete o._row; return o; })
    .sort(function (a, b) { return a.Date < b.Date ? 1 : -1; });
}

function apiSavePanel(data) {
  const u = currentUser_();
  const patch = prepare_(T.PANEL, data);
  if (!patch.Panel_Member || !patch.Date) throw new Error('Panel member and date are required.');
  const rec = data.Entry_ID ? update_(T.PANEL, data.Entry_ID, patch, u) : insert_(T.PANEL, patch, u);
  const o = toClient_(rec); delete o._row; return o;
}

/* ---------------- Dashboard ---------------- */

/** Full dashboard calculation. Called only by the snapshot builder in Dashboard.gs, never on page load. */
function computeDashboard_() {
  const ctx = tatContext_();
  const lines = readTable_(T.MRF.name).rows.map(function (l) { return Object.assign({}, l, computeTat_(l, ctx)); });
  const today = ctx.today, monthKey = today.slice(0, 7);
  const since30 = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), TZ, 'yyyy-MM-dd');
  const since180 = Utilities.formatDate(new Date(Date.now() - 180 * 86400000), TZ, 'yyyy-MM-dd');

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
  readTable_(T.FUNNEL.name).rows.forEach(function (f) {
    if (ymd_(f.Entry_Date) < since30) return;
    FUNNEL_METRICS.forEach(function (m) { funnel[m] += Number(f[m]) || 0; });
    const b = byRec[String(f.Recruiter)];
    if (b) { b.cv30 += Number(f.CV_Sourced) || 0; b.interviews30 += Number(f.Interviews_Done) || 0; b.selected30 += Number(f.Selected_Final) || 0; }
  });

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
