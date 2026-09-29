/**
 * JD library: one Drive folder named "JD" (inside the shared CV folder) holds every job description.
 * Files placed in the folder can be attached to positions, and JDs uploaded in the app are saved into it.
 */
const JD_FOLDER_NAME = 'JD';
const JD_EXTRA_TYPES = ['application/vnd.google-apps.document'];

function jdFolder_() {
  const s = settings_();
  if (s.JD_FOLDER_ID) {
    try { const f = DriveApp.getFolderById(s.JD_FOLDER_ID); if (!f.isTrashed()) return f; } catch (e) { }
  }
  if (!s.CV_FOLDER_ID) throw new Error('The documents folder is not set. Ask the admin to run setup().');
  const parent = DriveApp.getFolderById(s.CV_FOLDER_ID);
  const it = parent.getFoldersByName(JD_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : parent.createFolder(JD_FOLDER_NAME);
  setSetting_('JD_FOLDER_ID', folder.getId(), 'Single Drive folder for all job descriptions (JD). Files added here can be attached to positions in the app.');
  return folder;
}

function jdName_(line, ext) {
  const base = 'JD - ' + String(line.Position || 'Position').trim() + (line.MRF_No ? ' (' + String(line.MRF_No).trim() + ')' : '');
  return base.replace(/[\\/:*?"<>|]/g, '-').slice(0, 150) + ext;
}

function inFolder_(file, folder) {
  const ps = file.getParents();
  while (ps.hasNext()) if (ps.next().getId() === folder.getId()) return true;
  return false;
}

/** Every file in the JD folder, newest first, with the positions that use it. */
function apiListJds() {
  currentUser_(); ensureSchema_();
  const folder = jdFolder_();
  const used = {};
  readTable_(T.MRF.name).rows.forEach(function (l) {
    const fid = cvFileId_(l.JD_File);
    if (fid) (used[fid] = used[fid] || []).push({ line: l.Line_ID, mrf: String(l.MRF_No || ''), position: String(l.Position || ''), status: String(l.Position_Status || '') });
  });
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.isTrashed()) continue;
    const mime = f.getMimeType();
    files.push({ id: f.getId(), name: f.getName(), mime: mime, url: f.getUrl(), updated: fmt_(f.getLastUpdated(), TZ, 'yyyy-MM-dd'),
      size: f.getSize(), supported: DOC_TYPES.indexOf(mime) >= 0 || JD_EXTRA_TYPES.indexOf(mime) >= 0, usedBy: used[f.getId()] || [] });
  }
  files.sort(function (a, b) { return b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name); });
  return { folderUrl: folder.getUrl(), folderName: folder.getName(), files: files };
}

/** Attaches a file from the JD folder to one or more position lines. */
function apiUseJd(lineIds, fileId) {
  const u = currentUser_(); ensureSchema_();
  const folder = jdFolder_();
  let file;
  try { file = DriveApp.getFileById(String(fileId)); } catch (e) { throw new Error('That JD file was not found. Refresh the list.'); }
  if (file.isTrashed() || !inFolder_(file, folder)) throw new Error('Pick a file from the JD folder.');
  const ids = Array.isArray(lineIds) ? lineIds : [lineIds];
  ids.forEach(function (id) { requireLineEdit_(u, id); });
  ids.forEach(function (id) { update_(T.MRF, id, { JD_File: file.getUrl() }, u); pdocAddJd_(u, id, { file: file.getUrl(), source: 'JD folder: ' + file.getName() }); });
  return { url: file.getUrl(), name: file.getName() };
}

/** One-time move of JDs uploaded before the JD folder existed. */
function jdMigrate_() {
  const folder = jdFolder_();
  const seen = {};
  readTable_(T.MRF.name, true).rows.forEach(function (l) {
    const fid = cvFileId_(l.JD_File);
    if (!fid || seen[fid]) return;
    seen[fid] = true;
    try { const f = DriveApp.getFileById(fid); if (!inFolder_(f, folder)) f.moveTo(folder); } catch (e) { console.error('JD move failed for ' + l.Line_ID + ': ' + e); }
  });
}
