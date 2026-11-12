/**
 * Admin set-up of the KPI scorecard (v146): check and change the TAT targets, the score bands and the count thresholds.
 *
 * Every change is a NEW version from a month the person chooses; nothing is edited or deleted, so earlier months keep the rule
 * that applied then. TAT targets are appended to KPI_Targets (with Version_ID, Active, Reason, Saved_By, Saved_At); score rules
 * go to KPI_Scoring (no rows = the defaults in Kpi.gs). A change that starts before the current month needs a confirmation,
 * because it rewrites reported results; the preview shows exactly which results change.
 * Reading needs the lead permission; changing needs kpi_edit (Head of HR, Admin). All checks run on the server.
 */
const KPI_MIN_FROM_ = '2025-04';
const KPI_LEVEL_CHOICES_ = ['All', 'M', 'W', 'T'];
const KPI_REASON_MIN_ = 10;
const KPI_DIFF_CAP_ = 300;

function kpiMonthNow_() { return ymd_(new Date()).slice(0, 7); }
function kpiAddMonths_(m, n) {
  const p = String(m).split('-'), t = Number(p[0]) * 12 + Number(p[1]) - 1 + n;
  return Math.floor(t / 12) + '-' + String(t % 12 + 1).padStart(2, '0');
}
function kpiFyOf_(m) { const p = String(m).split('-'); return Number(p[1]) >= 4 ? Number(p[0]) : Number(p[0]) - 1; }
function kpiRecruiterNames_() {
  return readTable_('M_Recruiters').rows.filter(function (r) { return String(r.Active) !== 'No'; }).map(function (r) { return String(r.Recruiter).trim(); }).filter(String);
}
/** The month the count KPIs start to be scored (the Settings value, or the preview's). */
function kpiCaptureFromNow_() {
  const raw = _kpiDraft_ && _kpiDraft_.captureFrom ? _kpiDraft_.captureFrom : settings_().KPI_CAPTURE_FROM;
  return raw instanceof Date ? fmt_(raw, TZ, 'yyyy-MM') : String(raw || '').replace(/^'/, '').slice(0, 7) || '9999-99';
}
function kpiViewGuard_(u) { if (!isLead_(u)) throw new Error('Only a TA Lead, the Head of HR or the admin can see the KPI set-up.'); }
function kpiEditGuard_(u) { if (!can_(u, 'kpi_edit')) throw new Error('Only the Head of HR or the admin can change the KPI set-up.'); }

/** A short text for a TAT rule, used in the history and the audit log. */
function kpiTargetText_(t) {
  if (!t) return 'none';
  if (t.active === false) return 'override ended (team target applies)';
  return 'each grade\u2019s TAT rule · ' + String(t.levels || 'All') + ' levels · notice ' + (t.exempt ? 'exempt' : 'not exempt');
}
function kpiRulesText_(kpi, rules) {
  if (KPI_DEFS[kpi] && KPI_DEFS[kpi].count) {
    return (rules.steps || []).map(function (s) { return 'up to ' + s.max + ' → ' + s.score; }).join(', ') + ', more → ' + (Number(rules.otherwise) || 0);
  }
  return (Array.isArray(rules) ? rules : []).map(function (b) { return b.min + '%+ → ' + b.score; }).join(', ') + ', below → 0';
}

function kpiInt_(v, lo, hi, what) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !isFinite(n) || Math.floor(n) !== n || n < lo || n > hi) throw new Error(what + ' must be a whole number from ' + lo + ' to ' + hi + '.');
  return n;
}

/** Score bands for percentage KPIs: 1-6 bands, min 1-100 and unique, scores 0-5, a higher band never scores less than a lower one. Returns the bands sorted high to low. */
function kpiCheckBands_(bands) {
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > 6) throw new Error('Give between 1 and 6 score bands.');
  const out = bands.map(function (b, i) { return { min: kpiInt_(b && b.min, 1, 100, 'Band ' + (i + 1) + ' percentage'), score: kpiInt_(b && b.score, 0, 5, 'Band ' + (i + 1) + ' score') }; })
    .sort(function (a, b) { return b.min - a.min; });
  out.forEach(function (b, i) {
    if (i && out[i - 1].min === b.min) throw new Error('Two bands start at ' + b.min + '%. Each percentage can appear once.');
    if (i && out[i - 1].score < b.score) throw new Error('A higher percentage cannot score less than a lower one (' + out[i - 1].min + '% scores ' + out[i - 1].score + ' but ' + b.min + '% scores ' + b.score + ').');
  });
  return out;
}
/** Count thresholds: 1-6 steps, max 0-50 and unique, scores 0-5 and never rising as the count rises, "otherwise" 0-5 and not above the last step. */
function kpiCheckSteps_(steps, otherwise) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 6) throw new Error('Give between 1 and 6 steps.');
  const out = steps.map(function (s, i) { return { max: kpiInt_(s && s.max, 0, 50, 'Step ' + (i + 1) + ' count'), score: kpiInt_(s && s.score, 0, 5, 'Step ' + (i + 1) + ' score') }; })
    .sort(function (a, b) { return a.max - b.max; });
  out.forEach(function (s, i) {
    if (i && out[i - 1].max === s.max) throw new Error('Two steps use the count ' + s.max + '. Each count can appear once.');
    if (i && out[i - 1].score < s.score) throw new Error('A higher count cannot score more than a lower one (up to ' + out[i - 1].max + ' scores ' + out[i - 1].score + ' but up to ' + s.max + ' scores ' + s.score + ').');
  });
  const oth = kpiInt_(otherwise == null || otherwise === '' ? 0 : otherwise, 0, 5, 'The score for more than the last step');
  if (oth > out[out.length - 1].score) throw new Error('More than the last step cannot score more than the last step does.');
  return { steps: out, otherwise: oth };
}

/**
 * Checks a change and turns it into rows. Throws a plain-language error when it is not allowed. Returns
 * {type, from, reason, targets:[normalised rows], scoring:[normalised rows], captureFrom, label}.
 * Nothing is written. `targets` and `scoring` use the same shape as kpiTargets_ / kpiScoring_, so a preview can lay them over the saved ones.
 */
function kpiParseDraft_(d) {
  d = d || {};
  const type = String(d.type || ''), now = kpiMonthNow_();
  const reason = clean_(String(d.reason || '')).trim().slice(0, 500);
  if (reason.length < KPI_REASON_MIN_) throw new Error('Write the reason for the change (at least ' + KPI_REASON_MIN_ + ' characters). It is kept in the change history.');
  const from = String(d.from || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) throw new Error(type === 'CAPTURE' ? 'Pick the month scoring starts from.' : 'Pick the month the change takes effect from.');
  if (from < KPI_MIN_FROM_) throw new Error('The month cannot be before ' + KPI_MIN_FROM_ + ', when the scorecard starts.');
  if (type === 'CAPTURE' ? from > now : from > kpiAddMonths_(now, 12)) throw new Error(type === 'CAPTURE' ? 'Scoring cannot start in a future month.' : 'The month cannot be more than 12 months ahead.');
  const out = { type: type, from: from, reason: reason, targets: [], scoring: [], captureFrom: '', label: '' };
  const saved = kpiTargets_(), scoring = kpiScoring_();
  if (type === 'TARGET') {
    const kpi = String(d.kpi || '').toUpperCase();
    if (KPI_TAT_.indexOf(kpi) < 0) throw new Error('Pick Timely closure, M-level or W-level fulfilment.');
    let who = d.who === undefined || d.who === null ? '*' : String(d.who).trim();
    if (!who) throw new Error('Pick the recruiter, or choose the whole team.');
    if (who !== '*') {
      const names = kpiRecruiterNames_(), hit = names.filter(function (n) { return n.toLowerCase() === who.toLowerCase(); })[0];
      if (!hit) throw new Error('“' + who + '” is not an active recruiter.');
      who = hit;
    }
    const key = who.toLowerCase();
    const cur = targetFor_(saved, key, kpi, from);
    if (d.active === false) {   // end a recruiter's override from this month
      if (who === '*') throw new Error('The team target cannot be ended. Change it instead.');
      if (!cur || cur.recruiter !== key) throw new Error(who + ' has no override in force in that month, so there is nothing to end.');
      out.targets.push({ recruiter: key, kpi: kpi, levels: cur.levels, days: cur.days, exempt: cur.exempt, from: from, active: false, id: '', _who: who });
      out.label = KPI_DEFS[kpi].name + ' · ' + who + ': override ends';
    } else {
      const days = d.days === undefined || d.days === null || d.days === '' ? (cur ? cur.days : 0) : kpiInt_(d.days, 1, 365, 'The target days');   // v167: the days come from the TAT rules; the stored number is kept but not used
      const lv = KPI_LEVEL_CHOICES_.filter(function (l) { return l.toLowerCase() === String(d.levels || '').trim().toLowerCase(); })[0];
      if (!lv) throw new Error('Levels must be All, M, W or T.');
      const row = { recruiter: key, kpi: kpi, levels: lv, days: days, exempt: true, from: from, active: true, id: '', _who: who };   // notice beyond the grace is always exempt (v151): there is nothing to choose
      if (cur && String(cur.levels || 'All').toLowerCase() === lv.toLowerCase() && cur.days === days && cur.exempt === row.exempt && (who === '*' || cur.recruiter === key))
        throw new Error('That is the target already in force from ' + from + '. Nothing to save.');
      if (cur && who !== '*' && cur.recruiter === '*' && String(cur.levels || 'All').toLowerCase() === lv.toLowerCase() && cur.days === days && cur.exempt === row.exempt)
        throw new Error('That equals the team target, so no override is needed.');
      out.targets.push(row);
      out.label = KPI_DEFS[kpi].name + ' · ' + (who === '*' ? 'whole team' : who) + ': ' + kpiTargetText_(row);
    }
  } else if (type === 'BANDS' || type === 'COUNTS') {
    const kpis = type === 'BANDS' ? (Array.isArray(d.kpis) ? d.kpis : [d.kpi]) : [d.kpi];
    const list = kpis.map(function (k) { return String(k || '').toUpperCase(); }).filter(function (k, i, a) { return k && a.indexOf(k) === i; });
    if (!list.length) throw new Error('Pick the KPI.');
    list.forEach(function (k) {
      if (!KPI_DEFS[k] || !KPI_DEFS[k].scored || (type === 'BANDS') === !!KPI_DEFS[k].count) throw new Error('“' + k + '” does not use ' + (type === 'BANDS' ? 'percentage score bands' : 'count thresholds') + '.');
    });
    const rules = type === 'BANDS' ? kpiCheckBands_(d.bands) : kpiCheckSteps_(d.steps, d.otherwise);
    let changed = false;
    list.forEach(function (k) {
      if (!kpiRulesEqual_(kpiRulesFor_(scoring, k, from), rules)) changed = true;
      out.scoring.push({ id: '', kpi: k, kind: type === 'BANDS' ? 'PERCENT' : 'COUNT', rules: JSON.parse(JSON.stringify(rules)), from: from });
    });
    if (!changed) throw new Error('Those are the rules already in force from ' + from + '. Nothing to save.');
    out.label = list.map(function (k) { return KPI_DEFS[k].name; }).join(', ') + ': ' + kpiRulesText_(list[0], rules);
  } else if (type === 'CAPTURE') {
    const was = kpiCaptureFromNow_();
    if (was === from) throw new Error('Scoring already starts from ' + from + '. Nothing to save.');
    out.captureFrom = from;
    out.label = 'Count KPIs are scored from ' + from + ' (was ' + (was === '9999-99' ? 'not set' : was) + ')';
  } else throw new Error('Unknown kind of change.');
  return out;
}

/** The highest version number of a prefix in a list of rows (KT-0007 gives 7). */
function kpiMaxVersion_(rows, prefix) {
  let m = 0;
  rows.forEach(function (r) { const k = String(r.Version_ID || '').match(new RegExp('^' + prefix + '-(\\d+)$')); if (k) m = Math.max(m, Number(k[1])); });
  return m;
}
/** A stamp of the saved set-up; a save made from an older screen is refused (someone saved meanwhile). */
function kpiBase_() {
  const t = readTable_(KPI_TARGETS, true).rows, s = ss_().getSheetByName(KPI_SCORING) ? readTable_(KPI_SCORING, true).rows : [];
  return 'T' + t.length + '.' + kpiMaxVersion_(t, 'KT') + '|S' + s.length + '.' + kpiMaxVersion_(s, 'KS') + '|C' + kpiCaptureFromNow_();
}

/** What the person is looking at: the rules in force now, what starts later, every version, and who may change it. */
function apiKpiSetup() {
  const u = currentUser_(); ensureSchema_(); kpiViewGuard_(u);
  ensureKpiTargets_();
  const now = kpiMonthNow_();
  const targets = kpiTargets_(), scoring = kpiScoring_();
  const rawT = readTable_(KPI_TARGETS).rows;
  const nameOf = {}; rawT.forEach(function (r) { const k = String(r.Recruiter).trim(); nameOf[k.toLowerCase()] = k; });
  const whoLabel = function (key) { return key === '*' ? 'Whole team' : (nameOf[key] || key); };
  const tatOut = KPI_TAT_.map(function (kpi) {
    const rows = targets.filter(function (t) { return t.kpi === kpi; });
    const team = targetFor_(targets, '*', kpi, now);
    const who = {}; rows.forEach(function (t) { if (t.recruiter !== '*') who[t.recruiter] = true; });
    const overrides = [], upcoming = [];
    Object.keys(who).sort().forEach(function (r) {
      const cur = targetFor_(targets, r, kpi, now);
      if (cur && cur.recruiter === r) overrides.push({ who: whoLabel(r), days: cur.days, levels: String(cur.levels || 'All'), exempt: cur.exempt, from: cur.from, id: cur.id });
    });
    rows.filter(function (t) { return t.from > now; }).sort(function (a, b) { return a.from < b.from ? -1 : 1; }).forEach(function (t) {
      upcoming.push({ who: whoLabel(t.recruiter), days: t.days, levels: String(t.levels || 'All'), exempt: t.exempt, active: t.active, from: t.from, id: t.id });
    });
    return { kpi: kpi, name: KPI_DEFS[kpi].name, team: team ? { days: team.days, levels: String(team.levels || 'All'), exempt: team.exempt, from: team.from, id: team.id } : null, overrides: overrides, upcoming: upcoming };
  });
  const scoreOut = Object.keys(KPI_DEFS).filter(function (k) { return KPI_DEFS[k].scored; }).map(function (kpi) {
    const rules = kpiRulesFor_(scoring, kpi, now), vs = scoring.filter(function (v) { return v.kpi === kpi; });
    const cur = vs.filter(function (v) { return v.from <= now; }).sort(function (a, b) { return a.from < b.from ? 1 : a.from > b.from ? -1 : b.idx - a.idx; })[0];
    return { kpi: kpi, name: KPI_DEFS[kpi].name, kind: KPI_DEFS[kpi].count ? 'COUNT' : 'PERCENT', rules: rules, isDefault: !cur, from: cur ? cur.from : '', unit: KPI_DEFS[kpi].unit || '',
      upcoming: vs.filter(function (v) { return v.from > now; }).map(function (v) { return { from: v.from, rules: v.rules, id: v.id }; }) };
  });
  // The change history: every version row (newest first), then the rows that were in the sheet before the app could edit it.
  const hist = [];
  rawT.forEach(function (r) {
    const id = String(r.Version_ID || ''), t = targets.filter(function (x) { return x.idx === rawT.indexOf(r); })[0];
    if (!t) return;
    hist.push({ id: id, ms: r.Saved_At instanceof Date ? r.Saved_At.getTime() : 0, at: r.Saved_At instanceof Date ? fmt_(r.Saved_At, TZ, 'd MMM yyyy, HH:mm') : '', by: String(r.Saved_By || ''), kind: 'TARGET', kpi: t.kpi, name: KPI_DEFS[t.kpi] ? KPI_DEFS[t.kpi].name : t.kpi,
      who: whoLabel(t.recruiter), text: kpiTargetText_(t), from: t.from, reason: id ? String(r.Reason || '') : 'Set in the sheet before the app could edit it' });
  });
  if (ss_().getSheetByName(KPI_SCORING)) readTable_(KPI_SCORING).rows.forEach(function (r) {
    const kpi = String(r.KPI).trim().toUpperCase(), kind = String(r.Kind).trim().toUpperCase();
    let rules = null; try { rules = JSON.parse(String(r.Rules_JSON || '')); } catch (e) { }
    const f = r.Effective_From instanceof Date ? fmt_(r.Effective_From, TZ, 'yyyy-MM') : String(r.Effective_From || '').replace(/^'/, '').slice(0, 7);
    hist.push({ id: String(r.Version_ID || ''), ms: r.Saved_At instanceof Date ? r.Saved_At.getTime() : 0, at: r.Saved_At instanceof Date ? fmt_(r.Saved_At, TZ, 'd MMM yyyy, HH:mm') : '', by: String(r.Saved_By || ''), kind: kind, kpi: kpi,
      name: kind === 'CAPTURE' ? 'Count KPIs' : (KPI_DEFS[kpi] ? KPI_DEFS[kpi].name : kpi), who: '',
      text: kind === 'CAPTURE' ? 'scored from ' + (rules && rules.from || f) : rules ? kpiRulesText_(kpi, rules) : '', from: f, reason: String(r.Reason || '') });
  });
  hist.sort(function (a, b) { return b.ms - a.ms; });
  return { canEdit: can_(u, 'kpi_edit'), now: now, minFrom: KPI_MIN_FROM_, grace: Number(settings_().NOTICE_GRACE_DAYS) || 30, recruiters: kpiRecruiterNames_(), levels: KPI_LEVEL_CHOICES_,
    tat: tatOut, scoring: scoreOut, captureFrom: kpiCaptureFromNow_(), history: hist.slice(0, 200), base: kpiBase_() };
}

/** The scorecard cells (every recruiter and the team) that differ between two results. */
function kpiDiff_(before, after, now) {
  const rows = []; let truncated = false, past = 0;
  const recs = Object.keys(after.data);
  Object.keys(before.data).forEach(function (r) { if (recs.indexOf(r) < 0) recs.push(r); });
  const key = function (c) { return c ? JSON.stringify([c.num, c.den, c.pct, c.score, c.pending || 0, c.missed == null ? '' : c.worked]) : ''; };
  const view = function (c) { return c ? { num: c.num, den: c.den, pct: c.pct, score: c.score, pending: c.pending || 0, worked: c.worked, missed: c.missed } : null; };   // worked and missed: Timely closure (v153)
  recs.forEach(function (rec) {
    Object.keys(KPI_DEFS).forEach(function (kpi) {
      after.months.forEach(function (m) {
        const b = before.data[rec] && before.data[rec][kpi] && before.data[rec][kpi][m], a = after.data[rec] && after.data[rec][kpi] && after.data[rec][kpi][m];
        if (key(b) === key(a)) return;
        if (m < now) past++;
        if (rows.length >= KPI_DIFF_CAP_) { truncated = true; return; }
        rows.push({ who: rec === 'TEAM_TOTAL' ? 'Whole team' : rec, kpi: kpi, name: KPI_DEFS[kpi].name, month: m, past: m < now, count: !!KPI_DEFS[kpi].count, unit: KPI_DEFS[kpi].unit || '', before: view(b), after: view(a) });
      });
    });
  });
  rows.sort(function (x, y) { return x.kpi < y.kpi ? -1 : x.kpi > y.kpi ? 1 : x.month < y.month ? -1 : x.month > y.month ? 1 : (x.who === 'Whole team' ? -1 : y.who === 'Whole team' ? 1 : x.who < y.who ? -1 : 1); });
  return { rows: rows, truncated: truncated, pastCount: past };
}

/**
 * What a change does to the scorecard: every cell (whole team and each recruiter) that differs, for the current financial year and the one
 * the change starts in. A position is counted in its due month but uses the target of the month it joined (or started), so a change that
 * starts in a month can also move earlier months: the cells are measured, not guessed. Reported (past) months changing needs a confirmation.
 */
function kpiImpact_(parsed) {
  const now = kpiMonthNow_();
  const start = parsed.type === 'CAPTURE' ? (parsed.from < kpiCaptureFromNow_() ? parsed.from : kpiCaptureFromNow_()) : parsed.from;
  const fys = []; for (let fy = Math.max(kpiFyOf_(start), kpiFyOf_(now) - 1); fy <= kpiFyOf_(now); fy++) fys.push(fy);
  const all = { rows: [], truncated: false, pastCount: 0 };
  fys.forEach(function (fy) {
    const before = computeKpis_(fy);
    let after;
    _kpiDraft_ = { targets: parsed.targets, scoring: parsed.scoring, captureFrom: parsed.captureFrom };
    try { after = computeKpis_(fy); } finally { _kpiDraft_ = null; }
    const d = kpiDiff_(before, after, now);
    all.rows = all.rows.concat(d.rows); all.truncated = all.truncated || d.truncated; all.pastCount += d.pastCount;
  });
  return { label: parsed.label, from: parsed.from, needsConfirm: all.pastCount > 0, rows: all.rows, truncated: all.truncated, pastCount: all.pastCount, fys: fys };
}

/** What a change would do to the scorecard, without saving it. */
function apiKpiPreview(draft) {
  const u = currentUser_(); ensureSchema_(); kpiEditGuard_(u);
  ensureKpiTargets_();
  return kpiImpact_(kpiParseDraft_(draft));
}

/** Saves a change as a new version (append only). draft.base must be the stamp the screen was loaded with; confirm must be true for a change that starts in the past. */
function apiKpiSave(draft, confirm) {
  const u = currentUser_(); ensureSchema_(); kpiEditGuard_(u);
  ensureKpiTargets_();
  return withLock_(function () {
    _tables = {};
    if (String((draft || {}).base || '') !== kpiBase_()) throw new Error('Someone saved a change while this screen was open. Close it, reload, and make the change again.');
    const parsed = kpiParseDraft_(draft);
    const impact = kpiImpact_(parsed);   // measured again here, so the rule cannot be bypassed by skipping the preview
    if (impact.pastCount > 0 && confirm !== true) throw new Error('This change alters ' + impact.pastCount + ' result' + (impact.pastCount === 1 ? '' : 's') + ' in months that were already reported. Preview it and confirm to save.');
    const at = new Date(), ids = [];
    if (parsed.targets.length) {
      const t = readTable_(KPI_TARGETS, true), h = t.headers;
      let n = kpiMaxVersion_(t.rows, 'KT');
      parsed.targets.forEach(function (r) {
        const id = 'KT-' + String(++n).padStart(4, '0'); ids.push(id);
        const obj = { Recruiter: r._who, KPI: r.kpi, Levels: r.levels, TAT_Days: r.days, Notice_Exemption: r.exempt ? 'Yes' : 'No', Effective_From: r.from, Note: 'Saved in the app', Version_ID: id,
          Active: r.active === false ? 'No' : 'Yes', Reason: parsed.reason, Saved_By: u.email, Saved_At: at };
        const row = t.sheet.getLastRow() + 1;
        t.sheet.getRange(row, h.indexOf('Effective_From') + 1).setNumberFormat('@');
        t.sheet.getRange(row, 1, 1, h.length).setValues([h.map(function (c) { return obj[c] === undefined ? '' : obj[c]; })]);
        audit_(u, KPI_TARGETS, id, 'Create', r.kpi + ' ' + (r._who === '*' ? 'team' : r._who) + ' from ' + r.from, '', kpiTargetText_(r) + ' · ' + parsed.reason);
      });
      dropStale_(KPI_TARGETS);
    }
    if (parsed.scoring.length || parsed.captureFrom) {
      addSheet_(KPI_SCORING, KPI_SCORING_COLS_);
      const s = readTable_(KPI_SCORING, true), h = s.headers;
      let n = kpiMaxVersion_(s.rows, 'KS');
      const put = function (obj) {
        const row = s.sheet.getLastRow() + 1;
        s.sheet.getRange(row, h.indexOf('Effective_From') + 1).setNumberFormat('@');
        s.sheet.getRange(row, 1, 1, h.length).setValues([h.map(function (c) { return obj[c] === undefined ? '' : obj[c]; })]);
      };
      parsed.scoring.forEach(function (r) {
        const id = 'KS-' + String(++n).padStart(4, '0'); ids.push(id);
        put({ Version_ID: id, KPI: r.kpi, Kind: r.kind, Rules_JSON: JSON.stringify(r.rules), Effective_From: r.from, Reason: parsed.reason, Saved_By: u.email, Saved_At: at });
        audit_(u, KPI_SCORING, id, 'Create', r.kpi + ' from ' + r.from, '', kpiRulesText_(r.kpi, r.rules) + ' · ' + parsed.reason);
      });
      if (parsed.captureFrom) {
        const was = kpiCaptureFromNow_(), id = 'KS-' + String(++n).padStart(4, '0'); ids.push(id);
        put({ Version_ID: id, KPI: 'ALL', Kind: 'CAPTURE', Rules_JSON: JSON.stringify({ from: parsed.captureFrom, was: was }), Effective_From: parsed.captureFrom, Reason: parsed.reason, Saved_By: u.email, Saved_At: at });
        setSetting_('KPI_CAPTURE_FROM', parsed.captureFrom, 'Count KPIs are scored from this month. Set in the app (KPI set-up).');
        audit_(u, KPI_SCORING, id, 'Create', 'KPI_CAPTURE_FROM', was, parsed.captureFrom + ' · ' + parsed.reason);
      }
      dropStale_(KPI_SCORING);
    }
    PropertiesService.getScriptProperties().setProperty('KPI_DIRTY_AT', String(Date.now()));   // the cached scorecard is rebuilt on the next read
    _tables = {};
    const out = apiKpiSetup();
    out.saved = ids;
    return out;
  });
}
