/**
 * One list of divisions and departments (v243, v244).
 *
 * Department and division names are keyed by their text (no IDs), so a name can only change safely when every stored copy changes in the same
 * locked step. This file holds the two operations that do that, both Admin only and both with a check that writes nothing:
 *  - the switch-over (v244): moves every record from the older MRF-form names (M_Departments) onto the organogram's departments, after which the
 *    organogram is the only list (Settings DEPT_MASTER = 'org', read by deptMaster_ in Org.gs);
 *  - rename (v243): corrects the name of an organogram division or department everywhere it is stored.
 * Names are compared with orgKey_ (case and spacing ignored), so stray spellings are corrected too.
 */
function renameKinds_() {
  const one = true;   // v245: new records carry the organogram name from now on, so a rename always reaches the records
  const dept = [[ORG_DEPT_, 'Org_Dept', 'Departments'], [ORG_MAP_, 'Org_Dept', 'Manpower report names'], [ORG_MP_, 'Org_Dept', 'Headcount snapshot'],
    [ORG_PLAN_, 'Org_Dept', 'Manpower plan (all revisions)'], [ORG_NOTE_, 'Org_Dept', 'Grade notes']];
  const div = [[ORG_DIV_, 'Division', 'Divisions'], [ORG_DEPT_, 'Division', 'Departments']];
  if (one) {
    dept.push([T.MRF.name, 'Dept', 'Positions'], [T.CAND.name, 'Dept', 'Candidates'], [CAND_ARCHIVE_, 'Dept', 'Archived candidates'], [BGV_CASES_.name, 'Dept', 'BGV cases'],
      [T.JDMD.name, 'CRM_Dept', 'JD department mapping']);
    div.push([T.CAND.name, 'Division', 'Candidates'], [CAND_ARCHIVE_, 'Division', 'Archived candidates']);
  }
  return { org_dept: { label: 'department', cols: dept, records: one }, org_div: { label: 'division', cols: div, records: one } };
}
function renameName_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
/** A missing sheet or column is skipped (older workbooks may not have every table). */
function renameTable_(name, col) {
  let t; try { t = readTable_(name, true); } catch (e) { return null; }
  const ci = t.headers.indexOf(col); return ci < 0 ? null : { t: t, ci: ci };
}
/** Writes the given { _row: value } cells of one column, one write per run of neighbouring rows. */
function renameWrite_(sheet, colNo, cells) {
  const rows = Object.keys(cells).map(Number).sort(function (a, b) { return a - b; });
  if (!rows.length) return;
  let runs = 1; for (let k = 1; k < rows.length; k++) if (rows[k] !== rows[k - 1] + 1) runs++;
  if (runs > 40) {   // many scattered cells (the switch-over): rewrite the column once instead of hundreds of small writes
    const last = sheet.getLastRow(), rng = sheet.getRange(2, colNo, last - 1, 1), vals = rng.getValues();
    rows.forEach(function (r) { if (r >= 2 && r <= last) vals[r - 2][0] = cells[r]; });
    rng.setValues(vals.map(function (v) { return [jdmSafeText_(v[0])]; }));
    return;
  }
  let i = 0;
  while (i < rows.length) {
    let j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    sheet.getRange(rows[i], colNo, j - i + 1, 1).setValues(rows.slice(i, j + 1).map(function (r) { return [jdmSafeText_(cells[r])]; }));
    i = j + 1;
  }
}
/**
 * The HOD-feedback task key carries the department name ('hod_feedback|recruiter|dept'); notes and chase counts hang on that key.
 * toFn(dept) gives the new name, or '' to leave the key alone. Returns { n, touched }.
 */
function renameTasks_(toFn, apply) {
  let n = 0; const touched = [];
  [T.TASK.name, T.TACT.name].forEach(function (name) {
    const x = renameTable_(name, 'Task_Key'); if (!x) return;
    const have = {}; x.t.rows.forEach(function (r) { have[String(r.Task_Key)] = true; });
    const keys = {}, ctx = {}, cx = x.t.headers.indexOf('Context');
    x.t.rows.forEach(function (r) {
      const p = String(r.Task_Key || '').split('|'); if (p[0] !== 'hod_feedback' || p.length < 3) return;
      const old = p.slice(2).join('|'), to = toFn(old); if (!to) return;
      const nk = p[0] + '|' + p[1] + '|' + to; if (nk === String(r.Task_Key)) return;
      if (name === T.TASK.name && have[nk]) return;   // two old names landing on one key: the first keeps it
      have[nk] = true; keys[r._row] = nk; n++;
      if (cx >= 0) { const c = String(r.Context || ''), at = c.indexOf(' · '); if (at > 0 && orgKey_(c.slice(0, at)) === orgKey_(old)) ctx[r._row] = to + c.slice(at); }
    });
    if (!apply || !Object.keys(keys).length) return;
    renameWrite_(x.t.sheet, x.ci + 1, keys); if (Object.keys(ctx).length) renameWrite_(x.t.sheet, cx + 1, ctx);
    touched.push(name);
  });
  return { n: n, touched: touched };
}
function renameAdmin_(what) {
  const u = currentUser_(); ensureSchema_();
  if (u.role !== ROLES.ADMIN) throw new Error('Only the admin can ' + what + '.');
  return u;
}
/** Drops every cached view that shows a department name. */
function renameDrop_(touched) {
  Object.keys(touched).forEach(function (n) { dropStale_(n); });
  if (touched[T.MRF.name]) markDashDirty_(T.MRF.name);
  if (touched[T.CAND.name]) markDashDirty_(T.CAND.name);
  if (touched[T.MRF.name] || touched[T.CAND.name]) daySnapDropAll_();
}

/* ---------------- Rename an organogram division or department ---------------- */

function renameRun_(kind, oldName, newName, apply) {
  const u = renameAdmin_('rename a division or a department');
  const def = renameKinds_()[String(kind)]; if (!def) throw new Error('Unknown kind of name.');
  const from = renameName_(oldName), to = renameName_(newName), ok = orgKey_(from), nk = orgKey_(to);
  if (!from) throw new Error('Choose the name to correct.');
  if (!to) throw new Error('Enter the corrected name.');
  if (to.length > 80) throw new Error('The name is too long (80 characters at most).');
  if (/[|\n\r\t]/.test(to) || /^[=+@'-]/.test(to)) throw new Error('The name cannot contain | or start with = + - @ or an apostrophe.');
  return withLock_(function () {
    const parts = def.cols.map(function (c) { const x = renameTable_(c[0], c[1]); return x ? { name: c[0], col: c[1], label: c[2], t: x.t, ci: x.ci } : null; }).filter(Boolean);
    const master = parts[0];
    if (!master || master.name !== def.cols[0][0]) throw new Error('The ' + def.label + ' list was not found.');
    if (!master.t.rows.some(function (r) { return orgKey_(r[master.col]) === ok; })) throw new Error('"' + from + '" is not in the ' + def.label + ' list. Reload and try again.');
    if (kind === 'org_dept' && !deptMasterIsOrg_()) {   // before the switch-over: an older name with the same text, matched elsewhere, cannot be told apart on the records
      const clash = readTable_(ORG_MAP_, true).rows.filter(function (r) { return orgKey_(r.CRM_Dept) === ok && String(r.Org_Dept || '').trim() && orgKey_(r.Org_Dept) !== ok; })[0];
      if (clash) throw new Error('The older name "' + clash.CRM_Dept + '" is matched to ' + clash.Org_Dept + ', so records carrying it cannot be told apart from this department. Run the switch-over first (Department mapping).');
    }
    if (nk !== ok) parts.forEach(function (p) {   // never merge two names: the corrected name must not be in use anywhere this kind is stored
      if (p.t.rows.some(function (r) { return orgKey_(r[p.col]) === nk; })) throw new Error('"' + to + '" is already in use (' + p.label + '). Choose a different name; two names cannot be merged here.');
    });
    const tables = []; let total = 0; const touched = {};
    parts.forEach(function (p) {
      const cells = {}; let n = 0;
      p.t.rows.forEach(function (r) { if (orgKey_(r[p.col]) === ok && String(r[p.col]) !== to) { cells[r._row] = to; n++; } });
      tables.push({ table: p.name, col: p.col, label: p.label, n: n }); total += n;
      if (apply && n) { renameWrite_(p.t.sheet, p.ci + 1, cells); touched[p.name] = true; }
    });
    if (kind === 'org_dept' && def.records) {
      const tk = renameTasks_(function (d) { return orgKey_(d) === ok ? to : ''; }, apply);
      tables.push({ table: T.TASK.name, col: 'Task_Key', label: 'HOD feedback tasks and their notes', n: tk.n }); total += tk.n;
      tk.touched.forEach(function (n) { touched[n] = true; });
    }
    const out = { kind: String(kind), label: def.label, from: from, to: to, tables: tables, total: total, applied: false };
    if (kind === 'org_dept' && def.records) { const a = deptFunction_(from), b = deptFunction_(to); if (a !== b) out.fn = { before: a, after: b }; }
    if (!apply) return out;
    if (!total) throw new Error('Nothing to change: every record already shows "' + to + '".');
    const a = sheet_('Audit_Log'), now = new Date();
    const rows = tables.filter(function (x) { return x.n; }).map(function (x) { return [now, u.email, x.table, clean_(from), 'Rename', x.col + ' (' + x.n + (x.n === 1 ? ' record)' : ' records)'), clean_(from), clean_(to)]; });
    a.getRange(a.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    renameDrop_(touched);
    out.applied = true;
    return out;
  });
}
/** What a rename would change, per table. Writes nothing. */
function apiRenamePreview(kind, oldName, newName) { return renameRun_(kind, oldName, newName, false); }
/** Renames a division or a department everywhere it is stored. */
function apiRenameApply(kind, oldName, newName) { return renameRun_(kind, oldName, newName, true); }

/* ---------------- The switch-over to one list (v244) ---------------- */

/** Every table whose records carry a department. The first is the positions table. */
function deptSwitchSources_() {
  return [[T.MRF.name, 'Positions'], [T.CAND.name, 'Candidates'], [CAND_ARCHIVE_, 'Archived candidates'], [BGV_CASES_.name, 'BGV cases']];
}
/**
 * Works out the whole switch-over without writing: for every record, the organogram department its old name is matched to (the mapping first,
 * else a department of the same name). A name in use with no active match blocks the switch-over.
 */
function deptTarget_() {
  const grp = {}, org = {}, map = {};
  readTable_(ORG_DIV_, true).rows.forEach(function (d) { grp[orgKey_(d.Division)] = String(d.Division_Group || '').trim(); });
  readTable_(ORG_DEPT_, true).rows.forEach(function (r) {
    const n = String(r.Org_Dept || '').trim(); if (!n || String(r.Active || 'Yes') === 'No') return;
    const dv = String(r.Division || '').trim(); org[orgKey_(n)] = { dept: n, division: dv, bu: grp[orgKey_(dv)] || '' };
  });
  readTable_(ORG_MAP_, true).rows.forEach(function (r) { const o = String(r.Org_Dept || '').trim(); if (o) map[orgKey_(r.CRM_Dept)] = orgKey_(o); });
  return { org: org, target: function (name) { const k = orgKey_(name); return k ? (org[k] || org[map[k]] || null) : null; } };   // its own name first, then the mapping
}
function deptSwitchPlan_() {
  const tg0 = deptTarget_(), org = tg0.org, target = tg0.target;
  const unmatched = {}, feeds = {}, parts = [];
  deptSwitchSources_().forEach(function (src) {
    const x = renameTable_(src[0], 'Dept'); if (!x) return;
    const p = { name: src[0], label: src[1], t: x.t, ci: x.ci, dept: {}, div: {}, bu: {}, pairs: {}, n: 0 };
    const di = src[0] === T.MRF.name ? -1 : x.t.headers.indexOf('Division'), bi = src[0] === T.MRF.name ? -1 : x.t.headers.indexOf('Business_Unit');
    p.di = di; p.bi = bi;
    x.t.rows.forEach(function (r) {
      const old = String(r.Dept == null ? '' : r.Dept), nm = old.trim(); if (!nm) return;
      const tg = target(nm);
      if (!tg) { const m = unmatched[nm] = unmatched[nm] || { name: nm, n: 0, where: {} }; m.n++; m.where[src[1]] = (m.where[src[1]] || 0) + 1; return; }
      (feeds[tg.dept] = feeds[tg.dept] || {})[orgKey_(nm)] = true;
      let ch = false;
      if (old !== tg.dept) { p.dept[r._row] = tg.dept; ch = true; const k = nm + '\u0001' + tg.dept; p.pairs[k] = (p.pairs[k] || 0) + 1; }
      if (di >= 0 && String(r.Division == null ? '' : r.Division) !== tg.division) { p.div[r._row] = tg.division; ch = true; }
      if (bi >= 0 && String(r.Business_Unit == null ? '' : r.Business_Unit) !== tg.bu) { p.bu[r._row] = tg.bu; ch = true; }
      if (ch) p.n++;
    });
    parts.push(p);
  });
  return { org: org, target: target, parts: parts, feeds: feeds,
    unmatched: Object.keys(unmatched).sort().map(function (k) { const m = unmatched[k]; return { name: m.name, n: m.n, where: Object.keys(m.where).map(function (w) { return w + ' ' + m.where[w]; }).join(', ') }; }) };
}
/** JD department mapping: one row per organogram department. Where several old names merge, a confirmed or manual row wins, else the first. */
function deptSwitchJd_(plan, apply) {
  const x = renameTable_(T.JDMD.name, 'CRM_Dept'); if (!x) return { kept: 0, dropped: 0, touched: false };
  const best = {}, order = [], rank = function (r, tg) { return (r.Confirmed_By || String(r.Basis) === 'Manual' ? 0 : 2) + (orgKey_(r.CRM_Dept) === orgKey_(tg.dept) ? 0 : 1); };
  let dropped = 0;
  x.t.rows.forEach(function (r) {
    const tg = plan.target(r.CRM_Dept); if (!tg) { dropped++; return; }   // an old name no record uses
    const b = best[tg.dept];
    if (!b) { best[tg.dept] = r; order.push(tg.dept); } else { dropped++; if (rank(r, tg) < rank(b, tg)) best[tg.dept] = r; }
  });
  const changed = dropped > 0 || order.some(function (d) { return String(best[d].CRM_Dept) !== d; });
  if (apply && changed) {
    const h = x.t.headers, sh = x.t.sheet, last = sh.getLastRow();
    const rows = order.map(function (d) { const r = best[d]; return h.map(function (c) { return c === 'CRM_Dept' ? jdmSafeText_(d) : r[c] === undefined ? '' : jdmSafeText_(r[c]); }); });
    if (last > 1) sh.getRange(2, 1, last - 1, h.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, h.length).setValues(rows);
  }
  return { kept: order.length, dropped: dropped, touched: apply && changed };
}
/** HOD contacts saved on the old list move to the organogram department when it has none and the old names that merge into it agree. */
function deptSwitchHods_(plan, apply) {
  const old = renameTable_('M_Departments', 'Dept'), x = renameTable_(ORG_DEPT_, 'Org_Dept'); if (!old || !x) return 0;
  const names = {}, emails = {};
  old.t.rows.forEach(function (r) {
    const tg = plan.target(r.Dept); if (!tg) return;
    const n = String(r.HOD_Name || '').trim(), e = String(r.HOD_Email || '').trim().toLowerCase();
    if (n) (names[tg.dept] = names[tg.dept] || {})[n] = true;
    if (e) (emails[tg.dept] = emails[tg.dept] || {})[e] = true;
  });
  const only = function (o) { const k = Object.keys(o || {}); return k.length === 1 ? k[0] : ''; };
  const nc = {}, ec = {}, ni = x.t.headers.indexOf('HOD_Name'), ei = x.t.headers.indexOf('HOD_Email');
  x.t.rows.forEach(function (r) {
    const d = String(r.Org_Dept || '').trim(), n = only(names[d]), e = only(emails[d]);
    if (ni >= 0 && n && !String(r.HOD_Name || '').trim()) nc[r._row] = n;
    if (ei >= 0 && e && !String(r.HOD_Email || '').trim()) ec[r._row] = e;
  });
  if (apply) { if (Object.keys(nc).length) renameWrite_(x.t.sheet, ni + 1, nc); if (Object.keys(ec).length) renameWrite_(x.t.sheet, ei + 1, ec); }
  const rows = {}; Object.keys(nc).concat(Object.keys(ec)).forEach(function (k) { rows[k] = true; });
  return Object.keys(rows).length;
}
function deptSwitchRun_(apply) {
  const u = renameAdmin_('switch the app to one department list');
  return withLock_(function () {
    if (deptMasterIsOrg_()) { if (apply) throw new Error('Every record already carries its organogram department.'); return { switched: true, ready: false, unmatched: [], tables: [], total: 0 }; }
    const plan = deptSwitchPlan_();
    const tk = renameTasks_(function (d) { const tg = plan.target(d); return tg ? tg.dept : ''; }, false);
    const jd = deptSwitchJd_(plan, false), hods = deptSwitchHods_(plan, false);
    const tables = plan.parts.map(function (p) { return { table: p.name, label: p.label, n: p.n }; });
    tables.push({ table: T.TASK.name, label: 'HOD feedback tasks and their notes', n: tk.n });
    const merged = Object.keys(plan.feeds).filter(function (d) { return Object.keys(plan.feeds[d]).length > 1; }).length;
    const out = { switched: false, ready: !plan.unmatched.length, unmatched: plan.unmatched, tables: tables, total: tables.reduce(function (s, x) { return s + x.n; }, 0),
      merged: merged, departments: Object.keys(plan.org).length, jd: { kept: jd.kept, dropped: jd.dropped }, hods: hods, applied: false };
    if (!apply) return out;
    if (plan.unmatched.length) throw new Error('Match these departments first (Admin → Org structure → Department mapping): ' + plan.unmatched.slice(0, 12).map(function (m) { return m.name; }).join(', ') + (plan.unmatched.length > 12 ? ' and ' + (plan.unmatched.length - 12) + ' more' : '') + '.');
    const touched = {}, audit = [], now = new Date();
    plan.parts.forEach(function (p) {
      [[p.dept, p.ci], [p.div, p.di], [p.bu, p.bi]].forEach(function (c) { if (c[1] >= 0 && Object.keys(c[0]).length) { renameWrite_(p.t.sheet, c[1] + 1, c[0]); touched[p.name] = true; } });
      Object.keys(p.pairs).sort().forEach(function (k) { const a = k.split('\u0001'); audit.push([now, u.email, p.name, clean_(a[0]), 'Rename', 'Dept (' + p.pairs[k] + (p.pairs[k] === 1 ? ' record)' : ' records)'), clean_(a[0]), clean_(a[1])]); });
    });
    renameTasks_(function (d) { const tg = plan.target(d); return tg ? tg.dept : ''; }, true).touched.forEach(function (n) { touched[n] = true; });
    if (deptSwitchJd_(plan, true).touched) touched[T.JDMD.name] = true;
    if (deptSwitchHods_(plan, true)) touched[ORG_DEPT_] = true;
    audit.push([now, u.email, 'Settings', 'DEPT_MASTER', 'Update', 'Value', '', 'org']);
    const a = sheet_('Audit_Log'); a.getRange(a.getLastRow() + 1, 1, audit.length, 8).setValues(audit);
    setSetting_('DEPT_MASTER', 'org', 'v244: the organogram is the only list of divisions and departments (set by the switch-over; do not clear)');
    touched[T.MRF.name] = true; touched[ORG_DEPT_] = true;
    renameDrop_(touched);
    out.applied = true; out.switched = true;
    return out;
  });
}
/** The check before the switch-over: what would change, and the names that still need matching. Writes nothing. */
function apiDeptSwitchPreview() { return deptSwitchRun_(false); }
/** Moves every record onto the organogram's departments and makes the organogram the only list. */
function apiDeptSwitchApply() { return deptSwitchRun_(true); }
