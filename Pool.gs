/**
 * Talent pool (Step 2). Candidates with no active or on-hold pipeline card form the pool, whether they were added
 * without a position or their last application ended. Profile fields make the pool searchable, and each position can
 * ask for suggestions ranked on function, title words, experience against the grade (policy Appendix F) and notice.
 */
const POOL_FIELDS_ = ['Function_Area', 'Key_Skills', 'Total_Exp_Years', 'Current_Location', 'Expected_CTC', 'Notice_Days'];
const FUNCTION_AREAS_ = ['Production / Operations', 'Mechanical Maintenance', 'Electrical Maintenance', 'Instrumentation & Automation',
  'Quality / Laboratory', 'Projects', 'Safety', 'Stores / Purchase / SCM', 'Logistics', 'HR & Admin', 'Finance & Accounts', 'IT',
  'Sales & Marketing', 'Corporate Affairs / Legal', 'Medical (OHC)', 'Security', 'Other'];

function poolSchema_() {
  addColumns_(T.CAND.name, POOL_FIELDS_);
  if (ss_().getSheetByName(CAND_ARCHIVE_)) addColumns_(CAND_ARCHIVE_, POOL_FIELDS_);
  const l = readTable_('M_Lists', true);
  if (!l.rows.some(function (r) { return String(r.List) === 'Function_Area'; })) {
    const rows = FUNCTION_AREAS_.map(function (v) { return l.headers.map(function (h) { return h === 'List' ? 'Function_Area' : h === 'Value' ? v : ''; }); });
    l.sheet.getRange(l.sheet.getLastRow() + 1, 1, rows.length, l.headers.length).setValues(rows);
    dropStale_('M_Lists');
  }
}

/** Years of experience: the number field, else the first number in the old free-text field ("6 years", "6.5 yrs", "8 months"). */
function expYears_(c) {
  const n = Number(c.Total_Exp_Years);
  if (c.Total_Exp_Years !== '' && c.Total_Exp_Years != null && !isNaN(n)) return n;
  const t = String(c.Relevant_Experience || '').toLowerCase(), m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return /month|mnth/.test(t) && !/year|yr/.test(t) ? Math.round(v / 12 * 10) / 10 : v;
}
/** Expected CTC in lakh per annum from free text: "8 LPA", "8.5", "65000 per month", "850000". */
function lpa_(v) {
  const t = String(v || '').toLowerCase().replace(/,/g, ''), m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  let x = Number(m[1]);
  if (/month|p\.?m\b|pm\b|per month/.test(t)) x = x * 12;
  if (x >= 1000) x = x / 100000;
  return Math.round(x * 100) / 100;
}
function liveCands_() {
  const live = {};
  readTable_(T.APP.name).rows.forEach(function (a) { if (['Active', 'On hold'].indexOf(String(a.Status)) >= 0) live[a.Candidate_ID] = true; });
  return live;
}
/** Profile filters for the Candidates page: pool, function, experience range, location, notice, expected CTC. */
function poolMatch_(c, f, live) {
  if (f.pool && live[c.Candidate_ID]) return false;
  if (f.func && String(c.Function_Area) !== f.func) return false;
  const y = expYears_(c);
  if (f.expMin !== '' && f.expMin != null && !(y != null && y >= Number(f.expMin))) return false;
  if (f.expMax !== '' && f.expMax != null && !(y != null && y <= Number(f.expMax))) return false;
  if (f.loc && String(c.Current_Location || '').toLowerCase().indexOf(String(f.loc).toLowerCase()) < 0) return false;
  if (f.noticeMax !== '' && f.noticeMax != null) { const nd = Number(c.Notice_Days); if (c.Notice_Days === '' || isNaN(nd) || nd > Number(f.noticeMax)) return false; }
  if (f.ctcMax !== '' && f.ctcMax != null) { const x = lpa_(c.Expected_CTC); if (x == null || x > Number(f.ctcMax)) return false; }
  return true;
}
function poolFiltering_(f) {
  return !!(f.pool || f.func || f.loc || [f.expMin, f.expMax, f.noticeMax, f.ctcMax].some(function (v) { return v !== '' && v != null; }));
}

/* ---------- suggestions for a position ---------- */
const GRADE_MIN_EXP_ = { degree: { M1: 25, M2: 20, M3: 15, M4: 10, M5: 6, M6: 4, M7: 2 }, iti: { M3: 20, M4: 16, M5: 12, M6: 12, M7: 10 } };
const STOP_WORDS_ = ['and', 'the', 'for', 'of', 'sr', 'jr', 'asst', 'assistant', 'senior', 'junior', 'dy', 'deputy', 'cum', 'in', 'charge', 'incharge', 'head', 'officer', 'executive'];
function titleWords_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(function (w) { return w.length >= 3 && STOP_WORDS_.indexOf(w) < 0; });
}
/** Best-guess function area for a department name (e.g. "1050 TPD-MECH" -> Mechanical Maintenance). */
function deptFunction_(dept) {
  const d = String(dept || '').toUpperCase();
  const map = [[/E\s*AND\s*I|INSTRUMENT|AUTOMATION/, 'Instrumentation & Automation'], [/ELEC/, 'Electrical Maintenance'], [/MECH/, 'Mechanical Maintenance'],
    [/QC|QUALITY|LAB/, 'Quality / Laboratory'], [/SAFETY/, 'Safety'], [/STORE|PURCHASE|SCM|MATERIAL/, 'Stores / Purchase / SCM'], [/LOGISTIC|DISPATCH/, 'Logistics'],
    [/HR|ADMIN|PERSONNEL/, 'HR & Admin'], [/ACCOUNT|FINANCE|F&A/, 'Finance & Accounts'], [/\bIT\b|SYSTEM/, 'IT'], [/SALES|MARKETING|EXPORT/, 'Sales & Marketing'],
    [/CORPORATE|LEGAL/, 'Corporate Affairs / Legal'], [/OHC|MEDICAL/, 'Medical (OHC)'], [/SECURITY/, 'Security'], [/PROJECT/, 'Projects'],
    [/PRODUCTION|OPERATION|TPD|MW|RMH|SMS|CLU|FAD|PLANT/, 'Production / Operations']];
  for (let i = 0; i < map.length; i++) if (map[i][0].test(d)) return map[i][1];
  return '';
}
function eduIti_(edu) { const e = String(edu || '').toLowerCase(); return /\biti\b|12th|intermediate|\bhsc\b/.test(e) && !/b\.?\s?tech|b\.?e\b|degree|graduate|diploma|mba|m\.?tech|b\.?sc|m\.?sc|b\.?com|mca|bca/.test(e); }

function apiSuggestForLine(lineId, opts) {
  currentUser_(); ensureSchema_();
  opts = opts || {};
  const line = lineOf_(lineId);
  if (!line) throw new Error('Position not found.');
  const grade = String(line.Grade || '').toUpperCase().trim();
  const func = deptFunction_(line.Dept);
  const words = titleWords_(line.Position);
  const live = liveCands_(), onLine = {};
  readTable_(T.APP.name).rows.forEach(function (a) { if (a.Line_ID === lineId) onLine[a.Candidate_ID] = true; });
  const out = [];
  readTable_(T.CAND.name).rows.forEach(function (c) {
    if (live[c.Candidate_ID] || onLine[c.Candidate_ID]) return;
    const reasons = [];
    let score = 0;
    if (func && String(c.Function_Area) === func) { score += 3; reasons.push('Function: ' + func); }
    const hay = titleWords_([c.Current_Designation, c.Position, c.Key_Skills, c.Offered_Designation].join(' '));
    const shared = words.filter(function (w) { return hay.indexOf(w) >= 0; });
    if (shared.length) { score += Math.min(4, 2 * shared.length); reasons.push('Title/skills match: ' + shared.join(', ')); }
    if (!score) return;
    const y = expYears_(c), iti = eduIti_(c.Education);
    const pol = typeof jdmPolicyExp_ === 'function' ? jdmPolicyExp_(grade, lineTitle_(line)) : null;
    const min = pol ? (iti ? pol.iti : pol.degree) : (iti ? GRADE_MIN_EXP_.iti : GRADE_MIN_EXP_.degree)[grade];
    if (y != null && min != null) {
      if (y >= min) { score += 2; reasons.push(y + ' yrs (grade ' + grade + ' needs ' + min + '+' + (iti ? ' with 12th/ITI' : '') + ')'); }
      else if (y >= min * 0.75) { score += 1; reasons.push(y + ' yrs (slightly below the ' + min + '+ for ' + grade + ')'); }
      else { score -= 1; reasons.push(y + ' yrs (below the ' + min + '+ for ' + grade + ')'); }
    } else if (y != null) reasons.push(y + ' yrs experience');
    const nd = Number(c.Notice_Days);
    if (c.Notice_Days !== '' && !isNaN(nd)) { if (nd <= 30) { score += 1; reasons.push('Notice ' + nd + ' days'); } else reasons.push('Notice ' + nd + ' days'); }
    if (score < 2) return;
    out.push({ id: c.Candidate_ID, name: String(c.Name), designation: String(c.Current_Designation || ''), position: String(c.Position || ''),
      func: String(c.Function_Area || ''), exp: y, edu: String(c.Education || ''), location: String(c.Current_Location || ''),
      notice: c.Notice_Days === '' ? '' : String(c.Notice_Days), expected: String(c.Expected_CTC || ''), mobile: String(c.Mobile || ''),
      hasCv: c.CV_File_URL ? 'Yes' : '', last: ymd_(c.Last_Activity), score: score, reasons: reasons });
  });
  out.sort(function (a, b) { return b.score - a.score || String(b.last).localeCompare(String(a.last)); });
  return { line: { id: lineId, mrf: String(line.MRF_No || ''), position: String(line.Position || ''), grade: grade, dept: String(line.Dept || '') },
    func: func, minExp: GRADE_MIN_EXP_.degree[grade] || null, minExpIti: GRADE_MIN_EXP_.iti[grade] || null, total: out.length, rows: out.slice(0, Number(opts.size) || 25) };
}
