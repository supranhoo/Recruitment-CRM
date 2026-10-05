/**
 * CV profile (ADR-044): what the rule-based parser reads beyond the form fields, kept per candidate.
 * Employer-by-employer history with dates, education, certifications, languages, links, achievements, skills with
 * the CV line that shows them, and checks calculated from those facts (gaps, tenure, overlaps, stated vs counted
 * experience). No AI service: patterns only. Every fact the parser is unsure of is marked "check"; anything not in
 * the CV is "Not Found". Age, gender, marital status, religion, nationality and photos are never read or kept.
 * The browser extracts the text; this file finds the facts, stores them (sheet Candidate_Profiles) and derives the rest.
 */
const PROFILE_SHEET_ = 'Candidate_Profiles';
const PROFILE_COLS_ = ['Candidate_ID', 'Profile_JSON', 'Source', 'Parsed_On', 'Reviewed_By', 'Reviewed_On', 'Updated_By', 'Updated_At'];

function profileSchema_() { addSheet_(PROFILE_SHEET_, PROFILE_COLS_); }

/* ------------------------------------------------------------------ dates ------------------------------------------ */

const CV_MONTHS_ = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const CV_MON_RE_ = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const CV_DATE_RE_ = '(?:' + CV_MON_RE_ + '\\.?[\\s,\\u2019\\u2018\']*(?:19|20)?\\d{2}|\\d{1,2}[/.\\-]\\d{1,2}[/.\\-](?:19|20)?\\d{2}|\\d{1,2}[/.\\-](?:19|20)\\d{2}|(?:19|20)\\d{2})';
const CV_NOW_RE_ = '(?:present|current(?:ly)?|till\\s+date|till\\s+now|to\\s+date|till-date|todate|now|ongoing|continuing|date)';
const CV_RANGE_G_ = new RegExp('(?:from\\s+|since\\s+)?(' + CV_DATE_RE_ + ')\\s*(?:-|\\u2013|\\u2014|to|till|until|\\u2192)\\s*(' + CV_DATE_RE_ + '|' + CV_NOW_RE_ + ')', 'ig');
const CV_SINCE_RE_ = new RegExp('(?:since|from)\\s+(' + CV_DATE_RE_ + ')(?![\\s\\S]{0,12}(?:to|till|until|-|\\u2013))', 'i');

function cvYear_(s, nowYear) {
  let y = Number(s);
  if (y < 100) y = y <= (nowYear % 100) + 1 ? 2000 + y : 1900 + y;
  return y;
}
/** One date as {ym:'yyyy-MM', prec:'month'|'year'} or {now:true}; null when it is not a date. */
function cvParseDate_(s, nowYear) {
  s = String(s || '').trim();
  if (!s) return null;
  if (new RegExp('^' + CV_NOW_RE_ + '$', 'i').test(s)) return { now: true };
  nowYear = nowYear || new Date().getFullYear();
  let m = s.match(new RegExp('^(' + CV_MON_RE_ + ')\\.?[\\s,\\u2019\\u2018\']*((?:19|20)?\\d{2})$', 'i'));
  if (m) { const y = cvYear_(m[2], nowYear); return { ym: y + '-' + ('0' + CV_MONTHS_[m[1].toLowerCase().slice(0, 4) === 'sept' ? 'sept' : m[1].toLowerCase().slice(0, 3)]).slice(-2), prec: 'month' }; }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)?\d{2})$/);
  if (m) { const mo = Number(m[2]), y = cvYear_(m[3], nowYear); if (mo >= 1 && mo <= 12) return { ym: y + '-' + ('0' + mo).slice(-2), prec: 'month' }; return null; }
  m = s.match(/^(\d{1,2})[\/.\-]((?:19|20)\d{2})$/);
  if (m) { const mo = Number(m[1]); if (mo >= 1 && mo <= 12) return { ym: m[2] + '-' + ('0' + mo).slice(-2), prec: 'month' }; return null; }
  m = s.match(/^((?:19|20)\d{2})$/);
  if (m) return { ym: m[1] + '-01', prec: 'year' };
  return null;
}
function cvYmNum_(ym) { const p = String(ym).split('-'); return Number(p[0]) * 12 + Number(p[1]) - 1; }
function cvNumYm_(n) { const y = Math.floor(n / 12), m = n % 12 + 1; return y + '-' + ('0' + m).slice(-2); }
function cvYmLabel_(ym) { if (!ym) return ''; const p = String(ym).split('-'), n = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; return n[Number(p[1]) - 1] + ' ' + p[0]; }

/* ------------------------------------------------------------------ sections --------------------------------------- */

const CV_HEADINGS_ = [
  ['exp', /^(?:(?:professional|work(?:ing)?|employment|career|relevant|industrial|organi[sz]ational)\s+)?(?:experience|history|record)(?:\s+(?:details|summary|history))?$|^employment(?:\s+details)?$|^career\s+(?:history|progression|summary)$|^experience\s+summary$/i],
  ['edu', /^(?:education(?:al)?|academic)(?:\s+(?:qualifications?|details|background|profile))?$|^qualifications?$|^academics$/i],
  ['skills', /^(?:key|technical|core|professional|it|functional|computer)?\s*skills?(?:\s*(?:&|and)\s*(?:expertise|competenc(?:y|ies)|tools|software))?$|^(?:core\s+)?competenc(?:y|ies)$|^areas?\s+of\s+expertise$|^expertise$|^strengths?$|^tools(?:\s*(?:&|and)\s*technologies)?$/i],
  ['cert', /^certifications?(?:\s*(?:&|and)\s*(?:training|courses|licen[cs]es?))?$|^trainings?(?:\s*(?:&|and)\s*certifications?)?$|^courses?$|^licen[cs]es?(?:\s*(?:&|and)\s*certifications?)?$|^professional\s+(?:development|training)$|^training\s+(?:attended|programs?|programmes?)$/i],
  ['lang', /^languages?(?:\s+known)?$/i],
  ['ach', /^(?:key\s+)?(?:achievements?|accomplishments?|awards?(?:\s*(?:&|and)\s*(?:achievements?|recognition))?|honou?rs|recognitions?|achievements?\s*(?:&|and)\s*awards?)$/i],
  ['proj', /^(?:key\s+)?projects?(?:\s+(?:undertaken|handled|details))?$/i],
  ['sum', /^(?:professional\s+|career\s+)?(?:profile|summary|objective|overview)$|^about\s+me$|^career\s+objective$|^profile\s+summary$/i],
  ['other', /^personal(?:\s+(?:details|information|profile))?$|^declaration$|^hobbies(?:\s*(?:&|and)\s*interests)?$|^interests$|^references?$|^contact(?:\s+(?:details|information))?$|^address$|^extra[\s-]*curricular(?:\s+activities)?$|^activities$/i]];

/** The heading a line is, or ''. Headings are short, stand alone and may end with a colon. */
function cvHeading_(line) {
  const t = String(line || '').replace(/^[^A-Za-z]+/, '').replace(/[\s:\-\u2013_]+$/, '').trim();
  if (!t || t.length > 48 || t.split(/\s+/).length > 6) return '';
  for (let i = 0; i < CV_HEADINGS_.length; i++) if (CV_HEADINGS_[i][1].test(t)) return CV_HEADINGS_[i][0];
  return '';
}
/** Lines grouped under their headings: {exp:[...], edu:[...], ...}, plus top (before the first heading). */
function cvSections_(lines) {
  const out = { top: [] };
  let cur = 'top';
  lines.forEach(function (l) {
    const h = cvHeading_(l);
    if (h) { cur = h; if (!out[cur]) out[cur] = []; return; }
    (out[cur] = out[cur] || []).push(l);
  });
  return out;
}

/* ------------------------------------------------------------------ employment ------------------------------------- */

const CV_COMPANY_RE_ = /\b(?:limited|ltd\.?|pvt\.?|private|inc\.?|llp|corporation|corp\.?|company|co\.|industries|industry|enterprises?|group|steel|steels|power|energy|mills?|foundry|foundries|works|plant|alloys?|cement|mining|mines|minerals|metals?|infra|infrastructure|construction|engineering|technologies|solutions|services|systems|logistics|hospital|school|university|institute|bank|authority|ispat|sail|tata|jindal|vedanta|ntpc|bhel|coal india|ongc|l&t|adani|jsw|nalco|hindalco|rungta|usha|electrosteel|bhushan|aarti|ultratech|ambuja|acc)\b|^m\/s\b/i;
const CV_ROLE_RE_ = /\b(?:manager|executive|assistant|engineer|officer|director|head|gm|agm|dgm|ceo|cxo|president|supervisor|foreman|chemist|analyst|consultant|lead|in-?charge|trainee|technician|fitter|welder|electrician|operator|accountant|associate|specialist|coordinator|intern|apprentice|clerk|secretary|administrator|auditor|planner|inspector|surveyor|driver|designer|developer|programmer|architect|vice president|vp|senior|junior|sr\.?|jr\.?|dy\.?|asst\.?|sde|hr)\b/i;
const CV_BULLET_RE_ = /^\s*(?:[\u2022\u25cf\u25aa\u25a0\u25cb\u2023\u2043\u2219\u25ba\u27a2\u2713\u2714\-\*\u2013>]|\d+[.)])\s*/;

function cvCleanPart_(s) { return String(s || '').replace(CV_BULLET_RE_, '').replace(/^\s*(?:organi[sz]ation|organi[sz]ation name|company(?: name)?|employer|designation|position(?: held)?|role|job title|title|duration|period|tenure|worked as|working as)\s*[:\-]\s*/i, '').replace(/^\s*(?:worked|working|working|employed)\s+as\s+(?:an?\s+)?/i, '').replace(/^[\s,|:;\-\u2013\u2014@]+|[\s,|:;\-\u2013\u2014@]+$/g, '').replace(/^\(+(?![^)]*\))/, '').replace(/(?<!\([^)]*)\)+$/, '').replace(/\s+/g, ' ').trim(); }
function cvIsSentence_(s) { return s.split(/\s+/).length > 9 || /[.;]\s*[A-Za-z]/.test(s) || /\b(?:responsible|handled|managed|worked|looking|seeking|ensure|ensuring|maintain|maintaining)\b/i.test(s); }

/** Employment entries from the experience section (or, with no heading, from lines outside education/other). */
function cvEmployment_(lines, sec, nowYm, nowYear) {
  let src = sec.exp && sec.exp.length ? sec.exp : null, fromWhole = false;
  if (!src) { src = lines.filter(function (l) { return (sec.edu || []).indexOf(l) < 0 && (sec.other || []).indexOf(l) < 0 && (sec.cert || []).indexOf(l) < 0; }); fromWhole = true; }
  const hits = [];
  src.forEach(function (line, i) {
    if (/\b(?:b\.?\s?tech|b\.?e\b|m\.?\s?tech|mba|diploma|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|10th|12th|matric|graduat|intermediate|hsc|ssc|iti|certificat|passing|percentage|cgpa)\b/i.test(line) && fromWhole) return;
    const re = new RegExp(CV_RANGE_G_.source, 'ig'); let m = re.exec(line);
    if (!m) { const s = line.match(CV_SINCE_RE_); if (s) m = { 0: s[0], 1: s[1], 2: 'present', index: s.index }; }
    if (!m) return;
    const a = cvParseDate_(m[1], nowYear), b = cvParseDate_(m[2], nowYear);
    if (!a || a.now) return;
    if (b && !b.now && cvYmNum_(b.ym) < cvYmNum_(a.ym)) return;
    const rest = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/\(\s*\)|\[\s*\]/g, ' ');
    hits.push({ i: i, a: a, b: b, rest: rest, line: line });
  });
  const entries = [];
  const okLine = function (l) { return l && !CV_BULLET_RE_.test(l) && l.length <= 90 && !new RegExp(CV_DATE_RE_, 'i').test(l) && !cvIsSentence_(l) && !cvHeading_(l); };
  const isEmp = function (t) { return CV_COMPANY_RE_.test(t) && !(CV_ROLE_RE_.test(t) && !/\b(?:limited|ltd|pvt|private|company|corporation|industries)\b/i.test(t)); };
  const isRole = function (t) { return CV_ROLE_RE_.test(t) && !(CV_COMPANY_RE_.test(t) && /\b(?:limited|ltd|pvt|private)\b/i.test(t)); };
  // 1) the text on the date line; 2) how many header lines sit above it when that is not enough
  hits.forEach(function (h) {
    const first = h.rest.split(/\s*(?:\||\u2022|,|;|\s@\s)\s*|\s+(?:at|with|in)\s+(?=[A-Z])/).map(cvCleanPart_).filter(String);
    h.parts = [];
    first.forEach(function (t) {   // a dash splits "Company - Role", but not a role such as "Senior Manager - Maintenance"
      if (/\s[-\u2013\u2014]\s/.test(t) && t.split(/\s+[-\u2013\u2014]\s+/).some(isEmp)) t.split(/\s+[-\u2013\u2014]\s+/).forEach(function (x) { h.parts.push(cvCleanPart_(x)); }); else h.parts.push(t);
    });
    h.parts = h.parts.filter(function (p) { return p.length > 1 && !/^(?:duration|period|tenure|from|to)$/i.test(p); });
    h.complete = h.parts.some(isEmp) && h.parts.some(isRole);
  });
  hits.forEach(function (h, k) {
    h.hp = 0;
    if (h.complete) return;
    const floor = k === 0 ? -1 : hits[k - 1].i;
    for (let j = h.i - 1; j > floor && h.hp < 2; j--) { if (okLine(src[j])) h.hp++; else break; }
  });
  hits.forEach(function (h, k) {
    const nextI = k + 1 < hits.length ? hits[k + 1].i - hits[k + 1].hp : src.length;
    const all = h.parts.map(function (t) { return { t: t }; });
    for (let j = h.i - 1; j >= h.i - h.hp; j--) all.push({ t: cvCleanPart_(src[j]) });
    let used = h.i;
    const missing = function () { return !all.some(function (c) { return isEmp(c.t); }) || !all.some(function (c) { return isRole(c.t); }); };
    for (let j = h.i + 1; j < Math.min(nextI, h.i + 3) && missing() && okLine(src[j]); j++) { all.push({ t: cvCleanPart_(src[j]) }); used = j; }
    let employer = '', role = '';
    all.forEach(function (c) { if (!employer && isEmp(c.t)) employer = c.t; });
    all.forEach(function (c) { if (!role && c.t !== employer && isRole(c.t)) role = c.t; });
    let guessed = false;
    if (!employer) { const g = all.filter(function (c) { return c.t !== role && !CV_ROLE_RE_.test(c.t) && /^[A-Za-z0-9&.'()\/ -]{2,60}$/.test(c.t) && c.t.split(/\s+/).length <= 6; })[0]; if (g) { employer = g.t; guessed = true; } }
    if (!role) { const g = all.filter(function (c) { return c.t !== employer && /^[A-Za-z0-9&.'()\/ -]{3,60}$/.test(c.t) && c.t.split(/\s+/).length <= 6; })[0]; if (g) { role = g.t; guessed = true; } }
    if (!employer && !role) return;
    const duties = [];
    for (let j = used + 1; j < nextI && duties.length < 4; j++) {
      const l = src[j], d = cvCleanPart_(l || '');
      if (!l || d === employer || d === role || cvHeading_(l)) continue;
      if (d.length >= 12) duties.push(d.slice(0, 180));
    }
    const endNow = !h.b || h.b.now, startYm = h.a.ym, approx = h.a.prec === 'year' || (!endNow && h.b.prec === 'year');
    const endOut = endNow ? '' : (h.b.prec === 'year' ? (h.b.ym.slice(0, 4) + '-12') : h.b.ym);
    entries.push({ employer: employer.slice(0, 80), role: role.slice(0, 80), start: startYm, end: endOut, current: endNow, approx: approx,
      conf: (!guessed && employer && role && !approx) ? 'found' : 'check', duties: duties });
  });
  // OCR passes can repeat the same job: keep one per employer and start
  const seen = {};
  return entries.filter(function (e) { const k = (e.employer + '|' + e.start).toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; });
}

/* ------------------------------------------------------------------ the other facts -------------------------------- */

const CV_SCHOOL_RE_ = /\b(?:university|college|institute|institution|polytechnic|iti|school|academy|iit|nit|bits|board|vidyalaya|vidyapith|mahavidyalaya|kendriya|cbse|icse|ignou|xlri|iim|jecrc|nift)\b/i;
const CV_LANGS_ = ['English', 'Hindi', 'Bengali', 'Bangla', 'Odia', 'Oriya', 'Telugu', 'Tamil', 'Marathi', 'Gujarati', 'Punjabi', 'Kannada', 'Malayalam', 'Urdu', 'Santali', 'Maithili', 'Bhojpuri', 'Assamese', 'Nepali', 'Sanskrit', 'Konkani', 'Kashmiri', 'Magahi', 'Nagpuri', 'Khortha', 'German', 'French', 'Spanish', 'Japanese', 'Mandarin', 'Chinese', 'Arabic'];
const CV_CERT_RE_ = /\b(?:nebosh|iosh|pmp|prince2|six\s+sigma|green\s+belt|black\s+belt|lead\s+auditor|internal\s+auditor|iso\s*\d{4,5}|sap\s+certified|ndt\s+level\s*\w*|asnt|boiler\s+operation\s+engineer|boe\b|first\s+aid|fire\s+(?:safety|fighting)|diploma\s+in\s+industrial\s+safety|pgdis|cfa|cma|company\s+secretary|icwa|caia|chartered\s+accountant|ca\s+inter|cs\s+executive|ms\s+office|advanced\s+excel|tally\s+erp|autocad\s+certified|plc\s+(?:programming|training)|scada\s+training|hazop|hira|nabl|nabet|lead\s+implementer|safety\s+officer\s+course|rigger|forklift|crane\s+operator|welding\s+(?:inspector|certificate|certification)|cswip|aws\s+cwi|tpm|lean|kaizen|5s)\b/i;

const CV_SKILL_CATS_ = {
  Technical: ['SAP', 'SAP PM', 'SAP MM', 'SAP HR', 'SAP FICO', 'ERP', 'AutoCAD', 'SolidWorks', 'STAAD', 'ETAP', 'Primavera', 'MS Project', 'PLC', 'SCADA', 'DCS', 'HMI', 'VFD', 'Siemens', 'Allen Bradley', 'ABB', 'EOT crane', 'hydraulics', 'pneumatics', 'welding', 'CNC', 'lathe', 'boiler', 'turbine', 'furnace', 'induction furnace', 'blast furnace', 'rolling mill', 'sponge iron', 'foundry', 'casting', 'moulding', 'sand plant', 'melting', 'ladle', 'refractory', 'sinter', 'coke oven', 'DRI', 'SMS', 'preventive maintenance', 'breakdown maintenance', 'predictive maintenance', 'condition monitoring', 'gearbox', 'bearing', 'conveyor', 'transformer', 'switchgear', 'HT', 'LT', 'substation', 'instrumentation', 'calibration', 'NDT', 'spectro', 'metallurgy', 'chemical analysis', 'MS Excel', 'Excel', 'MS Office', 'PowerPoint', 'Power BI', 'Tableau', 'Python', 'SQL', 'networking', 'Tally', 'TPM', 'Lean', 'Six Sigma', 'Kaizen', '5S', 'FMEA', 'RCA', 'HIRA', 'HAZOP', 'ISO 9001', 'ISO 14001', 'ISO 45001', 'quality control', 'QC', 'QA'],
  Functional: ['recruitment', 'talent acquisition', 'payroll', 'HRMS', 'labour laws', 'statutory compliance', 'industrial relations', 'employee engagement', 'performance management', 'training and development', 'onboarding', 'PF', 'ESI', 'GST', 'TDS', 'accounts payable', 'accounts receivable', 'budgeting', 'costing', 'MIS', 'audit', 'taxation', 'procurement', 'purchase', 'vendor management', 'inventory', 'stores', 'SCM', 'logistics', 'dispatch', 'export', 'import', 'sales', 'marketing', 'business development', 'safety', 'fire fighting', 'first aid', 'contract management', 'liaison', 'legal compliance', 'production planning', 'project management', 'maintenance planning', 'cost control', 'customs'],
  Leadership: ['team management', 'team handling', 'team lead', 'leadership', 'mentoring', 'coaching', 'shift in-charge', 'supervis', 'decision making', 'strategic planning', 'stakeholder management', 'people management', 'managed a team', 'led a team', 'resource planning', 'delegation'],
  Communication: ['communication', 'presentation', 'negotiation', 'report writing', 'coordination', 'interpersonal', 'customer handling', 'liaisoning', 'public speaking', 'documentation', 'client interaction'],
  'Soft skills': ['teamwork', 'team player', 'problem solving', 'problem-solving', 'analytical', 'adaptability', 'time management', 'self-motivated', 'hard working', 'hardworking', 'attention to detail', 'initiative', 'multitasking', 'quick learner', 'ownership']
};
const CV_DOMAINS_ = ['Steel', 'Sponge iron / DRI', 'Ferro alloys', 'Power / Thermal', 'Mining', 'Coal', 'Cement', 'Foundry / Casting', 'Rolling mill', 'Manufacturing', 'Construction / EPC', 'Infrastructure', 'Logistics', 'Pharma', 'Automobile', 'FMCG', 'Banking / Finance', 'IT / Software', 'Oil & Gas', 'Chemicals', 'Textiles', 'Hospitality', 'Education', 'Healthcare'];
const CV_DOMAIN_RE_ = { 'Steel': /\bsteel\b|\bsail\b|\bispat\b|\bsms\b|blast furnace|\btmt\b/i, 'Sponge iron / DRI': /sponge iron|\bdri\b/i, 'Ferro alloys': /ferro[\s-]*alloy|silico manganese|ferro manganese/i, 'Power / Thermal': /thermal power|power plant|\bntpc\b|captive power|\bboiler\b|\bturbine\b|power generation|\bcpp\b/i, 'Mining': /\bmining\b|\bmines?\b|opencast|underground mine/i, 'Coal': /\bcoal\b|\bcil\b|washery/i, 'Cement': /\bcement\b|clinker/i, 'Foundry / Casting': /foundry|casting|moulding|sand plant/i, 'Rolling mill': /rolling mill|hot strip|cold rolling|bar mill|wire rod/i, 'Manufacturing': /manufacturing|production plant|assembly line/i, 'Construction / EPC': /construction|\bepc\b|civil works|site engineer/i, 'Infrastructure': /infrastructure|highway|railway|bridge/i, 'Logistics': /logistics|warehous|supply chain|transport/i, 'Pharma': /pharma|\bgmp\b|formulation/i, 'Automobile': /automobile|automotive|\boem\b/i, 'FMCG': /\bfmcg\b|consumer goods/i, 'Banking / Finance': /\bbank|\bnbfc\b|insurance|mutual fund/i, 'IT / Software': /software|\bit services\b|web development|application development/i, 'Oil & Gas': /oil\s*(?:&|and)\s*gas|refinery|petroleum|\bongc\b/i, 'Chemicals': /chemical plant|petrochemical|fertili[sz]er/i, 'Textiles': /textile|garment|spinning mill/i, 'Hospitality': /hotel|hospitality|restaurant/i, 'Education': /\bschool\b|teaching|lecturer|professor/i, 'Healthcare': /hospital|clinic|nursing|healthcare/i };

function cvEvidence_(lines, re) {
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return lines[i].replace(CV_BULLET_RE_, '').replace(/\s+/g, ' ').trim().slice(0, 150);
  return '';
}
function cvTermRe_(w) { return new RegExp('(?:^|[^A-Za-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^A-Za-z0-9])', 'i'); }

function cvLinks_(text) {
  const out = { linkedin: '', github: '', portfolio: '' };
  const li = text.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[A-Za-z0-9\-_%.]+\/?/i); if (li) out.linkedin = li[0].replace(/^(?!https?:)/i, 'https://');
  const gh = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9\-_.]+(?:\/[A-Za-z0-9\-_.]+)?/i); if (gh) out.github = gh[0].replace(/^(?!https?:)/i, 'https://');
  const urls = text.match(/https?:\/\/[^\s)>,"']+|(?:www\.)[A-Za-z0-9\-]+\.[A-Za-z.]{2,}[^\s)>,"']*/gi) || [];
  const pf = urls.filter(function (u) { return !/linkedin\.com|github\.com|gmail|yahoo|hotmail|outlook|facebook|twitter|instagram|mailto/i.test(u); })[0];
  if (pf) out.portfolio = pf.replace(/^(?!https?:)/i, 'https://').slice(0, 150);
  return out;
}

function cvEducation_(lines, sec) {
  const src = (sec.edu && sec.edu.length) ? sec.edu : lines;
  const out = [], seen = {};
  src.forEach(function (line, i) {
    let lvl = '';
    for (let k = 0; k < EDU_ORDER_.length; k++) if (EDU_ORDER_[k][0].test(line)) { lvl = EDU_ORDER_[k][1]; break; }
    if (!lvl) return;
    if (!(sec.edu && sec.edu.length) && !/\b(?:university|college|institute|board|passed|passing|graduat|degree|diploma|percentage|cgpa|marks)\b|(?:19|20)\d{2}/i.test(line)) return;
    const nextHasLevel = EDU_ORDER_.some(function (e) { return e[0].test(src[i + 1] || ''); });
    const win = nextHasLevel ? line : [line, src[i + 1] || ''].join(' | ');
    const disc = DISCIPLINES_.filter(function (d) { return new RegExp('\\b' + d + '\\b', 'i').test(win); })[0] || '';
    let inst = '';
    [line, nextHasLevel ? '' : (src[i + 1] || ''), i > 0 && !EDU_ORDER_.some(function (e) { return e[0].test(src[i - 1]); }) ? src[i - 1] : ''].some(function (l) {
      const seg = String(l || '').split(/[,|()]/).map(function (x) { return cvCleanPart_(x.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\d+(?:\.\d+)?\s*%/g, '')); }).filter(function (x) { return CV_SCHOOL_RE_.test(x) && !/^(?:b\.?\s?tech|diploma|mba)\b/i.test(x); })[0];
      if (seg) { inst = seg.slice(0, 90); return true; } return false; });
    const yr = (win.match(/\b(?:19[89]\d|20[0-3]\d)\b/g) || []).slice(-1)[0] || '';
    const sc = (win.match(/(\d{2}(?:\.\d{1,2})?)\s*%|cgpa\s*[:\-]?\s*(\d(?:\.\d{1,2})?)/i) || []);
    const score = sc[1] ? sc[1] + '%' : sc[2] ? 'CGPA ' + sc[2] : '';
    const key = lvl + '|' + disc + '|' + yr; if (seen[key]) return; seen[key] = 1;
    out.push({ level: lvl, discipline: disc, institute: inst, year: yr, score: score, conf: (inst || yr) ? 'found' : 'check' });
  });
  const rank = EDU_ORDER_.map(function (e) { return e[1]; });
  out.sort(function (a, b) { return rank.indexOf(a.level) - rank.indexOf(b.level); });
  return out.slice(0, 6);
}

function cvListFrom_(lines, max) {
  return lines.map(function (l) { return cvCleanPart_(l); }).filter(function (l) { return l.length >= 3 && l.length <= 160 && !cvHeading_(l); }).slice(0, max);
}

/** Builds the extracted facts (not the derived checks) from CV text. */
function cvExtractProfile_(raw, fields, opts) {
  opts = opts || {};
  let blocks = String(raw || '').replace(/\r/g, '').split('\f');
  let text = blocks.reduce(function (a, b) { return b.length > a.length ? b : a; }, '');
  text = text.replace(/[\u00a0\t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 40000);
  const lines = text.split('\n').map(function (l) { return l.trim(); }).filter(String);
  const now = opts.now ? new Date(opts.now) : new Date(), nowYm = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2);
  const sec = cvSections_(lines);
  const p = { v: 1, links: cvLinks_(text), employment: cvEmployment_(lines, sec, nowYm, now.getFullYear()), education: cvEducation_(lines, sec), certifications: [], languages: [], achievements: [], skills: [], domain: [], visa: '', skillsText: '' };
  // certifications: the section lines, plus well-known certificates named anywhere
  const certSeen = {};
  cvListFrom_(sec.cert || [], 10).forEach(function (l) { if (!certSeen[l.toLowerCase()]) { certSeen[l.toLowerCase()] = 1; p.certifications.push({ name: l, from: 'section' }); } });
  lines.forEach(function (l) { const m = l.match(CV_CERT_RE_); if (m && !(sec.cert || []).some(function (x) { return x === l; }) && p.certifications.length < 12) { const nm = cvCleanPart_(l).slice(0, 120); if (!certSeen[nm.toLowerCase()] && nm.length < 120 && !cvIsSentence_(nm)) { certSeen[nm.toLowerCase()] = 1; p.certifications.push({ name: nm, from: 'named' }); } } });
  // languages: only known language names, from a Languages line or section
  const langText = (labelled_(text, 'languages?(?: known)?') + ' ' + (sec.lang || []).join(' ')).trim();
  p.languages = CV_LANGS_.filter(function (g) { return new RegExp('\\b' + g + '\\b', 'i').test(langText); }).map(function (g) { return g === 'Bangla' ? 'Bengali' : g === 'Oriya' ? 'Odia' : g; }).filter(function (g, i, a) { return a.indexOf(g) === i; });
  // achievements
  p.achievements = cvListFrom_(sec.ach || [], 8).filter(function (l) { return l.length >= 12; });
  // skills with evidence (the CV line that shows each)
  const skillLines = lines.filter(function (l) { return !cvHeading_(l); });
  Object.keys(CV_SKILL_CATS_).forEach(function (cat) {
    CV_SKILL_CATS_[cat].forEach(function (w) {
      const ev = cvEvidence_(skillLines, cvTermRe_(w));
      if (ev && !p.skills.some(function (s) { return s.skill.toLowerCase() === w.toLowerCase() && s.cat === cat; })) p.skills.push({ cat: cat, skill: w, evidence: ev });
    });
  });
  p.skills = p.skills.slice(0, 80);
  CV_DOMAINS_.forEach(function (d) { const ev = cvEvidence_(skillLines, CV_DOMAIN_RE_[d]); if (ev) p.domain.push({ name: d, evidence: ev }); });
  p.domain = p.domain.slice(0, 8);
  // visa / work authorisation: only if the CV says something about it
  const vl = lines.filter(function (l) { return /\b(?:visa|work\s+permit|work\s+authori[sz]ation|right\s+to\s+work)\b/i.test(l); })[0];
  if (vl) p.visa = vl.replace(/\s+/g, ' ').slice(0, 140);
  p.statedExp = fields && fields.Total_Exp_Years != null ? Number(fields.Total_Exp_Years) : null;
  p.current = { role: fields && fields.Current_Designation || '', employer: fields && fields.Current_Company || '' };
  p.ocr = !!opts.ocr; p.chars = text.length;
  return p;
}

/* ------------------------------------------------------------------ derived checks --------------------------------- */

function cvGapMonths_() { const n = Number(settings_().CV_GAP_MONTHS); return n >= 1 && n <= 24 ? n : 3; }

/**
 * Everything calculated from the facts: tenure, counted experience, gaps, overlaps, frequent changes, risks, what is
 * missing, a confidence score and a plain summary. `cand` is the candidate row (fields the CV did not give).
 */
function cvDerive_(p, cand, opts) {
  opts = opts || {};
  cand = cand || {};
  const now = opts.now ? new Date(opts.now) : new Date(), nowYm = now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2), nowN = cvYmNum_(nowYm);
  const gapMin = opts.gapMonths || cvGapMonths_();
  const jobs = (p.employment || []).filter(function (e) { return e.start; }).map(function (e) {
    const s = cvYmNum_(e.start), en = e.current || !e.end ? nowN : cvYmNum_(e.end);
    return { e: e, s: s, en: Math.max(en, s), months: Math.max(en, s) - s + 1 };
  }).sort(function (a, b) { return a.s - b.s; });
  jobs.forEach(function (j) { j.e.months = j.months; });
  // counted experience: the union of the periods
  let union = 0, curS = null, curE = null;
  jobs.forEach(function (j) { if (curS === null) { curS = j.s; curE = j.en; } else if (j.s <= curE + 1) curE = Math.max(curE, j.en); else { union += curE - curS + 1; curS = j.s; curE = j.en; } });
  if (curS !== null) union += curE - curS + 1;
  const risks = [], gaps = [];
  const exact = jobs.every(function (j) { return !j.e.approx; });
  const dated = jobs.length > 0;
  // gaps between jobs, and since the last one
  if (jobs.length) {
    let reach = jobs[0].en;
    for (let i = 1; i < jobs.length; i++) {
      const j = jobs[i], gap = j.s - reach - 1;
      if (gap >= gapMin && !(jobs[i - 1].e.approx || j.e.approx)) gaps.push({ from: cvNumYm_(reach + 1), to: cvNumYm_(j.s - 1), months: gap, between: jobs[i - 1].e.employer + ' \u2192 ' + j.e.employer });
      reach = Math.max(reach, j.en);
    }
    const last = jobs.filter(function (j) { return !j.e.current; }), anyCurrent = jobs.some(function (j) { return j.e.current; });
    if (!anyCurrent && last.length) { const lj = last[last.length - 1], gap = nowN - lj.en; if (gap >= gapMin && !lj.e.approx) gaps.push({ from: cvNumYm_(lj.en + 1), to: nowYm, months: gap, between: lj.e.employer + ' \u2192 now' }); }
  }
  // overlaps between different employers
  const overlaps = [];
  for (let a = 0; a < jobs.length; a++) for (let b = a + 1; b < jobs.length; b++) {
    const o = Math.min(jobs[a].en, jobs[b].en) - Math.max(jobs[a].s, jobs[b].s) + 1;
    if (o > 3 && String(jobs[a].e.employer).toLowerCase() !== String(jobs[b].e.employer).toLowerCase()) overlaps.push({ a: jobs[a].e.employer, b: jobs[b].e.employer, months: o });
  }
  // frequent changes: completed jobs in the last five years under 18 months
  const recentDone = jobs.filter(function (j) { return !j.e.current && j.en >= nowN - 60; });
  const shortJobs = recentDone.filter(function (j) { return j.months < 18; });
  const doneAll = jobs.filter(function (j) { return !j.e.current; });
  const avg = doneAll.length ? Math.round(doneAll.reduce(function (a, j) { return a + j.months; }, 0) / doneAll.length) : null;
  // stated vs counted experience
  const stated = p.statedExp != null ? p.statedExp : (cand.Total_Exp_Years !== undefined && cand.Total_Exp_Years !== '' && !isNaN(Number(cand.Total_Exp_Years)) ? Number(cand.Total_Exp_Years) : null);
  const countedYears = dated ? Math.round(union / 12 * 10) / 10 : null;
  if (!dated) risks.push({ level: 'info', text: 'No dated employment history was found, so gaps, tenure and counted experience cannot be checked.' });
  if (dated && !exact) risks.push({ level: 'info', text: 'Some jobs have years only (no months); gaps and counted experience for those are approximate and gaps around them are not reported.' });
  gaps.forEach(function (g) { risks.push({ level: g.months >= 12 ? 'warn' : 'note', text: 'Gap of ' + g.months + ' months (' + cvYmLabel_(g.from) + ' to ' + cvYmLabel_(g.to) + ', ' + g.between + '). Ask about it; the CV does not explain it.' }); });
  if (shortJobs.length >= 3) risks.push({ level: 'warn', text: shortJobs.length + ' jobs of under 18 months in the last 5 years (' + shortJobs.map(function (j) { return j.e.employer + ' ' + j.months + ' m'; }).join(', ') + ').' });
  else if (avg !== null && avg < 18 && doneAll.length >= 3) risks.push({ level: 'note', text: 'Average completed tenure is ' + avg + ' months across ' + doneAll.length + ' jobs.' });
  overlaps.forEach(function (o) { risks.push({ level: 'note', text: 'Periods at ' + o.a + ' and ' + o.b + ' overlap by ' + o.months + ' months (could be a notice period, part-time or consulting work; confirm).' }); });
  if (stated !== null && countedYears !== null && Math.abs(stated - countedYears) > 2) risks.push({ level: 'warn', text: 'The CV states ' + stated + ' years of experience but the dated jobs add up to ' + countedYears + ' years. Confirm which is right.' });
  if (p.ocr) risks.push({ level: 'note', text: 'This CV was read by OCR. Names, numbers and dates may contain reading errors; check them against the file.' });
  (p.employment || []).forEach(function (e) { if (e.conf === 'check') { /* counted below */ } });
  const unsure = (p.employment || []).filter(function (e) { return e.conf === 'check'; }).length;
  if (unsure) risks.push({ level: 'note', text: unsure + ' of ' + (p.employment || []).length + ' jobs have an employer, role or date the parser is unsure of (marked "check").' });
  // what is missing
  const has = function (v) { return v !== undefined && v !== null && String(v).trim() !== ''; };
  const missing = [];
  if (!has(cand.Email)) missing.push('Email'); if (!has(cand.Mobile)) missing.push('Mobile');
  if (!has(cand.Current_Location)) missing.push('Location'); if (!has(cand.Current_CTC)) missing.push('Current salary'); if (!has(cand.Expected_CTC)) missing.push('Expected salary');
  if (!has(cand.Notice_Days)) missing.push('Notice period');
  if (!p.links.linkedin) missing.push('LinkedIn'); if (!p.education.length) missing.push('Education details'); if (!p.employment.length) missing.push('Employment history');
  if (!p.certifications.length) missing.push('Certifications'); if (!p.languages.length) missing.push('Languages'); if (!p.achievements.length) missing.push('Achievements');
  if (!p.visa) missing.push('Work authorisation (only if relevant)');
  // confidence: what share of the core facts were found, less for OCR and for unsure jobs
  let pts = 0, max = 0;
  const add = function (w, ok) { max += w; if (ok) pts += w; };
  add(15, has(cand.Name)); add(10, has(cand.Email)); add(10, has(cand.Mobile)); add(25, p.employment.length > 0); add(15, p.education.length > 0); add(10, p.skills.length >= 3); add(10, dated); add(5, has(cand.Current_Designation) || has(p.current && p.current.role));
  let score = Math.round(pts / max * 100);
  if (p.ocr) score = Math.max(0, score - 15);
  if (unsure) score = Math.max(0, score - Math.min(15, unsure * 3));
  const level = score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low';
  const topEmployers = (p.employment || []).slice().sort(function (a, b) { return String(b.start).localeCompare(String(a.start)); });
  return { counted: { months: union, years: countedYears, jobs: jobs.length, exact: exact }, stated: stated, gaps: gaps, overlaps: overlaps,
    tenure: { avgMonths: avg, shortRecent: shortJobs.length, completed: doneAll.length }, risks: risks, missing: missing, confidence: { score: score, level: level, ocr: !!p.ocr },
    summary: cvSummary_(p, cand, { countedYears: countedYears, stated: stated, top: topEmployers }) };
}

/** A recruiter summary written from the facts only (no judgement of suitability). */
function cvSummary_(p, cand, d) {
  const name = String(cand.Name || 'The candidate'), parts = [];
  const role = String(cand.Current_Designation || (p.current && p.current.role) || ''), emp = String(cand.Current_Company || (p.current && p.current.employer) || '');
  const exp = d.stated !== null ? d.stated : d.countedYears;
  parts.push(name + (role ? ' is a ' + role : ' has a CV on file') + (emp ? ' at ' + emp : '') + (exp !== null && exp !== undefined ? ', with ' + exp + ' years of experience' + (d.stated === null ? ' (counted from the dated jobs)' : '') : '') + '.');
  if (d.top.length) parts.push('Career: ' + d.top.slice(0, 4).map(function (e) { return (e.role ? e.role + ', ' : '') + e.employer + (e.start ? ' (' + cvYmLabel_(e.start) + ' \u2013 ' + (e.current ? 'present' : cvYmLabel_(e.end)) + ')' : ''); }).join('; ') + '.');
  if (p.education.length) { const e = p.education[p.education.length - 1]; parts.push('Highest qualification: ' + e.level + (e.discipline ? ' (' + e.discipline + ')' : '') + (e.institute ? ', ' + e.institute : '') + (e.year ? ', ' + e.year : '') + '.'); }
  const tech = p.skills.filter(function (s) { return s.cat === 'Technical' || s.cat === 'Functional'; }).slice(0, 8).map(function (s) { return s.skill; });
  if (tech.length) parts.push('Skills shown in the CV: ' + tech.join(', ') + '.');
  if (p.domain.length) parts.push('Industry exposure: ' + p.domain.slice(0, 4).map(function (x) { return x.name; }).join(', ') + '.');
  if (p.certifications.length) parts.push('Certifications: ' + p.certifications.slice(0, 4).map(function (c) { return c.name; }).join('; ') + '.');
  if (p.achievements.length) parts.push('Achievements listed: ' + p.achievements.slice(0, 2).map(function (a) { return a.replace(/[.\s]+$/, ''); }).join('; ') + '.');
  if (p.languages.length) parts.push('Languages: ' + p.languages.join(', ') + '.');
  parts.push('Written from the CV text only; it is not an assessment of suitability.');
  const words = parts.join(' ').split(/\s+/);
  return words.length > 200 ? words.slice(0, 200).join(' ') + '\u2026' : parts.join(' ');
}

/* ------------------------------------------------------------------ storing ---------------------------------------- */

/** Keeps only the expected shape, with every text capped, before anything from the browser is stored. */
function cvProfileClean_(x) {
  x = x && typeof x === 'object' ? x : {};
  const s = function (v, n) { return clean_(String(v == null ? '' : v)).replace(/\s+/g, ' ').trim().slice(0, n); };
  const arr = function (a, n) { return Array.isArray(a) ? a.slice(0, n) : []; };
  const ym = function (v) { v = String(v || ''); return /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(v) ? v : ''; };
  const L = x.links || {};
  const p = { v: 1, links: { linkedin: s(L.linkedin, 150), github: s(L.github, 150), portfolio: s(L.portfolio, 150) },
    employment: arr(x.employment, 25).map(function (e) { e = e || {}; const o = { employer: s(e.employer, 80), role: s(e.role, 80), start: ym(e.start), end: ym(e.end), current: e.current === true || e.current === 'true', approx: e.approx === true, conf: e.conf === 'found' ? 'found' : 'check', duties: arr(e.duties, 4).map(function (d) { return s(d, 180); }).filter(String) };
      if (o.current) o.end = ''; return o; }).filter(function (e) { return e.employer || e.role; }),
    education: arr(x.education, 8).map(function (e) { e = e || {}; return { level: s(e.level, 30), discipline: s(e.discipline, 40), institute: s(e.institute, 90), year: /^(?:19|20)\d{2}$/.test(String(e.year || '')) ? String(e.year) : '', score: s(e.score, 20), conf: e.conf === 'found' ? 'found' : 'check' }; }).filter(function (e) { return e.level || e.institute; }),
    certifications: arr(x.certifications, 15).map(function (c) { return { name: s(c && c.name !== undefined ? c.name : c, 120), from: c && c.from === 'named' ? 'named' : 'section' }; }).filter(function (c) { return c.name; }),
    languages: arr(x.languages, 12).map(function (l) { return s(l, 30); }).filter(String),
    achievements: arr(x.achievements, 10).map(function (a) { return s(a, 160); }).filter(String),
    skills: arr(x.skills, 90).map(function (k) { k = k || {}; return { cat: Object.keys(CV_SKILL_CATS_).indexOf(k.cat) >= 0 ? k.cat : 'Technical', skill: s(k.skill, 50), evidence: s(k.evidence, 150) }; }).filter(function (k) { return k.skill; }),
    domain: arr(x.domain, 10).map(function (d) { return { name: s(d && d.name, 40), evidence: s(d && d.evidence, 150) }; }).filter(function (d) { return d.name; }),
    visa: s(x.visa, 140), statedExp: x.statedExp === null || x.statedExp === undefined || x.statedExp === '' || isNaN(Number(x.statedExp)) ? null : Math.min(60, Math.max(0, Number(x.statedExp))),
    current: { role: s(x.current && x.current.role, 80), employer: s(x.current && x.current.employer, 80) }, ocr: x.ocr === true, chars: Number(x.chars) || 0 };
  return p;
}
function profileRow_(candId) {
  profileSchema_();
  return readTable_(PROFILE_SHEET_).rows.filter(function (r) { return String(r.Candidate_ID) === String(candId); })[0] || null;
}
function profileWrite_(candId, p, source, reviewed, u) {
  const t = readTable_(PROFILE_SHEET_, true), now = new Date();
  const row = t.rows.filter(function (r) { return String(r.Candidate_ID) === String(candId); })[0];
  const json = JSON.stringify(p);
  if (json.length > 45000) throw new Error('This profile is too large to store. Remove some of the long text.');
  const o = row ? Object.assign({}, row) : { Candidate_ID: candId };
  o.Profile_JSON = json; o.Source = source; o.Updated_By = u.email; o.Updated_At = now;
  if (!row || !reviewed) { o.Parsed_On = now; o.Reviewed_By = ''; o.Reviewed_On = ''; }
  else { o.Parsed_On = row.Parsed_On || now; }
  if (reviewed) { o.Reviewed_By = u.email; o.Reviewed_On = now; }
  const vals = t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
  if (row) t.sheet.getRange(row._row, 1, 1, t.headers.length).setValues([vals]);
  else t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([vals]);
  dropStale_(PROFILE_SHEET_);
}

function profileOut_(candId, cand) {
  const r = profileRow_(candId);
  if (!r) return null;
  let p = {}; try { p = JSON.parse(String(r.Profile_JSON || '{}')); } catch (e) { }
  p = cvProfileClean_(p);
  const d = cvDerive_(p, cand);
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v || ''); };
  return { id: String(candId), profile: p, derived: d, source: String(r.Source || ''), parsedOn: at(r.Parsed_On), reviewedBy: String(r.Reviewed_By || ''), reviewedOn: at(r.Reviewed_On), updatedBy: String(r.Updated_By || '') };
}
function candRow_(id) { return readTable_(T.CAND.name).rows.filter(function (r) { return String(r.Candidate_ID) === String(id); })[0] || null; }

/* ------------------------------------------------------------------ APIs ------------------------------------------- */

/** The stored profile of a candidate with its checks, or null when none has been built yet. */
function apiGetProfile(candId) {
  currentUser_(); ensureSchema_();
  const c = candRow_(candId);
  if (!c) throw new Error('Candidate ' + candId + ' was not found.');
  const out = profileOut_(candId, c);
  return out || { id: String(candId), none: true, hasCv: !!c.CV_File_URL };
}

/** Builds (or rebuilds) the profile from CV text the browser has read. A reviewed profile is replaced only with `replace`. */
function apiBuildProfile(candId, text, opts) {
  const u = currentUser_(); ensureSchema_();
  opts = opts || {};
  const c = candRow_(candId);
  if (!c) throw new Error('Candidate ' + candId + ' was not found.');
  const old = profileRow_(candId);
  if (old && old.Reviewed_By && !opts.replace) throw new Error('This profile was reviewed by ' + String(old.Reviewed_By).split('@')[0] + '. Choose "Replace" to read the CV again and lose those edits.');
  const parsed = parseCvText_(String(text || '').slice(0, 40000), { ocr: !!opts.ocr });
  const f = Object.assign({}, parsed.fields);
  const p = cvProfileClean_(cvExtractProfile_(String(text || ''), f, { ocr: !!opts.ocr }));
  if (!p.employment.length && !p.education.length && !p.skills.length && parsed.scanned) throw new Error('No text could be read from this CV, so no profile was built.');
  withLock_(function () { profileWrite_(candId, p, 'CV: ' + String(opts.fileName || 'file').slice(0, 100), false, u); });
  audit_(u, PROFILE_SHEET_, candId, 'Profile built', '', '', String(opts.fileName || ''));
  return profileOut_(candId, c);
}

/** Saves the recruiter's corrected profile (marks it reviewed). Any team member can correct facts from the CV. */
function apiSaveProfile(candId, profile) {
  const u = currentUser_(); ensureSchema_();
  const c = candRow_(candId);
  if (!c) throw new Error('Candidate ' + candId + ' was not found.');
  const p = cvProfileClean_(profile);
  p.employment.forEach(function (e) {
    if (e.start && e.end && cvYmNum_(e.end) < cvYmNum_(e.start)) throw new Error((e.employer || 'A job') + ': the end date is before the start date.');
    if (e.start && cvYmNum_(e.start) > cvYmNum_(ymd_(new Date()).slice(0, 7))) throw new Error((e.employer || 'A job') + ': the start date is in the future.');
    if (!e.start && (e.end || e.current)) throw new Error((e.employer || 'A job') + ': add the start date.');
    e.conf = 'found';
  });
  withLock_(function () { profileWrite_(candId, p, (profileRow_(candId) || {}).Source || 'Entered by hand', true, u); });
  audit_(u, PROFILE_SHEET_, candId, 'Profile reviewed', '', '', p.employment.length + ' jobs');
  return profileOut_(candId, c);
}

/** Rows for the Excel-ready export: one per candidate that has a profile (optionally limited to the ids given). */
function apiProfileExport(ids) {
  currentUser_(); ensureSchema_(); profileSchema_();
  const want = Array.isArray(ids) && ids.length ? ids.reduce(function (m, i) { m[String(i)] = 1; return m; }, {}) : null;
  const cands = {}; readTable_(T.CAND.name).rows.forEach(function (r) { cands[String(r.Candidate_ID)] = r; });
  const apps = {}; readTable_(T.APP.name).rows.forEach(function (a) { const k = String(a.Candidate_ID); if (!apps[k] || String(a.Status) === 'Active') apps[k] = a; });
  const rows = [];
  readTable_(PROFILE_SHEET_).rows.forEach(function (r) {
    const id = String(r.Candidate_ID), c = cands[id];
    if (!c || (want && !want[id])) return;
    let p = {}; try { p = JSON.parse(String(r.Profile_JSON || '{}')); } catch (e) { return; }
    p = cvProfileClean_(p);
    const d = cvDerive_(p, c), a = apps[id];
    const edu = p.education.slice().reverse().map(function (e) { return [e.level, e.discipline].filter(String).join(' ') + (e.year ? ' ' + e.year : ''); }).join('; ');
    rows.push({ id: id, name: String(c.Name || ''), role: String(c.Current_Designation || p.current.role || ''), exp: d.stated !== null ? d.stated : (d.counted.years === null ? '' : d.counted.years),
      location: String(c.Current_Location || ''), skills: p.skills.filter(function (s) { return s.cat === 'Technical' || s.cat === 'Functional'; }).slice(0, 12).map(function (s) { return s.skill; }).join(', '),
      employer: String(c.Current_Company || p.current.employer || ''), education: edu, certifications: p.certifications.map(function (x) { return x.name; }).join('; '),
      status: a ? String(a.Stage) + ' (' + String(a.Status) + ')' : 'Not in a pipeline', confidence: d.confidence.score, risks: d.risks.filter(function (x) { return x.level !== 'info'; }).length, reviewed: r.Reviewed_By ? 'Yes' : 'No' });
  });
  return rows;
}
