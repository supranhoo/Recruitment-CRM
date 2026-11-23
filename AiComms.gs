/**
 * AI communication drafts (ADR-089, v238). The AI writes the WORDING only. Every fact (name, position, date, time, place, contact) is put in by code from the
 * record through placeholders, so the model never sees the candidate's name or contact and cannot invent a schedule, a salary or an offer. A placeholder with no
 * verified value stays visibly marked "[to confirm: ...]", and a figure, date, salary word or commitment that is not one of the verified facts is flagged; the page
 * keeps Copy / Open in Outlook / Save as .eml disabled until none is left. Nothing is sent by the app: the person sends from their own mail.
 * A selection or rejection message can only be drafted after a person has recorded that decision on the card.
 */
const AI_COMMS_PROMPT_VERSION_ = 'comms-v1';
const AI_COMPANY_ = 'BFCL';
const AI_COMM_FIELDS_ = {
  candidate_first_name: 'the candidate\'s first name', position: 'the position', mrf_no: 'the MRF number', company: 'the company', recruiter_name: 'the recruiter\'s name', recruiter_contact: 'the recruiter\'s e-mail',
  interview_round: 'the interview round', interview_date: 'the interview date', interview_time: 'the interview time', interview_mode: 'how the interview is held', interview_location: 'where the interview is held (or the meeting link)', interview_duration: 'how long it lasts',
  missing_list: 'a bulleted list of the details still needed'
};
const AI_COMM_TYPES_ = {
  invite: { label: 'Interview invitation', fields: ['candidate_first_name', 'position', 'mrf_no', 'company', 'interview_round', 'interview_date', 'interview_time', 'interview_duration', 'interview_mode', 'interview_location', 'recruiter_name', 'recruiter_contact'],
    brief: 'Invite the candidate to the interview. State the round, date, time, mode and place using the placeholders, and ask them to reply to confirm they can attend.' },
  missing: { label: 'Request for missing information', fields: ['candidate_first_name', 'position', 'company', 'missing_list', 'recruiter_name', 'recruiter_contact'],
    brief: 'Politely ask the candidate to send the details listed in {{missing_list}} so that their application can move forward. Do not ask for or mention any salary figure.' },
  followup: { label: 'Interview follow-up', fields: ['candidate_first_name', 'position', 'company', 'interview_round', 'interview_date', 'recruiter_name', 'recruiter_contact'],
    brief: 'Thank the candidate for attending the interview and say the team will be in touch. Give no outcome, no feedback on performance and no timeline.' },
  rejection: { label: 'Rejection message', fields: ['candidate_first_name', 'position', 'company', 'recruiter_name', 'recruiter_contact'],
    brief: 'Tell the candidate, respectfully and briefly, that they will not be taken forward for the position. Give no reasons and no feedback on performance, make no promise about future roles, and thank them for their time.' },
  selection: { label: 'Selection message', fields: ['candidate_first_name', 'position', 'company', 'recruiter_name', 'recruiter_contact'],
    brief: 'Tell the candidate warmly and briefly that they have been selected to move forward for the position, and that the recruiting team will share the details separately. State no salary, joining date or other terms.' }
};
const AI_COMM_SYSTEM_ = [
  'You write the wording of one short, professional e-mail to a job candidate, for a recruiter to review and send themselves.',
  'You are given the purpose and a list of placeholders. Write the subject and the body as plain text. Refer to every fact only through its placeholder in double curly braces, for example {{interview_date}}. Do not write any name, date, time, number, place, salary, offer term or promise yourself.',
  'Rules:',
  '1. Use only placeholders from the list. Start with "Dear {{candidate_first_name}}," if that placeholder is listed, and end with the recruiter\'s name placeholders if they are listed.',
  '2. Never state or imply a salary, benefit, offer, joining date, interview schedule or employment commitment that is not given through a placeholder. Never give reasons for a decision or feedback on performance.',
  '3. Never mention age, gender, religion, caste, nationality, marital status, disability or health. Keep it under 150 words.'
].join('\n');
function aiCommSchema_() { return { type: 'object', additionalProperties: false, required: ['subject', 'body'], properties: { subject: { type: 'string' }, body: { type: 'string' } } }; }

/* ------------------------------------------------------------------ the checks, in code -------------------------- */
/** Placeholders still unresolved and figures, dates, salary words or commitments that are not one of the verified facts. Used when drafting and again after every edit. */
function aiCommIssues_(text, allowed) {
  const t = String(text == null ? '' : text).replace(/https?:\/\/\S+/gi, ' ');
  const unresolved = [], flagged = [];
  t.replace(/\[to confirm:\s*([^\]]+)\]/gi, function (m, w) { if (unresolved.indexOf(w) < 0) unresolved.push(w.trim()); return m; });
  t.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, w) { if (unresolved.indexOf(w) < 0) unresolved.push(w); return m; });
  const RE = /(?:₹|\$)?\d[\d,.:\/-]*(?:\s?(?:am|pm|lpa|lakhs?|crores?))?|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bmay\s+\d|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|₹|\brs\.?(?=\s*\d)|\b(?:salary|ctc|lpa|lakhs?|crores?|compensation|bonus|stipend)\b/gi;
  const norm = function (tok) { return tok.replace(/[.,:;\/-]+$/, '').trim().toLowerCase(); }, ok = {};
  (allowed || []).forEach(function (v) { (String(v).match(RE) || []).forEach(function (tok) { ok[norm(tok)] = true; }); });   // the figures and dates that ARE verified facts
  (t.match(RE) || []).forEach(function (tok) {
    const k = norm(tok);
    if (k && !ok[k] && !flagged.some(function (f) { return f.text.toLowerCase() === k; })) flagged.push({ kind: 'figure', text: tok.trim() });
  });
  (t.match(/\b(?:guarantee[ds]?|promise[ds]?|assure[ds]?|your (?:job|position|role) is (?:secure|confirmed)|will be (?:joining|hired))\b/gi) || []).forEach(function (tok) { flagged.push({ kind: 'commitment', text: tok }); });
  return { unresolved: unresolved, flagged: flagged, ok: !unresolved.length && !flagged.length };
}
/** Substitutes verified values; anything without one stays visibly marked. */
function aiCommFill_(text, facts, unresolved) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, w) {
    const k = String(w).toLowerCase(), v = facts[k];
    if (v !== undefined && String(v).trim() !== '') return String(v);
    const label = AI_COMM_FIELDS_[k] || k; if (unresolved.indexOf(label) < 0) unresolved.push(label);
    return '[to confirm: ' + label + ']';
  });
}

/* ------------------------------------------------------------------ the recorded decision, per application -------- */
/** A message about a decision is drafted only when a person has recorded it on THIS application. */
function aiDecisionRecorded_(app, type) {
  if (type === 'rejection') return String(app.Status) === 'Rejected';
  if (type === 'selection') return String(app.Status) === 'Active' && ['Offer', 'Prejoin', 'Joined', 'Onboarded'].indexOf(String(app.Stage)) >= 0;
  return true;
}
function aiPickInterview_(app, type, id) {
  const rows = readTable_(T.INT.name).rows.filter(function (r) { return String(r.App_ID) === String(app.App_ID) && r.Start instanceof Date; });
  if (id) return rows.filter(function (r) { return String(r.Interview_ID) === String(id); })[0] || null;
  const now = Date.now();
  if (type === 'invite') return rows.filter(function (r) { return (r.Status === 'Scheduled' || r.Status === 'Rescheduled') && r.Start.getTime() >= now - 3600000; }).sort(function (a, b) { return a.Start - b.Start; })[0] || null;
  return rows.filter(function (r) { return r.Status === 'Held' || r.Start.getTime() < now; }).sort(function (a, b) { return b.Start - a.Start; })[0] || null;
}

function apiAiDraftComm(appId, p) { return timed_('apiAiDraftComm', aiCommRun_, arguments); }
function aiCommRun_(appId, p) {
  const u = currentUser_(); aiSchema_(); p = p || {};
  if (!can_(u, 'ai_run')) throw new Error('You do not have permission to use AI actions.');
  const cfg = aiCfg_(), st = aiState_(cfg, 'comms');
  if (!st.on) throw new Error(st.reason);
  const type = String(p.type || ''), def = AI_COMM_TYPES_[type];
  if (!def) throw new Error('Choose what kind of message to draft.');
  const app = appOf_(String(appId || '')), line = requireOnPosition_(u, app.Line_ID), cand = candRow_(String(app.Candidate_ID));
  if (!cand) throw new Error('The candidate record was not found.');
  if (!aiDecisionRecorded_(app, type)) throw new Error(type === 'rejection' ? 'A rejection message can be drafted only after a person has recorded the rejection on this card (Other actions → Reject).' : 'A selection message can be drafted only after the candidate has been moved to the Offer stage on this card.');
  const iv = ['invite', 'followup'].indexOf(type) >= 0 ? aiPickInterview_(app, type, p.interviewId) : null;
  if (['invite', 'followup'].indexOf(type) >= 0 && !iv) throw new Error(type === 'invite' ? 'Book the interview first; the invitation uses the booking’s date, time and place.' : 'There is no interview on this card to follow up.');
  // verified facts, from the record
  const first = String(cand.Name || '').trim().split(/\s+/)[0] || '', fx = {}, missing = [];
  fx.candidate_first_name = first; fx.position = String(line.Position || ''); fx.mrf_no = String(line.MRF_No || ''); fx.company = AI_COMPANY_; fx.recruiter_name = String(u.name || ''); fx.recruiter_contact = mailOfLogin_(u.email);
  if (iv) {
    fx.interview_round = String(iv.Round) === 'Further' ? String(iv.Round_Label || 'Further round') : String(iv.Round) + ' interview';
    fx.interview_date = fmt_(iv.Start, TZ, 'EEEE, d MMMM yyyy'); fx.interview_time = fmt_(iv.Start, TZ, 'h:mm a') + ' IST';
    fx.interview_mode = String(iv.Mode || ''); fx.interview_location = String(iv.Location || ''); fx.interview_duration = Number(iv.Duration_Min) > 0 ? Number(iv.Duration_Min) + ' minutes' : '';
  }
  if (type === 'missing') {
    let pc = cvProfileClean_({}); const pr = profileRow_(String(cand.Candidate_ID)); if (pr) { try { pc = cvProfileClean_(JSON.parse(String(pr.Profile_JSON || '{}'))); } catch (e) { } }
    const skip = { Name: 1, Email: 1, Mobile: 1, LinkedIn: 1, Languages: 1, Certifications: 1, Achievements: 1 };
    cvDerive_(pc, cand, {}).missing.forEach(function (m) { if (!skip[m] && !/Work authorisation/.test(m)) missing.push(m); });
    if (!missing.length) throw new Error('Nothing is missing from this candidate’s record, so there is nothing to ask for.');
    fx.missing_list = missing.map(function (m) { return '- ' + m; }).join('\n');
  }
  const names = def.fields.filter(function (f) { return AI_COMM_FIELDS_[f]; });
  const model = cfg.models.comms || AI_DEFAULT_MODEL_, srcVer = model + '|' + aiPv_('comms', AI_COMMS_PROMPT_VERSION_) + '|' + type;
  const userMsg = 'Purpose: ' + def.brief + '\nPlaceholders you may use:\n' + names.map(function (n) { return '{{' + n + '}} = ' + AI_COMM_FIELDS_[n]; }).join('\n');
  const hash = aiHashHex_(userMsg + JSON.stringify(fx) + String(app.App_ID));
  let draft = null, built = null, reused = false;
  if (p.force !== true) {
    draft = readTable_(AI_DRAFTS_.name, true).rows.filter(function (r) { return r.Feature === 'comms' && r.Input_Hash === hash && r.Source_Version === srcVer && r.Status !== 'Discarded' && String(r.Created_By) === u.email; }).pop() || null;
    if (draft) { try { built = JSON.parse(String(draft.Content_JSON)); reused = true; } catch (e) { draft = null; } }
  }
  if (!draft) {
    const r = aiRun_(u, { feature: 'comms', system: aiSystem_('comms', AI_COMM_SYSTEM_), user: userMsg, schema: aiCommSchema_(), maxTokens: 1200, candId: String(cand.Candidate_ID), appId: String(app.App_ID), lineId: String(app.Line_ID), batchId: aiTag_(p.batchId, 40) });
    const rawS = String((r.data || {}).subject || ''), rawB = String((r.data || {}).body || '');
    const allowed = Object.keys(fx).map(function (k) { return String(fx[k]); }).filter(String);
    const unresolved = [], strip = function (s) { return s.replace(/\{\{\s*[a-z_]+\s*\}\}/gi, ' '); };
    const rawIssues = aiCommIssues_(strip(rawS + '\n' + rawB), []);   // figures the AI wrote itself, outside the placeholders
    ((rawS + '\n' + rawB).match(/https?:\/\/\S+/gi) || []).forEach(function (l) { rawIssues.flagged.push({ kind: 'link', text: l }); });
    const subject = aiCommFill_(rawS, fx, unresolved).replace(/\s+/g, ' ').trim().slice(0, 200), body = aiCommFill_(rawB, fx, unresolved).replace(/\r/g, '').trim().slice(0, 3000);
    built = { type: type, typeLabel: def.label, subject: subject, body: body, allowed: allowed, writtenByAi: rawIssues.flagged.map(function (f) { return { kind: f.kind, text: f.text }; }), meta: { model: r.model, interviewId: iv ? String(iv.Interview_ID) : '' } };
    const job = aiGenericJob_(u, 'comms', 'Ready', String(cand.Candidate_ID), String(app.App_ID), {}, hash, model, aiPv_('comms', AI_COMMS_PROMPT_VERSION_), r);
    draft = insert_(AI_DRAFTS_, { Job_ID: job, Feature: 'comms', Candidate_ID: String(cand.Candidate_ID), App_ID: String(app.App_ID), Line_ID: String(app.Line_ID), Source_Version: srcVer, Input_Hash: hash, Content_JSON: JSON.stringify(built), Edited_JSON: '', Status: 'Draft', Superseded: '', Created_At: new Date() }, u);
  }
  const issues = aiCommIssues_(built.subject + '\n' + built.body, built.allowed.concat([])), extra = (built.writtenByAi || []).filter(function (x) { return !issues.flagged.some(function (f) { return f.text.toLowerCase() === String(x.text).toLowerCase(); }); });
  // figures and links the AI wrote itself are flagged even when they happen to match a verified value
  extra.forEach(function (x) { issues.flagged.push({ kind: x.kind || 'figure', text: x.text }); });
  issues.ok = !issues.unresolved.length && !issues.flagged.length;
  return { draftId: String(draft.Draft_ID), reused: reused, type: type, typeLabel: def.label, subject: built.subject, body: built.body, to: String(cand.Email || ''), unresolved: issues.unresolved, flagged: issues.flagged, ok: issues.ok,
    generatedOn: draft.Created_At instanceof Date ? ymd_(draft.Created_At) : ymd_(new Date()), model: (built.meta || {}).model || model, position: String(line.Position || '') };
}
/** Re-checks the text after the person edits it. Not an AI call. Figures that match a verified fact are fine; anything else, and any unresolved placeholder, blocks. */
function apiAiCommCheck(draftId, subject, body) {
  const u = currentUser_(); aiSchema_();
  const rec = aiDraftFor_(u, draftId);
  if (rec.Feature !== 'comms') throw new Error('That draft is not a message.');
  let c = {}; try { c = JSON.parse(String(rec.Content_JSON)) || {}; } catch (e) { }
  return aiCommIssues_(String(subject || '') + '\n' + String(body || ''), c.allowed || []);
}
