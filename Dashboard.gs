/**
 * Dashboard snapshot. The Overview never calculates anything on page load:
 * it reads a ready-made snapshot (script cache, then the Dash_Snapshot sheet).
 * The snapshot is rebuilt by the Refresh button, by a 30-minute trigger when
 * data has changed, and by the nightly job.
 */
const DASH_SHEET = 'Dash_Snapshot';
const DASH_CACHE_KEY = 'dash_v1';

function apiDashboard() {
  const u = currentUser_();
  let snap = readSnapshot_();
  if (!snap) snap = buildSnapshot_(u.email);
  return decorate_(snap, u);
}

function apiRefreshDashboard() {
  const u = currentUser_();
  return decorate_(buildSnapshot_(u.email), u);
}

function decorate_(snap, u) {
  const dirtyAt = Number(PropertiesService.getScriptProperties().getProperty('DASH_DIRTY_AT') || 0);
  snap.stale = dirtyAt > Number(snap.builtAtMs || 0);
  snap.me = u.recruiter;
  return snap;
}

function readSnapshot_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(DASH_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const sh = ss_().getSheetByName(DASH_SHEET);
  if (!sh) return null;
  const json = sh.getRange(2, 3).getValue();
  if (!json) return null;
  cache.put(DASH_CACHE_KEY, json, 21600);
  return JSON.parse(json);
}

function buildSnapshot_(by) {
  const started = Date.now();
  const data = computeDashboard_();
  const now = new Date();
  data.builtAt = fmt_(now, TZ, 'd MMM yyyy, HH:mm');
  data.builtAtMs = now.getTime();
  data.builtBy = by || 'scheduled refresh';
  data.buildMs = Date.now() - started;
  const json = JSON.stringify(data);
  let sh = ss_().getSheetByName(DASH_SHEET);
  if (!sh) {
    sh = ss_().insertSheet(DASH_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['Built_At', 'Built_By', 'Snapshot_JSON (do not edit)']]).setFontWeight('bold');
  }
  sh.getRange(2, 1, 1, 3).setValues([[now, data.builtBy, json]]);
  CacheService.getScriptCache().put(DASH_CACHE_KEY, json, 21600);
  return data;
}

/** Called after every save to positions or the daily log. Cheap: one property write. */
function markDashDirty_(sheetName) {
  const props = PropertiesService.getScriptProperties();
  if (sheetName === T.MRF.name || sheetName === T.FUNNEL.name) props.setProperty('DASH_DIRTY_AT', String(Date.now()));
  if ([T.MRF.name, T.CAND.name, 'Observations', 'Audit_Checks'].indexOf(sheetName) >= 0) props.setProperty('KPI_DIRTY_AT', String(Date.now()));
}

/** 30-minute trigger: rebuild only if something changed since the last snapshot. */
function refreshDashboardJob() {
  try { reconcileTasks_(); } catch (e) { console.error('To-do reconcile failed: ' + e); }
  try { archiveDaily_(); } catch (e) { console.error('Candidate archive failed: ' + e); }
  try {
    const y = fmt_(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
    if (typeof daySnapGet_ === 'function' && !daySnapGet_(y)) { _tables = {}; daySnapPut_(y, dayData_(y, '')); _tables = {}; }
  } catch (e) { console.error('Daily review pre-build failed: ' + e); }
  const dirtyAt = Number(PropertiesService.getScriptProperties().getProperty('DASH_DIRTY_AT') || 0);
  const snap = readSnapshot_();
  if (snap && dirtyAt <= Number(snap.builtAtMs || 0)) return;
  buildSnapshot_('scheduled refresh');
}

/** Run once after this update (safe to re-run): installs the nightly and 30-minute jobs. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const h = t.getHandlerFunction();
    if (h === 'nightlyJob' || h === 'refreshDashboardJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyJob').timeBased().everyDays(1).atHour(1).create();
  ScriptApp.newTrigger('refreshDashboardJob').timeBased().everyMinutes(30).create();
  buildSnapshot_('install');
  Logger.log('Triggers installed and dashboard snapshot built.');
}
