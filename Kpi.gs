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
    _tables[KPI_TARGETS] = null;
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

function computeKpis_(fy) {
  ensureKpiTargets_();
  ensureSchema_();
  const grace = Number(settings_().NOTICE_GRACE_DAYS) || 30;
  const targets = readTable_(KPI_TARGETS).rows.map(function (r) {
    const f = r.Effective_From instanceof Date ? Utilities.formatDate(r.Effective_From, TZ, 'yyyy-MM') : String(r.Effective_From || '0000-00').slice(0, 7);
    return { recruiter: String(r.Recruiter).trim().toLowerCase(), kpi: String(r.KPI).trim().toUpperCase(), levels: r.Levels,
      days: Number(r.TAT_Days) || 0, exempt: String(r.Notice_Exemption).toUpperCase() !== 'NO', from: f };
  });
  const months = fyMonths_(fy);
  const lines = readTable_(T.MRF.name).rows;
  const recruiters = {};
  const cell = function () { return { num: 0, den: 0, items: [] }; };
  const bucket = function (rec, kpi, month) {
    const r = recruiters[rec] = recruiters[rec] || {};
    const k = r[kpi] = r[kpi] || {};
    return k[month] = k[month] || cell();
  };
  const inFy = function (m) { return months.indexOf(m) >= 0; };

  lines.forEach(function (l) {
    const rec = String(l.Recruiter || 'Unassigned').trim() || 'Unassigned';
    const receipt = tatStart_(l), doj = ymd_(l.Actual_DOJ);
    const status = positionStatus_(l);
    const notice = Number(l.Notice_Period_Days) || 0;
    const brief = { id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), receipt: receipt, doj: doj };

    // 1. Timely closure — positions filled in the month, within the recruiter's TAT.
    if (status === 'Closed' && receipt && doj && inFy(doj.slice(0, 7))) {
      const m = doj.slice(0, 7), t = targetFor_(targets, rec, 'TIMELY_CLOSURE', m);
      if (t && levelMatch_(t.levels, l.Grade)) {
        const allowed = t.days + (t.exempt ? Math.max(notice - grace, 0) : 0);
        const days = daysBetween_(receipt, doj), ok = days <= allowed;
        const c = bucket(rec, 'TIMELY_CLOSURE', m);
        c.den++; if (ok) c.num++;
        c.items.push(Object.assign({ days: days, allowed: allowed, ok: ok }, brief));
      }
    }

    // 2. M-level fulfilment — targeted = due this month (receipt + TAT) or filled this month.
    if (receipt && ['Open', 'Offered', 'Closed'].indexOf(status) >= 0) {
      const probe = doj ? doj.slice(0, 7) : receipt.slice(0, 7);
      const t = targetFor_(targets, rec, 'M_FULFILMENT', probe);
      if (t && levelMatch_(t.levels, l.Grade)) {
        const allowed = t.days + (t.exempt ? Math.max(notice - grace, 0) : 0);
        const due = addDays_(receipt, allowed), dueM = due.slice(0, 7);
        const filledM = doj ? doj.slice(0, 7) : '';
        const ok = !!doj && doj <= due;
        const month = filledM && filledM <= dueM ? filledM : dueM;
        if (inFy(month) && month <= ymd_(new Date()).slice(0, 7)) {
          const c = bucket(rec, 'M_FULFILMENT', month);
          c.den++; if (ok) c.num++;
          c.items.push(Object.assign({ due: due, allowed: allowed, ok: ok, status: status }, brief));
        }
      }
    }

    // 3. Offer backout rate — backouts in the month ÷ offers made in the month.
    const offerM = ymd_(l.Offer_Date).slice(0, 7), backM = ymd_(l.Backout_Date).slice(0, 7);
    if (offerM && inFy(offerM)) { const c = bucket(rec, 'OFFER_BACKOUT', offerM); c.den++; c.items.push(Object.assign({ event: 'Offer', date: ymd_(l.Offer_Date) }, brief)); }
    if (backM && inFy(backM)) { const c = bucket(rec, 'OFFER_BACKOUT', backM); c.num++; c.items.push(Object.assign({ event: 'Backout', date: ymd_(l.Backout_Date) }, brief)); }
  });

  // ---- Compliance KPIs (scored from KPI_CAPTURE_FROM onward) ----
  const s = settings_();
  const capRaw = s.KPI_CAPTURE_FROM;
  const captureFrom = capRaw instanceof Date ? Utilities.formatDate(capRaw, TZ, 'yyyy-MM') : String(capRaw || '').replace(/^'/, '').slice(0, 7) || '9999-99';
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

  // 5. BGV — new hires (Manager+ or flagged) without previous-employer BGV before the offer,
  //    or without current-employer BGV started within 2 days of joining.
  lines.forEach(function (l) {
    const doj = ymd_(l.Actual_DOJ);
    if (!doj || positionStatus_(l) !== 'Closed' || !tracked(doj.slice(0, 7))) return;
    const flag = String(l.BGV_Required || 'Auto');
    const required = flag === 'Yes' || (flag !== 'No' && managerPlus_(l.Grade, l.Position));
    if (!required) return;
    const offer = ymd_(l.Offer_Date), prev = ymd_(l.BGV_Prev_Org_Date), curr = ymd_(l.BGV_Current_Org_Date);
    const deadline = addDays_(doj, 2);
    const prevOk = !!prev && (!offer || prev <= offer);
    const currOk = !!curr && curr <= deadline;
    const currPending = !curr && today <= deadline;
    const miss = !prevOk || (!currOk && !currPending);
    const rec = String(l.Recruiter || 'Unassigned').trim();
    const b = bucket(rec, 'BGV', doj.slice(0, 7));
    b.den++; if (miss) b.num++;
    b.items.push({ id: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), grade: String(l.Grade), doj: doj, offer: offer,
      prev: prev, curr: curr, ok: !miss,
      why: miss ? [!prev ? 'No previous-employer BGV' : (!prevOk ? 'Previous-employer BGV after offer' : ''), (!currOk && !currPending) ? (curr ? 'Current-employer BGV started late' : 'Current-employer BGV not started') : ''].filter(Boolean).join('; ') : (currPending ? 'Current-employer BGV due by ' + deadline : '') });
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
    return { num: c.num, den: c.den, pct: pct, score: KPI_DEFS[kpi].scored ? kpiScore_(pct) : null, items: c.items };
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
  const key = 'kpi2_' + fy;
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) { const o = JSON.parse(hit); if (o.dirtyAt === dirtyAt) return o; }
  }
  const o = computeKpis_(fy);
  o.dirtyAt = dirtyAt;
  o.builtAt = Utilities.formatDate(new Date(), TZ, 'd MMM yyyy, HH:mm');
  const json = JSON.stringify(o);
  if (json.length < 95000) cache.put(key, json, 21600);
  return o;
}

function kpiCurrentFy_() {
  const d = new Date(); return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
}
