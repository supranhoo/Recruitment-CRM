/**
 * Stage 3: data capture for the compliance KPIs.
 * - Psychometric (Mettl) test fields on Candidates
 * - Background verification fields on MRF positions
 * - Observations log (MRF & assessment process adherence)
 * - Monthly 20% audit sample (tracker accuracy)
 */
const SCHEMA_VERSION = '38';
const OBS_TYPES = ['Hiring started before MRF approval', 'MRF incomplete (JD / KRA / budget / grade)', 'Candidate evaluation form missing',
  'Interview panel not as per policy matrix', 'Offer issued without required approval', 'Other'];

/** Adds new columns/sheets once. Cheap after the first run (one property read). */
function ensureSchema_() {
  const props = PropertiesService.getScriptProperties();
  if (Number(props.getProperty('SCHEMA_V')) >= Number(SCHEMA_VERSION)) return;
  withLock_(function () {
    if (Number(props.getProperty('SCHEMA_V')) >= Number(SCHEMA_VERSION)) return;
    addColumns_(T.MRF.name, ['BGV_Required', 'BGV_Prev_Org_Date', 'BGV_Current_Org_Date', 'BGV_Remarks', 'BGV_Prev_Org_File', 'BGV_Current_Org_File',
      'Tech_Panel', 'Final_Panel']);
    seedPanelMembers_();
    addColumns_(T.FUNNEL.name, ['CV_Reviewed']);
    pipelineSchema_();
    addColumns_(T.MRF.name, ['JD_Confirmed_Date', 'SQ_Confirmed_Date']);
    try { jdMigrate_(); } catch (e) { console.error('JD folder setup failed: ' + e); }
    addColumns_(T.MRF.name, ['Approved_On', 'Assigned_On']);
    tasksSchema_();
    addColumns_(T.MRF.name, ['Parent_Line_ID', 'Replaced_By', 'Replaced_On', 'TAT_Start_From']);
    addColumns_(T.APP.name, ['Offer_Date', 'EDOJ', 'Actual_DOJ', 'Backout_Date', 'Backout_Reason']);
    reconcileSchema_();
    closureSchema_();
    addColumns_(T.PANEL.name, ['To_Date', 'Kind']);
    archiveSchema_();
    poolSchema_();
    parseSchema_();
    usersSchema_();
    tatSchema_();
    jdmSchema_();
    pdocSchema_();
    scrSchema_();
    gradeDesigMigrate_();
    gradeDesigSchema_();
    exemptSchema_();
    ctcSchema_();
    bgvSchema_();
    profileSchema_();
    voiceSchema_();
    orgSchema_();
    try { bgvEnsureCases_(); } catch (e) { console.error('BGV cases: ' + e); }
    dayStatusSchema_();
    addSheet_('Daily_Summary', ['Summary_ID', 'Summary_Date', 'Recruiter', 'Overview', 'Tasks_JSON',
      'Created_By', 'Created_At', 'Updated_By', 'Updated_At']);
    addColumns_(T.CAND.name, ['Psychometric_Status', 'Psychometric_Date', 'Psychometric_Score', 'Psychometric_Report', 'Psychometric_File']);
    addSheet_('Observations', ['Obs_ID', 'Obs_Date', 'Line_ID', 'MRF_No', 'Recruiter', 'Type', 'Description', 'Status',
      'Created_By', 'Created_At', 'Updated_By', 'Updated_At']);
    addSheet_('Audit_Checks', ['Audit_ID', 'Month', 'Entity', 'Record_ID', 'Label', 'Recruiter', 'Result', 'Error_Field', 'Critical',
      'Remarks', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At']);
    const s = readTable_('Settings', true);
    if (!s.rows.some(function (r) { return r.Key === 'KPI_CAPTURE_FROM'; })) {
      const next = new Date(); next.setDate(1); next.setMonth(next.getMonth() + 1);
      s.sheet.appendRow(['KPI_CAPTURE_FROM', "'" + fmt_(next, TZ, 'yyyy-MM'),
        'First month scored for psychometric, BGV, observation and audit KPIs']);
    }
    props.setProperty('SCHEMA_V', SCHEMA_VERSION);
    dropTableCache_();
    _tables = {};
  });
}

function addColumns_(name, cols) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const missing = cols.filter(function (c) { return headers.indexOf(c) < 0; });
  if (!missing.length) return;
  if (sh.getMaxColumns() < headers.length + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length + missing.length - sh.getMaxColumns());
  sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
}

function addSheet_(name, headers) {
  if (ss_().getSheetByName(name)) return;
  const sh = ss_().insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
  sh.setFrozenRows(1);
}

/** Manager & above = grades M1–M4; for records without a grade, judge by designation. */
function managerPlus_(grade, designation) {
  const g = String(grade || '').trim().toUpperCase();
  if (/^M[1-7]$/.test(g)) return /^M[1-4]$/.test(g);
  const d = String(designation || '').toLowerCase();
  if (!d) return false;
  if (/(assistant|asst\.?|deputy|dy\.?|junior|jr\.?)\s*manager/.test(d)) return false;
  return /manager|\bagm\b|\bdgm\b|\bgm\b|general manager|\bvp\b|vice president|president|\bhead\b|director/.test(d);
}

/* ---------------- Observations ---------------- */

function apiListObservations(filter) {
  currentUser_(); ensureSchema_();
  filter = filter || {};
  return readTable_('Observations').rows.filter(function (r) {
    const m = ymd_(r.Obs_Date).slice(0, 7);
    if (filter.month && m !== filter.month) return false;
    if (filter.recruiter && String(r.Recruiter) !== filter.recruiter) return false;
    return true;
  }).map(function (r) { const o = toClient_(r); delete o._row; return o; })
    .sort(function (a, b) { return a.Obs_Date < b.Obs_Date ? 1 : -1; });
}

function apiSaveObservation(data) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can log observations.');
  const patch = prepare_(T.OBS, data);
  if (!patch.Obs_Date || !patch.Type) throw new Error('Date and observation type are required.');
  if (patch.Line_ID) {
    const line = readTable_(T.MRF.name).rows.filter(function (l) { return l.Line_ID === patch.Line_ID; })[0];
    if (line) { patch.MRF_No = line.MRF_No; if (!patch.Recruiter) patch.Recruiter = line.Recruiter; }
  }
  if (!patch.Recruiter) throw new Error('Pick the recruiter this observation is against, or link a position.');
  if (!patch.Status) patch.Status = 'Open';
  const rec = data.Obs_ID ? update_(T.OBS, data.Obs_ID, patch, u) : insert_(T.OBS, patch, u);
  const o = toClient_(rec); delete o._row; return o;
}

/* ---------------- Monthly 20% audit ---------------- */

function apiAuditList(month) {
  currentUser_(); ensureSchema_();
  return readTable_('Audit_Checks').rows.filter(function (r) { return String(r.Month) === month; })
    .map(function (r) { const o = toClient_(r); delete o._row; return o; });
}

/** Picks a random 20% of the MRF lines and candidates added or changed in the month. */
function apiAuditGenerate(month) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can create the audit sample.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Pick a month.');
  if (readTable_('Audit_Checks').rows.some(function (r) { return String(r.Month) === month; })) throw new Error('A sample for ' + month + ' already exists.');
  // Records a person added or edited that month (the one-time migration does not count).
  const touched = function (r) {
    const made = ymd_(r.Created_At).slice(0, 7) === month && String(r.Created_By) !== 'migration';
    const edited = ymd_(r.Updated_At).slice(0, 7) === month && String(r.Updated_By) !== 'migration';
    return made || edited;
  };
  const pool = [];
  readTable_(T.MRF.name).rows.filter(touched).forEach(function (l) {
    pool.push({ Entity: 'MRF position', Record_ID: l.Line_ID, Label: String(l.MRF_No) + ' · ' + l.Position, Recruiter: l.Recruiter });
  });
  readTable_(T.CAND.name).rows.filter(touched).forEach(function (c) {
    pool.push({ Entity: 'Candidate', Record_ID: c.Candidate_ID, Label: c.Name + ' · ' + c.Position, Recruiter: c.Sourced_By });
  });
  if (!pool.length) throw new Error('No positions or candidates were added or changed in ' + month + '.');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  const pick = pool.slice(0, Math.max(1, Math.ceil(pool.length * 0.2)));
  return withLock_(function () {
    const t = readTable_('Audit_Checks', true);
    let n = 0;
    t.rows.forEach(function (r) { const m = String(r.Audit_ID).match(/(\d+)$/); if (m) n = Math.max(n, +m[1]); });
    const now = new Date();
    const rows = pick.map(function (p) {
      n++;
      const o = Object.assign({ Audit_ID: 'AUD-' + String(n).padStart(5, '0'), Month: month, Result: 'Pending', Error_Field: '', Critical: '',
        Remarks: '', Created_By: u.email, Created_At: now, Updated_By: '', Updated_At: '' }, p);
      return t.headers.map(function (h) { return o[h] === undefined ? '' : clean_(o[h]); });
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
    audit_(u, 'Audit_Checks', month, 'Create sample', 'rows', '', String(rows.length) + ' of ' + pool.length);
    markDashDirty_('Audit_Checks');
    dropStale_('Audit_Checks');
    return { sampled: rows.length, population: pool.length };
  });
}

function apiAuditSave(data) {
  const u = currentUser_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can record audit results.');
  const patch = prepare_(T.AUDIT, data);
  if (['Pending', 'Correct', 'Error'].indexOf(patch.Result) < 0) throw new Error('Result must be Correct or Error.');
  if (patch.Result === 'Error' && !patch.Error_Field) throw new Error('Say which field was wrong.');
  patch.Critical = patch.Result === 'Error' && /mrf date|receipt|closing|doj|joining/i.test(String(patch.Error_Field)) ? 'Yes' : '';
  const rec = update_(T.AUDIT, data.Audit_ID, patch, u);
  const o = toClient_(rec); delete o._row; return o;
}

/* ---------------- Supporting attachments (BGV, psychometric) ---------------- */

const DOC_FIELDS = {
  MRF: { BGV_Prev_Org_File: 'BGV_Prev', BGV_Current_Org_File: 'BGV_Current', JD_File: 'JD', MRF_Form_File: 'MRF_Form', Notice_Proof_File: 'Notice_Proof' },
  TEX: { Proof_File: 'Exemption_Proof' },
  APP: { Docs_File: 'Joining_Docs', Offer_Letter_File: 'Offer_Letter' },
  CAND: { Psychometric_File: 'Psychometric' },
  BGV: { Consent_File: 'BGV_Consent', Report_File: 'BGV_Report', Initiation_Proof_File: 'BGV_Initiation' }
};
const DOC_FOLDERS = { MRF: 'Position documents', CAND: 'Psychometric reports', APP: 'Joining documents', TEX: 'TAT exemption proofs', BGV: 'BGV documents' };
const DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'];

function docTarget_(entity, id, field) {
  const def = entity === 'MRF' ? T.MRF : entity === 'CAND' ? T.CAND : entity === 'APP' ? T.APP : entity === 'TEX' ? T.TEX : entity === 'BGV' ? BGV_CASES_ : null;
  if (!def || !DOC_FIELDS[entity][field]) throw new Error('Unknown attachment type.');
  const rec = readTable_(def.name).rows.filter(function (r) { return String(r[def.id]) === String(id); })[0];
  if (!rec) throw new Error('Save the record before attaching a file.');
  return { def: def, rec: rec };
}

function docFolder_(entity) {
  const root = settings_().CV_FOLDER_ID;
  if (!root) throw new Error('The documents folder is not set. Ask the admin to run setup().');
  const parent = DriveApp.getFolderById(root);
  const it = parent.getFoldersByName(DOC_FOLDERS[entity]);
  return it.hasNext() ? it.next() : parent.createFolder(DOC_FOLDERS[entity]);
}

/** Uploads a supporting document and links it on the position or candidate. */
function apiUploadDoc(entity, id, field, fileName, mimeType, base64) {
  const u = currentUser_(); ensureSchema_();
  const t = docTarget_(entity, id, field);
  if (entity === 'MRF' && !canEditLine_(u, t.rec)) throw new Error('Only ' + t.rec.Recruiter + ' or a TA Lead or the Head of HR can attach files to this position.');
  if (entity === 'APP') { const l = lineOf_(t.rec.Line_ID); if (l && !canEditLine_(u, l)) throw new Error('Only ' + l.Recruiter + ' or a TA Lead or the Head of HR can attach files for this position.'); }
  if (entity === 'TEX') {
    const l = lineOf_(t.rec.Line_ID);
    if (l && !canEditLine_(u, l) && !can_(u, 'tat_exempt')) throw new Error('Only ' + l.Recruiter + ', a TA Lead or the Head of HR can attach proof for this exemption.');
    if (['Pending', 'Approved'].indexOf(String(t.rec.Status)) < 0) throw new Error('Proof can be attached only to a pending or approved exemption.');
  }
  if (entity === 'BGV') { bgvRequireWork_(u, t.rec); if (t.rec.Purged_On) throw new Error('This case was purged under the retention rule. Files cannot be added.'); }
  if (DOC_TYPES.indexOf(mimeType) < 0) throw new Error('Attach the file as PDF, Word, JPG or PNG.');
  const ext = (String(fileName).match(/\.[a-z0-9]+$/i) || [''])[0];
  const isJd = entity === 'MRF' && field === 'JD_File';
  const folder = isJd ? jdFolder_() : entity === 'BGV' ? bgvUploadFolder_(t.rec) : docFolder_(entity);
  let name = isJd ? jdName_(t.rec, ext) : id + '_' + DOC_FIELDS[entity][field] + '_' + fmt_(new Date(), TZ, 'yyyyMMdd') + ext;
  if (isJd && folder.getFilesByName(name).hasNext()) name = name.slice(0, name.length - ext.length) + ' - ' + fmt_(new Date(), TZ, 'yyyy-MM-dd HHmm') + ext;
  const file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), mimeType, name));
  const patch = {}; patch[field] = file.getUrl();
  update_(t.def, id, patch, u);
  if (isJd) pdocAddJd_(u, id, { file: file.getUrl(), source: _pdocSource || 'Uploaded file: ' + fileName });
  return file.getUrl();
}

/** Returns an attachment as base64 for the in-app viewer. */
function apiGetDoc(entity, id, field) {
  const u = currentUser_();
  const t = docTarget_(entity, id, field);
  if (entity === 'BGV') bgvRequireWork_(u, t.rec);
  const fid = cvFileId_(t.rec[field]);
  if (!fid) throw new Error('No file is attached here yet.');
  let file;
  try { file = DriveApp.getFileById(fid); }
  catch (e) { throw new Error(entity === 'BGV' ? 'You do not have access to this file. BGV files sit in a restricted folder; ask the admin to press "Sync Drive access" on the BGV tracker.' : 'You do not have access to this file. Ask the CRM admin to run shareWithTeam.'); }
  if (entity === 'BGV') audit_(u, BGV_CASES_.name, id, 'File viewed', field, '', file.getName());
  const blob = file.getBlob();
  if (blob.getBytes().length > 15 * 1024 * 1024) throw new Error('This file is larger than 15 MB. Open it from Drive instead.');
  return { name: file.getName(), mime: blob.getContentType(), b64: Utilities.base64Encode(blob.getBytes()), url: file.getUrl() };
}

/* ---------------- Interview panel members master ---------------- */

/** Seed built from the CV Tracker's interviewer names: [name, designation, department, roles, aliases, note]. */
const PANEL_SEED = [["Jaspal Bhanker", "Sr. GM - HR", "HR", "Technical, Final", "Jaspal; Jaspal Bhankar", ""], ["Gaurav Budhia", "Director", "Management", "Final", "Gaurav", "Mapped from 'Gaurav Sir' in the CV tracker - confirm"], ["Shekhar Sharad", "DGM / Sr. DGM", "Civil Head - Projects", "Technical, Final", "Shekhar", ""], ["Sajid Raza", "DGM / Sr. DGM", "Civil Head - Projects", "Technical, Final", "Sajid", ""], ["Jitendra Dwivedi", "General Manager", "BFCL-BE", "Technical, Final", "Jitendra Diwedi; Jtendra Diwedi; Jitendra", ""], ["Bhoopendra Sinha", "", "", "Technical", "Bhoopendra", ""], ["Satyendra Pandey", "", "", "Technical", "", "'Satyendra' alone was not mapped - could be Satyendra Pandey or Satyendra Kumar Singh"], ["Satyendra Kumar Singh", "", "", "Technical", "", ""], ["Abhas Luharuwala", "AGM", "BFCL-Business Analytics", "Technical, Final", "Abhas", ""], ["M. Nagaraju", "", "", "Technical", "M.nagaraju; Nagaraju", ""], ["Chandrakanta Mahanta", "", "", "Technical", "", ""], ["Ashish Kataria", "", "", "Technical", "Ashish", "'Ashish Sir' mapped here - confirm"], ["Firoz Ahmad", "", "", "Technical", "Firoz", ""], ["Shrikant Ganguly", "", "", "Technical", "", ""], ["Anil Pathak", "", "", "Technical", "", ""], ["Santosh Kumar Rath", "", "", "Technical", "", ""], ["Chandan Kumar Pandit", "", "", "Technical", "", ""], ["Ravi Naidu", "", "", "Technical", "", ""], ["Atul Khaitan", "", "", "Technical", "", ""], ["Umesh Kumar Mahto", "", "", "Technical", "Umesh Kumar Mahato", "Check whether 'Umesh Kumar Mehta' is the same person"], ["Umesh Kumar Mehta", "", "", "Technical", "", ""], ["Subhranshu Nayak", "", "", "Technical", "Subranshu Nayak", ""], ["Piyush Bansal", "", "", "Technical", "", ""], ["Ramendra Roy", "", "", "Technical", "", ""], ["Rama Prasad Yadav", "", "", "Technical", "Rama Prasad Yaday; Ram Prasad Yadav", ""], ["Satyanarayan", "", "", "Technical", "Satya Narayan", "Add full name"], ["YRVS Murthy", "", "", "Technical", "Yrvs Murthy; Yrsv Murthy; Murthy", ""], ["Mayank Mouli", "", "", "Technical", "", ""], ["Shyam Hati", "", "", "Technical", "", ""], ["Binay", "", "", "Final", "", "Add full name"], ["Uttam", "", "", "Final", "", "Add full name"], ["Umesh Singh", "", "", "Technical", "", ""], ["Dilip Ojha", "", "", "Technical", "Dk Ojha; Dk. Ojha; D.K. Ojha", ""], ["Rama Chandra Reddy", "", "", "Technical", "", ""], ["Tushar Kelkar", "", "", "Technical", "", ""], ["U.A.V.S.S. Ganapathi Varma", "", "", "Technical", "U.a.v.s.s Ganapathi Varma; Ganapathi; Ganpati Verma; Ganapthi Verma; Gapati Verma", ""], ["Vikas Anand", "", "", "Technical", "Vikash Anand", ""], ["Samir Dey", "", "", "Technical", "", ""], ["Prabhat Kumar Singh", "", "", "Technical", "Prabhat Singh", ""], ["Chandrabhan Singh", "", "", "Technical", "", ""], ["Sindhu Raj Singh", "", "", "Technical", "", ""], ["Jitendar Bharti", "", "", "Technical", "", ""], ["Prakash Sinha", "", "", "Technical", "", ""], ["Sandeep Kumar Tiwari", "", "", "Technical", "Sandeep Tiwari; Sandeep Kumar", ""], ["Niraj Kumar Mishra", "Assistant General Manager", "Ferro - QC", "Technical", "Neeraj Mishra; Niraj Mishra", ""], ["Rishi Juneja", "", "", "Technical", "Rishi", ""], ["Upendra Singh", "", "", "Technical", "", ""], ["K. Srinivasa Rao", "", "", "Technical", "K.srinivasarao; K.srinivasa Rao", ""], ["Pran Ranjan Tiwari", "", "", "Technical", "", ""], ["Rahul Das", "", "", "Technical", "", ""], ["Biswajit Sahoo", "", "", "Technical", "", ""], ["Anant Shankar Seth", "", "", "Technical", "", ""], ["Biswajeet Mandal", "", "", "Technical", "", ""], ["Rajesh Singh", "", "", "Technical", "", ""], ["Diptikanta Mohanty", "", "", "Technical", "", ""], ["Rupesh Dalvi", "Sr. Manager", "Admin", "Technical", "", ""], ["Satyam", "", "", "Technical", "", "Add full name"], ["Nitesh", "", "", "Technical", "", "Add full name"], ["Dheeraj", "", "", "Technical", "", "Add full name"], ["Venkata", "", "", "Technical", "", "Add full name"], ["Tanaaz", "Recruiter", "HR - Talent Acquisition", "HR", "", ""], ["Purnima Pathak", "Recruiter", "HR - Talent Acquisition", "HR", "Purnima; Pathak", ""], ["Randhir Singh", "Recruiter", "HR - Talent Acquisition", "HR", "Randhir; Radhir Singh; Randhir Sigh", ""], ["Avinash Kumar", "Recruiter", "HR - Talent Acquisition", "HR", "Avinash", ""], ["Tishar Chawda", "Recruiter", "HR - Talent Acquisition", "HR", "Tishar", ""], ["Aditya Sharma", "Recruiter", "HR - Talent Acquisition", "HR", "Aditya", ""], ["Shibashis", "Recruiter", "HR - Talent Acquisition", "HR", "", ""], ["Ankit Choudhary", "", "HR", "HR", "", ""]];

function seedPanelMembers_() {
  if (ss_().getSheetByName(T.PM.name)) return;
  const headers = ['Panel_ID', 'Name', 'Aliases', 'Designation', 'Department', 'Email', 'Roles', 'Active', 'Note',
    'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
  addSheet_(T.PM.name, headers);
  const now = new Date();
  const rows = PANEL_SEED.map(function (s, i) {
    return ['PM-' + String(i + 1).padStart(3, '0'), s[0], s[4], s[1], s[2], '', s[3], 'Yes', s[5], 'seed', now, 'seed', now];
  });
  sheet_(T.PM.name).getRange(2, 1, rows.length, headers.length).setValues(rows);
  dropStale_(T.PM.name);
}

function panelMembers_(includeInactive) {
  const sh = ss_().getSheetByName(T.PM.name);
  if (!sh) return [];
  return readTable_(T.PM.name).rows.filter(function (r) { return includeInactive || String(r.Active) !== 'No'; })
    .map(function (r) {
      return { id: String(r.Panel_ID), name: String(r.Name), aliases: String(r.Aliases || ''), designation: String(r.Designation || ''),
        department: String(r.Department || ''), email: String(r.Email || ''), roles: String(r.Roles || ''), active: String(r.Active || 'Yes'),
        note: String(r.Note || '') };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

function panelKey_(s) { return String(s || '').toLowerCase().replace(/\b(sir|mr|mrs|ms|dr)\b\.?/g, '').replace(/[^a-z]/g, ''); }

function apiListPanelMembers() {
  currentUser_(); ensureSchema_();
  const today = ymd_(new Date()), away = {};
  readTable_(T.PANEL.name).rows.forEach(function (r) {
    if (String(r.Availability_Status || 'Unavailable') !== 'Unavailable' || panelKind_(r) !== 'Full days') return;
    const from = ymd_(r.Date), to = ymd_(r.To_Date) || from;
    if (!from || to < today) return;
    const k = panelKey_(r.Panel_Member);
    (away[k] = away[k] || []).push({ from: from, to: to, reason: String(r.Reason || '') });
  });
  return panelMembers_(true).map(function (m) {
    const list = (away[panelKey_(m.name)] || []).sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    const now = list.filter(function (x) { return x.from <= today; })[0], next = list.filter(function (x) { return x.from > today; })[0];
    if (now) m.awayNow = now; if (next) m.awayNext = next;
    return m;
  });
}

/** Any team member can add a panel member; only the head or admin can edit or deactivate one. */
function apiSavePanelMember(data) {
  const u = currentUser_(); ensureSchema_();
  const patch = prepare_(T.PM, data);
  patch.Name = String(patch.Name || '').replace(/\s+/g, ' ').trim();
  if (!patch.Name) throw new Error('Panel member name is required.');
  if (!patch.Roles) patch.Roles = 'Technical';
  if (!patch.Active) patch.Active = 'Yes';
  const key = panelKey_(patch.Name);
  const clash = readTable_(T.PM.name).rows.filter(function (r) {
    if (data.Panel_ID && r.Panel_ID === data.Panel_ID) return false;
    return [r.Name].concat(String(r.Aliases || '').split(';')).some(function (a) { return panelKey_(a) === key; });
  })[0];
  if (clash) throw new Error(patch.Name + ' is already in the panel list as ' + clash.Name + '.');
  let rec;
  if (data.Panel_ID) {
    if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can edit panel members.');
    rec = update_(T.PM, data.Panel_ID, patch, u);
  } else {
    rec = insert_(T.PM, patch, u);
  }
  return { id: String(rec.Panel_ID), name: String(rec.Name), aliases: String(rec.Aliases || ''), designation: String(rec.Designation || ''),
    department: String(rec.Department || ''), email: String(rec.Email || ''), roles: String(rec.Roles || ''), active: String(rec.Active || 'Yes'),
    note: String(rec.Note || '') };
}
