/**
 * BGV governance (phase 4; ADR-043): who can open BGV files in Drive, how long they are kept, and who touched what.
 *
 * - Restricted Drive folders: BGV files do not live in the shared CV folder. A folder in the owner's My Drive holds one
 *   sub-folder per recruiter; leads (TA Lead, Head of HR, Admin) see all, a recruiter sees only their own. The owner's
 *   nightly job (or the Admin's "Sync Drive access" button) keeps the people right and moves older files into place.
 * - Retention: reports are kept N years after closing, data of candidates who did not join M months (BGV rules). The
 *   Admin purges what is due ("Purge now"): files go to the Drive bin, personal details are blanked, the case row stays
 *   (dates, status, result) so the reports still add up.
 * - Audit: opening a BGV file is logged; the Head of HR and Admin export the timeline and the change log as a CSV.
 */
const BGV_FOLDER_NAME_ = 'BGV (restricted)';
const BGV_FILE_COLS_ = ['Consent_File', 'Report_File', 'Initiation_Proof_File'];

/* ---------------------------------------------------------------- Drive folders ----------------------------- */

function bgvFolderMap_() { try { return JSON.parse(String(settings_().BGV_FOLDER_MAP || '{}')) || {}; } catch (e) { return {}; } }

function bgvRootFolder_(create) {
  const s = settings_();
  if (s.BGV_FOLDER_ID) { try { const f = DriveApp.getFolderById(String(s.BGV_FOLDER_ID)); if (!f.isTrashed()) return f; } catch (e) { } }
  if (!create) return null;
  const base = DriveApp.getRootFolder();
  const it = base.getFoldersByName(BGV_FOLDER_NAME_);
  const f = it.hasNext() ? it.next() : base.createFolder(BGV_FOLDER_NAME_);
  setSetting_('BGV_FOLDER_ID', f.getId(), 'Restricted Drive folder for BGV documents (do not share by hand; Admin > BGV > Governance syncs it)');
  return f;
}

/** Active users: leads (see every BGV file) and everyone else by recruiter name (their own cases). */
function bgvPeople_() {
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  const leads = [], recs = {};
  readTable_('Users').rows.forEach(function (r) {
    if (String(r.Active || 'Yes') === 'No' || !/@/.test(String(r.Email || ''))) return;
    const e = String(r.Email).trim().toLowerCase(), perms = PERMS_[normRole_(r.Role)] || [];
    if (perms.indexOf('lead') >= 0) { if (e !== owner) leads.push(e); return; }
    const name = String(r.Recruiter_Name || r.Name || '').trim();
    if (name && e !== owner) recs[name.toLowerCase()] = { name: name, email: e };
  });
  return { owner: owner, leads: leads, recs: recs };
}

/** Makes a folder's editors exactly `emails` (plus the owner) and takes away link sharing. */
function bgvSyncEditors_(item, emails, owner) {
  const want = emails.map(function (e) { return String(e).toLowerCase(); });
  const cur = item.getEditors().map(function (x) { return String(x.getEmail()).toLowerCase(); });
  want.forEach(function (e) { if (cur.indexOf(e) < 0) item.addEditor(e); });
  cur.forEach(function (e) { if (e !== owner && want.indexOf(e) < 0) { try { item.removeEditor(e); } catch (x) { } } });
  try { item.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (x) { }
}

/** Creates and shares the folders, then moves each case's files into its owner's folder. Runs as the script owner. */
function bgvSyncFolders_() {
  const t0 = Date.now(), P = bgvPeople_(), root = bgvRootFolder_(true), old = bgvFolderMap_(), map = {};
  const out = { folders: 0, moved: 0, failed: 0, remaining: 0 };
  bgvSyncEditors_(root, P.leads, P.owner);
  Object.keys(P.recs).forEach(function (k) {
    let f = null;
    if (old[k]) { try { f = DriveApp.getFolderById(old[k]); if (f.isTrashed()) f = null; } catch (e) { f = null; } }
    if (!f) f = root.createFolder(P.recs[k].name);
    bgvSyncEditors_(f, P.leads.concat([P.recs[k].email]), P.owner);
    map[k] = f.getId(); out.folders++;
  });
  Object.keys(old).forEach(function (k) {   // a recruiter who left keeps their folder for the leads, but loses their own access
    if (map[k]) return;
    map[k] = old[k];
    try { bgvSyncEditors_(DriveApp.getFolderById(old[k]), P.leads, P.owner); } catch (e) { console.error('BGV folder cleanup ' + k + ': ' + e); }
  });
  setSetting_('BGV_FOLDER_MAP', JSON.stringify(map), 'BGV sub-folder per recruiter (recruiter name in lower case -> folder id)');
  readTable_(BGV_CASES_.name).rows.forEach(function (c) {
    if (c.Purged_On) return;
    const target = map[String(c.Recruiter || '').trim().toLowerCase()] || root.getId();
    BGV_FILE_COLS_.forEach(function (col) {
      const fid = cvFileId_(c[col]);
      if (!fid) return;
      if (Date.now() - t0 > 240000) { out.remaining++; return; }
      try {
        const file = DriveApp.getFileById(fid), ps = file.getParents();
        if (ps.hasNext() && ps.next().getId() === target) return;
        file.moveTo(DriveApp.getFolderById(target)); out.moved++;
        try { file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); } catch (x) { }
      } catch (e) { out.failed++; console.error('BGV file move ' + c.Case_ID + ' ' + col + ': ' + e); }
    });
  });
  const when = fmt_(new Date(), TZ, 'd MMM yyyy, HH:mm');
  setSetting_('BGV_SYNC_LAST', when + ' · ' + out.folders + ' recruiter folder' + (out.folders === 1 ? '' : 's') + ' · ' + out.moved + ' file' + (out.moved === 1 ? '' : 's') + ' moved' + (out.failed ? ' · ' + out.failed + ' could not be moved' : '') + (out.remaining ? ' · ' + out.remaining + ' left for the next run' : ''), 'Last BGV Drive access sync');
  return out;
}

/** The folder a case's files are saved in: the owner recruiter's restricted folder (leads may fall back to the main one). */
function bgvUploadFolder_(c) {
  const id = bgvFolderMap_()[String(c.Recruiter || '').trim().toLowerCase()];
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  const root = bgvRootFolder_(false);
  if (root) { try { root.getName(); return root; } catch (e) { } }
  throw new Error('The restricted BGV folder is not ready for ' + (c.Recruiter || 'this recruiter') + '. Ask the admin to press "Sync Drive access" on the BGV tracker (Governance tab). It also runs every night.');
}

function apiBgvDriveSync() {
  const u = currentUser_(); requireAdmin_(u);
  const r = bgvSyncFolders_();
  audit_(u, BGV_CASES_.name, '', 'Drive access sync', '', '', r.folders + ' folders, ' + r.moved + ' moved, ' + r.failed + ' failed');
  return apiBgvGovern();
}

/* ---------------------------------------------------------------- retention -------------------------------- */

function bgvAddMonths_(day, n) {
  const p = String(day).split('-').map(Number);
  const first = new Date(Date.UTC(p[0], p[1] - 1 + n, 1)), last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(p[2], last));
  return first.toISOString().slice(0, 10);
}

/** Closed or cancelled cases past their keep-until date. A candidate who did not join is kept for months, a report for years. */
function bgvRetentionList_(today) {
  const cfg = bgvRules_().cfg, lines = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { lines[String(l.Line_ID)] = l; });
  const out = [];
  readTable_(BGV_CASES_.name).rows.forEach(function (c) {
    const st = String(c.Status);
    if (c.Purged_On || (st !== 'Closed' && st !== 'Cancelled')) return;
    let ref = ymd_(c.Closed_On);
    if (!ref) return;
    const l = lines[String(c.Line_ID)] || {}, back = ymd_(l.Backout_Date);
    const non = st === 'Cancelled' || String(c.Decision) === 'Withdraw the offer' || !!back || !!String(l.Replaced_By || '').trim();
    if (non && back && back > ref) ref = back;
    const due = non ? bgvAddMonths_(ref, Number(cfg.retentionNonJoinerMonths) || 6) : bgvAddMonths_(ref, 12 * (Number(cfg.retentionReportYears) || 3));
    out.push({ id: String(c.Case_ID), type: String(c.Type), candidate: String(c.Candidate_Name || ''), position: String(c.Position || ''), recruiter: String(c.Recruiter || ''),
      status: st, kind: non ? 'Did not join' : 'Report', closed: ref, due: due, files: BGV_FILE_COLS_.filter(function (k) { return String(c[k] || ''); }).length, late: due <= today ? daysBetween_(due, today) : -daysBetween_(today, due) });
  });
  out.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : a.id < b.id ? -1 : 1; });
  return out;
}

function apiBgvGovern() {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can open BGV governance.');
  const today = ymd_(new Date()), cfg = bgvRules_().cfg, s = settings_(), list = bgvRetentionList_(today), soon = addDays_(today, 60);
  const root = bgvRootFolder_(false);
  let url = ''; if (root && u.role === ROLES.ADMIN) { try { url = root.getUrl(); } catch (e) { } }
  const purged = readTable_(BGV_CASES_.name).rows.filter(function (c) { return c.Purged_On; }).length;
  return { today: today, admin: u.role === ROLES.ADMIN, audit: can_(u, 'bgv_decide'),
    drive: { ready: !!root, url: url, folders: Object.keys(bgvFolderMap_()).length, last: String(s.BGV_SYNC_LAST || '') },
    retention: { years: Number(cfg.retentionReportYears) || 3, months: Number(cfg.retentionNonJoinerMonths) || 6, due: list.filter(function (x) { return x.due <= today; }),
      upcoming: list.filter(function (x) { return x.due > today && x.due <= soon; }), purged: purged } };
}

/** Rewrites one column for the rows `match` picks (a single write); returns how many cells changed. */
function bgvBlankColumn_(name, col, match, val) {
  const t = readTable_(name, true), ci = t.headers.indexOf(col), n = t.sheet.getLastRow() - 1;
  if (ci < 0 || n < 1) return 0;
  const rng = t.sheet.getRange(2, ci + 1, n, 1), vals = rng.getValues();
  let k = 0;
  t.rows.forEach(function (r) { const i = r._row - 2; if (i >= 0 && i < n && match(r) && String(vals[i][0]) !== String(val)) { vals[i][0] = val; k++; } });
  if (k) rng.setValues(vals);
  return k;
}

/** Admin only. Deletes the files and personal details of cases that are past retention. Each id must be due today. */
function apiBgvPurge(ids, reason) {
  const u = currentUser_(); requireAdmin_(u); ensureSchema_();
  ids = (Array.isArray(ids) ? ids : []).map(String).filter(function (x, i, a) { return a.indexOf(x) === i; });
  reason = clean_(String(reason || '')).trim();
  if (!ids.length) throw new Error('Select the cases to purge.');
  if (ids.length > 40) throw new Error('Purge up to 40 cases at a time.');
  if (reason.length < 10) throw new Error('Give the reason or approval reference (at least 10 characters).');
  const today = ymd_(new Date()), due = {};
  bgvRetentionList_(today).forEach(function (x) { if (x.due <= today) due[x.id] = x; });
  const notDue = ids.filter(function (id) { return !due[id]; });
  if (notDue.length) throw new Error('Not past retention (or already purged): ' + notDue.join(', ') + '.');
  const res = { purged: 0, files: 0, failed: [], ids: [] };
  const rows = {}; readTable_(BGV_CASES_.name).rows.forEach(function (c) { rows[String(c.Case_ID)] = c; });
  const clearedFiles = {};
  const done = [];
  ids.forEach(function (id) {
    const c = rows[id]; let bad = 0;
    BGV_FILE_COLS_.forEach(function (col) {
      const fid = cvFileId_(c[col]);
      if (!String(c[col] || '')) return;
      if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); res.files++; } catch (e) { if (!/not found|No item/i.test(String(e))) { bad++; return; } } }
      (clearedFiles[col] = clearedFiles[col] || {})[id] = true;
    });
    if (bad) res.failed.push(id + ' (' + bad + ' file' + (bad === 1 ? '' : 's') + ' could not be deleted)'); else done.push(id);
  });
  withLock_(function () {
    BGV_FILE_COLS_.forEach(function (col) { bgvBlankColumn_(BGV_CASES_.name, col, function (r) { return (clearedFiles[col] || {})[String(r.Case_ID)]; }, ''); });
    if (!done.length) return;
    const inSet = function (r) { return done.indexOf(String(r.Case_ID)) >= 0; };
    const checkIds = {};
    readTable_(BGV_CHECKS_.name).rows.forEach(function (k) { if (inSet(k)) checkIds[String(k.Check_ID)] = true; });
    bgvBlankColumn_(BGV_CASES_.name, 'Candidate_Name', inSet, '(purged)');
    bgvBlankColumn_(BGV_CASES_.name, 'Remarks', inSet, '');
    bgvBlankColumn_(BGV_CASES_.name, 'Decision_Note', inSet, '');
    bgvBlankColumn_(BGV_CASES_.name, 'Purged_On', inSet, fmt_(new Date(), TZ, 'yyyy-MM-dd'));
    bgvBlankColumn_(BGV_CASES_.name, 'Purged_By', inSet, u.email);
    ['Subject', 'Period', 'Finding'].forEach(function (col) { bgvBlankColumn_(BGV_CHECKS_.name, col, inSet, ''); });
    bgvBlankColumn_(BGV_LOG_.name, 'Note', inSet, '');
    const oldNew = function (r) { return (String(r.Sheet) === BGV_CASES_.name && done.indexOf(String(r.Record_ID)) >= 0) || (String(r.Sheet) === BGV_CHECKS_.name && checkIds[String(r.Record_ID)]); };
    bgvBlankColumn_('Audit_Log', 'Old_Value', oldNew, ''); bgvBlankColumn_('Audit_Log', 'New_Value', oldNew, '');
    bgvAppend_(BGV_LOG_, BGV_LOG_COLS_, done.map(function (id) { return { Case_ID: id, At: new Date(), By: u.email, Kind: 'Purged', Old_Status: '', New_Status: '', Note: 'Retention purge' }; }));
    done.forEach(function (id) { audit_(u, BGV_CASES_.name, id, 'Retention purge', '', '', reason.slice(0, 200)); res.purged++; res.ids.push(id); });
  });
  return Object.assign(res, { govern: apiBgvGovern() });
}

/* ---------------------------------------------------------------- audit export ----------------------------- */

/** The BGV timeline and change log for a period (Head of HR, Admin), oldest first; opening it is itself logged. */
function apiBgvAudit(f) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'bgv_decide')) throw new Error('Only the Head of HR or the admin can export the BGV audit trail.');
  f = f || {};
  const re = /^\d{4}-\d{2}-\d{2}$/, today = ymd_(new Date());
  const to = String(f.to || today), from = String(f.from || addDays_(to, -90));
  if (!re.test(from) || !re.test(to)) throw new Error('Choose valid dates.');
  if (from > to) throw new Error('The start date is after its end.');
  if (daysBetween_(from, to) > 366) throw new Error('Export up to one year at a time.');
  const only = String(f.caseId || '').trim();
  if (only) bgvCaseRow_(only);
  const cases = {}; readTable_(BGV_CASES_.name).rows.forEach(function (c) { cases[String(c.Case_ID)] = c; });
  const checkCase = {}; readTable_(BGV_CHECKS_.name).rows.forEach(function (k) { checkCase[String(k.Check_ID)] = String(k.Case_ID); });
  const stamp = function (v) { return v instanceof Date ? fmt_(v, TZ, 'yyyy-MM-dd HH:mm:ss') : String(v || ''); };
  const who = function (id) { const c = cases[id] || {}; return { candidate: String(c.Candidate_Name || ''), recruiter: String(c.Recruiter || '') }; };
  const rows = [];
  readTable_(BGV_LOG_.name).rows.forEach(function (r) {
    const d = ymd_(r.At), id = String(r.Case_ID);
    if (!d || d < from || d > to || (only && id !== only)) return;
    const w = who(id);
    rows.push({ at: stamp(r.At), by: String(r.By || ''), source: 'Timeline', caseId: id, candidate: w.candidate, recruiter: w.recruiter, action: String(r.Kind || ''), field: '', from: String(r.Old_Status || ''), to: String(r.New_Status || ''), note: String(r.Note || '') });
  });
  const mine = [BGV_CASES_.name, BGV_CHECKS_.name, BGV_VENDORS_.name, BGV_RULES_];
  readTableFrom_('Audit_Log', 'Timestamp', from).rows.forEach(function (r) {
    const sh = String(r.Sheet), d = ymd_(r.Timestamp);
    if (mine.indexOf(sh) < 0 || !d || d < from || d > to) return;
    const rid = String(r.Record_ID || ''), id = sh === BGV_CASES_.name ? rid : sh === BGV_CHECKS_.name ? (checkCase[rid] || '') : '';
    if (only && id !== only) return;
    const w = who(id);
    rows.push({ at: stamp(r.Timestamp), by: String(r.User || ''), source: 'Change log', caseId: id, candidate: w.candidate, recruiter: w.recruiter, action: String(r.Action || ''), field: String(r.Field || ''), from: String(r.Old_Value || ''), to: String(r.New_Value || ''), note: sh === BGV_CASES_.name || sh === BGV_CHECKS_.name ? '' : sh + ' ' + rid });
  });
  rows.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  const cap = 20000, truncated = rows.length > cap;
  audit_(u, BGV_CASES_.name, only, 'Audit export', from + ' to ' + to, '', rows.length + ' rows');
  return { from: from, to: to, caseId: only, rows: truncated ? rows.slice(0, cap) : rows, total: rows.length, truncated: truncated };
}
