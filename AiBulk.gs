/**
 * AI Recruitment, Stage 3, release 1: bulk runs with a queue (v239, ADR-089).
 *
 * A bulk run asks the AI for a candidate summary, a vacancy comparison or a screening sheet for several candidates of ONE position. It is a
 * convenience wrapper only: the page reads each CV in the browser (the server never parses CV files) and calls the same per-candidate endpoints
 * as the single-candidate buttons, one candidate at a time. So permission, switches, the budget reservation and the concurrency limit are all
 * enforced by aiRun_ per request, exactly as before. This file keeps the queue: what is waiting, what is done and which draft each result is.
 *
 * Results are only ever Drafts. There is no accept-all, no ranking and no score.
 * A queue row is an AI_Jobs row with a Batch_ID. Status: Queued, Running, Ready, Reused, Skipped, Failed, Stopped.
 */
const AI_BULK_ACTIONS_ = {
  summary: { label: 'Candidate summary', feature: 'summary' },
  compare: { label: 'Comparison with this vacancy', feature: 'compare' },
  screening: { label: 'Screening sheet preparation', feature: 'screening' }
};
/** Average tokens (in, out) per request, used for the estimate only until real usage exists. */
const AI_BULK_DEFAULT_TOKENS_ = { summary: [5000, 900], compare: [7000, 2500], screening: [6000, 1200] };
const AI_BULK_STALE_MIN_ = 3;     // a row left Running this long was abandoned (the page was closed)

function aiBulkRequire_(u) { if (!can_(u, 'ai_bulk')) throw new Error('You do not have permission to run AI actions in bulk.'); }
function aiBulkActions_(list) {
  const out = []; (Array.isArray(list) ? list : []).forEach(function (a) { const k = String(a); if (AI_BULK_ACTIONS_[k] && out.indexOf(k) < 0) out.push(k); });
  if (!out.length) throw new Error('Choose at least one AI action.');
  return out;
}
/** The message of a failed request, mapped to "this will fail the same way for every later candidate" (a reason to stop the batch), or ''. */
function aiBulkStopReason_(message, trailingFails) {
  const m = String(message || '');
  if (/monthly AI budget has been reached/i.test(m)) return 'The monthly AI budget was reached.';
  if (/switched off|stopped by the administrator|not connected yet|not switched on|no API key/i.test(m)) return m.slice(0, 200);
  if (/API key is invalid|no credit left/i.test(m)) return m.slice(0, 200);
  if (/do not have permission/i.test(m)) return m.slice(0, 200);
  if (trailingFails >= 3) return 'Stopped after 3 requests in a row failed. Try again later, or check Admin → AI Recruitment.';
  return '';
}
function aiBulkRows_() { aiSchema_(); return readTable_(AI_JOBS_.name, true).rows.filter(function (r) { return String(r.Batch_ID || '') !== ''; }); }
function aiBulkWrite_(rowId, patch, u) { update_(AI_JOBS_, String(rowId), patch, u); }
function aiBulkIsOpen_(r) { return r.Status === 'Queued' || r.Status === 'Running'; }
function aiBulkAvg_(rows, feature) {
  const done = rows.filter(function (r) { return String(r.Feature) === feature && String(r.Outcome) === 'Done' && Number(r.Tokens_In) > 0; }).slice(-50);
  if (!done.length) return AI_BULK_DEFAULT_TOKENS_[feature];
  let a = 0, b = 0; done.forEach(function (r) { a += Number(r.Tokens_In) || 0; b += Number(r.Tokens_Out) || 0; });
  return [Math.round(a / done.length), Math.round(b / done.length)];
}

/** One verdict per card, without any AI request: { ready, reasons[] per action }. */
function aiBulkCheck_(u, lineId, appIds, actions) {
  aiSchema_(); aiBulkRequire_(u);
  const cfg = aiCfg_(), line = requireOnPosition_(u, lineId);
  const ids = []; (appIds || []).forEach(function (x) { const k = String(x); if (k && ids.indexOf(k) < 0) ids.push(k); });
  if (!ids.length) throw new Error('Tick at least one candidate.');
  if (ids.length > cfg.batchLimit) throw new Error('A bulk run can hold at most ' + cfg.batchLimit + ' candidates (the limit is set in Admin → AI Recruitment).');
  actions.forEach(function (a) { const st = aiState_(cfg, AI_BULK_ACTIONS_[a].feature); if (!st.on) throw new Error(AI_BULK_ACTIONS_[a].label + ': ' + st.reason); });
  let reqOk = null, reqWhy = '';
  if (actions.indexOf('compare') >= 0) { try { reqOk = aiRequirements_(line).reqs.length > 0; if (!reqOk) reqWhy = 'This position has no approved requirements yet.'; } catch (e) { reqOk = false; reqWhy = String(e && e.message || e).slice(0, 160); } }
  const names = {}; readTable_(T.CAND.name).rows.forEach(function (c) { names[String(c.Candidate_ID)] = c; });
  const rows = ids.map(function (id) {
    const o = { app: id, name: '', cand: '', actions: {}, ready: false };
    let app = null;
    try { app = appOf_(id); } catch (e) { o.reason = 'Not found.'; return o; }
    const cand = names[String(app.Candidate_ID)] || null;
    o.name = cand ? String(cand.Name) : String(app.Candidate_ID); o.cand = String(app.Candidate_ID);
    if (String(app.Line_ID) !== String(lineId)) { o.reason = 'Not on this position.'; return o; }
    if (String(app.Status) !== 'Active') { o.reason = 'The card is ' + String(app.Status).toLowerCase() + '.'; return o; }
    if (!cand) { o.reason = 'The candidate record was not found.'; return o; }
    if (!cand.CV_File_URL) { o.reason = 'No CV is on file.'; return o; }
    actions.forEach(function (a) {
      let why = '';
      if (a === 'compare' && !reqOk) why = reqWhy || 'This position has no approved requirements yet.';
      if (a === 'screening') { try { if (!aiScreenItems_(app).items.length) why = 'This position has no screening questions.'; } catch (e) { why = String(e && e.message || e).slice(0, 160); } }
      o.actions[a] = why;
    });
    o.ready = actions.some(function (a) { return !o.actions[a]; });
    return o;
  });
  return { cfg: cfg, line: line, rows: rows };
}
function aiBulkPreviewOut_(u, lineId, appIds, actions) {
  const chk = aiBulkCheck_(u, lineId, appIds, actions), cfg = chk.cfg, usage = readTable_(AI_USAGE_.name, true).rows, now = new Date();
  let requests = 0, est = 0, max = 0;
  const per = {}; actions.forEach(function (a) { per[a] = 0; });
  chk.rows.forEach(function (r) { actions.forEach(function (a) { if (r.ready && !r.actions[a]) per[a]++; }); });
  actions.forEach(function (a) {
    const f = AI_BULK_ACTIONS_[a].feature, model = cfg.models[f] || AI_DEFAULT_MODEL_, avg = aiBulkAvg_(usage, f), n = per[a];
    requests += n; est += n * aiCost_(model, avg[0], avg[1], now); max += n * aiCost_(model, Math.round(avg[0] * 1.6), Math.min(cfg.maxOutTokens, Math.round(avg[1] * 2.5)), now);
  });
  const spent = aiMonthSpend_(usage, now), left = Math.max(0, cfg.budgetUsd - spent);
  return { rows: chk.rows, actions: actions.map(function (a) { return { id: a, label: AI_BULK_ACTIONS_[a].label, requests: per[a] }; }), ready: chk.rows.filter(function (r) { return r.ready; }).length,
    skipped: chk.rows.filter(function (r) { return !r.ready; }).length, requests: requests, estUsd: Math.round(est * 10000) / 10000, maxUsd: Math.round(max * 10000) / 10000,
    budget: { limitUsd: cfg.budgetUsd, spentUsd: Math.round(spent * 10000) / 10000, leftUsd: Math.round(left * 10000) / 10000 }, fits: est <= left, batchLimit: cfg.batchLimit,
    note: 'An earlier identical draft (same CV, record and settings) is reused at no cost, so the real cost can be lower. These are estimates from past requests.' };
}
function apiAiBulkPreview(lineId, appIds, actions) { const u = currentUser_(); return aiBulkPreviewOut_(u, String(lineId || ''), appIds, aiBulkActions_(actions)); }

/** Puts one row per candidate and action in the queue. One open batch per person. Nothing is sent to the AI here. */
function apiAiBulkStart(lineId, appIds, actions) {
  const u = currentUser_(); aiSchema_();
  actions = aiBulkActions_(actions);
  const pv = aiBulkPreviewOut_(u, String(lineId || ''), appIds, actions);
  if (!pv.requests) throw new Error('Nothing can be run for the ticked candidates. Open the check to see why.');
  if (!pv.fits) throw new Error('The estimated cost ($' + pv.estUsd.toFixed(2) + ') is more than the budget left this month ($' + pv.budget.leftUsd.toFixed(2) + '). Raise the budget in Admin → AI Recruitment, or choose fewer candidates.');
  let batch = '';
  withLock_(function () {
    const now = new Date(), mine = aiBulkRows_().filter(function (r) { return String(r.Requested_By).toLowerCase() === u.email && aiBulkIsOpen_(r) && !(r.Status === 'Running' && now - aiToDate_(r.Started_At) > AI_BULK_STALE_MIN_ * 60000); });
    if (mine.length) throw new Error('You already have a bulk run in progress. Stop it or let it finish first.');
    batch = 'AIB-' + Utilities.formatDate(now, TZ, 'yyyyMMdd-HHmmss') + '-' + Utilities.getUuid().slice(0, 4);
    pv.rows.forEach(function (r) {
      if (!r.ready) return;
      actions.forEach(function (a) {
        if (r.actions[a]) return;
        insert_(AI_JOBS_, { Feature: AI_BULK_ACTIONS_[a].feature, Status: 'Queued', Candidate_ID: r.cand, App_ID: r.app, Line_ID: String(lineId), Batch_ID: batch, Requested_By: u.email, Requested_At: now, Attempts: 0, Note: '' }, u);
      });
    });
    audit_(u, 'AI_Jobs', batch, 'Bulk run started', 'Requests', '', pv.requests + ' requests for ' + pv.ready + ' candidates (' + actions.join(', ') + ')');
  });
  return { batch: batch, requests: pv.requests, ready: pv.ready, skipped: pv.skipped };
}
function aiBulkOwn_(u, batchId) {
  const rows = aiBulkRows_().filter(function (r) { return String(r.Batch_ID) === String(batchId); });
  if (!rows.length) throw new Error('That bulk run was not found.');
  if (String(rows[0].Requested_By).toLowerCase() !== u.email && !isLead_(u)) throw new Error('This bulk run belongs to another user.');
  return rows;
}
/** Hands the page the next waiting row and marks it Running. A row left Running by a closed page is put back once, then failed. Returns { done:true } when nothing is waiting. */
function apiAiBulkNext(batchId) {
  const u = currentUser_(); aiSchema_(); aiBulkRequire_(u);
  return withLock_(function () {
    const rows = aiBulkOwn_(u, batchId), now = new Date();
    if (String(rows[0].Requested_By).toLowerCase() !== u.email) throw new Error('Only the person who started this bulk run can continue it.');
    rows.forEach(function (r) {
      if (r.Status === 'Running' && now - aiToDate_(r.Started_At) > AI_BULK_STALE_MIN_ * 60000) {
        if ((Number(r.Attempts) || 0) >= 2) { aiBulkWrite_(r.Job_ID, { Status: 'Failed', Error_Class: 'interrupted', Note: 'The page was closed while this was running.', Finished_At: now }, u); r.Status = 'Failed'; }
        else { aiBulkWrite_(r.Job_ID, { Status: 'Queued' }, u); r.Status = 'Queued'; }
      }
    });
    if (rows.some(function (r) { return r.Status === 'Running'; })) return { done: false, busy: true, left: rows.filter(function (r) { return r.Status === 'Queued'; }).length };
    const next = rows.filter(function (r) { return r.Status === 'Queued'; })[0];
    if (!next) return { done: true, counts: aiBulkCounts_(rows) };
    aiBulkWrite_(next.Job_ID, { Status: 'Running', Started_At: now, Attempts: (Number(next.Attempts) || 0) + 1 }, u);
    return { done: false, row: { id: String(next.Job_ID), action: Object.keys(AI_BULK_ACTIONS_).filter(function (k) { return AI_BULK_ACTIONS_[k].feature === next.Feature; })[0], app: String(next.App_ID), cand: String(next.Candidate_ID) },
      left: rows.filter(function (r) { return r.Status === 'Queued'; }).length - 1 };
  });
}
function aiBulkCounts_(rows) { const c = {}; rows.forEach(function (r) { c[r.Status] = (c[r.Status] || 0) + 1; }); return c; }
/** The page reports what happened to a row. The draft is checked: it must be this user's, for this feature, candidate and application. */
function apiAiBulkMark(batchId, rowId, res) {
  const u = currentUser_(); aiSchema_(); aiBulkRequire_(u); res = res || {};
  const status = String(res.status || '');
  if (['Ready', 'Reused', 'Failed', 'Skipped'].indexOf(status) < 0) throw new Error('Unknown result.');
  return withLock_(function () {
    const rows = aiBulkOwn_(u, batchId), row = rows.filter(function (r) { return String(r.Job_ID) === String(rowId); })[0];
    if (!row) throw new Error('That queue row was not found.');
    if (String(row.Requested_By).toLowerCase() !== u.email) throw new Error('Only the person who started this bulk run can report on it.');
    if (row.Status !== 'Running') return { stop: '', unchanged: true };
    let draftId = '';
    if (status === 'Ready' || status === 'Reused') {
      const d = findRow_(AI_DRAFTS_, String(res.draftId || '')).rec;
      if (!d || String(d.Created_By).toLowerCase() !== u.email || d.Feature !== row.Feature || String(d.Candidate_ID) !== String(row.Candidate_ID) || (row.Feature !== 'summary' && String(d.App_ID) !== String(row.App_ID))) throw new Error('That draft does not belong to this queue row.');
      draftId = String(d.Draft_ID);
    }
    const now = new Date(), err = status === 'Failed' || status === 'Skipped' ? String(res.error || '').replace(/\s+/g, ' ').slice(0, 200) : '';
    aiBulkWrite_(row.Job_ID, { Status: status, Draft_ID: draftId, Note: err, Error_Class: status === 'Failed' ? 'failed' : '', Finished_At: now }, u);
    row.Status = status; row.Finished_At = now;
    let stop = '';
    if (status === 'Failed') {
      let trail = 0; const done = rows.filter(function (r) { return r.Status === 'Ready' || r.Status === 'Reused' || r.Status === 'Failed'; }).sort(function (a, b) { return aiToDate_(a.Finished_At || 0) - aiToDate_(b.Finished_At || 0); });
      for (let i = done.length - 1; i >= 0 && done[i].Status === 'Failed'; i--) trail++;
      stop = aiBulkStopReason_(err, trail);
      if (stop) rows.forEach(function (r) { if (r.Status === 'Queued') aiBulkWrite_(r.Job_ID, { Status: 'Stopped', Note: stop, Finished_At: now }, u); });
    }
    return { stop: stop, unchanged: false };
  });
}
/** Stops the rows still waiting (a request already running carries on). The person who started the run, a lead or the Admin. */
function apiAiBulkStop(batchId) {
  const u = currentUser_(); aiSchema_(); aiBulkRequire_(u);
  return withLock_(function () {
    const rows = aiBulkOwn_(u, batchId), now = new Date(); let n = 0;
    rows.forEach(function (r) { if (r.Status === 'Queued') { aiBulkWrite_(r.Job_ID, { Status: 'Stopped', Note: 'Stopped by ' + u.email.split('@')[0], Finished_At: now }, u); n++; } });
    audit_(u, 'AI_Jobs', String(batchId), 'Bulk run stopped', '', '', n + ' waiting requests stopped');
    return { stopped: n };
  });
}
/** Recent bulk runs with their rows: your own, or all of them for a lead or the Admin. Names are for display in the CRM only. */
function apiAiBulkList(lineId) {
  const u = currentUser_(); aiSchema_(); aiBulkRequire_(u);
  const names = {}; readTable_(T.CAND.name).rows.forEach(function (c) { names[String(c.Candidate_ID)] = String(c.Name); });
  const now = new Date(), by = {}, order = [];
  aiBulkRows_().forEach(function (r) {
    if (!isLead_(u) && String(r.Requested_By).toLowerCase() !== u.email) return;
    if (lineId && String(r.Line_ID) !== String(lineId)) return;
    const k = String(r.Batch_ID), at = aiToDate_(r.Requested_At);
    if (!by[k]) { by[k] = { id: k, by: String(r.Requested_By), line: String(r.Line_ID), at: Utilities.formatDate(at, TZ, 'd MMM yyyy, HH:mm'), ms: at.getTime(), rows: [] }; order.push(k); }
    const stale = r.Status === 'Running' && now - aiToDate_(r.Started_At) > AI_BULK_STALE_MIN_ * 60000;
    by[k].rows.push({ id: String(r.Job_ID), name: names[String(r.Candidate_ID)] || String(r.Candidate_ID), cand: String(r.Candidate_ID), app: String(r.App_ID), line: String(r.Line_ID),
      action: Object.keys(AI_BULK_ACTIONS_).filter(function (a) { return AI_BULK_ACTIONS_[a].feature === r.Feature; })[0] || String(r.Feature), status: stale ? 'Interrupted' : String(r.Status), draftId: String(r.Draft_ID || ''), note: String(r.Note || '') });
  });
  return order.map(function (k) {
    const b = by[k]; b.counts = aiBulkCounts_(b.rows.map(function (x) { return { Status: x.status }; }));
    b.open = (b.counts.Queued || 0) + (b.counts.Running || 0) + (b.counts.Interrupted || 0) > 0 && String(b.by).toLowerCase() === u.email; return b;
  }).sort(function (a, b) { return b.ms - a.ms; }).slice(0, 10);
}
/** The saved draft of a finished row, in the shape the single-candidate dialog shows it, so it can be reviewed, edited, accepted or discarded there. */
function apiAiBulkDraft(draftId) {
  const u = currentUser_(); aiSchema_();
  const rec = aiDraftFor_(u, draftId);
  if (rec.Status !== 'Draft') throw new Error('This draft was already ' + String(rec.Status).toLowerCase() + '.');
  let c = {}; try { c = JSON.parse(String(rec.Content_JSON)) || {}; } catch (e) { throw new Error('The saved draft could not be read.'); }
  const on = rec.Created_At instanceof Date ? ymd_(rec.Created_At) : ymd_(new Date());
  if (rec.Feature === 'summary') { const m = c.meta || {}; return { feature: 'summary', draftId: String(rec.Draft_ID), reused: false, model: m.model || '', generatedOn: on, fileName: String(m.cvName || ''), cvFile: m.cvFile, facts: c.facts || [], dropped: c.dropped || 0, missing: c.missing || [], clarify: c.clarify || [], interpretation: c.interpretation || '', text: c.text || '' }; }
  if (rec.Feature === 'compare') { const line = lineOf_(String(rec.Line_ID)) || {}; return Object.assign({ feature: 'compare', draftId: String(rec.Draft_ID), reused: false, generatedOn: on, position: String(line.Position || '') }, c); }
  throw new Error('Open the candidate’s card to review this draft.');
}
