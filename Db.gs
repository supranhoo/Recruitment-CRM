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

/** Reads a whole table in one call. Rows are objects keyed by header; _row is the sheet row number. */
function readTable_(name, fresh) {
  if (_tables[name] && !fresh) return _tables[name];
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = values.shift().map(String);
  const rows = [];
  values.forEach(function (r, i) {
    if (!r.some(function (v) { return v !== '' && v !== null; })) return;
    const o = { _row: i + 2 };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    rows.push(o);
  });
  return (_tables[name] = { headers: headers, rows: rows, sheet: sh });
}

/** Converts Dates to yyyy-MM-dd strings so objects can cross google.script.run. */
function toClient_(o) {
  const out = {};
  Object.keys(o).forEach(function (k) {
    const v = o[k];
    if (v instanceof Date) out[k] = isNaN(v) ? '' : Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    else out[k] = v === null ? '' : v;
  });
  return out;
}

function ymd_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v).slice(0, 10);
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

function nextId_(def, rows) {
  let max = 0;
  rows.forEach(function (r) {
    const m = String(r[def.id] || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return def.prefix + String(max + 1).padStart(def.width, '0');
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
    const row = t.headers.map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    audit_(user, def.name, obj[def.id], 'Create', '', '', '');
    markDashDirty_(def.name);
    _tables[def.name] = null;
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
    const row = t.headers.map(function (h) { return rec[h] === undefined ? '' : rec[h]; });
    t.sheet.getRange(rec._row, 1, 1, row.length).setValues([row]);
    changes.forEach(function (c) { audit_(user, def.name, id, 'Update', c[0], c[1], c[2]); });
    markDashDirty_(def.name);
    _tables[def.name] = null;
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
