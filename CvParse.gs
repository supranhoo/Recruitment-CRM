/**
 * Free CV parser (Step 3). The browser extracts the text (pdf.js for PDFs, mammoth.js for .docx); this file
 * finds the fields with patterns, runs the duplicate check (active and archived), and records what recruiters
 * keep or correct so the pilot can measure accuracy field by field. No AI service, no new permissions.
 */
const PARSE_LOG_ = 'CV_Parse_Log';
const PARSE_FIELDS_ = ['Name', 'Mobile', 'Email', 'Education', 'Total_Exp_Years', 'Current_Designation', 'Current_Company',
  'Current_Location', 'Current_CTC', 'Expected_CTC', 'Notice_Days', 'Key_Skills', 'Function_Area'];

function parseSchema_() {
  addColumns_(T.CAND.name, ['Current_Company']);
  if (ss_().getSheetByName(CAND_ARCHIVE_)) addColumns_(CAND_ARCHIVE_, ['Current_Company']);
  addSheet_(PARSE_LOG_, ['Log_ID', 'Candidate_ID', 'File_Name', 'Parsed_JSON', 'Saved_JSON', 'Chars', 'By', 'At']);
}

const CITIES_ = ['Ramgarh', 'Ranchi', 'Jamshedpur', 'Bokaro', 'Dhanbad', 'Hazaribagh', 'Giridih', 'Deoghar', 'Patna', 'Gaya', 'Muzaffarpur',
  'Bhagalpur', 'Kolkata', 'Durgapur', 'Asansol', 'Kharagpur', 'Rourkela', 'Bhubaneswar', 'Cuttack', 'Jharsuguda', 'Angul', 'Raipur',
  'Bhilai', 'Delhi', 'New Delhi', 'Noida', 'Gurgaon', 'Gurugram', 'Mumbai', 'Pune', 'Bengaluru', 'Bangalore', 'Chennai', 'Hyderabad',
  'Nagpur', 'Visakhapatnam', 'Vizag', 'Lucknow', 'Varanasi', 'Kanpur', 'Ahmedabad', 'Vadodara', 'Indore', 'Bhopal', 'Chandigarh'];
const SKILL_WORDS_ = ['SAP', 'SAP PM', 'SAP MM', 'SAP HR', 'AutoCAD', 'SolidWorks', 'PLC', 'SCADA', 'DCS', 'HMI', 'VFD', 'EOT crane', 'crane',
  'hydraulics', 'pneumatics', 'welding', 'fitter', 'lathe', 'CNC', 'boiler', 'turbine', 'furnace', 'induction furnace', 'blast furnace',
  'rolling mill', 'foundry', 'casting', 'moulding', 'sand plant', 'melting', 'ladle', 'refractory', 'sinter', 'coke oven', 'DRI', 'SMS',
  'preventive maintenance', 'breakdown maintenance', 'predictive maintenance', 'condition monitoring', 'gearbox', 'bearing', 'conveyor',
  'transformer', 'switchgear', 'motor', 'HT', 'LT', 'substation', 'instrumentation', 'calibration', 'quality control', 'QC', 'QA',
  'ISO 9001', 'ISO 14001', 'ISO 45001', 'NDT', 'spectro', 'metallurgy', 'chemical analysis', 'MS Excel', 'Excel', 'Tally', 'GST', 'TDS',
  'accounts payable', 'payroll', 'HRMS', 'recruitment', 'labour laws', 'statutory compliance', 'PF', 'ESI', 'safety', 'NEBOSH', 'IOSH',
  'first aid', 'fire fighting', 'logistics', 'SCM', 'procurement', 'purchase', 'inventory', 'stores', 'dispatch', 'export', 'sales',
  'marketing', 'business development', 'Python', 'SQL', 'networking', 'Power BI'];
const EDU_ORDER_ = [
  [/\bph\.?\s?d\b|doctorate/i, 'PhD'], [/\bm\.?\s?tech\b|\bm\.e\.?(?=\s|$|,)|master of engineering/i, 'M.Tech/ME'], [/\bmba\b|\bpgdm\b|\bpgdbm\b/i, 'MBA/PGDM'],
  [/\bmca\b/i, 'MCA'], [/\bm\.?\s?sc\b/i, 'M.Sc'], [/\bm\.?\s?com\b/i, 'M.Com'], [/\bm\.?\s?a\b(?=[\s,.])/, 'MA'],
  [/\bb\.?\s?tech\b|\bb\.e\.?(?=\s|$|,)|bachelor of (?:engineering|technology)/i, 'B.Tech/BE'], [/\bb\.?\s?sc\b/i, 'B.Sc'], [/\bbca\b/i, 'BCA'],
  [/\bb\.?\s?com\b/i, 'B.Com'], [/\bb\.?\s?a\b(?=[\s,.])|bachelor of arts/i, 'BA'], [/\bdiploma\b/i, 'Diploma'], [/\biti\b/i, 'ITI'],
  [/\b(?:12th|xii|intermediate|hsc|\+2)\b/i, '12th'], [/\b(?:10th|matric|ssc)\b/i, '10th']];
const DISCIPLINES_ = ['Mechanical', 'Electrical', 'Electronics', 'Instrumentation', 'Metallurgy', 'Metallurgical', 'Civil', 'Chemical', 'Production',
  'Computer Science', 'Information Technology', 'Automobile', 'Fitter', 'Electrician', 'Welder', 'Turner', 'Machinist', 'HR', 'Finance', 'Marketing',
  'Operations', 'Physics', 'Chemistry', 'Commerce', 'Accounts'];

function titleCase_(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).replace(/\s+/g, ' ').trim(); }
function labelled_(text, labels) {
  const re = new RegExp('(?:^|\\n)\\s*(?:' + labels + ')\\s*[:\\-\\u2013]\\s*([^\\n]{1,120})', 'i');
  const m = text.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Parses CV text into candidate fields. Each field comes back with a confidence: 'found' or 'check'. */
/**
 * OCR commonly confuses digits with look-alike letters. Only where digits are expected: number-like runs on
 * mobile/phone lines (O->0, l/I/|->1, S->5, B->8) and letters touching a digit in an email's name part.
 */
function fixOcrDigits_(t) {
  const fixRun = function (r) { return r.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5').replace(/B/g, '8'); };
  t = t.split('\n').map(function (line) {
    if (!/mob|phone|ph\.|ph:|contact|tel|cell|\+91/i.test(line)) return line;
    return line.replace(/[+0-9OolISB][0-9OolISB\s\-.()]{8,}[0-9OolISB]/g, function (run) { return (run.match(/\d/g) || []).length >= 6 ? fixRun(run) : run; });
  }).join('\n');
  return t.replace(/[A-Za-z0-9._%+-]+(?=\s*@)/g, function (local) {
    return local.replace(/(\d)[lI|]|[lI|](?=\d)/g, function (m, d) { return d ? d + '1' : '1'; }).replace(/(\d)[Oo]|[Oo](?=\d)/g, function (m, d) { return d ? d + '0' : '0'; });
  });
}

function parseCvText_(raw, opts) {
  let text = String(raw || '').replace(/\r/g, '').replace(/[\u00a0\t]+/g, ' ').replace(/\n\s*\n+/g, '\n').slice(0, 40000);
  if (opts && opts.ocr) text = fixOcrDigits_(text);
  const lines = text.split('\n').map(function (l) { return l.trim(); }).filter(String);
  const f = {}, conf = {};
  const set = function (k, v, c) { if (v !== '' && v != null && f[k] == null) { f[k] = v; conf[k] = c || 'found'; } };
  // Email and mobile
  // Email: tolerate "name @ gmail . com", "name[at]gmail[dot]com", and an address glued to the next word ("gmail.comLinkedIn").
  const et = text.replace(/\s*(?:\[at\]|\(at\)|\{at\})\s*/gi, '@').replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, '.').replace(/\s*@\s*/g, '@')
    .replace(/(@[A-Za-z0-9-]+)\s*\.\s*(?=[A-Za-z]{2,})/g, '$1.').replace(/\s+\.\s+/g, '.');
  const em = et.match(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*?\.(?:com|in|org|net|edu|info|biz|io|co|us|uk)(?![a-z0-9.])/i)
    || et.match(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*?\.(?:com|in|org|net|edu|info|biz|io)/i)
    || et.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (em) set('Email', em[0].toLowerCase());
  // Mobile: any run of 10-13 digits with up to two separators between digits (98350 12345, 983-501-2345, +91 (983) 501 2345, 9 8 3 5 ...).
  const phones = text.match(/\+?\d(?:[\s\-.()]{0,2}\d){9,12}/g) || [];
  for (let i = 0; i < phones.length; i++) {
    if (/^0\d{2,4}[\s\-.]/.test(phones[i].trim())) continue; // landline: 0 + STD code + separator (06553-222111)
    const p = normPhone_(phones[i]); if (p.length === 10 && /^[6-9]/.test(p)) { set('Mobile', p); break; }
  }
  // Name: a labelled "Name:" line, else the best early line that looks like a person's name (not a job title),
  // preferring one whose words appear in the email address or in "My name is ...". OCR text may hold several
  // passes separated by a form feed; the top lines of each pass count as "early".
  const nl = labelled_(text, 'name|candidate name|full name');
  if (nl && /^[A-Za-z .]{3,60}$/.test(nl)) set('Name', titleCase_(nl.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '')));
  else {
    const n = pickName_(String(raw || ''), f.Email);
    if (n) set('Name', n.name, n.sure ? 'found' : 'check');
  }
  // Experience
  const ex = text.match(/(?:total\s+)?(?:work(?:ing)?\s+)?experience\s*[:\-\u2013]?\s*(?:of\s+)?(?:about\s+|over\s+|more than\s+)?(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:year\(s\)|years?|yrs?|y\b)(?:[\s,&]*(\d{1,2})\s*(?:month\(s\)|months?|mths?|m\b))?/i)
    || text.match(/(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:year\(s\)|years?|yrs?)(?:[\s,&]*(\d{1,2})\s*(?:month\(s\)|months?|mths?))?\s+(?:of\s+)?(?:\w+\s+){0,3}?experience/i);
  if (ex) { const y = Number(ex[1]) + (ex[2] ? Math.round(Number(ex[2]) / 12 * 10) / 10 : 0); if (y > 0 && y < 50) set('Total_Exp_Years', Math.round(y * 10) / 10, 'found'); }
  if (f.Total_Exp_Years == null) {
    // A value that starts its own line soon after the label (two-column layouts put other text in between), else inline.
    const lab = text.match(/total\s+(?:work\s+)?experience[\s\S]{0,300}?\n[^A-Za-z0-9\n]{0,3}(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:year\(s\)|years?|yrs?)(?:[\s,&]*(\d{1,2})\s*(?:month\(s\)|months?|mths?))?/i)
      || text.match(/(?:total\s+(?:work\s+)?experience|work\s+experience\s*[:\-])[\s\S]{0,160}?(\d{1,2}(?:\.\d{1,2})?)\s*\+?\s*(?:year\(s\)|years?|yrs?)(?:[\s,&]*(\d{1,2})\s*(?:month\(s\)|months?|mths?))?/i);
    if (lab) { const y = Number(lab[1]) + (lab[2] ? Math.round(Number(lab[2]) / 12 * 10) / 10 : 0); if (y > 0 && y < 50) set('Total_Exp_Years', Math.round(y * 10) / 10, 'check'); }
  }
  // Education: the highest qualification mentioned, with its discipline if close by
  for (let i = 0; i < EDU_ORDER_.length; i++) {
    const m = text.match(EDU_ORDER_[i][0]);
    if (m) {
      const around = text.slice(m.index, m.index + 90).split('\n')[0];
      const disc = DISCIPLINES_.filter(function (d) { return new RegExp('\\b' + d + '\\b', 'i').test(around); })[0];
      set('Education', EDU_ORDER_[i][1] + (disc ? ' (' + disc + ')' : ''), disc ? 'found' : 'check');
      break;
    }
  }
  // Current designation and company
  const cur = text.match(/(?:currently|presently)\s+(?:working|employed)\s+(?:as|in the (?:role|position) of)\s+(?:an?\s+)?([A-Za-z .&\/\-]{3,60}?)\s+(?:at|with|in)\s+(?:m\/s\.?\s+)?([A-Za-z0-9 .&\/\-]{3,70}?)(?:[.,\n]| since| from|$)/i);
  if (cur) { set('Current_Designation', titleCase_(cur[1])); set('Current_Company', cur[2].replace(/\s+/g, ' ').trim()); }
  if (!f.Current_Designation && f.Name) { const t = titleUnderName_(String(raw || ''), f.Name); if (t) set('Current_Designation', t, 'check'); }
  const dl = labelled_(text, 'current designation|present designation|designation|current role|position held|job title');
  if (dl) set('Current_Designation', titleCase_(dl.split(/\s{2,}| at | with |,/i)[0]), 'check');
  const cl = labelled_(text, 'current (?:company|employer|organi[sz]ation)|present (?:company|employer|organi[sz]ation)|company|employer|organi[sz]ation');
  if (cl) set('Current_Company', cl.split(/\s{2,}|,|\(/)[0].trim(), 'check');
  // Location
  const ll = labelled_(text, 'current location|present location|location|city|current city');
  if (ll) set('Current_Location', titleCase_(ll.split(/,|\(|\//)[0]), 'found');
  const lw = f.Current_Location ? null : text.match(/(?:^|\n)[^A-Za-z\n]{0,3}(?:current location|present location|location|city)\s+([A-Za-z][A-Za-z .]{2,60})/i);
  if (lw) {
    const known = CITIES_.filter(function (c) { return new RegExp('^' + c + '\\b', 'i').test(lw[1].trim()); })[0];
    set('Current_Location', known || titleCase_(lw[1].trim().split(/\s{2,}|\s(?=[a-z])/)[0]), 'check');
  }
  if (!f.Current_Location) {
    const head = lines.slice(0, 15).join(' ');
    const city = CITIES_.filter(function (c) { return new RegExp('\\b' + c + '\\b', 'i').test(head); })[0];
    if (city) set('Current_Location', city, 'check');
  }
  // CTC and notice
  const cc = labelled_(text, 'current ctc|present ctc|ctc|current salary|present salary|salary');
  if (cc && /\d/.test(cc)) set('Current_CTC', cc.slice(0, 40), 'found');
  const ec = labelled_(text, 'expected ctc|expected salary|expected package|expectation');
  if (ec && /\d/.test(ec)) set('Expected_CTC', ec.slice(0, 40), 'found');
  const np = labelled_(text, 'notice period|notice');
  if (np) {
    const t = np.toLowerCase(), n = t.match(/(\d{1,3})/);
    if (/immediate/.test(t)) set('Notice_Days', 0);
    else if (n) set('Notice_Days', /month/.test(t) ? Number(n[1]) * 30 : /week/.test(t) ? Number(n[1]) * 7 : Number(n[1]));
  }
  // Skills: a skills section, else known skill words
  const sk = text.match(/(?:key|technical|core|professional)?\s*skills?(?:\s*(?:&|and)\s*\w+)?\s*[:\-\u2013]?\s*\n?([\s\S]{10,400}?)(?:\n\s*(?:education|academic|qualification|experience|work|employment|projects?|personal|declaration|languages?|hobbies|strengths?)\b|$)/i);
  let skills = '';
  if (sk) skills = sk[1].replace(/[\u2022\u25cf\u25aa\u2023\u2043\-\*]+/g, ',').replace(/\s*\n\s*/g, ', ').replace(/\s*,\s*(,\s*)*/g, ', ').replace(/^,\s*|,\s*$/g, '').slice(0, 250);
  const known = SKILL_WORDS_.filter(function (w) { return new RegExp('(?:^|[^A-Za-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:$|[^A-Za-z])', 'i').test(text); });
  if (skills && skills.split(',').length >= 2) set('Key_Skills', skills, 'check');
  else if (known.length) set('Key_Skills', known.slice(0, 12).join(', '), 'check');
  // Function / area from designation, skills and education
  const fa = cvFunction_([f.Current_Designation, f.Key_Skills, f.Education, known.join(' ')].join(' '));
  if (fa) set('Function_Area', fa, 'check');
  if (f.Total_Exp_Years != null) f.Relevant_Experience = f.Total_Exp_Years + ' years';
  return { fields: f, confidence: conf, chars: text.length, scanned: text.replace(/\s/g, '').length < 150 };
}
const TITLE_WORDS_ = /\b(manager|executive|assistant|engineer|officer|operations?|administration|admin|director|head|hr|gm|agm|dgm|cxo|ceo|president|supervisor|foreman|chemist|analyst|consultant|lead|incharge|in-charge|trainee|technician|fitter|welder|electrician|accountant|associate|specialist|coordinator|summary|profile|education|experience|skills?|information|personal|details|resume|curriculum|vitae|objective|contact|address|languages?|declaration|career|work|key|projects?|certifications?|hobbies|strengths?|university|college|school|institute|limited|ltd|pvt|private|services|company|solutions|technologies)\b/i;
/** Cleans an OCR line: drops leading/trailing junk tokens (symbols, single letters) around a run of real words. */
function cleanNameLine_(l) {
  const w = String(l || '').replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').split(/\s+/);
  while (w.length && !/^[A-Za-z][A-Za-z.']+$/.test(w[0])) w.shift();
  while (w.length && !/^[A-Za-z][A-Za-z.']+$/.test(w[w.length - 1])) w.pop();
  return w.join(' ');
}
/** Picks the most likely person's name from the top of each OCR pass (or of the text). */
function pickName_(raw, email) {
  const blocks = String(raw).replace(/\r/g, '').split('\f');
  const local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
  const said = (String(raw).match(/my name is\s+([A-Za-z]{3,})/i) || [])[1];
  const bad = /resume|curriculum|vitae|\bcv\b|@|\d{3}/i;
  let best = null;
  blocks.forEach(function (b) {
    const lines = b.split('\n').map(function (l) { return l.trim(); }).filter(String);
    lines.forEach(function (line, i) {
      const part = cleanNameLine_(line.split(/\s*[|\u2022\u2013\u00b7]\s*|\s{3,}/)[0]);
      if (!part || bad.test(part)) return;
      // OCR can merge a neighbouring heading onto the name line, so try every run of 2-4 words.
      const all = part.split(/\s+/), spans = [];
      if (all.length <= 8) for (let a = 0; a < all.length; a++) for (let z = a + 2; z <= Math.min(all.length, a + 4); z++) spans.push(all.slice(a, z));
      spans.forEach(function (w) {
        const l = w.join(' ');
        if (l.length > 40 || !/^[A-Za-z .']+$/.test(l) || TITLE_WORDS_.test(l)) return;
        if (w.some(function (x) { return x.replace(/\./g, '').length < 2; }) && w.length < 3) return;
        const inMail = local ? w.filter(function (x) { return x.length >= 3 && local.indexOf(x.toLowerCase()) >= 0; }).length : 0;
        const early = i < 12;
        if (!early && !inMail) return;
        const extra = local ? w.length - inMail : 0;
        const whole = w.length === all.length ? 0.5 : 0;
        const score = 3 * inMail - (inMail ? extra : 0) + (said && w.some(function (x) { return x.toLowerCase() === said.toLowerCase(); }) ? 2 : 0) + (early ? 1 : 0) + whole - i / 100;
        if (!best || score > best.score) best = { name: titleCase_(l), score: score, sure: inMail >= 2 };
      });
    });
  });
  return best;
}
/** The job title printed under the name (one to three short lines), if it looks like a title. */
function titleUnderName_(raw, name) {
  const lines = String(raw).replace(/\r/g, '').split(/\n|\f/).map(function (l) { return l.trim(); });
  const key = String(name).toLowerCase();
  const i = lines.findIndex(function (l) { return l.toLowerCase().indexOf(key) >= 0 && l.length < key.length + 12; });
  if (i < 0) return '';
  const out = [];
  for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
    const l = lines[j].replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z&)]+$/, '');
    if (!l || /^(profile|summary|objective|contact|personal|education|experience|skills?|about)\b/i.test(l) || /@|\d{5}/.test(l)) break;
    if ((l.match(/[A-Za-z]/g) || []).length < l.length * 0.6) break;
    out.push(l);
    if (!/[&,]$|\band$/i.test(l)) { if (out.join(' ').length > 25) break; }
  }
  const t = out.join(' ').replace(/\s+/g, ' ').trim();
  return /\b(manager|executive|assistant|engineer|officer|director|head|hr|gm|agm|dgm|supervisor|foreman|chemist|analyst|consultant|lead|incharge|in-charge|trainee|technician|accountant|specialist|coordinator|president)\b/i.test(t) && t.length <= 90 ? t : '';
}

function cvFunction_(s) {
  const t = String(s || '').toLowerCase();
  const map = [[/instrument|plc|scada|dcs|automation|calibration/, 'Instrumentation & Automation'], [/electric|substation|switchgear|transformer|\bht\b|\blt\b|electrician/, 'Electrical Maintenance'],
    [/mechanical|fitter|hydraulic|pneumatic|gearbox|crane|welding|welder|machin|turner/, 'Mechanical Maintenance'], [/quality|\bqc\b|\bqa\b|laborator|chemist|spectro|ndt/, 'Quality / Laboratory'],
    [/safety|nebosh|iosh|fire/, 'Safety'], [/store|purchase|procurement|inventory|\bscm\b|supply chain/, 'Stores / Purchase / SCM'], [/logistic|dispatch|transport/, 'Logistics'],
    [/\bhr\b|human resource|recruit|payroll|labour|personnel/, 'HR & Admin'], [/account|finance|tally|gst|\btds\b|audit/, 'Finance & Accounts'],
    [/software|python|sql|network|\bit\b|information technology/, 'IT'], [/sales|marketing|business development|export/, 'Sales & Marketing'],
    [/legal|corporate affairs|liaison/, 'Corporate Affairs / Legal'], [/pharmac|compounder|medical|nurs/, 'Medical (OHC)'], [/security|guard/, 'Security'],
    [/production|operation|furnace|melting|casting|foundry|rolling|shift in.?charge|plant operation/, 'Production / Operations']];
  for (let i = 0; i < map.length; i++) if (map[i][0].test(t)) return map[i][1];
  return '';
}

/** Parse CV text sent by the browser and check for duplicates (active and archived) before anything is saved. */
function apiParseCv(text, fileName, opts) {
  currentUser_(); ensureSchema_();
  const p = parseCvText_(text, opts || {});
  const dups = [];
  const mob = p.fields.Mobile, mail = p.fields.Email;
  if (mob || mail) {
    readTable_(T.CAND.name).rows.forEach(function (r) {
      if ((mob && normPhone_(r.Mobile) === mob) || (mail && String(r.Email).toLowerCase() === mail)) dups.push({ id: r.Candidate_ID, name: String(r.Name), position: String(r.Position || ''), hr: String(r.HR_Result || '') });
    });
    archiveIndex_().forEach(function (a) {
      if ((mob && a.mobile === mob) || (mail && a.email === mail)) dups.push({ id: a.id, name: a.name, position: a.position, hr: a.hr, archived: true, last: a.last });
    });
  }
  p.duplicates = dups;
  p.fileName = String(fileName || '');
  return p;
}

/** Records parsed vs saved values for one candidate, for the pilot accuracy report. */
function logParse_(candidateId, parsed, saved, fileName, chars, u) {
  try {
    parseSchema_();
    const t = readTable_(PARSE_LOG_, true);
    const n = t.rows.length + 1;
    const row = { Log_ID: 'PL-' + String(n).padStart(5, '0'), Candidate_ID: candidateId, File_Name: String(fileName || '').slice(0, 150),
      Parsed_JSON: JSON.stringify(parsed || {}).slice(0, 5000), Saved_JSON: JSON.stringify(saved || {}).slice(0, 5000), Chars: Number(chars) || 0, By: u.email, At: new Date() };
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return row[h] === undefined ? '' : row[h]; })]);
    dropStale_(PARSE_LOG_);
  } catch (e) { }
}

/** Pilot accuracy: for each field, how often the parsed value was kept, corrected, or missed. */
function apiParseAccuracy() {
  currentUser_(); ensureSchema_();
  const norm = function (k, v) {
    if (v == null) return '';
    if (k === 'Mobile') return normPhone_(v);
    if (k === 'Total_Exp_Years' || k === 'Notice_Days') return v === '' ? '' : String(Number(v));
    return String(v).toLowerCase().replace(/\s+/g, ' ').trim();
  };
  const stats = {}; PARSE_FIELDS_.forEach(function (k) { stats[k] = { kept: 0, corrected: 0, missed: 0, blank: 0 }; });
  let cvs = 0;
  (ss_().getSheetByName(PARSE_LOG_) ? readTable_(PARSE_LOG_).rows : []).forEach(function (r) {
    let p = {}, s = {};
    try { p = JSON.parse(r.Parsed_JSON || '{}'); s = JSON.parse(r.Saved_JSON || '{}'); } catch (e) { return; }
    cvs++;
    PARSE_FIELDS_.forEach(function (k) {
      const a = norm(k, p[k]), b = norm(k, s[k]), st = stats[k];
      if (!a && !b) st.blank++; else if (!a && b) st.missed++; else if (a === b) st.kept++; else st.corrected++;
    });
  });
  return { cvs: cvs, fields: PARSE_FIELDS_.map(function (k) {
    const st = stats[k], relevant = st.kept + st.corrected + st.missed;
    return { field: k, kept: st.kept, corrected: st.corrected, missed: st.missed, accuracy: relevant ? Math.round(100 * st.kept / relevant) : null };
  }) };
}
