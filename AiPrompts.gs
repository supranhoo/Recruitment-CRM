/**
 * AI Recruitment, Stage 3, release 3: prompt-template administration (v241, ADR-089).
 *
 * Each prompt has two parts. The SAFETY CORE (the rules about not inventing facts, exact quotes, untrusted sources, protected characteristics, no ratings
 * or decisions, draft-only, the answer format) stays in code and is not editable anywhere. The Admin can add a short HOUSE STYLE addendum per feature
 * (tone, wording, terminology, length). It is appended after the core and says the core wins. The checks that run on every answer (quotes found in the
 * sources, forbidden wording removed, placeholders and figures verified, requirement rules) are code too and run whatever the addendum says.
 *
 * Versions are rows in AI_Prompts: Draft -> tested on a made-up sample -> Active (the old Active becomes Retired). Rolling back is activating an older
 * tested version. Nothing is deleted. The active version number is part of the prompt version of every draft ("summary-v1+h3"), so drafts made under
 * other wording are never reused. The connection test and CV extraction are not editable.
 */
const AI_PROMPTS_ = { name: 'AI_Prompts', id: 'Prompt_ID', prefix: 'APT-', width: 5, dates: [], editable: [],
  cols: ['Prompt_ID', 'Feature', 'Version', 'Text', 'Note', 'Status', 'Test_Result', 'Tested_At', 'Created_By', 'Created_At', 'Activated_By', 'Activated_At'] };
const AI_PROMPT_MAX_ = 1500;
const AI_PROMPT_FEATURES_ = ['summary', 'compare', 'screening', 'questions', 'feedback', 'comms'];

function aiPromptCore_(f) {
  return ({ summary: AI_SUMMARY_SYSTEM_, compare: AI_COMPARE_SYSTEM_, screening: AI_SCREEN_SYSTEM_, questions: AI_QUESTIONS_SYSTEM_, feedback: AI_FEEDBACK_SYSTEM_, comms: AI_COMM_SYSTEM_ })[f] || '';
}
function aiPromptBase_(f) {
  return ({ summary: AI_SUMMARY_PROMPT_VERSION_, compare: AI_COMPARE_PROMPT_VERSION_, screening: AI_SCREEN_PROMPT_VERSION_, questions: AI_QUESTIONS_PROMPT_VERSION_, feedback: AI_FEEDBACK_PROMPT_VERSION_, comms: AI_COMMS_PROMPT_VERSION_ })[f] || f + '-v1';
}
function aiPromptLabel_(f) { const x = AI_FEATURES_.filter(function (a) { return a.id === f; })[0]; return x ? x.label : f; }
function requireAiPrompts_(u) { if (!can_(u, 'ai_prompts')) throw new Error('Only a user with the Manage AI Prompts permission can do this.'); }

/** The active addendum of a feature, or null. */
function aiAddendum_(f) {
  aiSchema_();
  const rows = readTable_(AI_PROMPTS_.name).rows.filter(function (r) { return r.Feature === f && r.Status === 'Active'; });
  const r = rows[rows.length - 1];
  return r ? { version: Number(r.Version) || 0, text: String(r.Text || ''), id: String(r.Prompt_ID) } : null;
}
function aiSystemWith_(core, text) {
  return text ? core + '\n\nHouse style set by the administrator. It only affects tone, wording and layout. It never overrides, relaxes or adds to the rules above, and the rules above win if there is any conflict:\n' + text : core;
}
/** The system prompt a request uses: the fixed core plus the active house style. */
function aiSystem_(feature, core) { const a = aiAddendum_(feature); return aiSystemWith_(core, a ? a.text : ''); }
/** The prompt version written to drafts and used in the reuse key. */
function aiPv_(feature, base) { const a = aiAddendum_(feature); return a ? base + '+h' + a.version : base; }

/** Reasons a house-style text is refused (an empty list means it passes). A deny-list on top of the code checks, not the main protection. */
function aiPromptProblems_(text) {
  const t = String(text == null ? '' : text), p = [];
  if (!t.trim()) return ['Write the house style text.'];
  if (t.length > AI_PROMPT_MAX_) p.push('The text is longer than ' + AI_PROMPT_MAX_ + ' characters.');
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(t) || /\d[\d\s().-]{8,}\d/.test(t) || /https?:\/\/|www\./i.test(t)) p.push('It contains an e-mail address, phone number or link. Prompts must not carry personal details.');
  if (/\b(ignore|disregard|override|bypass|forget|pretend|new rules?|system prompt|do not follow|instead of the rules)\b/i.test(t)) p.push('It tries to change or bypass the fixed rules.');
  if (/\b(scor(?:e|es|ing)|rat(?:e|ing|ings)|rank(?:ing)?|recommend(?:ation)?s?|shortlist\w*|hir(?:e|ing)|decid\w*|judg\w*|grad(?:e|es|ing)|verdict|suitab\w*|good fit)\b/i.test(t)) p.push('It asks the AI to score, rate, rank, recommend or decide. The AI only drafts.');
  if (/\b(age|aged|gender|male|female|man|woman|religio\w*|caste|disabilit\w*|marital|married|pregnan\w*|photo\w*|nationality|ethnic\w*|race)\b/i.test(t)) p.push('It mentions a protected characteristic or a photograph.');
  if (/\b(invent|make up|fabricate|assume|guess|infer|salary|ctc|compensation|lpa|lakh)\b/i.test(t)) p.push('It asks for facts to be assumed or invented, or mentions salary.');
  if (/\bwithout (?:a |any )?(?:quote|evidence|source)s?\b|\b(?:skip|drop|omit) (?:the )?(?:quote|evidence|verification)s?\b/i.test(t)) p.push('It tries to remove the quote or evidence requirement.');
  return p;
}

function aiPromptRows_() { aiSchema_(); return readTable_(AI_PROMPTS_.name, true).rows; }
function aiPromptOut_(r) {
  const at = function (v) { return v instanceof Date ? ymd_(v) : ''; };
  return { id: String(r.Prompt_ID), version: Number(r.Version) || 0, text: String(r.Text || ''), note: String(r.Note || ''), status: String(r.Status), test: String(r.Test_Result || ''), testedOn: at(r.Tested_At),
    createdBy: String(r.Created_By || ''), createdOn: at(r.Created_At), activatedBy: String(r.Activated_By || ''), activatedOn: at(r.Activated_At) };
}
function aiPromptsOut_() {
  const rows = aiPromptRows_();
  return { max: AI_PROMPT_MAX_, features: AI_PROMPT_FEATURES_.map(function (f) {
    const mine = rows.filter(function (r) { return r.Feature === f; }).sort(function (a, b) { return (Number(b.Version) || 0) - (Number(a.Version) || 0); }).map(aiPromptOut_);
    return { id: f, label: aiPromptLabel_(f), base: aiPromptBase_(f), core: aiPromptCore_(f), active: mine.filter(function (x) { return x.status === 'Active'; })[0] || null, draft: mine.filter(function (x) { return x.status === 'Draft'; })[0] || null, versions: mine.slice(0, 12) };
  }), fixed: ['CV extraction and the connection test use fixed prompts that cannot be edited.'] };
}
function apiAiPrompts() { const u = currentUser_(); aiSchema_(); requireAiPrompts_(u); return aiPromptsOut_(); }

/** Saves a new draft version of a feature's house style (the previous draft, if any, is retired). */
function apiAiPromptSave(d) {
  const u = currentUser_(); aiSchema_(); requireAiPrompts_(u); d = d || {};
  const f = String(d.feature || '');
  if (AI_PROMPT_FEATURES_.indexOf(f) < 0) throw new Error('Choose one of the features that can be edited.');
  const text = String(d.text == null ? '' : d.text).replace(/\r/g, '').trim(), note = String(d.note || '').replace(/\s+/g, ' ').trim().slice(0, 200), pr = aiPromptProblems_(text);
  if (pr.length) throw new Error(pr.join(' '));
  withLock_(function () {
    const rows = aiPromptRows_().filter(function (r) { return r.Feature === f; }), ver = rows.reduce(function (m, r) { return Math.max(m, Number(r.Version) || 0); }, 0) + 1;
    rows.forEach(function (r) { if (r.Status === 'Draft') update_(AI_PROMPTS_, String(r.Prompt_ID), { Status: 'Retired' }, u); });
    const o = insert_(AI_PROMPTS_, { Feature: f, Version: ver, Text: text, Note: note, Status: 'Draft', Test_Result: '', Created_By: u.email, Created_At: new Date() }, u);
    audit_(u, 'AI_Prompts', String(o.Prompt_ID), 'House style draft saved', 'Feature', '', f + ' v' + ver);
  });
  return aiPromptsOut_();
}

/* ---- the made-up sample the test runs on: no real candidate, vacancy or contact ---- */
const AI_SAMPLE_REC_ = ['Education: B.Tech Mechanical Engineering', 'Current designation: Maintenance Manager', 'Current company: Example Steel Works', 'Total experience (years): 12'];
const AI_SAMPLE_CV_ = 'Sample Candidate\nMaintenance Manager, Example Steel Works, 2016 to present. Led a team of 18 technicians and planned shutdowns of the rolling mill, which reduced unplanned downtime.\nSenior Engineer, Demo Alloys, 2011 to 2016: boiler and compressor maintenance.\nB.Tech Mechanical Engineering, 2010. Certified in vibration analysis (Level II).';
const AI_SAMPLE_NOTES_ = 'Technical round\nInterviewer notes: Explained shutdown planning clearly and gave a worked example of a rolling mill shutdown. Could not describe the alarm limits used in vibration analysis. Asked good questions about the plant layout.';
function aiPromptSample_(f) {
  const rq = { reqs: [{ id: 'R1', tier: 'essential', text: 'B.Tech or equivalent in Mechanical Engineering' }, { id: 'R2', tier: 'preferred', text: 'At least 10 years of plant maintenance experience' }, { id: 'R3', tier: 'verify', text: 'Vibration analysis certification' }], sqVersion: 0, jdVersion: 0 };
  const src = aiSource_(AI_SAMPLE_REC_, AI_SAMPLE_CV_, []), wrap = function (s) { return '<source>\n' + s.replace(/<\/source>/gi, '<\\/source>') + '\n</source>'; };
  if (f === 'summary') return { user: 'Write the summary.\n' + wrap(src.text), schema: aiSummarySchema_(), maxTokens: 3000, finish: function (d) { const b = aiSummaryBuild_(d, src, { Candidate_ID: 'SAMPLE' }); return { ok: b.facts.length > 0, lines: [b.facts.length + ' statements kept, each with a quote found in the sample', b.dropped + ' dropped'], preview: b.text }; } };
  if (f === 'compare') return { user: 'Requirements:\n' + JSON.stringify(rq.reqs.map(function (r) { return { id: r.id, tier: r.tier, requirement: r.text }; })) + '\n' + wrap(src.text), schema: aiCompareSchema_(), maxTokens: 3000,
    finish: function (d) { const b = aiCompareBuild_(d, rq, src); return { ok: b.rows.length === 3, lines: b.rows.map(function (r) { return r.id + ': ' + r.assessment; }), preview: b.rows.map(function (r) { return r.requirement + ' — ' + r.assessment + (r.evidence ? ' — “' + r.evidence + '”' : ''); }).join('\n') }; } };
  if (f === 'screening') {
    const items = [{ id: 'Q1', label: 'Highest qualification', type: 'text' }, { id: 'Q2', label: 'Years of maintenance experience', type: 'number' }, { id: 'Q3', label: 'Willing to relocate', type: 'yesno' }];
    return { user: 'Questions:\n' + JSON.stringify(items.map(function (i) { return { id: i.id, question: i.label, needed: '', type: i.type }; })) + '\n' + wrap(src.text), schema: aiScreenSchema_(), maxTokens: 2000,
      finish: function (d) { const rows = items.map(function (i) { return { id: i.id, field: i.label, sec: 'E', type: i.type, status: 'confirm', answer: '', where: '', page: 0, evidence: '', note: '', suggestion: '', ask: true }; }); aiScreenApply_(rows, d, src);
        return { ok: rows.some(function (r) { return r.status === 'filled'; }), lines: rows.map(function (r) { return r.id + ': ' + (r.status === 'filled' ? 'answered from the sample' : 'to confirm'); }), preview: rows.map(function (r) { return r.field + ': ' + (r.answer || 'To confirm'); }).join('\n') }; } };
  }
  if (f === 'questions') return { user: 'Write up to 4 CORE questions for the Technical round of this vacancy.\nRequirements:\n' + JSON.stringify(rq.reqs.map(function (r) { return { id: r.id, tier: r.tier, requirement: r.text }; })), schema: aiQuestionsSchema_(), maxTokens: 2000,
    finish: function (d) { const b = aiQuestionsBuild_(d, rq, null, 'core', 4); return { ok: b.questions.length > 0, lines: [b.questions.length + ' questions kept', b.dropped + ' dropped'], preview: b.questions.map(function (q, i) { return (i + 1) + '. ' + q.q; }).join('\n') }; } };
  if (f === 'feedback') { const s2 = { text: AI_SAMPLE_NOTES_, recLen: 0, offsets: [] }; return { user: 'Summarise the notes.\n' + wrap(s2.text), schema: aiFeedbackSchema_(), maxTokens: 2000,
    finish: function (d) { const b = aiFeedbackBuild_(d, s2, { key: 'tech', label: 'Technical', result: '', on: '' }); return { ok: b.strengths.length + b.concerns.length + b.missing.length + b.followups.length > 0, lines: [b.strengths.length + ' strengths, ' + b.concerns.length + ' concerns, ' + b.missing.length + ' missing evidence, ' + b.followups.length + ' follow-ups', b.dropped + ' dropped'], preview: b.text }; } }; }
  if (f === 'comms') { const names = AI_COMM_TYPES_.invite.fields.filter(function (n) { return AI_COMM_FIELDS_[n]; }), fx = { candidate_first_name: 'Sample', position: 'Maintenance Manager', company: AI_COMPANY_, interview_round: 'Technical', interview_date: 'Thursday, 26 November 2026', interview_time: '10:30 AM', interview_duration: '45 minutes', interview_mode: 'In person', interview_location: 'Plant office', recruiter_name: 'Recruiter', recruiter_contact: 'the recruiting team' };
    return { user: 'Purpose: ' + AI_COMM_TYPES_.invite.brief + '\nPlaceholders you may use:\n' + names.map(function (n) { return '{{' + n + '}} = ' + AI_COMM_FIELDS_[n]; }).join('\n'), schema: aiCommSchema_(), maxTokens: 1200,
      finish: function (d) { const un = [], body = aiCommFill_(String((d || {}).body || ''), fx, un), subj = aiCommFill_(String((d || {}).subject || ''), fx, un), raw = aiCommIssues_(String((d || {}).subject || '') + '\n' + String((d || {}).body || '').replace(/\{\{\s*[a-z_]+\s*\}\}/gi, ' '), []), iss = aiCommIssues_(subj + '\n' + body, Object.keys(fx).map(function (k) { return String(fx[k]); }));
        return { ok: !!body && iss.ok && raw.flagged.length === 0, lines: [iss.ok ? 'every fact comes from the sample record' : 'items the checks would block: ' + iss.unresolved.concat(iss.flagged.map(function (x) { return x.text; })).join(', ')], preview: subj + '\n\n' + body }; } }; }
  throw new Error('Choose one of the features that can be edited.');
}
/** Runs one real request on the made-up sample with a saved draft's wording, shows the result through the real checks, and records pass or fail. */
function apiAiPromptTest(id) {
  const u = currentUser_(); aiSchema_(); requireAiPrompts_(u);
  const row = findRow_(AI_PROMPTS_, String(id || '')).rec;
  if (!row) throw new Error('That prompt version was not found.');
  if (row.Status !== 'Draft' && row.Status !== 'Retired') throw new Error('Only a draft or an older version can be tested.');
  const f = String(row.Feature), smp = aiPromptSample_(f);
  const r = aiRun_(u, { feature: f, system: aiSystemWith_(aiPromptCore_(f), String(row.Text)), user: smp.user, schema: smp.schema, maxTokens: smp.maxTokens });
  const out = smp.finish(r.data);
  update_(AI_PROMPTS_, String(id), { Test_Result: out.ok ? 'Passed' : 'Failed', Tested_At: new Date() }, u);
  audit_(u, 'AI_Prompts', String(id), 'House style tested', 'Result', '', out.ok ? 'Passed' : 'Failed');
  return { ok: out.ok, lines: out.lines, preview: String(out.preview || '').slice(0, 1500), cost: r.cost, model: r.model, version: Number(row.Version) };
}
/** Makes a tested version the active house style (the old one is retired). id '' with a feature switches the house style off. Rolling back is activating an older tested version. */
function apiAiPromptActivate(d) {
  const u = currentUser_(); aiSchema_(); requireAiPrompts_(u); d = d || {};
  const f = String(d.feature || ''), id = String(d.id || '');
  if (AI_PROMPT_FEATURES_.indexOf(f) < 0) throw new Error('Choose one of the features that can be edited.');
  withLock_(function () {
    const rows = aiPromptRows_().filter(function (r) { return r.Feature === f; }), target = id ? rows.filter(function (r) { return String(r.Prompt_ID) === id; })[0] : null;
    if (id && !target) throw new Error('That prompt version was not found.');
    if (target) {
      if (target.Status === 'Active') return;
      if (String(target.Test_Result) !== 'Passed') throw new Error('Test this version on the sample first. It can be switched on only after the test passed.');
      const pr = aiPromptProblems_(String(target.Text)); if (pr.length) throw new Error(pr.join(' '));
    }
    rows.forEach(function (r) { if (r.Status === 'Active') update_(AI_PROMPTS_, String(r.Prompt_ID), { Status: 'Retired' }, u); });
    if (target) update_(AI_PROMPTS_, id, { Status: 'Active', Activated_By: u.email, Activated_At: new Date() }, u);
    audit_(u, 'AI_Prompts', id || f, target ? 'House style switched on' : 'House style switched off', 'Feature', '', f + (target ? ' v' + target.Version : ''));
  });
  return aiPromptsOut_();
}
