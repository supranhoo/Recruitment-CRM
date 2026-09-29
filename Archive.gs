/**
 * CV bank scale and archive (Step 1).
 * Candidates with no activity for ARCHIVE_DAYS (default 180) and no active or on-hold pipeline card move to the
 * Candidates_Archive sheet, and their CV files to an Archive sub-folder. Archived candidates do not affect normal
 * processing, but duplicate checks and "Include archived" search still see them, and they can be restored.
 */
const CAND_ARCHIVE_ = 'Candidates_Archive';
const ARCHIVE_EXTRA_ = ['Archived_On', 'Archive_Reason', 'CV_Archived'];

function archiveSchema_() {
  addColumns_(T.CAND.name, ['Last_Activity']);
  const heads = sheet_(T.CAND.name).getRange(1, 1, 1, sheet_(T.CAND.name).getLastColumn()).getValues()[0].map(String);
  addSheet_(CAND_ARCHIVE_, heads.concat(ARCHIVE_EXTRA_));
  addColumns_(CAND_ARCHIVE_, heads.concat(ARCHIVE_EXTRA_));
}
function archiveDays_() { return Number(settings_().ARCHIVE_DAYS) || 180; }
function archiveVer_() { return PropertiesService.getScriptProperties().getProperty('ARCHIVE_VER') || '0'; }
function archiveBump_() { PropertiesService.getScriptProperties().setProperty('ARCHIVE_VER', String(Date.now())); }

/* ---------- big values in the script cache (split into pieces under the 100 KB limit) ---------- */
function cacheBigPut_(key, s, ttl) {
  try {
    /* 30,000 characters stays under the 100 KB-per-entry limit even if every character took 3 bytes in UTF-8. */
    const c = CacheService.getScriptCache(), size = 30000, n = Math.ceil(s.length / size), o = {};
    for (let i = 0; i < n; i++) o[key + '_' + i] = s.slice(i * size, (i + 1) * size);
    o[key + '_n'] = String(n);
    c.putAll(o, ttl || 21600);
  } catch (e) { }
}
function cacheBigGet_(key) {
  try {
    const c = CacheService.getScriptCache(), n = Number(c.get(key + '_n') || 0);
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push(key + '_' + i);
    const got = c.getAll(keys); let s = '';
    for (let i = 0; i < n; i++) { if (got[keys[i]] == null) return null; s += got[keys[i]]; }
    return s;
  } catch (e) { return null; }
}

/** Reads selected columns of a sheet (one call per column) as { name: [values] }. */
function readColumns_(sh, names) {
  const last = sh.getLastRow(), heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), out = { _n: Math.max(0, last - 1) };
  names.forEach(function (n) {
    const ci = heads.indexOf(n);
    out[n] = ci < 0 || last < 2 ? [] : sh.getRange(2, ci + 1, last - 1, 1).getValues().map(function (r) { return r[0]; });
  });
  return out;
}

/** Slim index of the archive: enough for duplicate checks, search, names and pending CV moves. Cached per archive version. */
function archiveIndex_() {
  if (_tables.__aidx) return _tables.__aidx;
  const key = 'aidx_' + archiveVer_();
  const hit = cacheBigGet_(key);
  if (hit) return (_tables.__aidx = JSON.parse(hit));
  const sh = ss_().getSheetByName(CAND_ARCHIVE_);
  if (!sh) return (_tables.__aidx = []);
  const cols = readColumns_(sh, ['Candidate_ID', 'Name', 'Mobile', 'Email', 'Position', 'Dept', 'Relevant_Experience', 'Current_Designation',
    'HR_Result', 'Sourced_By', 'CV_File_URL', 'Last_Activity', 'Archived_On', 'CV_Archived']);
  const idx = [];
  for (let i = 0; i < cols._n; i++) {
    if (!cols.Candidate_ID[i]) continue;
    idx.push({ id: String(cols.Candidate_ID[i]), name: String(cols.Name[i] || ''), mobile: normPhone_(cols.Mobile[i]), email: String(cols.Email[i] || '').toLowerCase(),
      position: String(cols.Position[i] || ''), dept: String(cols.Dept[i] || ''), exp: String(cols.Relevant_Experience[i] || ''),
      designation: String(cols.Current_Designation[i] || ''), hr: String(cols.HR_Result[i] || ''), src: String(cols.Sourced_By[i] || ''),
      cv: String(cols.CV_File_URL[i] || ''), last: ymd_(cols.Last_Activity[i]), on: ymd_(cols.Archived_On[i]), cvArch: String(cols.CV_Archived[i] || '') });
  }
  cacheBigPut_(key, JSON.stringify(idx));
  return (_tables.__aidx = idx);
}
function archivedById_(id) { return archiveIndex_().filter(function (a) { return a.id === id; })[0] || null; }

/** Candidate names for a set of IDs, falling back to the archive for archived candidates. */
function candNames_(ids) {
  const out = {}, want = {};
  ids.forEach(function (id) { want[id] = true; });
  readTable_(T.CAND.name).rows.forEach(function (c) { if (want[c.Candidate_ID]) out[c.Candidate_ID] = c; });
  if (ids.some(function (id) { return !out[id]; })) {
    archiveIndex_().forEach(function (a) { if (want[a.id] && !out[a.id]) out[a.id] = { Candidate_ID: a.id, Name: a.name, Mobile: a.mobile, Email: a.email, _archived: true }; });
  }
  return out;
}

/* ---------- last activity ---------- */
function candLastActivity_(c, apps, today) {
  const ds = [];
  ['Tech_Interview_Date', 'HR_Interview_Date', 'DOJ', 'Psychometric_Date'].forEach(function (k) { const d = ymd_(c[k]); if (d && d <= today) ds.push(d); });
  if (String(c.Created_By) !== 'migration' && c.Created_At) ds.push(ymd_(c.Created_At));
  if (c.Updated_By && String(c.Updated_By) !== 'migration' && c.Updated_At) ds.push(ymd_(c.Updated_At));
  (apps || []).forEach(function (a) {
    if (String(a.Created_By) !== 'migration' && a.Created_At) ds.push(ymd_(a.Created_At));
    if (a.Updated_By && String(a.Updated_By) !== 'migration' && a.Updated_At) ds.push(ymd_(a.Updated_At));
  });
  const real = ds.filter(function (d) { return d && d <= today; }).sort();
  return real.length ? real[real.length - 1] : (ymd_(c.Created_At) || today);
}

/* ---------- archive run ---------- */
/**
 * Moves inactive candidates to the archive. Safe order: rows are appended to the archive first, then the main
 * sheet is compacted in place (keepers written over the top, the tail cleared), so a failure can never lose a row.
 */
function archiveCandidates_(u, limit) {
  ensureSchema_();
  archiveSchema_();
  limit = limit || 800;
  const days = archiveDays_(), today = ymd_(new Date()), cut = ymd_(new Date(Date.now() - days * 86400000));
  const res = withLock_(function () {
    const t = readTable_(T.CAND.name, true);
    const appsBy = {};
    readTable_(T.APP.name, true).rows.forEach(function (a) { (appsBy[a.Candidate_ID] = appsBy[a.Candidate_ID] || []).push(a); });
    const keep = [], move = [];
    let protectedN = 0;
    t.rows.forEach(function (c) {
      const apps = appsBy[c.Candidate_ID] || [];
      c.Last_Activity = parseYmd_(candLastActivity_(c, apps, today));
      const live = apps.some(function (a) { return ['Active', 'On hold'].indexOf(String(a.Status)) >= 0; });
      if (live) protectedN++;
      if (!live && ymd_(c.Last_Activity) < cut && move.length < limit) move.push(c); else keep.push(c);
    });
    const sh = t.sheet, heads = t.headers, n = heads.length;
    if (move.length) {
      const ash = sheet_(CAND_ARCHIVE_);
      const aheads = ash.getRange(1, 1, 1, ash.getLastColumn()).getValues()[0].map(String);
      const now = new Date();
      const arows = move.map(function (c) {
        return aheads.map(function (h) {
          if (h === 'Archived_On') return now;
          if (h === 'Archive_Reason') return 'No activity since ' + ymd_(c.Last_Activity) + ' (' + days + '-day rule)';
          if (h === 'CV_Archived') return c.CV_File_URL ? '' : 'No CV';
          return c[h] === undefined ? '' : c[h];
        });
      });
      ash.getRange(ash.getLastRow() + 1, 1, arows.length, aheads.length).setValues(arows);
    }
    const out = keep.map(function (c) { return heads.map(function (h) { return c[h] === undefined ? '' : c[h]; }); });
    const last = sh.getLastRow();
    if (out.length) sh.getRange(2, 1, out.length, n).setValues(out);
    if (last - 1 > out.length) sh.getRange(out.length + 2, 1, last - 1 - out.length, n).clearContent();
    if (move.length) archiveBump_();
    dropStale_(T.CAND.name);
    return { archived: move.length, kept: keep.length, protectedByPipeline: protectedN, cutOff: cut, ids: move.map(function (c) { return c.Candidate_ID; }) };
  });
  if (res.archived) audit_(u || { email: 'system' }, T.CAND.name, 'archive', 'Archive', 'candidates', '', res.archived + ' archived (no activity since before ' + res.cutOff + ')');
  res.cvPending = moveArchivedCvs_(60).pending;
  delete res.ids;
  return res;
}

function cvArchiveFolder_() {
  const s = settings_();
  if (s.CV_ARCHIVE_FOLDER_ID) { try { return DriveApp.getFolderById(s.CV_ARCHIVE_FOLDER_ID); } catch (e) { } }
  const parent = DriveApp.getFolderById(s.CV_FOLDER_ID);
  const it = parent.getFoldersByName('Archive');
  const f = it.hasNext() ? it.next() : parent.createFolder('Archive');
  setSetting_('CV_ARCHIVE_FOLDER_ID', f.getId(), 'Sub-folder of the CV folder for archived candidates');
  return f;
}

/** Moves CV files of archived candidates into the Archive sub-folder, a batch at a time. Links keep working. */
function moveArchivedCvs_(max) {
  const pending = archiveIndex_().filter(function (a) { return a.cv && !a.cvArch; });
  if (!pending.length || !settings_().CV_FOLDER_ID) return { moved: 0, pending: 0 };
  const main = settings_().CV_FOLDER_ID;
  let folder; try { folder = cvArchiveFolder_(); } catch (e) { return { moved: 0, pending: pending.length }; }
  let moved = 0;
  const status = {};
  pending.slice(0, max || 60).forEach(function (a) {
    try {
      const f = DriveApp.getFileById(cvFileId_(a.cv));
      let inMain = false; const ps = f.getParents(); while (ps.hasNext()) if (ps.next().getId() === main) inMain = true;
      if (inMain) { f.moveTo(folder); status[a.id] = 'Yes'; moved++; } else status[a.id] = 'Skipped: not in the CV folder';
    } catch (e) { status[a.id] = 'Skipped: ' + String(e.message || e).slice(0, 80); }
  });
  // Row numbers are looked up inside the lock, so a restore running at the same time cannot shift them.
  withLock_(function () {
    const ash = sheet_(CAND_ARCHIVE_), cols = readColumns_(ash, ['Candidate_ID']);
    const heads = ash.getRange(1, 1, 1, ash.getLastColumn()).getValues()[0].map(String), ci = heads.indexOf('CV_Archived') + 1;
    cols.Candidate_ID.forEach(function (id, i) { if (status[String(id)]) ash.getRange(i + 2, ci).setValue(status[String(id)]); });
  });
  if (moved || pending.length) archiveBump_();
  return { moved: moved, pending: Math.max(0, pending.length - (max || 60)) };
}

/** Once a day, from the 30-minute background job. CV moves continue on later runs until done. */
function archiveDaily_() {
  const p = PropertiesService.getScriptProperties(), today = ymd_(new Date());
  if (p.getProperty('ARCHIVE_LAST_RUN') === today) { moveArchivedCvs_(60); return; }
  const res = archiveCandidates_({ email: 'system' }, 800);
  p.setProperty('ARCHIVE_LAST_RUN', today);
  p.setProperty('ARCHIVE_LAST_RESULT', JSON.stringify(Object.assign({ at: fmt_(new Date(), TZ, 'd MMM yyyy, HH:mm') }, res)));
}

function apiArchiveNow() {
  const u = currentUser_();
  if (!can_(u, 'system')) throw new Error('Only the admin can run the archive.');
  const res = archiveCandidates_(u, 800);
  PropertiesService.getScriptProperties().setProperty('ARCHIVE_LAST_RESULT', JSON.stringify(Object.assign({ at: fmt_(new Date(), TZ, 'd MMM yyyy, HH:mm') }, res)));
  res.archiveTotal = archiveIndex_().length;
  return res;
}
function apiArchiveStatus() {
  currentUser_();
  let last = null; try { last = JSON.parse(PropertiesService.getScriptProperties().getProperty('ARCHIVE_LAST_RESULT') || 'null'); } catch (e) { }
  return { days: archiveDays_(), last: last, archiveTotal: archiveIndex_().length, active: readColumns_(sheet_(T.CAND.name), [])._n };
}

/* ---------- restore ---------- */
function restoreCandidate_(id, u) {
  const res = withLock_(function () {
    const ash = sheet_(CAND_ARCHIVE_);
    const aheads = ash.getRange(1, 1, 1, ash.getLastColumn()).getValues()[0].map(String);
    const ids = readColumns_(ash, ['Candidate_ID']).Candidate_ID;
    const i = ids.map(String).indexOf(id);
    if (i < 0) return null;
    const row = ash.getRange(i + 2, 1, 1, aheads.length).getValues()[0];
    const o = {}; aheads.forEach(function (h, j) { o[h] = row[j]; });
    const sh = sheet_(T.CAND.name), heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const now = new Date();
    o.Last_Activity = now; o.Updated_By = u.email; o.Updated_At = now;
    sh.getRange(sh.getLastRow() + 1, 1, 1, heads.length).setValues([heads.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    ash.deleteRow(i + 2);
    archiveBump_(); dropStale_(T.CAND.name);
    return o;
  });
  if (!res) return null;
  audit_(u, T.CAND.name, id, 'Restore', 'archive', '', 'Restored from the archive');
  if (String(res.CV_Archived) === 'Yes' && res.CV_File_URL) {
    try { DriveApp.getFileById(cvFileId_(res.CV_File_URL)).moveTo(DriveApp.getFolderById(settings_().CV_FOLDER_ID)); } catch (e) { }
  }
  return res;
}
function apiRestoreCandidate(id) {
  const u = currentUser_(); ensureSchema_();
  const r = restoreCandidate_(String(id || ''), u);
  if (!r) throw new Error('Candidate ' + id + ' is not in the archive.');
  _tables = {};
  return apiGetCandidate(id);
}
/** Brings an archived candidate back automatically when they are used again (added to a pipeline, reactivated, linked). */
function ensureActiveCandidate_(id, u) {
  if (!id) return;
  if (readTable_(T.CAND.name).rows.some(function (c) { return c.Candidate_ID === id; })) return;
  if (archivedById_(id)) { restoreCandidate_(id, u); _tables = {}; }
}

/* ---------- search ---------- */
const CAND_SEARCH_FIELDS_ = ['Candidate_ID', 'Name', 'Position', 'Dept', 'Mobile', 'Email', 'Relevant_Experience', 'Current_Designation', 'Current_CTC',
  'Tech_Result', 'HR_Result', 'Sourced_By', 'CV_File_URL', 'Possible_Duplicate_Of', 'Line_ID', 'Education', 'Last_Activity',
  'Function_Area', 'Key_Skills', 'Total_Exp_Years', 'Current_Location', 'Expected_CTC', 'Notice_Days'];
/**
 * Server-side candidate search, one page at a time. f = { q, hr, src, dup, cv, line, archived: 'no'|'include'|'only', page, size }.
 * Every word typed must match somewhere (name, mobile, email, position, ID, designation, education, department).
 */
function apiSearchCandidates(f) {
  currentUser_(); ensureSchema_();
  f = f || {};
  const size = Math.min(Math.max(Number(f.size) || 50, 1), 200), page = Math.max(0, Number(f.page) || 0);
  const words = String(f.q || '').toLowerCase().split(/\s+/).filter(String);
  const match = function (hay) { hay = hay.toLowerCase(); return words.every(function (w) { const d = w.replace(/\D/g, ''); return hay.indexOf(w) >= 0 || (d.length >= 4 && hay.replace(/\D/g, '').indexOf(d) >= 0); }); };
  const out = [], live = liveCands_(), profile = poolFiltering_(f);
  if (f.archived !== 'only') {
    readTable_(T.CAND.name).rows.forEach(function (c) {
      if (f.line && c.Line_ID !== f.line) return;
      if (profile && !poolMatch_(c, f, live)) return;
      if (f.hr && c.HR_Result !== f.hr) return;
      if (f.src && c.Sourced_By !== f.src) return;
      if (f.dup && !c.Possible_Duplicate_Of) return;
      if (f.cv && !c.CV_File_URL) return;
      if (words.length && !match([c.Name, c.Mobile, c.Email, c.Position, c.Candidate_ID, c.Current_Designation, c.Education, c.Dept, c.Key_Skills, c.Function_Area, c.Current_Location].join(' '))) return;
      const o = {}; CAND_SEARCH_FIELDS_.forEach(function (k) { o[k] = c[k]; });
      const co = toClient_(o); co._exp = expYears_(c); co._inPipeline = live[c.Candidate_ID] ? 'Yes' : '';
      out.push(co);
    });
  }
  if (f.archived === 'include' || f.archived === 'only') {
    archiveIndex_().forEach(function (a) {
      if (f.line || f.dup || profile) return;
      if (f.hr && a.hr !== f.hr) return;
      if (f.src && a.src !== f.src) return;
      if (f.cv && !a.cv) return;
      if (words.length && !match([a.name, a.mobile, a.email, a.position, a.id, a.designation, a.dept].join(' '))) return;
      out.push({ Candidate_ID: a.id, Name: a.name, Position: a.position, Dept: a.dept, Mobile: a.mobile, Email: a.email, Relevant_Experience: a.exp,
        Current_Designation: a.designation, HR_Result: a.hr, Sourced_By: a.src, CV_File_URL: a.cv, Last_Activity: a.last, Archived_On: a.on, _archived: 'Yes' });
    });
  }
  out.sort(function (a, b) { return String(b.Candidate_ID).localeCompare(String(a.Candidate_ID)); });
  return { total: out.length, page: page, size: size, rows: out.slice(page * size, (page + 1) * size) };
}
