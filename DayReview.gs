/**
 * Daily recruiter summary: what each recruiter did on a given day.
 * Combines the recruiter's own note and task list (Daily_Summary), their activity
 * counts per position (Daily_Funnel), offers and joinings (MRF), candidates added,
 * and the changes they made in the app (Audit_Log).
 */
const DAY_STAGES = ['CV_Sourced', 'CV_Reviewed', 'HR_1st_Round', 'CV_Shared_Dept', 'Shortlisted_Dept', 'Interviews_Done', 'Selected_Final', 'Offers', 'Joined'];

function recruiterByEmail_() {
  const map = {};
  readTable_('Users').rows.forEach(function (r) {
    if (r.Email) map[String(r.Email).trim().toLowerCase()] = String(r.Recruiter_Name || r.Name).trim();
  });
  return map;
}

function dayData_(date, onlyRecruiter) {
  const byEmail = recruiterByEmail_();
  const lines = readTable_(T.MRF.name).rows;
  const lineById = {};
  lines.forEach(function (l) { lineById[l.Line_ID] = l; });
  const recs = {};
  const blank = function (name) {
    const f = {}; DAY_STAGES.forEach(function (k) { f[k] = 0; });
    return { recruiter: name, overview: '', tasks: [], summaryId: '', updatedAt: '', funnel: f, backouts: 0,
      byPosition: {}, work: {}, candidates: [], offers: [], joined: [] };
  };
  const get = function (name) {
    name = String(name || 'Unassigned').trim() || 'Unassigned';
    if (onlyRecruiter && name.toLowerCase() !== onlyRecruiter.toLowerCase()) return null;
    return recs[name] = recs[name] || blank(name);
  };
  readTable_('M_Recruiters').rows.forEach(function (r) { if (String(r.Active) !== 'No') get(r.Recruiter); });

  readTable_(T.FUNNEL.name).rows.forEach(function (e) {
    if (ymd_(e.Entry_Date) !== date) return;
    const r = get(e.Recruiter); if (!r) return;
    const l = lineById[e.Line_ID] || {};
    const g = r.byPosition[e.Line_ID] = r.byPosition[e.Line_ID] || { line: e.Line_ID, mrf: String(e.MRF_No || l.MRF_No || ''),
      position: String(l.Position || ''), dept: String(l.Dept || ''), grade: String(l.Grade || ''), remarks: [] };
    FUNNEL_METRICS.forEach(function (m) {
      const n = Number(e[m]) || 0;
      g[m] = (g[m] || 0) + n; r.funnel[m] += n;
    });
    if (e.Remarks) g.remarks.push(String(e.Remarks));
    if (e.FB_From_Dept) (g.feedback = g.feedback || []).push(String(e.FB_From_Dept));
  });

  lines.forEach(function (l) {
    const r = get(l.Recruiter); if (!r) return;
    const brief = { line: l.Line_ID, mrf: String(l.MRF_No), position: String(l.Position), dept: String(l.Dept) };
    if (ymd_(l.Offer_Date) === date) { r.funnel.Offers++; r.offers.push(brief); }
    if (ymd_(l.Actual_DOJ) === date) { r.funnel.Joined++; r.joined.push(brief); }
    if (ymd_(l.Backout_Date) === date) r.backouts++;
  });

  readTable_(T.CAND.name).rows.forEach(function (c) {
    if (ymd_(c.Created_At) !== date || String(c.Created_By) === 'migration') return;
    const r = get(byEmail[String(c.Created_By).toLowerCase()] || c.Sourced_By); if (!r) return;
    r.candidates.push({ id: c.Candidate_ID, name: String(c.Name), position: String(c.Position || '') });
  });

  const label = function (a) {
    const s = String(a.Sheet), act = String(a.Action), f = String(a.Field), nv = String(a.New_Value);
    if (s === T.CAND.name) {
      if (act === 'Create') return 'Candidates added';
      if (f === 'CV_File_URL') return 'CVs uploaded';
      if (/Tech_Result|HR_Result/.test(f) && nv) return 'Interview results recorded';
      if (/Psychometric/.test(f)) return 'Psychometric tests updated';
      return 'Candidate records updated';
    }
    if (s === T.MRF.name) {
      if (act === 'Create') return 'MRF positions added';
      if (f === 'Offer_Sent' && nv === 'Yes') return 'Offers marked sent';
      if (f === 'Offer_Date' && nv) return 'Offer dates recorded';
      if (f === 'Actual_DOJ' && nv) return 'Joinings recorded';
      if (f === 'Backout_Date' && nv) return 'Backouts recorded';
      if (/^BGV_/.test(f)) return 'BGV details updated';
      if (/Panel/.test(f)) return 'Interview panels set';
      if (/Position_Status|Standard_TAT|Exemption_Days|Final_TAT|TAT_End_Date|Days_Taken|TAT_Result/.test(f)) return '';
      return 'Position details updated';
    }
    if (s === T.FUNNEL.name && act === 'Create') return 'Activity entries logged';
    if (s === T.PANEL.name && act === 'Create') return 'Panel unavailability logged';
    if (s === 'M_Panel_Members' && act === 'Create') return 'Panel members added';
    return '';
  };
  const seen = {};
  readTable_('Audit_Log').rows.forEach(function (a) {
    if (ymd_(a.Timestamp) !== date) return;
    const name = byEmail[String(a.User).toLowerCase()];
    if (!name) return;
    const r = get(name); if (!r) return;
    const l = label(a); if (!l) return;
    const key = name + '|' + l + '|' + a.Record_ID;
    if (seen[key]) return;
    seen[key] = true;
    r.work[l] = (r.work[l] || 0) + 1;
  });

  readTable_('Daily_Summary').rows.forEach(function (s) {
    if (ymd_(s.Summary_Date) !== date) return;
    const r = get(s.Recruiter); if (!r) return;
    r.overview = String(s.Overview || '');
    try { r.tasks = JSON.parse(String(s.Tasks_JSON || '[]')); } catch (e) { r.tasks = []; }
    r.summaryId = String(s.Summary_ID);
    r.updatedAt = s.Updated_At instanceof Date ? Utilities.formatDate(s.Updated_At, TZ, 'd MMM, HH:mm') : '';
  });

  const out = Object.keys(recs).map(function (k) {
    const r = recs[k];
    r.byPosition = Object.keys(r.byPosition).map(function (id) { return r.byPosition[id]; })
      .sort(function (a, b) { return (b.CV_Reviewed || 0) + (b.CV_Sourced || 0) - (a.CV_Reviewed || 0) - (a.CV_Sourced || 0); });
    r.work = Object.keys(r.work).map(function (w) { return { label: w, count: r.work[w] }; }).sort(function (a, b) { return b.count - a.count; });
    r.active = DAY_STAGES.some(function (s) { return r.funnel[s] > 0; }) || r.work.length > 0 || !!r.overview || r.tasks.length > 0;
    return r;
  }).filter(function (r) { return r.recruiter !== 'Unassigned' || r.active; })
    .sort(function (a, b) { return (b.active - a.active) || a.recruiter.localeCompare(b.recruiter); });

  const moves = pipelineMoves_(date);
  out.forEach(function (r) { r.moves = moves[r.recruiter] || {}; if (Object.keys(r.moves).length) r.active = true; });
  const team = {}; DAY_STAGES.forEach(function (k) { team[k] = out.reduce(function (s, r) { return s + r.funnel[k]; }, 0); });
  return { date: date, stages: DAY_STAGES, recruiters: out, team: team };
}

/** Recruiters see their own day; the head and admin can see everyone. */
function apiDaySummary(date) {
  const u = currentUser_(); ensureSchema_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('Pick a date.');
  return dayData_(date, isLead_(u) ? '' : u.recruiter);
}

/** Saves a recruiter's day note and task list. Recruiters can update today and yesterday. */
function apiSaveDaySummary(data) {
  const u = currentUser_(); ensureSchema_();
  const date = String(data.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a date.');
  const today = ymd_(new Date());
  if (date > today) throw new Error('You cannot write a summary for a future date.');
  const yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), TZ, 'yyyy-MM-dd');
  if (!isLead_(u) && date < yesterday) throw new Error('You can update today and yesterday only. Ask the recruitment head to change older days.');
  const recruiter = isLead_(u) && data.recruiter ? String(data.recruiter) : u.recruiter;
  const tasks = (Array.isArray(data.tasks) ? data.tasks : []).slice(0, 40).map(function (t) {
    return { t: String(t.t || '').slice(0, 200), d: !!t.d };
  }).filter(function (t) { return t.t.trim(); });
  const patch = { Summary_Date: parseYmd_(date), Recruiter: recruiter, Overview: clean_(String(data.overview || '').slice(0, 3000)),
    Tasks_JSON: JSON.stringify(tasks) };
  const existing = readTable_('Daily_Summary', true).rows.filter(function (s) {
    return ymd_(s.Summary_Date) === date && String(s.Recruiter).toLowerCase() === recruiter.toLowerCase();
  })[0];
  const rec = existing ? update_(T.DAY, existing.Summary_ID, patch, u) : insert_(T.DAY, patch, u);
  return { summaryId: String(rec.Summary_ID), savedAt: Utilities.formatDate(new Date(), TZ, 'HH:mm') };
}
