/**
 * Run once from the Apps Script editor after pasting DB_SPREADSHEET_ID in Config.gs.
 * - Checks every required sheet exists
 * - Creates the CV folder next to the database and records it in Settings
 * - Adds you as Admin in the Users sheet
 * - Installs the nightly TAT refresh
 */
function setup() {
  if (DB_SPREADSHEET_ID.indexOf('PASTE') === 0) throw new Error('Paste the database sheet ID into Config.gs first.');
  const required = ['MRF', 'Daily_Funnel', 'Candidates', 'Panel_Unavailability', 'M_Departments', 'M_Grades',
    'M_Recruiters', 'M_Lists', 'Users', 'Settings', 'Audit_Log'];
  const missing = required.filter(function (n) { return !ss_().getSheetByName(n); });
  if (missing.length) throw new Error('Database is missing sheets: ' + missing.join(', '));

  // CV folder
  const settings = readTable_('Settings', true);
  const cvRow = settings.rows.filter(function (r) { return r.Key === 'CV_FOLDER_ID'; })[0];
  let folderId = cvRow && cvRow.Value;
  if (!folderId) {
    const parent = DriveApp.getFileById(DB_SPREADSHEET_ID).getParents();
    const base = parent.hasNext() ? parent.next() : DriveApp.getRootFolder();
    folderId = base.createFolder('BFCL Recruitment CRM - CVs').getId();
    if (cvRow) settings.sheet.getRange(cvRow._row, 2).setValue(folderId);
    else settings.sheet.appendRow(['CV_FOLDER_ID', folderId, 'CV uploads land here']);
  }

  // Admin user
  const me = Session.getEffectiveUser().getEmail().toLowerCase();
  const users = readTable_('Users', true);
  if (!users.rows.some(function (r) { return String(r.Email).toLowerCase() === me; })) {
    users.sheet.appendRow([me, me.split('@')[0], ROLES.ADMIN, '', 'Yes']);
  }

  // Nightly trigger (idempotent)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'nightlyJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyJob').timeBased().everyDays(1).atHour(1).create();

  recomputeAllTat_();
  Logger.log('Setup complete. CV folder: ' + folderId + '. Admin: ' + me + '. Now deploy as a web app.');
}

/**
 * The app runs as each team member, so they need edit access to the database
 * sheet and the CV folder. Run this after adding or removing people in Users.
 * It adds every active user as an editor and removes editors who are no longer listed.
 */
function shareWithTeam() {
  const owner = Session.getEffectiveUser().getEmail().toLowerCase();
  const team = readTable_('Users', true).rows
    .filter(function (r) { return r.Email && String(r.Active || 'Yes') !== 'No'; })
    .map(function (r) { return String(r.Email).toLowerCase().trim(); })
    .filter(function (e) { return e !== owner; });
  const folderId = settings_().CV_FOLDER_ID;
  if (!folderId) throw new Error('Run setup() first so the CV folder exists.');
  const targets = [DriveApp.getFileById(DB_SPREADSHEET_ID), DriveApp.getFolderById(folderId)];
  targets.forEach(function (item) {
    const current = item.getEditors().map(function (u) { return u.getEmail().toLowerCase(); });
    team.forEach(function (e) { if (current.indexOf(e) < 0) item.addEditor(e); });
    current.forEach(function (e) { if (e !== owner && team.indexOf(e) < 0) item.removeEditor(e); });
    item.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  });
  Logger.log('Shared with: ' + team.join(', '));
}
