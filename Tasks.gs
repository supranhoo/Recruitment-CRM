/**
 * To-do engine. Tasks are never typed in: each rule below reads the pipeline and positions and
 * produces a task for the owning recruiter when a policy deadline is near or past. Tasks close
 * themselves when the data shows the step is done. The app never sends messages: each task carries
 * a ready-made message and Teams/Outlook links the recruiter opens and sends from their own account.
 *
 * Sheets: Tasks (one row per task key: first seen, critical from, chased, snoozed, done, resolved),
 * Task_Actions (append-only log of chased / done / snoozed), Interviews (scheduled interviews).
 */
T.TASK = { name: 'Tasks', id: 'Task_Key', dates: [], editable: [] };
T.TACT = { name: 'Task_Actions', id: 'Action_ID', prefix: 'TA-', width: 6, dates: [], editable: [] };
T.INT = {
  name: 'Interviews', id: 'Interview_ID', prefix: 'INT-', width: 5, dates: ['Start'],
  editable: ['Status', 'Attendance_Confirmed', 'Unavailable', 'Notes']
};
const TASK_HEADERS_ = ['Task_Key', 'Rule', 'Recruiter', 'Line_ID', 'App_ID', 'Title', 'Context', 'First_Seen', 'Critical_At',
  'Resolved_At', 'Chase_Count', 'Last_Chased_At', 'Snoozed_Until', 'Snooze_Reason', 'Done_At', 'Done_By', 'Updated_At'];
const HOUR_MS_ = 3600000;

/** Rule defaults. Hours are measured from the event that starts the clock; crit null = never critical. */
const TASK_RULES_DEFAULT_ = [
  { id: 'share_jd', title: 'Share the proposed JD with the department', due: 0, crit: 24, missed: true, policy: '8.2: JD reviewed with the department before sourcing starts' },
  { id: 'dept_reply', title: 'Chase the department: JD / questions reply', due: 24, crit: 48, missed: true, policy: 'Department validates the JD and the screening questions within 24 h' },
  { id: 'revise_doc', title: 'Revise with the department\u2019s changes', due: 0, crit: 24, missed: true, policy: 'Changes requested: share the revised version' },
  { id: 'share_questions', title: 'Share screening questions with the department', due: 0, crit: 24, missed: true, policy: 'Questions from the final JD, validated before the job is posted' },
  { id: 'share_cvs', title: 'Share CVs with the department', due: 48, crit: 72, missed: true, policy: 'Appendix A step 2: CVs within 72 h of MRF approval' },
  { id: 'hod_feedback', title: 'Chase HOD feedback', due: 24, crit: 48, missed: true, policy: 'Appendix A step 3: feedback within 24 h' },
  { id: 'schedule_interview', title: 'Schedule the interview', due: 0, crit: 72, missed: true, policy: 'Appendix A step 4: interview within 72 h of shortlisting' },
  { id: 'confirm_attendance', title: 'Confirm interview attendance', due: 0, crit: null, missed: false, policy: 'Day before the interview' },
  { id: 'reschedule', title: 'Reschedule the interview', due: 0, crit: 0, missed: true, policy: 'Panel member unavailable' },
  { id: 'record_result', title: 'Record the interview result', due: 0, crit: 48, missed: true, policy: 'Appendix A step 6: decision within 48 h of the interview' },
  { id: 'psychometric', title: 'Psychometric (Mettl) test', due: 0, crit: null, missed: true, policy: '8.7.1: Manager and above, before the final interview' },
  { id: 'release_offer', title: 'Release the offer', due: 24, crit: 72, missed: true, policy: 'Appendix A step 7: offer within 72 h of finalisation' },
  { id: 'bgv', title: 'Start background verification', due: 0, crit: 72, missed: true, policy: '9.1.1: BGV within 3 days of the offer (Manager and above)' },
  { id: 'bgv_join', title: 'Start current-employer BGV', due: 0, crit: 48, missed: true, policy: 'Current-employer BGV within 2 days of joining (Manager and above, or flagged)' },
  { id: 'bgv_consent', title: 'Get the candidate\u2019s consent for BGV', due: 24, crit: null, missed: false, policy: 'BGV tracker: nothing is checked without the candidate\u2019s consent' },
  { id: 'bgv_chase', title: 'Chase the vendor: BGV update', due: 72, crit: 168, missed: false, policy: 'BGV tracker: chaser after 3 days without an update; vendor limit 7 days per check' },
  { id: 'bgv_result', title: 'Previous-employer BGV report is needed before joining', due: 0, crit: 24, missed: true, policy: 'BGV tracker: report 2 days before joining (1 day when the offer is close to joining)' },
  { id: 'bgv_review', title: 'Review the BGV report and close the case', due: 0, crit: 48, missed: true, policy: 'BGV tracker: review and close within 2 days of the report' },
  { id: 'offer_acceptance', title: 'Chase offer acceptance', due: 72, crit: null, missed: false, policy: '9.1.2: acceptance within 3 days' },
  { id: 'followup', title: 'Joining follow-up', due: 0, crit: null, missed: true, policy: 'Check-in due; Red risk is critical' },
  { id: 'joining', title: 'Record the joining', due: 0, crit: 24, missed: true, policy: 'Joining day' },
  { id: 'onboarding', title: 'Complete onboarding (induction and buddy)', due: 0, crit: 48, missed: true, policy: '14.3: buddy on the day of joining' },
  { id: 'checkin', title: 'New-joiner check-in', due: 0, crit: null, missed: false, policy: '14.5: 1st, 2nd and 3rd month for M levels' },
  { id: 'replacement_next', title: 'Replacement MRF: move the next candidate forward', due: 0, crit: 72, missed: true, policy: '9.5: new MRF after a backout; TAT continues from the original start' },
  { id: 'filled_cleanup', title: 'Position filled: close the remaining candidates', due: 0, crit: null, missed: false, policy: 'Reject, hold or move candidates left on a filled position' },
  { id: 'inform_closed', title: 'Inform candidates and panel: position closed', due: 0, crit: null, missed: false, policy: '18: keep candidates informed; position closed without a hire' },
  { id: 'switchover', title: 'Switch-over check: positions to fix', due: 0, crit: null, missed: false, policy: 'Typed offer details must match the pipeline before the switch-over date' },
  { id: 'tat_overdue', title: 'Positions past TAT', due: 0, crit: null, missed: false, policy: 'Plan next steps for overdue positions' },
  { id: 'day_note', title: 'Write your day note', due: 0, crit: null, missed: false, policy: 'After 5 pm when nothing is logged for today' }
];

function taskRules_() {
  let over = {};
  try { over = JSON.parse(String(settings_().TASK_RULES_JSON || '{}')); } catch (e) { over = {}; }
  return TASK_RULES_DEFAULT_.map(function (r) {
    const o = over[r.id] || {};
    let crit = r.crit;
    if (o.crit !== undefined) crit = o.crit === '' || o.crit === null ? null : Number(o.crit);
    return {
      id: r.id, title: r.title, policy: r.policy, missed: r.missed, defaultCrit: r.crit,
      on: o.on !== false,
      due: o.due !== undefined && o.due !== '' ? Number(o.due) : r.due,
      crit: crit
    };
  });
}

function tasksSchema_() {
  addSheet_(T.TASK.name, TASK_HEADERS_);
  addSheet_(T.TACT.name, ['Action_ID', 'Task_Key', 'Rule', 'Recruiter', 'Line_ID', 'Action', 'Note', 'Created_By', 'Created_At']);
  addSheet_(T.INT.name, ['Interview_ID', 'App_ID', 'Candidate_ID', 'Line_ID', 'Recruiter', 'Round', 'Mode', 'Start', 'Duration_Min',
    'Location', 'Panel', 'Status', 'Attendance_Confirmed', 'Unavailable', 'Notes', 'Created_By', 'Created_At', 'Updated_By', 'Updated_At']);
  addColumns_('M_Departments', ['HOD_Name', 'HOD_Email']);
}

/* ---------------- The rules ---------------- */

function ms_(v) { return v instanceof Date && !isNaN(v) ? v.getTime() : 0; }
function hoursText_(h) { h = Math.max(0, Math.floor(h)); return h >= 48 ? Math.floor(h / 24) + ' days' : h + ' h'; }
function istTime_(d) { return fmt_(d, TZ, 'd MMM, HH:mm'); }

/** Computes every open task from the data. Pure read: no writes. */
function computeTasks_() {
  const now = Date.now(), today = ymd_(new Date());
  const rules = {}; taskRules_().forEach(function (r) { rules[r.id] = r; });
  const ctx = tatContext_();
  const lines = {}; readTable_(T.MRF.name).rows.forEach(function (l) { lines[l.Line_ID] = l; });
  const allApps = readTable_(T.APP.name).rows;
  const cands = {}; readTable_(T.CAND.name).rows.forEach(function (c) { cands[c.Candidate_ID] = c; });
  // Ignore cards whose candidate record no longer exists, and positions replaced after a backout.
  const apps = allApps.filter(function (a) { return String(a.Status) === 'Active' && cands[a.Candidate_ID] && lines[a.Line_ID] && ['Replaced', 'Not Needed', 'No Vacancy', 'On Hold'].indexOf(positionStatus_(lines[a.Line_ID])) < 0; });
  const ints = readTable_(T.INT.name).rows;
  const hods = {}; readTable_('M_Departments').rows.forEach(function (d) { hods[String(d.Dept).trim()] = { name: String(d.HOD_Name || ''), email: String(d.HOD_Email || '').trim() }; });
  const panel = panelEmailIndex_();
  const out = [];

  const add = function (rid, t) {
    const r = rules[rid];
    if (!r || !r.on) return;
    const fl = t.line && lines[t.line];
    if (fl && isFast_(fl)) {   // fast-track position: no JD / questions / CV-sharing / interview-scheduling to-dos
      if (FAST_SKIP_TASKS_.indexOf(rid) >= 0) return;
      if (rid === 'release_offer') t.title = 'Confirm the hiring';
      if (rid === 'hod_feedback') t.title = 'Chase the department\u2019s written confirmation';
    }
    const dueAt = t.startMs + (r.due || 0) * HOUR_MS_;
    if (now < dueAt) return;
    const critAt = t.forceCritical ? (t.critAt || t.startMs) : (r.crit === null ? 0 : t.startMs + r.crit * HOUR_MS_);
    t.rule = rid; t.missedRule = r.missed; t.policy = r.policy;
    t.dueAt = dueAt; t.critAt = critAt;
    t.level = critAt && now >= critAt ? 'critical' : 'due';
    t.ageText = hoursText_((now - t.startMs) / HOUR_MS_);
    out.push(t);
  };
  const lineLabel = function (l) { return (l ? (l.MRF_No ? l.MRF_No + ' ' : '') + l.Position : ''); };
  const candName = function (a) { const c = cands[a.Candidate_ID]; return c ? String(c.Name) : a.Candidate_ID; };
  const stageIdx = function (s) { return STAGES.indexOf(String(s)); };

  // 1. Share CVs: positions assigned in the last 30 days with no CV shared yet.
  const since30 = ymd_(new Date(now - 30 * 86400000));
  const sharedLines = {};
  allApps.forEach(function (a) { if (stageIdx(a.Stage) >= stageIdx('Shared')) sharedLines[a.Line_ID] = true; });
  readTableFrom_(T.FUNNEL.name, 'Entry_Date', since30).rows.forEach(function (f) { if (Number(f.CV_Shared_Dept) > 0) sharedLines[f.Line_ID] = true; });
  Object.keys(lines).forEach(function (id) {
    const l = lines[id];
    if (positionStatus_(l) !== 'Open' || sharedLines[id]) return;
    const start = tatStart_(l);
    if (!start || start < since30) return;
    add('share_cvs', { key: 'share_cvs|' + id, recruiter: String(l.Recruiter), line: id, app: '',
      title: 'Share CVs with the department', context: lineLabel(l) + ' \u00b7 ' + l.Dept, startMs: parseYmd_(start).getTime(),
      open: { type: 'line', line: id } });
  });

  // 1b. JD and screening questions with the department (v52), positions started in the last 30 days.
  const docsBy = {};
  readTable_(T.PDOC.name).rows.forEach(function (d) { (docsBy[d.Line_ID] = docsBy[d.Line_ID] || { JD: [], SQ: [] })[String(d.Doc_Type) === 'SQ' ? 'SQ' : 'JD'].push(d); });
  const vlast = function (arr) { return arr.slice().sort(function (a, b) { return Number(a.Version) - Number(b.Version); }).slice(-1)[0] || null; };
  const docName = function (d) { return (String(d.Doc_Type) === 'SQ' ? 'Screening questions' : 'JD') + ' v' + d.Version; };
  Object.keys(lines).forEach(function (id) {
    const l = lines[id];
    if (positionStatus_(l) !== 'Open') return;
    const start = tatStart_(l);
    if (!start || start < since30) return;
    const dd = docsBy[id] || { JD: [], SQ: [] }, jl = vlast(dd.JD), sl = vlast(dd.SQ);
    const base = { recruiter: String(l.Recruiter), line: id, app: '', open: { type: 'pipeline', line: id } };
    const ctx = lineLabel(l) + ' \u00b7 ' + l.Dept;
    [jl, sl].forEach(function (d) {
      if (!d) return;
      if (String(d.Status) === 'Shared' && d.Shared_On instanceof Date)
        add('dept_reply', Object.assign({ key: 'dept_reply|' + d.Doc_ID, title: 'Chase ' + (hods[String(l.Dept).trim()] && hods[String(l.Dept).trim()].name || 'the department') + ': ' + docName(d) + ' reply', context: ctx + ' \u00b7 shared with ' + d.Shared_With, startMs: d.Shared_On.getTime() }, base));
      if (String(d.Status) === 'Changes requested' && d.Response_On instanceof Date)
        add('revise_doc', Object.assign({ key: 'revise_doc|' + d.Doc_ID, title: 'Revise ' + docName(d) + ' with the department\u2019s changes', context: ctx + ' \u00b7 ' + String(d.Dept_Comments || '').slice(0, 120), startMs: d.Response_On.getTime() }, base));
    });
    if (!jl || (String(jl.Status) === 'Draft' && !dd.JD.some(function (x) { return x.Shared_On instanceof Date; })))
      add('share_jd', Object.assign({ key: 'share_jd|' + id, title: jl ? 'Share the proposed JD (v' + jl.Version + ') with the department' : 'Prepare and share the proposed JD', context: ctx, startMs: parseYmd_(start).getTime() }, base));
    else if (jl && String(jl.Status) === 'Draft')
      add('share_jd', Object.assign({ key: 'share_jd|' + jl.Doc_ID, title: 'Share the revised JD (v' + jl.Version + ') with the department', context: ctx, startMs: ms_(jl.Created_At) || now }, base));
    if (jl && String(jl.Status) === 'Final' && jl.Final_On instanceof Date) {
      if (!sl || String(sl.Status) === 'Draft' || String(sl.Status) === 'Re-confirm') {
        const reconfirm = sl && String(sl.Status) === 'Re-confirm';
        add('share_questions', Object.assign({ key: 'share_questions|' + id + '|' + (sl ? sl.Doc_ID : ''), title: reconfirm ? 'Re-confirm screening questions (JD revised)' : sl ? 'Share screening questions (v' + sl.Version + ') with the department' : 'Write and share screening questions', context: ctx, startMs: Math.max(jl.Final_On.getTime(), sl ? ms_(sl.Updated_At) || ms_(sl.Created_At) : 0) }, base));
      }
    }
  });

  // 2. HOD feedback: one task per recruiter and department, listing every CV waiting.
  const hodGroups = {};
  apps.forEach(function (a) {
    if (String(a.Stage) !== 'Shared') return;
    const l = lines[a.Line_ID]; if (!l) return;
    const since = ms_(a.Stage_Since); if (!since) return;
    const k = String(l.Recruiter) + '|' + String(l.Dept);
    const g = hodGroups[k] = hodGroups[k] || { recruiter: String(l.Recruiter), dept: String(l.Dept), oldest: since, items: [], line: a.Line_ID };
    g.oldest = Math.min(g.oldest, since);
    g.items.push({ name: candName(a), position: String(l.Position), mrf: String(l.MRF_No || ''), hours: Math.floor((now - since) / HOUR_MS_), line: a.Line_ID });
  });
  Object.keys(hodGroups).forEach(function (k) {
    const g = hodGroups[k], hod = hods[g.dept.trim()] || { name: '', email: '' };
    const waiting = g.items.filter(function (i) { return i.hours >= (rules.hod_feedback ? rules.hod_feedback.due : 24); });
    if (!waiting.length) return;
    const msg = 'Hello' + (hod.name ? ' ' + hod.name.split(' ')[0] : '') + ', could you share your feedback on these CVs?\n'
      + waiting.map(function (i) { return '\u2022 ' + i.name + ' \u2013 ' + i.position + (i.mrf ? ' (' + i.mrf + ')' : '') + ', shared ' + hoursText_(i.hours) + ' ago'; }).join('\n')
      + '\nThank you.';
    add('hod_feedback', { key: 'hod_feedback|' + g.recruiter + '|' + g.dept, recruiter: g.recruiter, line: waiting.length === 1 ? waiting[0].line : '', app: '',
      title: 'Chase HOD feedback: ' + (hod.name || g.dept), context: g.dept + ' \u00b7 ' + waiting.length + ' CV' + (waiting.length === 1 ? '' : 's') + ' waiting',
      startMs: g.oldest, chase: true, message: msg,
      link: hod.email ? { type: 'teamsChat', to: [hod.email], message: msg } : null,
      note: hod.email ? '' : 'Add ' + g.dept + '\u2019s HOD email in Admin \u2192 HOD contacts to open this in Teams.' });
  });

  // Interviews by application, newest first.
  const intsByApp = {};
  ints.forEach(function (i) { (intsByApp[i.App_ID] = intsByApp[i.App_ID] || []).push(i); });
  Object.keys(intsByApp).forEach(function (k) { intsByApp[k].sort(function (x, y) { return ms_(y.Created_At) - ms_(x.Created_At); }); });
  const roundFor = function (stage) { return stage === 'Confirmed' ? 'Technical' : stage === 'Technical' ? 'HR' : ''; };

  apps.forEach(function (a) {
    const l = lines[a.Line_ID]; if (!l) return;
    const rec = String(a.Recruiter || l.Recruiter), c = cands[a.Candidate_ID] || {};
    const who = candName(a), ctxt = who + ' \u00b7 ' + lineLabel(l), since = ms_(a.Stage_Since), st = String(a.Stage);
    const mine = intsByApp[a.App_ID] || [];

    // 3-6. Interview rules.
    const round = roundFor(st);
    if (round && since) {
      const live = mine.filter(function (i) { return i.Round === round && i.Status === 'Scheduled'; })[0];
      const unavailable = mine.filter(function (i) { return i.Round === round && i.Status === 'Panel unavailable'; })[0];
      if (!live && unavailable) {
        add('reschedule', { key: 'reschedule|' + unavailable.Interview_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
          title: 'Reschedule the ' + round + ' interview', context: ctxt + ' \u00b7 unavailable: ' + unavailable.Unavailable,
          startMs: ms_(unavailable.Updated_At) || now, forceCritical: true, open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
      } else if (!live) {
        add('schedule_interview', { key: 'schedule_interview|' + a.App_ID + '|' + round, recruiter: rec, line: a.Line_ID, app: a.App_ID,
          title: 'Schedule the ' + (round === 'HR' ? 'HR / final' : 'technical') + ' interview', context: ctxt, startMs: since,
          open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
      }
      if (live) {
        const start = ms_(live.Start), end = start + (Number(live.Duration_Min) || 60) * 60000;
        const startDay = ymd_(live.Start), tomorrow = ymd_(new Date(now + 86400000));
        if (now < start && (startDay === today || startDay === tomorrow) && String(live.Attendance_Confirmed) !== 'Yes') {
          const emails = String(live.Panel || '').split(';').map(function (n) { return panel[panelKey_(n)] || ''; }).filter(String);
          if (c.Email) emails.push(String(c.Email));
          const msg = 'Reminder: ' + round + ' interview for ' + who + ' (' + l.Position + ') on ' + istTime_(live.Start)
            + (live.Mode === 'Teams' ? ' on Microsoft Teams (link in the invitation).' : ' at ' + (live.Location || 'the office') + '.') + ' Please confirm you can attend.';
          add('confirm_attendance', { key: 'confirm_attendance|' + live.Interview_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
            title: 'Confirm attendance: ' + round + ' interview ' + (startDay === today ? 'today' : 'tomorrow') + ' ' + fmt_(live.Start, TZ, 'HH:mm'),
            context: ctxt + ' \u00b7 panel: ' + live.Panel, startMs: Math.min(now, start - 36 * HOUR_MS_), manual: true, message: msg,
            link: emails.length ? { type: 'teamsChat', to: emails, message: msg } : null, interview: live.Interview_ID });
        }
        if (now >= end) {
          add('record_result', { key: 'record_result|' + live.Interview_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
            title: 'Record the ' + round + ' interview result', context: ctxt + ' \u00b7 held ' + istTime_(live.Start), startMs: end,
            open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
        }
      }
    }

    // 7. Psychometric test before the final interview (Manager and above).
    if ((st === 'Technical' || st === 'HR') && since && managerPlus_(l.Grade, l.Position)) {
      const done = /complet|done|yes/i.test(String(c.Psychometric_Status || '')) || !!c.Psychometric_Date;
      if (!done) add('psychometric', { key: 'psychometric|' + a.App_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
        title: st === 'HR' ? 'Psychometric test missing (final interview done)' : 'Arrange the psychometric (Mettl) test before the final interview',
        context: ctxt, startMs: since, forceCritical: st === 'HR', critAt: since, open: { type: 'candidate', id: a.Candidate_ID } });
    }

    // 8. Offer after selection.
    if ((st === 'HR' || st === 'Docs') && since) {
      add('release_offer', { key: 'release_offer|' + a.App_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
        title: st === 'HR' ? 'Verify documents and release the offer' : 'Release the offer', context: ctxt, startMs: since,
        open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
    }

    // 10. Offer acceptance.
    if (st === 'Offer' && since && !a.Offer_Accepted_On) {
      const msg = 'Hello ' + who.split(' ')[0] + ', following up on our offer for ' + l.Position + '. Could you confirm your acceptance? Happy to answer any questions.';
      add('offer_acceptance', { key: 'offer_acceptance|' + a.App_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
        title: 'Chase offer acceptance', context: ctxt + (c.Mobile ? ' \u00b7 ' + c.Mobile : ''), startMs: since, chase: true, message: msg,
        open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
    }

    // 11-12. Pre-joining.
    if (st === 'Prejoin') {
      const next = ymd_(a.Next_Followup), risk = String(a.Risk || '');
      if (risk === 'Red' || (next && next <= today)) {
        add('followup', { key: 'followup|' + a.App_ID + '|' + (next || 'risk'), recruiter: rec, line: a.Line_ID, app: a.App_ID,
          title: risk === 'Red' ? 'Joiner at risk (Red): follow up' : 'Joining follow-up due', context: ctxt + (risk ? ' \u00b7 risk ' + risk : ''),
          startMs: next ? parseYmd_(next).getTime() : (since || now), forceCritical: risk === 'Red', critAt: since || now,
          open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
      }
      const edoj = ymd_(l.EDOJ);
      if (edoj && edoj <= today && !l.Actual_DOJ) {
        add('joining', { key: 'joining|' + a.App_ID + '|' + edoj, recruiter: rec, line: a.Line_ID, app: a.App_ID,
          title: edoj === today ? 'Joining today: record the joining' : 'Joining date passed: confirm joining or backout',
          context: ctxt + ' \u00b7 expected ' + edoj, startMs: parseYmd_(edoj).getTime(), open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
      }
    }

    // 13. Onboarding after joining.
    if (st === 'Joined' && since) {
      add('onboarding', { key: 'onboarding|' + a.App_ID, recruiter: rec, line: a.Line_ID, app: a.App_ID,
        title: 'Complete onboarding: induction and buddy', context: ctxt, startMs: since, open: { type: 'app', line: a.Line_ID, app: a.App_ID } });
    }

    // 14. 1st / 2nd / 3rd-month check-ins for M levels.
    if (st === 'Onboarded' && /^M/i.test(String(l.Grade)) && l.Actual_DOJ) {
      let ob = {}; try { ob = JSON.parse(String(a.Onboard_JSON || '{}')); } catch (e) { ob = {}; }
      [['m1', 30], ['m2', 60], ['m3', 90]].forEach(function (m) {
        const dueDay = addDays_(ymd_(l.Actual_DOJ), m[1]);
        if (!ob[m[0]] && dueDay <= today && dueDay > addDays_(today, -45)) {
          add('checkin', { key: 'checkin|' + a.App_ID + '|' + m[0], recruiter: rec, line: a.Line_ID, app: a.App_ID,
            title: m[0].replace('m', 'Month ') + ' check-in with the new joiner', context: ctxt, startMs: parseYmd_(dueDay).getTime(), manual: true, checkin: m[0] });
        }
      });
    }
  });

  // 9. BGV for offered positions (Manager and above, or flagged).
  const bgvOpen = (function () { try { return bgvOpenCaseMap_(); } catch (e) { return {}; } })();
  Object.keys(lines).forEach(function (id) {
    const l = lines[id];
    if (positionStatus_(l) !== 'Offered' || l.BGV_Prev_Org_Date || !l.Offer_Date) return;
    const flag = String(l.BGV_Required || 'Auto');
    if (!(flag === 'Yes' || (flag !== 'No' && managerPlus_(l.Grade, l.Position)))) return;
    add('bgv', { key: 'bgv|' + id, recruiter: String(l.Recruiter), line: id, app: '', title: 'Start background verification',
      context: lineLabel(l) + ' \u00b7 offer ' + ymd_(l.Offer_Date), startMs: ms_(l.Offer_Date), open: bgvOpen[id + '|Previous employer'] ? { type: 'bgv', id: bgvOpen[id + '|Previous employer'] } : { type: 'line', line: id } });
  });

  // 9b. Current-employer BGV within 2 days of joining (same scope as 9; joinings in the last 30 days).
  Object.keys(lines).forEach(function (id) {
    const l = lines[id];
    if (positionStatus_(l) !== 'Closed' || !(l.Actual_DOJ instanceof Date) || l.BGV_Current_Org_Date) return;
    const doj = ymd_(l.Actual_DOJ);
    if (doj < since30 || doj > ymd_(new Date())) return;
    const flag = String(l.BGV_Required || 'Auto');
    if (!(flag === 'Yes' || (flag !== 'No' && managerPlus_(l.Grade, l.Position)))) return;
    add('bgv_join', { key: 'bgv_join|' + id, recruiter: String(l.Recruiter), line: id, app: '', title: 'Start current-employer BGV (joined ' + fmt_(l.Actual_DOJ, TZ, 'd MMM yyyy') + ')',
      context: lineLabel(l) + ' \u00b7 start it by ' + fmt_(parseYmd_(addDays_(doj, 2)), TZ, 'd MMM yyyy'), startMs: parseYmd_(doj).getTime(), open: bgvOpen[id + '|Current employer'] ? { type: 'bgv', id: bgvOpen[id + '|Current employer'] } : { type: 'line', line: id } });
  });

  // 9c. BGV tracker cases: consent, chaser, report before joining, review (v-next).
  try { bgvTasks_(add); } catch (e) { console.error('BGV to-dos: ' + e); }

  // Replacement MRFs (policy 9.5): move the next candidate forward.
  Object.keys(lines).forEach(function (id) {
    const l = lines[id];
    if (!l.Parent_Line_ID || positionStatus_(l) !== 'Open') return;
    const parent = lines[l.Parent_Line_ID] || {};
    const act = apps.filter(function (a) { return a.Line_ID === id; });
    add('replacement_next', { key: 'replacement_next|' + id, recruiter: String(l.Recruiter), line: id, app: '',
      title: 'Replacement ' + (l.MRF_No || id) + ': move the next candidate forward',
      context: act.length ? act.length + ' active candidate' + (act.length === 1 ? '' : 's') + ' \u00b7 ' + l.Position : 'No active candidates yet \u00b7 ' + l.Position,
      startMs: ms_(parent.Replaced_On) || ms_(l.Created_At) || now, open: { type: 'pipeline', line: id } });
  });

  // Filled positions with candidates still active at earlier stages (joined in the last 60 days).
  const since60 = ymd_(new Date(now - 60 * 86400000));
  Object.keys(lines).forEach(function (id) {
    const l = lines[id];
    if (positionStatus_(l) !== 'Closed' || !l.Actual_DOJ || ymd_(l.Actual_DOJ) < since60) return;
    const left = apps.filter(function (a) { return a.Line_ID === id && STAGES.indexOf(String(a.Stage)) < STAGES.indexOf('Joined'); });
    if (!left.length) return;
    add('filled_cleanup', { key: 'filled_cleanup|' + id, recruiter: String(l.Recruiter), line: id, app: '',
      title: 'Position filled: close ' + left.length + ' remaining candidate' + (left.length === 1 ? '' : 's'),
      context: lineLabel(l) + ' \u00b7 reject, hold or move them to another open position', startMs: ms_(l.Actual_DOJ), open: { type: 'pipeline', line: id } });
  });

  // Positions closed without a hire (or put on hold) in the last 7 days: inform the candidates and panel.
  const since7 = ymd_(new Date(now - 7 * 86400000));
  const closedApps = {};
  allApps.forEach(function (a) { if (/^(Position |Offer withdrawn by the company)/.test(String(a.Status_Reason || '')) && ['Rejected', 'On hold', 'Withdrawn'].indexOf(String(a.Status)) >= 0) (closedApps[a.Line_ID] = closedApps[a.Line_ID] || []).push(a); });
  Object.keys(lines).forEach(function (id) {
    const l = lines[id], s = positionStatus_(l);
    if (['Not Needed', 'No Vacancy', 'On Hold'].indexOf(s) < 0 || !l.Closure_Reason) return;
    const when = ymd_(s === 'No Vacancy' ? l.No_Vacancy_Date : l.Not_Needed_Date);
    if (!when || when < since7) return;
    const list = closedApps[id] || [];
    if (!list.length) return;
    const names = list.map(function (a) { return (cands[a.Candidate_ID] || {}).Name || a.Candidate_ID; });
    const msg = s === 'On Hold'
      ? 'Hello, the ' + l.Position + ' position has been put on hold by the department for now. We will get back to you as soon as it resumes. Thank you for your patience.'
      : 'Hello, the ' + l.Position + ' position has been closed by the department, so we will not be taking your application further for now. Thank you for your time; we will keep your profile for suitable roles.';
    add('inform_closed', { key: 'inform_closed|' + id + '|' + when, recruiter: String(l.Recruiter), line: id, app: '',
      title: 'Inform ' + list.length + ' candidate' + (list.length === 1 ? '' : 's') + ': ' + (l.MRF_No || id) + ' ' + (s === 'On Hold' ? 'on hold' : 'closed'),
      context: names.slice(0, 4).join(', ') + (names.length > 4 ? ' and ' + (names.length - 4) + ' more' : '') + ' \u00b7 ' + l.Position,
      startMs: parseYmd_(when).getTime(), manual: true, message: msg });
  });

  // Switch-over check: one task per recruiter while positions still disagree with the pipeline.
  const byRec = {};
  reconcileScan_('', false).forEach(function (it) { (byRec[it.line.Recruiter] = byRec[it.line.Recruiter] || []).push(it); });
  const cut = cutover_(), pastCut = ymd_(new Date()) >= cut;
  Object.keys(byRec).forEach(function (r) {
    const n = byRec[r].length;
    add('switchover', { key: 'switchover|' + r, recruiter: r, line: '', app: '',
      title: 'Switch-over check: ' + n + ' position' + (n === 1 ? '' : 's') + ' to fix' + (pastCut ? '' : ' before ' + cut),
      context: byRec[r].slice(0, 4).map(function (it) { return it.line.MRF_No || it.line.Line_ID; }).join(', ') + (n > 4 ? ' and ' + (n - 4) + ' more' : ''),
      startMs: now - HOUR_MS_, forceCritical: pastCut, critAt: parseYmd_(cut).getTime(), open: { type: 'reconcile' } });
  });

  // 15. Positions past TAT: one grouped task per recruiter.
  const overdue = {};
  Object.keys(lines).forEach(function (id) {
    const l = lines[id], s = positionStatus_(l);
    if (s !== 'Open' && s !== 'Offered') return;
    if (computeTat_(l, ctx).TAT_Result !== 'Overdue') return;
    (overdue[String(l.Recruiter)] = overdue[String(l.Recruiter)] || []).push(l);
  });
  Object.keys(overdue).forEach(function (r) {
    const ls = overdue[r];
    add('tat_overdue', { key: 'tat_overdue|' + r, recruiter: r, line: '', app: '', title: ls.length + ' position' + (ls.length === 1 ? '' : 's') + ' past TAT',
      context: ls.slice(0, 4).map(lineLabel).join(', ') + (ls.length > 4 ? ' and ' + (ls.length - 4) + ' more' : ''), startMs: now - HOUR_MS_,
      open: { type: 'positions' } });
  });

  // 16. Day note after 5 pm.
  if (Number(fmt_(new Date(now), TZ, 'HH')) >= 17) {
    const wrote = {};
    readTableFrom_(T.DAY.name, 'Summary_Date', today).rows.forEach(function (s) { if (ymd_(s.Summary_Date) === today && String(s.Overview || '').trim()) wrote[String(s.Recruiter).toLowerCase()] = true; });
    readTableFrom_(T.FUNNEL.name, 'Entry_Date', today).rows.forEach(function (f) { if (ymd_(f.Entry_Date) === today) wrote[String(f.Recruiter).toLowerCase()] = true; });
    usersCached_().forEach(function (u) {
      if (String(u.Active || 'Yes') === 'No' || normRole_(u.Role) !== ROLES.RECRUITER) return;
      const r = String(u.Recruiter_Name || u.Name);
      if (wrote[r.toLowerCase()]) return;
      add('day_note', { key: 'day_note|' + r + '|' + today, recruiter: r, line: '', app: '', title: 'Write your day note',
        context: 'Nothing logged for today yet', startMs: now - HOUR_MS_, open: { type: 'myday' } });
    });
  }
  return out;
}

function panelKey_(s) { return String(s || '').toLowerCase().replace(/\b(sir|mr|mrs|ms|dr)\b\.?/g, '').replace(/[^a-z]/g, ''); }
function panelEmailIndex_() {
  const idx = {};
  readTable_(T.PM.name).rows.forEach(function (p) {
    const e = String(p.Email || '').trim(); if (!e) return;
    [p.Name].concat(String(p.Aliases || '').split(/[;,]/)).forEach(function (n) { const k = panelKey_(n); if (k) idx[k] = e; });
  });
  return idx;
}

/* ---------------- State: seen, chased, snoozed, done, resolved ---------------- */

function taskState_() {
  const t = readTable_(T.TASK.name, true);
  const map = {}; t.rows.forEach(function (r) { map[String(r.Task_Key)] = r; });
  return { table: t, map: map };
}

/** Tasks with their state applied, cached until the underlying data changes (or 10 minutes pass). */
function allTasks_() {
  const bucket = Math.floor(Date.now() / 600000);
  const stamps = tableStamps_(['MRF', 'Applications', 'Candidates', 'Interviews', 'Tasks', 'Settings', 'M_Departments', 'Daily_Summary', 'Daily_Funnel', 'M_Panel_Members']);
  let h = 0; const sj = stamps.join('|'); for (let i = 0; i < sj.length; i++) h = (h * 31 + sj.charCodeAt(i)) >>> 0;
  const key = 'tasks_' + bucket + '_' + h.toString(36) + '_' + sj.length;
  /* Chunked cache: a busy team's list (with its prepared messages) can exceed the 100 KB limit of one cache entry,
     which used to mean it was never cached and was rebuilt from about ten sheets on every call. */
  try { const hit = cacheBigGet_(key); if (hit) return JSON.parse(hit); } catch (e) { }
  const now = Date.now(), t0 = now;
  const state = taskState_().map;
  const list = computeTasks_().map(function (t) {
    const s = state[t.key];
    const reopened = s && s.Resolved_At;
    const st = s && !reopened ? s : {};
    t.chases = Number(st.Chase_Count) || 0;
    t.lastChased = ms_(st.Last_Chased_At);
    t.snoozedUntil = ms_(st.Snoozed_Until);
    t.snoozeReason = String(st.Snooze_Reason || '');
    t.doneAt = ms_(st.Done_At);
    t.hidden = !!t.doneAt || (t.snoozedUntil > now) || (t.chase && t.lastChased && now < t.lastChased + 24 * HOUR_MS_);
    t.why = t.doneAt ? 'done' : t.snoozedUntil > now ? 'snoozed' : t.hidden ? 'chased' : '';
    delete t.startMs;
    return t;
  });
  try { const s = JSON.stringify(list); if (s.length < 900000) cacheBigPut_(key, s, 900); else console.log('[perf] to-do list too big to cache: ' + s.length + ' chars'); } catch (e) { }
  perfNote_('to-do list rebuilt', t0, list.length + ' tasks');
  return list;
}

/** Background job (every 30 minutes, with the dashboard refresh): records new, critical and resolved tasks. */
function reconcileTasks_() {
  ensureSchema_();
  return withLock_(function () {
    const now = new Date();
    const st = taskState_(), sh = st.table.sheet, headers = st.table.headers;
    const current = {}; computeTasks_().forEach(function (t) { current[t.key] = t; });
    const updates = [], appends = [];
    const row = function (o) { return headers.map(function (h) { return o[h] === undefined ? '' : o[h]; }); };
    Object.keys(current).forEach(function (k) {
      const t = current[k], s = st.map[k];
      const crit = t.critAt ? new Date(t.critAt) : '';
      if (!s) {
        appends.push(row({ Task_Key: k, Rule: t.rule, Recruiter: t.recruiter, Line_ID: t.line, App_ID: t.app, Title: t.title, Context: t.context,
          First_Seen: now, Critical_At: crit, Chase_Count: 0, Updated_At: now }));
      } else if (s.Resolved_At && !s.Done_At) {
        updates.push({ r: s._row, v: row(Object.assign({}, s, { Title: t.title, Context: t.context, First_Seen: now, Critical_At: crit, Resolved_At: '',
          Chase_Count: 0, Last_Chased_At: '', Snoozed_Until: '', Snooze_Reason: '', Updated_At: now })) });
      } else if (String(s.Title) !== t.title || String(s.Context) !== t.context || ms_(s.Critical_At) !== (t.critAt || 0)) {
        updates.push({ r: s._row, v: row(Object.assign({}, s, { Title: t.title, Context: t.context, Critical_At: crit, Updated_At: now })) });
      }
    });
    Object.keys(st.map).forEach(function (k) {
      const s = st.map[k];
      if (current[k] || s.Resolved_At) return;
      updates.push({ r: s._row, v: row(Object.assign({}, s, { Resolved_At: s.Done_At || now, Updated_At: now })) });
    });
    updates.forEach(function (u) { sh.getRange(u.r, 1, 1, headers.length).setValues([u.v]); });
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, headers.length).setValues(appends);
    if (updates.length || appends.length) dropStale_(T.TASK.name);
    return { added: appends.length, updated: updates.length };
  });
}

/** Writes one task's state immediately (used by the task buttons). */
function setTaskState_(t, patch, u) {
  withLock_(function () {
    const st = taskState_(), headers = st.table.headers, sh = st.table.sheet;
    const base = st.map[t.key] && !st.map[t.key].Resolved_At ? st.map[t.key]
      : { Task_Key: t.key, Rule: t.rule, Recruiter: t.recruiter, Line_ID: t.line, App_ID: t.app, First_Seen: new Date(), Critical_At: t.critAt ? new Date(t.critAt) : '', Chase_Count: 0 };
    const o = Object.assign({}, base, { Title: t.title, Context: t.context }, patch, { Updated_At: new Date() });
    const v = headers.map(function (h) { return o[h] === undefined ? '' : o[h]; });
    if (st.map[t.key]) sh.getRange(st.map[t.key]._row, 1, 1, headers.length).setValues([v]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, headers.length).setValues([v]);
    dropStale_(T.TASK.name);
  });
  insert_(T.TACT, { Task_Key: t.key, Rule: t.rule, Recruiter: t.recruiter, Line_ID: t.line, Action: patch._action, Note: patch._note || '' }, u);
}

/* ---------------- APIs ---------------- */

function taskClient_(t) {
  return { key: t.key, rule: t.rule, level: t.level, title: t.title, context: t.context, age: t.ageText, line: t.line, app: t.app,
    chase: !!t.chase, manual: !!t.manual, message: t.message || '', link: t.link || null, note: t.note || '', open: t.open || null,
    chases: t.chases, snoozeReason: t.snoozeReason, why: t.why, policy: t.policy, recruiter: t.recruiter,
    critAt: t.critAt || 0, dueAt: t.dueAt || 0 };
}
function sortTasks_(a, b) {
  const lv = { critical: 0, due: 1 };
  return (lv[a.level] - lv[b.level]) || ((a.critAt || a.dueAt) - (b.critAt || b.dueAt));
}

/** The signed-in recruiter's to-do list (the head and admin may ask for any recruiter, or '*' for the team). */
function apiMyTasks(who) {
  const u = currentUser_(); ensureSchema_();
  const target = who && isLead_(u) ? String(who) : u.recruiter;
  const all = allTasks_().filter(function (t) { return target === '*' || String(t.recruiter).toLowerCase() === target.toLowerCase(); });
  const visible = all.filter(function (t) { return !t.hidden; }).sort(sortTasks_).map(taskClient_);
  return {
    recruiter: target, tasks: visible,
    counts: { critical: visible.filter(function (t) { return t.level === 'critical'; }).length, due: visible.filter(function (t) { return t.level === 'due'; }).length,
      snoozed: all.filter(function (t) { return t.why === 'snoozed'; }).length, chased: all.filter(function (t) { return t.why === 'chased'; }).length }
  };
}

/** Open tasks for one position (anyone who can see the position). */
function apiTasksForLine(lineId) {
  currentUser_(); ensureSchema_();
  return allTasks_().filter(function (t) { return t.line === lineId && !t.hidden; }).sort(sortTasks_).map(taskClient_);
}

/** Counts for the Overview: the user's own, or the team's for the head and admin. */
function apiTaskSummary() {
  const u = currentUser_(); ensureSchema_();
  const lead = isLead_(u);
  const all = allTasks_().filter(function (t) { return !t.hidden && (lead || String(t.recruiter).toLowerCase() === u.recruiter.toLowerCase()); });
  const y = ymd_(new Date(Date.now() - 86400000));
  const missed = missedTasks_(y, lead ? '' : u.recruiter).length;
  const exemptPending = can_(u, 'tat_exempt') && ss_().getSheetByName(T.TEX.name) ? readTable_(T.TEX.name).rows.filter(function (x) { return String(x.Status) === 'Pending'; }).length : 0;
  const bg = (function () { try { return bgvSummary_(u); } catch (e) { return { decide: 0, late: 0 }; } })();
  return { team: lead, critical: all.filter(function (t) { return t.level === 'critical'; }).length, due: all.filter(function (t) { return t.level === 'due'; }).length, missedYesterday: missed, exemptPending: exemptPending, bgvDecide: bg.decide, bgvLate: bg.late };
}

/** Task buttons: chased, snooze, done. */
function apiTaskAction(key, action, data) {
  const u = currentUser_(); ensureSchema_();
  data = data || {};
  const t = allTasks_().filter(function (x) { return x.key === key; })[0];
  if (!t) throw new Error('This task is already closed. Refresh the list.');
  if (!isLead_(u) && String(t.recruiter).toLowerCase() !== u.recruiter.toLowerCase()) throw new Error('This task belongs to ' + t.recruiter + '.');
  const now = new Date();
  if (action === 'chased') {
    if (!t.chase) throw new Error('This task closes on its own once the step is recorded.');
    setTaskState_(t, { Chase_Count: (t.chases || 0) + 1, Last_Chased_At: now, _action: 'Chased', _note: String(data.note || '') }, u);
  } else if (action === 'snooze') {
    const reason = String(data.reason || '').trim();
    if (!reason) throw new Error('Add a reason for snoozing.');
    const until = data.until === '2h' ? new Date(now.getTime() + 2 * HOUR_MS_)
      : data.until === '2d' ? new Date(now.getTime() + 48 * HOUR_MS_)
        : (function () { const d = new Date(now.getTime() + 86400000); d.setHours(9, 30, 0, 0); return d; })();
    setTaskState_(t, { Snoozed_Until: until, Snooze_Reason: reason.slice(0, 200), _action: 'Snoozed', _note: reason.slice(0, 200) }, u);
  } else if (action === 'done') {
    if (!t.manual) throw new Error('This task closes on its own once the step is recorded in the app.');
    if (t.rule === 'confirm_attendance' && t.interview) update_(T.INT, t.interview, { Attendance_Confirmed: 'Yes' }, u);
    if (t.rule === 'checkin' && t.checkin) {
      const a = readTable_(T.APP.name, true).rows.filter(function (r) { return r.App_ID === t.app; })[0];
      let ob = {}; try { ob = JSON.parse(String(a.Onboard_JSON || '{}')); } catch (e) { ob = {}; }
      ob[t.checkin] = ymd_(now);
      update_(T.APP, t.app, { Onboard_JSON: JSON.stringify(ob) }, u);
    }
    setTaskState_(t, { Done_At: now, Done_By: u.email, _action: 'Done', _note: String(data.note || '') }, u);
  } else throw new Error('Unknown action.');
  return apiMyTasks(isLead_(u) && String(t.recruiter).toLowerCase() !== u.recruiter.toLowerCase() ? t.recruiter : '');
}

/** Missed on a day: tasks that were critical before the day ended and still open at its end. */
function missedTasks_(date, recruiter) {
  const end = parseYmd_(date).getTime() + 86400000;
  const rules = {}; taskRules_().forEach(function (r) { rules[r.id] = r; });
  const chases = {};
  readTableFrom_(T.TACT.name, 'Created_At', addDays_(date, -30)).rows.forEach(function (a) {
    if (String(a.Action) === 'Chased' && ms_(a.Created_At) < end) chases[a.Task_Key] = (chases[a.Task_Key] || 0) + 1;
  });
  const bgvDate = {}, bgvCurr = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { if (l.BGV_Prev_Org_Date) bgvDate[l.Line_ID] = ymd_(l.BGV_Prev_Org_Date); if (l.BGV_Current_Org_Date) bgvCurr[l.Line_ID] = ymd_(l.BGV_Current_Org_Date); });
  return readTable_(T.TASK.name).rows.filter(function (s) {
    const r = rules[String(s.Rule)];
    if (!r || !r.missed) return false;
    // BGV: judge by the initiation date entered on the position, not by when it was typed in.
    if (String(s.Rule) === 'bgv' && bgvDate[s.Line_ID] && bgvDate[s.Line_ID] <= date) return false;
    if (String(s.Rule) === 'bgv_join' && bgvCurr[s.Line_ID] && bgvCurr[s.Line_ID] <= date) return false;
    if (recruiter && String(s.Recruiter).toLowerCase() !== recruiter.toLowerCase()) return false;
    const crit = ms_(s.Critical_At), first = ms_(s.First_Seen), res = ms_(s.Resolved_At);
    return crit && crit < end && first && first < end && (!res || res > end);
  }).map(function (s) {
    const snz = ms_(s.Snoozed_Until);
    return { recruiter: String(s.Recruiter), title: String(s.Title), context: String(s.Context), rule: String(s.Rule),
      chaseable: ['hod_feedback', 'offer_acceptance'].indexOf(String(s.Rule)) >= 0,
      late: hoursText_((end - ms_(s.Critical_At)) / HOUR_MS_), chases: chases[s.Task_Key] || 0,
      snoozed: snz && snz >= end - 86400000 ? String(s.Snooze_Reason) : '' };
  });
}

/** Per-recruiter task activity for the Daily review. */
function dayTasks_(date) {
  const start = parseYmd_(date).getTime(), end = start + 86400000;
  const acts = {};
  readTableFrom_(T.TACT.name, 'Created_At', date).rows.forEach(function (a) {
    const t = ms_(a.Created_At); if (t < start || t >= end) return;
    const r = String(a.Recruiter).toLowerCase();
    const o = acts[r] = acts[r] || { done: 0, chased: 0, snoozed: 0 };
    const k = String(a.Action).toLowerCase(); if (o[k] !== undefined) o[k]++;
  });
  const missed = {};
  missedTasks_(date, '').forEach(function (m) { (missed[m.recruiter.toLowerCase()] = missed[m.recruiter.toLowerCase()] || []).push(m); });
  return { acts: acts, missed: missed };
}

/* ---------------- Interview scheduling ---------------- */

function interviewClient_(i, panel) {
  const o = toClient_(i); delete o._row;
  o.startIso = i.Start instanceof Date ? fmt_(i.Start, TZ, 'yyyy-MM-dd') + 'T' + fmt_(i.Start, TZ, 'HH:mm') : '';
  o.startText = i.Start instanceof Date ? fmt_(i.Start, TZ, 'EEEE d MMM yyyy, HH:mm') : '';
  o.panelEmails = String(i.Panel || '').split(';').map(function (n) { return panel[panelKey_(n)] || ''; }).filter(String);
  return o;
}
function interviewsFor_(lineId) {
  const panel = panelEmailIndex_();
  return readTable_(T.INT.name).rows.filter(function (i) { return i.Line_ID === lineId; })
    .sort(function (a, b) { return ms_(b.Created_At) - ms_(a.Created_At); }).map(function (i) { return interviewClient_(i, panel); });
}

function apiScheduleInterview(appId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const a = readTable_(T.APP.name, true).rows.filter(function (r) { return r.App_ID === appId; })[0];
  if (!a) throw new Error('Application not found.');
  requireActiveLine_(requireLineEdit_(u, a.Line_ID));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ''))) throw new Error('Pick the interview date.');
  if (!/^\d{2}:\d{2}$/.test(String(d.time || ''))) throw new Error('Pick the interview time.');
  if (['Technical', 'HR'].indexOf(d.round) < 0) throw new Error('Pick the interview round.');
  if (['Teams', 'In person'].indexOf(d.mode) < 0) throw new Error('Pick Teams or in person.');
  const panelNames = String(d.panel || '').split(/[;,]/).map(function (s) { return s.trim(); }).filter(String);
  if (!panelNames.length) throw new Error('Pick at least one panel member.');
  if (!d.override) {
    const endT = (function () { const p = String(d.time || '00:00').split(':'); const mins = Number(p[0]) * 60 + Number(p[1]) + (Number(d.duration) || 60); return ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + (mins % 60)).slice(-2); })();
    const cf = panelConflicts_(panelNames, String(d.date), String(d.time || ''), endT);
    if (cf.length) throw new Error('Panel unavailable: ' + cf.map(panelConflictText_).join('; ') + '.');
  }
  const p = d.date.split('-'), tm = d.time.split(':');
  const start = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(tm[0]), Number(tm[1])) - IST_OFFSET_MS);
  if (start.getTime() < Date.now() - HOUR_MS_) throw new Error('The interview time is in the past.');
  readTable_(T.INT.name, true).rows.forEach(function (i) {
    if (i.App_ID === appId && i.Round === d.round && (i.Status === 'Scheduled' || i.Status === 'Panel unavailable')) update_(T.INT, i.Interview_ID, { Status: 'Rescheduled' }, u);
  });
  const rec = insert_(T.INT, { App_ID: appId, Candidate_ID: a.Candidate_ID, Line_ID: a.Line_ID, Recruiter: a.Recruiter, Round: d.round, Mode: d.mode,
    Start: start, Duration_Min: Number(d.duration) || 60, Location: String(d.location || '').slice(0, 200), Panel: panelNames.join('; '),
    Status: 'Scheduled', Attendance_Confirmed: '', Unavailable: '', Notes: String(d.notes || '').slice(0, 500) }, u);
  appendHistory_(a, a.Stage, a.Stage, 'Interview scheduled', d.round + ' \u00b7 ' + fmt_(start, TZ, 'd MMM yyyy, HH:mm') + ' \u00b7 ' + d.mode, u);
  return interviewsFor_(a.Line_ID);
}

/** confirm | unavailable (members + reason, logged in the panel unavailability log) | cancel */
function apiInterviewAction(id, action, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const i = readTable_(T.INT.name, true).rows.filter(function (r) { return r.Interview_ID === id; })[0];
  if (!i) throw new Error('Interview not found.');
  requireLineEdit_(u, i.Line_ID);
  if (action === 'confirm') update_(T.INT, id, { Attendance_Confirmed: 'Yes' }, u);
  else if (action === 'cancel') update_(T.INT, id, { Status: 'Cancelled', Notes: String(d.reason || i.Notes || '').slice(0, 500) }, u);
  else if (action === 'unavailable') {
    const members = (Array.isArray(d.members) ? d.members : []).map(String).filter(String);
    const reason = String(d.reason || '').trim();
    if (!members.length) throw new Error('Pick who is unavailable.');
    if (!reason) throw new Error('Add the reason.');
    const line = lineOf_(i.Line_ID) || {}, c = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === i.Candidate_ID; })[0] || {};
    const pm = {}; readTable_(T.PM.name).rows.forEach(function (p) { pm[panelKey_(p.Name)] = p; });
    const end = new Date(ms_(i.Start) + (Number(i.Duration_Min) || 60) * 60000);
    members.forEach(function (m) {
      const p = pm[panelKey_(m)] || {};
      insert_(T.PANEL, { Panel_Member: m, Department: p.Department || '', Designation: p.Designation || '',
        Interview_For: (line.Position || '') + (c.Name ? ' \u2013 ' + c.Name : ''), Date: i.Start, From_Time: fmt_(i.Start, TZ, 'HH:mm'),
        To_Time: fmt_(end, TZ, 'HH:mm'), To_Date: i.Start, Kind: 'Part of a day', Reason: reason.slice(0, 300), Availability_Status: 'Unavailable', Remarks: 'Recorded from ' + i.Round + ' interview ' + id }, u);
    });
    update_(T.INT, id, { Status: 'Panel unavailable', Unavailable: members.join('; ') }, u);
  } else throw new Error('Unknown action.');
  return interviewsFor_(i.Line_ID);
}

/* ---------------- Admin: HOD contacts and rule settings ---------------- */

function apiTaskAdmin() {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can change these.');
  return {
    rules: taskRules_(),
    hods: readTable_('M_Departments').rows.map(function (d) { return { dept: String(d.Dept), name: String(d.HOD_Name || ''), email: String(d.HOD_Email || '') }; })
  };
}
function apiSaveHodContacts(list) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can change HOD contacts.');
  withLock_(function () {
    const t = readTable_('M_Departments', true), h = t.headers, ni = h.indexOf('HOD_Name') + 1, ei = h.indexOf('HOD_Email') + 1;
    const byDept = {}; (list || []).forEach(function (x) { byDept[String(x.dept)] = x; });
    t.rows.forEach(function (r) {
      const x = byDept[String(r.Dept)]; if (!x) return;
      const name = String(x.name || '').trim(), email = String(x.email || '').trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Check the email for ' + r.Dept + '.');
      if (name !== String(r.HOD_Name || '') || email !== String(r.HOD_Email || '')) {
        t.sheet.getRange(r._row, ni).setValue(clean_(name)); t.sheet.getRange(r._row, ei).setValue(email);
        audit_(u, 'M_Departments', r.Dept, 'Update', 'HOD', String(r.HOD_Name || '') + ' ' + String(r.HOD_Email || ''), name + ' ' + email);
      }
    });
    dropStale_('M_Departments');
  });
  return apiTaskAdmin();
}
function apiSaveTaskRules(list) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can change task rules.');
  const over = {};
  (list || []).forEach(function (r) {
    const def = TASK_RULES_DEFAULT_.filter(function (d) { return d.id === r.id; })[0]; if (!def) return;
    const due = Number(r.due), crit = r.crit === '' || r.crit === null ? '' : Number(r.crit);
    if (isNaN(due) || due < 0 || due > 720) throw new Error('Check the hours for ' + def.title + '.');
    if (crit !== '' && (isNaN(crit) || crit < due || crit > 720)) throw new Error('Critical hours for ' + def.title + ' must be at least the due hours.');
    over[r.id] = { on: r.on !== false, due: due, crit: crit };
  });
  setSetting_('TASK_RULES_JSON', JSON.stringify(over), 'To-do rule settings (edited in Admin \u2192 Task rules).');
  return apiTaskAdmin();
}
