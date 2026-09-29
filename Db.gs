/** Data-access layer: every read/write to the database sheet goes through here. */
let _tables = {};
let _ss = null;

function ss_() {
  if (!_ss) _ss = SpreadsheetApp.openById(DB_SPREADSHEET_ID);
  return _ss;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The database has no sheet named "' + name + '". Check the DB file.');
  return sh;
}

/** Small, rarely-changed tables are kept in the script cache for 10 minutes (dropped on every app write). */
const CACHED_TABLES_ = ['Settings', 'M_Grades', 'M_Designations', 'TAT_Rules', 'M_Recruiters', 'M_Lists', 'M_Departments', 'KPI_Targets', 'M_Panel_Members', 'Users'];
const TABLE_CACHE_SECONDS_ = 600;
function tableCacheKey_(name) { return 'tbl3_' + name; }
function dropTableCache_(name) {
  try { CacheService.getScriptCache().removeAll(name ? [tableCacheKey_(name)] : CACHED_TABLES_.map(tableCacheKey_)); } catch (e) { }
}
function tableFromCache_(name) {
  let raw = null;
  try { raw = CacheService.getScriptCache().get(tableCacheKey_(name)); } catch (e) { return null; }
  if (!raw) return null;
  const c = JSON.parse(raw);
  const rows = c.rows.map(function (r) {
    Object.keys(r).forEach(function (k) { const v = r[k]; if (v && typeof v === 'object' && v.$d !== undefined) r[k] = new Date(v.$d); });
    return r;
  });
  const t = { headers: c.headers, rows: rows };
  Object.defineProperty(t, 'sheet', { get: function () { return sheet_(name); } });
  return t;
}
function tableToCache_(name, headers, rows) {
  try {
    const plain = rows.map(function (r) {
      const o = {};
      Object.keys(r).forEach(function (k) { const v = r[k]; o[k] = v instanceof Date ? { $d: v.getTime() } : v; });
      return o;
    });
    const s = JSON.stringify({ headers: headers, rows: plain });
    if (s.length < 95000) CacheService.getScriptCache().put(tableCacheKey_(name), s, TABLE_CACHE_SECONDS_);
  } catch (e) { }
}

function rowsFromValues_(headers, values, firstRow) {
  const rows = [];
  values.forEach(function (r, i) {
    if (!r.some(function (v) { return v !== '' && v !== null; })) return;
    const o = { _row: i + firstRow };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    rows.push(o);
  });
  return rows;
}

/** Reads a whole table in one call. Rows are objects keyed by header; _row is the sheet row number. */
/**
 * JD library text guard. Google Sheets re-reads written strings the way it reads typing: "1-3" or "8-15" become dates,
 * "10%" a number, "- item" an error. Strings that Sheets could reinterpret are written with a leading apostrophe
 * (stored as plain text, read back without it). Real numbers and dates are not strings and are left alone.
 */
function jdmSafeText_(v) {
  if (typeof v !== 'string' || !v || v.charAt(0) === "'") return v;
  return /^[-(.$\u20B9\d]|^(true|false)$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s.,\/-]*\d/i.test(v) ? "'" + v : v;
}
function jdmRow_(name, row) { return /^(JDM_|Position_Docs$|Screenings$|Day_Status$)/.test(name) ? row.map(jdmSafeText_) : row; }
/** Repairs JD library cells that Sheets had already turned into dates (e.g. "1-3" stored as 3 Jan): read back as the original "M-D" text. */
function jdmUndate_(name, headers, rows) {
  if (!/^(JDM_|Position_Docs$|Screenings$|Day_Status$)/.test(name)) return;
  const cols = headers.filter(function (h) { return !/(_On|_At)$|^Date$/.test(h); });
  rows.forEach(function (o) {
    cols.forEach(function (h) {
      const v = o[h];
      if (!(v instanceof Date)) return;
      const p = ymd_(v).split('-');
      o[h] = Number(p[1]) + '-' + Number(p[2]);
    });
  });
}

function readTable_(name, fresh) {
  if (_tables[name] && !fresh) return _tables[name];
  const cacheable = CACHED_TABLES_.indexOf(name) >= 0;
  if (cacheable && !fresh) { const c = tableFromCache_(name); if (c) return (_tables[name] = c); }
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(String);
  const rows = rowsFromValues_(headers, values, 2);
  jdmUndate_(name, headers, rows);
  if (cacheable) tableToCache_(name, headers, rows);
  return (_tables[name] = { headers: headers, rows: rows, sheet: sh });
}

/**
 * Reads only the tail of an append-only table, starting at the first row whose dateField is on or after `from`.
 * Every earlier row has an older (or empty) date, so callers that filter by date get exactly the same rows.
 * Used for the growing sheets (daily activity, change history, stage history, candidates) so they stay fast.
 */
const SMALL_SHEET_ROWS_ = 1000;
function readTableFrom_(name, dateField, from) {
  if (!from) return readTable_(name);
  if (_tables[name]) return _tables[name];
  const key = name + '|' + dateField + '|' + from;
  if (_tables[key]) return _tables[key];
  const sh = sheet_(name);
  const last = sh.getLastRow(), lc = sh.getLastColumn();
  if (last < SMALL_SHEET_ROWS_) return readTable_(name);
  const headers = sh.getRange(1, 1, 1, lc).getValues()[0].map(String);
  const ci = headers.indexOf(dateField);
  if (ci < 0) return readTable_(name);
  const col = sh.getRange(2, ci + 1, last - 1, 1).getValues();
  let first = -1;
  for (let i = 0; i < col.length; i++) { const v = col[i][0]; if (v && ymd_(v) >= from) { first = i; break; } }
  if (first < 0) return (_tables[key] = { headers: headers, rows: [], sheet: sh });
  const values = sh.getRange(first + 2, 1, last - 1 - first, lc).getValues();
  return (_tables[key] = { headers: headers, rows: rowsFromValues_(headers, values, first + 2), sheet: sh });
}

/**
 * Fast date formatting. Utilities.formatDate costs ~0.8 ms per call, which made list pages take 5-15 s.
 * India has no daylight saving, so IST is a fixed +5:30 offset and plain arithmetic gives identical results.
 * Any other time zone, or an unexpected pattern character, falls back to Utilities.formatDate.
 */
const IST_OFFSET_MS = 19800000;
const MONTHS_SHORT_ = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_LONG_ = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function fmt_(date, tz, pattern) {
  if (tz !== 'Asia/Kolkata' || !(date instanceof Date) || isNaN(date) || /[^yMdHmE\s,:.-]/.test(pattern)) return Utilities.formatDate(date, tz, pattern);
  const x = new Date(date.getTime() + IST_OFFSET_MS);
  const p2 = function (n) { return n < 10 ? '0' + n : String(n); };
  const Y = x.getUTCFullYear(), M = x.getUTCMonth(), D = x.getUTCDate();
  return pattern.replace(/yyyy|MMMM|MMM|MM|dd|d|HH|mm|EEEE/g, function (t) {
    switch (t) {
      case 'yyyy': return String(Y);
      case 'MMMM': return MONTHS_LONG_[M];
      case 'MMM': return MONTHS_SHORT_[M];
      case 'MM': return p2(M + 1);
      case 'dd': return p2(D);
      case 'd': return String(D);
      case 'HH': return p2(x.getUTCHours());
      case 'mm': return p2(x.getUTCMinutes());
      default: return DAYS_LONG_[x.getUTCDay()];
    }
  });
}

/** yyyy-MM-dd in IST. */
function ymd_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    return TZ === 'Asia/Kolkata' ? new Date(v.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10) : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  return String(v).slice(0, 10);
}

/** Converts Dates to yyyy-MM-dd strings so objects can cross google.script.run. */
function toClient_(o) {
  const out = {};
  Object.keys(o).forEach(function (k) {
    const v = o[k];
    if (v instanceof Date) out[k] = ymd_(v);
    else out[k] = v === null ? '' : v;
  });
  return out;
}

function parseYmd_(s) {
  if (!s) return '';
  if (s instanceof Date) return s;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new Error('Invalid date "' + s + '". Use the date picker.');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Blocks formula injection: text starting with = + @ is stored as plain text. */
function clean_(v) {
  if (typeof v !== 'string') return v;
  v = v.trim();
  return /^[=+@]/.test(v) ? "'" + v : v;
}

/**
 * Next ID for a table. IDs are never reused: besides the rows now in the sheet, the highest number ever
 * issued is remembered (script property IDMAX_<table>), so deleting a row cannot free its number for a new
 * record. The first time, that memory is seeded from the change history, which keeps every ID ever created.
 */
function nextId_(def, rows) {
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r[def.id] || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  const props = PropertiesService.getScriptProperties(), key = 'IDMAX_' + def.name;
  let issued = Number(props.getProperty(key) || 0);
  if (!issued) issued = historyMaxId_(def);
  const n = Math.max(max, issued) + 1;
  props.setProperty(key, String(n));
  return def.prefix + String(n).padStart(def.width, '0');
}
function historyMaxId_(def) {
  if (!def.prefix) return 0;
  const re = new RegExp('^' + def.prefix.replace(/[-]/g, '\\-') + '(\\d+)$');
  let max = 0;
  try {
    readTable_('Audit_Log').rows.forEach(function (a) {
      if (String(a.Sheet) !== def.name) return;
      const m = String(a.Record_ID || '').match(re);
      if (m) max = Math.max(max, Number(m[1]));
    });
  } catch (e) { }
  return max;
}

/*
 * Version stamps. Every write to a table (through insert_, update_ or dropStale_) gives it a new stamp.
 * The page keeps its last copy of a list with the stamps it was built from; if they have not changed,
 * the server answers "same" instead of re-reading and re-sending the data (an ETag-style check).
 * A lost stamp simply gets a new value, which makes the page fetch fresh data: never stale, only slower.
 */
const VERSION_TTL_ = 3600;
function stampKey_(name) { return 'ver_' + name; }
function tableStamps_(names) {
  const c = CacheService.getScriptCache();
  const keys = names.map(stampKey_);
  let got = {};
  try { got = c.getAll(keys) || {}; } catch (e) { got = {}; }
  const missing = {};
  const out = names.map(function (n, i) {
    let v = got[keys[i]];
    if (!v) { v = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); missing[keys[i]] = v; }
    return v;
  });
  if (Object.keys(missing).length) { try { c.putAll(missing, VERSION_TTL_); } catch (e) { } }
  return out;
}
function bumpStamp_(name) {
  try { CacheService.getScriptCache().put(stampKey_(name), Date.now().toString(36) + Math.random().toString(36).slice(2, 8), VERSION_TTL_); } catch (e) { }
}

/** Forgets in-memory and cached copies of a table after a write. */
function dropStale_(name) {
  bumpStamp_(name);
  Object.keys(_tables).forEach(function (k) { if (k === name || k.indexOf(name + '|') === 0) _tables[k] = null; });
  if (CACHED_TABLES_.indexOf(name) >= 0) dropTableCache_(name);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Someone else is saving right now. Try again in a few seconds.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/** Normalises client input: only editable fields, dates parsed, text cleaned. */
function prepare_(def, data) {
  const out = {};
  def.editable.forEach(function (k) {
    if (!(k in data)) return;
    let v = data[k];
    if (def.dates.indexOf(k) >= 0) v = v ? parseYmd_(v) : '';
    else if (typeof v === 'string') v = clean_(v);
    out[k] = v;
  });
  return out;
}

function insert_(def, obj, user) {
  return withLock_(function () {
    const t = readTable_(def.name, true);
    const now = new Date();
    obj[def.id] = nextId_(def, t.rows);
    if (t.headers.indexOf('Created_By') >= 0) { obj.Created_By = user.email; obj.Created_At = now; }
    if (t.headers.indexOf('Updated_By') >= 0) { obj.Updated_By = user.email; obj.Updated_At = now; }
    const row = jdmRow_(def.name, t.headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; }));
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    audit_(user, def.name, obj[def.id], 'Create', '', '', '');
    markDashDirty_(def.name);
    dropStale_(def.name);
    if (typeof daySnapTouch_ === 'function') daySnapTouch_(def.name, null, obj);
    return obj;
  });
}

function update_(def, id, patch, user, guard) {
  return withLock_(function () {
    const t = readTable_(def.name, true);
    const rec = t.rows.filter(function (r) { return String(r[def.id]) === String(id); })[0];
    if (!rec) throw new Error(def.id + ' ' + id + ' was not found. It may have been deleted.');
    if (guard) guard(rec);
    const changes = [];
    Object.keys(patch).forEach(function (k) {
      const before = rec[k] instanceof Date ? ymd_(rec[k]) : String(rec[k] == null ? '' : rec[k]);
      const after = patch[k] instanceof Date ? ymd_(patch[k]) : String(patch[k] == null ? '' : patch[k]);
      if (before !== after) { changes.push([k, before, after]); rec[k] = patch[k]; }
    });
    if (!changes.length) return rec;
    if (t.headers.indexOf('Updated_By') >= 0) { rec.Updated_By = user.email; rec.Updated_At = new Date(); }
    const row = jdmRow_(def.name, t.headers.map(function (h) { return rec[h] === undefined ? '' : rec[h]; }));
    t.sheet.getRange(rec._row, 1, 1, row.length).setValues([row]);
    changes.forEach(function (c) { audit_(user, def.name, id, 'Update', c[0], c[1], c[2]); });
    if (typeof daySnapTouch_ === 'function') daySnapTouch_(def.name, changes, null, rec);
    markDashDirty_(def.name);
    dropStale_(def.name);
    return rec;
  });
}

function audit_(user, sheetName, id, action, field, oldV, newV) {
  const sh = sheet_('Audit_Log');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 8)
    .setValues([[new Date(), user.email, sheetName, id, action, field, clean_(oldV), clean_(newV)]]);
}

function settings_() {
  const map = {};
  readTable_('Settings').rows.forEach(function (r) { map[r.Key] = r.Value; });
  return map;
}
