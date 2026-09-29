/* ---------------- Phase 3: backups, change history, data checks ---------------- */

/** Copies the database into a private Backups folder; keeps BACKUP_KEEP_DAYS days (default 14). */
function backupDb_() {
  const file = DriveApp.getFileById(DB_SPREADSHEET_ID);
  const parents = file.getParents();
  const base = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  const it = base.getFoldersByName('BFCL Recruitment CRM - Backups');
  const folder = it.hasNext() ? it.next() : base.createFolder('BFCL Recruitment CRM - Backups');
  const name = 'DB backup ' + fmt_(new Date(), TZ, 'yyyy-MM-dd HH:mm');
  file.makeCopy(name, folder);
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
  return { name: name, kept: kept, removed: removed, folder: folder.getUrl() };
}

function apiBackupNow() {
  requireAdmin_(currentUser_());
  return backupDb_();
}

function apiAdminInfo() {
  const u = currentUser_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can open this page.');
  return { lastBackup: PropertiesService.getScriptProperties().getProperty('LAST_BACKUP') || '' };
}

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
    return String(r.Active || 'Yes') !== 'No' && (PERMS_[normRole_(r.Role)] || []).indexOf('lead') >= 0 && /@/.test(String(r.Email));
  }).map(function (r) { return String(r.Email).trim().toLowerCase(); });
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
  sendSummary_([u.email], true);
  return 'Sent to ' + u.email;
}

function weeklySummaryJob() {
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
