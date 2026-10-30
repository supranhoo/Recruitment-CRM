/**
 * Monthly KPI scorecard (stage 4, part 1): Timely closure, M-level fulfilment, Offer backout.
 * Targets live in the KPI_Targets sheet. A row with Recruiter "*" is the team default;
 * a row for a named recruiter overrides it from its Effective_From month onward.
 */
const KPI_TARGETS = 'KPI_Targets';
const KPI_DEFS = {
  TIMELY_CLOSURE: { name: 'Timely closure of vacant positions', scored: true },
  M_FULFILMENT: { name: 'Fulfilment of M-level positions within TAT', scored: true },
  OFFER_BACKOUT: { name: 'Offer backout rate', scored: false },
  PSYCHOMETRIC: { name: 'Mettl psychometric test (Manager & above)', scored: true, count: true, unit: 'missed' },
  MRF_ADHERENCE: { name: 'MRF & assessment process adherence', scored: true, count: true, unit: 'logged' },
  BGV: { name: 'Background verification compliance', scored: true, count: true, unit: 'missed' },
  TRACKER_ACCURACY: { name: 'Recruitment & CV tracker accuracy', scored: true, count: true, unit: 'errors' }
};
const COUNT_SCORES = {
  PSYCHOMETRIC: function (n) { return n === 0 ? 5 : n === 1 ? 3 : 0; },
  MRF_ADHERENCE: function (n) { return n > 4 ? 0 : 5 - n; },
  BGV: function (n) { return n === 0 ? 5 : n === 1 ? 2 : 0; },
  TRACKER_ACCURACY: function (n) { return n === 0 ? 5 : 0; }
};

function ensureKpiTargets_() {
  let sh = ss_().getSheetByName(KPI_TARGETS);
  if (!sh) {
    sh = ss_().insertSheet(KPI_TARGETS);
    sh.getRange(1, 1, 3, 7).setValues([
      ['Recruiter', 'KPI', 'Levels', 'TAT_Days', 'Notice_Exemption', 'Effective_From', 'Note'],
      ['*', 'TIMELY_CLOSURE', 'All', 60, 'Yes', '2025-04', 'Team default. Add a row per recruiter to override.'],
      ['*', 'M_FULFILMENT', 'M', 50, 'Yes', '2025-04', 'Team default. Levels: All, M, W or T.']
    ]);
    sh.getRange(2, 6, 2, 1).setNumberFormat('@');
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
    sh.setFrozenRows(1);
    dropStale_(KPI_TARGETS);
  }
}

function targetFor_(targets, recruiter, kpi, month) {
  const pick = function (who) {
    return targets.filter(function (t) { return t.recruiter === who && t.kpi === kpi && t.from <= month; })
      .sort(function (a, b) { return a.from < b.from ? 1 : -1; })[0];
  };
  return pick(String(recruiter).trim().toLowerCase()) || pick('*') || null;
}

function levelMatch_(levels, grade) {
  const l = String(levels || 'All').trim().toUpperCase();
  return l === 'ALL' || String(grade || '').trim().toUpperCase().indexOf(l) === 0;
}

function kpiScore_(pct) {
  if (pct === null) return null;
  return pct >= 100 ? 5 : pct >= 95 ? 4 : pct >= 90 ? 3 : pct >= 85 ? 2 : pct >= 80 ? 1 : 0;
}

/** Financial year months, e.g. fy 2026 → 2026-04 … 2027-03. */
function fyMonths_(fy) {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const m = 3 + i, y = fy + Math.floor(m / 12);
    out.push(y + '-' + String(m % 12 + 1).padStart(2, '0'));
  }
  return out;
}

function addDays_(ymd, n) {
  const p = ymd.split('-');
  const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
  return d.toISOString().slice(0, 10);
}

/** The KPI target rows, normalised. */
function kpiTargets_() {
  return readTable_(KPI_TARGETS).rows.map(function (r) {
    const f = r.Effective_From instanceof Date ? fmt_(r.Effective_From, TZ, 'yyyy-MM') : String(r.Effective_From || '0000-00').slice(0, 7);
    return { recruiter: String(r.Recruiter).trim().toLowerCase(), kpi: String(r.KPI).trim().toUpperCase(), levels: r.Levels,
      days: Number(r.TAT_Days) || 0, exempt: String(r.Notice_Exemption).toUpperCase() !== 'NO', from: f };
  });
}

const KPI_RECON_BUCKETS_ = [
  ['ontime', 'Counted, on time', 'Joined within the allowed days, in the month it joined (or fell due).'],
  ['late', 'Counted, filled late', 'Joined after the allowed days; counted as a miss in the month it fell due.'],
  ['overdue', 'Counted, overdue and not joined', 'Fell due in this month and nobody has joined yet; a miss.'],
  ['other', 'Counted in another month', 'Not yet due, or it joined or falls due in a different month.'],
  ['nostart', 'Joined but no start date', 'The position has no assigned, approved or received date, so it cannot be timed. Fix the date on the position.'],
  ['notarget', 'No KPI target', 'No KPI_Targets row covers this recruiter and grade level.'],
  ['internal', 'Filled internally', 'Internal fills have no joining date and are not part of this KPI.'],
  ['nohire', 'Closed without a hire', 'Not needed, no vacancy or on hold.'],
  ['replaced', 'Replaced after a backout, or removed', 'The replacement line carries the vacancy.']
];

/**
 * Where every position "worked on" in a month goes in the Timely closure KPI, so the count can be reconciled by hand.
 * A position is worked on in the month if its clock started on or before the month end and it had not ended before the month
 * start (ended = joined, closed without a hire, replaced or filled internally). Status is as of today. Uses the same placement
 * (`kpiDue_`) as the scorecard, so the first three rows add up to the cell.
 */
function kpiRecon_(month, recruiter) {
  const targets = kpiTargets_(), clocks = kpiClocks_(), start = month + '-01', end = addDays_(addDays_(start.slice(0, 8) + '28', 4).slice(0, 8) + '01', -1);
  const want = recruiter && recruiter !== 'TEAM_TOTAL' ? String(recruiter).trim().toLowerCase() : '';
  const out = {}; KPI_RECON_BUCKETS_.forEach(function (b) { out[b[0]] = []; });
  readTable_(T.MRF.name).rows.forEach(function (l) {
    const rec = String(l.Recruiter || 'Unassigned').trim() || 'Unassigned';
    if (want && rec.toLowerCase() !== want) return;
    const status = positionStatus_(l), clk = kpiLineClock_(l, clocks), receipt = clk.receipt, doj = clk.doj;
    const closedOn = doj || ymd_(l.Internal_Effective_Date) || ymd_(l.Not_Needed_Date) || ymd_(l.No_Vacancy_Date) || ymd_(l.Replaced_On);
    const joinedIn = !!doj && doj.slice(0, 7) === month;
    let bucket = '';
    if (joinedIn && !receipt) bucket = 'nostart';
    else if (!receipt || receipt > end || (closedOn && closedOn < start)) return;
    else if (status === 'Replaced' || status === 'Removed') bucket = 'replaced';
    else if (['Not Needed', 'No Vacancy', 'On Hold'].indexOf(status) >= 0) bucket = 'nohire';
    else if (String(l.Fill_Type || '') === 'Internal') bucket = 'internal';
    else {
      const d = kpiDue_(l, 'TIMELY_CLOSURE', targets, rec, clk, status);
      if (!d) bucket = 'notarget';
      else if (d.month !== month) bucket = 'other';
      else bucket = d.ok ? 'ontime' : doj ? 'late' : 'overdue';
    }
    out[bucket].push({ id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), recruiter: rec, status: status,
      receipt: receipt, doj: doj });
  });
  const total = KPI_RECON_BUCKETS_.reduce(function (s, b) { return s + out[b[0]].length; }, 0);
  return { month: month, buckets: KPI_RECON_BUCKETS_.map(function (b) { return { key: b[0], title: b[1], note: b[2], items: out[b[0]] }; }), total: total };
}

function apiKpiRecon(month, recruiter) {
  currentUser_();
  month = String(month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Pick a month.');
  return kpiRecon_(month, recruiter);
}

/** The shared clocks every KPI line needs (built once per run). */
function kpiClocks_() {
  return { grace: Number(settings_().NOTICE_GRACE_DAYS) || 30, exCtx: { exempt: exemptIndex_() }, exToday: ymd_(new Date()), ruleCtx: tatContext_() };
}
/** A line that can be worked on for the Timely closure KPI: Open, Offered or Closed, not filled internally. */
function kpiWorkable_(l, status) { return ['Open', 'Offered', 'Closed'].indexOf(status) >= 0 && String(l.Fill_Type || '') !== 'Internal'; }
/** Worked on in the month: the clock started by the month end and the position had not ended (joined) before the month start. */
function kpiWorkedIn_(clk, month) {
  const start = month + '-01', end = addDays_(addDays_(start.slice(0, 8) + '28', 4).slice(0, 8) + '01', -1);
  return !!clk.receipt && clk.receipt <= end && !(clk.doj && clk.doj < start);
}
/** The recruiter-clock numbers of one position line, as used by every KPI. */
function kpiLineClock_(l, k) {
  const receipt = tatStart_(l), doj = ymd_(l.Actual_DOJ);
  const ex = exemptFor_(k.exCtx, l, 'r'), notice = noticeExt_(l, receipt ? ruleFor_(k.ruleCtx, l.Grade, receipt).grace : k.grace), hold = Number(l.Hold_Days) || 0;
  const paused = receipt ? pausedDays_(l, ex.pauses, receipt, doj || k.exToday) : 0;
  return { receipt: receipt, doj: doj, ex: ex, notice: notice, hold: hold, paused: paused };
}
/**
 * Timely closure / M-level fulfilment placement of a line: the month it counts in and whether it was on time, or null when the
 * line is not part of the KPI (no target, other level, internal fill, not Open / Offered / Closed).
 */
function kpiDue_(l, kpi, targets, rec, clk, status) {
  if (!clk.receipt || ['Open', 'Offered', 'Closed'].indexOf(status) < 0 || String(l.Fill_Type || '') === 'Internal') return null;
  const t = targetFor_(targets, rec, kpi, clk.doj ? clk.doj.slice(0, 7) : clk.receipt.slice(0, 7));
  if (!t || !levelMatch_(t.levels, l.Grade)) return null;
  const allowed = t.days + (t.exempt ? clk.notice : 0) + clk.ex.days;
  const due = addDays_(clk.receipt, allowed + clk.hold + clk.paused), dueM = due.slice(0, 7), filledM = clk.doj ? clk.doj.slice(0, 7) : '';
  const days = clk.doj ? Math.max(0, daysBetween_(clk.receipt, clk.doj) - clk.hold - clk.paused) : '';
  return { month: filledM && filledM <= dueM ? filledM : dueM, due: due, allowed: allowed, days: days, ok: !!clk.doj && days <= allowed };
}

function computeKpis_(fy) {
  ensureKpiTargets_();
  ensureSchema_();
  const targets = kpiTargets_();
  const months = fyMonths_(fy);
  const lines = readTable_(T.MRF.name).rows;
  const recruiters = {};
  const cell = function () { return { num: 0, den: 0, worked: 0, workedOk: 0, items: [] }; };
  const bucket = function (rec, kpi, month) {
    const r = recruiters[rec] = recruiters[rec] || {};
    const k = r[kpi] = r[kpi] || {};
    return k[month] = k[month] || cell();
  };
  const inFy = function (m) { return months.indexOf(m) >= 0; };
  const clocks = kpiClocks_(), nowMonth = ymd_(new Date()).slice(0, 7);

  lines.forEach(function (l) {
    const rec = String(l.Recruiter || 'Unassigned').trim() || 'Unassigned';
    const receipt = tatStart_(l), doj = ymd_(l.Actual_DOJ);
    const status = positionStatus_(l);
    // Recruiter clock adjustments, as on the TAT screens: approved exemptions that apply to the recruiter, notice beyond
    // the grace (unless the Head of HR rejected it) and on-hold / paused days, which are not counted against the recruiter.
    const clk = kpiLineClock_(l, clocks), ex = clk.ex, hold = clk.hold, paused = clk.paused;
    const brief = { id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), receipt: receipt, doj: doj,
      hold: hold, paused: paused, extra: ex.days, reasons: ex.reasons.join('; ') };

    // 1 + 2. Timely closure (all levels) and M-level fulfilment: a position counts in the month it joined if that is on or before the month
    // it fell due, else in its due month (late and unfilled positions count against the month they fell due). On time = joined within the allowed days.
    ['TIMELY_CLOSURE', 'M_FULFILMENT'].forEach(function (kpi) {
      const d = kpiDue_(l, kpi, targets, rec, clk, status);
      if (!d || !inFy(d.month) || d.month > ymd_(new Date()).slice(0, 7)) return;
      const c = bucket(rec, kpi, d.month);
      c.den++; if (d.ok) c.num++;
      c.items.push(Object.assign({ due: d.due, allowed: d.allowed, days: d.days, ok: d.ok, status: status }, brief));
    });
    // Positions worked on in each month (clock started by month end, not ended before month start), and how many joined on time in it.
    if (kpiWorkable_(l, status)) months.forEach(function (m) {
      if (m > nowMonth) return;
      const d = kpiDue_(l, 'TIMELY_CLOSURE', targets, rec, clk, status);
      if (!d || !kpiWorkedIn_(clk, m)) return;
      const c = bucket(rec, 'TIMELY_CLOSURE', m);
      c.worked++; if (clk.doj && clk.doj.slice(0, 7) === m && clk.doj && d.days <= d.allowed) c.workedOk++;
    });

    // 3. Offer backout rate — backouts in the month ÷ offers made in the month.
    const offerM = ymd_(l.Offer_Date).slice(0, 7), backM = ymd_(l.Backout_Date).slice(0, 7);
    if (offerM && inFy(offerM)) { const c = bucket(rec, 'OFFER_BACKOUT', offerM); c.den++; c.items.push(Object.assign({ event: 'Offer', date: ymd_(l.Offer_Date) }, brief)); }
    if (backM && inFy(backM)) { const c = bucket(rec, 'OFFER_BACKOUT', backM); c.num++; c.items.push(Object.assign({ event: 'Backout', date: ymd_(l.Backout_Date) }, brief)); }
  });

  // ---- Compliance KPIs (scored from KPI_CAPTURE_FROM onward) ----
  const s = settings_();
  const capRaw = s.KPI_CAPTURE_FROM;
  const captureFrom = capRaw instanceof Date ? fmt_(capRaw, TZ, 'yyyy-MM') : String(capRaw || '').replace(/^'/, '').slice(0, 7) || '9999-99';
  const nowM = ymd_(new Date()).slice(0, 7), today = ymd_(new Date());
  const tracked = function (m) { return inFy(m) && m >= captureFrom && m <= nowM; };
  const lineById = {};
  lines.forEach(function (l) { lineById[l.Line_ID] = l; });

  // 4. Psychometric test — shortlisted Manager+ candidates without a completed or waived test.
  readTable_(T.CAND.name).rows.forEach(function (c) {
    const line = lineById[c.Line_ID];
    const grade = line ? line.Grade : '';
    if (!managerPlus_(grade, c.Offered_Designation || c.Position)) return;
    const shortlisted = ymd_(c.HR_Interview_Date) || (/selected|shortlisted/i.test(String(c.Tech_Result)) ? ymd_(c.Tech_Interview_Date) : '');
    if (!shortlisted || !tracked(shortlisted.slice(0, 7))) return;
    const rec = String((line && line.Recruiter) || c.Sourced_By || 'Unassigned').trim();
    const st = String(c.Psychometric_Status || '');
    const miss = ['Done', 'Waived'].indexOf(st) < 0;
    const b = bucket(rec, 'PSYCHOMETRIC', shortlisted.slice(0, 7));
    b.den++; if (miss) b.num++;
    b.items.push({ id: c.Candidate_ID, name: String(c.Name), position: String(c.Position), grade: grade, date: shortlisted, status: st || 'Not recorded', ok: !miss });
  });

  // 5. BGV — new hires (Manager+ or flagged) without previous-employer BGV initiated within 3 days after the offer (policy 9.1.1),
  //    or without current-employer BGV started within 2 days of joining.
  const bgvCase = {};
  try {
    if (ss_().getSheetByName('BGV_Cases')) readTable_('BGV_Cases').rows.forEach(function (c) {
      if (String(c.Status) === 'Cancelled') return;
      const k = c.Line_ID + '|' + c.Type, cur = bgvCase[k], lc = lineById[c.Line_ID];
      if (!cur || (lc && String(c.Candidate_ID || '') === String(lc.Candidate_ID || '') && String(cur.Candidate_ID || '') !== String(lc.Candidate_ID || ''))) bgvCase[k] = c;
    });
  } catch (e) { }
  lines.forEach(function (l) {
    const doj = ymd_(l.Actual_DOJ);
    if (!doj || positionStatus_(l) !== 'Closed' || !tracked(doj.slice(0, 7))) return;
    const flag = String(l.BGV_Required || 'Auto');
    const required = flag === 'Yes' || (flag !== 'No' && managerPlus_(l.Grade, l.Position));
    if (!required) return;
    const offer = ymd_(l.Offer_Date), cp = bgvCase[l.Line_ID + '|Previous employer'], cc = bgvCase[l.Line_ID + '|Current employer'];
    // the BGV case holds the dates (the position's fields mirror it); a case a lead waived is not a miss
    const prev = ymd_(cp ? cp.Initiated_On : '') || ymd_(l.BGV_Prev_Org_Date), curr = ymd_(cc ? cc.Initiated_On : '') || ymd_(l.BGV_Current_Org_Date);
    const deadline = addDays_(doj, 2);
    const prevOk = !!prev && (!offer || prev <= addDays_(offer, 3)) || !!(cp && String(cp.Outcome) === 'Waived');
    const currOk = (!!curr && curr <= deadline) || !!(cc && String(cc.Outcome) === 'Waived');
    const currPending = !curr && today <= deadline;
    const miss = !prevOk || (!currOk && !currPending);
    const rec = String(l.Recruiter || 'Unassigned').trim();
    const b = bucket(rec, 'BGV', doj.slice(0, 7));
    b.den++; if (miss) b.num++;
    b.items.push({ id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), doj: doj, offer: offer,
      prev: prev, curr: curr, ok: !miss,
      why: miss ? [!prev ? 'No previous-employer BGV' : (!prevOk ? 'Previous-employer BGV initiated more than 3 days after the offer' : ''), (!currOk && !currPending) ? (curr ? 'Current-employer BGV started late' : 'Current-employer BGV not started') : ''].filter(Boolean).join('; ') : (currPending ? 'Current-employer BGV due by ' + deadline : '') });
  });

  // 6. Observations — count per recruiter per month.
  readTable_('Observations').rows.forEach(function (o) {
    const d = ymd_(o.Obs_Date);
    if (!d || !tracked(d.slice(0, 7))) return;
    const b = bucket(String(o.Recruiter || 'Unassigned').trim(), 'MRF_ADHERENCE', d.slice(0, 7));
    b.num++; b.den++;
    b.items.push({ id: o.Obs_ID, date: d, type: String(o.Type), description: String(o.Description), mrf: String(o.MRF_No || ''), status: String(o.Status) });
  });

  // 7. Tracker accuracy — errors in the month's audit sample.
  const auditMonths = {};
  readTable_('Audit_Checks').rows.forEach(function (a) {
    const m = String(a.Month);
    if (!tracked(m)) return;
    const rec = String(a.Recruiter || 'Unassigned').trim();
    auditMonths[m] = auditMonths[m] || { pending: 0, recs: {} };
    auditMonths[m].recs[rec] = auditMonths[m].recs[rec] || 0;
    const b = bucket(rec, 'TRACKER_ACCURACY', m);
    b.den++;
    if (String(a.Result) === 'Error') b.num++;
    if (String(a.Result) === 'Pending') { b.pending = (b.pending || 0) + 1; auditMonths[m].pending++; }
    b.items.push({ id: a.Audit_ID, entity: String(a.Entity), record: String(a.Record_ID), label: String(a.Label), result: String(a.Result),
      field: String(a.Error_Field || ''), critical: String(a.Critical || ''), remarks: String(a.Remarks || '') });
  });

  // Every tracked month gets a cell for every recruiter, so "0 misses" shows as a full score.
  const known = {};
  readTable_('M_Recruiters').rows.forEach(function (r) { if (String(r.Active) !== 'No') known[String(r.Recruiter).trim()] = true; });
  Object.keys(recruiters).forEach(function (r) { known[r] = true; });
  Object.keys(known).forEach(function (rec) {
    months.filter(tracked).forEach(function (m) {
      ['PSYCHOMETRIC', 'MRF_ADHERENCE', 'BGV'].forEach(function (kpi) { bucket(rec, kpi, m); });
      if (auditMonths[m]) bucket(rec, 'TRACKER_ACCURACY', m);
    });
  });

  // Team rows = sum of each recruiter's numerators and denominators.
  const team = {};
  Object.keys(recruiters).forEach(function (rec) {
    Object.keys(recruiters[rec]).forEach(function (kpi) {
      Object.keys(recruiters[rec][kpi]).forEach(function (m) {
        const src = recruiters[rec][kpi][m];
        const t = (team[kpi] = team[kpi] || {})[m] = team[kpi][m] || cell();
        t.worked += src.worked || 0; t.workedOk += src.workedOk || 0;
        t.num += src.num; t.den += src.den; t.pending = (t.pending || 0) + (src.pending || 0);
        src.items.forEach(function (it) { t.items.push(Object.assign({ recruiter: rec }, it)); });
      });
    });
  });
  recruiters['TEAM_TOTAL'] = team;

  const finish = function (kpi, c) {
    if (KPI_DEFS[kpi].count) {
      const pending = c.pending || 0;
      return { num: c.num, den: c.den, pct: null, pending: pending,
        score: pending ? null : COUNT_SCORES[kpi](c.num), items: c.items };
    }
    const pct = c.den ? Math.round(1000 * c.num / c.den) / 10 : null;
    return { num: c.num, den: c.den, pct: pct, score: KPI_DEFS[kpi].scored ? kpiScore_(pct) : null, items: c.items,
      worked: kpi === 'TIMELY_CLOSURE' ? c.worked : undefined, workedOk: kpi === 'TIMELY_CLOSURE' ? c.workedOk : undefined };
  };
  const out = {};
  Object.keys(recruiters).forEach(function (rec) {
    out[rec] = {};
    Object.keys(KPI_DEFS).forEach(function (kpi) {
      out[rec][kpi] = {};
      months.forEach(function (m) {
        const c = recruiters[rec][kpi] && recruiters[rec][kpi][m];
        if (c) out[rec][kpi][m] = finish(kpi, c);
      });
    });
  });
  return { fy: fy, months: months, defs: KPI_DEFS, data: out, targets: targets, captureFrom: captureFrom,
    audited: Object.keys(auditMonths) };
}

/** Cached per financial year; the cache is refreshed after data changes or on request. */
function apiKpi(fy, fresh) {
  currentUser_();
  fy = Number(fy) || kpiCurrentFy_();
  const props = PropertiesService.getScriptProperties();
  const dirtyAt = (props.getProperty('DASH_DIRTY_AT') || '0') + '|' + (props.getProperty('KPI_DIRTY_AT') || '0');
  const key = 'kpi_b' + BUILD_ID + '_' + fy;   // the release number is part of the key, so a release never serves a result saved by older code
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) { const o = JSON.parse(hit); if (o.dirtyAt === dirtyAt) return o; }
  }
  const o = computeKpis_(fy);
  o.dirtyAt = dirtyAt;
  o.builtAt = fmt_(new Date(), TZ, 'd MMM yyyy, HH:mm');
  const json = JSON.stringify(o);
  if (json.length < 95000) cache.put(key, json, 21600);
  return o;
}

function kpiCurrentFy_() {
  const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
