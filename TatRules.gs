/**
 * TAT rules (Admin > TAT rules). One row per level per version in the TAT_Rules sheet. A version starts on its
 * effective-from date; each clock uses the version in force on the day it started. "Apply to everything" supersedes
 * the level's earlier rows (kept as history) with one version effective for all dates.
 */
const TAT_RULES_ = 'TAT_Rules';
const TAT_RULE_COLS_ = ['Rule_ID', 'Version_ID', 'Effective_From', 'Level', 'Standard_Days', 'Grace_Days', 'Risk_Pct', 'Status', 'Note', 'Created_By', 'Created_At'];

/** Creates the sheet and seeds the baseline from the grade table, with W1-W3 at 20 days (Policy 20.1). */
function tatSchema_() {
  const ss = ss_();
  let sh = ss.getSheetByName(TAT_RULES_);
  if (!sh) { sh = ss.insertSheet(TAT_RULES_); sh.getRange(1, 1, 1, TAT_RULE_COLS_.length).setValues([TAT_RULE_COLS_]).setFontWeight('bold'); sh.setFrozenRows(1); }
  if (sh.getLastRow() > 1) return;
  const grades = {};
  readTable_('M_Grades', true).rows.forEach(function (g) { grades[String(g.Grade).trim().toUpperCase()] = Number(g.Standard_TAT_Days) || 0; });
  const s = settings_(), grace = Number(s.NOTICE_GRACE_DAYS) || 30, risk = Number(s.TAT_AT_RISK_PCT) || 0.8, now = new Date();
  const rows = TAT_LEVELS_.map(function (lv, i) {
    const std = /^W[123]$/.test(lv) ? 20 : (grades[lv] || (lv[0] === 'M' ? 50 : 20));
    return ['TR-' + ('0000' + (i + 1)).slice(-4), 'V1', parseYmd_(TAT_BASE_EFF_), lv, std, grace, risk, 'Active',
      'Baseline from the grade table; W1\u2013W3 set to 20 days per Policy 20.1', 'system', now];
  });
  sh.getRange(2, 1, rows.length, TAT_RULE_COLS_.length).setValues(rows);
  dropStale_(TAT_RULES_);
  syncGradeTableNoLock_();
  try { PropertiesService.getScriptProperties().setProperty('DASH_DIRTY_AT', String(Date.now())); } catch (e) { }
}

function tatVersions_() {
  const by = {};
  readTable_(TAT_RULES_, true).rows.forEach(function (r) {
    const id = String(r.Version_ID || '');
    const v = by[id] = by[id] || { id: id, eff: ymd_(r.Effective_From) || TAT_BASE_EFF_, note: String(r.Note || ''), by: String(r.Created_By || ''),
      at: r.Created_At instanceof Date ? fmt_(r.Created_At, TZ, 'd MMM yyyy, HH:mm') : '', levels: [], active: 0, superseded: 0 };
    v.levels.push({ level: String(r.Level), std: Number(r.Standard_Days), grace: Number(r.Grace_Days), risk: Number(r.Risk_Pct), status: String(r.Status || 'Active') });
    if (String(r.Status || 'Active') === 'Active') v.active++; else v.superseded++;
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return Number(b.id.slice(1)) - Number(a.id.slice(1)); });
}

function apiTatRules() {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'tat_view')) throw new Error('Only a TA Lead, the Head of HR or the admin can see the TAT rules.');
  const ctx = tatContext_();
  const levels = TAT_LEVELS_.map(function (lv) {
    const now = ruleFor_(ctx, lv, ctx.today);
    const list = ctx.rules[lv] || [];
    const next = list.filter(function (r) { return r.eff > ctx.today; })[0];
    return { level: lv, band: lv[0], std: now.std, grace: now.grace, risk: now.risk, eff: now.eff, version: now.version, own: !!ctx.rules[lv],
      next: next ? { eff: next.eff, std: next.std, grace: next.grace, risk: next.risk, version: next.version } : null };
  });
  return { canEdit: can_(u, 'tat_edit'), today: ctx.today, base: TAT_BASE_EFF_, levels: levels, versions: tatVersions_() };
}

/** Validates the proposed rows; returns [{level, std, grace, risk}]. */
function tatRows_(d) {
  const rows = (d && d.rows) || [];
  if (!rows.length) throw new Error('Change at least one level.');
  return rows.map(function (r) {
    const lv = String(r.level || '').trim().toUpperCase();
    if (TAT_LEVELS_.indexOf(lv) < 0) throw new Error('Unknown level ' + lv + '.');
    const std = Number(r.std), grace = Number(r.grace), risk = Number(r.risk) > 1 ? Number(r.risk) / 100 : Number(r.risk);
    if (!(std >= 1 && std <= 365 && std === Math.round(std))) throw new Error(lv + ': standard TAT must be a whole number of days from 1 to 365.');
    if (!(grace >= 0 && grace <= 180 && grace === Math.round(grace))) throw new Error(lv + ': notice grace must be 0 to 180 days.');
    if (!(risk >= 0.5 && risk <= 0.99)) throw new Error(lv + ': "at risk" must be between 50% and 99%.');
    return { level: lv, std: std, grace: grace, risk: Math.round(risk * 100) / 100 };
  });
}
function tatMode_(d) {
  if (d.mode === 'all') return { mode: 'all', eff: TAT_BASE_EFF_ };
  const eff = ymd_(d.eff);
  if (!eff) throw new Error('Pick the date the new rules take effect.');
  return { mode: 'from', eff: eff };
}
/** A copy of the rules with the proposal applied, for previews. */
function tatApply_(rules, rows, m) {
  const out = {};
  Object.keys(rules).forEach(function (k) { out[k] = rules[k].slice(); });
  rows.forEach(function (r) {
    const entry = { eff: m.eff, std: r.std, grace: r.grace, risk: r.risk, version: 'new' };
    if (m.mode === 'all') out[r.level] = [entry];
    else out[r.level] = (out[r.level] || []).filter(function (x) { return x.eff !== m.eff; }).concat([entry]).sort(function (a, b) { return a.eff < b.eff ? -1 : a.eff > b.eff ? 1 : 0; });
  });
  return out;
}

/** What would change: every position, both clocks, before and after. Nothing is saved. */
function apiTatPreview(d) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'tat_edit')) throw new Error('Only the Head of HR or the admin can change TAT rules.');
  d = d || {};
  const rows = tatRows_(d), m = tatMode_(d), ctx = tatContext_();
  const ctx2 = Object.assign({}, ctx, { rules: tatApply_(ctx.rules, rows, m) });
  const levels = {}; rows.forEach(function (r) { levels[r.level] = true; });
  const changes = [], moves = {};
  readTable_(T.MRF.name).rows.forEach(function (l) {
    const g = String(l.Grade || '').trim().toUpperCase();
    if (!levels[g] && !(/^T\d$/.test(g) && levels.T)) return;
    const a = computeTat_(l, ctx), b = computeTat_(l, ctx2);
    [['Recruiter', 'Final_TAT', 'TAT_Result'], ['Position', 'Pos_Final_TAT', 'Pos_TAT_Result']].forEach(function (k) {
      if (a[k[1]] === b[k[1]] && a[k[2]] === b[k[2]]) return;
      if (a[k[2]] !== b[k[2]]) { const key = k[0] + ': ' + (a[k[2]] || '\u2014') + ' \u2192 ' + (b[k[2]] || '\u2014'); moves[key] = (moves[key] || 0) + 1; }
      changes.push({ clock: k[0], id: String(l.Line_ID), mrf: String(l.MRF_No || ''), position: String(l.Position || ''), grade: g, recruiter: String(l.Recruiter || ''),
        status: a.Position_Status, allowedBefore: a[k[1]], allowedAfter: b[k[1]], before: a[k[2]], after: b[k[2]] });
    });
  });
  const positions = {}; changes.forEach(function (c) { positions[c.id] = true; });
  return { mode: m.mode, eff: m.eff, positions: Object.keys(positions).length, changes: changes.length,
    moves: Object.keys(moves).map(function (k) { return { move: k, n: moves[k] }; }).sort(function (a, b) { return b.n - a.n; }),
    sample: changes.filter(function (c) { return c.before !== c.after; }).concat(changes.filter(function (c) { return c.before === c.after; })).slice(0, 60) };
}

function apiTatSave(d) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'tat_edit')) throw new Error('Only the Head of HR or the admin can change TAT rules.');
  d = d || {};
  const rows = tatRows_(d), m = tatMode_(d), note = clean_(String(d.note || '')).trim().slice(0, 300);
  const version = withLock_(function () {
    const t = readTable_(TAT_RULES_, true);
    const vmax = t.rows.reduce(function (mx, r) { return Math.max(mx, Number(String(r.Version_ID || '').replace(/\D/g, '')) || 0); }, 0);
    const imax = t.rows.reduce(function (mx, r) { return Math.max(mx, Number(String(r.Rule_ID || '').replace(/\D/g, '')) || 0); }, 0);
    const vid = 'V' + (vmax + 1), sc = t.headers.indexOf('Status') + 1;
    const levels = {}; rows.forEach(function (r) { levels[r.level] = true; });
    t.rows.forEach(function (r) {
      if (String(r.Status || 'Active') !== 'Active' || !levels[String(r.Level).trim().toUpperCase()]) return;
      if (m.mode === 'all' || (ymd_(r.Effective_From) || TAT_BASE_EFF_) === m.eff) t.sheet.getRange(r._row, sc).setValue('Superseded');
    });
    const now = new Date();
    const vals = rows.map(function (r, i) {
      const o = { Rule_ID: 'TR-' + ('0000' + (imax + i + 1)).slice(-4), Version_ID: vid, Effective_From: parseYmd_(m.eff), Level: r.level, Standard_Days: r.std, Grace_Days: r.grace,
        Risk_Pct: r.risk, Status: 'Active', Note: (m.mode === 'all' ? 'Applied to all positions. ' : '') + note, Created_By: u.email, Created_At: now };
      return t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
    });
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, vals.length, t.headers.length).setValues(vals);
    return vid;
  });
  dropStale_(TAT_RULES_);
  syncGradeTable_();
  audit_(u, TAT_RULES_, version, 'Create', 'rules', '', rows.map(function (r) { return r.level + ' ' + r.std + 'd'; }).join(', ') + (m.mode === 'all' ? ' (all positions)' : ' from ' + m.eff));
  dropTableCache_(); _tables = {};
  if (typeof daySnapDropAll_ === 'function') daySnapDropAll_();
  const n = recomputeAllTat_();
  try { PropertiesService.getScriptProperties().setProperty('DASH_DIRTY_AT', String(Date.now())); } catch (e) { }
  return { version: version, recomputed: n };
}

/** Keeps M_Grades' Standard_TAT_Days showing the days in force today, for anyone reading the sheet. */
function syncGradeTable_() { withLock_(syncGradeTableNoLock_); }
function syncGradeTableNoLock_() {
  const ctx = tatContext_();
  const t = readTable_('M_Grades', true), c = t.headers.indexOf('Standard_TAT_Days') + 1;
  if (c) t.rows.forEach(function (g) {
    const lv = String(g.Grade).trim().toUpperCase();
    if (TAT_LEVELS_.indexOf(lv) < 0) return;
    const std = ruleFor_(ctx, lv, ctx.today).std;
    if (Number(g.Standard_TAT_Days) !== std) t.sheet.getRange(g._row, c).setValue(std);
  });
  dropStale_('M_Grades');
}
