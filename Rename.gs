/**
 * v243: correct a division or department name and carry it to every record.
 *
 * Both name lists use the name text itself as the key (no IDs): the CRM department list (M_Departments, the Department dropdown on the MRF and
 * candidate forms) and the organogram structure (Org_Divisions, Org_Departments). A rename is safe only when every stored copy of the name changes
 * in the same locked step, so each kind below lists every table and column that holds it. Admin only. The preview writes nothing.
 * Names are compared with orgKey_ (case and spacing ignored), so stray variants of the old name are corrected too.
 */
function renameKinds_() {
  return {
    crm_dept: { label: 'CRM department', cols: [['M_Departments', 'Dept', 'Department list (MRF form)'], [T.MRF.name, 'Dept', 'Positions'], [T.CAND.name, 'Dept', 'Candidates'],
      [CAND_ARCHIVE_, 'Dept', 'Archived candidates'], [BGV_CASES_.name, 'Dept', 'BGV cases'], [ORG_MAP_, 'CRM_Dept', 'Organogram mapping'], [T.JDMD.name, 'CRM_Dept', 'JD department mapping']] },
    crm_div: { label: 'CRM division', cols: [['M_Departments', 'Division', 'Department list (MRF form)'], [T.CAND.name, 'Division', 'Candidates']] },
    crm_bu: { label: 'CRM business unit', cols: [['M_Departments', 'Business_Unit', 'Department list (MRF form)'], [T.CAND.name, 'Business_Unit', 'Candidates']] },
    org_dept: { label: 'Organogram department', cols: [[ORG_DEPT_, 'Org_Dept', 'Organogram departments'], [ORG_MAP_, 'Org_Dept', 'Organogram mapping'], [ORG_MP_, 'Org_Dept', 'Headcount snapshot'],
      [ORG_PLAN_, 'Org_Dept', 'Manpower plan (all revisions)'], [ORG_NOTE_, 'Org_Dept', 'Grade notes']] },
    org_div: { label: 'Organogram division', cols: [[ORG_DIV_, 'Division', 'Organogram divisions'], [ORG_DEPT_, 'Division', 'Organogram departments']] }
  };
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
  let i = 0;
  while (i < rows.length) {
    let j = i; while (j + 1 < rows.length && rows[j + 1] === rows[j] + 1) j++;
    sheet.getRange(rows[i], colNo, j - i + 1, 1).setValues(rows.slice(i, j + 1).map(function (r) { return [jdmSafeText_(cells[r])]; }));
    i = j + 1;
  }
}
/** The HOD-feedback task key carries the department name ('hod_feedback|recruiter|dept'); notes and chase counts hang on that key. */
function renameTaskKey_(key, ok, to) {
  const p = String(key || '').split('|'); if (p[0] !== 'hod_feedback' || p.length < 3) return null;
  if (orgKey_(p.slice(2).join('|')) !== ok) return null;
  const nk = p[0] + '|' + p[1] + '|' + to; return nk === String(key) ? null : nk;
}
function renameTasks_(ok, to, apply) {
  let n = 0; const touched = [];
  [T.TASK.name, T.TACT.name].forEach(function (name) {
    const x = renameTable_(name, 'Task_Key'); if (!x) return;
    const have = {}; x.t.rows.forEach(function (r) { have[String(r.Task_Key)] = true; });
    const keys = {}, ctx = {}, cx = x.t.headers.indexOf('Context');
    x.t.rows.forEach(function (r) {
      const nk = renameTaskKey_(r.Task_Key, ok, to); if (!nk) return;
      if (name === T.TASK.name && have[nk]) return;   // two spellings of the old name would land on one key: the first keeps it
      have[nk] = true; keys[r._row] = nk; n++;
      if (cx >= 0) { const c = String(r.Context || ''), at = c.indexOf(' · '); if (at > 0 && orgKey_(c.slice(0, at)) === ok) ctx[r._row] = to + c.slice(at); }
    });
    if (!apply || !Object.keys(keys).length) return;
    renameWrite_(x.t.sheet, x.ci + 1, keys); if (Object.keys(ctx).length) renameWrite_(x.t.sheet, cx + 1, ctx);
    touched.push(name);
  });
  return { n: n, touched: touched };
}
function renameRun_(kind, oldName, newName, apply) {
  const u = currentUser_(); ensureSchema_();
  if (u.role !== ROLES.ADMIN) throw new Error('Only the admin can rename a division or a department.');
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
    if (!parts.some(function (p) { return (kind !== 'crm_dept' && kind !== 'org_dept' || p === master) && p.t.rows.some(function (r) { return orgKey_(r[p.col]) === ok; }); })) throw new Error('"' + from + '" is not in the ' + def.label + ' list. Reload and try again.');
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
    if (kind === 'crm_dept') {
      const tk = renameTasks_(ok, to, apply);
      tables.push({ table: T.TASK.name, col: 'Task_Key', label: 'HOD feedback tasks and their notes', n: tk.n }); total += tk.n;
      tk.touched.forEach(function (n) { touched[n] = true; });
    }
    const out = { kind: String(kind), label: def.label, from: from, to: to, tables: tables, total: total, applied: false };
    if (kind === 'crm_dept') { const a = deptFunction_(from), b = deptFunction_(to); if (a !== b) out.fn = { before: a, after: b }; }
    if (!apply) return out;
    if (!total) throw new Error('Nothing to change: every record already shows "' + to + '".');
    const a = sheet_('Audit_Log'), now = new Date();
    const rows = tables.filter(function (x) { return x.n; }).map(function (x) { return [now, u.email, x.table, clean_(from), 'Rename', x.col + ' (' + x.n + (x.n === 1 ? ' record)' : ' records)'), clean_(from), clean_(to)]; });
    a.getRange(a.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    Object.keys(touched).forEach(function (n) { dropStale_(n); });
    if (touched[T.MRF.name]) markDashDirty_(T.MRF.name);
    if (touched[T.CAND.name]) markDashDirty_(T.CAND.name);
    if (touched[T.MRF.name] || touched[T.CAND.name]) daySnapDropAll_();
    out.applied = true;
    return out;
  });
}
/** What a rename would change, per table. Writes nothing. */
function apiRenamePreview(kind, oldName, newName) { return renameRun_(kind, oldName, newName, false); }
/** Renames a division or a department everywhere it is stored. */
function apiRenameApply(kind, oldName, newName) { return renameRun_(kind, oldName, newName, true); }
/**
 * The CRM names for the rename panel: each department (its division, business unit and how many positions carry it), and the division and
 * business-unit names with how many departments and candidates carry each (a candidate keeps a copy of both).
 */
function renameCrmList_() {
  const n = {}; readTable_(T.MRF.name).rows.forEach(function (l) { const k = orgKey_(l.Dept); if (k) n[k] = (n[k] || 0) + 1; });
  const md = readTable_('M_Departments').rows, cands = readTable_(T.CAND.name).rows;
  const tally = function (col) {
    const m = {}, add = function (v, f) { const s = renameName_(v), k = orgKey_(s); if (!k) return; (m[k] = m[k] || { name: s, depts: 0, cands: 0 })[f]++; };
    md.forEach(function (d) { add(d[col], 'depts'); }); cands.forEach(function (c) { add(c[col], 'cands'); });
    return Object.keys(m).sort().map(function (k) { return m[k]; });
  };
  return { depts: md.filter(function (d) { return String(d.Dept || '').trim(); }).map(function (d) {
    return { dept: String(d.Dept).trim(), division: String(d.Division || '').trim(), bu: String(d.Business_Unit || '').trim(), lines: n[orgKey_(d.Dept)] || 0 };
  }), divisions: tally('Division'), bus: tally('Business_Unit') };
}
