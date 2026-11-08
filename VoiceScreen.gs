/**
 * Voice screening (ADR-045): an AI voice agent places a first screening call to a candidate and asks the position's
 * final screening questions. ADMIN ONLY while it is being tested (permission 'voice_agent', never grantable).
 *
 * This file holds everything on the CRM side: the settings (the API key is kept in Script Properties and is never sent
 * to a browser), the readiness check, the Do-Not-Disturb rule, the brief for the agent, the call log, and turning a call's
 * result into a DRAFT screening for the recruiter to check. It never completes a screening or moves a card.
 *
 * THE CALL (voicePlaceCall_) follows the provider's "instant outbound" request exactly as the provider's own example gives it
 * (POST /outbounds/v1/orgs/{org}/workspaces/{workspace}/outbounds). STILL NOT WRITTEN: the Do Not Disturb check
 * (voiceDndCheck_, the provider's DND list API) and the way results come back (webhook or fetch). While the Do Not Disturb
 * check is required and not written, no call is placed. "Preview the call" shows exactly what would be sent.
 */
const VOICE_CALLS_ = { name: 'Voice_Calls', id: 'Call_ID', prefix: 'VCL-', width: 5 };
const VOICE_CALL_COLS_ = ['Call_ID', 'App_ID', 'Candidate_ID', 'Line_ID', 'Phone_Last4', 'Status', 'Status_Note', 'Provider_Call_ID', 'Questions_Version',
  'Started_By', 'Started_At', 'Completed_At', 'Transcript', 'Answers_JSON', 'Draft_Applied', 'Updated_By', 'Updated_At'];
/** Added later: what the provider reported (answered, no answer, busy, failed), the length, the provider's interaction id, and the variables the agent filled in. */
const VOICE_CALL_EXTRA_ = ['Outcome', 'Duration_Sec', 'Interaction_ID', 'Final_Vars_JSON', 'Plan_JSON', 'Recording_URL', 'Cost', 'Cost_Unit', 'Suggest_Total', 'Suggest_Kept'];
/** Results arrive here from the separate webhook receiver (docs/voice-webhook). The CRM matches each row to a call; nothing outside reads this sheet. */
const VOICE_INBOX_ = { name: 'Voice_Inbox', cols: ['Received_At', 'Attempt_ID', 'Event_Key', 'Payload', 'Processed_At', 'Result'] };
/** The numbers that must never be called (opted out, added by HR, or uploaded from the national list), who may use the tool, and requests to call. */
const VOICE_DND_ = { name: 'Voice_DND', cols: ['Phone', 'Source', 'Note', 'Active', 'Added_By', 'Added_On', 'Removed_By', 'Removed_On', 'Remove_Reason'] };
const VOICE_ACCESS_ = { name: 'Voice_Access', cols: ['Email', 'Active', 'Daily_Limit', 'Reason', 'Granted_By', 'Granted_At'] };
const VOICE_REQ_ = { name: 'Voice_Requests', id: 'Req_ID', prefix: 'VRQ-', width: 5,
  cols: ['Req_ID', 'App_ID', 'Line_ID', 'Candidate_ID', 'Requested_By', 'Requested_At', 'Reason', 'Status', 'Decided_By', 'Decided_At', 'Decision_Note', 'Call_ID'] };
const VOICE_DEFAULT_LIMIT_ = 20;
const VOICE_STATUSES_ = ['Starting', 'Started', 'Completed', 'Failed', 'Blocked (Do Not Disturb)', 'Cancelled'];
const VOICE_OPEN_STATUSES_ = ['Starting', 'Started'];
const VOICE_KEY_PROP_ = 'VOICE_API_KEY';
/** Workspace ids given by the provider's console; they are identifiers, not secrets. */
const VOICE_DEFAULTS_ = { orgId: '01a11b5b-1fcf-7fc7-b673-8ebbe5e5dd0c', workspaceId: '01a11b5b-1fd6-79b4-b64a-2a0d9c3c8fef',
  agentId: 'Conversatio-85617fe5-386e', agentVersion: 1, connectionId: '14185236-97-20b5ee4b-4097', fromNumber: '+918064269699' };
const VOICE_API_BASE_ = 'https://apps.sarvam.ai/api';
/** From this agent version on, the agent has no questions of its own: it asks the numbered list the CRM sends (the call-plan desk). */
const VOICE_LISTONLY_FROM_ = 5;
/** From this agent version on, the agent also has the question_criteria variable and returns screening_ratings (suggested ratings for the descriptive answers). */
const VOICE_RATINGS_FROM_ = 6;

/** Creates the call-log sheet if it is missing. Cheap and safe to call every time (like profileSchema_), so a skipped schema step cannot break the page. */
function voiceSchema_() {
  addSheet_(VOICE_CALLS_.name, VOICE_CALL_COLS_); addColumns_(VOICE_CALLS_.name, VOICE_CALL_EXTRA_); addSheet_(VOICE_INBOX_.name, VOICE_INBOX_.cols);
  addSheet_(VOICE_DND_.name, VOICE_DND_.cols); addSheet_(VOICE_ACCESS_.name, VOICE_ACCESS_.cols); addSheet_(VOICE_REQ_.name, VOICE_REQ_.cols);
}
/** A reviewer may see a call's result and work the screening from it: the Admin, or whoever may edit that position's pipeline and holds voice_review. */
function voiceCanReview_(u, line) { return can_(u, 'voice_agent') || (can_(u, 'voice_review') && !!line && canEditLine_(u, line)); }
function requireVoiceReview_(u, line) { if (!voiceCanReview_(u, line)) throw new Error('You can see a voice result only for your own positions (a TA Lead or the Head of HR sees all).'); }
function requireVoiceAdmin_(u) { if (!can_(u, 'voice_agent')) throw new Error('Only the CRM admin can use the voice agent while it is being tested.'); }

/* ---------------------------------------------------------------- settings ---------------------------------- */

function voiceKey_() { return String(PropertiesService.getScriptProperties().getProperty(VOICE_KEY_PROP_) || ''); }
function voiceCfg_() {
  const s = settings_(), key = voiceKey_(), v = Number(s.VOICE_AGENT_VERSION);
  return { enabled: String(s.VOICE_ENABLED || 'No') === 'Yes', agentId: String(s.VOICE_AGENT_ID || VOICE_DEFAULTS_.agentId), agentVersion: v >= 1 && v <= 9999 ? Math.floor(v) : VOICE_DEFAULTS_.agentVersion,
    connectionId: String(s.VOICE_CONNECTION_ID || VOICE_DEFAULTS_.connectionId), fromNumber: String(s.VOICE_FROM_NUMBER || VOICE_DEFAULTS_.fromNumber), dndRequired: String(s.VOICE_DND_REQUIRED || 'Yes') !== 'No',
    orgId: String(s.VOICE_ORG_ID || VOICE_DEFAULTS_.orgId), workspaceId: String(s.VOICE_WORKSPACE_ID || VOICE_DEFAULTS_.workspaceId),
    ratePerMin: Math.max(0, Number(s.VOICE_RATE_PER_MIN) || 0), openingLine: String(s.VOICE_OPENING_LINE || ''), entryState: String(s.VOICE_ENTRY_STATE || ''), webhookUrl: String(s.VOICE_WEBHOOK_URL || ''), questionsVar: String(s.VOICE_QUESTIONS_VAR || ''), maxQ: Math.min(10, Math.max(1, Math.floor(Number(s.VOICE_MAX_Q)) || 6)), listOnly: (v >= 1 && v <= 9999 ? Math.floor(v) : VOICE_DEFAULTS_.agentVersion) >= VOICE_LISTONLY_FROM_, ratings: (v >= 1 && v <= 9999 ? Math.floor(v) : VOICE_DEFAULTS_.agentVersion) >= VOICE_RATINGS_FROM_,
    keySet: !!key, keyHint: key ? '\u2026' + key.slice(-4) : '' };
}
/** What still has to be filled in before a call can be placed (empty = ready). */
function voiceMissing_(c) {
  const m = [];
  if (!c.keySet) m.push('API key'); if (!c.agentId) m.push('Agent id'); if (!c.connectionId) m.push('Connection id'); if (!c.fromNumber) m.push('Calling number'); if (!c.enabled) m.push('Switch on "Allow calls"');
  return m;
}
function voiceCfgOut_(c) {
  const m = voiceMissing_(c);
  return { enabled: c.enabled, agentId: c.agentId, agentVersion: c.agentVersion, connectionId: c.connectionId, fromNumber: c.fromNumber, dndRequired: c.dndRequired, orgId: c.orgId, workspaceId: c.workspaceId,
    ratePerMin: c.ratePerMin, openingLine: c.openingLine, entryState: c.entryState, webhookUrl: c.webhookUrl, questionsVar: c.questionsVar, maxQ: c.maxQ, listOnly: c.listOnly,
    keySet: c.keySet, keyHint: c.keyHint, missing: m, ready: !m.length, connected: voiceProviderConnected_(), dndWritten: voiceDndWritten_(), resultsWritten: voiceResultsWritten_() };
}
/** The call itself is written; the Do Not Disturb check and the way results come back are not. */
function voicePlaceWritten_() { return true; }
function voiceDndWritten_() { return true; }
function voiceResultsWritten_() { return true; }
/** True when a call can be placed with the Do Not Disturb rule honoured (the check, or the Admin has switched it off). */
function voiceProviderConnected_() { return voicePlaceWritten_() && voiceDndWritten_(); }

function apiVoiceConfig() {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  try { voiceIngest_(u); } catch (e) { }
  const calls = voiceCallsRows_();
  const o = voiceCfgOut_(voiceCfg_());
  o.calls = calls.length; o.recent = calls.slice(-15).reverse().map(voiceCallOut_);
  return o;
}

function apiVoiceConfigSave(d) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  d = d || {};
  const id = function (v, label, required) {
    v = String(v == null ? '' : v).trim();
    if (!v) { if (required) throw new Error(label + ' is needed.'); return ''; }
    if (!/^[A-Za-z0-9_\-:.]{6,100}$/.test(v)) throw new Error(label + ' does not look right (letters, digits, - and _ only, 6 to 100 characters).');
    return v;
  };
  const agent = id(d.agentId, 'Agent id'), conn = id(d.connectionId, 'Connection id'), org = id(d.orgId || VOICE_DEFAULTS_.orgId, 'Organisation id'), ws = id(d.workspaceId || VOICE_DEFAULTS_.workspaceId, 'Workspace id');
  let from = String(d.fromNumber == null ? '' : d.fromNumber).replace(/[\s\-()]/g, '');
  if (from && !/^\+?\d{8,15}$/.test(from)) throw new Error('The calling number must be 8 to 15 digits, with an optional leading +.');
  const before = voiceCfg_(), changed = [], writes = [];
  const put = function (k, label, v, old) { if (String(v) !== String(old)) writes.push([k, label, v]); };   // applied only after everything is validated
  put('VOICE_AGENT_ID', 'agent id', agent, before.agentId); put('VOICE_CONNECTION_ID', 'connection id', conn, before.connectionId); put('VOICE_FROM_NUMBER', 'calling number', from, before.fromNumber);
  put('VOICE_ORG_ID', 'organisation id', org, before.orgId); put('VOICE_WORKSPACE_ID', 'workspace id', ws, before.workspaceId);
  const ver = d.agentVersion === undefined || d.agentVersion === '' ? before.agentVersion : Number(d.agentVersion);
  if (!(ver >= 1 && ver <= 9999) || ver % 1) throw new Error('The agent version must be a whole number from 1 to 9999.');
  const line = String(d.openingLine == null ? '' : d.openingLine).replace(/\s+/g, ' ').trim(), st = String(d.entryState == null ? '' : d.entryState).trim(), qv = String(d.questionsVar == null ? '' : d.questionsVar).trim();
  if (line.length > 300) throw new Error('The opening line is limited to 300 characters.');
  if (st.length > 80) throw new Error('The entry state name is limited to 80 characters.');
  if (qv && !/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(qv)) throw new Error('The questions variable name may use letters, digits and _ only, and must not start with a digit.');
  const hook = String(d.webhookUrl == null ? '' : d.webhookUrl).trim();
  if (hook && !/^https:\/\/[^\s]{6,400}$/.test(hook)) throw new Error('The webhook address must start with https:// .');
  const key = String(d.apiKey == null ? '' : d.apiKey).trim();
  if (key && (key.length < 16 || key.length > 300 || /\s/.test(key))) throw new Error('The API key does not look right. Paste it exactly as the provider shows it.');
  put('VOICE_AGENT_VERSION', 'agent version', ver, before.agentVersion); put('VOICE_OPENING_LINE', 'opening line', line, before.openingLine); put('VOICE_ENTRY_STATE', 'entry state', st, before.entryState);
  const mq = d.maxQ === undefined || d.maxQ === '' ? before.maxQ : Number(d.maxQ);
  if (!(mq >= 1 && mq <= 10) || mq % 1) throw new Error('The most role-specific questions per call must be a whole number from 1 to 10.');
  put('VOICE_MAX_Q', 'most role questions', mq, before.maxQ);
  const rate = d.ratePerMin === undefined || d.ratePerMin === '' ? 0 : Number(d.ratePerMin);
  if (!(rate >= 0 && rate <= 10000)) throw new Error('The cost per minute must be a number from 0 to 10,000 (leave 0 or blank when unknown).');
  put('VOICE_RATE_PER_MIN', 'cost per minute', rate, before.ratePerMin);
  put('VOICE_QUESTIONS_VAR', 'questions variable', qv, before.questionsVar); put('VOICE_WEBHOOK_URL', 'webhook address', hook, before.webhookUrl);
  put('VOICE_ENABLED', 'allow calls', d.enabled === true ? 'Yes' : 'No', before.enabled ? 'Yes' : 'No');
  put('VOICE_DND_REQUIRED', 'Do Not Disturb check', d.dndRequired === false ? 'No' : 'Yes', before.dndRequired ? 'Yes' : 'No');
  writes.forEach(function (w) { setSetting_(w[0], w[2], 'Voice agent (admin test)'); changed.push(w[1]); });
  if (key) { PropertiesService.getScriptProperties().setProperty(VOICE_KEY_PROP_, key); changed.push('API key'); }
  else if (d.clearKey === true && before.keySet) { PropertiesService.getScriptProperties().deleteProperty(VOICE_KEY_PROP_); changed.push('API key removed'); }
  if (changed.length) audit_(u, 'Voice agent', '', 'Settings changed', '', '', changed.join(', '));   // names only, never values
  return apiVoiceConfig();
}


/* ---------------------------------------------------------------- the call plan and the answers ------------ */
/**
 * The agent asks a set of STANDARD questions itself in every call (education, experience, current role, current and expected
 * CTC, notice period, location and relocation) and then the ROLE-SPECIFIC questions of the position, sent as a numbered list.
 * A confirmed question that is one of the standard topics is not sent again; the agent's answer to the standard question is
 * used for it. The rest are sent in priority order up to a limit; the others are left for the recruiter.
 */
const VOICE_STD_ = [['EDU', /qualification|education/i], ['EXP_RELEVANT', /relevant experience|directly relevant/i], ['EXP_TOTAL', /(total|overall).{0,24}experience|years of (total )?work/i],
  ['NOTICE', /notice period|earliest joining|how soon.{0,12}join/i], ['CTC_CUR', /current ctc/i], ['CTC_EXP', /expected ctc/i], ['LOCATION', /current location/i],
  ['RELOCATE', /based at|relocat|commute/i], ['CUR_ROLE', /currently employed|current role/i]];
function voiceStdKey_(it) { const t = String(it.label || '') + ' | ' + String(it.q || ''); for (let i = 0; i < VOICE_STD_.length; i++) if (VOICE_STD_[i][1].test(t)) return VOICE_STD_[i][0]; return ''; }
function voiceSpoken_(it) { return String(it.spoken || it.q || '').replace(/\s+/g, ' ').trim().slice(0, 200); }
/** {std:[{key,id}], sent:[{n,id,q}], left:[id]} for a question set. */
function voicePlan_(items, max) {
  max = max || 6;
  const std = [], rest = [];
  items.forEach(function (it, ix) { const k = voiceStdKey_(it); if (k) std.push({ key: k, id: String(it.id) }); else rest.push({ it: it, ix: ix }); });
  const rank = function (it) { return it.sec === 'E' ? (it.ko ? 0 : 1) : it.sec === 'R' ? 2 + ({ M: 0, I: 1, N: 2 }[it.imp] === undefined ? 1 : { M: 0, I: 1, N: 2 }[it.imp]) * 0.1 : 5; };
  rest.sort(function (a, b) { return rank(a.it) - rank(b.it) || a.ix - b.ix; });
  return { std: std, sent: rest.slice(0, max).map(function (r, n) { return { n: n + 1, id: String(r.it.id), q: voiceSpoken_(r.it) }; }), left: rest.slice(max).map(function (r) { return String(r.it.id); }) };
}
function voiceRoleQuestionsText_(plan) { return plan.sent.map(function (x) { return x.n + '. ' + x.q; }).join('\n'); }
/** The compact copy of the questions kept on the call, so the analysis never depends on later edits. */
function voiceItemsCompact_(items) {
  return items.map(function (i) { const o = { id: String(i.id), sec: i.sec, label: String(i.label || '').slice(0, 60), q: String(i.q || '').slice(0, 300), type: i.type || 'text', need: String(i.need || '').slice(0, 200), imp: i.imp || '', ko: !!i.ko };
    ['min', 'max', 'partly', 'expect'].forEach(function (k) { if (i[k] !== undefined && i[k] !== null && i[k] !== '') o[k] = i[k]; });
    if (i.good) o.good = String(i.good).slice(0, 200); if (i.watch) o.watch = String(i.watch).slice(0, 160); return o; });
}

/** Devanagari digits and the common Hindi number words as digits, so "पंद्रह दिन" reads as 15 days. */
const VOICE_HI_NUM_ = [['शून्य', 0], ['ग्यारह', 11], ['बारह', 12], ['तेरह', 13], ['चौदह', 14], ['पंद्रह', 15], ['पन्द्रह', 15], ['पन्द्रा', 15], ['सोलह', 16], ['सत्रह', 17], ['अठारह', 18], ['उन्नीस', 19], ['बीस', 20], ['इक्कीस', 21], ['बाईस', 22], ['तेईस', 23], ['चौबीस', 24], ['पच्चीस', 25],
  ['छब्बीस', 26], ['सत्ताईस', 27], ['अट्ठाईस', 28], ['उनतीस', 29], ['तीस', 30], ['पैंतीस', 35], ['चालीस', 40], ['पैंतालीस', 45], ['पचास', 50], ['साठ', 60], ['पैंसठ', 65], ['सत्तर', 70], ['पचहत्तर', 75], ['अस्सी', 80], ['नब्बे', 90], ['पचानवे', 95], ['सौ', 100],
  ['दस', 10], ['नौ', 9], ['आठ', 8], ['सात', 7], ['छह', 6], ['छः', 6], ['पांच', 5], ['पाँच', 5], ['चार', 4], ['तीन', 3], ['दो', 2], ['एक', 1]];
function voiceDigits_(text) {
  let t = String(text || '').replace(/[०-९]/g, function (d) { return String(d.charCodeAt(0) - 0x0966); });
  VOICE_HI_NUM_.forEach(function (p) { t = t.replace(new RegExp('(^|[^\\u0900-\\u097F])' + p[0] + '(?![\\u0900-\\u097F])', 'g'), function (m, pre) { return pre + p[1]; }); });
  return t;
}
/** The agent sometimes returns its answers as one dictionary-style string, {'EDU': 'MBA', ...}, instead of lines. */
function voiceDictToLines_(text) {
  const t = String(text || '').trim();
  if (t.charAt(0) !== '{') return t;
  try { const j = JSON.parse(t); if (j && typeof j === 'object') return Object.keys(j).map(function (k) { return k + ': ' + String(j[k] == null ? '' : j[k]); }).join('\n'); } catch (e) { }
  const out = [], re = /['"]([A-Za-z_][A-Za-z0-9_ ]*)['"]\s*:\s*(?:'([^']*)'|"([^"]*)"|([^,}]*))/g;
  let m; while ((m = re.exec(t))) out.push(m[1] + ': ' + String(m[2] != null ? m[2] : m[3] != null ? m[3] : (m[4] || '')).trim());
  return out.join('\n');
}
const VOICE_KEYS_ = ['EDU', 'EXP_TOTAL', 'EXP_RELEVANT', 'CUR_ROLE', 'CHANGE_REASON', 'CTC_CUR', 'CTC_EXP', 'NOTICE', 'LOCATION', 'RELOCATE'];
const VOICE_ALIAS_ = [[/current ctc|ctc.{0,12}current/i, 'CTC_CUR'], [/expected ctc|ctc.{0,12}expect/i, 'CTC_EXP'], [/notice|joining|join/i, 'NOTICE'], [/education|qualification/i, 'EDU'],
  [/current role|current job|current designation/i, 'CUR_ROLE'], [/reason.{0,12}change/i, 'CHANGE_REASON'], [/location|relocat|commute/i, 'LOCATION'], [/total|experience/i, 'EXP_TOTAL']];
/** The agent's screening_answers text -> {labels: {KEY: text}, q: {n: text}, other: [[label, text]]}. Blank answers are dropped. */
function voiceParseAnswers_(text) {
  const out = { labels: {}, q: {}, other: [] };
  voiceDictToLines_(text).split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_ \-\/,]{0,80}?)\s*:\s*(.+)$/);
    if (!m) return;
    const label = m[1].trim(), ans = m[2].trim();
    if (!ans || /^(blank|none|n\/a|not asked|not answered|-)$/i.test(ans)) return;
    const qn = label.match(/^Q(\d{1,2})$/i);
    if (qn) { out.q[Number(qn[1])] = ans; return; }
    const up = label.toUpperCase().replace(/[\s\-]+/g, '_');
    if (VOICE_KEYS_.indexOf(up) >= 0) { out.labels[up] = ans; return; }
    for (let i = 0; i < VOICE_ALIAS_.length; i++) if (VOICE_ALIAS_[i][0].test(label)) { if (!out.labels[VOICE_ALIAS_[i][1]]) out.labels[VOICE_ALIAS_[i][1]] = ans; return; }
    out.other.push([label, ans]);
  });
  return out;
}
/** The agent's screening_ratings text -> {id: {r: 'M'|'P'|'G', why}} for the questions it was sure about ("Unclear" gives nothing). */
function voiceParseRatings_(text, plan) {
  const out = {}, map = { meets: 'M', partly: 'P', 'does not meet': 'G', 'not met': 'G' };
  voiceDictToLines_(text).split(/\r?\n/).forEach(function (line) {
    const m = line.match(/^\s*Q(\d{1,2})\s*:\s*(meets|partly|does not meet|not met|unclear)\b\s*(?:[-\u2013\u2014:|]\s*)?(.*)$/i);
    if (!m) return;
    const r = map[m[2].toLowerCase()], x = plan.sent.filter(function (s) { return s.n === Number(m[1]); })[0];
    if (r && x) out[x.id] = { r: r, why: String(m[3] || '').replace(/\s+/g, ' ').trim().slice(0, 160) };
  });
  return out;
}
/** A spoken answer as the value the screening scorer needs: years, days, Yes / No, or the text. null when it cannot be read safely. */
function voiceNormalize_(it, text, key) {
  const t0 = String(text || '').trim();
  if (!t0) return null;
  const t = it.type === 'text' ? t0 : voiceDigits_(t0).replace(/\u0938\u093E\u0932|\u0935\u0930\u094D\u0937/g, ' year').replace(/\u092E\u0939\u0940\u0928\u0947?/g, ' month').replace(/\u0926\u093F\u0928/g, ' day');
  if (it.type === 'number') {
    const m = t.replace(/,/g, '').match(/(\d+(\.\d+)?)/);
    if (!m) return /immediate|turant|तुरंत/i.test(t) && key === 'NOTICE' ? '0' : null;
    let v = Number(m[1]);
    if (key === 'NOTICE' || /notice|joining/i.test(String(it.label))) { if (/month/i.test(t) && !/day/i.test(t)) v = v * 30; }
    else if (/year|experience/i.test(String(it.label) + ' ' + String(it.q))) { if (/month/i.test(t) && !/year|yr/i.test(t)) v = Math.round(v / 12 * 10) / 10; }
    return String(v);
  }
  if (it.type === 'yesno') {
    if (/\b(no|not|nahi|never|unwilling|cannot|can't)\b/i.test(t)) return 'No';
    if (/\b(yes|yeah|yep|haan|ji haan|sure|ok|okay|comfortable|willing|ready|agree|fine|definitely)\b/i.test(t)) return 'Yes';
    return null;
  }
  return t.slice(0, 500);
}

/** Every call of a card, oldest first, that has a result: the answers matched to the questions, the latest answer to a question wins. {byId: {id: {raw, a, call}}, items}. */
function voiceCombined_(appId, items) {
  const byId = {};
  voiceCallsRows_(appId).filter(function (c) { return String(c.Final_Vars_JSON || '') !== ''; }).sort(function (a, b) { return String(a.Call_ID) < String(b.Call_ID) ? -1 : 1; }).forEach(function (c) {
    let vars = {}; try { vars = JSON.parse(String(c.Final_Vars_JSON || '{}')); } catch (e) { }
    const plan = voicePlanOf_(c), m = voiceAnswersFromVars_(plan, vars);
    Object.keys(m.byId).forEach(function (id) { const x = m.byId[id]; const it = (items || plan.items).filter(function (i) { return String(i.id) === id; })[0]; if (it) byId[id] = { raw: x.raw, a: x.a, call: String(c.Call_ID) }; });
  });
  return byId;
}
/** The questions with no usable answer from any call yet, in priority order (all of them, up to 10): the plan of a follow-up call. */
function voiceFollowUpPlan_(appId, items) {
  const have = voiceCombined_(appId, items), rest = items.filter(function (i) { return !have[String(i.id)]; });
  const rank = function (it) { return it.sec === 'E' ? (it.ko ? 0 : 1) : it.sec === 'R' ? 2 + ({ M: 0, I: 1, N: 2 }[it.imp] === undefined ? 1 : { M: 0, I: 1, N: 2 }[it.imp]) * 0.1 : 5; };
  const ord = rest.map(function (it, ix) { return { it: it, ix: ix }; }).sort(function (a, b) { return rank(a.it) - rank(b.it) || a.ix - b.ix; });
  return { mode: 'follow_up', std: [], sent: ord.slice(0, 10).map(function (r, n) { return { n: n + 1, id: String(r.it.id), q: voiceSpoken_(r.it) }; }), left: ord.slice(10).map(function (r) { return String(r.it.id); }) };
}


/* ---------------------------------------------------------------- the call-plan desk ----------------------- */
/** The order the questions are asked in by default: facts about the person first, role questions in the middle, location, notice and pay last. */
function voiceOrderRank_(it) {
  const k = voiceStdKey_(it), std = { EDU: 1, EXP_TOTAL: 2, EXP_RELEVANT: 3, CUR_ROLE: 4, RELOCATE: 20, LOCATION: 21, NOTICE: 22, CTC_CUR: 23, CTC_EXP: 24 };
  if (k) return std[k] || 25;
  if (it.sec === 'E') return it.ko ? 5 : 6;
  if (it.sec === 'R') return 7 + ({ M: 0, I: 1, N: 2 }[it.imp] === undefined ? 1 : { M: 0, I: 1, N: 2 }[it.imp]) * 0.1;
  return 10;
}
function voiceSecs_(it) { return (it.type === 'yesno' ? 8 : it.type === 'number' ? 12 : 25) + 4; }
const VOICE_WARN_Q_ = 12, VOICE_WARN_MIN_ = 8;
/** What the desk shows for a card: every confirmed question, the default ticks, and the time estimate. */
function voiceDeskDraft_(appId, items) {
  const have = voiceCombined_(appId, items), follow = Object.keys(have).length > 0 || voiceCallsRows_(appId).some(function (r) { return String(r.Final_Vars_JSON || '') !== ''; });
  const ordered = items.map(function (it, ix) { return { it: it, ix: ix }; }).sort(function (a, b) { return voiceOrderRank_(a.it) - voiceOrderRank_(b.it) || a.ix - b.ix; }).map(function (x) { return x.it; });
  let sel;
  if (follow) sel = ordered.filter(function (it) { return !have[String(it.id)]; }).map(function (it) { return String(it.id); });
  else {   // the same position called before: start from what was asked then
    const prev = voiceCallsRows_().filter(function (r) { return String(r.Line_ID) === String(items.length ? (appOf_(appId).Line_ID) : '') && String(r.Plan_JSON || '') !== ''; }).pop();
    let ids = null; try { const p = JSON.parse(String(prev && prev.Plan_JSON || 'null')); if (p && p.listOnly && p.sent && p.sent.length) ids = p.sent.map(function (x) { return String(x.id); }); } catch (e) { }
    const known = {}; items.forEach(function (it) { known[String(it.id)] = true; });
    sel = ids ? ordered.filter(function (it) { return ids.indexOf(String(it.id)) >= 0; }).map(function (it) { return String(it.id); }) : ordered.map(function (it) { return String(it.id); });
    if (ids && !sel.length) sel = ordered.map(function (it) { return String(it.id); });
  }
  return { followUp: follow, sel: sel, items: ordered.map(function (it) { const id = String(it.id), h = have[id];
    return { id: id, sec: it.sec, label: String(it.label || ''), q: String(it.q || ''), spoken: voiceSpoken_(it), type: it.type || 'text', ko: !!it.ko, imp: it.imp || '', need: String(it.need || ''), key: voiceStdKey_(it), secs: voiceSecs_(it), answered: !!h, answer: h ? h.raw : '', sel: sel.indexOf(id) >= 0 }; }) };
}
/** A plan from the recruiter's ticks: {ids: [in the order to ask], spoken: {id: wording}}. */
function voicePlanFromSelection_(items, selection, followUp) {
  const known = {}; items.forEach(function (it) { known[String(it.id)] = it; });
  const ids = []; (selection && selection.ids || []).forEach(function (id) { id = String(id); if (known[id] && ids.indexOf(id) < 0) ids.push(id); });
  if (!ids.length) throw new Error('Tick at least one question to ask.');
  const sp = (selection && selection.spoken) || {};
  const sent = ids.map(function (id, n) { const it = Object.assign({}, known[id]); const w = String(sp[id] || '').replace(/\s+/g, ' ').trim(); if (w) it.spoken = w.slice(0, 200); return { n: n + 1, id: id, q: voiceSpoken_(it) }; });
  return { mode: followUp ? 'follow_up' : 'full', std: [], sent: sent, left: items.map(function (it) { return String(it.id); }).filter(function (id) { return ids.indexOf(id) < 0; }), listOnly: true,
    secs: sent.reduce(function (t, x) { return t + voiceSecs_(known[x.id]); }, 0) };
}
/** Admin only: the desk's data for one card (every question, default ticks, estimate and the thresholds that warn). */
function apiVoicePlanDraft(appId) {
  const u = currentUser_(); ensureSchema_(); voiceRequireCaller_(u, lineOf_(appOf_(appId).Line_ID), appId, true);
  try { voiceIngest_(u); } catch (e) { }
  const app = appOf_(appId), line = lineOf_(app.Line_ID), cand = candRow_(app.Candidate_ID) || {}, fin = sqFinalFor_(app.Line_ID);
  if (!fin) throw new Error('This position has no final screening questions yet. Confirm them in JD & questions first.');
  const items = sqParse_(String(fin.Content)).filter(function (i) { return i.sec === 'E' || i.sec === 'R' || i.sec === 'P'; }), cfg = voiceCfg_();
  const d = voiceDeskDraft_(appId, items);
  return { candidate: String(cand.Name || ''), position: String(line.Position || ''), questionsVersion: Number(fin.Version), followUp: d.followUp, items: d.items, listOnly: cfg.listOnly, warnQuestions: VOICE_WARN_Q_, warnMinutes: VOICE_WARN_MIN_,
    missing: voiceMissing_(cfg), varSet: !!cfg.questionsVar };
}

/** The plan kept on a call (or one derived from the current questions for an older call). */
function voicePlanOf_(call) {
  let p = null; try { p = JSON.parse(String(call.Plan_JSON || 'null')); } catch (e) { }
  if (p && Array.isArray(p.items)) return p;
  const fin = sqFinalFor_(call.Line_ID), items = fin ? sqParse_(String(fin.Content)) : [], pl = voicePlan_(items, 99);
  return { ver: fin ? Number(fin.Version) : 0, items: voiceItemsCompact_(items), std: pl.std, sent: [], left: pl.sent.map(function (x) { return x.id; }).concat(pl.left), derived: true };
}
/**
 * Matches the agent's variables to the question set: standard topics by label, role questions by Q number, and any variable
 * named like a question id. Returns {byId: {id: {raw, a}}, other, notAsked: [ids]}. `a` is the value the scorer uses ('' when it could not be read).
 */
function voiceAnswersFromVars_(plan, vars) {
  const parsed = voiceParseAnswers_(vars && vars.screening_answers), byId = {}, items = {}, unclear = {};
  plan.items.forEach(function (i) { items[i.id] = i; });
  const put = function (id, raw, key) { const it = items[id]; if (!it || !raw) return; const v = voiceNormalize_(it, raw, key);
    if (/^\s*unclear\s*$/i.test(String(raw)) || (it.type === 'yesno' && v == null)) { unclear[id] = String(raw); return; }   // not a usable yes / no: it stays open and is asked again
    byId[id] = { raw: String(raw), a: v == null ? '' : v }; };
  plan.std.forEach(function (s) { const raw = parsed.labels[s.key] || (s.key === 'RELOCATE' ? parsed.labels.LOCATION : ''); put(s.id, raw, s.key); });
  plan.sent.forEach(function (x) { put(x.id, parsed.q[x.n], ''); });
  plan.sent.forEach(function (x) { if (byId[x.id]) return; const it = items[x.id], k = it ? voiceStdKey_(it) : ''; if (k && parsed.labels[k]) put(x.id, parsed.labels[k], k); });
  // "the whole experience is relevant": the relevant years are the total years
  plan.items.forEach(function (it) { const id = String(it.id); if (voiceStdKey_(it) === 'EXP_RELEVANT' && byId[id] && byId[id].a === '' && /\b(entire|whole|all|full|complete)\b|\u0938\u093E\u0930\u093E|\u092A\u0942\u0930\u093E/i.test(byId[id].raw)) { const tot = plan.items.filter(function (i) { return voiceStdKey_(i) === 'EXP_TOTAL' && byId[String(i.id)] && byId[String(i.id)].a !== ''; })[0]; if (tot) byId[id].a = byId[String(tot.id)].a; } });
  Object.keys(items).forEach(function (id) { if (!byId[id] && vars && vars[id] != null && String(vars[id]).trim()) put(id, String(vars[id]), ''); });
  return { byId: byId, unclear: unclear, other: parsed.other, notAsked: plan.items.map(function (i) { return i.id; }).filter(function (id) { return !byId[id]; }) };
}
/** The answers the scorer can use: {id: text} for the readable ones only. */
function voiceDraftAnswers_(m) { const o = {}; Object.keys(m.byId).forEach(function (id) { if (m.byId[id].a !== '') o[id] = m.byId[id].a; }); return o; }

/* ---------------------------------------------------------------- the call ---------------------------------- */

function voiceCallOut_(r) {
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v || ''); };
  return { id: String(r.Call_ID), app: String(r.App_ID), cand: String(r.Candidate_ID), line: String(r.Line_ID), last4: String(r.Phone_Last4 || ''), status: String(r.Status), note: String(r.Status_Note || ''),
    startedBy: String(r.Started_By || ''), startedAt: at(r.Started_At), completedAt: at(r.Completed_At), draft: String(r.Draft_Applied || '') === 'Yes', hasTranscript: !!String(r.Transcript || ''),
    outcome: String(r.Outcome || ''), duration: Math.round(Number(r.Duration_Sec) || 0), hasResult: !!(String(r.Transcript || '') || String(r.Final_Vars_JSON || '')) };
}
function voiceCallsRows_(appId) { voiceSchema_(); return readTable_(VOICE_CALLS_.name).rows.filter(function (r) { return !appId || String(r.App_ID) === String(appId); }); }

/** The 10-digit mobile of a candidate, or '' when it is missing or not a valid mobile. */
function voicePhone_(cand) { const p = normPhone_(cand && cand.Mobile); return /^[6-9]\d{9}$/.test(p) ? p : ''; }

/**
 * What the agent is told: the candidate's first name, the position, the company, and the confirmed screening questions
 * (eligibility and role fit; practical details are asked too but not scored). No CV, salary or other personal data.
 */
function voiceBuildBrief_(app, line, cand, items, cfg, planOverride) {
  const first = String(cand.Name || '').trim().split(/\s+/)[0] || 'the candidate', plan = planOverride || voicePlan_(items, cfg.maxQ);
  return { followUp: !!(planOverride && planOverride.mode === 'follow_up'), candidateFirstName: first, position: String(line.Position || ''), company: String((bgvRules_().cfg || {}).company || 'BFCL'), orgId: cfg.orgId, workspaceId: cfg.workspaceId,
    plan: plan, roleQuestions: voiceRoleQuestionsText_(plan), criteria: voiceCriteriaText_(plan, items),
    questions: items.map(function (i) { const id = String(i.id), sent = plan.sent.filter(function (x) { return x.id === id; })[0], std = plan.std.filter(function (x) { return x.id === id; })[0];
      return { id: id, section: i.sec === 'E' ? 'Eligibility' : i.sec === 'R' ? 'Role fit' : 'Practical', question: String(i.q), answerType: String(i.type || 'text'), needed: String(i.need || ''), knockOut: !!i.ko,
        how: std ? 'Standard question' : sent ? (plan.mode === 'follow_up' ? 'Follow-up question Q' : 'Role question Q') + sent.n : plan.mode === 'follow_up' ? 'Answered earlier' : 'Left for the recruiter' }; }) };
}

/** The role-specific questions as numbered spoken text. The required answer, the pass mark and the knock-out flag are never sent: the agent must not coach the candidate. */
function voiceQuestionsText_(brief) { return brief.roleQuestions || ''; }
/**
 * What each asked question requires, for the agent's post-call rating step only: one line per number, never read by the live bot
 * (the agent prompt does not use this variable). Practical questions have no requirement and are left out.
 */
function voiceCriteriaText_(plan, items) {
  const by = {}; items.forEach(function (i) { by[String(i.id)] = i; });
  return plan.sent.map(function (x) { const i = by[x.id]; if (!i || i.sec === 'P' || !(i.need || i.good)) return '';
    return 'Q' + x.n + ' | ' + String(i.q).replace(/\s+/g, ' ').slice(0, 110) + ' | required: ' + String(i.need || '').replace(/\s+/g, ' ').slice(0, 160) + (i.good ? ' | a good answer: ' + String(i.good).replace(/\s+/g, ' ').slice(0, 160) : '') + (i.watch ? ' | a worry: ' + String(i.watch).replace(/\s+/g, ' ').slice(0, 120) : '') + (i.ko ? ' | knock-out' : ''); }).filter(String).join('\n');
}
/**
 * The agent variables sent with the call. Only the candidate's first name and the position are sent by default. Gender,
 * location and resume highlights are NOT sent (the agent may define them; they are left out on purpose). The questions are
 * sent only if the Admin has named the agent variable that receives them.
 */
function voiceAgentVars_(brief, cfg) {
  const v = { candidate_name: brief.candidateFirstName, role_applied: brief.position };
  if (cfg.questionsVar) v[cfg.questionsVar] = voiceQuestionsText_(brief);
  if (brief.followUp) v.call_mode = 'follow_up';
  if (cfg.ratings && brief.criteria) v.question_criteria = brief.criteria;
  return v;
}
/** The provider's outbound request body, as in the provider's own example. `phone` is the 10-digit mobile. */
function voiceRequestBody_(phone, brief, cfg, callId) {
  const body = { app_config: { app_id: cfg.agentId, app_version: cfg.agentVersion, app_type: 'agent',
      connection_config: { connection_id: cfg.connectionId, agent_phone_number: cfg.fromNumber }, agent_variables: voiceAgentVars_(brief, cfg) },
    user_config: { user_phone_number: '+91' + phone } };
  if (cfg.openingLine || cfg.entryState) {
    body.app_config.app_overrides = {};
    if (cfg.openingLine) body.app_config.app_overrides.initial_bot_message = cfg.openingLine;
    if (cfg.entryState) body.app_config.app_overrides.initial_state_name = cfg.entryState;
  }
  if (cfg.webhookUrl) body.webhook_config = { url: cfg.webhookUrl, metadata: { call_id: String(callId || ''), lead_id: String(callId || '') } };
  return body;
}

/**
 * Checks a call may be placed for this card and builds the brief. With dryRun nothing is called or saved: the page shows
 * the Admin what would be sent. A real start also needs the settings, the Do Not Disturb check and the provider.
 */
function apiVoiceStartScreening(appId, opts) {
  const u = currentUser_(); ensureSchema_();
  opts = opts || {};
  const app = appOf_(appId), line = lineOf_(app.Line_ID), cand = candRow_(app.Candidate_ID) || {};
  const who = voiceRequireCaller_(u, line, appId, !!opts.dryRun);
  if (String(app.Status) !== 'Active') throw new Error('This candidate is ' + String(app.Status).toLowerCase() + '. Reactivate them before a screening call.');
  const fin = sqFinalFor_(app.Line_ID);
  if (!fin) throw new Error('This position has no final screening questions yet. Confirm them in JD & questions first.');
  const phone = voicePhone_(cand);
  if (!phone) throw new Error('The candidate has no valid 10-digit mobile number on file.');
  const items = sqParse_(String(fin.Content)).filter(function (i) { return i.sec === 'E' || i.sec === 'R' || i.sec === 'P'; });
  if (!items.length) throw new Error('The final screening questions are empty.');
  const cfg = voiceCfg_();
  let fup = null;
  if (opts.plan || cfg.listOnly) {
    // The agent has no questions of its own from this version on: it asks the numbered list. The recruiter's ticks (or all questions) are the plan.
    const dd = voiceDeskDraft_(appId, items), follow = opts.plan ? !!opts.followUp : dd.followUp;
    fup = voicePlanFromSelection_(items, opts.plan || { ids: dd.sel }, follow);
    if (opts.plan && !cfg.listOnly) throw new Error('The question desk needs agent version ' + VOICE_LISTONLY_FROM_ + ' or later (Admin > Voice agent > Agent version). The selected agent version still asks its own standard questions.');
  } else if (opts.followUp) {
    if (!voiceCallsRows_(appId).some(function (r) { return String(r.Final_Vars_JSON || '') !== ''; })) throw new Error('There is no earlier call with a result for this candidate, so there is nothing to follow up. Place a normal call first.');
    fup = voiceFollowUpPlan_(appId, items);
    if (!fup.sent.length) throw new Error('Every question already has an answer from the earlier call or calls. There is nothing left to ask.');
  }
  const brief = voiceBuildBrief_(app, line, cand, items, cfg, fup);
  const open = voiceCallsRows_(appId).filter(function (r) { return VOICE_OPEN_STATUSES_.indexOf(String(r.Status)) >= 0 && (Date.now() - new Date(r.Started_At).getTime()) < 30 * 60000; })[0];
  const missing = voiceMissing_(cfg), problems = missing.slice();
  if (open) problems.push('A call to this candidate is already in progress (' + open.Call_ID + ')');
  if (cfg.dndRequired && !voiceDndWritten_()) problems.push('The Do Not Disturb check is not connected yet');
  if (fup && fup.listOnly && !cfg.questionsVar) problems.push('The questions variable is not set (Admin > Voice agent): the agent asks only the questions it is sent, so it would ask nothing');
  else if (fup && !cfg.questionsVar) problems.push('A follow-up call needs the questions variable to be set (Admin > Voice agent), and an agent version that has the call_mode variable (version 3 or later)');
  if (!fup && brief.plan.sent.length && !cfg.questionsVar) problems.push('This position has ' + brief.plan.sent.length + ' role-specific question' + (brief.plan.sent.length === 1 ? '' : 's') + ' but no questions variable is set (Admin > Voice agent), so the bot would ask only its standard questions');
  const body = voiceRequestBody_(phone, brief, cfg, '(call id)'); body.user_config.user_phone_number = '+91XXXXXX' + phone.slice(-4);
  const out = { dryRun: !!opts.dryRun, candidate: String(cand.Name || ''), phoneLast4: phone.slice(-4), questionsVersion: Number(fin.Version), brief: brief, request: body, notSent: ['gender', 'candidate_location', 'resume_highlights'],
    questionsSent: !!cfg.questionsVar, resultsReturn: cfg.webhookUrl ? 'Results will be sent to your webhook address' : 'No webhook address set: results will not come back automatically',
    dnd: cfg.dndRequired ? 'Required: our own register is checked before every call (the provider\u2019s list is not connected yet)' : 'Not required (switched off)', ready: !problems.length, problems: problems,
    warnings: (function () { const w = [], n = brief.plan.sent.length, mins = Math.round((brief.plan.secs || 0) / 60); if (n > VOICE_WARN_Q_) w.push(n + ' questions in one call is a lot for a candidate'); if (mins > VOICE_WARN_MIN_) w.push('about ' + mins + ' minutes is a long call'); return w; })(), estimate: { questions: brief.plan.sent.length, seconds: brief.plan.secs || 0 } };
  if (opts.dryRun) return out;
  if (problems.length) throw new Error('The call was not placed: ' + problems.join('; ') + '.');
  // 1) Do Not Disturb, 2) the call. Both are provider-specific and written when the provider API is known.
  if (cfg.dndRequired && voiceDndCheck_(phone, cfg)) {
    const blocked = voiceLog_(u, app, cand, phone, 'Blocked (Do Not Disturb)', 'The number is on the Do Not Disturb list. No call was placed.', Number(fin.Version));
    audit_(u, 'Voice agent', blocked.Call_ID, 'Call blocked', '', '', 'Do Not Disturb');
    throw new Error('This number is on the Do Not Disturb list. No call was placed.');
  }
  const row = voiceLog_(u, app, cand, phone, 'Starting', '', Number(fin.Version));
  try {
    const r = voicePlaceCall_(phone, brief, cfg, row.Call_ID);
    voiceUpdate_(row.Call_ID, { Status: 'Started', Provider_Call_ID: String((r && r.callId) || ''), Status_Note: String((r && r.note) || ''), Updated_By: u.email,
      Plan_JSON: JSON.stringify({ ver: Number(fin.Version), items: voiceItemsCompact_(items), std: brief.plan.std, sent: brief.plan.sent, left: brief.plan.left, via: cfg.questionsVar || '', mode: brief.plan.mode || 'full', listOnly: !!brief.plan.listOnly }).slice(0, 45000) });
    audit_(u, 'Voice agent', row.Call_ID, 'Call placed', '', '', 'candidate ' + app.Candidate_ID + ', questions v' + fin.Version);
  } catch (e) {
    voiceUpdate_(row.Call_ID, { Status: 'Failed', Status_Note: String(e && e.message || e).slice(0, 300), Updated_By: u.email });
    throw new Error('The call could not be placed: ' + String(e && e.message || e));
  }
  if (who.req) { try { voiceReqMarkPlaced_(who.req.Req_ID, row.Call_ID); } catch (e) { } }
  out.callId = row.Call_ID; return out;
}

/** True when the number is on our own Do Not Disturb register or (once connected) on the provider's list. */
function voiceDndCheck_(phone, cfg) { return voiceDndMatch_(phone, voiceDndNumbers_()) || voiceDndProvider_(phone, cfg); }
/** HOOK for the provider's Do Not Disturb list API: returns false until its documentation is available and this is written. The own register above is checked first. */
function voiceDndProvider_(phone, cfg) { return false; }

/**
 * Places the call through the provider's instant outbound API (request as in the provider's own example). Returns
 * {callId, note}. The response is read defensively: its id field name was not in the example, so the first of id /
 * outbound_id / call_id / uuid is kept, and the start of the raw response is kept as a note.
 */
function voicePlaceCall_(phone, brief, cfg, callId) {
  const key = voiceKey_();
  if (!key) throw new Error('The API key is not set.');
  const url = VOICE_API_BASE_ + '/outbounds/v1/orgs/' + encodeURIComponent(cfg.orgId) + '/workspaces/' + encodeURIComponent(cfg.workspaceId) + '/outbounds';
  let resp;
  try {
    resp = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', headers: { 'X-API-Key': key }, payload: JSON.stringify(voiceRequestBody_(phone, brief, cfg, callId)), muteHttpExceptions: true });
  } catch (e) { throw new Error('Could not reach the voice provider (' + String(e && e.message || e).replace(key, '***').slice(0, 120) + ').'); }
  const code = resp.getResponseCode(), text = String(resp.getContentText() || '');
  let j = null; try { j = JSON.parse(text); } catch (e) { }
  if (code < 200 || code >= 300) {
    const msg = j && (j.message || j.detail || j.error || (j.errors && JSON.stringify(j.errors))) || text;
    throw new Error('The provider refused the call (HTTP ' + code + '): ' + String(typeof msg === 'string' ? msg : JSON.stringify(msg)).replace(key, '***').replace(/\s+/g, ' ').slice(0, 200));
  }
  const id = j && (j.attempt_id || j.id || j.outbound_id || j.call_id || j.uuid || (j.data && (j.data.attempt_id || j.data.id || j.data.outbound_id || j.data.call_id)));
  return { callId: id ? String(id) : '', note: id ? '' : 'Placed; the provider returned no call id. Response: ' + text.replace(/\s+/g, ' ').slice(0, 160) };
}

/* ---------------------------------------------------------------- the call log ------------------------------ */

function voiceLog_(u, app, cand, phone, status, note, qVersion) {
  const o = { App_ID: String(app.App_ID), Candidate_ID: String(app.Candidate_ID), Line_ID: String(app.Line_ID), Phone_Last4: phone.slice(-4), Status: status, Status_Note: note || '',
    Questions_Version: qVersion, Started_By: u.email, Started_At: new Date(), Updated_By: u.email, Updated_At: new Date() };
  voiceSchema_();
  return withLock_(function () {
    const t = readTable_(VOICE_CALLS_.name, true);
    o.Call_ID = nextId_(VOICE_CALLS_, t.rows);
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    dropStale_(VOICE_CALLS_.name);
    return o;
  });
}
/** Writes columns of one call row directly (transcripts and answers must not go into the change log). */
function voiceUpdate_(callId, patch) {
  voiceSchema_();
  withLock_(function () {
    const t = readTable_(VOICE_CALLS_.name, true), r = t.rows.filter(function (x) { return String(x.Call_ID) === String(callId); })[0];
    if (!r) throw new Error('Call ' + callId + ' was not found.');
    Object.keys(patch).forEach(function (k) { r[k] = patch[k]; }); r.Updated_At = new Date();
    t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; })]);
    dropStale_(VOICE_CALLS_.name);
  });
}

/**
 * Records the outcome of a call and, when the provider returned answers, writes them into a DRAFT screening (never a
 * completed one, and never over a completed one). `result` = {status:'Completed'|'Failed', transcript, answers:{questionId: text}, note}.
 * Called by the provider connection once it exists; Admin only.
 */
function apiVoiceApplyResult(callId, result) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  return voiceApplyResult_(u, callId, result);
}
function voiceApplyResult_(u, callId, result) {
  result = result || {};
  const call = voiceCallsRows_().filter(function (r) { return String(r.Call_ID) === String(callId); })[0];
  if (!call) throw new Error('Call ' + callId + ' was not found.');
  if (String(call.Status) === 'Completed') throw new Error('This call already has its result.');
  const status = result.status === 'Failed' ? 'Failed' : 'Completed';
  const patch = { Status: status, Status_Note: String(result.note || '').slice(0, 300), Completed_At: new Date(), Updated_By: u.email };
  const transcript = String(result.transcript || '').slice(0, 20000);
  if (transcript) patch.Transcript = transcript;
  let drafted = 0, skipped = '';
  if (status === 'Completed' && result.answers && typeof result.answers === 'object') {
    const scr = scrOf_(call.App_ID);
    if (scr && String(scr.Status) === 'Complete') skipped = 'A completed screening already exists, so the answers were not written.';
    else {
      const fin = sqFinalFor_(call.Line_ID), items = fin ? sqParse_(String(fin.Content)) : [], answers = {};
      if (fin && Number(fin.Version) !== Number(call.Questions_Version)) skipped = 'The questions changed after the call started, so the answers were not written.';
      else {
        let prev = {}; try { prev = scr ? JSON.parse(String(scr.Answers_JSON || '{}')) : {}; } catch (e) { prev = {}; }
        items.forEach(function (i) { const a = result.answers[i.id], p = prev[i.id];
          if (p && String(p.a || '').trim() !== '') answers[i.id] = p;   // an answer already in the draft (from an earlier call or typed by the recruiter) is kept
          else if (a != null && String(a).trim() !== '') { answers[i.id] = { a: String(a).replace(/\s+/g, ' ').trim().slice(0, 500) }; drafted++; } });
        if (drafted) apiSaveScreening(call.App_ID, { answers: answers, note: 'Draft from voice call ' + callId + '. Check every answer against the call before completing.', complete: false });
      }
    }
    patch.Answers_JSON = JSON.stringify(result.answers).slice(0, 30000);
    patch.Draft_Applied = drafted ? 'Yes' : 'No';
    if (skipped) patch.Status_Note = (patch.Status_Note ? patch.Status_Note + ' ' : '') + skipped;
  }
  voiceUpdate_(callId, patch);
  audit_(u, 'Voice agent', callId, 'Result recorded', '', '', status + (drafted ? ', ' + drafted + ' answers drafted' : ''));
  return { call: voiceCallOut_(voiceCallsRows_().filter(function (r) { return String(r.Call_ID) === String(callId); })[0]), drafted: drafted, skipped: skipped };
}




/* ---------------------------------------------------------------- Do Not Disturb register, who may call, requests ----------- */

/** A mobile number as the 10 digits it is called on ('' when it is not a valid Indian mobile). Accepts +91, 91, 0 prefixes and spaces. */
function voiceDndNorm_(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
  else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
/** Splits pasted text (commas, spaces, new lines) into valid numbers and the pieces that are not numbers. */
function voiceDndParse_(text) {
  const ok = [], bad = [], seen = {};
  String(text == null ? '' : text).split(/[\n,;]+/).forEach(function (piece) {
    const raw = piece.trim(); if (!raw) return;
    const n = voiceDndNorm_(raw);
    if (!n) { bad.push(raw.slice(0, 30)); return; }
    if (!seen[n]) { seen[n] = true; ok.push(n); }
  });
  return { numbers: ok, bad: bad };
}
function voiceDndMatch_(phone, numbers) { const n = voiceDndNorm_(phone); return !!n && (numbers || []).indexOf(n) >= 0; }
function voiceDndNumbers_() {
  voiceSchema_();
  return readTable_(VOICE_DND_.name).rows.filter(function (r) { return String(r.Active) !== 'No'; }).map(function (r) { return voiceDndNorm_(r.Phone); }).filter(String);
}
/** Whether a person may place calls and how many are left today. rows: Voice_Access rows; used: calls placed today by them. Admin: always, no limit. */
function voiceAccessEval_(rows, email, used, isAdmin) {
  if (isAdmin) return { ok: true, limit: 0, used: used, left: -1, why: '' };
  const r = (rows || []).filter(function (x) { return String(x.Email).toLowerCase().trim() === String(email).toLowerCase().trim() && String(x.Active) !== 'No'; })[0];
  if (!r) return { ok: false, limit: 0, used: used, left: 0, why: 'You do not have voice calling access. Ask for a call from the card, or ask the Admin to give you access.' };
  const lim = Math.max(1, Math.min(500, Number(r.Daily_Limit) || VOICE_DEFAULT_LIMIT_));
  if (used >= lim) return { ok: false, limit: lim, used: used, left: 0, why: 'You have reached your limit of ' + lim + ' voice calls for today.' };
  return { ok: true, limit: lim, used: used, left: lim - used, why: '' };
}
function voiceAccessRows_() { voiceSchema_(); return readTable_(VOICE_ACCESS_.name).rows; }
/** Emails with an active access row, cached for 5 minutes so every page action does not read the sheet. */
function voiceAccessEmails_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('voice_access_v1');
  if (hit) return JSON.parse(hit);
  let list = [];
  try { if (ss_().getSheetByName(VOICE_ACCESS_.name)) list = readTable_(VOICE_ACCESS_.name).rows.filter(function (r) { return String(r.Active) !== 'No'; }).map(function (r) { return String(r.Email).toLowerCase().trim(); }); } catch (e) { list = []; }
  cache.put('voice_access_v1', JSON.stringify(list), 300);
  return list;
}
/** Used by currentUser_: true when this person has been given voice calling access. */
function voiceHasAccess_(email) { return voiceAccessEmails_().indexOf(String(email).toLowerCase().trim()) >= 0; }
function voiceDropAccess_() { try { CacheService.getScriptCache().remove('voice_access_v1'); } catch (e) { } }
function voiceUsedToday_(email) {
  const today = ymd_(new Date());
  return voiceCallsRows_().filter(function (c) { return String(c.Started_By).toLowerCase() === String(email).toLowerCase() && String(c.Status) !== 'Failed' && String(c.Status).indexOf('Blocked') !== 0 && ymd_(c.Started_At) === today; }).length;
}
function voiceReqRows_() { voiceSchema_(); return readTable_(VOICE_REQ_.name).rows; }
/** An approved request that has not been used yet and that this person may use (the one who asked, or the one who approved it). */
function voiceApprovedReq_(u, appId) {
  return voiceReqRows_().filter(function (r) { return String(r.App_ID) === String(appId) && String(r.Status) === 'Approved' && !String(r.Call_ID || '') && (String(r.Requested_By).toLowerCase() === u.email || String(r.Decided_By).toLowerCase() === u.email); })[0] || null;
}
/**
 * Who may plan and place a call for a card: the Admin; a person with voice access who may edit that position and is under the daily
 * limit; or the person an approved request names (one call per request). preview = looking at what would be sent: no limit applies.
 */
function voiceRequireCaller_(u, line, appId, preview) {
  if (can_(u, 'voice_agent')) return { admin: true, req: null };
  const req = voiceApprovedReq_(u, appId);
  if (req && line && canEditLine_(u, line)) return { admin: false, req: req };
  if (!can_(u, 'voice_call')) throw new Error('You do not have voice calling access. Use Request a voice call on the card, or ask the Admin to give you access.');
  if (!line || !canEditLine_(u, line)) throw new Error('You can place a voice call only for your own positions (a TA Lead or the Head of HR for all).');
  if (!preview) { const ev = voiceAccessEval_(voiceAccessRows_(), u.email, voiceUsedToday_(u.email), false); if (!ev.ok) throw new Error(ev.why); }
  return { admin: false, req: null };
}

/** The register: active numbers with who added them and why (Admin). */
function apiVoiceDndList() {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u); voiceSchema_();
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy') : String(v || ''); };
  const rows = readTable_(VOICE_DND_.name).rows.filter(function (r) { return String(r.Active) !== 'No'; }).reverse();
  return { total: rows.length, rows: rows.slice(0, 300).map(function (r) { return { phone: String(r.Phone), source: String(r.Source || ''), note: String(r.Note || ''), by: String(r.Added_By || ''), on: at(r.Added_On) }; }) };
}
function voiceDndAdd_(u, numbers, source, note) {
  voiceSchema_();
  return withLock_(function () {
    const t = readTable_(VOICE_DND_.name, true), have = {}; t.rows.forEach(function (r) { if (String(r.Active) !== 'No') have[voiceDndNorm_(r.Phone)] = true; });
    const fresh = numbers.filter(function (n) { return !have[n]; }), now = new Date();
    if (fresh.length) {
      const rows = fresh.map(function (n) { const o = { Phone: n, Source: source, Note: String(note || '').slice(0, 200), Active: 'Yes', Added_By: u.email, Added_On: now };
        return t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; }); });
      t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, t.headers.length).setValues(rows);
      dropStale_(VOICE_DND_.name);
      audit_(u, 'Voice agent', 'DND', 'Do not call added', '', '', fresh.length + ' number' + (fresh.length === 1 ? '' : 's') + ' (' + source + ')');
    }
    return { added: fresh.length, already: numbers.length - fresh.length };
  });
}
/** Adds pasted numbers to the register (Admin). */
function apiVoiceDndAdd(text, note) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  const p = voiceDndParse_(text);
  if (!p.numbers.length) throw new Error('No valid 10-digit mobile number found. Paste numbers separated by commas, spaces or new lines.');
  if (p.numbers.length > 5000) throw new Error('Add at most 5,000 numbers at a time.');
  const r = voiceDndAdd_(u, p.numbers, p.numbers.length > 5 ? 'Uploaded list' : 'HR added', note);
  r.bad = p.bad.slice(0, 10); r.badCount = p.bad.length; return r;
}
/**
 * Numbers read from the provider's own Do Not Disturb list (+91 form) that the register does not hold yet: normalised, duplicates and
 * invalid entries dropped. have = the 10-digit numbers already on the register.
 */
function voiceDndSyncRows_(providerNumbers, have) {
  const known = {}; (have || []).forEach(function (n) { known[voiceDndNorm_(n)] = true; });
  const out = [], seen = {}; let invalid = 0;
  (providerNumbers || []).forEach(function (raw) {
    const n = voiceDndNorm_(raw);
    if (!n) { invalid++; return; }
    if (known[n] || seen[n]) return;
    seen[n] = true; out.push(n);
  });
  return { numbers: out, invalid: invalid, already: (providerNumbers || []).length - out.length - invalid };
}
/** Mirrors the provider's Do Not Disturb list into the register (Admin). numbers: the provider's list as it was read (a person or Claude reads it with the provider's tools). */
function apiVoiceDndImportProvider(numbers) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  if (!Array.isArray(numbers)) throw new Error('Send the provider\u2019s numbers as a list.');
  if (numbers.length > 20000) throw new Error('At most 20,000 numbers at a time.');
  const sync = voiceDndSyncRows_(numbers, voiceDndNumbers_());
  const r = sync.numbers.length ? voiceDndAdd_(u, sync.numbers, 'Sarvam list', 'Synced from the provider list') : { added: 0, already: 0 };
  return { added: r.added, already: sync.already + r.already, invalid: sync.invalid };
}
/** Takes a number off the register (Admin), with a reason; the row is kept and marked. */
function apiVoiceDndRemove(phone, reason) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  const n = voiceDndNorm_(phone), why = clean_(String(reason || '').trim());
  if (!n) throw new Error('That is not a valid mobile number.');
  if (why.length < 3) throw new Error('Give a short reason for taking the number off the list.');
  voiceSchema_();
  withLock_(function () {
    const t = readTable_(VOICE_DND_.name, true), hit = t.rows.filter(function (r) { return String(r.Active) !== 'No' && voiceDndNorm_(r.Phone) === n; });
    if (!hit.length) throw new Error('That number is not on the list.');
    hit.forEach(function (r) { r.Active = 'No'; r.Removed_By = u.email; r.Removed_On = new Date(); r.Remove_Reason = why.slice(0, 200); t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; })]); });
    dropStale_(VOICE_DND_.name);
    audit_(u, 'Voice agent', 'DND', 'Do not call removed', '', '', 'ending ' + n.slice(-4) + ': ' + why);
  });
  return apiVoiceDndList();
}
/** "Do not call" for the candidate on a card: the Admin, a person with voice access, or a lead. The number goes on the register. */
function apiVoiceDndMark(appId, note) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId), line = lineOf_(app.Line_ID);
  if (!(can_(u, 'voice_agent') || can_(u, 'voice_call') || isLead_(u)) || !(isLead_(u) || (line && canEditLine_(u, line)))) throw new Error('Only a lead, the Admin, or a recruiter with voice access for this position can mark a number as do not call.');
  const phone = voicePhone_(candRow_(app.Candidate_ID) || {});
  if (!phone) throw new Error('The candidate has no valid 10-digit mobile number on file.');
  const r = voiceDndAdd_(u, [phone], 'Candidate opted out', note || 'Marked from the card');
  return { added: r.added, already: r.already, last4: phone.slice(-4) };
}

/** Who may call (Admin): every active team member with their access, limit and reason. */
function apiVoiceAccessList() {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  const rows = voiceAccessRows_(), by = {}; rows.forEach(function (r) { by[String(r.Email).toLowerCase().trim()] = r; });
  const users = usersCached_().filter(function (x) { return String(x.Active || 'Yes') !== 'No'; });
  return { defaultLimit: VOICE_DEFAULT_LIMIT_, users: users.map(function (x) {
    const e = String(x.Email).toLowerCase().trim(), r = by[e], admin = normRole_(x.Role) === ROLES.ADMIN;
    return { email: e, name: String(x.Name), role: normRole_(x.Role), admin: admin, active: admin || (!!r && String(r.Active) !== 'No'), limit: r ? Number(r.Daily_Limit) || VOICE_DEFAULT_LIMIT_ : VOICE_DEFAULT_LIMIT_, reason: r ? String(r.Reason || '') : '', used: voiceUsedToday_(e) };
  }) };
}
/** Saves access for named people (Admin). list: [{email, active, limit, reason}]; only people on the team list; every change is audited. */
function apiVoiceAccessSave(list) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u); voiceSchema_();
  const team = {}; usersCached_().forEach(function (x) { team[String(x.Email).toLowerCase().trim()] = x; });
  withLock_(function () {
    const t = readTable_(VOICE_ACCESS_.name, true), by = {}; t.rows.forEach(function (r) { by[String(r.Email).toLowerCase().trim()] = r; });
    (list || []).forEach(function (x) {
      const e = cleanMail_(x.email); if (!e || !team[e]) throw new Error((x.email || 'That person') + ' is not on the team list.');
      if (normRole_(team[e].Role) === ROLES.ADMIN) return;
      const act = x.active ? 'Yes' : 'No', lim = Math.max(1, Math.min(500, Math.floor(Number(x.limit) || VOICE_DEFAULT_LIMIT_))), why = clean_(String(x.reason || '').trim()).slice(0, 200), r = by[e];
      if (!r && !x.active) return;
      if (act === 'Yes' && why.length < 3 && (!r || String(r.Active) === 'No')) throw new Error('Give a short reason for giving ' + String(team[e].Name) + ' voice calling access.');
      if (r && String(r.Active) === act && Number(r.Daily_Limit) === lim && String(r.Reason || '') === why) return;
      const o = { Email: e, Active: act, Daily_Limit: lim, Reason: why || (r ? String(r.Reason || '') : ''), Granted_By: u.email, Granted_At: new Date() };
      const row = t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
      if (r) t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([row]); else t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([row]);
      audit_(u, 'Voice agent', e, 'Voice access ' + (act === 'Yes' ? 'given' : 'removed'), '', '', 'limit ' + lim + '/day' + (why ? ': ' + why : ''));
    });
    dropStale_(VOICE_ACCESS_.name);
  });
  voiceDropAccess_();
  return apiVoiceAccessList();
}

/** A recruiter without voice access asks for a call on a card: one open request per card. */
function apiVoiceRequest(appId, reason) {
  const u = currentUser_(); ensureSchema_(); voiceSchema_();
  const app = appOf_(appId), line = lineOf_(app.Line_ID), why = clean_(String(reason || '').trim());
  if (!line || !canEditLine_(u, line)) throw new Error('You can ask for a voice call only for your own positions.');
  if (String(app.Status) !== 'Active') throw new Error('This candidate is ' + String(app.Status).toLowerCase() + '. Reactivate them before a screening call.');
  if (why.length < 3) throw new Error('Say briefly why this candidate should be called (at least 3 characters).');
  return withLock_(function () {
    const t = readTable_(VOICE_REQ_.name, true);
    if (t.rows.some(function (r) { return String(r.App_ID) === String(appId) && (String(r.Status) === 'Pending' || (String(r.Status) === 'Approved' && !String(r.Call_ID || ''))); })) throw new Error('There is already an open voice call request for this candidate.');
    const o = { Req_ID: nextId_(VOICE_REQ_, t.rows), App_ID: String(appId), Line_ID: String(app.Line_ID), Candidate_ID: String(app.Candidate_ID), Requested_By: u.email, Requested_At: new Date(), Reason: why.slice(0, 300), Status: 'Pending' };
    t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    dropStale_(VOICE_REQ_.name);
    audit_(u, 'Voice agent', o.Req_ID, 'Voice call requested', '', '', 'candidate ' + app.Candidate_ID);
    return voiceReqOut_(o);
  });
}
function voiceReqOut_(r) {
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v || ''); };
  return { id: String(r.Req_ID), app: String(r.App_ID), line: String(r.Line_ID), by: String(r.Requested_By), at: at(r.Requested_At), reason: String(r.Reason || ''), status: String(r.Status), decidedBy: String(r.Decided_By || ''), decidedAt: at(r.Decided_At), note: String(r.Decision_Note || ''), call: String(r.Call_ID || '') };
}
/** The requests on one card (anyone who may see the card); the latest first. */
function apiVoiceRequestsFor(appId) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId), line = lineOf_(app.Line_ID);
  if (!isLead_(u) && !(line && canEditLine_(u, line))) throw new Error('You can see voice call requests only for your own positions.');
  const rows = voiceReqRows_().filter(function (r) { return String(r.App_ID) === String(appId); }).reverse().map(voiceReqOut_);
  return { requests: rows, canDecide: isLead_(u), canCall: can_(u, 'voice_agent') || can_(u, 'voice_call') || !!voiceApprovedReq_(u, appId) };
}
/** Pending requests across the team (leads). */
function apiVoiceRequestsPending() {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin sees the voice call requests.');
  const names = {}; readTable_(T.CAND.name).rows.forEach(function (c) { names[c.Candidate_ID] = String(c.Name); });
  return voiceReqRows_().filter(function (r) { return String(r.Status) === 'Pending'; }).map(function (r) { const o = voiceReqOut_(r); o.name = names[r.Candidate_ID] || String(r.Candidate_ID); return o; });
}
/** A lead approves or declines. Approval lets the person who asked (or the approver) place that one call. */
function apiVoiceRequestDecide(reqId, approve, note) {
  const u = currentUser_(); ensureSchema_(); voiceSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can decide a voice call request.');
  const why = clean_(String(note || '').trim()).slice(0, 300);
  if (!approve && why.length < 3) throw new Error('Give a short reason for declining.');
  return withLock_(function () {
    const t = readTable_(VOICE_REQ_.name, true), r = t.rows.filter(function (x) { return String(x.Req_ID) === String(reqId); })[0];
    if (!r) throw new Error('That request was not found.');
    if (String(r.Status) !== 'Pending') throw new Error('That request was already ' + String(r.Status).toLowerCase() + '.');
    r.Status = approve ? 'Approved' : 'Declined'; r.Decided_By = u.email; r.Decided_At = new Date(); r.Decision_Note = why;
    t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; })]);
    dropStale_(VOICE_REQ_.name);
    audit_(u, 'Voice agent', String(reqId), approve ? 'Voice call approved' : 'Voice call declined', '', '', why);
    return voiceReqOut_(r);
  });
}
function voiceReqMarkPlaced_(reqId, callId) {
  withLock_(function () {
    const t = readTable_(VOICE_REQ_.name, true), r = t.rows.filter(function (x) { return String(x.Req_ID) === String(reqId); })[0];
    if (!r) return;
    r.Status = 'Placed'; r.Call_ID = callId;
    t.sheet.getRange(r._row, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return r[h] === undefined ? '' : r[h]; })]);
    dropStale_(VOICE_REQ_.name);
  });
}


/* ---------------------------------------------------------------- command center: success rate, cost, review ---------------- */

/** How many of the agent's suggested ratings the reviewer kept: sug = {id: {r}}, given = {id: {r}} as saved by the reviewer. Only rated ids count. */
function voiceSuggestKept_(sug, given) {
  let total = 0, kept = 0;
  Object.keys(sug || {}).forEach(function (id) { const g = given && given[id]; if (!g || !g.r) return; total++; if (g.r === sug[id].r) kept++; });
  return { total: total, kept: kept };
}
/**
 * Figures for a period from the call rows (Started_At on or after `from`, up to and including `to`, as yyyy-mm-dd). rate: cost per minute (0 = unknown).
 * labels: { Line_ID: 'MRF Position' }. Placed = every call that went to the provider (not blocked by Do Not Disturb). Success = completed with answers.
 */
function voiceStats_(calls, from, to, rate, labels) {
  const day = function (v) { return v instanceof Date ? ymd_(v) : String(v || '').slice(0, 10); };
  const rows = (calls || []).filter(function (c) { const d = day(c.Started_At); return d && d >= from && d <= to; });
  const z = function () { return { placed: 0, completed: 0, success: 0, failed: 0, secs: 0, cost: 0, costN: 0 }; };
  const all = z(), byUser = {}, byLine = {}, disp = {};
  let blocked = 0, sugTotal = 0, sugKept = 0, noAnswer = 0, est = 0;
  rows.forEach(function (c) {
    const st = String(c.Status);
    if (st.indexOf('Blocked') === 0) { blocked++; return; }
    if (st === 'Cancelled') return;
    const u = String(c.Started_By || '').toLowerCase(), l = String(c.Line_ID || '');
    const bucket = [all, byUser[u] || (byUser[u] = z()), byLine[l] || (byLine[l] = z())];
    const secs = Number(c.Duration_Sec) || 0, hasAns = String(c.Answers_JSON || '') !== '' && String(c.Answers_JSON) !== '{}';
    bucket.forEach(function (b) {
      b.placed++;
      if (st === 'Completed') { b.completed++; b.secs += secs; if (hasAns) b.success++; }
      if (st === 'Failed') b.failed++;
      if (String(c.Cost) !== '' && c.Cost != null && !isNaN(Number(c.Cost))) { b.cost += Number(c.Cost); b.costN++; }
    });
    if (st === 'Completed' && !hasAns) noAnswer++;
    if (st === 'Completed') {
      let d = ''; try { d = String((JSON.parse(String(c.Final_Vars_JSON || '{}')).call_disposition) || ''); } catch (e) { d = ''; }
      d = d || 'not reported'; disp[d] = (disp[d] || 0) + 1;
    }
    sugTotal += Number(c.Suggest_Total) || 0; sugKept += Number(c.Suggest_Kept) || 0;
  });
  const fin = function (b, extra) {
    const mins = Math.round(b.secs / 6) / 10, withCost = b.costN > 0;
    return Object.assign({ placed: b.placed, completed: b.completed, success: b.success, failed: b.failed, minutes: mins,
      avgSecs: b.completed ? Math.round(b.secs / b.completed) : 0, rate: b.placed ? Math.round(b.success / b.placed * 100) : null,
      cost: withCost ? Math.round(b.cost * 100) / 100 : (rate > 0 ? Math.round(b.secs / 60 * rate * 100) / 100 : null), costBasis: withCost ? 'reported' : (rate > 0 ? 'estimate' : 'none'),
      perSuccess: b.success && (withCost || rate > 0) ? Math.round((withCost ? b.cost : b.secs / 60 * rate) / b.success * 100) / 100 : null }, extra || {});
  };
  return { from: from, to: to, total: fin(all), blocked: blocked, noAnswer: noAnswer, suggested: { total: sugTotal, kept: sugKept, pct: sugTotal ? Math.round(sugKept / sugTotal * 100) : null },
    byUser: Object.keys(byUser).map(function (k) { return fin(byUser[k], { user: k }); }).sort(function (a, b) { return b.placed - a.placed; }),
    byLine: Object.keys(byLine).map(function (k) { return fin(byLine[k], { line: k, label: (labels && labels[k]) || k }); }).sort(function (a, b) { return b.placed - a.placed; }).slice(0, 25),
    dispositions: Object.keys(disp).map(function (k) { return { name: k, n: disp[k] }; }).sort(function (a, b) { return b.n - a.n; }) };
}
/** The command center (Admin): figures for the last `days` days (7, 30 or 90). */
function apiVoiceStats(days) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  const n = [7, 30, 90].indexOf(Number(days)) >= 0 ? Number(days) : 30, to = ymd_(new Date()), from = ymd_(new Date(Date.now() - (n - 1) * 86400000));
  const labels = {}; readTable_(T.MRF.name).rows.forEach(function (l) { labels[String(l.Line_ID)] = (l.MRF_No ? l.MRF_No + ' ' : '') + String(l.Position || ''); });
  const r = voiceStats_(voiceCallsRows_(), from, to, voiceCfg_().ratePerMin, labels);
  r.days = n; r.rateSet = voiceCfg_().ratePerMin;
  return r;
}

/* ---------------------------------------------------------------- review aids: what was said, flags, recording ------------- */

/** The words of a text that carry meaning for matching: lower case, 2+ characters or any digit group. */
function voiceTokens_(t) {
  return String(t == null ? '' : t).toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 2 || /\d/.test(w); });
}
/**
 * The part of the transcript that answers one question: the candidate's turn that shares most words with the answer, and the agent's
 * turn just before it. lines: [{who, text}] as read from the stored transcript. Returns null when nothing matches well enough.
 */
function voiceSaidFor_(lines, question, answer) {
  const at = voiceTokens_(answer);
  if (!at.length || !Array.isArray(lines)) return null;
  const qt = voiceTokens_(question), seen = {};
  let best = -1, bestScore = 0;
  lines.forEach(function (l, i) {
    if (String(l.who) === 'Agent') return;
    const w = voiceTokens_(l.text); if (!w.length) return;
    const hit = at.filter(function (x) { return w.indexOf(x) >= 0; }).length / at.length;
    let ask = 0;
    for (let j = i - 1; j >= 0 && j >= i - 2; j--) if (String(lines[j].who) === 'Agent') { const a = voiceTokens_(lines[j].text); ask = qt.length ? qt.filter(function (x) { return a.indexOf(x) >= 0; }).length / qt.length : 0; break; }
    const sc = hit + ask * 0.5;
    if (hit > 0 && sc > bestScore) { bestScore = sc; best = i; }
  });
  if (best < 0 || bestScore < 0.34) return null;
  let agent = '';
  for (let j = best - 1; j >= 0; j--) if (String(lines[j].who) === 'Agent') { agent = String(lines[j].text); break; }
  return { agent: agent.slice(0, 400), candidate: String(lines[best].text).slice(0, 400) };
}
/** The first http(s) address under a key that looks like a recording or audio, anywhere in the provider's payload ('' when none). */
function voiceFindRecording_(p) {
  let found = '';
  const walk = function (o, depth) {
    if (found || depth > 5 || o == null || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) {
      if (found) return;
      const v = o[k];
      if (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v) && /record|audio|call_url|media/i.test(k)) found = v.slice(0, 1000);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    });
  };
  walk(p, 0);
  return found;
}
/** A cost the provider reported: the first number under a key like cost, charge, credits or price (null when none). */
function voiceFindCost_(p) {
  let found = null;
  const walk = function (o, depth) {
    if (found || depth > 5 || o == null || typeof o !== 'object') return;
    Object.keys(o).forEach(function (k) {
      if (found) return;
      const v = o[k];
      if ((typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v))) && /cost|charge|credit|price|billed/i.test(k) && Number(v) >= 0) found = { amount: Number(v), key: k };
      else if (v && typeof v === 'object') walk(v, depth + 1);
    });
  };
  walk(p, 0);
  return found;
}
/**
 * Flags that tell the reviewer what to check first, per question: Unclear, Could not read, Not answered, No rating. Only what the call
 * itself shows: never a judgement about the candidate. row is a review row from apiVoiceCallDetail; asked = it was sent to the agent.
 */
function voiceRowFlags_(row, asked) {
  const f = [];
  if (row.unclear) f.push({ k: 'unclear', t: 'Unclear' });
  else if (asked && row.type !== 'text' && row.answer && row.value === '') f.push({ k: 'unread', t: 'Could not read' });
  else if (asked && !row.answer && !row.earlier && !(row.cur && row.cur.a)) f.push({ k: 'missing', t: 'Not answered' });
  if (asked && row.sec !== 'P' && (row.value !== '' || row.answer) && !row.rating && !row.suggest && !(row.cur && row.cur.r)) f.push({ k: 'norate', t: 'No rating' });
  return f;
}
/** Call-level notes for the reviewer: a very short call, or one with no transcript. */
function voiceCallFlags_(call) {
  const f = [], secs = Number(call && call.Duration_Sec) || 0;
  if (secs > 0 && secs < 60) f.push('The call lasted under a minute. Check that the candidate really answered.');
  if (call && String(call.Status) === 'Completed' && !String(call.Transcript || '')) f.push('The provider sent no transcript for this call.');
  return f;
}
/**
 * The voice-call to-dos for active cards: the latest completed call of each card, mapped by its disposition (voiceDispositionAction_).
 * A "review" to-do goes once the screening is completed; the others stay until the recruiter marks them done. Returns [] when the
 * voice sheet does not exist yet. apps: the active Applications rows.
 */
function voiceTaskRows_(apps) {
  if (!ss_().getSheetByName(VOICE_CALLS_.name)) return [];
  const last = {};
  voiceCallsRows_().forEach(function (c) {
    if (String(c.Status) !== 'Completed' || !String(c.Final_Vars_JSON || '')) return;
    const k = String(c.App_ID), at = c.Completed_At instanceof Date ? c.Completed_At.getTime() : 0;
    if (!last[k] || at >= last[k].at) last[k] = { call: c, at: at };
  });
  const complete = {};
  if (ss_().getSheetByName(T.SCR.name)) readTable_(T.SCR.name).rows.forEach(function (r) { if (String(r.Status) === 'Complete') complete[String(r.App_ID)] = true; });
  const out = [];
  apps.forEach(function (a) {
    const l = last[String(a.App_ID)]; if (!l) return;
    let vars = {}; try { vars = JSON.parse(String(l.call.Final_Vars_JSON || '{}')); } catch (e) { vars = {}; }
    const action = voiceDispositionAction_(vars.call_disposition);
    if (!action) return;
    if (action.key === 'review' && complete[String(a.App_ID)]) return;
    if (action.key === 'incomplete' && complete[String(a.App_ID)]) return;
    out.push({ app: a, callId: String(l.call.Call_ID), action: action, at: l.at });
  });
  return out;
}
/** What a call's disposition asks the recruiter to do next (the agent only suggests; a person acts): { key, title, why } or null. */
function voiceDispositionAction_(disposition) {
  const d = String(disposition || '').toLowerCase().trim().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
  const m = {
    completed: { key: 'review', title: 'Review the voice screening draft', why: 'The call is complete: check the answers, rate them and complete the screening.' },
    not_interested: { key: 'notint', title: 'Candidate said not interested: confirm and close the card', why: 'The candidate told the agent they are not interested. Confirm with them, then reject or withdraw the card with a reason.' },
    callback_requested: { key: 'callback', title: 'Candidate asked for a call back', why: 'The candidate asked to be called later. Call them back or place the voice call again.' },
    incomplete_screening: { key: 'incomplete', title: 'Voice screening incomplete: ask the remaining questions', why: 'Some questions were not answered. Ask them yourself or place a follow-up call.' },
    wrong_number: { key: 'wrongno', title: 'Wrong number on the candidate record', why: 'The number did not reach the candidate. Check and correct the mobile number.' }
  };
  return m[d] || null;
}

/* ---------------------------------------------------------------- results coming back ----------------------- */

/** A call's transcript as text: "Agent: ..." / "Candidate: ...". */
function voiceTranscriptText_(turns) {
  if (!Array.isArray(turns)) return '';
  return turns.map(function (t) { const who = String(t && t.role) === 'agent' ? 'Agent' : 'Candidate'; return [who, String((t && (t.en_text || t.text)) || '').replace(/\s+/g, ' ').trim()]; }).filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).join('\n');
}
/** The variables the agent filled in during the call, without empty ones. */
function voiceVars_(p) {
  const src = (p && (p.final_agent_variables || p.output_agent_variables)) || {}, o = {};
  if (src && typeof src === 'object') Object.keys(src).forEach(function (k) { const v = src[k]; if (v != null && String(v).trim() !== '' && typeof v !== 'object') o[k] = String(v).slice(0, 4000); });
  return o;
}
/** Which of the provider's statuses count as a finished call and which as a failed one. */
function voiceOutcome_(p) {
  const st = String(p.status || p.completion_status || '').toLowerCase();
  if (st === 'connected' || st === 'completed' || st === 'partial') return { status: 'Completed', outcome: st === 'partial' ? 'Partly answered' : 'Answered', note: '' };
  const why = { no_answer: 'No answer', busy: 'Busy', failed: 'Failed' }[st] || (st ? st : 'No result');
  return { status: 'Failed', outcome: why, note: why + (p.failure_reason ? ': ' + String(p.failure_reason).slice(0, 150) : '') };
}
/**
 * Reads the rows the webhook receiver wrote to Voice_Inbox and records each result on its call: status, outcome, length,
 * transcript, the agent's variables, and a DRAFT screening when a variable is named after a question id. A repeated delivery
 * (the provider retries) is marked and ignored. Safe to call often; Admin screens call it before they list calls.
 */
function voiceIngest_(u) {
  return withLock_(function () { return voiceIngestRun_(u); });   // two people (or the 30-minute job) must not process the same rows at once
}
function voiceIngestRun_(u) {
  voiceSchema_();
  const t = readTable_(VOICE_INBOX_.name, true), todo = t.rows.filter(function (r) { return !String(r.Processed_At || ''); });
  if (!todo.length) return 0;
  const calls = voiceCallsRows_();
  let n = 0;
  todo.forEach(function (r) {
    let res = '', p = null, skip = false;
    try { p = JSON.parse(String(r.Payload || '')); } catch (e) { res = 'Unreadable payload'; }
    if (p) {
      const meta = (p.webhook_config && p.webhook_config.metadata) || p.metadata || {}, att = String(p.attempt_id || r.Attempt_ID || '');
      const call = calls.filter(function (c) { return (meta.call_id && String(c.Call_ID) === String(meta.call_id)) || (att && String(c.Provider_Call_ID) === att); })[0];
      if (call && !voiceCanReview_(u, lineOf_(call.Line_ID))) { skip = true; }   // someone who may handle it will process it
      else if (!call) {   // the result can arrive before our call record carries the provider's id: keep it for an hour before giving up
        const age = r.Received_At instanceof Date ? Date.now() - r.Received_At.getTime() : 1e12;
        if (age < 3600000) skip = true; else res = 'No matching call';
      }
      else if (String(call.Interaction_ID || '') && String(call.Interaction_ID) === String(p.interaction_id || '') && String(call.Final_Vars_JSON || '') !== '') res = 'Repeat delivery, ignored';
      else {
        try {
          const o = voiceOutcome_(p), vars = voiceVars_(p), tr = voiceTranscriptText_(p.interaction_transcript);
          const answers = voiceDraftAnswers_(voiceAnswersFromVars_(voicePlanOf_(call), vars));
          if (String(call.Status) === 'Completed' && String(call.Transcript || '')) res = 'Repeat delivery, ignored';
          else {
            voiceApplyResult_(u, call.Call_ID, { status: o.status, note: o.note, transcript: tr, answers: o.status === 'Completed' && Object.keys(answers).length ? answers : null });
            voiceUpdate_(call.Call_ID, { Outcome: o.outcome, Duration_Sec: Number(p.duration) || '', Interaction_ID: String(p.interaction_id || ''), Final_Vars_JSON: JSON.stringify(vars).slice(0, 20000), Provider_Call_ID: att || String(call.Provider_Call_ID || ''), Recording_URL: voiceFindRecording_(p), Cost: (voiceFindCost_(p) || { amount: '' }).amount, Cost_Unit: (voiceFindCost_(p) || { key: '' }).key });
            res = 'Recorded on ' + call.Call_ID; n++;
          }
        } catch (e) { res = 'Error: ' + String(e && e.message || e).slice(0, 150); }
      }
    }
    if (!skip) t.sheet.getRange(r._row, t.headers.indexOf('Processed_At') + 1, 1, 2).setValues([[new Date(), res]]);
  });
  dropStale_(VOICE_INBOX_.name);
  return n;
}

/* ---------------------------------------------------------------- fetching a call's result ----------------- */

/** GET on the provider's Analytics service for this agent: .../analytics/v1/{org}/{workspace}/{app}{path}. The key stays in the header and is scrubbed from errors. */
function voiceAnalyticsGet_(cfg, path, params) {
  const key = voiceKey_();
  if (!key) throw new Error('The API key is not set.');
  const qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  const url = VOICE_API_BASE_ + '/analytics/v1/' + encodeURIComponent(cfg.orgId) + '/' + encodeURIComponent(cfg.workspaceId) + '/' + encodeURIComponent(cfg.agentId) + path + (qs ? '?' + qs : '');
  let resp;
  try { resp = UrlFetchApp.fetch(url, { method: 'get', headers: { 'X-API-Key': key }, muteHttpExceptions: true }); }
  catch (e) { throw new Error('Could not reach the voice provider (' + String(e && e.message || e).replace(key, '***').slice(0, 120) + ').'); }
  const code = resp.getResponseCode(), text = String(resp.getContentText() || '');
  let j = null; try { j = JSON.parse(text); } catch (e) { }
  if (code < 200 || code >= 300) {
    const msg = j && (j.message || j.detail || j.error || (j.errors && JSON.stringify(j.errors))) || text;
    throw new Error('The provider refused the request (HTTP ' + code + '): ' + String(typeof msg === 'string' ? msg : JSON.stringify(msg)).replace(key, '***').replace(/\s+/g, ' ').slice(0, 200));
  }
  return j;
}
/** The turns of a transcript response, whatever the wrapper is called, as "Agent: ..." / "Candidate: ..." lines. '' when none are recognised. */
function voiceTurnsFromResponse_(j) {
  let arr = Array.isArray(j) ? j : null;
  ['transcript', 'turns', 'items', 'messages', 'data', 'interaction_transcript', 'conversation'].forEach(function (k) {
    if (!arr && j && Array.isArray(j[k])) arr = j[k];
    if (!arr && j && j[k] && typeof j[k] === 'object') ['transcript', 'turns', 'items', 'messages'].forEach(function (k2) { if (!arr && Array.isArray(j[k][k2])) arr = j[k][k2]; });
  });
  if (!arr) return '';
  return arr.map(function (t) {
    const who = String((t && (t.role || t.speaker || t.participant || t.sender)) || '').toLowerCase();
    const text = String((t && (t.english_content || t.en_text || t.text || t.content || t.message || t.transcript)) || '').replace(/\s+/g, ' ').trim();
    return [/agent|assistant|bot|ai/.test(who) ? 'Agent' : 'Candidate', text];
  }).filter(function (x) { return x[1]; }).map(function (x) { return x[0] + ': ' + x[1]; }).join('\n');
}
/**
 * Pulls one call's result from the provider by its attempt id (for a call whose webhook never arrived, or that is still
 * waiting): attempt record -> interaction id -> transcript. Records it the same way a webhook result is recorded.
 */
function apiVoiceFetchResult(callId) {
  const u = currentUser_(); ensureSchema_();
  const call = voiceCallsRows_().filter(function (r) { return String(r.Call_ID) === String(callId); })[0];
  if (!call) throw new Error('Call ' + callId + ' was not found.');
  if (!can_(u, 'voice_agent') && !(can_(u, 'voice_call') && String(call.Started_By).toLowerCase() === u.email) && !isLead_(u)) throw new Error('Only the person who placed this call, a lead or the Admin can fetch its result.');
  if (String(call.Status) === 'Completed' && String(call.Transcript || '')) throw new Error('This call already has its result.');
  let att = String(call.Provider_Call_ID || '');
  if (!att) { const m = String(call.Status_Note || '').match(/"attempt_id"\s*:\s*"([0-9A-Za-z\-]{8,80})"/); att = m ? m[1] : ''; }
  if (!att) throw new Error('This call has no provider attempt id, so its result cannot be fetched.');
  const cfg = voiceCfg_(), started = call.Started_At instanceof Date ? call.Started_At : new Date(call.Started_At || Date.now());
  const iso = function (d) { return Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'"); };
  const j = voiceAnalyticsGet_(cfg, '/attempts', { start_datetime: iso(new Date(started.getTime() - 6 * 3600000)), end_datetime: iso(new Date(started.getTime() + 2 * 86400000)), limit: 20,
    filter_conditions: JSON.stringify([{ id: '1', field: 'attempt_id', operator: 'equals', value: att }]) });
  const items = Array.isArray(j) ? j : (j && (j.items || j.data || j.results)) || [];
  const a = items.filter(function (x) { return String(x.attempt_id) === att; })[0];
  if (!a) throw new Error('The provider has no record of that call for the days searched. Check the agent id in the settings, and that the call is not older than the provider keeps its records.');
  const inter = String(a.interaction_id || ''), cs = String(a.connectivity_status || '');
  let tr = '', note = '';
  if (inter) {
    try { const tj = voiceAnalyticsGet_(cfg, '/transcripts/' + encodeURIComponent(inter)); tr = voiceTurnsFromResponse_(tj); if (!tr) { tr = JSON.stringify(tj).slice(0, 15000); note = 'The transcript layout was not recognised; the raw text is shown.'; } }
    catch (e) { note = 'The transcript could not be fetched: ' + String(e && e.message || e).slice(0, 120); }
  }
  const failed = !inter;
  const vars = {}; const av = a.agent_variables; if (av && typeof av === 'object') Object.keys(av).forEach(function (k) { if (av[k] != null && String(av[k]).trim() !== '' && typeof av[k] !== 'object') vars[k] = String(av[k]).slice(0, 4000); });
  const answers = voiceDraftAnswers_(voiceAnswersFromVars_(voicePlanOf_(call), vars));
  const why = failed ? ((cs || 'Not connected') + (a.failure_reason ? ': ' + String(a.failure_reason).slice(0, 150) : '')) : note;
  apiVoiceApplyResult(call.Call_ID, { status: failed ? 'Failed' : 'Completed', note: why, transcript: tr, answers: !failed && Object.keys(answers).length ? answers : null });
  voiceUpdate_(call.Call_ID, { Provider_Call_ID: att, Outcome: failed ? (cs || 'Not connected') : 'Answered', Duration_Sec: Number(a.duration_in_seconds) || '', Interaction_ID: inter, Final_Vars_JSON: JSON.stringify(vars).slice(0, 20000) });
  audit_(u, 'Voice agent', call.Call_ID, 'Result fetched', '', '', failed ? 'not connected' : 'transcript ' + (tr ? 'yes' : 'no'));
  return voiceCallOut_(voiceCallsRows_().filter(function (r) { return String(r.Call_ID) === String(callId); })[0]);
}

/**
 * One call's result for the card: outcome, length, transcript, and one row per confirmed question with what the candidate said,
 * how it was read, the rating the scorer can give, and the value now in the screening draft (if any). The Admin, or the
 * owner / a lead who holds voice_review, may open it.
 */
function apiVoiceCallDetail(callId) {
  const u = currentUser_(); ensureSchema_();
  const r = voiceCallsRows_().filter(function (x) { return String(x.Call_ID) === String(callId); })[0];
  if (!r) throw new Error('Call ' + callId + ' was not found.');
  const app = appOf_(r.App_ID); requireVoiceReview_(u, lineOf_(app.Line_ID));
  let vars = {}; try { vars = JSON.parse(String(r.Final_Vars_JSON || '{}')); } catch (e) { }
  const lines = String(r.Transcript || '').split('\n').filter(String).map(function (l) { const i = l.indexOf(': '); return { who: l.slice(0, i), text: l.slice(i + 2) }; });
  const plan = voicePlanOf_(r), m = voiceAnswersFromVars_(plan, vars), sentIds = plan.sent.map(function (x) { return x.id; }), stdIds = plan.std.map(function (x) { return x.id; });
  const all = voiceCombined_(r.App_ID, plan.items), scr = scrOf_(r.App_ID), rates = voiceParseRatings_(vars.screening_ratings, plan);
  let cur = {}; try { cur = scr ? JSON.parse(String(scr.Answers_JSON || '{}')) : {}; } catch (e) { cur = {}; }
  const ans = {}; Object.keys(m.byId).forEach(function (id) { if (m.byId[id].a !== '') ans[id] = { a: m.byId[id].a }; });
  const review = plan.items.map(function (it) { const x = m.byId[it.id], c = cur[it.id], auto = x && x.a !== '' ? sqAuto_(it, x.a) : '';
    return { id: it.id, sec: it.sec, q: it.q, need: it.need, ko: !!it.ko, type: it.type,
      how: stdIds.indexOf(it.id) >= 0 ? 'Standard' : sentIds.indexOf(it.id) >= 0 ? (plan.via || plan.derived ? (plan.listOnly ? 'Asked' : plan.mode === 'follow_up' ? 'Follow-up question' : 'Role question') : 'Question, NOT sent to the bot') : plan.mode === 'follow_up' ? 'Answered in an earlier call' : 'Left for the recruiter',
      answer: x ? x.raw : '', value: x ? x.a : '', rating: auto, suggest: !auto && x && rates[it.id] ? rates[it.id] : null, unclear: m.unclear[it.id] || '',
      earlier: !x && all[it.id] ? { call: all[it.id].call, answer: all[it.id].raw } : null,   // answered in another call of this candidate
      cur: c ? { a: String(c.a == null ? '' : c.a), r: String(c.r || '') } : null }; });
  review.forEach(function (x) { const asked = stdIds.indexOf(x.id) >= 0 || sentIds.indexOf(x.id) >= 0; x.said = x.answer || x.value ? voiceSaidFor_(lines, x.q, x.answer || x.value) : null; x.flags = voiceRowFlags_(x, asked); });
  const score = sqScore_(plan.items, ans);
  const asked = plan.items.filter(function (it) { return stdIds.indexOf(it.id) >= 0 || sentIds.indexOf(it.id) >= 0; });
  const open = plan.items.filter(function (it) { return !all[it.id]; }).map(function (it) { return it.id; });
  const coverage = { asked: asked.length, answered: asked.filter(function (it) { return !!m.byId[it.id]; }).length, unclear: Object.keys(m.unclear).length, total: plan.items.length, overallAnswered: plan.items.length - open.length, open: open,
    toRate: review.filter(function (x) { return x.sec !== 'P' && (x.value !== '' || x.answer) && !x.rating && !x.suggest && !(x.cur && x.cur.r); }).length, autoRated: review.filter(function (x) { return !!x.rating; }).length, suggested: review.filter(function (x) { return !!x.suggest; }).length,
    notSentVar: !!plan.sent.length && !plan.via && !plan.derived };
  const hint = { summary: String(vars.call_summary || ''), disposition: String(vars.call_disposition || '') };
  const next = voiceDispositionAction_(hint.disposition);
  const check = review.filter(function (x) { return x.flags.length; }).length;
  return { call: voiceCallOut_(r), appId: String(r.App_ID), transcript: lines, vars: Object.keys(vars).map(function (k) { return [k, vars[k]]; }), interaction: String(r.Interaction_ID || ''), review: review, check: check, callFlags: voiceCallFlags_(r), next: next, recording: String(r.Recording_URL || ''), cost: r.Cost === '' || r.Cost == null ? null : { amount: Number(r.Cost) || 0, unit: String(r.Cost_Unit || '') },
    score: { pct: score.pct, band: score.band, koFailed: score.koFailed, met: score.met, gaps: score.gaps, rated: score.rated, total: score.total }, other: m.other, hint: hint, planDerived: !!plan.derived, coverage: coverage,
    screening: scr ? { status: String(scr.Status), band: String(scr.Band || '') } : null, canAdmin: can_(u, 'voice_agent'), sentText: voiceRoleQuestionsText_({ sent: plan.sent }) };
}

/**
 * The recruiter's review of a call: the answers (edited if need be) and their ratings go into the screening draft; `complete`
 * completes the screening and moves the candidate to Screened. A person does this: nothing is completed by the call itself.
 * d = {answers: {id: {a, r}}, note, complete}. Admin, or the owner / a lead with voice_review.
 */
function apiVoiceReviewSave(callId, d) {
  const u = currentUser_(); ensureSchema_(); d = d || {};
  const call = voiceCallsRows_().filter(function (x) { return String(x.Call_ID) === String(callId); })[0];
  if (!call) throw new Error('Call ' + callId + ' was not found.');
  const app = appOf_(call.App_ID), line = lineOf_(app.Line_ID); requireVoiceReview_(u, line);
  const scr = scrOf_(app.App_ID);
  if (scr && String(scr.Status) === 'Complete') throw new Error('The screening was already completed. Reopen it from the pipeline card (Continue screening) to change it.');
  const plan = voicePlanOf_(call), items = {}; plan.items.forEach(function (i) { items[i.id] = i; });
  let prev = {}; try { prev = scr ? JSON.parse(String(scr.Answers_JSON || '{}')) : {}; } catch (e) { prev = {}; }
  const answers = {}; Object.keys(prev).forEach(function (id) { answers[id] = prev[id]; });
  Object.keys(d.answers || {}).forEach(function (id) {
    const it = items[id], x = d.answers[id] || {}; if (!it) return;
    const a = String(x.a == null ? '' : x.a).replace(/\s+/g, ' ').trim().slice(0, 500), r = ['M', 'P', 'G'].indexOf(x.r) >= 0 ? x.r : '', auto = sqAuto_(it, a);
    answers[id] = { a: a, r: r, o: !!(r && it.type !== 'text' && r !== auto) };
  });
  // The screening is scored on its own saved questions. If they are not the questions this call used (they were edited since),
  // answers would land on the wrong items or be dropped, so restart on the current questions when those match, or say so.
  const ids = function (list) { return list.map(function (i) { return String(i.id); }).sort().join('|'); };
  const fin = sqFinalFor_(app.Line_ID), finItems = fin ? sqParse_(String(fin.Content)) : [];
  let target = finItems, restart = false;
  if (scr) { try { target = JSON.parse(String(scr.Items_JSON || '[]')); } catch (e) { target = []; } }
  if (ids(target) !== ids(plan.items)) {
    if (scr && fin && ids(finItems) === ids(plan.items)) restart = true;
    else throw new Error('The screening questions were changed after this call (the call used version ' + (plan.ver || '?') + (scr ? ', the saved screening version ' + Number(scr.SQ_Version) : ', the position now has version ' + (fin ? Number(fin.Version) : '?')) + '). Open the candidate\u2019s card and use Continue screening to start it on the current questions.');
  }
  const out = apiSaveScreening(app.App_ID, { answers: answers, note: String(d.note || 'Reviewed from voice call ' + callId + '.').slice(0, 500), complete: !!d.complete, restart: restart });
  try {
    let cv = {}; try { cv = JSON.parse(String(call.Final_Vars_JSON || '{}')); } catch (e) { cv = {}; }
    const sug = voiceParseRatings_(cv.screening_ratings, plan), sc = voiceSuggestKept_(sug, d.answers || {});
    if (sc.total) voiceUpdate_(callId, { Suggest_Total: sc.total, Suggest_Kept: sc.kept });
  } catch (e) { }
  audit_(u, 'Voice agent', callId, d.complete ? 'Screening completed from the call' : 'Screening draft saved from the call', '', '', Object.keys(d.answers || {}).length + ' answers');
  return out;
}

/** The calls of one card, newest first (Admin, or the owner / a lead with voice_review). */
function apiVoiceCallsFor(appId) {
  const u = currentUser_(); ensureSchema_();
  const app = appOf_(appId); requireVoiceReview_(u, lineOf_(app.Line_ID));
  try { voiceIngest_(u); } catch (e) { }
  const out = voiceCallsRows_(appId).reverse().map(voiceCallOut_);
  const top = out.filter(function (c) { return c.hasResult; })[0];
  if (top) { try { const fin = sqFinalFor_(app.Line_ID); if (fin) { const items = sqParse_(String(fin.Content)), have = voiceCombined_(appId, items); top.remaining = items.filter(function (i) { return !have[String(i.id)]; }).length; top.totalQ = items.length; } } catch (e) { } }
  return out;
}
