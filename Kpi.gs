/**
 * Monthly KPI scorecard (stage 4, part 1): Timely closure, M-level and W-level fulfilment, Offer backout.
 * Targets live in the KPI_Targets sheet. A row with Recruiter "*" is the team default;
 * a row for a named recruiter overrides it from its Effective_From month onward.
 */
const KPI_TARGETS = 'KPI_Targets';
const KPI_DEFS = {
  TIMELY_CLOSURE: { name: 'Timely closure of vacant positions', scored: true },
  M_FULFILMENT: { name: 'Fulfilment of M-level positions within TAT', scored: true },
  W_FULFILMENT: { name: 'Fulfilment of W-level positions within TAT', scored: true },
  OFFER_BACKOUT: { name: 'Offer backout rate', scored: false },
  PSYCHOMETRIC: { name: 'Mettl psychometric test (Manager & above)', scored: true, count: true, unit: 'missed' },
  MRF_ADHERENCE: { name: 'MRF & assessment process adherence', scored: true, count: true, unit: 'logged' },
  BGV: { name: 'Background verification compliance', scored: true, count: true, unit: 'missed' },
  TRACKER_ACCURACY: { name: 'Recruitment & CV tracker accuracy', scored: true, count: true, unit: 'errors' }
};
/** The KPIs placed by kpiDue_ (target days, level and notice exemption from KPI_Targets); each has "worked on", a reconciliation and a drill-down. */
const KPI_TAT_ = ['TIMELY_CLOSURE', 'M_FULFILMENT', 'W_FULFILMENT'];
/** The team default of every TAT KPI. Seeded with the sheet, and appended to an existing sheet when its KPI has no row at all (never edits a row). */
const KPI_DEFAULT_TARGETS_ = [
  ['*', 'TIMELY_CLOSURE', 'All', 60, 'Yes', '2025-04', 'Team default. Add a row per recruiter to override.'],
  ['*', 'M_FULFILMENT', 'M', 50, 'Yes', '2025-04', 'Team default. Levels: All, M, W or T.'],
  ['*', 'W_FULFILMENT', 'W', 20, 'Yes', '2025-04', 'Team default. Add a row per recruiter to override.']
];
/** The default rows whose KPI has no row in the sheet. `have` is a set of KPI keys. */
function kpiMissingDefaults_(have) {
  return KPI_DEFAULT_TARGETS_.filter(function (r) { return !have[String(r[1]).toUpperCase()]; });
}
const COUNT_SCORES = {
  PSYCHOMETRIC: function (n) { return n === 0 ? 5 : n === 1 ? 3 : 0; },
  MRF_ADHERENCE: function (n) { return n > 4 ? 0 : 5 - n; },
  BGV: function (n) { return n === 0 ? 5 : n === 1 ? 2 : 0; },
  TRACKER_ACCURACY: function (n) { return n === 0 ? 5 : 0; }
};

/* ---------------- Score rules (editable since v146; the defaults below are what applies until someone saves a version) ---------------- */
const KPI_SCORING = 'KPI_Scoring';
/** Columns the editable set-up adds to KPI_Targets (old rows leave them blank; blank Active means Yes). */
const KPI_TARGET_EXTRA_COLS_ = ['Version_ID', 'Active', 'Reason', 'Saved_By', 'Saved_At'];
const KPI_SCORING_COLS_ = ['Version_ID', 'KPI', 'Kind', 'Rules_JSON', 'Effective_From', 'Reason', 'Saved_By', 'Saved_At'];
/** Percentage KPIs: "at least min % scores score"; below the lowest band scores 0. Count KPIs: "up to max items scores score"; more than the last step scores `otherwise`. */
const KPI_PERCENT_DEFAULT_ = [{ min: 100, score: 5 }, { min: 95, score: 4 }, { min: 90, score: 3 }, { min: 85, score: 2 }, { min: 80, score: 1 }];
const KPI_COUNT_DEFAULTS_ = {
  PSYCHOMETRIC: { steps: [{ max: 0, score: 5 }, { max: 1, score: 3 }], otherwise: 0 },
  MRF_ADHERENCE: { steps: [{ max: 0, score: 5 }, { max: 1, score: 4 }, { max: 2, score: 3 }, { max: 3, score: 2 }, { max: 4, score: 1 }], otherwise: 0 },
  BGV: { steps: [{ max: 0, score: 5 }, { max: 1, score: 2 }], otherwise: 0 },
  TRACKER_ACCURACY: { steps: [{ max: 0, score: 5 }], otherwise: 0 }
};
let _kpiDraft_ = null;   // a change being previewed: its rows are laid over the saved ones for one call (set and cleared by apiKpiPreview)
function kpiDefaultRules_(kpi) {
  return JSON.parse(JSON.stringify(KPI_DEFS[kpi] && KPI_DEFS[kpi].count ? KPI_COUNT_DEFAULTS_[kpi] : KPI_PERCENT_DEFAULT_));
}
function kpiRulesEqual_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
/** Saved score-rule versions, normalised: {id, kpi, kind, rules, from (yyyy-MM), idx}. A row that cannot be read is ignored (the default applies). */
function kpiScoring_() {
  const out = [];
  if (ss_().getSheetByName(KPI_SCORING)) {
    readTable_(KPI_SCORING).rows.forEach(function (r, i) {
      const kpi = String(r.KPI).trim().toUpperCase(), kind = String(r.Kind).trim().toUpperCase();
      if (!KPI_DEFS[kpi] || (kind !== 'PERCENT' && kind !== 'COUNT')) return;
      let rules; try { rules = JSON.parse(String(r.Rules_JSON || '')); } catch (e) { return; }
      const f = r.Effective_From instanceof Date ? fmt_(r.Effective_From, TZ, 'yyyy-MM') : String(r.Effective_From || '').replace(/^'/, '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(f) || !rules) return;
      out.push({ id: String(r.Version_ID || ''), kpi: kpi, kind: kind, rules: rules, from: f, idx: i });
    });
  }
  if (_kpiDraft_ && _kpiDraft_.scoring) _kpiDraft_.scoring.forEach(function (d, j) { out.push(Object.assign({}, d, { idx: 1e6 + j })); });
  return out;
}
/** The rules in force for a KPI in a month: the saved version with the latest start month on or before it (a later row wins a tie), else the default. */
function kpiRulesFor_(scoring, kpi, month) {
  const rows = (scoring || []).filter(function (r) { return r.kpi === kpi && r.from <= month; })
    .sort(function (a, b) { return a.from < b.from ? 1 : a.from > b.from ? -1 : (b.idx || 0) - (a.idx || 0); });
  return rows.length ? rows[0].rules : kpiDefaultRules_(kpi);
}
/** The score (0-5) of a value under the rules in force in `month`; null when there is no value. With no saved version it equals kpiScore_ / COUNT_SCORES. */
function kpiScoreFor_(scoring, kpi, value, month) {
  if (value === null || value === undefined) return null;
  const rules = kpiRulesFor_(scoring, kpi, month);
  if (KPI_DEFS[kpi].count) {
    const steps = (rules.steps || []).slice().sort(function (a, b) { return a.max - b.max; });
    for (let i = 0; i < steps.length; i++) if (value <= steps[i].max) return steps[i].score;
    return Number(rules.otherwise) || 0;
  }
  const bands = (Array.isArray(rules) ? rules : []).slice().sort(function (a, b) { return b.min - a.min; });
  for (let i = 0; i < bands.length; i++) if (value >= bands[i].min) return bands[i].score;
  return 0;
}

let _kptColsDone_ = false;
function ensureKpiTargets_() {
  let sh = ss_().getSheetByName(KPI_TARGETS);
  if (!sh) {
    sh = ss_().insertSheet(KPI_TARGETS);
    sh.getRange(1, 1, 1 + KPI_DEFAULT_TARGETS_.length, 7).setValues([['Recruiter', 'KPI', 'Levels', 'TAT_Days', 'Notice_Exemption', 'Effective_From', 'Note']].concat(KPI_DEFAULT_TARGETS_));
    sh.getRange(2, 6, KPI_DEFAULT_TARGETS_.length, 1).setNumberFormat('@');
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
    sh.setFrozenRows(1);
    addColumns_(KPI_TARGETS, KPI_TARGET_EXTRA_COLS_);
    _kptColsDone_ = true;
    dropStale_(KPI_TARGETS);
    return;
  }
  if (!_kptColsDone_) { addColumns_(KPI_TARGETS, KPI_TARGET_EXTRA_COLS_); _kptColsDone_ = true; }   // the columns for versions, once per run (it reads one header row)
  // An existing sheet gets the default row of any TAT KPI it has no row for (a new KPI), once; nothing already there is changed.
  const have = function () { const h = {}; kpiTargets_().forEach(function (t) { h[t.kpi] = true; }); return h; };
  if (!kpiMissingDefaults_(have()).length) return;
  withLock_(function () {
    _tables = {};
    const add = kpiMissingDefaults_(have());
    if (!add.length) return;
    const at = sh.getLastRow() + 1;
    sh.getRange(at, 1, add.length, 7).setValues(add);
    sh.getRange(at, 6, add.length, 1).setNumberFormat('@');
    dropStale_(KPI_TARGETS);
  });
}

function targetFor_(targets, recruiter, kpi, month) {
  const pick = function (who) {
    return targets.filter(function (t) { return t.recruiter === who && t.kpi === kpi && t.from <= month; })
      .sort(function (a, b) { return a.from < b.from ? 1 : a.from > b.from ? -1 : (b.idx || 0) - (a.idx || 0); })[0];
  };
  const mine = pick(String(recruiter).trim().toLowerCase());
  if (mine && mine.active !== false) return mine;   // a row with Active = No ends the override: the team target applies again from its month
  const team = pick('*');
  return team && team.active !== false ? team : null;
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
  return readTable_(KPI_TARGETS).rows.map(function (r, i) {
    const f = r.Effective_From instanceof Date ? fmt_(r.Effective_From, TZ, 'yyyy-MM') : String(r.Effective_From || '0000-00').slice(0, 7);
    return { recruiter: String(r.Recruiter).trim().toLowerCase(), kpi: String(r.KPI).trim().toUpperCase(), levels: r.Levels,
      days: Number(r.TAT_Days) || 0, exempt: true, from: f,   // v151: notice beyond the grace is always exempt; the sheet's Notice_Exemption column is no longer read
     
      active: String(r.Active == null ? '' : r.Active).trim().toUpperCase() !== 'NO', id: String(r.Version_ID || ''), idx: i };
  }).concat(_kpiDraft_ && _kpiDraft_.targets ? _kpiDraft_.targets.map(function (d, j) { return Object.assign({}, d, { idx: 1e6 + j }); }) : []);
}

/** The TAT KPIs scored on positions worked on (worked − missed) ÷ worked: Timely closure (v153) and M-level fulfilment (v157). W-level stays on time ÷ due. */
const KPI_WORKED_BASIS_ = ['TIMELY_CLOSURE', 'M_FULFILMENT', 'W_FULFILMENT'];   // v166: all three on positions worked on
const KPI_RECON_BUCKETS_ = [
  ['ontime', 'Achieved: joined on time', 'Joined in this month within the allowed days.'],
  ['within', 'Achieved: within TAT at month end', 'Not joined by the end of this month (today, in the current month) and its due date had not passed.'],
  ['late', 'Missed: joined late', 'Joined in this month after the allowed days.'],
  ['closedok', 'Achieved: closed without a hire within TAT', 'Marked Not needed or No vacancy in this month, within the allowed days (v174).'],
  ['closedlate', 'Missed: closed without a hire after TAT', 'Marked Not needed or No vacancy in this month, after the allowed days (v174).'],
  ['overdue', 'Missed: past TAT, not filled', 'Its due date had passed by the end of this month and nobody had joined yet. It is a miss in every month until it is filled.'],
  ['nostart', 'Joined but no start date', 'The position has no assigned, approved or received date, so it cannot be timed. Fix the date on the position.'],
  ['notarget', 'No KPI target', 'No KPI_Targets row covers this recruiter and grade level.'],
  ['internal', 'Filled internally', 'Internal fills have no joining date and are not part of this KPI.'],
  ['nohire', 'Closed without a hire', 'On hold, or Not needed / No vacancy with no closing date entered. Not counted.'],
  ['replaced', 'Replaced after a backout, or removed', 'The replacement line carries the vacancy.']
];

/**
 * Where every position "worked on" in a month goes in a TAT KPI (Timely closure, M-level or W-level), so the count can be reconciled by hand.
 * A position is worked on in the month if its clock started on or before the month end and it had not ended before the month
 * start (ended = joined, closed without a hire, replaced or filled internally). Status is as of today. Uses the same placement
 * (`kpiDue_`) as the scorecard, so the first three rows add up to the cell.
 */
function kpiRecon_(month, recruiter, kpi) {
  kpi = kpi || 'TIMELY_CLOSURE';
  const targets = kpiTargets_(), clocks = kpiClocks_(), start = month + '-01', end = addDays_(addDays_(start.slice(0, 8) + '28', 4).slice(0, 8) + '01', -1);
  const want = recruiter && recruiter !== 'TEAM_TOTAL' ? String(recruiter).trim().toLowerCase() : '';
  const out = {}; KPI_RECON_BUCKETS_.forEach(function (b) { out[b[0]] = []; });
  const reconLine = function (l, cr) {
    const rec = cr ? cr.name : (String(l.Recruiter || 'Unassigned').trim() || 'Unassigned');
    if (want && rec.toLowerCase() !== want) return;
    const status = positionStatus_(l), clk = kpiLineClock_(l, clocks, cr ? cr.from : ''), receipt = clk.receipt, doj = clk.doj;
    const joinedIn = !!doj && doj.slice(0, 7) === month;
    let bucket = '', d = null;
    if (kpiWorkable_(l, status) && receipt) {
      /* A position that can count is placed exactly as on the scorecard (the "worked on" test and kpiDue_), so the rows up to
         "Counted in another month" add up to the cell's worked-on count and the first three to its due count (v153). */
      if (!kpiWorkedIn_(clk, month)) return;
      d = kpiDue_(l, kpi, targets, rec, clk, status);
      if (!d) { const t = kpiTargetFor_(l, kpi, targets, rec, clk); if (t && !levelMatch_(t.levels, l.Grade)) return; bucket = 'notarget'; }   // another level is not part of this KPI
      else bucket = kpiMonthStatus_(clk, d, month, clk.today).why;
    } else {
      const lvl = targetFor_(targets, rec, kpi, month);
      if (lvl && !levelMatch_(lvl.levels, l.Grade)) return;   // a position of another level is not part of this KPI
      const closedOn = doj || ymd_(l.Internal_Effective_Date) || ymd_(l.Not_Needed_Date) || ymd_(l.No_Vacancy_Date) || ymd_(l.Replaced_On);
      if (joinedIn && !receipt) bucket = 'nostart';
      else if (!receipt || receipt > end || (closedOn && closedOn < start)) return;
      else if (status === 'Replaced' || status === 'Removed') bucket = 'replaced';
      else if (['Not Needed', 'No Vacancy', 'On Hold'].indexOf(status) >= 0) bucket = 'nohire';
      else if (String(l.Fill_Type || '') === 'Internal') bucket = 'internal';
      else return;
    }
    const it = { id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), recruiter: rec, status: status,
      receipt: receipt, doj: doj };
    Object.assign(it, kpiReconRow_(l, status, clk, d, bucket, kpi, targets, rec, end, cr));
    out[bucket].push(it);
  };
  readTable_(T.MRF.name).rows.forEach(function (l) { reconLine(l, null); if (want) posTaggedCredits_(l).forEach(function (cr) { reconLine(l, cr); }); });   // the team total is the lead credit only (v164)
  const total = KPI_RECON_BUCKETS_.reduce(function (s, b) { return s + out[b[0]].length; }, 0);
  return { month: month, buckets: KPI_RECON_BUCKETS_.map(function (b) { return { key: b[0], title: b[1], note: b[2], items: out[b[0]] }; }), total: total };
}

/** Where a position's TAT clock starts from (the same order as tatStart_), as text for the tracker report. */
function kpiStartSource_(l) {
  return ymd_(l.TAT_Start_From) ? 'Original MRF start' : ymd_(l.Assigned_On) ? 'Assigned' : ymd_(l.Approved_On) ? 'MRF approved' : 'MRF received';
}
/**
 * The tracker-style fields of one position of the reconciliation (v155), for the Excel report: the MRF columns as recorded plus the
 * TAT figures the scorecard used (target days, allowed days, due date, days taken to DOJ for KRA, achieved or missed). DOJ for KRA =
 * the actual joining date, else the review month's last day (today, in the current month); days taken run to it, less on-hold and paused days.
 */
/** v176: hold days of a position inside [start, end) from its hold ranges (each day once); with no ranges recorded, the stored total (it cannot be bounded). */
function kpiHoldDaysIn_(l, start, end) {
  const rs = holdRanges_(l); if (!rs.length) return Number(l.Hold_Days) || 0;
  const seen = {}; let n = 0;
  rs.forEach(function (r) { let d = r[0] < start ? start : r[0], g = 0; while (d <= r[1] && d < end && g++ < 4000) { if (!seen[d]) { seen[d] = true; n++; } d = addDays_(d, 1); } });
  return n;
}
function kpiReconRow_(l, status, clk, d, bucket, kpi, targets, rec, monthEnd, cr) {
  const t = clk.receipt ? kpiTargetFor_(l, kpi, targets, rec, clk) : null, today = clk.today || ymd_(new Date());
  const cutoff = monthEnd > today ? today : monthEnd, fin = clk.doj || clk.end, dojKra = fin && fin <= cutoff ? fin : cutoff;   // v166: a later joining does not count in this month
  // v176: the closing day of a position by its own status (the No vacancy / Not needed date fields also hold dates of earlier or other statuses)
  const closed = clk.doj || (status === 'Closed' ? ymd_(l.Internal_Effective_Date) : status === 'Not Needed' ? ymd_(l.Not_Needed_Date) : status === 'No Vacancy' ? ymd_(l.No_Vacancy_Date)
    : status === 'Replaced' ? ymd_(l.Replaced_On) : status === 'Removed' ? ymd_(l.Not_Needed_Date) : '');
  const finished = !!fin && fin <= cutoff;
  const holdD = !clk.receipt ? '' : finished ? clk.hold : kpiHoldDaysIn_(l, clk.receipt, dojKra), pausedD = !clk.receipt ? '' : finished ? clk.paused : pausedDays_(l, clk.ex.pauses, clk.receipt, dojKra);
  const res = { ontime: 'Achieved', within: 'Achieved', late: 'Missed', overdue: 'Missed', closedok: 'Achieved', closedlate: 'Missed' }[bucket] || 'Not counted';   // v166: a counted position is Achieved or Missed in every month
  const remark = String(l.Remarks || '');
  return { dept: String(l.Dept || ''), nres: l.No_Of_Positions == null ? '' : String(l.No_Of_Positions), appr: String(l.Approval_Status || ''), nv: status === 'No Vacancy' ? ymd_(l.No_Vacancy_Date) : '', nn: status === 'Not Needed' ? ymd_(l.Not_Needed_Date) : '', holdOn: status === 'On Hold' ? ymd_(l.Not_Needed_Date) : '',
    dojIn: clk.doj && clk.doj <= cutoff ? clk.doj : '', rcv: ymd_(l.Receipt_Date), apprOn: ymd_(l.Approved_On), asgOn: ymd_(l.Assigned_On), carried: ymd_(l.TAT_Start_From), credit: cr ? 'Tagged' : 'Lead', exApproved: d ? clk.ex.days : '', exOther: d ? Math.max(0, d.allowed - d.std - clk.ex.days) : '',
    osent: String(l.Offer_Sent || ''), odate: ymd_(l.Offer_Date), edoj: ymd_(l.EDOJ), closed: closed, notice: Number(l.Notice_Period_Days) || '', bo: ymd_(l.Backout_Date),
    rmk: remark.length > 600 ? remark.slice(0, 600) + '\u2026' : remark, std: d ? d.std : '', allowed: d ? d.allowed : '', exm: d ? d.allowed - d.std : '',
    logic: clk.receipt ? (cr ? 'Assigned (tagged recruiter)' : kpiStartSource_(l)) + (clk.end && !clk.doj ? ' to closing date' : ' to DOJ') + (d && d.byOffer ? ' \u00b7 notice from the offer' : '') : '', dojKra: clk.receipt ? dojKra : '', due: d ? d.due : '',
    days: clk.receipt ? Math.max(0, daysBetween_(clk.receipt, dojKra) - holdD - pausedD) : '', result: res };
}
function apiKpiRecon(month, recruiter, kpi) {
  currentUser_();
  month = String(month || '');
  kpi = String(kpi || 'TIMELY_CLOSURE');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Pick a month.');
  if (KPI_TAT_.indexOf(kpi) < 0) throw new Error('That KPI has no reconciliation.');
  const r = kpiRecon_(month, recruiter, kpi); r.kpi = kpi; r.name = KPI_DEFS[kpi].name;
  return r;
}

/** The shared clocks every KPI line needs (built once per run). */
function kpiClocks_() {
  return { grace: Number(settings_().NOTICE_GRACE_DAYS) || 30, exCtx: { exempt: exemptIndex_() }, exToday: ymd_(new Date()), ruleCtx: tatContext_() };
}
/** A line that can be worked on for the Timely closure KPI: Open, Offered or Closed, not filled internally. */
function kpiWorkable_(l, status) { return (['Open', 'Offered', 'Closed'].indexOf(status) >= 0 || !!kpiClosedOn_(l, status)) && String(l.Fill_Type || '') !== 'Internal'; }
/**
 * v174: the day a position was closed without a hire (Not needed or No vacancy date), or '' (a joined position, another status, or no date).
 * Until that day the position was being worked on; the day acts like a joining date for the clock.
 */
function kpiClosedOn_(l, status) {
  if (ymd_(l.Actual_DOJ)) return '';
  const d = status === 'Not Needed' ? ymd_(l.Not_Needed_Date) : status === 'No Vacancy' ? ymd_(l.No_Vacancy_Date) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}
/** Worked on in the month: the clock started by the month end and the position had not ended (joined) before the month start. */
function kpiWorkedIn_(clk, month) {
  const start = month + '-01', end = addDays_(addDays_(start.slice(0, 8) + '28', 4).slice(0, 8) + '01', -1);
  return !!clk.receipt && clk.receipt <= end && !(clk.doj && clk.doj < start) && !(clk.end && clk.end < start);
}
/** The recruiter-clock numbers of one position line, as used by every KPI. */
function kpiLineClock_(l, k, startOverride) {
  const receipt = startOverride || tatStart_(l), doj = ymd_(l.Actual_DOJ), end = kpiClosedOn_(l, positionStatus_(l));
  const ex = exemptFor_(k.exCtx, l, 'r'), notice = noticeExt_(l, receipt ? ruleFor_(k.ruleCtx, l.Grade, receipt).grace : k.grace), hold = Number(l.Hold_Days) || 0;
  const paused = receipt ? pausedDays_(l, ex.pauses, receipt, doj || end || k.exToday) : 0;
  /* v167: the standard days of the position's own grade, from the TAT rule in force on the day its clock started (Admin > TAT rules). */
  const std = receipt ? Number(ruleFor_(k.ruleCtx, l.Grade, receipt).std) || 0 : 0;
  return { receipt: receipt, doj: doj, end: end, ex: ex, notice: notice, hold: hold, paused: paused, offer: tatOffer_(l), noticeDays: Number(l.Notice_Period_Days) || 0, today: k.exToday, std: std };
}
/**
 * Timely closure / M-level fulfilment placement of a line: the month it counts in and whether it was on time, or null when the
 * line is not part of the KPI (no target, other level, internal fill, not Open / Offered / Closed).
 */
function kpiTargetFor_(l, kpi, targets, rec, clk) {
  return clk.receipt ? targetFor_(targets, rec, kpi, clk.doj ? clk.doj.slice(0, 7) : clk.receipt.slice(0, 7)) : null;
}
/**
 * v166: the status of one position in one review month it was worked on. The cut-off is the month end (today, in the current month).
 * Joined by the cut-off: on time or late by its days taken. Not joined by the cut-off (also when it joined in a later month):
 * within TAT while the due date is on or after the cut-off, else past TAT. Returns {ok, why: ontime | late | within | overdue}.
 */
function kpiMonthStatus_(clk, d, month, today) {
  const end = addDays_(addDays_(month + '-28', 4).slice(0, 8) + '01', -1), cut = today && end > today ? today : end;
  if (clk.doj && clk.doj <= cut) { const ok = d.days <= d.allowed; return { ok: ok, why: ok ? 'ontime' : 'late', cut: cut }; }
  if (!clk.doj && clk.end && clk.end <= cut) { const ok = d.days <= d.allowed; return { ok: ok, why: ok ? 'closedok' : 'closedlate', cut: cut }; }   // v174: closed without a hire: the closing day is judged like a joining
  const ok = d.due >= cut;
  return { ok: ok, why: ok ? 'within' : 'overdue', cut: cut };
}
function kpiDue_(l, kpi, targets, rec, clk, status, flatDays) {
  if (!clk.receipt || (['Open', 'Offered', 'Closed'].indexOf(status) < 0 && !(clk.end && ['Not Needed', 'No Vacancy'].indexOf(status) >= 0)) || String(l.Fill_Type || '') === 'Internal') return null;
  const t = kpiTargetFor_(l, kpi, targets, rec, clk);
  if (!t || !levelMatch_(t.levels, l.Grade)) return null;
  // Notice beyond the grace is always added (v151); an offer sent within the TAT runs the full notice from the offer (v152).
  /* v167: the days are the grade's own TAT rule (clk.std); the KPI target only says which levels count. flatDays = the target's single
     number, as before v167, used only for the comparison download (and when a clock carries no grade days). */
  const std = !flatDays && clk.std ? clk.std : t.days;
  const shut = !clk.doj && !!clk.end;   // closed without a hire (v174): nobody joins, so the notice period plays no part
  const a = tatAllowed_(clk.receipt, std + clk.ex.days, shut ? 0 : clk.notice, shut ? 0 : clk.noticeDays, clk.hold, clk.paused, shut ? '' : clk.offer), allowed = a.allowed;
  const due = addDays_(clk.receipt, allowed + clk.hold + clk.paused), dueM = due.slice(0, 7), filledM = (clk.doj || clk.end) ? (clk.doj || clk.end).slice(0, 7) : '';
  const days = (clk.doj || clk.end) ? Math.max(0, daysBetween_(clk.receipt, clk.doj || clk.end) - clk.hold - clk.paused) : '';
  return { month: filledM && filledM <= dueM ? filledM : dueM, due: due, allowed: allowed, std: std, days: days, ok: !!(clk.doj || clk.end) && days <= allowed,
    byOffer: a.byOffer, offer: a.byOffer ? clk.offer : '',
    notDue: !clk.doj && !clk.end && !!clk.today && due >= clk.today };   // not joined and the due date is today or later: not a miss yet (v153)
}

function computeKpis_(fy) {
  ensureKpiTargets_();
  ensureSchema_();
  const targets = kpiTargets_(), scoring = kpiScoring_();
  const months = fyMonths_(fy);
  const lines = readTable_(T.MRF.name).rows;
  const recruiters = {};
  const cell = function () { return { num: 0, den: 0, worked: 0, workedOk: 0, items: [], notDue: 0, notDueItems: [] }; };
  const bucketIn = function (store) {
    return function (rec, kpi, month) {
      const r = store[rec] = store[rec] || {};
      const k = r[kpi] = r[kpi] || {};
      return k[month] = k[month] || cell();
    };
  };
  const bucketMain = bucketIn(recruiters), extra = {}, bucketExtra = bucketIn(extra);   // extra: the tagged recruiters' cells (v164), merged after the team row is built
  const bucket = bucketMain;
  const inFy = function (m) { return months.indexOf(m) >= 0; };
  const clocks = kpiClocks_(), nowMonth = ymd_(new Date()).slice(0, 7);

  const doLine = function (l, cr) {
    const bucket = cr ? bucketExtra : bucketMain;   // a tagged recruiter's credit goes to their own cells; the lead's goes exactly where it always did
    const rec = cr ? cr.name : (String(l.Recruiter || 'Unassigned').trim() || 'Unassigned');
    const receipt = cr ? cr.from : tatStart_(l), doj = ymd_(l.Actual_DOJ);
    const status = positionStatus_(l);
    // Recruiter clock adjustments, as on the TAT screens: approved exemptions that apply to the recruiter, notice beyond
    // the grace (unless the Head of HR rejected it) and on-hold / paused days, which are not counted against the recruiter.
    const clk = kpiLineClock_(l, clocks, cr ? cr.from : ''), ex = clk.ex, hold = clk.hold, paused = clk.paused;
    const brief = { id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), receipt: receipt, doj: doj,
      hold: hold, paused: paused, extra: ex.days, reasons: ex.reasons.join('; ') };
    // Where the TAT start comes from, so the drill-down can say which date it is (the MRF approved date, not the received date).
    if (cr) brief.credit = 'tagged';
    const startFrom = cr ? 'assigned' : ymd_(l.TAT_Start_From) ? 'carried' : ymd_(l.Assigned_On) ? (ymd_(l.Assigned_On) === ymd_(l.Approved_On) ? 'approved' : 'assigned') : ymd_(l.Approved_On) ? 'approved' : 'received';
    if (startFrom !== 'approved') brief.from = startFrom;   // the usual case (counted from the MRF approved date) is left out to keep the result small
    if (startFrom === 'assigned' && ymd_(l.Approved_On)) brief.appr = ymd_(l.Approved_On);
    if (ymd_(l.Receipt_Date) && ymd_(l.Receipt_Date) !== receipt) brief.recv = ymd_(l.Receipt_Date);

    // 1 + 2 + 3. Timely closure (all levels), M-level and W-level fulfilment (v166): every position worked on in a month is either
    // Achieved or Missed in that month (kpiMonthStatus_). Rate = achieved \u00f7 worked on. Each KPI counts only the positions of its own
    // level (kpiDue_ gives null for the others). The cell lists the misses and the joinings; "within TAT" rows are in the reconciliation.
    if (kpiWorkable_(l, status)) KPI_TAT_.forEach(function (kpi) {
      const d = kpiDue_(l, kpi, targets, rec, clk, status);
      if (!d) return;
      const dFlat = kpiDue_(l, kpi, targets, rec, clk, status, true);   // with the target's single number of days (before v167), for the comparison download only
      months.forEach(function (m) {
        if (m > nowMonth || !kpiWorkedIn_(clk, m)) return;
        const c = bucket(rec, kpi, m), st = kpiMonthStatus_(clk, d, m, clocks.exToday);
        if (dFlat && kpiMonthStatus_(clk, dFlat, m, clocks.exToday).ok) c.oNum = (c.oNum || 0) + 1;
        c.worked++; c.den++;
        if (st.ok) c.num++;
        if (st.why === 'ontime') c.workedOk++;
        if (st.why !== 'within') {
          const it = Object.assign({ due: d.due, allowed: d.allowed, std: d.std, days: st.why === 'overdue' ? '' : d.days, ok: st.ok, why: st.why, status: status }, brief);
          if (st.why === 'overdue') it.doj = '';   // in this month it had not joined yet
          if (st.why === 'closedok' || st.why === 'closedlate') { it.doj = ''; it.closedOn = clk.end; it.closedAs = status; }   // v174: closed without a hire
          if (d.byOffer) { it.offer = d.offer; it.ndays = clk.noticeDays; }   // the notice runs from an in-time offer (v152); left out otherwise to keep the result small
          else if (clk.notice) it.notice = clk.notice;
          c.items.push(it);
        }
        if (kpi === 'TIMELY_CLOSURE') bucket(rec, 'OFFER_BACKOUT', m).den++;   // positions worked on in the month
      });
    });

    // 3. Offer backout rate (v150) — candidates who backed out in the month ÷ positions worked on in the month × 100.
    // The backout is counted in the month of its date, for the position's recruiter; the positions worked on are counted in the loop above.
    const backM = ymd_(l.Backout_Date).slice(0, 7);
    if (backM && inFy(backM)) { const c = bucket(rec, 'OFFER_BACKOUT', backM); c.num++; c.items.push(Object.assign({ event: 'Backout', date: ymd_(l.Backout_Date) }, brief)); }
  };
  lines.forEach(function (l) { doLine(l, null); posTaggedCredits_(l).forEach(function (cr) { doLine(l, cr); }); });

  // ---- Compliance KPIs (scored from KPI_CAPTURE_FROM onward) ----
  const s = settings_();
  const capRaw = _kpiDraft_ && _kpiDraft_.captureFrom ? _kpiDraft_.captureFrom : s.KPI_CAPTURE_FROM;
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
    // an approved KRA exclusion (v158): the former employer's release is awaited, so the current-employer start is not judged
    const excl = !!(cc && String(cc.Excl_Status) === 'Approved' && String(cc.Status) !== 'Cancelled'), exclRel = excl ? ymd_(cc.Release_On) : '';
    const currOk = (!!curr && curr <= deadline) || !!(cc && String(cc.Outcome) === 'Waived') || excl;
    const currPending = !curr && today <= deadline;
    const miss = !prevOk || (!currOk && !currPending);
    const rec = String(l.Recruiter || 'Unassigned').trim();
    const b = bucket(rec, 'BGV', doj.slice(0, 7));
    b.den++; if (miss) b.num++;
    b.items.push({ id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), doj: doj, offer: offer,
      prev: prev, curr: curr, ok: !miss, excl: excl ? 'Excluded from the KRA: the former employer\u2019s release is awaited' + (exclRel ? ', expected ' + exclRel : '') : undefined,
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
    const m = auditMonth_(a.Month);
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
        t.num += src.num; t.den += src.den; t.pending = (t.pending || 0) + (src.pending || 0); t.notDue += src.notDue || 0;
        t.oNum = (t.oNum || 0) + (src.oNum || 0);
        src.items.forEach(function (it) { t.items.push(Object.assign({ recruiter: rec }, it)); });
        (src.notDueItems || []).forEach(function (it) { t.notDueItems.push(Object.assign({ recruiter: rec }, it)); });
      });
    });
  });
  recruiters['TEAM_TOTAL'] = team;
  Object.keys(extra).forEach(function (rec) {   // v164: the tagged recruiters' own cells, added after the team row so a position counts once in the team
    Object.keys(extra[rec]).forEach(function (kpi) {
      Object.keys(extra[rec][kpi]).forEach(function (m) {
        const src = extra[rec][kpi][m], dst = bucketMain(rec, kpi, m);
        dst.num += src.num; dst.den += src.den; dst.worked += src.worked; dst.workedOk += src.workedOk; dst.notDue += src.notDue;
        dst.oNum = (dst.oNum || 0) + (src.oNum || 0);
        src.items.forEach(function (it) { dst.items.push(it); });
        src.notDueItems.forEach(function (it) { dst.notDueItems.push(it); });
      });
    });
  });

  const finish = function (kpi, c, m) {
    if (KPI_DEFS[kpi].count) {
      const pending = c.pending || 0;
      return { num: c.num, den: c.den, pct: null, pending: pending,
        score: pending ? null : kpiScoreFor_(scoring, kpi, c.num, m), items: c.items };
    }
    /* TAT KPIs (v166) = positions achieved in the month \u00f7 positions worked on in it (den = worked on). The other KPIs: num \u00f7 den. */
    const tat = KPI_TAT_.indexOf(kpi) >= 0, missed = c.den - c.num;
    const pct = c.den ? Math.round(1000 * c.num / c.den) / 10 : null;
    const o = { num: c.num, den: c.den, pct: pct, score: KPI_DEFS[kpi].scored ? kpiScoreFor_(scoring, kpi, pct, m) : null, items: c.items,
      worked: tat ? c.worked : undefined, workedOk: tat ? c.workedOk : undefined, missed: tat ? missed : undefined };
    if (tat) {   // the result with the KPI target's single number of days (before v167), for the comparison download only
      o.oldMissed = c.worked - (c.oNum || 0);
      o.oldPct = c.worked ? Math.round(1000 * (c.oNum || 0) / c.worked) / 10 : null;
    }
    return o;
  };
  const out = {};
  Object.keys(recruiters).forEach(function (rec) {
    out[rec] = {};
    Object.keys(KPI_DEFS).forEach(function (kpi) {
      out[rec][kpi] = {};
      months.forEach(function (m) {
        const c = recruiters[rec][kpi] && recruiters[rec][kpi][m];
        if (c) out[rec][kpi][m] = finish(kpi, c, m);
      });
    });
  });
  /* The rules in force now, for the scorecard's own text (each month's cell is scored by the rules of that month). */
  const rulesNow = {};
  Object.keys(KPI_DEFS).forEach(function (kpi) {
    if (!KPI_DEFS[kpi].scored) return;
    const r = kpiRulesFor_(scoring, kpi, nowMonth);
    rulesNow[kpi] = { rules: r, isDefault: kpiRulesEqual_(r, kpiDefaultRules_(kpi)) };
  });
  return { fy: fy, months: months, defs: KPI_DEFS, data: out, targets: targets, captureFrom: captureFrom, scoring: rulesNow, grace: clocks.grace,
    audited: Object.keys(auditMonths) };
}

/** Cached per financial year; the cache is refreshed after data changes or on request. */
function apiKpi(fy, fresh) { return timed_('apiKpi', apiKpiRun_, arguments); }
function apiKpiRun_(fy, fresh) {
  currentUser_();
  fy = Number(fy) || kpiCurrentFy_();
  const props = PropertiesService.getScriptProperties();
  /* v165: the result depends only on these tables, the explicit KPI flag (set-up changes), the day and the split-credit date.
     Stage moves and the daily log no longer throw it away. */
  const dirtyAt = tableStamps_(KPI_TABLES_).join('.') + '|' + (props.getProperty('KPI_DIRTY_AT') || '0') + '|' + ymd_(new Date()) + '|' + splitFrom_();   // a new day can make a position due (v153); the split-credit date changes who is credited (v164)
  const key = 'kpi_b' + BUILD_ID + '_' + dbTag_() + '_' + fy;   // the release number is part of the key, so a release never serves a result saved by older code
  if (!fresh) {
    /* The result is kept in pieces (cacheBigPut_), so it is cached however large it grows; a piece that is missing counts as no cache. */
    const hit = cacheBigGet_(key);
    let old = null;
    if (hit) { try { old = JSON.parse(hit); if (old.dirtyAt === dirtyAt) { perfLog_('cache', { what: 'kpi', hit: true }); return old; } } catch (e) { old = null; } }
    /* Someone else is rebuilding it right now: show the last result, marked as being updated, instead of rebuilding it twice. */
    const busy = 'kpi_busy_' + dbTag_() + '_' + fy;
    try { if (old && CacheService.getScriptCache().get(busy)) { old.stale = true; return old; } CacheService.getScriptCache().put(busy, '1', 120); } catch (e) { }
  }
  perfLog_('cache', { what: 'kpi', hit: false });
  const o = computeKpis_(fy);
  o.dirtyAt = dirtyAt;
  o.builtAt = fmt_(new Date(), TZ, 'd MMM yyyy, HH:mm');
  cacheBigPut_(key, JSON.stringify(o), 21600);
  try { CacheService.getScriptCache().remove('kpi_busy_' + dbTag_() + '_' + fy); } catch (e) { }
  return o;
}
/** Every table computeKpis_ reads (its cache is keyed on their version stamps). */
const KPI_TABLES_ = ['MRF', 'Candidates', 'BGV_Cases', 'Observations', 'Audit_Checks', 'Position_Recruiters', 'M_Recruiters', 'KPI_Targets', 'KPI_Scoring', 'TAT_Exemptions', 'TAT_Rules', 'M_Grades', 'Settings'];

function kpiCurrentFy_() {
  const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
