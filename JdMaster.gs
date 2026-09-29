/**
 * JD Master (phase 1). The BFCL Master JD Library workbook is imported into JDM_* sheets: job-profile templates,
 * responsibility statements, skills, the Skill Competency Framework (competencies and required levels per department
 * and grade), grade and qualification norms and the standard responsibilities per grade band. The library is signed off
 * here (inferred grades, duplicate profiles, competency-department mapping) and CRM departments are mapped to framework
 * departments. Later phases use it to build and check JDs for MRFs.
 */
const JDM_ = {
  Templates: ['JD_ID', 'Function', 'Job_Family', 'Unit', 'Division', 'Department', 'Designation', 'Grade', 'Grade_Band', 'Grade_Basis', 'Collar',
    'Reports_To', 'Reportees', 'Role_Summary', 'Min_Total_Exp', 'Min_Relevant_Exp', 'Experience_Text', 'Qualification_Text', 'Version_Status',
    'Source_File', 'Competency_Dept', 'Mapping_Basis', 'Status', 'Primary_JD', 'Grade_Confirmed_By', 'Grade_Confirmed_On', 'Dept_Confirmed_By',
    'Dept_Confirmed_On', 'Dup_Confirmed_By', 'Dup_Confirmed_On', 'Review_Note', 'Updated_By', 'Updated_At'],
  Statements: ['Stmt_ID', 'JD_ID', 'Seq', 'KRA_Area', 'KRA_Category', 'Text', 'Source', 'Status', 'Updated_By', 'Updated_At'],
  Skills: ['Skill_ID', 'JD_ID', 'Seq', 'Text', 'Skill_Type', 'Framework_Link', 'Source', 'Status', 'Updated_By', 'Updated_At'],
  Competencies: ['Code', 'Competency', 'Area', 'Category', 'Criticality', 'L1', 'L2', 'L3', 'L4', 'L5', 'Assessment'],
  Comp_Levels: ['Comp_Dept', 'Seq', 'Code', 'Competency', 'Category', 'Criticality', 'Profile', 'W5', 'W4', 'W3', 'W2', 'W1', 'T', 'M7', 'M6', 'M5', 'M4', 'M3', 'M2', 'M1'],
  Grades: ['Grade', 'Description', 'Grade_Band', 'Typical_Designations', 'Recommended_Exp'],
  Qual_Norms: ['Job_Family', 'Workmen (W5-W3)', 'Supervisory (W2-W1)', 'Trainee (T)', 'Officer / Engineer (M7-M6)', 'Middle Management (M5-M4)', 'Senior Management (M3-M1)'],
  Band_KRAs: ['Grade_Band', 'Seq', 'Text'],
  KRA_Categories: ['Category', 'Covers', 'Area_Names'],
  Review_Notes: ['Issue', 'JD_ID', 'Role', 'Detail', 'Action'],
  Dept_Map: ['CRM_Dept', 'Competency_Dept', 'Basis', 'Confirmed_By', 'Confirmed_On', 'Note', 'Updated_By', 'Updated_At'],
  Import_Log: ['Lib_Version', 'Imported_On', 'Imported_By', 'File_Name', 'Counts_JSON', 'Warnings', 'Note']
};
const JDM_GRADES_ = ['W5', 'W4', 'W3', 'W2', 'W1', 'T', 'M7', 'M6', 'M5', 'M4', 'M3', 'M2', 'M1'];
const JDM_COMMON_ = 'Common Core (all employees)';
const JDM_EDIT_FIELDS_ = ['Designation', 'Grade', 'Competency_Dept', 'Reports_To', 'Reportees', 'Role_Summary', 'Min_Total_Exp', 'Qualification_Text', 'Status', 'Primary_JD', 'Review_Note'];
function jdmName_(k) { return 'JDM_' + k; }
/** Sheets the workbook import never replaces: the department map, the import log and the generated-JD history. */
const JDM_NOIMPORT_ = ['Dept_Map', 'Import_Log', 'Drafts'];

T.JDMT = { name: 'JDM_Templates', id: 'JD_ID', prefix: 'JD-', width: 3, dates: [], editable: JDM_EDIT_FIELDS_ };
T.JDMS = { name: 'JDM_Statements', id: 'Stmt_ID', prefix: 'JST-', width: 5, dates: [], editable: ['KRA_Area', 'KRA_Category', 'Text', 'Status'] };
T.JDMK = { name: 'JDM_Skills', id: 'Skill_ID', prefix: 'JSK-', width: 5, dates: [], editable: ['Text', 'Skill_Type', 'Framework_Link', 'Status'] };
T.JDMD = { name: 'JDM_Dept_Map', id: 'CRM_Dept', prefix: '', width: 0, dates: [], editable: ['Competency_Dept', 'Basis', 'Note'] };

function jdmSchema_() { Object.keys(JDM_).forEach(function (k) { addSheet_(jdmName_(k), JDM_[k]); }); }

/* ---------------- workbook mapping ---------------- */

/** How each workbook sheet maps onto a JDM sheet: target, key column, and column sources (header names, or prefix~). */
const JDM_SOURCES_ = {
  JD_Register: { to: 'Templates', required: true, cols: { JD_ID: 'JD ID', Function: 'Function', Job_Family: 'Job family', Unit: 'Unit', Division: 'Division',
    Department: 'Department', Designation: 'Designation / Role', Grade: 'Grade (inferred)', Grade_Band: 'Grade band', Grade_Basis: 'Grade basis', Collar: 'Collar',
    Reports_To: 'Reports to', Reportees: 'Reportees', Role_Summary: 'Role summary', Min_Total_Exp: 'Min. total experience (yrs)',
    Min_Relevant_Exp: 'Min. relevant experience (yrs)', Experience_Text: 'Experience as written', Qualification_Text: 'Qualification as written',
    Version_Status: 'Version status', Source_File: 'Source file', Competency_Dept: 'Competency department~', Mapping_Basis: 'Competency mapping basis' },
    need: ['JD_ID', 'Designation', 'Grade', 'Function'] },
  KRA_Library: { to: 'Statements', required: true, cols: { Stmt_ID: 'Key', JD_ID: 'JD ID', Seq: 'Seq', KRA_Area: 'KRA area~', KRA_Category: 'Standard KRA category', Text: 'Responsibility statement' }, need: ['Stmt_ID', 'JD_ID', 'Text'] },
  Skills_Library: { to: 'Skills', required: true, cols: { Skill_ID: 'Key', JD_ID: 'JD ID', Seq: 'Seq', Text: 'Skill statement', Skill_Type: 'Skill type', Framework_Link: 'Suggested framework competency~' }, need: ['Skill_ID', 'JD_ID', 'Text'] },
  Competency_Skills: { to: 'Competencies', required: true, cols: { Code: 'Code', Competency: 'Competency', Area: 'Area', Category: 'Category', Criticality: 'Criticality',
    L1: 'L1~', L2: 'L2~', L3: 'L3~', L4: 'L4~', L5: 'L5~', Assessment: 'Assessment' }, need: ['Code', 'Competency'] },
  Competency_Requirements: { to: 'Comp_Levels', required: true, cols: { Comp_Dept: 'Competency department', Seq: 'Seq', Code: 'Code', Competency: 'Competency', Category: 'Category',
    Criticality: 'Criticality', Profile: 'Requirement profile', W5: 'W5', W4: 'W4', W3: 'W3', W2: 'W2', W1: 'W1', T: 'T', M7: 'M7', M6: 'M6', M5: 'M5', M4: 'M4', M3: 'M3', M2: 'M2', M1: 'M1' },
    need: ['Comp_Dept', 'Code'] },
  Grade_Master: { to: 'Grades', required: true, cols: { Grade: 'Grade', Description: 'Description', Grade_Band: 'Grade band', Typical_Designations: 'Typical designations',
    Recommended_Exp: 'Recommended total experience~' }, need: ['Grade', 'Grade_Band'] },
  Qualification_Norms: { to: 'Qual_Norms', required: true, cols: { Job_Family: 'Job family', 'Workmen (W5-W3)': 'Workmen (W5-W3)', 'Supervisory (W2-W1)': 'Supervisory (W2-W1)',
    'Trainee (T)': 'Trainee (T)', 'Officer / Engineer (M7-M6)': 'Officer / Engineer (M7-M6)', 'Middle Management (M5-M4)': 'Middle Management (M5-M4)',
    'Senior Management (M3-M1)': 'Senior Management (M3-M1)' }, need: ['Job_Family', 'Officer / Engineer (M7-M6)'] },
  Grade_Standard_KRAs: { to: 'Band_KRAs', required: true, cols: { Grade_Band: 'Grade band', Seq: 'Seq', Text: 'Standard responsibility~' }, need: ['Grade_Band', 'Text'] },
  KRA_Categories: { to: 'KRA_Categories', required: true, cols: { Category: 'Standard KRA category', Covers: 'What it covers', Area_Names: 'Area names~' }, need: ['Category'] },
  Review_Log: { to: 'Review_Notes', required: false, cols: { Issue: 'Issue', JD_ID: 'JD ID', Role: 'Role', Detail: 'Detail', Action: 'Action' }, need: ['Issue'] }
};
function jdmNorm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Maps a workbook sheet's header row to column indexes. Returns { idx: {JDM col: index}, missing: [labels] }. */
function jdmHeaderMap_(src, header) {
  const norm = header.map(jdmNorm_), idx = {}, missing = [];
  Object.keys(src.cols).forEach(function (k) {
    const lab = src.cols[k], pre = /~$/.test(lab), n = jdmNorm_(lab.replace(/~$/, ''));
    let i = norm.indexOf(n);
    if (i < 0 && pre) i = norm.findIndex(function (h) { return h.indexOf(n) === 0; });
    if (i < 0) { if (src.need.indexOf(k) >= 0) missing.push(lab.replace(/~$/, '')); } else idx[k] = i;
  });
  return { idx: idx, missing: missing };
}
/** Workbook rows to JDM rows, dropping notes, totals and blank lines. */
function jdmMapRows_(sheetName, header, rows) {
  const src = JDM_SOURCES_[sheetName];
  const hm = jdmHeaderMap_(src, header);
  if (hm.missing.length) throw new Error(sheetName + ' is missing the column' + (hm.missing.length > 1 ? 's ' : ' ') + hm.missing.join(', ') + '.');
  const out = [];
  rows.forEach(function (r) {
    const o = {};
    Object.keys(hm.idx).forEach(function (k) { const v = r[hm.idx[k]]; o[k] = v == null ? '' : (typeof v === 'string' ? v.trim() : v); });
    if (src.need.some(function (k) { return o[k] === '' || o[k] == null; })) return;
    if (sheetName === 'Grade_Master' && JDM_GRADES_.indexOf(String(o.Grade).toUpperCase()) < 0) return;
    if (sheetName === 'KRA_Categories' && /^total$/i.test(String(o.Category))) return;
    if (sheetName === 'Grade_Standard_KRAs' && !/\(|workmen|supervisory|trainee|officer|management/i.test(String(o.Grade_Band))) return;
    if (sheetName === 'JD_Register') {
      o.Grade = String(o.Grade).toUpperCase();
      const vs = String(o.Version_Status || '');
      const pm = vs.match(/variant of\s+(JD-\d+)/i);
      o.Status = pm ? 'Variant' : 'Active';
      o.Primary_JD = pm ? pm[1].toUpperCase() : '';
    }
    if (sheetName === 'KRA_Library' || sheetName === 'Skills_Library') { o.Source = 'Workbook'; o.Status = 'Active'; }
    if (sheetName === 'Competency_Requirements') JDM_GRADES_.forEach(function (g) { const n = Number(o[g]); o[g] = o[g] === '' || isNaN(n) ? '' : n; });
    out.push(o);
  });
  return out;
}

/* ---------------- import (Admin) ---------------- */

function jdmStage_(k) { return 'JDMX_' + k; }
function apiJdmImportStart(info) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'system')) throw new Error('Only the admin can import the JD library.');
  info = info || {};
  const names = (info.sheets || []).map(String);
  const miss = Object.keys(JDM_SOURCES_).filter(function (s) { return JDM_SOURCES_[s].required && names.indexOf(s) < 0; });
  if (miss.length) throw new Error('This file is not the BFCL Master JD Library: the sheet' + (miss.length > 1 ? 's ' : ' ') + miss.join(', ') + (miss.length > 1 ? ' are' : ' is') + ' missing.');
  const token = 'imp' + Date.now();
  withLock_(function () {
    Object.keys(JDM_).forEach(function (k) {
      if (JDM_NOIMPORT_.indexOf(k) >= 0) return;
      let sh = ss_().getSheetByName(jdmStage_(k));
      if (!sh) sh = ss_().insertSheet(jdmStage_(k));
      if (sh.getLastRow() > 0) sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), JDM_[k].length)).clearContent();
      sh.getRange(1, 1, 1, JDM_[k].length).setValues([JDM_[k]]);
      _tables[jdmStage_(k)] = null;
    });
  });
  PropertiesService.getScriptProperties().setProperty('JDM_IMPORT', JSON.stringify({ token: token, by: u.email, file: String(info.fileName || ''), at: Date.now() }));
  return { token: token };
}
function jdmImportState_(token, u) {
  const st = JSON.parse(PropertiesService.getScriptProperties().getProperty('JDM_IMPORT') || '{}');
  if (!st.token || st.token !== token) throw new Error('This import was replaced or has expired. Start again.');
  if (st.by !== u.email) throw new Error('Another admin started a different import. Start again.');
  return st;
}
/** One part of one workbook sheet: part 0 carries the header row first. */
function apiJdmImportPart(token, sheetName, header, rows) {
  const u = currentUser_();
  if (!can_(u, 'system')) throw new Error('Only the admin can import the JD library.');
  jdmImportState_(token, u);
  const src = JDM_SOURCES_[sheetName];
  if (!src) return { written: 0 };
  const mapped = jdmMapRows_(sheetName, header || [], rows || []);
  if (!mapped.length) return { written: 0 };
  const cols = JDM_[src.to];
  withLock_(function () {
    const sh = ss_().getSheetByName(jdmStage_(src.to));
    const vals = mapped.map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : (typeof o[c] === 'string' ? jdmSafeText_(clean_(o[c])) : o[c]); }); });
    sh.getRange(sh.getLastRow() + 1, 1, vals.length, cols.length).setValues(vals);
  });
  return { written: mapped.length };
}
function jdmReadStage_(k) {
  const sh = ss_().getSheetByName(jdmStage_(k));
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues(); const h = v.shift().map(String);
  return rowsFromValues_(h, v, 2);
}
/** Checks, carries over sign-offs and app edits, then replaces the library. Nothing changes if a blocking error is found. */
function apiJdmImportFinish(token) {
  const u = currentUser_();
  if (!can_(u, 'system')) throw new Error('Only the admin can import the JD library.');
  const st = jdmImportState_(token, u);
  const data = {}; Object.keys(JDM_).forEach(function (k) { if (JDM_NOIMPORT_.indexOf(k) < 0) data[k] = jdmReadStage_(k); });
  const errors = [], warnings = [];
  const count = function (a) { return a.length; };
  if (!data.Templates.length) errors.push('No job profiles were found in JD_Register.');
  const ids = {}; data.Templates.forEach(function (t) { if (ids[t.JD_ID]) errors.push('JD ID ' + t.JD_ID + ' appears twice in JD_Register.'); ids[t.JD_ID] = t; });
  data.Templates.forEach(function (t) { if (JDM_GRADES_.indexOf(String(t.Grade)) < 0) errors.push(t.JD_ID + ': grade "' + t.Grade + '" is not a BFCL grade (W5\u2013W1, T, M7\u2013M1).'); });
  ['Statements', 'Skills'].forEach(function (k) {
    const seen = {}, orphan = [];
    data[k] = data[k].filter(function (s) {
      const id = String(s[k === 'Statements' ? 'Stmt_ID' : 'Skill_ID']);
      if (seen[id]) { errors.push((k === 'Statements' ? 'KRA_Library' : 'Skills_Library') + ' key ' + id + ' appears twice.'); return false; }
      seen[id] = true;
      if (!ids[s.JD_ID]) { orphan.push(id); return false; }
      return true;
    });
    if (orphan.length) warnings.push(orphan.length + ' ' + (k === 'Statements' ? 'responsibility' : 'skill') + ' rows point to a JD ID that is not in JD_Register and were skipped (e.g. ' + orphan.slice(0, 3).join(', ') + ').');
  });
  const grades = {}; data.Grades.forEach(function (g) { grades[String(g.Grade).toUpperCase()] = g; });
  JDM_GRADES_.forEach(function (g) { if (!grades[g]) errors.push('Grade_Master has no row for ' + g + '.'); });
  const deptSet = {}; data.Comp_Levels.forEach(function (r) { deptSet[r.Comp_Dept] = true; });
  if (!deptSet[JDM_COMMON_]) warnings.push('Competency_Requirements has no "' + JDM_COMMON_ + '" rows.');
  const codes = {}; data.Competencies.forEach(function (c) { codes[c.Code] = true; });
  const unknownCodes = {}; data.Comp_Levels.forEach(function (r) { if (!codes[r.Code]) unknownCodes[r.Code] = true; });
  if (Object.keys(unknownCodes).length) warnings.push('Competency codes without a definition in Competency_Skills: ' + Object.keys(unknownCodes).slice(0, 8).join(', ') + '.');
  const unmapped = data.Templates.filter(function (t) { return t.Competency_Dept && !deptSet[t.Competency_Dept]; });
  if (unmapped.length) warnings.push(unmapped.length + ' job profiles name a competency department that is not in the framework (e.g. ' + unmapped.slice(0, 3).map(function (t) { return t.JD_ID; }).join(', ') + ').');
  const cats = {}; data.KRA_Categories.forEach(function (c) { cats[c.Category] = true; });
  const badCat = data.Statements.filter(function (s) { return s.KRA_Category && !cats[s.KRA_Category]; }).length;
  if (badCat) warnings.push(badCat + ' responsibility statements use a KRA category that is not in KRA_Categories.');
  data.Templates.forEach(function (t) { const g = grades[t.Grade]; if (g) t.Grade_Band = g.Grade_Band; });
  if (errors.length) { jdmClearStage_(); return { ok: false, errors: errors.slice(0, 30), warnings: warnings }; }

  // Carry over sign-offs and app edits from the current library.
  const carried = { templates: 0, statements: 0, added: 0 };
  const oldT = {}; readTable_('JDM_Templates', true).rows.forEach(function (t) { oldT[t.JD_ID] = t; });
  data.Templates.forEach(function (t) {
    const o = oldT[t.JD_ID]; if (!o) return;
    let used = false;
    if (o.Updated_By) { JDM_EDIT_FIELDS_.forEach(function (f) { t[f] = o[f]; }); t.Updated_By = o.Updated_By; t.Updated_At = o.Updated_At; used = true; }
    if (o.Grade_Confirmed_By) { t.Grade = o.Grade; t.Grade_Confirmed_By = o.Grade_Confirmed_By; t.Grade_Confirmed_On = o.Grade_Confirmed_On; used = true; }
    if (o.Dept_Confirmed_By) { t.Competency_Dept = o.Competency_Dept; t.Dept_Confirmed_By = o.Dept_Confirmed_By; t.Dept_Confirmed_On = o.Dept_Confirmed_On; used = true; }
    if (o.Dup_Confirmed_By) { t.Status = o.Status; t.Primary_JD = o.Primary_JD; t.Dup_Confirmed_By = o.Dup_Confirmed_By; t.Dup_Confirmed_On = o.Dup_Confirmed_On; used = true; }
    if (o.Review_Note) t.Review_Note = o.Review_Note;
    const g = grades[t.Grade]; if (g) t.Grade_Band = g.Grade_Band;
    if (used) carried.templates++;
  });
  [['Statements', 'Stmt_ID', ['KRA_Area', 'KRA_Category', 'Text', 'Status']], ['Skills', 'Skill_ID', ['Text', 'Skill_Type', 'Framework_Link', 'Status']]].forEach(function (x) {
    const k = x[0], id = x[1];
    const staged = {}; data[k].forEach(function (s) { staged[s[id]] = s; });
    readTable_(jdmName_(k), true).rows.forEach(function (o) {
      if (String(o.Source) === 'App') { if (ids[o.JD_ID]) { data[k].push(o); carried.added++; } return; }
      const s = staged[o[id]];
      if (s && o.Updated_By) { x[2].forEach(function (f) { s[f] = o[f]; }); s.Updated_By = o.Updated_By; s.Updated_At = o.Updated_At; carried.statements++; }
    });
  });

  const version = Number(PropertiesService.getScriptProperties().getProperty('JDM_VERSION') || 0) + 1;
  withLock_(function () {
    Object.keys(data).forEach(function (k) { jdmReplace_(jdmName_(k), JDM_[k], data[k]); });
    const counts = { templates: data.Templates.length, statements: data.Statements.length, skills: data.Skills.length, competencies: data.Competencies.length,
      compLevels: data.Comp_Levels.length, compDepts: Object.keys(deptSet).length, grades: data.Grades.length, qualNorms: data.Qual_Norms.length,
      bandKras: data.Band_KRAs.length, categories: data.KRA_Categories.length };
    const log = sheet_('JDM_Import_Log');
    log.getRange(log.getLastRow() + 1, 1, 1, JDM_.Import_Log.length).setValues([[version, new Date(), u.email, clean_(st.file), JSON.stringify(counts), warnings.join(' | ').slice(0, 45000), '']]);
    PropertiesService.getScriptProperties().setProperty('JDM_VERSION', String(version));
  });
  jdmClearStage_();
  PropertiesService.getScriptProperties().setProperty('JDM_IMPORT', '{}');
  _tables = {};
  const mapped = jdmSyncDeptMap_(u);
  audit_(u, 'JDM_Import_Log', 'L' + version, 'Create', 'import', '', st.file + ': ' + data.Templates.length + ' job profiles, ' + data.Statements.length + ' responsibilities');
  return { ok: true, version: version, warnings: warnings, carried: carried, deptMap: mapped,
    counts: { templates: data.Templates.length, statements: data.Statements.length, skills: data.Skills.length, competencies: data.Competencies.length, compDepts: Object.keys(deptSet).length } };
}
function jdmReplace_(name, cols, rows) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  const vals = rows.map(function (o) { return cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : jdmSafeText_(o[c]); }); });
  sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  if (vals.length) sh.getRange(2, 1, vals.length, cols.length).setValues(vals);
  if (last > vals.length + 1) sh.getRange(vals.length + 2, 1, last - vals.length - 1, Math.max(cols.length, sh.getLastColumn())).clearContent();
  dropStale_(name);
}
function jdmClearStage_() {
  Object.keys(JDM_).forEach(function (k) {
    if (JDM_NOIMPORT_.indexOf(k) >= 0) return;
    const sh = ss_().getSheetByName(jdmStage_(k)); if (!sh) return;
    try { ss_().deleteSheet(sh); } catch (e) { if (sh.getLastRow() > 0) sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).clearContent(); }
  });
}

/* ---------------- CRM department mapping ---------------- */

const JDM_SYN_ = [[/\bE\s*(&|AND)\s*I\b/g, 'EANDI'], [/\bMGMT\b/g, 'MANAGEMENT'], [/\bMECHA?NICAL\b|\bMECHAICAL\b/g, 'MECH'], [/\bELECTRICAL\b/g, 'ELECT'],
  [/\bINSTRUMENTATION\b/g, 'INST'], [/(\d)\s*MW\b/g, '$1 MW'], [/\bSTORES\b/g, 'STORE']];
function jdmTokens_(s) {
  let t = ' ' + String(s || '').toUpperCase() + ' ';
  JDM_SYN_.forEach(function (x) { t = t.replace(x[0], x[1]); });
  return t.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(function (w) { return w && ['AND', 'THE', 'OF', 'ALL', 'EMPLOYEES'].indexOf(w) < 0; })
    .map(function (w) { return w.length > 4 && /S$/.test(w) && !/SS$/.test(w) ? w.slice(0, -1) : w; });
}
/** Best framework department for a CRM department: exact (normalised) match, or a unique best token match. */
function jdmSuggestDept_(crm, depts) {
  const n = jdmNorm_(crm.replace(/&/g, 'and'));
  const exact = depts.filter(function (d) { return jdmNorm_(d.replace(/&/g, 'and')) === n; })[0];
  if (exact) return { dept: exact, basis: 'Exact' };
  const uniq = function (l) { return l.filter(function (w, i) { return l.indexOf(w) === i; }); };
  const a = uniq(jdmTokens_(crm));
  const scored = depts.filter(function (d) { return d !== JDM_COMMON_; }).map(function (d) {
    const b = uniq(jdmTokens_(d)), inter = a.filter(function (w) { return b.indexOf(w) >= 0; }).length;
    const uni = a.concat(b.filter(function (w) { return a.indexOf(w) < 0; })).length;
    return { d: d, s: uni ? inter / uni : 0, words: a.filter(function (w) { return b.indexOf(w) >= 0; }) };
  }).sort(function (x, y) { return y.s - x.s; });
  if (scored.length && scored[0].words.length) {
    const w = scored[0].words;
    const same = scored.filter(function (x) { return w.every(function (t) { return x.words.indexOf(t) >= 0; }); });
    if (same.length > 1) return { dept: '', basis: 'Not mapped', options: same.slice(0, 4).map(function (x) { return x.d; }) };
  }
  if (scored.length && scored[0].s >= 0.4 && (!scored[1] || scored[1].s < scored[0].s)) return { dept: scored[0].d, basis: 'Suggested', score: scored[0].s };
  return { dept: '', basis: 'Not mapped', options: scored.filter(function (x) { return x.s > 0; }).slice(0, 3).map(function (x) { return x.d; }) };
}
function jdmCompDepts_() {
  const s = {}; readTable_('JDM_Comp_Levels').rows.forEach(function (r) { if (r.Comp_Dept) s[r.Comp_Dept] = true; });
  return Object.keys(s).sort();
}
/** Adds every CRM department (master list and positions) to the map; never overwrites a confirmed or manual mapping. */
function jdmSyncDeptMap_(u) {
  const depts = jdmCompDepts_(); if (!depts.length) return { added: 0 };
  const names = {};
  readTable_('M_Departments').rows.forEach(function (d) { if (String(d.Dept).trim()) names[String(d.Dept).trim()] = true; });
  readTable_(T.MRF.name).rows.forEach(function (l) { if (String(l.Dept || '').trim()) names[String(l.Dept).trim()] = true; });
  const t = readTable_('JDM_Dept_Map', true), have = {};
  t.rows.forEach(function (r) { have[String(r.CRM_Dept)] = r; });
  const add = [], fix = [];
  Object.keys(names).sort().forEach(function (n) {
    const r = have[n];
    if (r && (r.Confirmed_By || String(r.Basis) === 'Manual') && depts.indexOf(String(r.Competency_Dept)) >= 0) return;
    const s = jdmSuggestDept_(n, depts);
    const row = { CRM_Dept: n, Competency_Dept: s.dept, Basis: s.basis, Confirmed_By: '', Confirmed_On: '', Note: s.options && s.options.length ? 'Closest: ' + s.options.join('; ') : '' };
    if (!r) add.push(row); else if (String(r.Competency_Dept) !== s.dept || String(r.Basis) !== s.basis) fix.push([r, row]);
  });
  withLock_(function () {
    const cols = JDM_.Dept_Map;
    fix.forEach(function (x) { t.sheet.getRange(x[0]._row, 1, 1, cols.length).setValues([cols.map(function (c) { return x[1][c] === undefined ? '' : jdmSafeText_(x[1][c]); })]); });
    if (add.length) t.sheet.getRange(t.sheet.getLastRow() + 1, 1, add.length, cols.length).setValues(add.map(function (o) { return cols.map(function (c) { return o[c] === undefined ? '' : jdmSafeText_(o[c]); }); }));
  });
  dropStale_('JDM_Dept_Map');
  return { added: add.length, updated: fix.length };
}
/** Framework department for a CRM department name, or '' (used by the JD maker later). */
function jdmDeptFor_(crmDept) {
  const r = readTable_('JDM_Dept_Map').rows.filter(function (x) { return String(x.CRM_Dept) === String(crmDept || '').trim(); })[0];
  return r && String(r.Basis) !== 'Not mapped' ? String(r.Competency_Dept) : '';
}

/* ---------------- reading ---------------- */

function jdmGradeOrder_(g) { const i = JDM_GRADES_.indexOf(String(g)); return i < 0 ? 99 : i; }
/**
 * Recruitment Policy Appendix F minimum total experience: { degree, iti, rule } in years, or null for W and T grades.
 * M5 has two rows in the policy: Asst / Dy Manager 8 (14 with 12th/ITI) and Junior Manager 6 (12). Without a designation
 * the stricter Asst / Dy Manager figure applies.
 */
const JDM_POLICY_EXP_ = { M1: [25, null], M2: [20, null], M3: [15, 20], M4: [10, 16], M5: [8, 14], M6: [4, 12], M7: [2, 10] };
function jdmPolicyExp_(grade, designation) {
  const g = String(grade || '').toUpperCase(), p = JDM_POLICY_EXP_[g];
  if (!p) return null;
  if (g === 'M5' && /\b(junior|jr\.?)\s*manager\b|\bjm\b/i.test(String(designation || ''))) return { degree: 6, iti: 12, rule: 'M5 Junior Manager' };
  return { degree: p[0], iti: p[1], rule: g === 'M5' ? 'M5 Asst / Dy Manager' : g };
}
function jdmRecLow_(rec) { const m = String(rec || '').match(/(\d+)/); return m ? Number(m[1]) : null; }
function jdmRecHigh_(rec) { const m = String(rec || '').match(/\d+\s*[-\u2013]\s*(\d+)/); return m ? Number(m[1]) : null; }
/** The experience a JD asks for: the profile's figure, raised to the policy minimum where it is lower (policy supersedes). */
function jdmEffExp_(t) {
  const p = jdmPolicyExp_(t.Grade, t.Designation), stated = t.Min_Total_Exp === '' || t.Min_Total_Exp == null ? null : Number(t.Min_Total_Exp);
  if (!p) return { stated: stated, effective: stated, policy: null, raised: false, source: stated == null ? 'none' : 'profile' };
  if (stated == null) return { stated: null, effective: p.degree, policy: p, raised: false, source: 'policy' };
  return { stated: stated, effective: Math.max(stated, p.degree), policy: p, raised: stated < p.degree, source: stated < p.degree ? 'policy' : 'profile' };
}
/** A grade's experience norm with the policy minimum applied: '10-15' for M4 when the workbook says '8-15'. */
function jdmEffRange_(rec, p) {
  const low = jdmRecLow_(rec), high = jdmRecHigh_(rec);
  if (!p || low == null) return String(rec || '');
  const l = Math.max(low, p.degree);
  if (high == null) return l + '+';
  return high > l ? l + '\u2013' + high : l + '+';
}

/* ---------------- Skill Competency Framework checks ---------------- */

/** Department-specific competencies the framework requires (level 1 or more) at each grade: { dept: { grade: n } }. */
function jdmReqCounts_() {
  const out = {};
  readTable_('JDM_Comp_Levels').rows.forEach(function (r) {
    const d = out[r.Comp_Dept] = out[r.Comp_Dept] || {};
    JDM_GRADES_.forEach(function (g) { if (Number(r[g]) > 0) d[g] = (d[g] || 0) + 1; });
  });
  return out;
}
/** Classifies a profile's skills against the framework: its department's matrix, the common core, another department, or no link. */
function jdmSkillFit_(skills, dept) {
  const inDept = {}, inCore = {}, known = {};
  readTable_('JDM_Comp_Levels').rows.forEach(function (r) { if (r.Comp_Dept === dept) inDept[r.Code] = true; if (r.Comp_Dept === JDM_COMMON_) inCore[r.Code] = true; });
  readTable_('JDM_Competencies').rows.forEach(function (c) { known[c.Code] = String(c.Competency); });
  return skills.map(function (s) {
    const m = String(s.Framework_Link || s.link || '').match(/\b([A-Z]{2,3}-\d+)\b/), code = m ? m[1] : '';
    const fit = !code || !known[code] ? 'none' : inDept[code] ? 'dept' : inCore[code] ? 'core' : 'other';
    return { code: code, name: code ? (known[code] || '') : '', fit: fit };
  });
}

function apiJdmOverview() {
  const u = currentUser_(); ensureSchema_();
  const tpl = readTable_('JDM_Templates').rows;
  const log = readTable_('JDM_Import_Log').rows.slice(-5).reverse().map(function (r) {
    return { version: Number(r.Lib_Version), on: r.Imported_On instanceof Date ? fmt_(r.Imported_On, TZ, 'd MMM yyyy, HH:mm') : String(r.Imported_On), by: String(r.Imported_By),
      file: String(r.File_Name), counts: (function () { try { return JSON.parse(r.Counts_JSON); } catch (e) { return {}; } })(), warnings: String(r.Warnings || '') };
  });
  const groups = jdmDupGroups_(tpl);
  const map = readTable_('JDM_Dept_Map').rows;
  const grades = readTable_('JDM_Grades').rows;
  const normConflicts = grades.map(function (g) {
    const p = jdmPolicyExp_(g.Grade), low = jdmRecLow_(g.Recommended_Exp);
    return p && low != null && low < p.degree ? { grade: String(g.Grade), rec: String(g.Recommended_Exp), policy: p.degree, effective: jdmEffRange_(g.Recommended_Exp, p) } : null;
  }).filter(Boolean);
  const expBelow = tpl.filter(function (t) { return String(t.Status) !== 'Retired' && jdmEffExp_(t).raised; }).length;
  const req = jdmReqCounts_();
  const noReqs = tpl.filter(function (t) { return String(t.Status) !== 'Retired' && t.Competency_Dept && !(req[t.Competency_Dept] || {})[t.Grade]; }).length;
  const fitAll = jdmSkillFit_(readTable_('JDM_Skills').rows.filter(function (s) { return String(s.Status) === 'Active'; }), '__none__');
  return {
    canManage: can_(u, 'jd_manage'), canImport: can_(u, 'system'), version: Number(PropertiesService.getScriptProperties().getProperty('JDM_VERSION') || 0), log: log,
    counts: { templates: tpl.length, active: tpl.filter(function (t) { return String(t.Status) === 'Active'; }).length,
      statements: readTable_('JDM_Statements').rows.filter(function (s) { return String(s.Status) === 'Active'; }).length,
      skills: readTable_('JDM_Skills').rows.filter(function (s) { return String(s.Status) === 'Active'; }).length,
      competencies: readTable_('JDM_Competencies').rows.length, compDepts: jdmCompDepts_().length },
    signoff: {
      grades: { done: tpl.filter(function (t) { return t.Grade_Confirmed_By; }).length, total: tpl.length },
      depts: { done: tpl.filter(function (t) { return t.Dept_Confirmed_By; }).length, total: tpl.length },
      dups: { done: groups.filter(function (g) { return g.confirmed; }).length, total: groups.length },
      map: { done: map.filter(function (r) { return String(r.Basis) === 'Exact' || r.Confirmed_By; }).length, total: map.length,
        open: map.filter(function (r) { return String(r.Basis) !== 'Exact' && !r.Confirmed_By; }).length }
    },
    normConflicts: normConflicts, expBelowPolicy: expBelow, noFrameworkReqs: noReqs,
    skillsUnlinked: fitAll.filter(function (f) { return f.fit === 'none'; }).length
  };
}
/** Duplicate groups: a primary and its variants. Confirmed when every member has been signed off. */
function jdmDupGroups_(tpl) {
  const by = {};
  tpl.forEach(function (t) {
    const vs = String(t.Version_Status || '');
    let key = '';
    if (String(t.Status) === 'Variant' && t.Primary_JD) key = String(t.Primary_JD);
    else if (/^primary/i.test(vs)) key = String(t.JD_ID);
    else if (/variant of/i.test(vs)) key = (vs.match(/(JD-\d+)/i) || [])[1] || '';
    if (!key) return;
    (by[key] = by[key] || []).push(t);
  });
  const all = {}; tpl.forEach(function (t) { all[t.JD_ID] = t; });
  return Object.keys(by).map(function (k) {
    const members = by[k].slice(); if (all[k] && members.indexOf(all[k]) < 0) members.unshift(all[k]);
    const seen = {}; const uniq = members.filter(function (m) { if (seen[m.JD_ID]) return false; seen[m.JD_ID] = true; return true; });
    return { key: k, ids: uniq.map(function (m) { return String(m.JD_ID); }), confirmed: uniq.every(function (m) { return m.Dup_Confirmed_By; }) };
  });
}

function apiJdmTemplates() {
  currentUser_(); ensureSchema_();
  const tpl = readTable_('JDM_Templates').rows;
  const n = {}, k = {};
  readTable_('JDM_Statements').rows.forEach(function (s) { if (String(s.Status) === 'Active') n[s.JD_ID] = (n[s.JD_ID] || 0) + 1; });
  readTable_('JDM_Skills').rows.forEach(function (s) { if (String(s.Status) === 'Active') k[s.JD_ID] = (k[s.JD_ID] || 0) + 1; });
  const dup = {}; jdmDupGroups_(tpl).forEach(function (g) { g.ids.forEach(function (id) { dup[id] = g; }); });
  const req = jdmReqCounts_();
  const cols = ['id', 'fn', 'family', 'unit', 'dept', 'desig', 'grade', 'band', 'basis', 'cdept', 'status', 'primary', 'gOk', 'dOk', 'dup', 'dupOk', 'stmts', 'skills', 'exp', 'raisedTo', 'note', 'reqs', 'effExp'];
  const rows = tpl.map(function (t) {
    const e = jdmEffExp_(t), g = dup[t.JD_ID];
    return [String(t.JD_ID), String(t.Function), String(t.Job_Family), String(t.Unit), String(t.Department || t.Division || ''), String(t.Designation), String(t.Grade), String(t.Grade_Band),
      String(t.Grade_Basis), String(t.Competency_Dept), String(t.Status), String(t.Primary_JD), t.Grade_Confirmed_By ? 1 : 0, t.Dept_Confirmed_By ? 1 : 0,
      g ? g.key : '', t.Dup_Confirmed_By ? 1 : 0, n[t.JD_ID] || 0, k[t.JD_ID] || 0, e.stated == null ? '' : e.stated,
      e.raised ? e.effective : 0, String(t.Review_Note || ''), (req[t.Competency_Dept] || {})[t.Grade] || 0, e.effective == null ? '' : e.effective];
  });
  return { cols: cols, rows: rows, compDepts: jdmCompDepts_(), grades: JDM_GRADES_ };
}

/** A job profile with everything the JD maker will use: responsibilities, skills, competencies at its grade, norms. */
function apiJdmTemplate(jdId) {
  currentUser_(); ensureSchema_();
  const t = readTable_('JDM_Templates').rows.filter(function (x) { return String(x.JD_ID) === String(jdId); })[0];
  if (!t) throw new Error('Job profile ' + jdId + ' was not found.');
  const stmts = readTable_('JDM_Statements').rows.filter(function (s) { return String(s.JD_ID) === String(jdId); })
    .map(function (s) { return { id: String(s.Stmt_ID), seq: Number(s.Seq) || 0, area: String(s.KRA_Area), cat: String(s.KRA_Category), text: String(s.Text), source: String(s.Source), status: String(s.Status) }; })
    .sort(function (a, b) { return a.seq - b.seq; });
  const skills = readTable_('JDM_Skills').rows.filter(function (s) { return String(s.JD_ID) === String(jdId); })
    .map(function (s) { return { id: String(s.Skill_ID), seq: Number(s.Seq) || 0, text: String(s.Text), type: String(s.Skill_Type), link: String(s.Framework_Link), source: String(s.Source), status: String(s.Status) }; })
    .sort(function (a, b) { return a.seq - b.seq; });
  const fit = jdmSkillFit_(skills, String(t.Competency_Dept));
  skills.forEach(function (s, i) { s.fit = fit[i].fit; s.code = fit[i].code; s.codeName = fit[i].name; });
  return { t: toClient_(Object.assign({}, t, { _row: undefined })), stmts: stmts, skills: skills, comps: jdmCompetenciesAt_(String(t.Competency_Dept), String(t.Grade)),
    norms: jdmNormsFor_(t), exp: jdmEffExp_(t), categories: readTable_('JDM_KRA_Categories').rows.map(function (c) { return String(c.Category); }), compDepts: jdmCompDepts_() };
}
/** Department + common-core competencies with the level required at a grade and that level's definition. */
function jdmCompetenciesAt_(dept, grade) {
  const defs = {}; readTable_('JDM_Competencies').rows.forEach(function (c) { defs[c.Code] = c; });
  return readTable_('JDM_Comp_Levels').rows.filter(function (r) { return r.Comp_Dept === dept || r.Comp_Dept === JDM_COMMON_; }).map(function (r) {
    const lvl = r[grade] === '' || r[grade] == null ? null : Number(r[grade]), d = defs[r.Code] || {};
    return { code: String(r.Code), name: String(r.Competency), cat: String(r.Category), crit: String(r.Criticality), common: r.Comp_Dept === JDM_COMMON_,
      level: lvl, def: lvl ? String(d['L' + lvl] || '') : '', assess: String(d.Assessment || '') };
  }).filter(function (c) { return c.level; });
}
function jdmNormsFor_(t) {
  const g = readTable_('JDM_Grades').rows.filter(function (x) { return String(x.Grade) === String(t.Grade); })[0] || {};
  const band = String(t.Grade_Band || g.Grade_Band || '');
  const q = readTable_('JDM_Qual_Norms').rows.filter(function (x) { return String(x.Job_Family) === String(t.Job_Family); })[0];
  const policy = jdmPolicyExp_(t.Grade, t.Designation);
  return { band: band, gradeDesc: String(g.Description || ''), recExp: String(g.Recommended_Exp || ''), effRange: jdmEffRange_(g.Recommended_Exp, policy), policy: policy,
    qualNorm: q ? String(q[band] || '') : '', bandKras: readTable_('JDM_Band_KRAs').rows.filter(function (b) { return String(b.Grade_Band) === band; }).map(function (b) { return String(b.Text); }) };
}
function apiJdmNorms() {
  currentUser_(); ensureSchema_();
  const stmtCats = {}; readTable_('JDM_Statements').rows.forEach(function (s) { if (String(s.Status) === 'Active') stmtCats[s.KRA_Category] = (stmtCats[s.KRA_Category] || 0) + 1; });
  return {
    grades: readTable_('JDM_Grades').rows.map(function (g) { const p = jdmPolicyExp_(g.Grade), low = jdmRecLow_(g.Recommended_Exp), jm = String(g.Grade) === 'M5' ? jdmPolicyExp_('M5', 'Junior Manager') : null;
      return { grade: String(g.Grade), desc: String(g.Description), band: String(g.Grade_Band), typical: String(g.Typical_Designations), rec: String(g.Recommended_Exp),
        policy: p, jm: jm, effective: jdmEffRange_(g.Recommended_Exp, p), effectiveJm: jm ? jdmEffRange_(g.Recommended_Exp, jm) : '',
        conflict: !!(p && low != null && low < (jm ? jm.degree : p.degree)) }; }).sort(function (a, b) { return jdmGradeOrder_(a.grade) - jdmGradeOrder_(b.grade); }),
    bands: JDM_.Qual_Norms.slice(1),
    qual: readTable_('JDM_Qual_Norms').rows.map(function (q) { const o = { family: String(q.Job_Family) }; JDM_.Qual_Norms.slice(1).forEach(function (b) { o[b] = String(q[b] || ''); }); return o; }),
    bandKras: readTable_('JDM_Band_KRAs').rows.map(function (b) { return { band: String(b.Grade_Band), text: String(b.Text) }; }),
    categories: readTable_('JDM_KRA_Categories').rows.map(function (c) { return { name: String(c.Category), covers: String(c.Covers), n: stmtCats[c.Category] || 0 }; }),
    notes: readTable_('JDM_Review_Notes').rows.map(function (r) { return { issue: String(r.Issue), id: String(r.JD_ID), role: String(r.Role), detail: String(r.Detail), action: String(r.Action) }; })
  };
}
function apiJdmDeptMap() {
  const u = currentUser_(); ensureSchema_();
  const open = {}, all = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { const d = String(l.Dept || '').trim(); all[d] = (all[d] || 0) + 1; if (['Open', 'Offered'].indexOf(positionStatus_(l)) >= 0) open[d] = (open[d] || 0) + 1; });
  return { canManage: can_(u, 'jd_manage'), compDepts: jdmCompDepts_(),
    rows: readTable_('JDM_Dept_Map').rows.map(function (r) { const d = String(r.CRM_Dept);
      return { dept: d, comp: String(r.Competency_Dept), basis: String(r.Basis), by: String(r.Confirmed_By), on: ymd_(r.Confirmed_On), note: String(r.Note), lines: all[d] || 0, open: open[d] || 0 }; }) };
}

/* ---------------- sign-off and editing (TA Lead, Head of HR, Admin) ---------------- */

function jdmManage_(u) { if (!can_(u, 'jd_manage')) throw new Error('Only a TA Lead, the Head of HR or the admin can change the JD library.'); }
/** Writes many rows of one JDM sheet in one go, with one audit row per changed field. */
function jdmBulk_(name, idCol, ids, patchFn, u) {
  return withLock_(function () {
    const t = readTable_(name, true), want = {}; ids.forEach(function (id) { want[String(id)] = true; });
    const audit = [], now = new Date(); let n = 0;
    t.rows.forEach(function (r) {
      if (!want[String(r[idCol])]) return;
      const p = patchFn(r); if (!p) return;
      let changed = false;
      Object.keys(p).forEach(function (k) {
        if (k.charAt(0) === '_') return;
        const before = r[k] instanceof Date ? ymd_(r[k]) : String(r[k] == null ? '' : r[k]), after = p[k] instanceof Date ? ymd_(p[k]) : String(p[k] == null ? '' : p[k]);
        if (before !== after) { audit.push([now, u.email, name, String(r[idCol]), 'Update', k, clean_(before), clean_(after)]); r[k] = p[k]; changed = true; }
      });
      if (!changed) return;
      if (t.headers.indexOf('Updated_By') >= 0 && !p._noTouch) { r.Updated_By = u.email; r.Updated_At = now; }
      t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return r[h] === undefined ? '' : jdmSafeText_(r[h]); })]);
      n++;
    });
    if (audit.length) { const a = sheet_('Audit_Log'); a.getRange(a.getLastRow() + 1, 1, audit.length, 8).setValues(audit); }
    dropStale_(name);
    return n;
  });
}
/** Confirms the grade, the competency department or the duplicate decision for a list of job profiles as they stand. */
function apiJdmConfirm(ids, what) {
  const u = currentUser_(); jdmManage_(u);
  if (['grade', 'dept', 'dup'].indexOf(what) < 0) throw new Error('Unknown confirmation.');
  if (!ids || !ids.length) throw new Error('Nothing to confirm.');
  const f = { grade: 'Grade_Confirmed', dept: 'Dept_Confirmed', dup: 'Dup_Confirmed' }[what];
  const req = what === 'dept' ? jdmReqCounts_() : null, skipped = [];
  const n = jdmBulk_('JDM_Templates', 'JD_ID', ids, function (r) {
    if (r[f + '_By']) return null;
    if (what === 'dept' && !(req[String(r.Competency_Dept)] || {})[String(r.Grade)]) { skipped.push(String(r.JD_ID)); return null; }
    const p = { _noTouch: true }; p[f + '_By'] = u.email; p[f + '_On'] = parseYmd_(ymd_(new Date())); return p;
  }, u);
  return { confirmed: n, skipped: skipped };
}
/** Makes one profile the primary of its duplicate group (the others become variants) and confirms the whole group. */
function apiJdmSetPrimary(jdId) {
  const u = currentUser_(); jdmManage_(u);
  const tpl = readTable_('JDM_Templates', true).rows;
  const g = jdmDupGroups_(tpl).filter(function (x) { return x.ids.indexOf(String(jdId)) >= 0; })[0];
  if (!g) throw new Error(jdId + ' is not part of a duplicate group.');
  const today = parseYmd_(ymd_(new Date()));
  jdmBulk_('JDM_Templates', 'JD_ID', g.ids, function (r) {
    const primary = String(r.JD_ID) === String(jdId);
    return { Status: primary ? 'Active' : (String(r.Status) === 'Retired' ? 'Retired' : 'Variant'), Primary_JD: primary ? '' : String(jdId),
      Version_Status: primary ? 'Primary' : 'Variant of ' + jdId, Dup_Confirmed_By: u.email, Dup_Confirmed_On: today };
  }, u);
  return { group: g.ids, primary: jdId };
}
function apiJdmSaveTemplate(d) {
  const u = currentUser_(); jdmManage_(u); d = d || {};
  const t = readTable_('JDM_Templates', true).rows.filter(function (x) { return String(x.JD_ID) === String(d.JD_ID); })[0];
  if (!t) throw new Error('Job profile ' + d.JD_ID + ' was not found.');
  const patch = {};
  JDM_EDIT_FIELDS_.forEach(function (k) { if (k in d) patch[k] = typeof d[k] === 'string' ? clean_(d[k]) : d[k]; });
  if (!String(patch.Designation == null ? t.Designation : patch.Designation).trim()) throw new Error('The designation cannot be empty.');
  if ('Grade' in patch) {
    patch.Grade = String(patch.Grade).toUpperCase();
    if (JDM_GRADES_.indexOf(patch.Grade) < 0) throw new Error('Pick a BFCL grade.');
    const g = readTable_('JDM_Grades').rows.filter(function (x) { return String(x.Grade) === patch.Grade; })[0];
    if (g) patch.Grade_Band = String(g.Grade_Band);
  }
  if ('Competency_Dept' in patch && patch.Competency_Dept && jdmCompDepts_().indexOf(patch.Competency_Dept) < 0) throw new Error('Pick a department from the Skill Competency Framework.');
  if ('Min_Total_Exp' in patch && patch.Min_Total_Exp !== '') {
    const n = Number(patch.Min_Total_Exp); if (isNaN(n) || n < 0 || n > 40) throw new Error('Minimum experience must be a number of years from 0 to 40.');
    const p = jdmPolicyExp_(patch.Grade || t.Grade, patch.Designation || t.Designation);
    if (p && n < p.degree) throw new Error('The Recruitment Policy (Appendix F) sets at least ' + p.degree + ' years for ' + p.rule + (p.iti ? ' (' + p.iti + ' with 12th/ITI)' : '') + '. Enter ' + p.degree + ' or more.');
    patch.Min_Total_Exp = n;
  }
  if ('Status' in patch && ['Active', 'Variant', 'Retired'].indexOf(patch.Status) < 0) throw new Error('Status must be Active, Variant or Retired.');
  if (patch.Status === 'Variant' && !String(patch.Primary_JD || t.Primary_JD || '').trim()) throw new Error('Say which job profile this is a variant of.');
  if (patch.Status && patch.Status !== 'Variant') patch.Primary_JD = '';
  const today = parseYmd_(ymd_(new Date()));
  if (d.confirmGrade || ('Grade' in patch && patch.Grade !== String(t.Grade))) { patch.Grade_Confirmed_By = u.email; patch.Grade_Confirmed_On = today; }
  if (d.confirmDept || ('Competency_Dept' in patch && patch.Competency_Dept !== String(t.Competency_Dept))) {
    const cd = patch.Competency_Dept == null ? String(t.Competency_Dept) : patch.Competency_Dept, gr = patch.Grade || String(t.Grade);
    if (!cd) throw new Error('Pick the competency department before confirming it.');
    if (!(jdmReqCounts_()[cd] || {})[gr]) throw new Error('The Skill Competency Framework has no ' + cd + ' competencies required at ' + gr + '. Pick the department whose framework matrix covers this role at this grade.');
    patch.Dept_Confirmed_By = u.email; patch.Dept_Confirmed_On = today;
  }
  update_(T.JDMT, t.JD_ID, patch, u);
  return apiJdmTemplate(t.JD_ID);
}
function jdmTextKey_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
/** Adds, edits, retires or restores a responsibility (kind 'stmt') or skill (kind 'skill') of a job profile. */
function apiJdmSaveItem(kind, d) {
  const u = currentUser_(); jdmManage_(u); d = d || {};
  const def = kind === 'skill' ? T.JDMK : T.JDMS, idc = def.id;
  const tpl = readTable_('JDM_Templates').rows.filter(function (x) { return String(x.JD_ID) === String(d.JD_ID); })[0];
  if (!tpl) throw new Error('Job profile ' + d.JD_ID + ' was not found.');
  const rows = readTable_(def.name, true).rows;
  const cur = d[idc] ? rows.filter(function (r) { return String(r[idc]) === String(d[idc]); })[0] : null;
  if (d[idc] && !cur) throw new Error('That item was not found. Reload the job profile.');
  const text = clean_(String(d.Text == null ? (cur ? cur.Text : '') : d.Text)).replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Write the ' + (kind === 'skill' ? 'skill' : 'responsibility') + '.');
  if (text.length > 600) throw new Error('Keep it under 600 characters.');
  const status = d.Status || (cur ? String(cur.Status) : 'Active');
  if (['Active', 'Retired'].indexOf(status) < 0) throw new Error('Unknown status.');
  if (status === 'Active') {
    const key = jdmTextKey_(text);
    const clash = rows.filter(function (r) { return String(r.JD_ID) === String(d.JD_ID) && String(r.Status) === 'Active' && (!cur || r[idc] !== cur[idc]) && jdmTextKey_(r.Text) === key; })[0];
    if (clash) throw new Error('This job profile already has that ' + (kind === 'skill' ? 'skill' : 'responsibility') + ' (' + clash[idc] + ').');
  }
  const patch = { Text: text, Status: status };
  if (kind === 'skill') {
    const ty = String(d.Skill_Type == null ? (cur ? cur.Skill_Type : '') : d.Skill_Type);
    if (['Technical / Functional', 'Behavioural / Leadership'].indexOf(ty) < 0) throw new Error('Pick the skill type.');
    patch.Skill_Type = ty;
  } else {
    const cat = String(d.KRA_Category == null ? (cur ? cur.KRA_Category : '') : d.KRA_Category);
    if (readTable_('JDM_KRA_Categories').rows.map(function (c) { return String(c.Category); }).indexOf(cat) < 0) throw new Error('Pick the KRA category.');
    patch.KRA_Category = cat;
    if ('KRA_Area' in d) patch.KRA_Area = clean_(String(d.KRA_Area || '')).trim();
  }
  if (cur) { update_(def, cur[idc], patch, u); return { id: cur[idc] }; }
  const seq = rows.filter(function (r) { return String(r.JD_ID) === String(d.JD_ID); }).reduce(function (m, r) { return Math.max(m, Number(r.Seq) || 0); }, 0) + 1;
  const rec = insert_(def, Object.assign({ JD_ID: tpl.JD_ID, Seq: seq, Source: 'App', KRA_Area: patch.KRA_Area || patch.KRA_Category || '' }, patch), u);
  return { id: rec[idc] };
}
function apiJdmSaveResponsibilityChanges(jdId, payload) {
  const u = currentUser_(); jdmManage_(u); ensureSchema_();
  jdId = String(jdId || '');
  const tpl = readTable_('JDM_Templates').rows.filter(function (x) { return String(x.JD_ID) === jdId; })[0];
  if (!tpl) throw new Error('Job profile ' + jdId + ' was not found.');
  payload = payload || {};
  const addedCats = payload.addedCategories || [], modifiedCats = payload.modifiedCategories || [];
  const added = payload.addedResponsibilities || [], modified = payload.modifiedResponsibilities || [];
  const deleted = payload.deletedResponsibilities || [], reordered = payload.reorderedResponsibilities || [];
  function normCat(v) {
    const s = clean_(String(v || '')).replace(/\s+/g, ' ').trim();
    if (!s) throw new Error('Write the responsibility category.');
    if (s.length > 120) throw new Error('Keep category names under 120 characters.');
    return s;
  }
  function normText(v) {
    const s = clean_(String(v || '')).replace(/\s+/g, ' ').trim();
    if (!s) throw new Error('Write the responsibility.');
    if (s.length > 600) throw new Error('Keep responsibilities under 600 characters.');
    return s;
  }
  return withLock_(function () {
    const catT = readTable_('JDM_KRA_Categories', true);
    const catSet = {};
    catT.rows.forEach(function (c) { catSet[String(c.Category)] = c; });
    const catAudit = [], now = new Date(), catAdds = [];
    addedCats.forEach(function (c) {
      const name = normCat(c.name || c.Category);
      if (!catSet[name]) {
        catAdds.push({ Category: name, Covers: clean_(String(c.description || c.Covers || '')).slice(0, 500), Area_Names: name });
        catSet[name] = { Category: name };
        catAudit.push([now, u.email, 'JDM_KRA_Categories', name, 'Create', 'Category', '', name]);
      }
    });
    if (catAdds.length) catT.sheet.getRange(catT.sheet.getLastRow() + 1, 1, catAdds.length, catT.headers.length).setValues(catAdds.map(function (c) {
      return catT.headers.map(function (h) { return c[h] === undefined ? '' : jdmSafeText_(c[h]); });
    }));
    const rename = {};
    modifiedCats.forEach(function (c) {
      const oldName = normCat(c.id || c.oldName || c.Category);
      const newName = normCat(c.name || c.newName);
      if (oldName === newName) return;
      if (catSet[newName] && oldName !== newName) throw new Error('Category ' + newName + ' already exists.');
      const row = catSet[oldName];
      if (!row) throw new Error('Category ' + oldName + ' was not found.');
      row.Category = newName; row.Area_Names = row.Area_Names || newName;
      catT.sheet.getRange(row._row, 1, 1, catT.headers.length).setValues([catT.headers.map(function (h) { return row[h] === undefined ? '' : jdmSafeText_(row[h]); })]);
      delete catSet[oldName]; catSet[newName] = row; rename[oldName] = newName;
      catAudit.push([now, u.email, 'JDM_KRA_Categories', oldName, 'Update', 'Category', oldName, newName]);
    });
    if (catAudit.length) { const a = sheet_('Audit_Log'); a.getRange(a.getLastRow() + 1, 1, catAudit.length, 8).setValues(catAudit); }
    dropStale_('JDM_KRA_Categories');
    const rows = readTable_('JDM_Statements', true).rows;
    const byId = {}; rows.forEach(function (r) { byId[String(r.Stmt_ID)] = r; });
    function validCat(v) {
      const c = normCat(rename[String(v)] || v);
      if (!catSet[c]) throw new Error('Pick the KRA category.');
      return c;
    }
    const activeText = {};
    rows.forEach(function (r) {
      if (String(r.JD_ID) === jdId && String(r.Status) === 'Active') activeText[jdmTextKey_(r.Text)] = String(r.Stmt_ID);
    });
    function ensureUnique(text, id) {
      const k = jdmTextKey_(text), other = activeText[k];
      if (other && other !== String(id || '')) throw new Error('This job profile already has that responsibility (' + other + ').');
      activeText[k] = String(id || k);
    }
    const updateIds = [], patches = {};
    modified.forEach(function (r) {
      const id = String(r.id || r.Stmt_ID || ''), cur = byId[id];
      if (!cur || String(cur.JD_ID) !== jdId) throw new Error('Responsibility ' + id + ' was not found in ' + jdId + '.');
      const text = normText(r.text || r.Text), cat = validCat(r.category || r.KRA_Category || cur.KRA_Category);
      if (jdmTextKey_(text) !== jdmTextKey_(cur.Text)) delete activeText[jdmTextKey_(cur.Text)];
      ensureUnique(text, id);
      updateIds.push(id); patches[id] = { Text: text, Seq: Number(r.seq || r.Seq) || Number(cur.Seq) || 1, KRA_Category: cat, KRA_Area: clean_(String(r.area || r.KRA_Area || cat)).slice(0, 300), Status: 'Active' };
    });
    deleted.forEach(function (r) {
      const id = String(r.id || r.Stmt_ID || ''), cur = byId[id];
      if (!cur || String(cur.JD_ID) !== jdId) throw new Error('Responsibility ' + id + ' was not found in ' + jdId + '.');
      delete activeText[jdmTextKey_(cur.Text)];
      updateIds.push(id); patches[id] = Object.assign(patches[id] || {}, { Status: 'Retired' });
    });
    reordered.forEach(function (r) {
      const id = String(r.id || r.Stmt_ID || ''), cur = byId[id];
      if (!cur || String(cur.JD_ID) !== jdId) return;
      updateIds.push(id); patches[id] = Object.assign(patches[id] || {}, { Seq: Number(r.seq || r.Seq) || Number(cur.Seq) || 1, KRA_Category: validCat(r.category || r.KRA_Category || cur.KRA_Category), KRA_Area: clean_(String(r.area || r.KRA_Area || r.category || cur.KRA_Area || cur.KRA_Category || '')).slice(0, 300) });
    });
    if (updateIds.length) jdmBulk_('JDM_Statements', 'Stmt_ID', updateIds, function (row) { return patches[String(row.Stmt_ID)]; }, u);
    let nextSeq = rows.filter(function (r) { return String(r.JD_ID) === jdId; }).reduce(function (m, r) { return Math.max(m, Number(r.Seq) || 0); }, 0) + 1;
    added.forEach(function (r) {
      const text = normText(r.text || r.Text), cat = validCat(r.category || r.KRA_Category);
      ensureUnique(text, '');
      insert_(T.JDMS, { JD_ID: jdId, Seq: Number(r.seq || r.Seq) || nextSeq++, KRA_Area: clean_(String(r.area || r.KRA_Area || cat)).slice(0, 300),
        KRA_Category: cat, Text: text, Source: 'App', Status: 'Active' }, u);
    });
    dropStale_('JDM_Statements');
    audit_(u, 'JDM_Statements', jdId, 'Update', 'responsibilities', '', 'Batch save: +' + added.length + ', edited ' + modified.length + ', retired ' + deleted.length + ', reordered ' + reordered.length);
    return { saved: true, counts: { addedCategories: catAdds.length, modifiedCategories: modifiedCats.length, addedResponsibilities: added.length, modifiedResponsibilities: modified.length, deletedResponsibilities: deleted.length, reorderedResponsibilities: reordered.length } };
  });
}
function apiJdmSaveDeptMap(d) {
  const u = currentUser_(); jdmManage_(u); d = d || {};
  const r = readTable_('JDM_Dept_Map', true).rows.filter(function (x) { return String(x.CRM_Dept) === String(d.dept); })[0];
  if (!r) throw new Error('Department ' + d.dept + ' was not found.');
  const comp = String(d.comp || '');
  if (comp && jdmCompDepts_().indexOf(comp) < 0) throw new Error('Pick a department from the Skill Competency Framework.');
  const today = parseYmd_(ymd_(new Date()));
  const patch = comp ? { Competency_Dept: comp, Basis: comp === String(r.Competency_Dept) && String(r.Basis) === 'Exact' ? 'Exact' : 'Confirmed', Confirmed_By: u.email, Confirmed_On: today }
    : { Competency_Dept: '', Basis: 'Not mapped', Confirmed_By: '', Confirmed_On: '' };
  if ('note' in d) patch.Note = clean_(String(d.note || '')).slice(0, 300);
  jdmBulk_('JDM_Dept_Map', 'CRM_Dept', [r.CRM_Dept], function () { return patch; }, u);
  return apiJdmDeptMap();
}

/* ---------------- JD Maker (phase 2): compose a JD for a position from the JD Master ---------------- */

JDM_.Drafts = ['Draft_ID', 'Line_ID', 'MRF_No', 'Version', 'Template_ID', 'Status', 'File_URL', 'Flags', 'Draft_JSON', 'Created_By', 'Created_At'];
T.JDMDR = { name: 'JDM_Drafts', id: 'Draft_ID', prefix: 'JDD-', width: 5, dates: [], editable: [] };
const JDM_STOP_ = ['and', 'the', 'for', 'of', 'in', 'cum', 'incharge', 'charge', 'with', 'to',
  'manager', 'mgr', 'senior', 'sr', 'junior', 'jr', 'assistant', 'asst', 'deputy', 'dy', 'head', 'officer', 'executive', 'general', 'gm', 'agm', 'dgm', 'sgm',
  'chief', 'lead', 'trainee', 'vice', 'president', 'avp', 'svp', 'vp'];
function jdmGradeKey_(g) { g = String(g || '').trim().toUpperCase(); return /^T\d$/.test(g) ? 'T' : g; }
function jdmBandOf_(g) {
  const k = jdmGradeKey_(g), r = readTable_('JDM_Grades').rows.filter(function (x) { return String(x.Grade) === k; })[0];
  return r ? { band: String(r.Grade_Band), desc: String(r.Description), rec: String(r.Recommended_Exp) } : { band: '', desc: '', rec: '' };
}
function jdmWords_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter(function (w) { return w.length > 1 && JDM_STOP_.indexOf(w) < 0; }).map(function (w) { return w === 'e' || w === 'i' ? 'ei' : w.length > 3 && !/ss$/.test(w) ? w.replace(/s$/, '') : w; });
}
function jdmIsMgmt_(band) { return /officer|management/i.test(band); }
/** Library profiles most like the position: same framework department, similar designation, nearby grade. */
function jdmCandidates_(line, compDept) {
  const words = jdmWords_(line.Position), g = jdmGradeKey_(line.Grade), gi = JDM_GRADES_.indexOf(g), band = jdmBandOf_(g).band;
  return readTable_('JDM_Templates').rows.filter(function (t) { return String(t.Status) === 'Active'; }).map(function (t) {
    let s = 0; const why = [], dm = !!compDept && String(t.Competency_Dept) === compDept;
    if (dm) { s += 5; why.push('same competency department'); }
    const tw = jdmWords_(t.Designation), shared = words.filter(function (w, i) { return tw.indexOf(w) >= 0 && words.indexOf(w) === i; });
    if (shared.length) { s += Math.min(6, 2 * shared.length); why.push('designation: ' + shared.join(', ')); }
    const tg = String(t.Grade), ti = JDM_GRADES_.indexOf(tg);
    if (tg === g) { s += 3; why.push('same grade'); } else if (String(t.Grade_Band) === band) { s += 2; why.push('same grade band'); } else if (Math.abs(ti - gi) === 1) { s += 1; why.push('adjacent grade'); }
    return { id: String(t.JD_ID), designation: String(t.Designation), grade: tg, band: String(t.Grade_Band), cdept: String(t.Competency_Dept), score: s, reasons: why,
      deptMatch: dm, titleMatch: shared.length, dist: ti < 0 || gi < 0 ? 99 : Math.abs(ti - gi) };
  }).filter(function (c) { return c.score >= 3 && (c.deptMatch || c.titleMatch > 0); })
    .sort(function (a, b) { return b.score - a.score || a.dist - b.dist || a.id.localeCompare(b.id); }).slice(0, 6);
}
/** Composes the JD for a position. templateId: a library profile to use, 'none' for standards only, or empty for the best match. */
function apiJdmDraftForLine(lineId, templateId) {
  const u = currentUser_(); ensureSchema_();
  const line = lineOf_(lineId);
  if (!line) throw new Error('Position ' + lineId + ' was not found.');
  if (!Number(PropertiesService.getScriptProperties().getProperty('JDM_VERSION') || 0)) throw new Error('The JD library has not been imported yet (JD Master).');
  const g = String(line.Grade || '').trim().toUpperCase(), gk = jdmGradeKey_(g);
  if (JDM_GRADES_.indexOf(gk) < 0) throw new Error('Set the position\u2019s grade before creating its JD.');
  const flags = [], gb = jdmBandOf_(gk), band = gb.band;
  let compDept = jdmDeptFor_(line.Dept);
  const cands = jdmCandidates_(line, compDept);
  const all = {}; readTable_('JDM_Templates').rows.forEach(function (t) { all[String(t.JD_ID)] = t; });
  const workman = /^W/.test(gk);
  let tpl = null;
  if (templateId === 'none') tpl = null;
  else if (templateId) { tpl = all[String(templateId)] || null; if (!tpl) throw new Error('Library profile ' + templateId + ' was not found.'); }
  else {
    const best = cands.filter(function (c) { return workman ? (c.band === band && c.deptMatch && c.titleMatch > 0) : true; })[0];
    tpl = best ? all[best.id] : null;
  }
  if (!compDept && tpl) { compDept = String(tpl.Competency_Dept); flags.push({ level: 'warn', text: 'Department ' + line.Dept + ' is not mapped to the Skill Competency Framework; competencies are taken from ' + compDept + ' (the library profile\u2019s department). Map it in JD Master \u2192 Departments.' }); }
  if (!compDept) flags.push({ level: 'warn', text: 'Department ' + line.Dept + ' is not mapped to the Skill Competency Framework, so only common-core competencies are listed. Map it in JD Master \u2192 Departments.' });
  const tBand = tpl ? String(tpl.Grade_Band) : '';
  const useDuties = !!tpl && (tBand === band || (jdmIsMgmt_(tBand) && jdmIsMgmt_(band)));
  if (tpl && !useDuties) flags.push({ level: 'warn', text: 'Profile ' + tpl.JD_ID + ' (' + tpl.Grade + ') is in a different cadre from ' + g + '; only its job family is used. Responsibilities come from the ' + band + ' standards.' });
  if (useDuties && String(tpl.Grade) !== gk) flags.push({ level: 'info', text: 'Responsibilities are from ' + tpl.JD_ID + ' at ' + tpl.Grade + ', re-levelled to ' + g + ': review items that belong to a different level.' });
  if (!tpl && workman) flags.push({ level: 'warn', text: 'No standard workman profile exists yet for this trade. Responsibilities are the ' + band + ' standards; add the trade duties with the HOD.' });
  else if (!tpl) flags.push({ level: 'warn', text: 'No matching library profile. Responsibilities are the ' + band + ' standards; add role duties with the HOD.' });
  const groups = [];
  if (useDuties) {
    const by = {}, seen = {};
    readTable_('JDM_Statements').rows.filter(function (s) { return String(s.JD_ID) === String(tpl.JD_ID) && String(s.Status) === 'Active'; })
      .sort(function (a, b) { return (Number(a.Seq) || 0) - (Number(b.Seq) || 0); }).forEach(function (s) {
        const k = jdmTextKey_(s.Text); if (seen[k]) return; seen[k] = true;
        const c = String(s.KRA_Category || 'Other / Function-specific'); (by[c] = by[c] || []).push({ id: String(s.Stmt_ID), text: String(s.Text) });
      });
    Object.keys(by).forEach(function (c) { groups.push({ cat: c, items: by[c] }); });
  }
  const bandKras = readTable_('JDM_Band_KRAs').rows.filter(function (b) { return String(b.Grade_Band) === band; }).map(function (b) { return String(b.Text); });
  const comps = jdmCompetenciesAt_(compDept || '__none__', gk).map(function (c) { return { name: c.name, level: c.level, crit: c.crit, common: c.common }; });
  const skills = { tech: [], beh: [] };
  if (useDuties) readTable_('JDM_Skills').rows.filter(function (s) { return String(s.JD_ID) === String(tpl.JD_ID) && String(s.Status) === 'Active'; })
    .forEach(function (s) { (/^Behav/i.test(String(s.Skill_Type)) ? skills.beh : skills.tech).push(String(s.Text)); });
  let family = tpl ? String(tpl.Job_Family) : '';
  if (!family && compDept) {
    const cnt = {}; readTable_('JDM_Templates').rows.forEach(function (t) { if (String(t.Competency_Dept) === compDept && t.Job_Family) cnt[t.Job_Family] = (cnt[t.Job_Family] || 0) + 1; });
    family = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0] || '';
    const fnPart = String(compDept).split('-').slice(1).join('-').trim().toLowerCase();
    if (!family && fnPart) {
      const c2 = {}; readTable_('JDM_Templates').rows.forEach(function (t) { const f = String(t.Competency_Dept).split('-').slice(1).join('-').trim().toLowerCase(); if (f === fnPart && t.Job_Family) c2[t.Job_Family] = (c2[t.Job_Family] || 0) + 1; });
      family = Object.keys(c2).sort(function (a, b) { return c2[b] - c2[a]; })[0] || '';
    }
  }
  const q = family ? readTable_('JDM_Qual_Norms').rows.filter(function (x) { return String(x.Job_Family) === family; })[0] : null;
  const qual = q ? String(q[band] || '') : '';
  if (qual && !tpl) flags.push({ level: 'info', text: 'Qualification norm taken from the ' + family + ' job family, the usual family for ' + compDept + '.' });
  if (!qual) flags.push({ level: 'warn', text: 'No qualification norm could be found: enter the minimum qualification with the HOD.' });
  const pol = jdmPolicyExp_(gk, lineTitle_(line)), stated = useDuties && String(tpl.Grade) === gk && tpl.Min_Total_Exp !== '' ? Number(tpl.Min_Total_Exp) : null;
  let expMin, expNote;
  if (pol) { expMin = Math.max(pol.degree, stated == null ? 0 : stated); expNote = stated != null && stated < pol.degree ? 'Recruitment Policy Appendix F minimum; supersedes the ' + stated + ' yrs in profile ' + tpl.JD_ID + '.' : 'Recruitment Policy Appendix F (' + pol.rule + ').'; }
  else { const low = jdmRecLow_(gb.rec); expMin = stated != null ? stated : low; expNote = stated != null ? 'From profile ' + tpl.JD_ID + '.' : 'Grade norm for ' + gk + ' (' + gb.rec + ' yrs).'; }
  flags.push({ level: 'info', text: 'Working conditions and preferred experience are to be confirmed with the HOD.' });
  const ver = Number(PropertiesService.getScriptProperties().getProperty('JDM_VERSION') || 0);
  const prev = readTable_('JDM_Drafts').rows.filter(function (r) { return String(r.Line_ID) === String(lineId); }).length;
  return {
    lineId: String(line.Line_ID), jdRef: String(line.MRF_No || line.Line_ID), version: (prev + 1) + '.0', canSave: canEditLine_(u, line), recruiter: String(line.Recruiter || ''),
    designation: String(line.Position), grade: g, band: band, gradeTitle: String(line.Designation || ''), category: workman ? 'Workman' : gk === 'T' ? 'Trainee' : /^W[12]$/.test(gk) ? 'Supervisory' : 'Staff',
    fn: tpl ? String(tpl.Function) : '', family: family, dept: String(line.Dept), unit: tpl ? String(tpl.Unit) : '', reportsTo: tpl && useDuties ? String(tpl.Reports_To) : '', reportees: tpl && useDuties ? String(tpl.Reportees) : '',
    compDept: compDept || '', summary: useDuties ? String(tpl.Role_Summary || '') : '', groups: groups, bandKras: bandKras, comps: comps, skills: skills,
    qualification: qual, qualNote: qual ? 'Norm for ' + family + ', ' + band + '.' : '', expMin: expMin == null ? '' : expMin, expIti: pol && pol.iti ? pol.iti : '', expNote: expNote,
    expRelevant: useDuties ? String(tpl.Experience_Text || '') : '', preferred: '', working: '',
    template: tpl ? { id: String(tpl.JD_ID), designation: String(tpl.Designation), grade: String(tpl.Grade), used: useDuties } : null, candidates: cands, flags: flags,
    source: 'JD Master L' + ver + (tpl ? ', profile ' + tpl.JD_ID : ', standards only') + '; Skill Competency Framework; Recruitment Policy v2.0 Appendix F.'
  };
}
/** Saves the generated Word JD into the JD folder, attaches it to the position and records the version. */
function apiJdmSaveJd(lineId, fileName, base64, draft) {
  const u = currentUser_(); ensureSchema_();
  const line = lineOf_(lineId);
  if (!line) throw new Error('Position ' + lineId + ' was not found.');
  if (!canEditLine_(u, line)) throw new Error('Only ' + line.Recruiter + ', a TA Lead or the Head of HR can attach a JD to this position.');
  const d = draft || {};
  _pdocSource = 'Create JD (JD Master' + (d.template ? ', profile ' + d.template.id : ', standards only') + ')';
  const url = apiUploadDoc('MRF', lineId, 'JD_File', fileName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', base64);
  const rows = readTable_('JDM_Drafts', true).rows.filter(function (r) { return String(r.Line_ID) === String(lineId); });
  insert_(T.JDMDR, { Line_ID: String(lineId), MRF_No: String(line.MRF_No || ''), Version: (rows.length + 1) + '.0', Template_ID: d.template ? String(d.template.id) : 'standards only',
    Status: 'Generated', File_URL: url, Flags: (d.flags || []).map(function (f) { return f.text; }).join(' | ').slice(0, 4000), Draft_JSON: JSON.stringify(d).slice(0, 45000) }, u);
  return { url: url, version: (rows.length + 1) + '.0' };
}
