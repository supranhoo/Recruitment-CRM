/**
 * Department delays (Reports → Department delays). Recruitment closure depends on the departments too: this measures
 * how long each department takes to act, from records the app already keeps.
 * - CV feedback: a card's time at "Shared with department" (Stage_History), from the move in to the move out
 *   (department confirmed) or a status change (rejected, on hold, withdrawn). Still at Shared = pending.
 * - JD / screening-question validation: each version's Shared_On to Response_On (Position_Docs). No reply = pending.
 * - Waiting days per position are the union of those intervals (three CVs waiting on the same days count once),
 *   clipped to the period. "TAT lost" is the part beyond the policy norm: 24 h for CV feedback (Appendix A step 3),
 *   one day for a JD or questions reply.
 * Leads see every department; a recruiter sees their own positions.
 */
const DEPT_NORM_CV_H_ = 24;
const DEPT_NORM_DOC_D_ = 1;

function apiDeptDelays(opts) {
  const u = currentUser_(); ensureSchema_();
  opts = opts || {};
  const DAY = 86400000, HOUR = 3600000, now = Date.now(), today = ymd_(new Date());
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.to || '')) ? String(opts.to) : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.from || '')) ? String(opts.from) : ymd_(new Date(now - 90 * DAY));
  if (from > to) throw new Error('The start date is after the end date.');
  const p0 = parseYmd_(from).getTime(), p1 = Math.min(parseYmd_(to).getTime() + DAY, now);
  const lead = isLead_(u), mine = function (l) { return lead || String(l.Recruiter || '').trim().toLowerCase() === u.recruiter.trim().toLowerCase(); };
  const dayMs = function (d) { return d instanceof Date ? d.getTime() : d ? parseYmd_(String(d).slice(0, 10)).getTime() : 0; };

  const lines = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { if (mine(l)) lines[l.Line_ID] = l; });
  const hods = {};
  readTable_('M_Departments').rows.forEach(function (d) { hods[String(d.Dept).trim()] = String(d.HOD_Name || ''); });
  const cands = {};
  readTable_(T.CAND.name).rows.forEach(function (c) { cands[c.Candidate_ID] = String(c.Name || c.Candidate_ID); });
  const apps = {};
  readTable_(T.APP.name).rows.forEach(function (a) { apps[a.App_ID] = a; });

  // Per position: department-wait intervals [start, end, kind, norm ms] and detail.
  const P = {};
  const pos = function (id) {
    const l = lines[id]; if (!l) return null;
    return P[id] = P[id] || { line: l, iv: [], cvDone: [], cvPending: [], docDone: [], docPending: [], jd: [], sq: [] };
  };

  // 1. CV feedback from the stage history.
  const hist = readTable_(T.HIST.name).rows.slice().sort(function (a, b) { return dayMs(a.Changed_At) - dayMs(b.Changed_At); });
  const open = {};
  hist.forEach(function (h) {
    const at = h.Changed_At instanceof Date ? h.Changed_At.getTime() : 0; if (!at) return;
    const id = String(h.App_ID), from_ = String(h.From_Stage || ''), to_ = String(h.To_Stage || '');
    if (to_ === 'Shared' && from_ !== 'Shared') {
      if (String(h.Changed_By) !== 'migration') open[id] = { start: at, line: String(h.Line_ID) };
      return;
    }
    const o = open[id]; if (!o) return;
    const statusChange = from_ === to_ && /Rejected|On hold|Withdrawn|Backout/.test(String(h.Outcome || ''));
    if (to_ !== 'Shared' || statusChange) {
      delete open[id];
      const p = pos(o.line); if (!p) return;
      p.iv.push([o.start, at, 'cv', DEPT_NORM_CV_H_ * HOUR]);
      if (at >= p0 && at < p1) p.cvDone.push({ app: id, name: cands[(apps[id] || {}).Candidate_ID] || id, hours: (at - o.start) / HOUR,
        outcome: to_ !== 'Shared' ? 'Confirmed for interview' : String(h.Outcome), on: ymd_(new Date(at)) });
    }
  });
  Object.keys(open).forEach(function (id) {
    const a = apps[id], o = open[id];
    if (!a || String(a.Stage) !== 'Shared' || String(a.Status) !== 'Active') return;
    const p = pos(o.line); if (!p) return;
    p.iv.push([o.start, now, 'cv', DEPT_NORM_CV_H_ * HOUR]);
    p.cvPending.push({ app: id, name: cands[a.Candidate_ID] || id, hours: (now - o.start) / HOUR, since: ymd_(new Date(o.start)) });
  });

  // 2. JD and screening-question validation rounds.
  readTable_(T.PDOC.name).rows.forEach(function (r) {
    const p = pos(String(r.Line_ID)); if (!p) return;
    const type = String(r.Doc_Type) === 'SQ' ? 'SQ' : 'JD';
    const sh = r.Shared_On instanceof Date ? dayMs(ymd_(r.Shared_On)) : 0, re = r.Response_On instanceof Date ? dayMs(ymd_(r.Response_On)) : 0;
    const v = { version: Number(r.Version) || 0, status: String(r.Status), shared: sh, reply: re, response: String(r.Response || ''), final: r.Final_On instanceof Date ? dayMs(ymd_(r.Final_On)) : 0 };
    (type === 'SQ' ? p.sq : p.jd).push(v);
    if (!sh) return;
    if (re) {
      p.iv.push([sh, re, type, DEPT_NORM_DOC_D_ * DAY]);
      if (re >= p0 && re < p1) p.docDone.push({ type: type, version: v.version, days: Math.round((re - sh) / DAY), response: v.response, on: ymd_(new Date(re)) });
    } else if (String(r.Status) === 'Shared') {
      p.iv.push([sh, now, type, DEPT_NORM_DOC_D_ * DAY]);
      p.docPending.push({ type: type, version: v.version, days: Math.floor((now - sh) / DAY), since: ymd_(new Date(sh)), with: String(r.Shared_With || '') });
    }
  });

  // Union of intervals within the period; the loss is each interval's part beyond its norm, unioned the same way.
  const unionMs = function (list) {
    const s = list.map(function (x) { return [Math.max(x[0], p0), Math.min(x[1], p1)]; }).filter(function (x) { return x[1] > x[0]; })
      .sort(function (a, b) { return a[0] - b[0]; });
    let total = 0, cs = -1, ce = -1;
    s.forEach(function (x) { if (x[0] > ce) { if (ce > cs) total += ce - cs; cs = x[0]; ce = x[1]; } else ce = Math.max(ce, x[1]); });
    if (ce > cs) total += ce - cs;
    return total;
  };
  const r1 = function (n) { return Math.round(n * 10) / 10; };
  const phase = function (rounds, start, finalDate) {
    // Days from the phase start to final (or today): the department's part is shared -> reply, the rest is the recruiter's.
    if (!start) return null;
    const rs = rounds.filter(function (x) { return x.shared; }).sort(function (a, b) { return a.version - b.version; });
    const end = finalDate || now, total = Math.max(0, (end - start) / DAY);
    let dept = 0;
    rs.forEach(function (x) { dept += Math.max(0, ((x.reply || (x.status === 'Shared' ? now : x.shared)) - x.shared) / DAY); });
    return { total: Math.round(total), dept: Math.round(Math.min(dept, total)), recruiter: Math.round(Math.max(0, total - dept)), rounds: rs.length,
      final: !!finalDate, firstShared: rs.length ? ymd_(new Date(rs[0].shared)) : '' };
  };

  const D = {}, R = {}, positions = [];
  const dept = function (name) {
    return D[name] = D[name] || { dept: name, hod: hods[name] || '', positions: 0, cvN: 0, cvHours: [], cvOver: 0, cvPending: 0, cvOldestH: 0,
      docN: 0, docDays: [], docPending: 0, docOldestD: 0, waitDays: 0, lossDays: 0, pastTat: 0, tatDays: 0 };
  };
  Object.keys(lines).forEach(function (id) {
    const l = lines[id], st = positionStatus_(l);
    if (st === 'Removed') return;
    const p = P[id] || { line: l, iv: [], cvDone: [], cvPending: [], docDone: [], docPending: [], jd: [], sq: [] };
    const active = ['Open', 'Offered', 'On Hold'].indexOf(st) >= 0;
    const wait = unionMs(p.iv) / DAY;
    const loss = unionMs(p.iv.map(function (x) { return [x[0] + x[3], x[1]]; })) / DAY;
    if (!active && !wait && !p.cvDone.length && !p.docDone.length) return;
    const start = dayMs(tatStart_(l)), jdFinal = l.JD_Confirmed_Date instanceof Date ? dayMs(ymd_(l.JD_Confirmed_Date)) : 0;
    const sqFinal = l.SQ_Confirmed_Date instanceof Date ? dayMs(ymd_(l.SQ_Confirmed_Date)) : 0;
    const jd = active || jdFinal >= p0 ? phase(p.jd, start, jdFinal) : null;
    const sq = jdFinal && (active || sqFinal >= p0) ? phase(p.sq, jdFinal, sqFinal) : null;
    const name = String(l.Dept || 'No department').trim(), d = dept(name);
    const endMs = l.TAT_End_Date instanceof Date ? dayMs(ymd_(l.TAT_End_Date)) + DAY : now;
    const days = start ? Math.max(0, (Math.min(endMs, p1) - Math.max(start, p0)) / DAY) : 0, past = /Overdue|Missed/.test(String(l.TAT_Result || ''));
    d.positions++; d.waitDays += wait; d.lossDays += loss; d.tatDays += days; if (past) d.pastTat++;
    p.cvDone.forEach(function (c) { d.cvN++; d.cvHours.push(c.hours); if (c.hours > DEPT_NORM_CV_H_) d.cvOver++; });
    p.cvPending.forEach(function (c) { d.cvPending++; d.cvOldestH = Math.max(d.cvOldestH, c.hours); });
    p.docDone.forEach(function (x) { d.docN++; d.docDays.push(x.days); });
    p.docPending.forEach(function (x) { d.docPending++; d.docOldestD = Math.max(d.docOldestD, x.days); });
    const rec = String(l.Recruiter || 'Unassigned').trim(), r = R[rec] = R[rec] || { recruiter: rec, positions: 0, waitDays: 0, lossDays: 0, tatDays: 0, cvPending: 0, docPending: 0 };
    r.positions++; r.waitDays += wait; r.lossDays += loss; r.tatDays += days; r.cvPending += p.cvPending.length; r.docPending += p.docPending.length;
    positions.push({ line: id, mrf: String(l.MRF_No || ''), position: String(l.Position || ''), dept: name, recruiter: rec, status: st,
      assigned: tatStart_(l), daysTaken: Number(l.Days_Taken) || 0, periodDays: Math.round(days), finalTat: Number(l.Final_TAT) || 0, tatResult: String(l.TAT_Result || ''),
      waitDays: r1(wait), lossDays: r1(loss), jd: jd, sq: sq,
      cvDone: p.cvDone.map(function (c) { return { name: c.name, hours: Math.round(c.hours), outcome: c.outcome, on: c.on }; }),
      cvPending: p.cvPending.map(function (c) { return { app: c.app, name: c.name, hours: Math.round(c.hours), since: c.since }; }),
      docPending: p.docPending });
  });

  const avg = function (a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; };
  const med = function (a) { if (!a.length) return null; const s = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const allCv = [], allDoc = [];
  const depts = Object.keys(D).map(function (k) {
    const d = D[k]; allCv.push.apply(allCv, d.cvHours); allDoc.push.apply(allDoc, d.docDays);
    return { dept: d.dept, hod: d.hod, positions: d.positions, cvN: d.cvN, cvAvgH: avg(d.cvHours) == null ? null : Math.round(avg(d.cvHours)),
      cvMedH: med(d.cvHours) == null ? null : Math.round(med(d.cvHours)), cvOver: d.cvOver, cvPending: d.cvPending, cvOldestH: Math.round(d.cvOldestH),
      docN: d.docN, docAvgD: avg(d.docDays) == null ? null : r1(avg(d.docDays)), docPending: d.docPending, docOldestD: d.docOldestD,
      waitDays: r1(d.waitDays), lossDays: r1(d.lossDays), pastTat: d.pastTat,
      share: d.tatDays ? Math.round(100 * Math.min(d.waitDays, d.tatDays) / d.tatDays) : null, tatDays: Math.round(d.tatDays) };
  }).sort(function (a, b) { return b.lossDays - a.lossDays || b.waitDays - a.waitDays; });
  const recruiters = Object.keys(R).map(function (k) {
    const r = R[k];
    return { recruiter: r.recruiter, positions: r.positions, waitDays: r1(r.waitDays), lossDays: r1(r.lossDays), tatDays: Math.round(r.tatDays),
      share: r.tatDays ? Math.round(100 * Math.min(r.waitDays, r.tatDays) / r.tatDays) : null, cvPending: r.cvPending, docPending: r.docPending };
  }).sort(function (a, b) { return b.waitDays - a.waitDays; });
  const sum = function (list, k) { return list.reduce(function (s, x) { return s + (Number(x[k]) || 0); }, 0); };
  const tatDays = sum(depts, 'tatDays'), waitDays = sum(depts, 'waitDays');
  positions.sort(function (a, b) { return b.lossDays - a.lossDays || b.waitDays - a.waitDays; });
  return {
    from: from, to: to, lead: lead, norms: { cvH: DEPT_NORM_CV_H_, docD: DEPT_NORM_DOC_D_ },
    totals: { cvN: allCv.length, cvAvgH: allCv.length ? Math.round(avg(allCv)) : null, cvOver: depts.reduce(function (s, d) { return s + d.cvOver; }, 0),
      cvPending: sum(depts, 'cvPending'), docN: allDoc.length, docAvgD: allDoc.length ? r1(avg(allDoc)) : null, docPending: sum(depts, 'docPending'),
      waitDays: r1(waitDays), lossDays: r1(sum(depts, 'lossDays')), share: tatDays ? Math.round(100 * Math.min(waitDays, tatDays) / tatDays) : null, positions: positions.length },
    depts: depts, recruiters: recruiters, positions: positions
  };
}
