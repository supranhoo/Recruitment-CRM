/* ---------------- Phase 3: backups, change history, data checks ---------------- */

/** Copies the database into a private Backups folder; keeps BACKUP_KEEP_DAYS days (default 14). */
function backupDb_() {
  const file = DriveApp.getFileById(DB_SPREADSHEET_ID);
  const parents = file.getParents();
  const base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const it = base.getFoldersByName('BFCL Recruitment CRM - Backups');
  const folder = it.hasNext() ? it.next() : base.createFolder('BFCL Recruitment CRM - Backups');
  const name = 'DB backup ' + fmt_(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  const copy = file.makeCopy(name, folder);
  // Prove the copy opens and has every sheet and the same number of positions before it counts as a backup.
  const src = ss_(), chk = SpreadsheetApp.openById(copy.getId());
  if (chk.getSheets().length !== src.getSheets().length) throw new Error('The backup copy has ' + chk.getSheets().length + ' sheets, the database has ' + src.getSheets().length + '.');
  const mrfS = src.getSheetByName(T.MRF.name), mrfC = chk.getSheetByName(T.MRF.name);
  if (!mrfC || mrfC.getLastRow() !== mrfS.getLastRow()) throw new Error('The backup copy has a different number of positions from the database.');
  const keep = Number(settings_().BACKUP_KEEP_DAYS) || 14;
  const cutoff = Date.now() - keep * 86400000;
  const files = folder.getFiles();
  let removed = 0, kept = 0;
  while (files.hasNext()) {
    const f = files.next();
    if (!/^DB backup /.test(f.getName())) continue;
    if (f.getDateCreated().getTime() < cutoff) { f.setTrashed(true); removed++; } else kept++;
  }
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', name);
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_AT', new Date().toISOString());
  return { name: name, kept: kept, removed: removed, folder: folder.getUrl() };
}

function apiBackupNow() {
  requireAdmin_(currentUser_());
  return backupDb_();
}

function apiAdminInfo() {
  const u = currentUser_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can open this page.');
  const props = PropertiesService.getScriptProperties();
  let errors = []; try { errors = JSON.parse(props.getProperty('JOB_LOG') || '[]'); } catch (e) { errors = []; }
  const bk = props.getProperty('LAST_BACKUP_AT') || '';
  const triggers = ScriptApp.getProjectTriggers().map(function (t) { return String(t.getHandlerFunction()); });
  return { lastBackup: props.getProperty('LAST_BACKUP') || '',
    backupStale: !bk || Date.now() - new Date(bk).getTime() > 36 * 3600000,
    jobs: { nightly: props.getProperty('JOB_OK_nightly') || '', refresh: props.getProperty('JOB_OK_refresh') || '' },
    triggers: { nightly: triggers.indexOf('nightlyJob') >= 0, refresh: triggers.indexOf('refreshDashboardJob') >= 0, weekly: triggers.indexOf('weeklySummaryJob') >= 0 },
    errors: errors.slice(0, 10) };
}

/* ---------------- Speed and health check (Admin) ---------------- */

function schemaState_() {
  const props = PropertiesService.getScriptProperties();
  let err = {}, done = []; try { err = JSON.parse(props.getProperty('SCHEMA_ERR') || '{}'); } catch (e) { err = {}; }
  try { done = JSON.parse(props.getProperty('SCHEMA_DONE_' + SCHEMA_VERSION) || '[]'); } catch (e) { done = []; }
  const retry = Number(props.getProperty('SCHEMA_RETRY_AT') || 0);
  return { version: props.getProperty('SCHEMA_V') || '', target: SCHEMA_VERSION, complete: Number(props.getProperty('SCHEMA_V')) >= Number(SCHEMA_VERSION), failures: Number(props.getProperty('SCHEMA_FAILS') || 0),
    nextTry: retry > Date.now() ? new Date(retry).toISOString() : '', steps: done.length, errors: Object.keys(err).map(function (k) { return { step: k, message: String(err[k]) }; }),
    lastMs: Number(props.getProperty('SCHEMA_LAST_MS') || 0) };
}

/** Times, on the server, the calls behind the slow pages, plus the schema state and whether the shared lock is free. Read-only. Admin only. */
function apiSpeedCheck() {
  requireAdmin_(currentUser_());
  const rows = [];
  const time = function (what, fn) {
    const t0 = Date.now(); let note = '';
    try { note = fn() || ''; } catch (e) { note = 'ERROR: ' + String(e && e.message || e).slice(0, 160); }
    rows.push({ what: what, ms: Date.now() - t0, note: String(note) });
  };
  [T.MRF, T.APP, T.HIST, T.FU, T.SCR, T.PDOC, T.POST, T.INT, T.CAND, T.TACT, T.TASK].forEach(function (d) {
    time('Read the sheet ' + d.name + ' (from the sheet, no cache)', function () { _tables = {}; const t = readTable_(d.name, true); return t.rows.length + ' rows, ' + t.headers.length + ' columns'; });
  });
  _tables = {};
  time('Positions list (apiListPositions)', function () { return apiListPositions().length + ' positions'; });
  _tables = {};
  const first = readTable_(T.MRF.name).rows.filter(function (l) { return ['Open', 'Offered'].indexOf(positionStatus_(l)) >= 0; })[0];
  if (first) time('Pipeline board of ' + String(first.MRF_No || first.Line_ID) + ' (apiPipeline)', function () { _tables = {}; return apiPipeline(first.Line_ID).apps.length + ' cards'; });
  _tables = {};
  time('To-do list, first call (allTasks_)', function () { return allTasks_().length + ' to-dos'; });
  time('To-do list, second call (should come from the cache)', function () { return allTasks_().length + ' to-dos'; });
  let free = false; try { const lk = LockService.getScriptLock(); free = lk.tryLock(0); if (free) lk.releaseLock(); } catch (e) { }
  return { at: new Date().toISOString(), build: BUILD_ID, rows: rows, schema: schemaState_(), lockFree: free };
}

/** Runs the schema upgrade again now (only the steps that have not succeeded) and returns its state. Admin only. */
function apiSchemaRetry() {
  requireAdmin_(currentUser_());
  PropertiesService.getScriptProperties().deleteProperty('SCHEMA_RETRY_AT');
  const t0 = Date.now(); ensureSchema_();
  const s = schemaState_(); s.tookMs = Date.now() - t0; return s;
}

/* ---------------- Scheduled-job health ---------------- */

/** Records a failed step of a scheduled job (last 20 kept) and e-mails the Admins once per job step per day. Never throws. */
function jobLog_(job, step, err) {
  try {
    const props = PropertiesService.getScriptProperties();
    let log = []; try { log = JSON.parse(props.getProperty('JOB_LOG') || '[]'); } catch (e) { log = []; }
    const msg = String(err && err.message || err).slice(0, 300);
    log.unshift({ at: new Date().toISOString(), job: job, step: step, msg: msg });
    props.setProperty('JOB_LOG', JSON.stringify(log.slice(0, 20)));
    const day = ymd_(new Date()), key = 'JOB_MAIL_' + job + '_' + step;
    if (props.getProperty(key) === day) return;
    props.setProperty(key, day);
    const to = readTable_('Users').rows.filter(function (r) { return normRole_(r.Role) === ROLES.ADMIN && String(r.Active || 'Yes') !== 'No' && mailTo_(r); }).map(mailTo_).filter(function (e, i, all) { return all.indexOf(e) === i; });
    if (to.length) MailApp.sendEmail(to.join(','), 'BFCL Recruitment CRM: ' + job + ' job step failed (' + step + ')',
      'The ' + job + ' job step "' + step + '" failed at ' + fmt_(new Date(), TZ, 'd MMM yyyy HH:mm') + ' IST.\n\n' + msg + '\n\nOpen Admin \u2192 Tools to see the recent failures. This e-mail is sent once a day per failing step.');
  } catch (e) { console.error('jobLog_: ' + e); }
}
/** Runs one step of a scheduled job so a failure in it does not stop the rest, and is recorded. */
function runStep_(job, step, fn) {
  try { return fn(); } catch (e) { console.error(job + ' / ' + step + ': ' + e); jobLog_(job, step, e); return undefined; }
}
function jobDone_(job) { try { PropertiesService.getScriptProperties().setProperty('JOB_OK_' + job, new Date().toISOString()); } catch (e) { } }

/** Change history from Audit_Log, newest first (max 300 rows). */
function apiAuditLog(f) {
  const u = currentUser_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see the change history.');
  f = f || {};
  const q = String(f.q || '').toLowerCase().trim();
  const rows = readTableFrom_('Audit_Log', 'Timestamp', f.from || '').rows;
  const out = [];
  for (let i = rows.length - 1; i >= 0 && out.length < 300; i--) {
    const r = rows[i];
    const d = ymd_(r.Timestamp);
    if (f.from && d < f.from) continue;
    if (f.to && d > f.to) continue;
    if (f.sheet && String(r.Sheet) !== f.sheet) continue;
    if (q && [r.User, r.Record_ID, r.Field, r.Old_Value, r.New_Value].join(' ').toLowerCase().indexOf(q) < 0) continue;
    out.push({ ts: r.Timestamp instanceof Date ? fmt_(r.Timestamp, TZ, 'd MMM yyyy, HH:mm') : String(r.Timestamp),
      user: String(r.User), sheet: String(r.Sheet), id: String(r.Record_ID), action: String(r.Action), field: String(r.Field),
      oldV: String(r.Old_Value), newV: String(r.New_Value) });
  }
  return out;
}

/** Likely data-entry errors, grouped by check. */
function apiDataChecks() {
  const u = currentUser_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can run data checks.');
  return dataChecks_();
}

function dataChecks_() {
  const checks = [];
  const add = function (key, title, why, entity) { const c = { key: key, title: title, why: why, entity: entity, items: [] }; checks.push(c); return c; };
  const c1 = add('mrf_missing', 'Positions missing key details', 'MRF number, receipt date, grade, department or recruiter is blank.', 'MRF');
  const c2 = add('offer_no_date', 'Offer sent but no offer date', 'Needed for the BGV-before-offer check and backout rate.', 'MRF');
  const c3 = add('doj_order', 'Joining date before offer, MRF or assigned date', 'The dates are in the wrong order; one of them is probably mistyped.', 'MRF');
  const c4 = add('doj_day', 'Joined on a day other than Monday or Thursday', 'Policy 2.3 allows joining on Mondays and Thursdays unless Head HR approves.', 'MRF');
  const c5 = add('mobile', 'Candidates with a missing or invalid mobile number', 'Mobile should be 10 digits.', 'CAND');
  const c6 = add('dup', 'Candidates sharing a mobile number or email', 'Probably the same person entered twice.', 'CAND');
  const c7 = add('selected_unlinked', 'Selected candidates not linked to a position', 'Link them so the position shows who filled it. Only records entered through the app are checked.', 'CAND');
  const c8 = add('notice_proof', 'Notice beyond the grace without proof', 'Notice over 30 days extends the TAT automatically; attach the notice proof or ask the Head of HR to review it (Admin \u2192 TAT exemptions).', 'MRF');
  const c9 = add('daily_dup', 'Daily log entries logged twice for one position and day', 'Their counts are added up, so the day is counted twice. Identical copies can be removed with the button; entries with different numbers need a person to decide.', 'FUNNEL');
  try {
    const lm = {}; readTable_(T.MRF.name).rows.forEach(function (l) { lm[l.Line_ID] = l; });
    funnelDuplicates_().forEach(function (g) { g.extra.forEach(function (e) { const l = lm[e.Line_ID] || {}; c9.items.push({ id: e.Entry_ID, label: String(l.MRF_No || e.Line_ID) + ' \u00b7 ' + String(l.Position || '') + ' (' + String(e.Recruiter || '') + ') \u00b7 ' + ymd_(e.Entry_Date), detail: (funnelSame_(g.keep, e) ? 'Identical to ' : 'Different numbers from ') + g.keep.Entry_ID }); }); });
  } catch (e) { }
  const nctx = tatContext_();
  const weekday = function (ymd) { const p = ymd.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay(); };
  readTable_(T.MRF.name).rows.forEach(function (l) {
    if (positionStatus_(l) === 'Removed') return;
    const label = String(l.MRF_No) + ' \u00b7 ' + l.Position + ' (' + l.Recruiter + ')';
    const miss = ['MRF_No', 'Receipt_Date', 'Grade', 'Dept', 'Recruiter'].filter(function (k) { return !l[k]; });
    if (miss.length) c1.items.push({ id: l.Line_ID, label: label, detail: 'Missing: ' + miss.join(', ').replace(/_/g, ' ') });
    const offer = ymd_(l.Offer_Date), doj = ymd_(l.Actual_DOJ), rec = ymd_(l.Receipt_Date);
    if (String(l.Offer_Sent).toUpperCase() === 'YES' && !offer) c2.items.push({ id: l.Line_ID, label: label, detail: 'Offer sent = Yes' });
    const asg = ymd_(l.Assigned_On);
    if (doj && ((offer && doj < offer) || (rec && doj < rec) || (asg && doj < asg))) c3.items.push({ id: l.Line_ID, label: label, detail: 'MRF ' + rec + (asg ? ' \u00b7 assigned ' + asg : '') + ' \u00b7 offer ' + (offer || '\u2014') + ' \u00b7 joined ' + doj });
    if (String(l.Notice_Ext_Status || '') !== 'Rejected' && !l.Notice_Proof_File && ['Open', 'Offered', 'On Hold'].indexOf(positionStatus_(l)) >= 0) {
      const g = ruleFor_(nctx, l.Grade, tatStart_(l)).grace, n = Number(l.Notice_Period_Days) || 0;
      if (n > g) c8.items.push({ id: l.Line_ID, label: label, detail: 'Notice ' + n + ' days adds ' + (n - g) + ' days to the TAT' });
    }
    if (doj) { const w = weekday(doj); if (w !== 1 && w !== 4) c4.items.push({ id: l.Line_ID, label: label, detail: 'Joined ' + doj + ' (' + ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][w] + ')' }); }
  });
  const seen = {};
  readTable_(T.CAND.name).rows.forEach(function (c) {
    const label = c.Name + ' \u00b7 ' + (c.Position || '');
    const mob = String(c.Mobile || '').replace(/\D/g, '');
    if (mob.length !== 10) c5.items.push({ id: c.Candidate_ID, label: label, detail: c.Mobile ? 'Mobile: ' + c.Mobile : 'No mobile' });
    [mob.length === 10 ? 'm' + mob : '', c.Email ? 'e' + String(c.Email).toLowerCase() : ''].forEach(function (k) {
      if (!k) return;
      if (seen[k] && seen[k] !== c.Candidate_ID) c6.items.push({ id: c.Candidate_ID, label: label, detail: 'Same ' + (k[0] === 'm' ? 'mobile' : 'email') + ' as ' + seen[k] });
      else seen[k] = c.Candidate_ID;
    });
    if (/selected/i.test(String(c.HR_Result)) && !c.Line_ID && String(c.Created_By) !== 'migration') c7.items.push({ id: c.Candidate_ID, label: label, detail: 'HR result Selected' });
  });
  const rc = {
    orphan: add('pipe_orphan', 'Pipeline cards without a candidate record', 'The candidate was deleted but the card stayed. Remove it in the Switch-over check.', 'MRF'),
    offer_unlinked: add('pipe_offer_unlinked', 'Offer on the position but no candidate holds it', 'Record who holds the offer in the Switch-over check.', 'MRF'),
    legacy_backout: add('pipe_legacy_backout', 'Backout recorded by reopening the position', 'Policy 9.5 now raises a replacement MRF. Convert or keep it in the Switch-over check.', 'MRF'),
    joined_open: add('pipe_joined_open', 'Joined in the pipeline but the position is not closed', 'Record the joining date in the Switch-over check.', 'MRF'),
    maybe_closed: add('pipe_maybe_closed', 'Remarks say closed or on hold, but the position is still open', 'Use Close without hiring on the position, or keep it as it is in the Switch-over check.', 'MRF')
  };
  reconcileScan_('', false).forEach(function (it) {
    it.issues.forEach(function (x) { rc[x.code].items.push({ id: it.line.Line_ID, label: it.line.MRF_No + ' \u00b7 ' + it.line.Position + ' (' + it.line.Recruiter + ')', detail: x.text }); });
  });
  const bl = add('bgv_late', 'BGV not started past the start-by date', 'The recruiter owns the case: open the BGV tracker, start it, or record why it is not needed.', 'MRF');
  try { bgvLateCases_().forEach(function (x) { bl.items.push(x); }); } catch (e) { }
  return checks.map(function (c) { c.count = c.items.length; c.items = c.items.slice(0, 200); return c; });
}

/* ---------------- Weekly email summary ---------------- */

function setSetting_(key, value, note) {
  const s = readTable_('Settings', true);
  const row = s.rows.filter(function (r) { return r.Key === key; })[0];
  if (row) s.sheet.getRange(row._row, 2).setValue(value);
  else s.sheet.appendRow([key, value, note || '']);
  dropStale_('Settings');
}

function summaryRecipients_() {
  const extra = String(settings_().WEEKLY_SUMMARY_TO || '').split(/[,;\s]+/).filter(function (e) { return /@/.test(e); });
  const leads = readTable_('Users').rows.filter(function (r) {
    return String(r.Active || 'Yes') !== 'No' && (PERMS_[normRole_(r.Role)] || []).indexOf('lead') >= 0 && mailTo_(r);
  }).map(mailTo_);
  return leads.concat(extra).filter(function (e, i, all) { return all.indexOf(e) === i; });
}

function apiWeeklyStatus() {
  const u = currentUser_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see this.');
  const p = PropertiesService.getScriptProperties();
  return { on: String(settings_().WEEKLY_SUMMARY || 'Off') === 'On', by: p.getProperty('WEEKLY_TRIGGER_BY') || '',
    lastSent: p.getProperty('WEEKLY_LAST_SENT') || '', to: summaryRecipients_() };
}

/** Turns the Monday 9:00 summary on or off. The schedule runs under the admin who turns it on. */
function apiSetWeekly(on) {
  const u = currentUser_(); requireAdmin_(u);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'weeklySummaryJob') ScriptApp.deleteTrigger(t); });
  if (on) ScriptApp.newTrigger('weeklySummaryJob').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
  setSetting_('WEEKLY_SUMMARY', on ? 'On' : 'Off', 'Monday 9:00 email to Admin, Head of HR and TA Lead users (and WEEKLY_SUMMARY_TO)');
  PropertiesService.getScriptProperties().setProperty('WEEKLY_TRIGGER_BY', on ? u.email : '');
  return apiWeeklyStatus();
}

function apiSendSummaryTest() {
  const u = currentUser_(); requireAdmin_(u);
  const to = mailOfLogin_(u.email);
  sendSummary_([to], true);
  return 'Sent to ' + to;
}

function weeklySummaryJob() {
  requireEditorOrAdmin_();
  if (String(settings_().WEEKLY_SUMMARY || 'Off') !== 'On') return;
  const to = summaryRecipients_();
  if (to.length) sendSummary_(to, false);
}

function sendSummary_(to, test) {
  const snap = buildSnapshot_('weekly summary');
  const fy = kpiCurrentFy_();
  const k = computeKpis_(fy);
  const month = fmt_(new Date(), TZ, 'yyyy-MM');
  const team = k.data.TEAM_TOTAL || {};
  const since = fmt_(new Date(Date.now() - 7 * 86400000), TZ, 'yyyy-MM-dd');
  const lines = readTable_(T.MRF.name).rows;
  const wk = { joined: [], offers: 0, backouts: [] };
  lines.forEach(function (l) {
    const doj = ymd_(l.Actual_DOJ), off = ymd_(l.Offer_Date), bo = ymd_(l.Backout_Date);
    if (doj >= since) wk.joined.push(l);
    if (off >= since) wk.offers++;
    if (bo >= since) wk.backouts.push(l);
  });
  const ctx = tatContext_();
  const overdue = lines.map(function (l) { return orgTat_(Object.assign({}, l, computeTat_(l, ctx))); })
    .filter(function (l) { return l.TAT_Result === 'Overdue'; })
    .sort(function (a, b) { return (b.Days_Taken - b.Final_TAT) - (a.Days_Taken - a.Final_TAT); });
  const issues = dataChecks_().reduce(function (s, c) { return s + c.count; }, 0);
  const pa = pipelineAlerts_('');
  const bgvW = (function () { try { return bgvWeekly_(); } catch (e) { return null; } })();
  const texPending = ss_().getSheetByName(T.TEX.name) ? readTable_(T.TEX.name).rows.filter(function (x) { return String(x.Status) === 'Pending'; }).length : 0;
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  const url = ScriptApp.getService().getUrl();
  const kp = snap.kpi;
  const card = function (v, l, alert) { return '<td style="padding:10px 14px;border:1px solid #D9DFE7;background:#fff"><div style="font-size:22px;font-weight:600;color:' + (alert ? '#D9480F' : '#18222F') + '">' + v + '</div><div style="font-size:12px;color:#4A5668">' + l + '</div></td>'; };
  const kpiRow = function (key) {
    const c = team[key] && team[key][month];
    const def = k.defs[key];
    let val = def.count && month < k.captureFrom ? 'Scored from ' + k.captureFrom : '\u2014';
    if (c) val = def.count ? (c.pending ? c.pending + ' to check' : c.num + ' ' + def.unit) : c.pct + '% (' + c.num + '/' + c.den + ')';
    const sc = c && c.score != null ? c.score + ' / 5' : '';
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2">' + esc(def.name) + '</td><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2">' + esc(val) + '</td><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2;font-weight:600">' + sc + '</td></tr>';
  };
  const rowsOverdue = overdue.slice(0, 15).map(function (l) {
    return '<tr><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2">' + esc(l.MRF_No) + ' \u00b7 ' + esc(l.Position) + '<div style="color:#8793A3;font-size:12px">' + esc(l.Grade) + ' \u00b7 ' + esc(l.Dept) + '</div></td><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2">' + esc(l.Recruiter) + '</td><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2;color:#D9480F;font-weight:600">' + l.Days_Taken + ' / ' + l.Final_TAT + ' days</td></tr>';
  }).join('');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#18222F;max-width:680px">'
    + (test ? '<p style="background:#FFF4E6;padding:8px 12px;border-radius:4px">Test copy \u2014 only you received this.</p>' : '')
    + '<h2 style="margin:0 0 4px;color:#1F3A5F">BFCL recruitment \u2014 weekly summary</h2>'
    + '<p style="margin:0 0 14px;color:#4A5668">' + fmt_(new Date(), TZ, 'EEEE d MMMM yyyy') + '</p>'
    + '<table cellspacing="0" style="border-collapse:collapse;margin-bottom:18px"><tr>' + card(kp.open, 'Open positions') + card(kp.offered, 'Offered, awaiting joining') + card(kp.overdue, 'Past TAT', kp.overdue > 0) + card(kp.atRisk, 'At risk') + card(kp.joinedMonth, 'Joined this month') + '</tr></table>'
    + '<h3 style="margin:0 0 6px">Last 7 days</h3><p style="margin:0 0 16px">' + wk.joined.length + ' joined \u00b7 ' + wk.offers + ' offers made \u00b7 ' + wk.backouts.length + ' backouts'
    + (wk.backouts.length ? ' (' + wk.backouts.map(function (l) { return esc(l.Position) + ', ' + esc(l.Recruiter); }).join('; ') + ')' : '') + '</p>'
    + '<h3 style="margin:0 0 6px">KPIs this month (whole team)</h3><table cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:18px;font-size:14px">'
    + Object.keys(k.defs).map(kpiRow).join('') + '</table>'
    + '<h3 style="margin:0 0 6px">Positions past TAT' + (overdue.length > 15 ? ' (15 of ' + overdue.length + ')' : '') + '</h3>'
    + (overdue.length ? '<table cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:18px;font-size:14px">' + rowsOverdue + '</table>' : '<p>None \u2014 every open position is within TAT.</p>')
    + '<h3 style="margin:0 0 6px">Pipeline alerts</h3><p style="margin:0 0 6px">' + pa.hodOverdue.length + ' candidates waiting more than 24 hours for department feedback \u00b7 ' + pa.atRisk.length + ' joiners at risk \u00b7 ' + pa.dueToday.length + ' joining follow-ups due' + (pa.unassessed ? ' \u00b7 ' + pa.unassessed + ' joiners never checked on' : '') + '</p>'
    + (bgvW && (bgvW.open || bgvW.decide) ? '<p style="margin:0 0 16px"><b>Background verification:</b> ' + bgvW.open + ' open case' + (bgvW.open === 1 ? '' : 's') + ' \u00b7 <span style="color:' + (bgvW.red ? '#D9480F' : '#18222F') + '">' + bgvW.red + ' past a limit</span> \u00b7 ' + bgvW.decide + ' awaiting the Head of HR\u2019s decision'
      + (bgvW.byRecruiter.length ? '<br><span style="color:#8793A3;font-size:13px">Past a limit: ' + bgvW.byRecruiter.map(function (x) { return esc(x.recruiter) + ' ' + x.red; }).join(' \u00b7 ') + '</span>' : '') + ' (BGV tracker).</p>' : '')
    + (texPending ? '<p style="margin:0 0 16px"><b>' + texPending + ' TAT exemption' + (texPending === 1 ? '' : 's') + ' awaiting the Head of HR\u2019s decision</b> (Admin \u2192 TAT exemptions).</p>' : '')
    + (pa.atRisk.length ? '<table cellspacing="0" style="border-collapse:collapse;width:100%;margin-bottom:18px;font-size:14px">' + pa.atRisk.slice(0, 15).map(function (x) {
      return '<tr><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2">' + esc(x.name) + '<div style="color:#8793A3;font-size:12px">' + esc(x.position) + ' \u00b7 ' + esc(x.why.join('; ')) + '</div></td><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2">' + esc(x.recruiter) + '</td><td style="padding:6px 10px;border-bottom:1px solid #E9EDF2;font-weight:600;color:' + (x.level === 'Red' ? '#C92A2A' : '#B35C00') + '">' + esc(x.level) + '</td></tr>';
    }).join('') + '</table>' : '<p style="margin:0 0 18px"></p>')
    + '<p style="margin:0 0 18px">' + (issues ? issues + ' records flagged in Admin \u2192 Data checks.' : 'No data-check issues.') + '</p>'
    + (url ? '<p><a href="' + url + '" style="background:#1F3A5F;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none">Open the recruitment CRM</a></p>' : '')
    + '<p style="color:#8793A3;font-size:12px;margin-top:20px">Sent automatically every Monday. The admin can turn it off in Admin \u2192 Tools.</p></div>';
  MailApp.sendEmail({ to: to.join(','), subject: (test ? '[Test] ' : '') + 'BFCL recruitment weekly summary \u00b7 ' + fmt_(new Date(), TZ, 'd MMM yyyy'),
    htmlBody: html, name: 'BFCL Recruitment CRM' });
  if (!test) PropertiesService.getScriptProperties().setProperty('WEEKLY_LAST_SENT', fmt_(new Date(), TZ, 'd MMM yyyy, HH:mm') + ' to ' + to.join(', '));
}
