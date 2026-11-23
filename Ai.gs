/**
 * AI Recruitment (ADR-089): the foundation for every AI action in the CRM.
 *
 * What lives here: the Anthropic API key (Script Properties only), the Admin settings (Settings sheet, AI_* keys), the one gate every AI action passes,
 * the call to the Messages API, the usage ledger with a budget reserved under the script lock, and the Admin endpoints (connection, settings, usage).
 * The AI never writes candidate data, sends a message or moves a stage: a feature built on this file returns a DRAFT that a person reviews.
 *
 * The key is read only inside aiKey_() at the moment of a call. It is never put in a Sheet, a cache entry, a log, an audit row, a job
 * payload or anything returned to the browser (the browser gets the last four characters and a version id).
 */
const AI_KEY_PROP_ = 'ANTHROPIC_API_KEY';
const AI_META_PROP_ = 'ANTHROPIC_KEY_META';
const AI_API_URL_ = 'https://api.anthropic.com/v1/messages';
const AI_API_VERSION_ = '2026-10-21';
/** Features, in the order shown. built = the screen exists in this release; the rest are listed so the Admin sees what is coming but cannot switch them on yet. */
const AI_FEATURES_ = [
  { id: 'extract', label: 'CV extraction', built: true },
  { id: 'summary', label: 'Candidate summary', built: true },
  { id: 'compare', label: 'Vacancy comparison', built: true },
  { id: 'screening', label: 'Screening sheet preparation', built: true },
  { id: 'questions', label: 'Interview question generation', built: true },
  { id: 'feedback', label: 'Interview feedback summary', built: true },
  { id: 'comms', label: 'Communication drafting', built: true }
];
/** Models the Admin may choose (verified against the Anthropic model list when this release was built). */
const AI_MODELS_ = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, lowest cost)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (balanced)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most thorough of the three)' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (highest capability and cost)' }
];
const AI_DEFAULT_MODEL_ = 'claude-sonnet-5-5';
const AI_TEST_MODEL_ = 'claude-haiku-5-5';
/** Estimated prices in US dollars per million tokens, from the model list at release time. The Admin keeps the dated rows in AI_Pricing; these seed it. */
const AI_PRICE_SEED_ = [['claude-haiku-5-5', 0.10, 0.50], ['claude-sonnet-5-5', 2.00, 10.00], ['claude-opus-5-5', 4.00, 20.00], ['claude-fable-5-2', 8.00, 40.00]];
const AI_PRICE_SEED_DATE_ = '2026-11-03';

const AI_USAGE_ = { name: 'AI_Usage', id: 'Usage_ID', prefix: 'AIU-', width: 6, dates: [], editable: [],
  cols: ['Usage_ID', 'When', 'Feature', 'User', 'Model', 'Candidate_ID', 'Outcome', 'Error_Class', 'Tokens_In', 'Tokens_Out', 'Est_Cost_USD', 'Duration_Ms', 'Reserved'] };
const AI_CREDLOG_ = { name: 'AI_Credential_Log', id: 'Log_ID', prefix: 'AIC-', width: 5, dates: [], editable: [],
  cols: ['Log_ID', 'When', 'Admin', 'Action', 'Success', 'Key_Version', 'Note'] };
const AI_PRICING_ = { name: 'AI_Pricing', id: 'Price_ID', prefix: 'AIP-', width: 4, dates: [], editable: [],
  cols: ['Price_ID', 'Model', 'From_Date', 'In_per_M_USD', 'Out_per_M_USD', 'Note'] };
const AI_JOBS_ = { name: 'AI_Jobs', id: 'Job_ID', prefix: 'AIJ-', width: 6, dates: [], editable: [],
  cols: ['Job_ID', 'Feature', 'Status', 'Candidate_ID', 'App_ID', 'Line_ID', 'Source_Version', 'Input_Hash', 'Model', 'Prompt_Version', 'Requested_By', 'Requested_At', 'Started_At', 'Finished_At', 'Attempts', 'Error_Class', 'Tokens_In', 'Tokens_Out', 'Est_Cost_USD', 'Batch_ID', 'Draft_ID', 'Note'] };
const AI_DRAFTS_ = { name: 'AI_Drafts', id: 'Draft_ID', prefix: 'AID-', width: 6, dates: [], editable: [],
  cols: ['Draft_ID', 'Job_ID', 'Feature', 'Candidate_ID', 'App_ID', 'Line_ID', 'Source_Version', 'Input_Hash', 'Content_JSON', 'Edited_JSON', 'Status', 'Superseded', 'Created_By', 'Created_At', 'Reviewed_By', 'Reviewed_At'] };

/** Creates the AI sheets and seeds the price list. Cheap to call every time (once per release per 6 hours). */
function aiSchema_() {
  schemaOnce_('ai', function () {
    [AI_USAGE_, AI_CREDLOG_, AI_PRICING_, AI_JOBS_, AI_DRAFTS_].forEach(function (d) { addSheet_(d.name, d.cols); addColumns_(d.name, d.cols); });
    if (!readTable_(AI_PRICING_.name, true).rows.length) {
      const sys = { email: 'system' };
      AI_PRICE_SEED_.forEach(function (p) { insert_(AI_PRICING_, { Model: p[0], From_Date: AI_PRICE_SEED_DATE_, In_per_M_USD: p[1], Out_per_M_USD: p[2], Note: 'Seeded from the Anthropic model list; the Admin confirms current rates.' }, sys); });
    }
  });
}

/* ------------------------------------------------------------------ permissions ---------------------------------- */
function requireAiCred_(u) { if (!can_(u, 'ai_credentials')) throw new Error('Only a user with the Manage AI Credentials permission can do this.'); }
function requireAiSettings_(u) { if (!can_(u, 'ai_settings')) throw new Error('Only a user with the Manage AI Settings permission can do this.'); }

/* ------------------------------------------------------------------ settings ------------------------------------- */
function aiNum_(v, d, lo, hi) { const n = Number(v); return (v === '' || v == null || !isFinite(n)) ? d : Math.min(hi, Math.max(lo, n)); }
function aiCfg_() {
  const s = settings_(), yes = function (k, d) { const v = s[k]; return String(v == null || v === '' ? d : v) === 'Yes'; };
  const features = {}, models = {};
  AI_FEATURES_.forEach(function (f) {
    features[f.id] = f.built && yes('AI_FEAT_' + f.id.toUpperCase(), 'Yes');
    const m = String(s['AI_MODEL_' + f.id.toUpperCase()] || '');
    models[f.id] = AI_MODELS_.some(function (x) { return x.id === m; }) ? m : AI_DEFAULT_MODEL_;
  });
  return { enabled: yes('AI_ENABLED', 'No'), emergency: yes('AI_EMERGENCY_STOP', 'No'), features: features, models: models,
    maxFileMb: aiNum_(s.AI_MAX_FILE_MB, 5, 1, 10), maxPages: aiNum_(s.AI_MAX_PAGES, 15, 1, 60), maxOutTokens: Math.floor(aiNum_(s.AI_MAX_OUT_TOKENS, 6000, 256, 16000)),
    batchLimit: Math.floor(aiNum_(s.AI_BATCH_LIMIT, 20, 1, 100)), maxConcurrent: Math.floor(aiNum_(s.AI_MAX_CONCURRENT, 2, 1, 5)),
    budgetUsd: aiNum_(s.AI_MONTHLY_BUDGET_USD, 20, 0, 100000), warnPct: Math.floor(aiNum_(s.AI_WARN_PCT, 80, 1, 100)) };
}
function aiKey_() { return String(PropertiesService.getScriptProperties().getProperty(AI_KEY_PROP_) || ''); }
function aiMeta_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(AI_META_PROP_) || '{}') || {}; } catch (e) { return {}; } }
function aiMonth_(d) { return Utilities.formatDate(d || new Date(), TZ, 'yyyy-MM'); }
function aiToDate_(v) { return v instanceof Date ? v : new Date(v); }

/** Where an AI action stands right now, for every signed-in user (no key, no figures): { on, reason }. */
function aiState_(cfg, feature) {
  cfg = cfg || aiCfg_();
  if (cfg.emergency) return { on: false, reason: 'AI has been stopped by the administrator.' };
  if (!cfg.enabled) return { on: false, reason: 'AI recruitment is switched off.' };
  if (!aiKey_()) return { on: false, reason: 'AI recruitment is not connected yet (no API key).' };
  if (feature && !cfg.features[feature]) return { on: false, reason: 'This AI feature is not switched on.' };
  return { on: true, reason: '' };
}
/** What the page needs to show or hide the AI buttons. Never any key, figure or setting. */
function aiPublic_(u) {
  try {
    const cfg = aiCfg_(), st = aiState_(cfg), f = {};
    AI_FEATURES_.forEach(function (x) { f[x.id] = st.on && cfg.features[x.id] && can_(u, 'ai_run'); });
    return { on: st.on && can_(u, 'ai_run'), reason: st.on ? '' : st.reason, features: f, maxFileMb: cfg.maxFileMb, maxPages: cfg.maxPages };
  } catch (e) { return { on: false, reason: 'AI recruitment is unavailable.', features: {} }; }
}

/* ------------------------------------------------------------------ usage and budget ------------------------------ */
function aiPrice_(model, when) {
  const d = ymd_(when || new Date());
  const rows = readTable_(AI_PRICING_.name).rows.filter(function (r) { return r.Model === model && ymd_(aiToDate_(r.From_Date)) <= d; });
  rows.sort(function (a, b) { return ymd_(aiToDate_(b.From_Date)) < ymd_(aiToDate_(a.From_Date)) ? -1 : 1; });
  return rows[0] ? { inM: Number(rows[0].In_per_M_USD) || 0, outM: Number(rows[0].Out_per_M_USD) || 0 } : null;
}
function aiCost_(model, tin, tout, when) {
  const p = aiPrice_(model, when);
  return p ? Math.round((tin * p.inM + tout * p.outM)) / 1e6 : 0;
}
/** Money counted against this month: finished calls plus calls reserved and not yet finished (a reservation older than 15 minutes is treated as abandoned and no longer counts). */
function aiMonthSpend_(rows, now) {
  const m = aiMonth_(now), cut = new Date(now.getTime() - 15 * 60000);
  let spent = 0;
  rows.forEach(function (r) {
    const w = aiToDate_(r.When); if (aiMonth_(w) !== m) return;
    if (String(r.Outcome) === 'Reserved' && w < cut) return;
    spent += Number(r.Est_Cost_USD) || 0;
  });
  return spent;
}
/**
 * Reserves the estimated cost of one call under the script lock, so two calls started together cannot both pass a budget that only fits one.
 * Also enforces the concurrent-call limit. Returns the usage row id; aiSettle_ turns the reservation into the real figure.
 */
function aiReserve_(u, feature, model, estIn, estOut, candId) {
  return withLock_(function () {
    const cfg = aiCfg_(), now = new Date(), rows = readTable_(AI_USAGE_.name, true).rows;
    const est = aiCost_(model, estIn, estOut, now), spent = aiMonthSpend_(rows, now);
    if (cfg.budgetUsd <= 0 || spent + est > cfg.budgetUsd) throw new Error('The monthly AI budget has been reached, so new AI requests are paused. An administrator can raise it in Admin → AI Recruitment.');
    const cut = new Date(now.getTime() - 15 * 60000);
    const live = rows.filter(function (r) { return String(r.Outcome) === 'Reserved' && aiToDate_(r.When) >= cut; }).length;
    if (live >= cfg.maxConcurrent) throw new Error('Other AI requests are still running. Wait a moment and try again.');
    const o = insert_(AI_USAGE_, { When: now, Feature: feature, User: u.email, Model: model, Candidate_ID: candId || '', Outcome: 'Reserved', Error_Class: '', Tokens_In: 0, Tokens_Out: 0, Est_Cost_USD: est, Duration_Ms: 0, Reserved: est }, u);
    return o[AI_USAGE_.id];
  });
}
function aiSettle_(u, id, model, outcome, cls, tin, tout, ms) {
  const cost = aiCost_(model, tin || 0, tout || 0, new Date());
  try { update_(AI_USAGE_, id, { Outcome: outcome, Error_Class: cls || '', Tokens_In: tin || 0, Tokens_Out: tout || 0, Est_Cost_USD: cost, Duration_Ms: ms || 0 }, u); } catch (e) { }
  return cost;
}

/* ------------------------------------------------------------------ the call ------------------------------------- */
/** Plain-language text for each class of failure. The provider's own message is never shown. */
function aiMessage_(cls) {
  return ({
    auth: 'The AI connection was refused: the API key is invalid or has been revoked. An administrator should replace it in Admin → AI Recruitment.',
    credits: 'The AI account has no credit left (or a spending limit was reached at the provider). An administrator should top it up.',
    rate: 'The AI service is busy (rate limit). Wait a minute and try again.',
    unavailable: 'The AI service is temporarily unavailable. Try again shortly. Normal CRM work is not affected.',
    network: 'The AI service could not be reached. Try again shortly.',
    bad_request: 'The AI request was not accepted. Try again; if it keeps happening, tell the administrator.',
    refused: 'The AI declined to process this content. Nothing was changed.',
    truncated: 'The AI answer was cut off because it was too long. Nothing was changed; try again with less text.',
    bad_response: 'The AI answered in an unexpected form, so nothing was used. Try again.',
    nokey: 'AI recruitment is not connected yet (no API key).'
  })[cls] || 'The AI request failed. Nothing was changed.';
}
function aiClassify_(code, text) {
  const t = String(text || '').toLowerCase();
  if (code === 401 || code === 403) return 'auth';
  if (code === 402 || /credit balance|billing|spend limit|usage limit/.test(t)) return 'credits';
  if (code === 429) return 'rate';
  if (code === 529 || code >= 500) return 'unavailable';
  if (code === 408 || code === 409) return 'unavailable';
  return 'bad_request';
}
/** Removes the key (and anything shaped like one) from text before it can reach a log, an audit row or the browser. */
function aiScrub_(s, key) {
  let t = String(s == null ? '' : s);
  if (key) t = t.split(key).join('***');
  return t.replace(/sk-ant-[A-Za-z0-9_\-]{6,}/g, '***');
}
/** A small JSON-schema check (type, required, enum, properties, items): a valid shape is not a true answer, it only stops malformed data. */
function aiValidate_(v, sc, path) {
  path = path || '$';
  if (!sc) return null;
  const ty = sc.type;
  if (ty) {
    const ok = ty === 'array' ? Array.isArray(v) : ty === 'object' ? (v && typeof v === 'object' && !Array.isArray(v)) : ty === 'integer' ? (typeof v === 'number' && v % 1 === 0) : ty === 'null' ? v === null : typeof v === ty;
    if (!ok && !(Array.isArray(ty) && ty.some(function (t) { return aiValidate_(v, { type: t }, path) === null; }))) return path + ' should be ' + ty;
  }
  if (sc.enum && sc.enum.indexOf(v) < 0) return path + ' is not an allowed value';
  if (v && typeof v === 'object' && !Array.isArray(v) && sc.properties) {
    for (const k of (sc.required || [])) if (!(k in v)) return path + '.' + k + ' is missing';
    for (const k of Object.keys(sc.properties)) if (k in v) { const e = aiValidate_(v[k], sc.properties[k], path + '.' + k); if (e) return e; }
  }
  if (Array.isArray(v) && sc.items) for (let i = 0; i < v.length; i++) { const e = aiValidate_(v[i], sc.items, path + '[' + i + ']'); if (e) return e; }
  return null;
}
/**
 * One request to the Messages API. o = { model, system, user, schema?, maxTokens, effort?, key? }.
 * Returns { ok, cls, data, text, tin, tout, ms }. Never throws for a provider failure; the caller turns cls into aiMessage_().
 * Transient failures (rate limit, overload, network) are retried twice with a growing wait; a refused key or a bad request is not retried.
 */
function aiCall_(o) {
  const key = o.key || aiKey_(), t0 = Date.now();
  if (!key) return { ok: false, cls: 'nokey', ms: 0, tin: 0, tout: 0 };
  const body = { model: o.model, max_tokens: o.maxTokens || 1024, system: o.system, messages: [{ role: 'user', content: o.user }], output_config: { effort: o.effort || 'low' } };
  if (o.schema) body.output_config.format = { type: 'json_schema', schema: o.schema };
  const opt = { method: 'post', contentType: 'application/json', headers: { 'x-api-key': key, 'anthropic-version': AI_API_VERSION_ }, payload: JSON.stringify(body), muteHttpExceptions: true };
  let last = null;
  for (let n = 0; n < 3; n++) {
    if (n) Utilities.sleep(1000 * Math.pow(3, n - 1));
    let res;
    try { res = UrlFetchApp.fetch(AI_API_URL_, opt); } catch (e) { last = { ok: false, cls: 'network' }; continue; }
    const code = res.getResponseCode(), txt = res.getContentText();
    if (code >= 200 && code < 300) {
      let j; try { j = JSON.parse(txt); } catch (e) { return { ok: false, cls: 'bad_response', ms: Date.now() - t0, tin: 0, tout: 0 }; }
      const u = j.usage || {}, tin = Number(u.input_tokens) || 0, tout = Number(u.output_tokens) || 0, ms = Date.now() - t0;
      if (j.stop_reason === 'refusal') return { ok: false, cls: 'refused', ms: ms, tin: tin, tout: tout };
      if (j.stop_reason === 'max_tokens') return { ok: false, cls: 'truncated', ms: ms, tin: tin, tout: tout };
      const text = (j.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
      let data = null;
      if (o.schema) {
        try { data = JSON.parse(text); } catch (e) { return { ok: false, cls: 'bad_response', ms: ms, tin: tin, tout: tout }; }
        if (aiValidate_(data, o.schema)) return { ok: false, cls: 'bad_response', ms: ms, tin: tin, tout: tout };
      }
      return { ok: true, cls: '', data: data, text: text, tin: tin, tout: tout, ms: ms };
    }
    last = { ok: false, cls: aiClassify_(code, txt), tin: 0, tout: 0 };
    if (['rate', 'unavailable', 'network'].indexOf(last.cls) < 0) break;   // a refused key, no credit or a bad request will not get better by waiting
  }
  last.ms = Date.now() - t0; last.tin = last.tin || 0; last.tout = last.tout || 0;
  return last;
}
/**
 * The one entrance for every AI feature: permission, switches, key, budget reservation, the call, the usage row. Returns { data, text, cost }
 * or throws an Error whose message is safe to show. o = { feature, system, user, schema, maxTokens, candId }.
 */
function aiRun_(u, o) {
  aiSchema_();
  if (!can_(u, 'ai_run')) throw new Error('You do not have permission to use AI actions.');
  const cfg = aiCfg_(), st = aiState_(cfg, o.feature);
  if (!st.on) throw new Error(st.reason);
  const model = cfg.models[o.feature] || AI_DEFAULT_MODEL_, maxOut = Math.min(o.maxTokens || cfg.maxOutTokens, cfg.maxOutTokens);
  const estIn = Math.ceil((String(o.system || '').length + String(o.user || '').length) / 3) + 200;
  const id = aiReserve_(u, o.feature, model, estIn, maxOut, o.candId);
  let r;
  try { r = aiCall_({ model: model, system: o.system, user: o.user, schema: o.schema, maxTokens: maxOut, effort: o.effort }); }
  catch (e) { r = { ok: false, cls: 'network', tin: 0, tout: 0, ms: 0 }; }
  const cost = aiSettle_(u, id, model, r.ok ? 'Done' : 'Failed', r.cls, r.tin, r.tout, r.ms);
  if (!r.ok) throw new Error(aiMessage_(r.cls));
  return { data: r.data, text: r.text, cost: cost, model: model, usageId: id, tin: r.tin, tout: r.tout, ms: r.ms };
}

/* ------------------------------------------------------------------ connection (key) ----------------------------- */
function aiCredLog_(u, action, ok, ver, note) {
  try { insert_(AI_CREDLOG_, { When: new Date(), Admin: u.email, Action: action, Success: ok ? 'Yes' : 'No', Key_Version: ver || '', Note: note || '' }, u); } catch (e) { }
}
function aiKeyOut_() {
  const key = aiKey_(), m = aiMeta_(), last = m.last || null;
  return { status: !key ? 'Not configured' : (last && last.ok === false ? 'Validation failed' : 'Connected'),
    configured: !!key, hint: key ? '…' + key.slice(-4) : '', version: String(m.ver || ''), updatedBy: m.updatedBy || '', updatedOn: m.updatedOn || '',
    lastTest: last ? { on: last.on, ok: !!last.ok, by: last.by || '', message: last.ok ? '' : aiMessage_(last.cls) } : null };
}
/** A tiny synthetic request: no candidate data. It costs a fraction of a cent; the usage is recorded. */
function aiPing_(key, u) {
  const r = aiCall_({ key: key, model: AI_TEST_MODEL_, system: 'You are a connection check.', user: 'Reply with the single word OK.', maxTokens: 256, effort: 'low' });
  try { insert_(AI_USAGE_, { When: new Date(), Feature: 'Connection test', User: u.email, Model: AI_TEST_MODEL_, Candidate_ID: '', Outcome: r.ok ? 'Done' : 'Failed', Error_Class: r.cls || '', Tokens_In: r.tin || 0, Tokens_Out: r.tout || 0, Est_Cost_USD: aiCost_(AI_TEST_MODEL_, r.tin || 0, r.tout || 0, new Date()), Duration_Ms: r.ms || 0, Reserved: 0 }, u); } catch (e) { }
  return r;
}
function apiAiKeyStatus() { const u = currentUser_(); aiSchema_(); requireAiCred_(u); return aiKeyOut_(); }

function apiAiKeySave(d) {
  const u = currentUser_(); aiSchema_(); requireAiCred_(u); d = d || {};
  const key = String(d.apiKey == null ? '' : d.apiKey).trim();
  if (!/^sk-ant-[A-Za-z0-9_\-]{20,300}$/.test(key)) throw new Error('That does not look like an Anthropic API key (it starts with sk-ant-). Paste it exactly as the Anthropic console shows it.');
  const expect = String(d.expectedVersion == null ? '' : d.expectedVersion);
  let meta = aiMeta_();
  if (String(meta.ver || '') !== expect) throw new Error('The AI connection was changed by ' + (meta.updatedBy || 'someone else') + ' while this page was open. Reload the page and try again.');
  const r = aiPing_(key, u);   // network call outside the lock; the saved key is untouched until it succeeds
  if (!r.ok) { aiCredLog_(u, meta.ver ? 'Replace' : 'Add', false, meta.ver, r.cls); throw new Error('The new key was not saved and the current connection was not changed. ' + aiMessage_(r.cls)); }
  const ver = Utilities.getUuid().slice(0, 8), now = new Date().toISOString();
  withLock_(function () {
    meta = aiMeta_();
    if (String(meta.ver || '') !== expect) throw new Error('The AI connection was changed by ' + (meta.updatedBy || 'someone else') + ' while this key was being checked. Reload the page and try again.');
    PropertiesService.getScriptProperties().setProperties({ [AI_KEY_PROP_]: key, [AI_META_PROP_]: JSON.stringify({ ver: ver, updatedBy: u.email, updatedOn: now, last: { on: now, ok: true, by: u.email, cls: '' } }) });
  });
  aiCredLog_(u, expect ? 'Replace' : 'Add', true, ver, '');
  return aiKeyOut_();
}
function apiAiKeyTest() {
  const u = currentUser_(); aiSchema_(); requireAiCred_(u);
  const key = aiKey_(); if (!key) throw new Error(aiMessage_('nokey'));
  const r = aiPing_(key, u), meta = aiMeta_(), now = new Date().toISOString();
  meta.last = { on: now, ok: r.ok, by: u.email, cls: r.cls || '' };
  PropertiesService.getScriptProperties().setProperty(AI_META_PROP_, JSON.stringify(meta));
  aiCredLog_(u, 'Test', r.ok, meta.ver, r.cls);
  return aiKeyOut_();
}
function apiAiKeyRemove(d) {
  const u = currentUser_(); aiSchema_(); requireAiCred_(u); d = d || {};
  if (d.confirm !== true) throw new Error('Confirm that you want to remove the key.');
  const meta = aiMeta_(), p = PropertiesService.getScriptProperties();
  p.deleteProperty(AI_KEY_PROP_); p.deleteProperty(AI_META_PROP_);
  aiCredLog_(u, 'Remove', true, meta.ver, '');
  return aiKeyOut_();
}

/* ------------------------------------------------------------------ settings (Admin) ----------------------------- */
function aiSettingsOut_() {
  const c = aiCfg_();
  return { enabled: c.enabled, emergency: c.emergency, maxFileMb: c.maxFileMb, maxPages: c.maxPages, maxOutTokens: c.maxOutTokens, batchLimit: c.batchLimit,
    maxConcurrent: c.maxConcurrent, budgetUsd: c.budgetUsd, warnPct: c.warnPct,
    features: AI_FEATURES_.map(function (f) { return { id: f.id, label: f.label, built: f.built, on: c.features[f.id], model: c.models[f.id] }; }), models: AI_MODELS_ };
}
function apiAiSettings() { const u = currentUser_(); aiSchema_(); requireAiSettings_(u); return aiSettingsOut_(); }
function apiAiSettingsSave(d) {
  const u = currentUser_(); aiSchema_(); requireAiSettings_(u); d = d || {};
  const before = aiCfg_(), w = [], num = function (v, lab, lo, hi, whole) {
    const n = Number(v); if (v === '' || v == null || !isFinite(n) || n < lo || n > hi || (whole && n % 1)) throw new Error(lab + ' must be ' + (whole ? 'a whole number' : 'a number') + ' from ' + lo + ' to ' + hi + '.');
    return n;
  };
  const put = function (k, label, v, old) { if (String(v) !== String(old)) w.push([k, label, v]); };
  put('AI_ENABLED', 'AI recruitment', d.enabled === true ? 'Yes' : 'No', before.enabled ? 'Yes' : 'No');
  put('AI_EMERGENCY_STOP', 'emergency stop', d.emergency === true ? 'Yes' : 'No', before.emergency ? 'Yes' : 'No');
  put('AI_MAX_FILE_MB', 'maximum file size', num(d.maxFileMb, 'Maximum file size (MB)', 1, 10, false), before.maxFileMb);
  put('AI_MAX_PAGES', 'maximum pages', num(d.maxPages, 'Maximum pages', 1, 60, true), before.maxPages);
  put('AI_MAX_OUT_TOKENS', 'maximum answer length', num(d.maxOutTokens, 'Maximum answer length (tokens)', 256, 16000, true), before.maxOutTokens);
  put('AI_BATCH_LIMIT', 'bulk batch limit', num(d.batchLimit, 'Bulk batch limit', 1, 100, true), before.batchLimit);
  put('AI_MAX_CONCURRENT', 'concurrent requests', num(d.maxConcurrent, 'Maximum concurrent requests', 1, 5, true), before.maxConcurrent);
  put('AI_MONTHLY_BUDGET_USD', 'monthly budget', num(d.budgetUsd, 'Monthly budget (USD)', 0, 100000, false), before.budgetUsd);
  put('AI_WARN_PCT', 'warning threshold', num(d.warnPct, 'Warning threshold (%)', 1, 100, true), before.warnPct);
  const fs = d.features || {};
  AI_FEATURES_.forEach(function (f) {
    const x = fs[f.id] || {}, K = f.id.toUpperCase();
    if (f.built) put('AI_FEAT_' + K, f.label + ' switch', x.on === true ? 'Yes' : 'No', before.features[f.id] ? 'Yes' : 'No');
    const m = String(x.model || before.models[f.id]);
    if (!AI_MODELS_.some(function (a) { return a.id === m; })) throw new Error('Choose one of the listed models for ' + f.label + '.');
    put('AI_MODEL_' + K, f.label + ' model', m, before.models[f.id]);
  });
  w.forEach(function (x) { setSetting_(x[0], x[2], 'AI recruitment'); });
  if (w.length) audit_(u, 'AI recruitment', '', 'Settings changed', '', '', w.map(function (x) { return x[1]; }).join(', '));
  return aiSettingsOut_();
}

/* ------------------------------------------------------------------ usage view ----------------------------------- */
function apiAiUsage(d) {
  const u = currentUser_(); aiSchema_();
  if (!can_(u, 'ai_usage')) throw new Error('You do not have permission to see AI usage.');
  d = d || {};
  const now = new Date(), from = d.from ? parseYmd_(d.from) : parseYmd_(aiMonth_(now) + '-01'), to = d.to ? parseYmd_(d.to) : now;
  const toEnd = new Date(to.getTime() + 86399000);
  const all = readTable_(AI_USAGE_.name, true).rows, cfg = aiCfg_();
  const rows = all.filter(function (r) { const w = aiToDate_(r.When); return w >= from && w <= toEnd; });
  const agg = function (keyFn) {
    const m = {};
    rows.forEach(function (r) {
      const k = keyFn(r), a = m[k] = m[k] || { key: k, requests: 0, ok: 0, failed: 0, tin: 0, tout: 0, cost: 0, ms: 0 };
      if (String(r.Outcome) === 'Reserved') return;
      a.requests++; if (String(r.Outcome) === 'Done') a.ok++; else a.failed++;
      a.tin += Number(r.Tokens_In) || 0; a.tout += Number(r.Tokens_Out) || 0; a.cost += Number(r.Est_Cost_USD) || 0; a.ms += Number(r.Duration_Ms) || 0;
    });
    return Object.keys(m).map(function (k) { const a = m[k]; a.cost = Math.round(a.cost * 10000) / 10000; a.avgMs = a.requests ? Math.round(a.ms / a.requests) : 0; return a; }).sort(function (x, y) { return y.cost - x.cost; });
  };
  const spent = aiMonthSpend_(all, now), pct = cfg.budgetUsd > 0 ? Math.round(spent / cfg.budgetUsd * 1000) / 10 : 100;
  const drafts = readTable_(AI_DRAFTS_.name, true).rows.filter(function (r) { const w = aiToDate_(r.Created_At); return w >= from && w <= toEnd; });
  const acc = drafts.filter(function (r) { return r.Status === 'Accepted'; }).length, dis = drafts.filter(function (r) { return r.Status === 'Discarded'; }).length;
  const tot = agg(function () { return 'all'; })[0] || { requests: 0, ok: 0, failed: 0, tin: 0, tout: 0, cost: 0, avgMs: 0 };
  return { from: ymd_(from), to: ymd_(to), total: tot, byFeature: agg(function (r) { return String(r.Feature); }), byUser: agg(function (r) { return String(r.User); }),
    budget: { limitUsd: cfg.budgetUsd, spentUsd: Math.round(spent * 10000) / 10000, pct: pct, level: pct >= 100 ? 'reached' : pct >= cfg.warnPct ? 'warn' : 'ok', month: aiMonth_(now) },
    acceptance: { accepted: acc, discarded: dis, rate: acc + dis ? Math.round(acc / (acc + dis) * 100) : null },
    note: 'These figures cover requests made through this CRM, priced from the dated rates in AI_Pricing. They are estimates and may differ from the provider’s invoice or account balance.' };
}
