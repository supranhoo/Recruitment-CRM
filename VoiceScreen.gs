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
const VOICE_STATUSES_ = ['Starting', 'Started', 'Completed', 'Failed', 'Blocked (Do Not Disturb)', 'Cancelled'];
const VOICE_OPEN_STATUSES_ = ['Starting', 'Started'];
const VOICE_KEY_PROP_ = 'VOICE_API_KEY';
/** Workspace ids given by the provider's console; they are identifiers, not secrets. */
const VOICE_DEFAULTS_ = { orgId: '01a11b5b-1fcf-7fc7-b673-8ebbe5e5dd0c', workspaceId: '01a11b5b-1fd6-79b4-b64a-2a0d9c3c8fef',
  agentId: 'Conversatio-85617fe5-386e', agentVersion: 1, connectionId: '14185236-97-20b5ee4b-4097', fromNumber: '+918064269699' };
const VOICE_API_BASE_ = 'https://apps.sarvam.ai/api';

function voiceSchema_() { addSheet_(VOICE_CALLS_.name, VOICE_CALL_COLS_); }
function requireVoiceAdmin_(u) { if (!can_(u, 'voice_agent')) throw new Error('Only the CRM admin can use the voice agent while it is being tested.'); }

/* ---------------------------------------------------------------- settings ---------------------------------- */

function voiceKey_() { return String(PropertiesService.getScriptProperties().getProperty(VOICE_KEY_PROP_) || ''); }
function voiceCfg_() {
  const s = settings_(), key = voiceKey_(), v = Number(s.VOICE_AGENT_VERSION);
  return { enabled: String(s.VOICE_ENABLED || 'No') === 'Yes', agentId: String(s.VOICE_AGENT_ID || VOICE_DEFAULTS_.agentId), agentVersion: v >= 1 && v <= 9999 ? Math.floor(v) : VOICE_DEFAULTS_.agentVersion,
    connectionId: String(s.VOICE_CONNECTION_ID || VOICE_DEFAULTS_.connectionId), fromNumber: String(s.VOICE_FROM_NUMBER || VOICE_DEFAULTS_.fromNumber), dndRequired: String(s.VOICE_DND_REQUIRED || 'Yes') !== 'No',
    orgId: String(s.VOICE_ORG_ID || VOICE_DEFAULTS_.orgId), workspaceId: String(s.VOICE_WORKSPACE_ID || VOICE_DEFAULTS_.workspaceId),
    openingLine: String(s.VOICE_OPENING_LINE || ''), entryState: String(s.VOICE_ENTRY_STATE || ''), webhookUrl: String(s.VOICE_WEBHOOK_URL || ''), questionsVar: String(s.VOICE_QUESTIONS_VAR || ''),
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
    openingLine: c.openingLine, entryState: c.entryState, webhookUrl: c.webhookUrl, questionsVar: c.questionsVar,
    keySet: c.keySet, keyHint: c.keyHint, missing: m, ready: !m.length, connected: voiceProviderConnected_(), dndWritten: voiceDndWritten_(), resultsWritten: voiceResultsWritten_() };
}
/** The call itself is written; the Do Not Disturb check and the way results come back are not. */
function voicePlaceWritten_() { return true; }
function voiceDndWritten_() { return false; }
function voiceResultsWritten_() { return false; }
/** True when a call can be placed with the Do Not Disturb rule honoured (the check, or the Admin has switched it off). */
function voiceProviderConnected_() { return voicePlaceWritten_() && voiceDndWritten_(); }

function apiVoiceConfig() {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  const calls = readTable_(VOICE_CALLS_.name).rows;
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
  put('VOICE_QUESTIONS_VAR', 'questions variable', qv, before.questionsVar); put('VOICE_WEBHOOK_URL', 'webhook address', hook, before.webhookUrl);
  put('VOICE_ENABLED', 'allow calls', d.enabled === true ? 'Yes' : 'No', before.enabled ? 'Yes' : 'No');
  put('VOICE_DND_REQUIRED', 'Do Not Disturb check', d.dndRequired === false ? 'No' : 'Yes', before.dndRequired ? 'Yes' : 'No');
  writes.forEach(function (w) { setSetting_(w[0], w[2], 'Voice agent (admin test)'); changed.push(w[1]); });
  if (key) { PropertiesService.getScriptProperties().setProperty(VOICE_KEY_PROP_, key); changed.push('API key'); }
  else if (d.clearKey === true && before.keySet) { PropertiesService.getScriptProperties().deleteProperty(VOICE_KEY_PROP_); changed.push('API key removed'); }
  if (changed.length) audit_(u, 'Voice agent', '', 'Settings changed', '', '', changed.join(', '));   // names only, never values
  return apiVoiceConfig();
}

/* ---------------------------------------------------------------- the call ---------------------------------- */

function voiceCallOut_(r) {
  const at = function (v) { return v instanceof Date ? fmt_(v, TZ, 'd MMM yyyy, HH:mm') : String(v || ''); };
  return { id: String(r.Call_ID), app: String(r.App_ID), cand: String(r.Candidate_ID), line: String(r.Line_ID), last4: String(r.Phone_Last4 || ''), status: String(r.Status), note: String(r.Status_Note || ''),
    startedBy: String(r.Started_By || ''), startedAt: at(r.Started_At), completedAt: at(r.Completed_At), draft: String(r.Draft_Applied || '') === 'Yes', hasTranscript: !!String(r.Transcript || '') };
}
function voiceCallsRows_(appId) { return readTable_(VOICE_CALLS_.name).rows.filter(function (r) { return !appId || String(r.App_ID) === String(appId); }); }

/** The 10-digit mobile of a candidate, or '' when it is missing or not a valid mobile. */
function voicePhone_(cand) { const p = normPhone_(cand && cand.Mobile); return /^[6-9]\d{9}$/.test(p) ? p : ''; }

/**
 * What the agent is told: the candidate's first name, the position, the company, and the confirmed screening questions
 * (eligibility and role fit; practical details are asked too but not scored). No CV, salary or other personal data.
 */
function voiceBuildBrief_(app, line, cand, items, cfg) {
  const first = String(cand.Name || '').trim().split(/\s+/)[0] || 'the candidate';
  return { candidateFirstName: first, position: String(line.Position || ''), company: String((bgvRules_().cfg || {}).company || 'BFCL'), orgId: cfg.orgId, workspaceId: cfg.workspaceId,
    questions: items.map(function (i) { return { id: String(i.id), section: i.sec === 'E' ? 'Eligibility' : i.sec === 'R' ? 'Role fit' : 'Practical', question: String(i.q), answerType: String(i.type || 'text'), needed: String(i.need || ''), knockOut: !!i.ko }; }) };
}

/** The questions as plain numbered text, for an agent variable the Admin has named in the settings. */
function voiceQuestionsText_(brief) {
  return brief.questions.map(function (q, i) { return (i + 1) + '. [' + q.section + '] ' + q.question + (q.needed ? ' (needed: ' + q.needed + ')' : ''); }).join('\n');
}
/**
 * The agent variables sent with the call. Only the candidate's first name and the position are sent by default. Gender,
 * location and resume highlights are NOT sent (the agent may define them; they are left out on purpose). The questions are
 * sent only if the Admin has named the agent variable that receives them.
 */
function voiceAgentVars_(brief, cfg) {
  const v = { candidate_name: brief.candidateFirstName, role_applied: brief.position };
  if (cfg.questionsVar) v[cfg.questionsVar] = voiceQuestionsText_(brief);
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
  if (cfg.webhookUrl) body.webhook_config = { url: cfg.webhookUrl, metadata: { lead_id: String(callId || '') } };
  return body;
}

/**
 * Checks a call may be placed for this card and builds the brief. With dryRun nothing is called or saved: the page shows
 * the Admin what would be sent. A real start also needs the settings, the Do Not Disturb check and the provider.
 */
function apiVoiceStartScreening(appId, opts) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  opts = opts || {};
  const app = appOf_(appId), line = lineOf_(app.Line_ID), cand = candRow_(app.Candidate_ID) || {};
  if (String(app.Status) !== 'Active') throw new Error('This candidate is ' + String(app.Status).toLowerCase() + '. Reactivate them before a screening call.');
  const fin = sqFinalFor_(app.Line_ID);
  if (!fin) throw new Error('This position has no final screening questions yet. Confirm them in JD & questions first.');
  const phone = voicePhone_(cand);
  if (!phone) throw new Error('The candidate has no valid 10-digit mobile number on file.');
  const items = sqParse_(String(fin.Content)).filter(function (i) { return i.sec === 'E' || i.sec === 'R' || i.sec === 'P'; });
  if (!items.length) throw new Error('The final screening questions are empty.');
  const cfg = voiceCfg_(), brief = voiceBuildBrief_(app, line, cand, items, cfg);
  const open = voiceCallsRows_(appId).filter(function (r) { return VOICE_OPEN_STATUSES_.indexOf(String(r.Status)) >= 0 && (Date.now() - new Date(r.Started_At).getTime()) < 30 * 60000; })[0];
  const missing = voiceMissing_(cfg), problems = missing.slice();
  if (open) problems.push('A call to this candidate is already in progress (' + open.Call_ID + ')');
  if (cfg.dndRequired && !voiceDndWritten_()) problems.push('The Do Not Disturb check is not connected yet');
  const body = voiceRequestBody_(phone, brief, cfg, '(call id)'); body.user_config.user_phone_number = '+91XXXXXX' + phone.slice(-4);
  const out = { dryRun: !!opts.dryRun, candidate: String(cand.Name || ''), phoneLast4: phone.slice(-4), questionsVersion: Number(fin.Version), brief: brief, request: body, notSent: ['gender', 'candidate_location', 'resume_highlights'],
    questionsSent: !!cfg.questionsVar, resultsReturn: cfg.webhookUrl ? 'Results will be sent to your webhook address' : 'No webhook address set: results will not come back automatically',
    dnd: cfg.dndRequired ? 'Required: checked before every call' : 'Not required (switched off)', ready: !problems.length, problems: problems };
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
    voiceUpdate_(row.Call_ID, { Status: 'Started', Provider_Call_ID: String((r && r.callId) || ''), Status_Note: String((r && r.note) || ''), Updated_By: u.email });
    audit_(u, 'Voice agent', row.Call_ID, 'Call placed', '', '', 'candidate ' + app.Candidate_ID + ', questions v' + fin.Version);
  } catch (e) {
    voiceUpdate_(row.Call_ID, { Status: 'Failed', Status_Note: String(e && e.message || e).slice(0, 300), Updated_By: u.email });
    throw new Error('The call could not be placed: ' + String(e && e.message || e));
  }
  out.callId = row.Call_ID; return out;
}

/** PROVIDER STUB: returns true when the number is on the Do Not Disturb list. To be written from the provider's DND list API. */
function voiceDndCheck_(phone, cfg) { throw new Error('The Do Not Disturb check is not connected yet.'); }

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
  const id = j && (j.id || j.outbound_id || j.call_id || j.uuid || (j.data && (j.data.id || j.data.outbound_id || j.data.call_id)));
  return { callId: id ? String(id) : '', note: id ? '' : 'Placed; the provider returned no call id. Response: ' + text.replace(/\s+/g, ' ').slice(0, 160) };
}

/* ---------------------------------------------------------------- the call log ------------------------------ */

function voiceLog_(u, app, cand, phone, status, note, qVersion) {
  const o = { App_ID: String(app.App_ID), Candidate_ID: String(app.Candidate_ID), Line_ID: String(app.Line_ID), Phone_Last4: phone.slice(-4), Status: status, Status_Note: note || '',
    Questions_Version: qVersion, Started_By: u.email, Started_At: new Date(), Updated_By: u.email, Updated_At: new Date() };
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
        items.forEach(function (i) { const a = result.answers[i.id]; if (a != null && String(a).trim() !== '') { answers[i.id] = { a: String(a).replace(/\s+/g, ' ').trim().slice(0, 500) }; drafted++; } });
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

/** The calls of one card (Admin only), newest first. */
function apiVoiceCallsFor(appId) {
  const u = currentUser_(); ensureSchema_(); requireVoiceAdmin_(u);
  return voiceCallsRows_(appId).reverse().map(voiceCallOut_);
}
