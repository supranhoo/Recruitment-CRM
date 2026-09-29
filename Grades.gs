/**
 * Grades and designations (v62, schema 27). A grade (M6) is a pay level; a designation (Officer, Senior Engineer) is a
 * title within one grade. One grade holds many designations, so they are kept apart: M_Grades lists the grades,
 * M_Designations one row per designation per grade, and every position line carries its own Designation.
 * Documents made for a position (JD, screening questions) use that position's designation, never the grade's full list.
 * M_Grades.Designations is kept as a read-only summary of the active designations for anyone reading the sheet.
 */
T.DESIG = { name: 'M_Designations', id: 'Designation_ID', prefix: 'DSG-', width: 4, dates: [], editable: [] };
const DESIG_COLS_ = ['Designation_ID', 'Designation', 'Grade', 'Active', 'Note', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
/** Short forms used in the old grade labels ("Engr/SE, Officer/Sr Officer") and in position titles. */
const DESIG_ABBR_ = { engr: 'Engineer', eng: 'Engineer', se: 'Senior Engineer', sr: 'Senior', snr: 'Senior', jr: 'Junior', asst: 'Assistant', dy: 'Deputy',
  mgr: 'Manager', exec: 'Executive', offr: 'Officer', supvr: 'Supervisor' };

function gradeKey_(g) { return String(g || '').trim().toUpperCase(); }
function desigKey_(d) { return String(d || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
/** "Sr. Engr" -> "Senior Engineer": expands whole-word short forms, keeps every other word as typed. */
function desigExpand_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().split(' ').map(function (w) {
    const k = w.toLowerCase().replace(/\.$/, '');
    return DESIG_ABBR_[k] || w;
  }).join(' ');
}
/** The position's designation and title together, for rules that read the job title (M5 Junior Manager, shift roles). */
function lineTitle_(line) { return [line.Designation, line.Position].filter(Boolean).join(' '); }
function desigWords_(s) { return desigExpand_(String(s || '').replace(/[^A-Za-z0-9&. ]/g, ' ')).toLowerCase().split(/\s+/).filter(Boolean); }

/** Active designations per grade: { M6: ['Officer', 'Senior Officer', ...] }. */
function designationsByGrade_(includeInactive) {
  const by = {};
  readTable_(T.DESIG.name).rows.forEach(function (r) {
    if (!includeInactive && String(r.Active) === 'No') return;
    const g = gradeKey_(r.Grade); (by[g] = by[g] || []).push(String(r.Designation));
  });
  return by;
}

/** Client copy of the grade list for the page: grade, band, TAT days, active flag, and its active designations. */
function gradesForClient_() {
  const by = designationsByGrade_(false);
  return readTable_('M_Grades').rows.map(function (r) {
    const g = gradeKey_(r.Grade);
    return { grade: String(r.Grade), band: String(r.Band || ''), tat: Number(r.Standard_TAT_Days) || 0, active: String(r.Active) !== 'No', designations: by[g] || [] };
  });
}

/**
 * A position's designation must be one listed for its grade. A value the line already had is kept even if it has since
 * been deactivated or the list changed, so old positions can still be saved. New positions must pick one when the grade has any.
 */
function checkDesignation_(patch, old) {
  if (!('Designation' in patch) && !('Grade' in patch)) return;
  const g = gradeKey_('Grade' in patch ? patch.Grade : old && old.Grade);
  const d = String(('Designation' in patch ? patch.Designation : old && old.Designation) || '').replace(/\s+/g, ' ').trim();
  if ('Designation' in patch) patch.Designation = d;
  const list = designationsByGrade_(false)[g] || [];
  if (!d) {
    if (!old && list.length) throw new Error('Pick the designation for this ' + g + ' position (for example ' + list.slice(0, 3).join(', ') + ').');
    return;
  }
  const keep = old && desigKey_(old.Designation) === desigKey_(d) && gradeKey_(old.Grade) === g;
  const hit = list.filter(function (x) { return desigKey_(x) === desigKey_(d); })[0];
  if (hit) { if ('Designation' in patch) patch.Designation = hit; return; }
  if (keep) return;
  throw new Error('"' + d + '" is not a designation in grade ' + g + '. Pick one from the list, or ask a TA Lead to add it in Admin → Grades & designations.');
}

/* ---------------- Admin → Grades & designations ---------------- */

function apiGradeSetup() {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see grade settings.');
  const used = {}, lines = {};
  readTable_(T.MRF.name).rows.forEach(function (l) {
    const g = gradeKey_(l.Grade), k = g + '|' + desigKey_(l.Designation);
    lines[g] = (lines[g] || 0) + 1;
    if (l.Designation) used[k] = (used[k] || 0) + 1;
  });
  return {
    grades: readTable_('M_Grades', true).rows.map(function (r) {
      return { grade: String(r.Grade), band: String(r.Band || ''), tat: Number(r.Standard_TAT_Days) || 0, active: String(r.Active) !== 'No', lines: lines[gradeKey_(r.Grade)] || 0 };
    }),
    desigs: readTable_(T.DESIG.name, true).rows.map(function (r) {
      return { id: String(r.Designation_ID), designation: String(r.Designation), grade: String(r.Grade), active: String(r.Active) !== 'No', note: String(r.Note || ''),
        used: used[gradeKey_(r.Grade) + '|' + desigKey_(r.Designation)] || 0 };
    })
  };
}

/**
 * Saves the grade and designation lists in one go. Grades: band and active can change; new grades need a code and TAT days.
 * Designations: add, rename, move to another grade (only while no position uses it) and deactivate. Nothing is deleted.
 * A rename is carried to every position of that grade using the old name, so the positions and their documents stay in step.
 */
function apiSaveGradeSetup(d) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can change grades and designations.');
  d = d || {};
  withLock_(function () {
    const writes = [], audits = [];
    const log = function () { audits.push([].slice.call(arguments)); };
    const gt = readTable_('M_Grades', true), gh = gt.headers;
    const gByKey = {}; gt.rows.forEach(function (r) { gByKey[gradeKey_(r.Grade)] = r; });
    const col = function (h) { return gh.indexOf(h) + 1; };
    (d.grades || []).forEach(function (x) {
      const band = clean_(String(x.band || '').replace(/\s+/g, ' ').trim()), active = x.active === false ? 'No' : 'Yes';
      if (band.length > 60) throw new Error('Keep the band for ' + x.grade + ' under 60 characters.');
      if (x.isNew) {
        const g = gradeKey_(x.grade);
        if (!/^[A-Z][A-Z0-9]{0,4}$/.test(g)) throw new Error('A grade code is a letter followed by up to four letters or digits, for example M8.');
        if (gByKey[g]) throw new Error('Grade ' + g + ' already exists.');
        const tat = Number(x.tat);
        if (!(tat >= 1 && tat <= 365 && Math.round(tat) === tat)) throw new Error('Enter the standard TAT days for ' + g + ' (1–365).');
        const row = gh.map(function (h) { return h === 'Grade' ? g : h === 'Band' ? jdmSafeText_(band) : h === 'Standard_TAT_Days' ? tat : h === 'Active' ? active : ''; });
        writes.push(function () { gt.sheet.getRange(gt.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]); });
        gByKey[g] = { Grade: g, Band: band, Active: active };
        log('M_Grades', g, 'Create', '', '', band + ' · ' + tat + ' days');
        return;
      }
      const r = gByKey[gradeKey_(x.grade)]; if (!r) return;
      if (band !== String(r.Band || '')) { writes.push(function () { gt.sheet.getRange(r._row, col('Band')).setValue(jdmSafeText_(band)); }); log('M_Grades', r.Grade, 'Update', 'Band', String(r.Band || ''), band); }
      const was = String(r.Active) === 'No' ? 'No' : 'Yes';
      if (active !== was && col('Active')) { writes.push(function () { gt.sheet.getRange(r._row, col('Active')).setValue(active); }); log('M_Grades', r.Grade, 'Update', 'Active', was, active); }
    });

    const dt = readTable_(T.DESIG.name, true), dh = dt.headers, now = new Date();
    const rows = dt.rows.slice(), byId = {}; rows.forEach(function (r) { byId[String(r.Designation_ID)] = r; });
    const renames = [];
    const mrf = readTable_(T.MRF.name, true);
    const usedBy = function (g, name) { return mrf.rows.filter(function (l) { return gradeKey_(l.Grade) === g && desigKey_(l.Designation) === desigKey_(name); }).length; };
    (d.desigs || []).forEach(function (x) {
      const name = clean_(desigExpand_(String(x.designation || '').replace(/\s+/g, ' ').trim())), g = gradeKey_(x.grade), active = x.active === false ? 'No' : 'Yes';
      const note = clean_(String(x.note || '').trim()).slice(0, 200);
      if (!name) throw new Error('A designation cannot be blank' + (g ? ' (grade ' + g + ')' : '') + '.');
      if (name.length > 60) throw new Error('Keep "' + name.slice(0, 30) + '…" under 60 characters.');
      if (!gByKey[g]) throw new Error('Pick a grade for "' + name + '".');
      const r = x.id ? byId[String(x.id)] : null;
      if (x.id && !r) throw new Error('Designation ' + x.id + ' was not found. Reload the page.');
      if (r) {
        const oldG = gradeKey_(r.Grade), oldName = String(r.Designation);
        if (g !== oldG && usedBy(oldG, oldName)) throw new Error('"' + oldName + '" (' + oldG + ') is used by ' + usedBy(oldG, oldName) + ' position(s), so it cannot move to ' + g + '. Add it to ' + g + ' as a new designation instead.');
        const patch = { Designation: name, Grade: g, Active: active, Note: note };
        const changed = Object.keys(patch).filter(function (k) { return String(r[k] == null ? '' : r[k]) !== String(patch[k]); });
        if (!changed.length) return;
        changed.forEach(function (k) { log(T.DESIG.name, r.Designation_ID, 'Update', k, String(r[k] == null ? '' : r[k]), patch[k]); });
        if (g === oldG && oldName !== name) renames.push({ g: g, from: oldName, to: name });
        Object.assign(r, patch, { Updated_By: u.email, Updated_At: now, _dirty: true });
      } else {
        const rec = { Designation_ID: nextId_(T.DESIG, rows), Designation: name, Grade: g, Active: active, Note: note, Created_By: u.email, Created_At: now, Updated_By: u.email, Updated_At: now, _new: true };
        rows.push(rec);
        log(T.DESIG.name, rec.Designation_ID, 'Create', '', '', g + ' · ' + name);
      }
    });
    const seen = {};
    rows.forEach(function (r) {
      const k = gradeKey_(r.Grade) + '|' + desigKey_(r.Designation);
      if (seen[k]) throw new Error('"' + r.Designation + '" is listed twice in grade ' + gradeKey_(r.Grade) + '.');
      seen[k] = true;
    });
    writes.forEach(function (w) { w(); });
    audits.forEach(function (a) { audit_.apply(null, [u].concat(a)); });
    rows.forEach(function (r) {
      if (!r._dirty && !r._new) return;
      const row = dh.map(function (h) { return jdmSafeText_(r[h] === undefined ? '' : r[h]); });
      const at = r._new ? dt.sheet.getLastRow() + 1 : r._row;
      dt.sheet.getRange(at, 1, 1, row.length).setValues([row]);
    });
    if (renames.length) {
      const c = mrf.headers.indexOf('Designation') + 1;
      mrf.rows.forEach(function (l) {
        const rn = renames.filter(function (x) { return x.g === gradeKey_(l.Grade) && desigKey_(x.from) === desigKey_(l.Designation); })[0];
        if (!rn || !c) return;
        mrf.sheet.getRange(l._row, c).setValue(rn.to);
        audit_(u, T.MRF.name, l.Line_ID, 'Update', 'Designation', String(l.Designation), rn.to);
      });
      dropStale_(T.MRF.name); markDashDirty_(T.MRF.name);
    }
    dropStale_(T.DESIG.name);
    gradeSummarySync_();
  });
  return apiGradeSetup();
}

/** Rewrites M_Grades.Designations as the joined list of each grade's active designations (read-only summary). */
function gradeSummarySync_() {
  const t = readTable_('M_Grades', true), c = t.headers.indexOf('Designations') + 1;
  if (!c) return;
  const by = designationsByGrade_(false);
  t.rows.forEach(function (r) {
    const v = (by[gradeKey_(r.Grade)] || []).join(', ');
    if (v !== String(r.Designations || '')) t.sheet.getRange(r._row, c).setValue(jdmSafeText_(v));
  });
  dropStale_('M_Grades');
}

/* ---------------- Schema ---------------- */

/** Schema 25: M6 also covers Officer / Sr Officer (Recruitment Policy Appendix F). Only an unedited value is changed. */
function gradeDesigMigrate_() {
  const t = readTable_('M_Grades', true), di = t.headers.indexOf('Designations') + 1;
  if (!di) return;
  t.rows.forEach(function (r) {
    if (String(r.Grade).trim().toUpperCase() === 'M6' && String(r.Designations || '').trim() === 'Engr/SE') t.sheet.getRange(r._row, di).setValue('Engr/SE, Officer/Sr Officer');
  });
  dropStale_('M_Grades');
}

/**
 * Schema 27: grades and designations separated. Seeds M_Designations by splitting each grade's old label on commas and
 * slashes (short forms expanded: "Engr/SE" -> Engineer, Senior Engineer), adds MRF.Designation and M_Grades.Active, and
 * fills a position's designation only when its title clearly names one designation of its grade (the longest match wins;
 * a tie or no match is left blank for the recruiter to pick).
 */
function gradeDesigSchema_() {
  addColumns_('M_Grades', ['Active']);
  addColumns_(T.MRF.name, ['Designation']);
  const fresh = !ss_().getSheetByName(T.DESIG.name);
  addSheet_(T.DESIG.name, DESIG_COLS_);
  if (fresh || readTable_(T.DESIG.name, true).rows.length === 0) {
    const gt = readTable_('M_Grades', true), now = new Date(), out = [], seen = {};
    let n = 0;
    gt.rows.forEach(function (r) {
      const g = gradeKey_(r.Grade);
      String(r.Designations || '').split(/[,\/;]+/).forEach(function (part) {
        const name = desigExpand_(part.replace(/[()]/g, ' '));
        const k = g + '|' + desigKey_(name);
        if (!name || seen[k]) return; seen[k] = true;
        n++;
        out.push(['DSG-' + String(n).padStart(4, '0'), name, g, 'Yes', 'From the grade label "' + String(r.Designations) + '"', 'system', now, 'system', now]);
      });
    });
    if (out.length) sheet_(T.DESIG.name).getRange(2, 1, out.length, DESIG_COLS_.length).setValues(out.map(function (row) { return row.map(jdmSafeText_); }));
    PropertiesService.getScriptProperties().setProperty('IDMAX_' + T.DESIG.name, String(n));
    dropStale_(T.DESIG.name);
  }
  const by = designationsByGrade_(false), mrf = readTable_(T.MRF.name, true), c = mrf.headers.indexOf('Designation') + 1;
  if (c && mrf.rows.length) {
    const last = mrf.rows[mrf.rows.length - 1]._row, col = [];
    for (let i = 2; i <= last; i++) col.push(['']);
    let n = 0;
    mrf.rows.forEach(function (l) {
      const cur = String(l.Designation || '').trim(), pick = cur ? '' : desigGuess_(l.Position, by[gradeKey_(l.Grade)] || []);
      if (pick) n++;
      col[l._row - 2][0] = cur || pick;
    });
    if (n) mrf.sheet.getRange(2, c, col.length, 1).setValues(col);
  }
  dropStale_(T.MRF.name);
  gradeSummarySync_();
}

/** The one designation of the grade whose words all appear in the position title; the longest wins; ties return ''. */
function desigGuess_(position, list) {
  const words = desigWords_(position);
  let best = [], size = 0;
  list.forEach(function (d) {
    const dw = desigWords_(d);
    if (!dw.length || !dw.every(function (w) { return words.indexOf(w) >= 0; })) return;
    if (dw.length > size) { best = [d]; size = dw.length; } else if (dw.length === size) best.push(d);
  });
  return best.length === 1 ? best[0] : '';
}
