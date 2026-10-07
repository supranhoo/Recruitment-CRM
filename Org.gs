/**
 * Organogram (schema 36). Approved vs existing manpower per division, department and grade (M, W, T), with the division
 * head and HOD of each, joined to the open positions the CRM is already tracking.
 * - Org_Divisions / Org_Departments: the new structure (16 divisions, 59 departments) with heads and HODs.
 * - Org_Dept_Map: each existing CRM department (M_Departments / MRF.Dept) mapped to one new department, so MRF lines and
 *   candidates keep their old names and nothing existing changes.
 * - Org_Manpower: the approved and existing headcount snapshot (one row per department and grade), replaced whole by
 *   each import of the manpower report. Org_Import_Log keeps one row per import.
 * Everyone signed in can view; org_manage (Head of HR, Admin) imports and edits.
 * The roll-up functions (orgKey_, orgCategory_, orgRollup_, orgReadReport_) use no sheet access so they can be tested alone.
 */
const ORG_DIV_ = 'Org_Divisions', ORG_DEPT_ = 'Org_Departments', ORG_MAP_ = 'Org_Dept_Map', ORG_MP_ = 'Org_Manpower', ORG_LOG_ = 'Org_Import_Log';
const ORG_DIV_COLS_ = ['Division', 'Division_Group', 'Division_Head', 'Active', 'Sort', 'Updated_By', 'Updated_At'];
const ORG_DEPT_COLS_ = ['Org_Dept', 'Division', 'HOD_Name', 'HOD_Email', 'Active', 'Sort', 'Updated_By', 'Updated_At'];
const ORG_MAP_COLS_ = ['CRM_Dept', 'Org_Dept', 'Mapped_By', 'Note'];
const ORG_MP_COLS_ = ['Org_Dept', 'Grade', 'Approved_HC', 'Existing_HC', 'As_On', 'Batch_ID'];
const ORG_NOTE_ = 'Org_Grade_Notes';
const ORG_NOTE_COLS_ = ['Note_ID', 'Org_Dept', 'From_Grade', 'To_Grade', 'Seats', 'Reason', 'Approved_By', 'Review_On', 'Status', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
T.ONT = { name: ORG_NOTE_, id: 'Note_ID', prefix: 'ONT-', width: 4, dates: ['Review_On'], editable: ['Org_Dept', 'From_Grade', 'To_Grade', 'Seats', 'Reason', 'Approved_By', 'Review_On', 'Status'] };
const ORG_PREV_ = 'Org_Plan_Revisions', ORG_PLAN_ = 'Org_Plan';
const ORG_PREV_COLS_ = ['Rev_ID', 'Rev_No', 'Status', 'Reason', 'Approved_By', 'Effective_On', 'Source', 'Base_Rev', 'Total_Approved', 'Seats_Changed', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At', 'Activated_By', 'Activated_At'];
const ORG_PLAN_COLS_ = ['Row_ID', 'Rev_ID', 'Org_Dept', 'Grade', 'Approved_HC'];
T.OPR = { name: ORG_PREV_, id: 'Rev_ID', prefix: 'ORV-', width: 4, dates: ['Effective_On'], editable: ['Rev_No', 'Status', 'Reason', 'Approved_By', 'Effective_On', 'Source', 'Base_Rev', 'Total_Approved', 'Seats_Changed'] };
const ORG_LOG_COLS_ = ['Batch_ID', 'As_On', 'File', 'Rows', 'Approved', 'Existing', 'Imported_By', 'Imported_At', 'Note'];
const ORG_GRADES_ = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'T', 'W1', 'W2', 'W3', 'W4', 'W5'];
const ORG_OPEN_ = ['Open', 'Offered', 'On Hold'];
const ORG_MAX_ROWS_ = 2000, ORG_MAX_LINES_ = 40;

const ORG_SEED_DIVS_ = [
  ["1000 TPD", "DRI", "Sajid Raza"],
  ["3X100 TPD", "DRI", "Sajid Raza"],
  ["CPP", "CPP", "Jitendra Dwivedi"],
  ["ADMIN", "Support Function", "Deepak Kumar Sharma"],
  ["EHS", "Support Function", "Gaurav Budhia"],
  ["CLU", "Ferro", "Anil Kumar Pathak"],
  ["COMMERCIAL-HO", "Support Function", "Gaurav Budhia"],
  ["COMMERCIAL-PLANT", "Support Function", "Abhas Luharuwalla"],
  ["EXCELLENCE", "Support Function", "Gaurav Budhia"],
  ["CORPORATE AFFAIRS", "Support Function", "Rajeev Kumar"],
  ["FACILITY MGMT", "Support Function", ""],
  ["FAD & FERRO", "Ferro", "U.A.V.S.S. Ganapathi Varma"],
  ["HR", "Support Function", "Jaspal"],
  ["INFRA AND PROJECTS", "Support Function", "Anil Kumar Pathak"],
  ["LOGISTICS", "Support Function", "Gaurav Budhia"],
  ["SALES AND MARKETING", "Support Function", "Gaurav Budhia"]];
const ORG_SEED_DEPTS_ = [
  ["1000 TPD-E AND I", "1000 TPD", "Subhransu Sekhar Nayak"],
  ["1000 TPD-MECH", "1000 TPD", "Vacant"],
  ["1000 TPD-PROCESS", "1000 TPD", "Jyoti Prakash Dwivedi"],
  ["1000 TPD-QC", "1000 TPD", "Shil Kumar Tiwari"],
  ["1000 TPD-RMH", "1000 TPD", "Awadhesh Kumar Singh"],
  ["3X100 TPD-E AND I", "3X100 TPD", "Ramchandra Reddy Gannu"],
  ["3X100 TPD-MECH", "3X100 TPD", "Sanjay Kumar Dubey"],
  ["3X100 TPD-PROCESS", "3X100 TPD", "Vacant"],
  ["3X100 TPD-RMH", "3X100 TPD", "Awadhesh Kumar Singh"],
  ["CPP-E&I", "CPP", "Umesh Kumar Mehta"],
  ["CPP-MECH", "CPP", "Mayank Mouli Shukla"],
  ["CPP-OPERATION WHRB", "CPP", "Satyendra Kumar Singh"],
  ["CPP-OPERATION AFBC", "CPP", "Bhoopendra Kumar Sinha"],
  ["ADMIN-ADMIN", "ADMIN", "Rupesh Vithal Dalvi"],
  ["ADMIN-HK", "ADMIN", "Abhishek Prasad / Rupesh Vithal Dalvi"],
  ["ADMIN-SECURITY", "ADMIN", "Rama Prasad Yadav"],
  ["ADMIN-WB & TIME OFFICE", "ADMIN", "Saibal Kunar"],
  ["EHS-ENVIRONMENT", "EHS", "Sandeep Kumar Tiwari"],
  ["EHS-CSR", "EHS", "Rakesh Gupta"],
  ["EHS-SAFETY & HEALTH", "EHS", "Firoz Ahmad"],
  ["CLU-ELECT", "CLU", "Umesh Kumar Mehta"],
  ["CLU-INST", "CLU", "Umesh Kumar Mehta"],
  ["CLU-MECH", "CLU", "Shrikant Ganguly"],
  ["CLU-OPERATION", "CLU", "Sudhir Kumar Dewangan"],
  ["CLU-REFRACTORY", "CLU", "Vidhan Chandra Rai"],
  ["CLU-RMH", "CLU", "Sudhir Kumar Dewangan"],
  ["COMMERCIAL-BANKING FINANCE", "COMMERCIAL-HO", "Yogesh Trikha"],
  ["COMMERCIAL-HO", "COMMERCIAL-HO", "Nitesh Kumar Baldwa"],
  ["COMMERCIAL-HO ACCOUNTS & TAXATION", "COMMERCIAL-HO", "Piyush Bansal"],
  ["COMMERCIAL-RM PROCUREMENT", "COMMERCIAL-HO", "Binay Kumar Singh"],
  ["COMMERCIAL-IMPORT OPERATIONS", "COMMERCIAL-HO", "Nitesh Kumar Baldwa"],
  ["COMMERCIAL-COSTING & BUSINESS ANALYTICS", "COMMERCIAL-PLANT", "TBD"],
  ["COMMERCIAL-PLANT ACCOUNTS", "COMMERCIAL-PLANT", "Atul Kumar Khaitan"],
  ["COMMERCIAL-PURCHASE", "COMMERCIAL-PLANT", "Ashish Kataria"],
  ["COMMERCIAL-STORES", "COMMERCIAL-PLANT", "Ashish Kataria"],
  ["EXCELLENCE - IT", "EXCELLENCE", "Bhaskar Jyoti Sharma"],
  ["EXCELLENCE - BUSINESS EXCELLENCE", "EXCELLENCE", "Jitendra Dwivedi"],
  ["CORPORATE AFFAIRS-CORPORATE AFFAIRS & COMMUNICATION", "CORPORATE AFFAIRS", "Amit Kumar Sharma"],
  ["CORPORATE AFFAIRS-LAND & LEGAL", "CORPORATE AFFAIRS", "Mihir Ranjan Pattanayak"],
  ["FACILITY MGMT-CULTURAL AND SPORTS", "FACILITY MGMT", ""],
  ["FACILITY MGMT-SERVICES", "FACILITY MGMT", ""],
  ["FAD-E AND I", "FAD & FERRO", "Siravuri Lingamurthy Raju"],
  ["FAD-MECH", "FAD & FERRO", "Yellapu Ramachandra Venkata Satyanarayana Murthy"],
  ["FERRO-QC & DISPATCH", "FAD & FERRO", "Niraj Kumar Mishra"],
  ["FAD-OPERATIONS", "FAD & FERRO", "Mrutyunjaya Mohanty"],
  ["FAD-RMH", "FAD & FERRO", "Vacant"],
  ["HR-OPERATIONS", "HR", "Samir Dey"],
  ["HR-L&D", "HR", "Ankan Kumar Chakraborty"],
  ["HR-COMPENSATION & BENEFITS", "HR", "Jitendra Bharti"],
  ["HR-PMS", "HR", "Ankit Choudhary"],
  ["HR-TALENT ACQUISITION", "HR", "Ankit Choudhary"],
  ["INFRA AND PROJECTS - CIVIL", "INFRA AND PROJECTS", "Shyam Sundar Hati"],
  ["INFRA AND PROJECTS - INFRA", "INFRA AND PROJECTS", "Ritesh Kumar Singh"],
  ["LOGISTICS-CENTRAL AUTOMOBILE", "LOGISTICS", "Vacant"],
  ["LOGISTICS-RAKE", "LOGISTICS", "Rakesh Kumar"],
  ["LOGISTICS-TRAILER", "LOGISTICS", "Dheeraj Chaturvedi"],
  ["SALES AND MARKETING-OPERATIONS", "SALES AND MARKETING", "Dippendu Das"],
  ["SALES AND MARKETING-SALES FERRO ALLOYS", "SALES AND MARKETING", "Rishi Juneja"],
  ["SALES AND MARKETING-SALES DRI", "SALES AND MARKETING", "?"]];
const ORG_SEED_MAP_ = [
  ["1050 TPD-E And I", "1000 TPD-E AND I"],
  ["1050 TPD-Mech", "1000 TPD-MECH"],
  ["1050 TPD-Process", "1000 TPD-PROCESS"],
  ["1050 TPD-QC", "1000 TPD-QC"],
  ["1050 TPD-RMH", "1000 TPD-RMH"],
  ["3X100 TPD-E And I", "3X100 TPD-E AND I"],
  ["3X100 TPD-Mech", "3X100 TPD-MECH"],
  ["3X100 TPD-Process", "3X100 TPD-PROCESS"],
  ["3X100 TPD-RMH", "3X100 TPD-RMH"],
  ["45 MW-Elect", "CPP-E&I"],
  ["45 MW-Inst", "CPP-E&I"],
  ["45 MW-Mech", "CPP-MECH"],
  ["45 MW-Operation", "CPP-OPERATION WHRB"],
  ["45 MW-QC DMP", "CPP-OPERATION WHRB"],
  ["45 MW-Sub Station", "CPP-E&I"],
  ["8 MW-Elect", "CPP-E&I"],
  ["8 MW-Inst", "CPP-E&I"],
  ["8 MW-Operation", "CPP-OPERATION AFBC"],
  ["Admin-Admin", "ADMIN-ADMIN"],
  ["Admin-Dust Management", "ADMIN-HK"],
  ["Admin-HK", "ADMIN-HK"],
  ["Admin-Horti", "EHS-ENVIRONMENT"],
  ["Admin-Pollution", "1000 TPD-MECH"],
  ["Admin-Security", "ADMIN-SECURITY"],
  ["Admin-Temple", "ADMIN-ADMIN"],
  ["Admin-Time Office", "ADMIN-WB & TIME OFFICE"],
  ["Admin-Travel", "ADMIN-ADMIN"],
  ["Admin-Weigh Bridge", "ADMIN-WB & TIME OFFICE"],
  ["CLU-Elect", "CLU-ELECT"],
  ["CLU-Inst", "CLU-INST"],
  ["CLU-MECH", "CLU-MECH"],
  ["CLU-Operation", "CLU-OPERATION"],
  ["CLU-Refractory", "CLU-REFRACTORY"],
  ["CLU-RMH", "CLU-RMH"],
  ["Commercial-Banking Finance", "COMMERCIAL-BANKING FINANCE"],
  ["Commercial-Costing & Business Analytics", "COMMERCIAL-COSTING & BUSINESS ANALYTICS"],
  ["Commercial-HO", "COMMERCIAL-HO"],
  ["Commercial-HO Accounts", "COMMERCIAL-HO ACCOUNTS & TAXATION"],
  ["Commercial-IT", "EXCELLENCE - IT"],
  ["Commercial-Plant Accounts", "COMMERCIAL-PLANT ACCOUNTS"],
  ["Commercial-Purchase", "COMMERCIAL-PURCHASE"],
  ["Commercial-RM Procurement", "COMMERCIAL-RM PROCUREMENT"],
  ["Commercial-Stores", "COMMERCIAL-STORES"],
  ["Corporate Affairs-Corporate Affairs", "CORPORATE AFFAIRS-CORPORATE AFFAIRS & COMMUNICATION"],
  ["Corporate Affairs-Corporate Communication", "CORPORATE AFFAIRS-CORPORATE AFFAIRS & COMMUNICATION"],
  ["Corporate Affairs - Land", "CORPORATE AFFAIRS-LAND & LEGAL"],
  ["Corporate Affairs-Legal", "CORPORATE AFFAIRS-LAND & LEGAL"],
  ["EHS-CSR", "EHS-CSR"],
  ["EHS-Environment", "EHS-ENVIRONMENT"],
  ["EHS-Health", "EHS-SAFETY & HEALTH"],
  ["EHS-Safety", "EHS-SAFETY & HEALTH"],
  ["Facility Mgmt-Cultural And Sports", "FACILITY MGMT-CULTURAL AND SPORTS"],
  ["Facility Mgmt-Services", "FACILITY MGMT-SERVICES"],
  ["FAD-E And I", "FAD-E AND I"],
  ["FAD-Mech", "FAD-MECH"],
  ["FAD-Metal Handling", "FERRO-QC & DISPATCH"],
  ["FAD-Pollution", "FAD-MECH"],
  ["FAD-Production", "FAD-OPERATIONS"],
  ["FAD-RMH", "FAD-RMH"],
  ["Ferro-QC", "FERRO-QC & DISPATCH"],
  ["HR-Human Resources", "HR-OPERATIONS"],
  ["Infra and Projects - Business Excellence", "EXCELLENCE - BUSINESS EXCELLENCE"],
  ["Infra and Projects - Civil", "INFRA AND PROJECTS - CIVIL"],
  ["Infra and Projects - Infra", "INFRA AND PROJECTS - INFRA"],
  ["Logistics-Central Automobile", "LOGISTICS-CENTRAL AUTOMOBILE"],
  ["Logistics-Port", "COMMERCIAL-IMPORT OPERATIONS"],
  ["Logistics-Rake", "LOGISTICS-RAKE"],
  ["Logistics-Trailer", "LOGISTICS-TRAILER"],
  ["Sales And Marketing-Export Operations", "SALES AND MARKETING-OPERATIONS"],
  ["Sales And Marketing-Sales Ferro Alloys", "SALES AND MARKETING-SALES FERRO ALLOYS"],
  ["Sales And Marketing-Sales Steel", "SALES AND MARKETING-SALES DRI"]];

/* ---------------- Pure helpers (no sheet access) ---------------- */

/** Comparison key for department names: case, spacing and stray spaces do not matter. */
function orgKey_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toUpperCase(); }
function orgGrade_(g) { return String(g == null ? '' : g).replace(/\s+/g, '').toUpperCase(); }
/** M (management), W (workmen and supervisory) or T (trainee); empty when the grade is not one of the mapped list. */
function orgCategory_(g) {
  g = orgGrade_(g);
  if (/^M[1-9]$/.test(g)) return 'M';
  if (/^W[1-9]$/.test(g)) return 'W';
  if (g === 'T') return 'T';
  return '';
}
function orgGradeRank_(g) { const i = ORG_GRADES_.indexOf(orgGrade_(g)); return i < 0 ? 99 : i; }
function orgNum_(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  const n = Number(String(v).replace(/,/g, '').trim());
  return isFinite(n) ? n : NaN;
}
function orgGap_(approved, existing, open) {
  const vacancy = Math.max(0, approved - existing);
  return { vacancy: vacancy, excess: Math.max(0, existing - approved), gap: Math.max(0, vacancy - open) };
}
/**
 * Status of a figure set { approved, existing, vacancy, excess, covered } where vacancy and excess are the residuals left
 * after grades have covered for each other. Grade mix alone (covered seats) is never a warning: it reads 'mix'.
 */
function orgStatus_(m) {
  if (m.approved === 0 && m.existing > 0 && m.excess > 0) return 'unapproved';
  if (m.vacancy > 0) return 'vacant';
  if (m.excess > 0) return 'over';
  if (m.covered > 0 || m.covers > 0) return 'mix';
  return 'full';
}

/** Pay bands: a vacancy in one grade can be covered by a hire in another grade of the same band, in the same department. */
const ORG_BANDS_ = { M1: 'Senior management', M2: 'Senior management', M3: 'Senior management', M4: 'Middle management', M5: 'Middle management',
  M6: 'Officers and engineers', M7: 'Officers and engineers', T: 'Trainee', W1: 'Supervisory', W2: 'Supervisory', W3: 'Workmen', W4: 'Workmen', W5: 'Workmen' };
function orgBand_(g) { return ORG_BANDS_[orgGrade_(g)] || ''; }

/**
 * Grade cover for one department. rows: [{ grade, approved, existing }].
 * Within each band, seats filled above approved (excess) are matched to vacant seats, nearest grade first.
 * Returns { by: { grade: { vac, exc, covered, covers } }, subs: [{ band, from, to, seats, dir, steps }] } where
 * from = the grade the seat was approved at and to = the grade it is filled at. Upgrade = filled at a higher grade
 * (a lower position in the grade list). Residual vacancy = vac - covered; residual excess = exc - covers, and
 * (residual vacancy) - (residual excess) always equals approved - existing.
 */
function orgNetting_(rows) {
  const by = {}, subs = {};
  rows.forEach(function (r) {
    const a = Number(r.approved) || 0, e = Number(r.existing) || 0;
    by[r.grade] = { vac: Math.max(0, a - e), exc: Math.max(0, e - a), covered: 0, covers: 0 };
  });
  const bands = {};
  Object.keys(by).forEach(function (g) { const b = orgBand_(g); if (b) (bands[b] = bands[b] || []).push(g); });
  Object.keys(bands).forEach(function (band) {
    const gs = bands[band], pairs = [];
    gs.forEach(function (ex) {
      gs.forEach(function (va) {
        if (ex === va || !by[ex].exc || !by[va].vac) return;
        pairs.push({ ex: ex, va: va, d: Math.abs(orgGradeRank_(ex) - orgGradeRank_(va)) });
      });
    });
    pairs.sort(function (x, y) { return x.d - y.d || orgGradeRank_(x.va) - orgGradeRank_(y.va) || orgGradeRank_(x.ex) - orgGradeRank_(y.ex); });
    pairs.forEach(function (p) {
      const m = Math.min(by[p.ex].exc - by[p.ex].covers, by[p.va].vac - by[p.va].covered);
      if (m <= 0) return;
      by[p.ex].covers += m; by[p.va].covered += m;
      const k = p.va + '>' + p.ex;
      const up = orgGradeRank_(p.ex) < orgGradeRank_(p.va);
      subs[k] = subs[k] || { band: band, from: p.va, to: p.ex, seats: 0, dir: up ? 'Upgrade' : 'Downgrade', steps: p.d };
      subs[k].seats += m;
    });
  });
  return { by: by, subs: Object.keys(subs).map(function (k) { return subs[k]; }).sort(function (x, y) { return orgGradeRank_(x.from) - orgGradeRank_(y.from) || orgGradeRank_(x.to) - orgGradeRank_(y.to); }) };
}

/** State of a substitution against the notes: 'noted', 'review' (note past its review date), 'needs' (upgrade without a note) or 'none' (a downgrade needs none). */
function orgSubState_(sub, note, today) {
  if (note) return note.reviewOn && String(note.reviewOn) <= today ? 'review' : 'noted';
  return sub.dir === 'Upgrade' ? 'needs' : 'none';
}

/**
 * Builds the organogram from plain data.
 * in: { divs:[{division,group,head,active}], depts:[{dept,division,hod,email,active}], manpower:[{dept,grade,approved,existing}],
 *       map:{ orgKey(CRM dept): Org dept }, openLines:[{dept (CRM name), grade, ...}], notes:[{id,dept,from,to,seats,reason,by,reviewOn}], today:'yyyy-mm-dd' }
 * out: { divisions:[{ ..., depts:[{ ..., grades:[...], subs:[...] }] }], totals, cats, mix:[...], unmapped, orphans, staleNotes }
 */
function orgRollup_(inp) {
  const byDept = {}, divs = [], divByName = {};
  (inp.divs || []).forEach(function (d) {
    if (String(d.active) === 'No') return;
    const o = { division: d.division, group: d.group || '', head: d.head || '', depts: [] };
    divByName[orgKey_(d.division)] = o; divs.push(o);
  });
  (inp.depts || []).forEach(function (d) {
    if (String(d.active) === 'No') return;
    const dv = divByName[orgKey_(d.division)]; if (!dv) return;
    const o = { dept: d.dept, division: dv.division, hod: d.hod || '', email: d.email || '', gradeMap: {}, lines: [], crm: [] };
    byDept[orgKey_(d.dept)] = o; dv.depts.push(o);
  });
  const gradeRow = function (dept, g) {
    return dept.gradeMap[g] || (dept.gradeMap[g] = { grade: g, cat: orgCategory_(g), band: orgBand_(g), approved: 0, existing: 0, open: 0 });
  };
  let orphans = 0;
  (inp.manpower || []).forEach(function (m) {
    const d = byDept[orgKey_(m.dept)]; if (!d) { orphans++; return; }
    const r = gradeRow(d, orgGrade_(m.grade));
    r.approved += Number(m.approved) || 0; r.existing += Number(m.existing) || 0;
  });
  (inp.crmNames || []).forEach(function (m) { const d = byDept[orgKey_(m.org)]; if (d && d.crm.indexOf(m.crm) < 0) d.crm.push(m.crm); });
  const unmapped = {};
  (inp.openLines || []).forEach(function (l) {
    const target = (inp.map || {})[orgKey_(l.dept)], d = target ? byDept[orgKey_(target)] : null;
    if (!d) { const k = String(l.dept || '(no department)').trim() || '(no department)'; unmapped[k] = (unmapped[k] || 0) + 1; return; }
    gradeRow(d, orgGrade_(l.grade) || '?').open++;
    if (d.lines.length < ORG_MAX_LINES_) d.lines.push({ id: l.id || '', position: l.position || '', grade: orgGrade_(l.grade), status: l.status || '', recruiter: l.recruiter || '', mrf: l.mrf || '' });
  });
  const today = inp.today || '';
  const notes = {}; (inp.notes || []).forEach(function (n) { notes[orgKey_(n.dept) + '|' + n.from + '|' + n.to] = n; });
  const usedNotes = {};
  const F = ['approved', 'existing', 'vacancy', 'excess', 'open', 'gap', 'covered', 'grossVacancy', 'grossExcess', 'upSeats', 'downSeats', 'upSteps', 'recheck'];
  const blank = function () { const o = {}; F.forEach(function (k) { o[k] = 0; }); return o; };
  const add = function (a, b) { F.forEach(function (k) { a[k] += b[k] || 0; }); };
  const totals = blank(), cats = { M: blank(), W: blank(), T: blank() }, mix = [];
  divs.forEach(function (dv) {
    const dt = blank();
    dv.depts.forEach(function (d) {
      d.grades = Object.keys(d.gradeMap).map(function (g) { return d.gradeMap[g]; }).sort(function (a, b) { return orgGradeRank_(a.grade) - orgGradeRank_(b.grade); });
      delete d.gradeMap;
      const net = orgNetting_(d.grades);
      const t = blank();
      d.grades.forEach(function (r) {
        const n = net.by[r.grade] || { vac: 0, exc: 0, covered: 0, covers: 0 };
        r.grossVacancy = n.vac; r.grossExcess = n.exc; r.covered = n.covered; r.covers = n.covers;
        r.vacancy = n.vac - n.covered; r.excess = n.exc - n.covers;
        r.gap = Math.max(0, r.vacancy - r.open);
        r.recheck = n.covered > 0 ? Math.max(0, r.open - r.vacancy) : 0;
        r.status = orgStatus_(r);
        add(t, r); if (cats[r.cat]) add(cats[r.cat], r);
      });
      d.subs = net.subs.map(function (sb) {
        const key = orgKey_(d.dept) + '|' + sb.from + '|' + sb.to, note = notes[key] || null;
        if (note) usedNotes[key] = true;
        const o = { dept: d.dept, division: dv.division, band: sb.band, from: sb.from, to: sb.to, seats: sb.seats, dir: sb.dir, steps: sb.steps, state: orgSubState_(sb, note, today), note: note };
        mix.push(o);
        if (sb.dir === 'Upgrade') { t.upSeats += sb.seats; t.upSteps += sb.seats * sb.steps; } else t.downSeats += sb.seats;
        return o;
      });
      Object.keys(t).forEach(function (k) { d[k] = t[k]; });
      d.status = orgStatus_(d);
      add(dt, t);
    });
    dv.depts.sort(function (a, b) { return b.approved - a.approved || (a.dept < b.dept ? -1 : 1); });
    Object.keys(dt).forEach(function (k) { dv[k] = dt[k]; });
    dv.status = orgStatus_(dv);
    add(totals, dt);
  });
  divs.sort(function (a, b) { return b.approved - a.approved || (a.division < b.division ? -1 : 1); });
  totals.net = totals.approved - totals.existing;
  Object.keys(cats).forEach(function (k) { cats[k].net = cats[k].approved - cats[k].existing; });
  const stale = (inp.notes || []).filter(function (n) { return !usedNotes[orgKey_(n.dept) + '|' + n.from + '|' + n.to]; });
  mix.sort(function (a, b) { return (b.state === 'needs') - (a.state === 'needs') || b.seats - a.seats || (a.dept < b.dept ? -1 : 1); });
  return { divisions: divs, totals: totals, cats: cats, mix: mix, staleNotes: stale, unmapped: Object.keys(unmapped).sort().map(function (k) { return { dept: k, open: unmapped[k] }; }), orphans: orphans };
}

/**
 * Reads the rows of the manpower report (the file's own column names) into { rows:[{dept, grade, approved, existing, line}], errors:[] }.
 * Columns found by name: Department Name, Level Name, ApprovedManPower, ExixtingManpower (the report's spelling) or ExistingManpower.
 */
function orgReadReport_(raw) {
  const out = { rows: [], errors: [], newDept: {} };
  if (!raw || !raw.length) { out.errors.push('The file has no rows.'); return out; }
  const nrm = function (k) { return String(k).toLowerCase().replace(/[^a-z]/g, ''); };
  const find = function (names) { const ks = Object.keys(raw[0] || {}); for (let i = 0; i < ks.length; i++) { if (names.indexOf(nrm(ks[i])) >= 0) return ks[i]; } return ''; };
  const cD = find(['departmentname', 'department', 'dept']), cL = find(['levelname', 'level', 'grade']), cA = find(['approvedmanpower', 'approved']),
    cE = find(['existingmanpower', 'exixtingmanpower', 'existing']), cN = find(['newdepartmentname']);
  const missing = [];
  if (!cD) missing.push('Department Name'); if (!cL) missing.push('Level Name'); if (!cA) missing.push('ApprovedManPower'); if (!cE) missing.push('ExistingManpower');
  if (missing.length) { out.errors.push('The file is missing these columns: ' + missing.join(', ') + '. Use the Approved vs Existing Manpower report as downloaded.'); return out; }
  raw.forEach(function (r, i) {
    const line = i + 1, dept = String(r[cD] == null ? '' : r[cD]).trim(), grade = orgGrade_(r[cL]);
    if (!dept && !grade && String(r[cA]) === '' && String(r[cE]) === '') return;
    const a = orgNum_(r[cA]), e = orgNum_(r[cE]);
    if (!dept) { out.errors.push('Row ' + line + ': department is blank.'); return; }
    if (!orgCategory_(grade)) { out.errors.push('Row ' + line + ' (' + dept + '): "' + String(r[cL]).trim() + '" is not a grade in the list (M1 to M7, T, W1 to W5).'); return; }
    if (isNaN(a) || a < 0 || Math.round(a) !== a) { out.errors.push('Row ' + line + ' (' + dept + ' ' + grade + '): approved manpower must be a whole number, 0 or more.'); return; }
    if (isNaN(e) || e < 0 || Math.round(e) !== e) { out.errors.push('Row ' + line + ' (' + dept + ' ' + grade + '): existing manpower must be a whole number, 0 or more.'); return; }
    out.rows.push({ dept: dept, grade: grade, approved: a, existing: e, line: line });
    if (cN) out.newDept[orgKey_(dept)] = String(r[cN] == null ? '' : r[cN]).trim();
  });
  return out;
}

/** Groups report rows by new department and grade using the old-to-new map. unmapped = old departments with no mapping. */
function orgAggregate_(rows, map, validDepts) {
  const agg = {}, unmapped = {}, bad = {};
  rows.forEach(function (r) {
    const target = map[orgKey_(r.dept)];
    if (!target) { unmapped[r.dept] = (unmapped[r.dept] || 0) + 1; return; }
    if (!validDepts[orgKey_(target)]) { bad[target] = true; return; }
    const key = validDepts[orgKey_(target)] + '|' + r.grade;
    const a = agg[key] || (agg[key] = { dept: validDepts[orgKey_(target)], grade: r.grade, approved: 0, existing: 0 });
    a.approved += r.approved; a.existing += r.existing;
  });
  return { groups: Object.keys(agg).map(function (k) { return agg[k]; }), unmapped: Object.keys(unmapped).sort(), bad: Object.keys(bad).sort() };
}

/* ---------------- Schema and seed ---------------- */

function orgSchema_() {
  const make = function (name, cols, seed) {
    const fresh = !ss_().getSheetByName(name);
    addSheet_(name, cols);
    if (fresh || readTable_(name, true).rows.length === 0) {
      const rows = seed.map(function (r) { return jdmRow_(name, r); });
      if (rows.length) sheet_(name).getRange(2, 1, rows.length, cols.length).setValues(rows);
    }
    dropStale_(name);
  };
  make(ORG_DIV_, ORG_DIV_COLS_, ORG_SEED_DIVS_.map(function (d, i) { return [d[0], d[1], d[2], 'Yes', i + 1, '', '']; }));
  make(ORG_DEPT_, ORG_DEPT_COLS_, ORG_SEED_DEPTS_.map(function (d, i) { return [d[0], d[1], d[2], '', 'Yes', i + 1, '', '']; }));
  make(ORG_MAP_, ORG_MAP_COLS_, ORG_SEED_MAP_.map(function (m) { return [m[0], m[1], 'Seed (HR report)', '']; }));
  make(ORG_MP_, ORG_MP_COLS_, []);
  make(ORG_LOG_, ORG_LOG_COLS_, []);
  make(ORG_NOTE_, ORG_NOTE_COLS_, []);
  make(ORG_PREV_, ORG_PREV_COLS_, []);
  make(ORG_PLAN_, ORG_PLAN_COLS_, []);
  orgPlanMigrate_();
}

/* ---------------- Reading ---------------- */

function orgContext_() {
  const divs = readTable_(ORG_DIV_).rows.map(function (r) { return { division: String(r.Division).trim(), group: String(r.Division_Group || ''), head: String(r.Division_Head || ''), active: String(r.Active || 'Yes'), sort: Number(r.Sort) || 0 }; });
  const depts = readTable_(ORG_DEPT_).rows.map(function (r) { return { dept: String(r.Org_Dept).trim(), division: String(r.Division).trim(), hod: String(r.HOD_Name || ''), email: String(r.HOD_Email || ''), active: String(r.Active || 'Yes'), sort: Number(r.Sort) || 0 }; });
  const map = {};
  readTable_(ORG_MAP_).rows.forEach(function (r) { if (String(r.Org_Dept || '').trim()) map[orgKey_(r.CRM_Dept)] = String(r.Org_Dept).trim(); });
  const mp = readTable_(ORG_MP_).rows;
  const snapshot = mp.map(function (r) { return { dept: String(r.Org_Dept), grade: String(r.Grade), existing: Number(r.Existing_HC) || 0, report: Number(r.Approved_HC) || 0 }; });
  const act = orgPlanActive_();
  const manpower = orgMergePlan_(act ? act.rows : null, snapshot);
  const asOn = mp.length ? ymd_(mp[0].As_On) : '', batch = mp.length ? String(mp[0].Batch_ID || '') : '';
  return { divs: divs, depts: depts, map: map, manpower: manpower, asOn: asOn, batch: batch, plan: act ? act.rev : null, snapshot: snapshot };
}

function orgNotes_() {
  if (!ss_().getSheetByName(ORG_NOTE_)) return [];
  return readTable_(ORG_NOTE_).rows.filter(function (r) { return String(r.Status || 'Active') !== 'Closed'; }).map(function (r) {
    return { id: String(r.Note_ID), dept: String(r.Org_Dept), from: orgGrade_(r.From_Grade), to: orgGrade_(r.To_Grade), seats: Number(r.Seats) || 0, reason: String(r.Reason || ''),
      by: String(r.Approved_By || ''), reviewOn: ymd_(r.Review_On), setBy: String(r.Updated_By || r.Created_By || ''), setOn: ymd_(r.Updated_At || r.Created_At) };
  });
}

function orgOpenLines_() {
  return readTable_(T.MRF.name).rows.filter(function (l) { return ORG_OPEN_.indexOf(positionStatus_(l)) >= 0; })
    .map(function (l) { return { id: String(l.Line_ID || ''), dept: String(l.Dept || ''), grade: String(l.Grade || ''), position: String(l.Position || ''), status: positionStatus_(l), recruiter: String(l.Recruiter || ''), mrf: String(l.MRF_No || '') }; });
}

/** The organogram for everyone signed in. */
function apiOrganogram() {
  const u = currentUser_(); ensureSchema_();
  const c = orgContext_();
  const crmNames = readTable_(ORG_MAP_).rows.filter(function (m) { return String(m.Org_Dept || '').trim(); }).map(function (m) { return { crm: String(m.CRM_Dept), org: String(m.Org_Dept).trim() }; });
  const r = orgRollup_({ divs: c.divs, depts: c.depts, manpower: c.manpower, map: c.map, openLines: orgOpenLines_(), crmNames: crmNames, notes: orgNotes_(), today: ymd_(new Date()) });
  const log = readTable_(ORG_LOG_).rows;
  const last = log.length ? log[log.length - 1] : null;
  r.asOn = c.asOn; r.batch = c.batch;
  r.imported = last ? { by: String(last.Imported_By || ''), at: ymd_(last.Imported_At), file: String(last.File || '') } : null;
  r.canManage = can_(u, 'org_manage');
  const revs = orgPlanRevs_();
  const draft = revs.filter(function (x) { return x.status === 'Draft'; })[0];
  r.plan = c.plan ? { rev: c.plan.no, effective: c.plan.effective, by: c.plan.by, reason: c.plan.reason, total: c.plan.total, hasDraft: r.canManage && !!draft } : null;
  return r;
}

/* ---------------- Import of the manpower report ---------------- */

/**
 * rows: the report rows as read from the file (objects keyed by the file's column names).
 * opts: { apply:true, asOn:'yyyy-mm-dd', file:'name.xlsx' }. Without apply nothing is written; the result shows what would be.
 */
function apiOrgImport(rows, opts) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can import the manpower report.');
  opts = opts || {};
  if (rows && rows.length > ORG_MAX_ROWS_) throw new Error('The file has more than ' + ORG_MAX_ROWS_ + ' rows. Check that it is the manpower report.');
  const rep = orgReadReport_(rows);
  const c = orgContext_();
  const valid = {}; c.depts.forEach(function (d) { if (d.active !== 'No') valid[orgKey_(d.dept)] = d.dept; });
  const errors = rep.errors.slice(), warnings = [];
  let agg = { groups: [], unmapped: [], bad: [] };
  if (!errors.length) {
    agg = orgAggregate_(rep.rows, c.map, valid);
    if (agg.unmapped.length) errors.push('Map these departments first (Admin → Org structure → Mapping): ' + agg.unmapped.join(', ') + '.');
    if (agg.bad.length) errors.push('These departments are mapped to a new department that is not active: ' + agg.bad.join(', ') + '.');
    let diff = 0;
    Object.keys(rep.newDept).forEach(function (k) {
      const t = rep.newDept[k], m = c.map[k];
      if (t && orgKey_(t) !== 'NO CHANGE' && m && orgKey_(t) !== orgKey_(m)) diff++;
    });
    if (diff) warnings.push(diff + ' department(s) have a different "New Department Name" in the file than in the mapping. The mapping is used.');
  }
  const approved = rep.rows.reduce(function (s, r) { return s + r.approved; }, 0), existing = rep.rows.reduce(function (s, r) { return s + r.existing; }, 0);
  const res = { ok: !errors.length, applied: false, errors: errors.slice(0, 40), moreErrors: Math.max(0, errors.length - 40), warnings: warnings,
    rows: rep.rows.length, groups: agg.groups.length, approved: approved, existing: existing, net: approved - existing };
  if (!res.ok) return res;
  const byDiv = {}, divOf = {}; c.depts.forEach(function (d) { divOf[orgKey_(d.dept)] = d.division; });
  agg.groups.forEach(function (g) { const dv = divOf[orgKey_(g.dept)] || '?'; const b = byDiv[dv] || (byDiv[dv] = { division: dv, approved: 0, existing: 0 }); b.approved += g.approved; b.existing += g.existing; });
  res.byDivision = Object.keys(byDiv).map(function (k) { return byDiv[k]; }).sort(function (a, b) { return b.approved - a.approved; });
  const act = orgPlanActive_();
  res.planKept = !!act;
  if (act) {
    const rep = agg.groups.map(function (g) { return { dept: g.dept, grade: g.grade, approved: g.approved }; });
    const df = orgPlanDiff_(act.rows, rep);
    res.plan = { rev: act.rev.no, total: df.totalFrom, reportTotal: df.totalTo, cells: df.changes.length, up: df.up, down: df.down, top: df.changes.slice(0, 8) };
  }
  if (opts.apply !== true) return res;
  const asOn = opts.asOn ? parseYmd_(opts.asOn) : parseYmd_(ymd_(new Date()));
  withLock_(function () {
    const batch = 'IMP-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
    const t = readTable_(ORG_MP_, true), sh = t.sheet, last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, ORG_MP_COLS_.length).clearContent();
    const out = agg.groups.sort(function (a, b) { return a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : orgGradeRank_(a.grade) - orgGradeRank_(b.grade); })
      .map(function (g) { return jdmRow_(ORG_MP_, [g.dept, g.grade, g.approved, g.existing, asOn, batch]); });
    sh.getRange(2, 1, out.length, ORG_MP_COLS_.length).setValues(out);
    const lg = sheet_(ORG_LOG_);
    lg.getRange(lg.getLastRow() + 1, 1, 1, ORG_LOG_COLS_.length).setValues([[batch, asOn, clean_(String(opts.file || '')), rep.rows.length, approved, existing, u.email, new Date(), (act ? 'Replaced the snapshot; plan kept' : 'Replaced the snapshot; opening plan created')]]);
    audit_(u, ORG_MP_, batch, 'Import', 'Approved / Existing', '', approved + ' / ' + existing + ' (' + out.length + ' rows, as on ' + ymd_(asOn) + ')');
    dropStale_(ORG_MP_); dropStale_(ORG_LOG_);
    if (!act) {
      const rowsP = agg.groups.map(function (g) { return { dept: g.dept, grade: g.grade, approved: g.approved }; });
      orgPlanCreate_({ status: 'Active', reason: 'Opening plan from the manpower report as on ' + ymd_(asOn), by: 'HR manpower report', effective: ymd_(asOn), source: 'Report import', base: '', user: u.email }, rowsP, null);
      res.planCreated = true;
    }
    res.batch = batch;
  });
  res.applied = true; res.asOn = ymd_(asOn);
  return res;
}

/* ---------------- Admin: structure and mapping ---------------- */

function apiOrgAdmin() {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can change the organisation structure.');
  const c = orgContext_();
  const names = {};
  readTable_('M_Departments').rows.forEach(function (d) { const n = String(d.Dept || '').trim(); if (n) names[n] = 0; });
  readTable_(T.MRF.name).rows.forEach(function (l) {
    const n = String(l.Dept || '').trim(); if (!n) return;
    if (!(n in names)) names[n] = 0;
    if (ORG_OPEN_.indexOf(positionStatus_(l)) >= 0) names[n]++;
  });
  const active = c.depts.filter(function (d) { return d.active !== 'No'; }).map(function (d) { return d.dept; });
  const mapRows = {}; readTable_(ORG_MAP_).rows.forEach(function (r) { mapRows[orgKey_(r.CRM_Dept)] = r; });
  const keys = {}; Object.keys(names).forEach(function (n) { keys[orgKey_(n)] = n; });
  Object.keys(mapRows).forEach(function (k) { if (!keys[k]) keys[k] = String(mapRows[k].CRM_Dept); });
  const map = Object.keys(keys).map(function (k) {
    const crm = keys[k], r = mapRows[k], org = r ? String(r.Org_Dept || '').trim() : '';
    const o = { crm: crm, org: org, open: names[crm] || 0, by: r ? String(r.Mapped_By || '') : '' };
    if (!org) { const s = jdmSuggestDept_(crm, active); o.suggest = s.dept || ''; o.options = s.options || []; }
    return o;
  }).sort(function (a, b) { return (a.org ? 1 : 0) - (b.org ? 1 : 0) || (a.crm < b.crm ? -1 : 1); });
  const log = readTable_(ORG_LOG_).rows.slice(-10).reverse().map(function (r) {
    return { batch: String(r.Batch_ID), asOn: ymd_(r.As_On), file: String(r.File || ''), rows: Number(r.Rows) || 0, approved: Number(r.Approved) || 0, existing: Number(r.Existing) || 0, by: String(r.Imported_By || ''), at: ymd_(r.Imported_At) };
  });
  const mp = {}; c.manpower.forEach(function (m) { mp[orgKey_(m.dept)] = (mp[orgKey_(m.dept)] || 0) + m.approved + m.existing; });
  return { divisions: c.divs, depts: c.depts.map(function (d) { d.hasHC = !!mp[orgKey_(d.dept)]; return d; }), map: map, log: log };
}

function orgEmailOk_(e) { return !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

/**
 * d: { divisions:[{division, head, active, group?, isNew?}], depts:[{dept, division, hod, email, active, isNew?}] }.
 * Heads, HODs, e-mails, the division of a department and active flags change. A department with headcount stays active;
 * names are not renamed here (headcount and the mapping are keyed by name), a new name is added instead.
 */
function apiOrgSaveStructure(d) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can change the organisation structure.');
  d = d || {};
  withLock_(function () {
    const now = new Date(), audits = [];
    const dt = readTable_(ORG_DIV_, true), pt = readTable_(ORG_DEPT_, true);
    const dCol = function (h) { return dt.headers.indexOf(h) + 1; }, pCol = function (h) { return pt.headers.indexOf(h) + 1; };
    const divByKey = {}; dt.rows.forEach(function (r) { divByKey[orgKey_(r.Division)] = r; });
    const depByKey = {}; pt.rows.forEach(function (r) { depByKey[orgKey_(r.Org_Dept)] = r; });
    const mp = {}; readTable_(ORG_MP_, true).rows.forEach(function (r) { mp[orgKey_(r.Org_Dept)] = true; });
    const pa = orgPlanActive_(); if (pa) pa.rows.forEach(function (r) { if (r.approved > 0) mp[orgKey_(r.dept)] = true; });
    const mapped = {}; readTable_(ORG_MAP_, true).rows.forEach(function (r) { const k = orgKey_(r.Org_Dept); if (k) mapped[k] = true; });
    const setCell = function (t, r, col, v) { t.sheet.getRange(r._row, col).setValue(jdmSafeText_(clean_(v))); };
    (d.divisions || []).forEach(function (x) {
      const name = String(x.division || '').trim(); if (!name) return;
      const head = clean_(String(x.head || '').trim()), act = x.active === false ? 'No' : 'Yes';
      if (head.length > 80) throw new Error('Keep the head name for ' + name + ' under 80 characters.');
      const r = divByKey[orgKey_(name)];
      if (!r) {
        if (!x.isNew) return;
        const row = jdmRow_(ORG_DIV_, dt.headers.map(function (h) { return h === 'Division' ? name : h === 'Division_Group' ? String(x.group || '') : h === 'Division_Head' ? head : h === 'Active' ? 'Yes' : h === 'Sort' ? dt.rows.length + 1 : h === 'Updated_By' ? u.email : h === 'Updated_At' ? now : ''; }));
        dt.sheet.getRange(dt.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        divByKey[orgKey_(name)] = { Division: name, Active: 'Yes' };
        audits.push([ORG_DIV_, name, 'Create', '', '', head]); return;
      }
      let changed = false;
      if (head !== String(r.Division_Head || '')) { setCell(dt, r, dCol('Division_Head'), head); audits.push([ORG_DIV_, name, 'Update', 'Division_Head', String(r.Division_Head || ''), head]); changed = true; }
      if (act !== (String(r.Active) === 'No' ? 'No' : 'Yes')) {
        if (act === 'No' && pt.rows.some(function (p) { return orgKey_(p.Division) === orgKey_(name) && String(p.Active) !== 'No'; }))
          throw new Error('Division ' + name + ' still has active departments. Deactivate or move them first.');
        setCell(dt, r, dCol('Active'), act); audits.push([ORG_DIV_, name, 'Update', 'Active', String(r.Active || 'Yes'), act]); changed = true;
      }
      if (changed && dCol('Updated_By')) { setCell(dt, r, dCol('Updated_By'), u.email); dt.sheet.getRange(r._row, dCol('Updated_At')).setValue(now); }
    });
    (d.depts || []).forEach(function (x) {
      const name = String(x.dept || '').trim(); if (!name) return;
      const hod = clean_(String(x.hod || '').trim()), email = String(x.email || '').trim().toLowerCase(), act = x.active === false ? 'No' : 'Yes', div = String(x.division || '').trim();
      if (hod.length > 80) throw new Error('Keep the HOD name for ' + name + ' under 80 characters.');
      if (!orgEmailOk_(email)) throw new Error('Check the email for ' + name + '.');
      const dv = divByKey[orgKey_(div)]; if (!dv) throw new Error('Pick a division for ' + name + '.');
      const r = depByKey[orgKey_(name)];
      if (!r) {
        if (!x.isNew) return;
        const row = jdmRow_(ORG_DEPT_, pt.headers.map(function (h) { return h === 'Org_Dept' ? name : h === 'Division' ? String(dv.Division) : h === 'HOD_Name' ? hod : h === 'HOD_Email' ? email : h === 'Active' ? 'Yes' : h === 'Sort' ? pt.rows.length + 1 : h === 'Updated_By' ? u.email : h === 'Updated_At' ? now : ''; }));
        pt.sheet.getRange(pt.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        depByKey[orgKey_(name)] = { Org_Dept: name };
        audits.push([ORG_DEPT_, name, 'Create', '', '', div + ' · ' + hod]); return;
      }
      let changed = false;
      if (hod !== String(r.HOD_Name || '')) { setCell(pt, r, pCol('HOD_Name'), hod); audits.push([ORG_DEPT_, name, 'Update', 'HOD_Name', String(r.HOD_Name || ''), hod]); changed = true; }
      if (email !== String(r.HOD_Email || '')) { setCell(pt, r, pCol('HOD_Email'), email); audits.push([ORG_DEPT_, name, 'Update', 'HOD_Email', String(r.HOD_Email || ''), email]); changed = true; }
      if (orgKey_(div) !== orgKey_(r.Division)) { setCell(pt, r, pCol('Division'), String(dv.Division)); audits.push([ORG_DEPT_, name, 'Update', 'Division', String(r.Division), String(dv.Division)]); changed = true; }
      if (act !== (String(r.Active) === 'No' ? 'No' : 'Yes')) {
        if (act === 'No' && (mp[orgKey_(name)] || mapped[orgKey_(name)])) throw new Error(name + ' has headcount or mapped departments. Map those to another department first, then import again.');
        setCell(pt, r, pCol('Active'), act); audits.push([ORG_DEPT_, name, 'Update', 'Active', String(r.Active || 'Yes'), act]); changed = true;
      }
      if (changed && pCol('Updated_By')) { setCell(pt, r, pCol('Updated_By'), u.email); pt.sheet.getRange(r._row, pCol('Updated_At')).setValue(now); }
    });
    audits.forEach(function (a) { audit_(u, a[0], a[1], a[2], a[3], a[4], a[5]); });
    dropStale_(ORG_DIV_); dropStale_(ORG_DEPT_);
  });
  return apiOrgAdmin();
}

/**
 * Saves the note for a seat that is filled at another grade than it was approved at.
 * n: { id?, dept, from, to, seats, reason, by, reviewOn }. One active note per department, from-grade and to-grade.
 * An upgrade (filled at a higher grade) needs a reason, who approved it and a review date; a downgrade needs none of them.
 */
function apiOrgSaveNote(n) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can add grade notes.');
  n = n || {};
  const dept = String(n.dept || '').trim(), from = orgGrade_(n.from), to = orgGrade_(n.to);
  const dRow = readTable_(ORG_DEPT_).rows.filter(function (r) { return orgKey_(r.Org_Dept) === orgKey_(dept) && String(r.Active) !== 'No'; })[0];
  if (!dRow) throw new Error('Pick a department from the organogram.');
  if (!orgBand_(from) || !orgBand_(to)) throw new Error('Grades must be from the list (M1 to M7, T, W1 to W5).');
  if (from === to) throw new Error('The approved grade and the grade it is filled at are the same.');
  if (orgBand_(from) !== orgBand_(to)) throw new Error('A grade can only cover for another grade in the same band (' + orgBand_(from) + ' and ' + orgBand_(to) + ' are different bands).');
  const seats = Number(n.seats);
  if (!(seats >= 1 && seats <= 999 && Math.round(seats) === seats)) throw new Error('Seats must be a whole number, 1 or more.');
  const up = orgGradeRank_(to) < orgGradeRank_(from);
  const reason = clean_(String(n.reason || '').trim()), by = clean_(String(n.by || '').trim());
  if (reason.length > 300) throw new Error('Keep the reason under 300 characters.');
  let review = '';
  if (n.reviewOn) { review = parseYmd_(n.reviewOn); }
  if (up) {
    if (reason.length < 3) throw new Error('Write a reason for filling a ' + from + ' seat at ' + to + '.');
    if (!by) throw new Error('Enter who approved the higher grade.');
    if (!review) throw new Error('Pick a review date for the higher grade.');
  }
  const data = { Org_Dept: String(dRow.Org_Dept).trim(), From_Grade: from, To_Grade: to, Seats: seats, Reason: reason, Approved_By: by, Review_On: n.reviewOn || '', Status: 'Active' };
  const t = readTable_(ORG_NOTE_, true);
  const have = t.rows.filter(function (r) { return String(r.Status || 'Active') !== 'Closed' && (String(r.Note_ID) === String(n.id) || (orgKey_(r.Org_Dept) === orgKey_(data.Org_Dept) && orgGrade_(r.From_Grade) === from && orgGrade_(r.To_Grade) === to)); })[0];
  if (have) { update_(T.ONT, have.Note_ID, prepare_(T.ONT, data), u); return { id: String(have.Note_ID) }; }
  const o = insert_(T.ONT, prepare_(T.ONT, data), u);
  return { id: String(o.Note_ID) };
}
function apiOrgCloseNote(id) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can close grade notes.');
  update_(T.ONT, String(id || ''), { Status: 'Closed' }, u);
  return { id: String(id) };
}

/** list: [{crm, org}]. org '' removes a mapping. */
function apiOrgSaveMap(list) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can change the department mapping.');
  withLock_(function () {
    const t = readTable_(ORG_MAP_, true), h = t.headers, col = function (n) { return h.indexOf(n) + 1; };
    const valid = {}; readTable_(ORG_DEPT_, true).rows.forEach(function (r) { if (String(r.Active) !== 'No') valid[orgKey_(r.Org_Dept)] = String(r.Org_Dept).trim(); });
    const have = {}; t.rows.forEach(function (r) { have[orgKey_(r.CRM_Dept)] = r; });
    const removals = [], audits = [];
    (list || []).forEach(function (x) {
      const crm = String(x.crm || '').trim(); if (!crm) return;
      const org = String(x.org || '').trim(), target = org ? valid[orgKey_(org)] : '';
      if (org && !target) throw new Error('"' + org + '" is not an active department in the new structure.');
      const r = have[orgKey_(crm)];
      if (r) {
        const was = String(r.Org_Dept || '').trim();
        if (orgKey_(was) === orgKey_(target)) return;
        if (!target) { removals.push(r._row); audits.push([crm, 'Delete', 'Org_Dept', was, '']); return; }
        t.sheet.getRange(r._row, col('Org_Dept')).setValue(jdmSafeText_(target)); t.sheet.getRange(r._row, col('Mapped_By')).setValue(u.email);
        audits.push([crm, 'Update', 'Org_Dept', was, target]);
      } else if (target) {
        const row = jdmRow_(ORG_MAP_, h.map(function (n) { return n === 'CRM_Dept' ? crm : n === 'Org_Dept' ? target : n === 'Mapped_By' ? u.email : ''; }));
        t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        audits.push([crm, 'Create', 'Org_Dept', '', target]);
      }
    });
    removals.sort(function (a, b) { return b - a; }).forEach(function (rw) { t.sheet.deleteRow(rw); });
    audits.forEach(function (a) { audit_(u, ORG_MAP_, a[0], a[1], a[2], a[3], a[4]); });
    dropStale_(ORG_MAP_);
  });
  return apiOrgAdmin();
}

/* ---------------- Budgeted manpower plan (schema 38) ---------------- */

/**
 * The approved (budgeted) headcount is kept as dated revisions: Org_Plan_Revisions (one row per revision, status Draft,
 * Active or Superseded) and Org_Plan (the full set of department and grade rows of each revision). The Organogram reads
 * approved from the Active revision and existing from Org_Manpower. A re-import refreshes existing only.
 */

function orgPlanKey_(dept, grade) { return orgKey_(dept) + '|' + orgGrade_(grade); }

/**
 * Joins the plan with the headcount snapshot. plan: [{dept,grade,approved}] or null (no plan yet: the report's own approved
 * column is used). snapshot: [{dept,grade,existing,report}]. A department and grade in only one source counts as 0 in the other.
 */
function orgMergePlan_(plan, snapshot) {
  const by = {}, order = [];
  const row = function (dept, grade) {
    const k = orgPlanKey_(dept, grade);
    if (!by[k]) { by[k] = { dept: String(dept).trim(), grade: orgGrade_(grade), approved: 0, existing: 0, report: 0 }; order.push(k); }
    return by[k];
  };
  (snapshot || []).forEach(function (s) { const r = row(s.dept, s.grade); r.existing += Number(s.existing) || 0; r.report += Number(s.report) || 0; });
  if (plan) (plan || []).forEach(function (p) { const r = row(p.dept, p.grade); r.approved += Number(p.approved) || 0; });
  else order.forEach(function (k) { by[k].approved = by[k].report; });
  return order.map(function (k) { return by[k]; });
}

/** Checks plan cells [{dept,grade,approved}] against the active departments. Returns { rows, errors }. */
function orgPlanCells_(cells, validDepts) {
  const out = [], errors = [], seen = {};
  (cells || []).forEach(function (c, i) {
    const dept = validDepts[orgKey_(c.dept)], grade = orgGrade_(c.grade), n = orgNum_(c.approved);
    if (!dept) { errors.push('Row ' + (i + 1) + ': "' + String(c.dept == null ? '' : c.dept) + '" is not an active department.'); return; }
    if (ORG_GRADES_.indexOf(grade) < 0) { errors.push(dept + ': "' + String(c.grade == null ? '' : c.grade) + '" is not a grade in the list.'); return; }
    if (isNaN(n) || n < 0 || n > 9999 || Math.round(n) !== n) { errors.push(dept + ' ' + grade + ': approved must be a whole number from 0 to 9999.'); return; }
    const k = orgPlanKey_(dept, grade);
    if (seen[k]) { errors.push(dept + ' ' + grade + ' appears twice.'); return; }
    seen[k] = true;
    out.push({ dept: dept, grade: grade, approved: n });
  });
  return { rows: out, errors: errors.slice(0, 40), moreErrors: Math.max(0, errors.length - 40) };
}

function orgPlanMap_(rows) { const m = {}; (rows || []).forEach(function (r) { m[orgPlanKey_(r.dept, r.grade)] = { dept: r.dept, grade: orgGrade_(r.grade), approved: Number(r.approved) || 0 }; }); return m; }

/** Changes from one set of plan rows to another: { changes:[{dept,grade,from,to}], up, down, totalFrom, totalTo, depts:{dept:{from,to}} }. */
function orgPlanDiff_(before, after) {
  const a = orgPlanMap_(before), b = orgPlanMap_(after), keys = {}, changes = [], depts = {};
  Object.keys(a).concat(Object.keys(b)).forEach(function (k) { keys[k] = true; });
  let up = 0, down = 0, tf = 0, tt = 0;
  Object.keys(keys).forEach(function (k) {
    const x = a[k] ? a[k].approved : 0, y = b[k] ? b[k].approved : 0, ref = a[k] || b[k];
    tf += x; tt += y;
    const d = depts[orgKey_(ref.dept)] || (depts[orgKey_(ref.dept)] = { dept: ref.dept, from: 0, to: 0 });
    d.from += x; d.to += y;
    if (x !== y) { changes.push({ dept: ref.dept, grade: ref.grade, from: x, to: y }); if (y > x) up += y - x; else down += x - y; }
  });
  changes.sort(function (p, q) { return Math.abs(q.to - q.from) - Math.abs(p.to - p.from) || (p.dept < q.dept ? -1 : p.dept > q.dept ? 1 : orgGradeRank_(p.grade) - orgGradeRank_(q.grade)); });
  return { changes: changes, up: up, down: down, totalFrom: tf, totalTo: tt, depts: depts };
}

/** Soft warnings for a proposed plan (never block): plan below people in post, a department cut to 0, large moves. */
function orgPlanWarnings_(diff, existingMap) {
  const w = [], below = {};
  diff.changes.forEach(function (c) {
    const ex = existingMap[orgPlanKey_(c.dept, c.grade)] || 0;
    if (c.to < ex && c.to < c.from) (below[c.dept] = below[c.dept] || []).push(c.grade + ' (' + c.to + ' planned, ' + ex + ' in post)');
  });
  Object.keys(below).forEach(function (d) { w.push(d + ': plan is below people in post for ' + below[d].join(', ') + '. It will show as over-strength.'); });
  Object.keys(diff.depts).forEach(function (k) {
    const d = diff.depts[k]; if (d.from === d.to) return;
    let exist = 0; Object.keys(existingMap).forEach(function (kk) { if (kk.indexOf(k + '|') === 0) exist += existingMap[kk]; });
    if (d.to === 0 && exist > 0) w.push(d.dept + ': the whole plan is cut to 0 while ' + exist + ' people are in post.');
    else if (d.from >= 4 && Math.abs(d.to - d.from) / d.from > 0.25) w.push(d.dept + ': the plan moves from ' + d.from + ' to ' + d.to + ' (more than 25%).');
  });
  return w.slice(0, 20);
}

/* ---- sheet access ---- */

function orgPlanRevs_() {
  if (!ss_().getSheetByName(ORG_PREV_)) return [];
  return readTable_(ORG_PREV_).rows.map(function (r) {
    return { id: String(r.Rev_ID), no: Number(r.Rev_No) || 0, status: String(r.Status || ''), reason: String(r.Reason || ''), by: String(r.Approved_By || ''), effective: ymd_(r.Effective_On),
      source: String(r.Source || ''), base: String(r.Base_Rev || ''), total: Number(r.Total_Approved) || 0, changed: Number(r.Seats_Changed) || 0, createdBy: String(r.Created_By || ''),
      createdAt: ymd_(r.Created_At), activatedBy: String(r.Activated_By || ''), activatedAt: ymd_(r.Activated_At), row: r._row };
  });
}
function orgPlanRows_(revId) {
  if (!ss_().getSheetByName(ORG_PLAN_)) return [];
  return readTable_(ORG_PLAN_).rows.filter(function (r) { return String(r.Rev_ID) === String(revId); })
    .map(function (r) { return { dept: String(r.Org_Dept), grade: orgGrade_(r.Grade), approved: Number(r.Approved_HC) || 0 }; });
}
function orgPlanActive_() {
  const rev = orgPlanRevs_().filter(function (x) { return x.status === 'Active'; })[0];
  return rev ? { rev: rev, rows: orgPlanRows_(rev.id) } : null;
}
function orgPlanDraft_() {
  const rev = orgPlanRevs_().filter(function (x) { return x.status === 'Draft'; })[0];
  return rev ? { rev: rev, rows: orgPlanRows_(rev.id) } : null;
}
function orgPlanTotal_(rows) { return rows.reduce(function (s, r) { return s + (Number(r.approved) || 0); }, 0); }

/** Appends the plan rows of one revision (non-zero cells only). */
function orgPlanWriteRows_(revId, rows) {
  const keep = rows.filter(function (r) { return Number(r.approved) > 0; }).sort(function (a, b) { return a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : orgGradeRank_(a.grade) - orgGradeRank_(b.grade); });
  if (!keep.length) return;
  const sh = sheet_(ORG_PLAN_), start = sh.getLastRow() + 1;
  sh.getRange(start, 1, keep.length, ORG_PLAN_COLS_.length).setValues(keep.map(function (r, i) { return jdmRow_(ORG_PLAN_, [revId + '-' + (i + 1), revId, r.dept, r.grade, r.approved]); }));
}
/** Removes every plan row of one revision by rewriting the sheet without them (one write, not one per row). */
function orgPlanDropRows_(revId) {
  const sh = sheet_(ORG_PLAN_), last = sh.getLastRow(); if (last < 2) return;
  const vals = sh.getRange(2, 1, last - 1, ORG_PLAN_COLS_.length).getValues();
  const keep = vals.filter(function (r) { return String(r[1]) !== String(revId); });
  if (keep.length === vals.length) return;
  sh.getRange(2, 1, last - 1, ORG_PLAN_COLS_.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, ORG_PLAN_COLS_.length).setValues(keep);
}
function orgPlanSetRev_(rev, patch) {
  const sh = sheet_(ORG_PREV_), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  Object.keys(patch).forEach(function (k) { const c = head.indexOf(k) + 1; if (c) sh.getRange(rev.row, c).setValue(patch[k] instanceof Date ? patch[k] : jdmSafeText_(clean_(patch[k]))); });
}
/** Creates a revision row and its plan rows. meta: { status, reason, by, effective (yyyy-mm-dd), source, base, user }. No locking here: callers hold it. */
function orgPlanCreate_(meta, rows, prev) {
  const t = readTable_(ORG_PREV_, true), no = meta.status === 'Active' ? Math.max(0, Math.max.apply(null, t.rows.map(function (r) { return Number(r.Rev_No) || 0; }).concat([0]))) + 1 : '';
  const id = nextId_(T.OPR, t.rows), now = new Date();
  const total = orgPlanTotal_(rows), changed = prev ? orgPlanDiff_(prev, rows).up + orgPlanDiff_(prev, rows).down : total;
  const row = ORG_PREV_COLS_.map(function (h) {
    return h === 'Rev_ID' ? id : h === 'Rev_No' ? no : h === 'Status' ? meta.status : h === 'Reason' ? clean_(meta.reason || '') : h === 'Approved_By' ? clean_(meta.by || '') :
      h === 'Effective_On' ? (meta.effective ? parseYmd_(meta.effective) : '') : h === 'Source' ? meta.source || '' : h === 'Base_Rev' ? meta.base || '' : h === 'Total_Approved' ? total : h === 'Seats_Changed' ? changed :
      h === 'Created_By' || h === 'Updated_By' ? (meta.user || '') : h === 'Created_At' || h === 'Updated_At' ? now : h === 'Activated_By' ? (meta.status === 'Active' ? meta.user || '' : '') : h === 'Activated_At' ? (meta.status === 'Active' ? now : '') : '';
  });
  t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, row.length).setValues([jdmRow_(ORG_PREV_, row)]);
  orgPlanWriteRows_(id, rows);
  dropStale_(ORG_PREV_); dropStale_(ORG_PLAN_);
  return id;
}

/** Schema step: an existing import with no plan becomes revision 1 (Active). Runs inside the schema lock, so it writes directly. */
function orgPlanMigrate_() {
  if (orgPlanRevs_().length) return;
  const mp = readTable_(ORG_MP_, true).rows; if (!mp.length) return;
  const rows = mp.map(function (r) { return { dept: String(r.Org_Dept), grade: orgGrade_(r.Grade), approved: Number(r.Approved_HC) || 0 }; });
  const asOn = ymd_(mp[0].As_On);
  orgPlanCreate_({ status: 'Active', reason: 'Opening plan from the manpower report as on ' + asOn, by: 'HR manpower report', effective: asOn, source: 'Report import', base: '', user: 'migration' }, rows, null);
}

/* ---- APIs ---- */

function orgPlanGuard_() {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'org_manage')) throw new Error('Only the Head of HR or the admin can change the manpower plan.');
  return u;
}
function orgValidDepts_() {
  const v = {}; readTable_(ORG_DEPT_).rows.forEach(function (d) { if (String(d.Active) !== 'No') v[orgKey_(d.Org_Dept)] = String(d.Org_Dept).trim(); });
  return v;
}
function orgExistingMap_() {
  const m = {}; readTable_(ORG_MP_).rows.forEach(function (r) { m[orgPlanKey_(r.Org_Dept, r.Grade)] = Number(r.Existing_HC) || 0; });
  return m;
}

/** The plan screen: the active revision, the open draft, and every active department by grade with plan, draft, existing and report approved. */
function apiOrgPlan() {
  const u = orgPlanGuard_();
  const act = orgPlanActive_(), draft = orgPlanDraft_();
  const depts = readTable_(ORG_DEPT_).rows.filter(function (d) { return String(d.Active) !== 'No'; });
  const divs = readTable_(ORG_DIV_).rows;
  const divOrder = {}; divs.forEach(function (d, i) { divOrder[orgKey_(d.Division)] = Number(d.Sort) || i; });
  const grid = function (rows) { const m = {}; (rows || []).forEach(function (r) { m[orgPlanKey_(r.dept, r.grade)] = r.approved; }); return m; };
  const pa = grid(act ? act.rows : []), pd = draft ? grid(draft.rows) : null, ex = orgExistingMap_(), rp = {};
  readTable_(ORG_MP_).rows.forEach(function (r) { rp[orgPlanKey_(r.Org_Dept, r.Grade)] = Number(r.Approved_HC) || 0; });
  const list = depts.map(function (d) {
    const name = String(d.Org_Dept).trim(), k = orgKey_(name);
    const line = function (m) { return ORG_GRADES_.map(function (g) { return m[k + '|' + g] || 0; }); };
    return { dept: name, division: String(d.Division).trim(), order: divOrder[orgKey_(d.Division)] || 0, plan: line(pa), draft: pd ? line(pd) : null, existing: line(ex), report: line(rp) };
  }).sort(function (a, b) { return a.order - b.order || (a.division < b.division ? -1 : a.division > b.division ? 1 : a.dept < b.dept ? -1 : 1); });
  const revs = orgPlanRevs_().sort(function (a, b) { return (b.no || 9999) - (a.no || 9999); });
  return { grades: ORG_GRADES_, active: act ? act.rev : null, draft: draft ? draft.rev : null, depts: list, revisions: revs, canActivate: !!draft && (!act || draft.rev.base === act.rev.id),
    stale: !!draft && !!act && draft.rev.base !== act.rev.id };
}

/** Saves the edited grid as the one open draft. cells: [{dept, grade, approved}] for the whole plan. */
function apiOrgPlanSaveDraft(cells, meta) {
  const u = orgPlanGuard_(); meta = meta || {};
  const checked = orgPlanCells_(cells, orgValidDepts_());
  if (checked.errors.length) return { ok: false, errors: checked.errors, moreErrors: checked.moreErrors };
  const act = orgPlanActive_();
  let warnings = [];
  withLock_(function () {
    const draft = orgPlanDraft_();
    const diff = orgPlanDiff_(act ? act.rows : [], checked.rows);
    warnings = orgPlanWarnings_(diff, orgExistingMap_());
    if (draft) {
      orgPlanDropRows_(draft.rev.id); orgPlanWriteRows_(draft.rev.id, checked.rows);
      orgPlanSetRev_(draft.rev, { Total_Approved: diff.totalTo, Seats_Changed: diff.up + diff.down, Updated_By: u.email, Updated_At: new Date(), Source: meta.source || draft.rev.source || 'App edit' });
      audit_(u, ORG_PREV_, draft.rev.id, 'Update', 'Draft', '', 'Draft saved: ' + diff.changes.length + ' cells changed');
    } else {
      const id = orgPlanCreate_({ status: 'Draft', reason: '', by: '', effective: '', source: meta.source || 'App edit', base: act ? act.rev.id : '', user: u.email }, checked.rows, act ? act.rows : null);
      audit_(u, ORG_PREV_, id, 'Create', 'Draft', '', 'Draft started: ' + diff.changes.length + ' cells changed');
    }
    dropStale_(ORG_PREV_); dropStale_(ORG_PLAN_);
  });
  const out = apiOrgPlan(); out.ok = true; out.warnings = warnings; out.changes = orgPlanDiff_(act ? act.rows : [], checked.rows).changes.length;
  return out;
}

/** Changes of a revision against another one (default: the one before it, or for a draft the active revision). */
function apiOrgPlanDiff(revId, otherId) {
  orgPlanGuard_();
  const revs = orgPlanRevs_(), rev = revs.filter(function (x) { return x.id === String(revId); })[0];
  if (!rev) throw new Error('That plan revision was not found.');
  let other = otherId ? revs.filter(function (x) { return x.id === String(otherId); })[0] : null;
  if (!other) {
    if (rev.status === 'Draft') other = revs.filter(function (x) { return x.status === 'Active'; })[0];
    else other = revs.filter(function (x) { return x.no && x.no < rev.no; }).sort(function (a, b) { return b.no - a.no; })[0];
  }
  const divOf = {}; readTable_(ORG_DEPT_).rows.forEach(function (d) { divOf[orgKey_(d.Org_Dept)] = String(d.Division).trim(); });
  const diff = orgPlanDiff_(other ? orgPlanRows_(other.id) : [], orgPlanRows_(rev.id));
  const byDiv = {};
  Object.keys(diff.depts).forEach(function (k) {
    const d = diff.depts[k], dv = divOf[k] || '?'; const b = byDiv[dv] || (byDiv[dv] = { division: dv, from: 0, to: 0 }); b.from += d.from; b.to += d.to;
  });
  return { rev: rev, other: other || null, changes: diff.changes, up: diff.up, down: diff.down, totalFrom: diff.totalFrom, totalTo: diff.totalTo,
    byDivision: Object.keys(byDiv).map(function (k) { return byDiv[k]; }).filter(function (x) { return x.from !== x.to; }).sort(function (a, b) { return Math.abs(b.to - b.from) - Math.abs(a.to - a.from); }),
    byDept: Object.keys(diff.depts).map(function (k) { return diff.depts[k]; }).filter(function (x) { return x.from !== x.to; }).sort(function (a, b) { return Math.abs(b.to - b.from) - Math.abs(a.to - a.from); }),
    warnings: rev.status === 'Draft' ? orgPlanWarnings_(diff, orgExistingMap_()) : [] };
}

/** Puts the open draft in force. meta: { reason, approvedBy, effectiveOn }. */
function apiOrgPlanActivate(draftId, meta) {
  const u = orgPlanGuard_(); meta = meta || {};
  const reason = String(meta.reason || '').trim(), by = String(meta.approvedBy || '').trim();
  if (reason.length < 5) throw new Error('Write the reason for this change (at least 5 characters).');
  if (reason.length > 300) throw new Error('Keep the reason under 300 characters.');
  if (!by) throw new Error('Enter who approved this plan.');
  if (by.length > 80) throw new Error('Keep the approver name under 80 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(meta.effectiveOn || ''))) throw new Error('Pick the date this plan takes effect.');
  parseYmd_(meta.effectiveOn);
  let result = null;
  withLock_(function () {
    const draft = orgPlanDraft_();
    if (!draft || draft.rev.id !== String(draftId)) throw new Error('There is no open draft with that number. Reload the page.');
    const act = orgPlanActive_();
    if ((act ? act.rev.id : '') !== (draft.rev.base || '')) throw new Error('The plan was changed by someone else after this draft was started (revision ' + (act ? act.rev.no : 0) + ' is now in force). Reload, then restore or redo your changes.');
    const diff = orgPlanDiff_(act ? act.rows : [], draft.rows);
    if (!diff.changes.length) throw new Error('This draft has no changes against the plan in force.');
    const no = Math.max.apply(null, [0].concat(orgPlanRevs_().map(function (x) { return x.no; }))) + 1;
    if (act) { orgPlanSetRev_(act.rev, { Status: 'Superseded', Updated_By: u.email, Updated_At: new Date() }); }
    orgPlanSetRev_(draft.rev, { Status: 'Active', Rev_No: no, Reason: reason, Approved_By: by, Effective_On: parseYmd_(meta.effectiveOn), Total_Approved: diff.totalTo, Seats_Changed: diff.up + diff.down,
      Activated_By: u.email, Activated_At: new Date(), Updated_By: u.email, Updated_At: new Date() });
    audit_(u, ORG_PREV_, draft.rev.id, 'Activate', 'Approved plan', String(diff.totalFrom), diff.totalTo + ' (revision ' + no + ', ' + diff.changes.length + ' cells, +' + diff.up + ' / -' + diff.down + '): ' + reason);
    dropStale_(ORG_PREV_); dropStale_(ORG_PLAN_);
    result = { rev: no, total: diff.totalTo, changes: diff.changes.length };
  });
  const out = apiOrgPlan(); out.activated = result; return out;
}

function apiOrgPlanDiscard(draftId) {
  const u = orgPlanGuard_();
  withLock_(function () {
    const draft = orgPlanDraft_();
    if (!draft || draft.rev.id !== String(draftId)) throw new Error('There is no open draft with that number. Reload the page.');
    orgPlanDropRows_(draft.rev.id);
    const sh = sheet_(ORG_PREV_); sh.deleteRow(draft.rev.row);
    audit_(u, ORG_PREV_, draft.rev.id, 'Delete', 'Draft', '', 'Draft discarded');
    dropStale_(ORG_PREV_); dropStale_(ORG_PLAN_);
  });
  return apiOrgPlan();
}

/** A new draft copied from an older revision, or from the report's own approved column (revId 'report'). History is never rewritten. */
function apiOrgPlanRestore(revId) {
  const u = orgPlanGuard_();
  withLock_(function () {
    if (orgPlanDraft_()) throw new Error('There is already an open draft. Activate or discard it first.');
    const act = orgPlanActive_();
    let rows, src, note;
    if (String(revId) === 'report') {
      const rs = readTable_(ORG_MP_, true).rows; if (!rs.length) throw new Error('No manpower report has been imported yet.');
      rows = rs.map(function (r) { return { dept: String(r.Org_Dept), grade: orgGrade_(r.Grade), approved: Number(r.Approved_HC) || 0 }; }); src = 'Report import'; note = 'the report';
    } else {
      const rev = orgPlanRevs_().filter(function (x) { return x.id === String(revId); })[0];
      if (!rev) throw new Error('That plan revision was not found.');
      rows = orgPlanRows_(rev.id); src = 'Restored'; note = 'revision ' + rev.no;
    }
    const id = orgPlanCreate_({ status: 'Draft', source: src, base: act ? act.rev.id : '', user: u.email }, rows, act ? act.rows : null);
    audit_(u, ORG_PREV_, id, 'Create', 'Draft', '', 'Draft started from ' + note);
  });
  return apiOrgPlan();
}

/**
 * Excel upload. rows: objects read from the template (Department and the grade columns M1 to W5). Dry run unless opts.apply;
 * applying saves a Draft only. Departments not in the file keep the numbers of the draft (or the plan in force).
 */
function apiOrgPlanUpload(rows, opts) {
  const u = orgPlanGuard_(); opts = opts || {};
  if (!rows || !rows.length) return { ok: false, errors: ['The file has no rows.'] };
  if (rows.length > 500) throw new Error('The file has more than 500 rows. Use the template from Download Excel.');
  const nrm = function (k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ''); };
  const keys = Object.keys(rows[0]), col = {};
  keys.forEach(function (k) { col[nrm(k)] = k; });
  const dCol = col.department || col.dept || col.orgdept;
  const gCols = ORG_GRADES_.filter(function (g) { return col[nrm(g)]; });
  const errors = [];
  if (!dCol) errors.push('The file needs a Department column. Use the template from Download Excel.');
  if (!gCols.length) errors.push('The file needs grade columns (M1 to M7, T, W1 to W5).');
  if (errors.length) return { ok: false, errors: errors };
  const valid = orgValidDepts_(), act = orgPlanActive_(), draft = orgPlanDraft_();
  const startRows = draft ? draft.rows : (act ? act.rows : []);
  const cur = orgPlanMap_(startRows), cells = [], seen = {};
  rows.forEach(function (r, i) {
    const name = String(r[dCol] == null ? '' : r[dCol]).trim(); if (!name || /^total$/i.test(name)) return;
    const d = valid[orgKey_(name)];
    if (!d) { errors.push('Row ' + (i + 2) + ': "' + name + '" is not an active department.'); return; }
    if (seen[orgKey_(d)]) { errors.push('Row ' + (i + 2) + ': ' + d + ' appears twice.'); return; }
    seen[orgKey_(d)] = true;
    gCols.forEach(function (g) {
      const raw = r[col[nrm(g)]], isBlank = raw === '' || raw === null || raw === undefined;
      const v = isBlank ? (cur[orgPlanKey_(d, g)] ? cur[orgPlanKey_(d, g)].approved : 0) : raw;
      cells.push({ dept: d, grade: g, approved: v, fromFile: !isBlank });
    });
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 40), moreErrors: Math.max(0, errors.length - 40) };
  const touched = {}; cells.forEach(function (c) { touched[orgPlanKey_(c.dept, c.grade)] = true; });
  Object.keys(cur).forEach(function (k) { if (!touched[k]) cells.push({ dept: cur[k].dept, grade: cur[k].grade, approved: cur[k].approved }); });
  const checked = orgPlanCells_(cells, valid);
  if (checked.errors.length) return { ok: false, errors: checked.errors, moreErrors: checked.moreErrors };
  const base = act ? act.rows : [], diff = orgPlanDiff_(base, checked.rows), against = diff;
  const warnings = orgPlanWarnings_(diff, orgExistingMap_());
  const res = { ok: true, applied: false, departments: Object.keys(seen).length, changes: diff.changes.length, up: diff.up, down: diff.down, totalFrom: diff.totalFrom, totalTo: diff.totalTo, preview: diff.changes.slice(0, 40), warnings: warnings, replacesDraft: !!draft };
  if (opts.apply !== true) return res;
  if (!diff.changes.length) throw new Error('The file makes no change to the plan in force.');
  const out = apiOrgPlanSaveDraft(checked.rows, { source: 'Excel upload' });
  out.applied = true; out.changes = diff.changes.length; out.up = diff.up; out.down = diff.down; out.preview = res.preview; out.warnings = warnings;
  return out;
}
