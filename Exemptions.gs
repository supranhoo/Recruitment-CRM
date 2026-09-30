/**
 * TAT exemptions (schema 28, ADR-039). A recruiter or TA Lead requests extra days or a paused date range for a
 * position, with a reason, a remark and (when the reason needs it) proof; the Head of HR or the admin approves or
 * rejects it, and can grant one directly or revoke it later. The reason decides what an approved exemption changes:
 * the recruiter clock and the KPI score (Applies_Recruiter) and/or the position clock (Applies_Position). Those flags
 * are copied from the reason when the exemption is decided, so a later change to the reason never rewrites the past.
 * The notice-period extension stays automatic but needs proof; the Head of HR can verify or reject it.
 * Exemptions for a closed position can be requested, decided or revoked until TEX_LOCK_DAYS_ after the end of the
 * month in which it closed (the month its KPI falls in); after that only the admin can change them.
 */
T.TEX = { name: 'TAT_Exemptions', id: 'Exemption_ID', prefix: 'TEX-', width: 5, dates: ['From_Date', 'To_Date'], editable: [] };
const TEX_COLS_ = ['Exemption_ID', 'Line_ID', 'MRF_No', 'Type', 'Days', 'From_Date', 'To_Date', 'Reason', 'Remark', 'Proof_File',
  'Applies_Recruiter', 'Applies_Position', 'Status', 'Requested_By', 'Requested_On', 'Decided_By', 'Decided_On', 'Decision_Note',
  'Created_By', 'Created_At', 'Updated_By', 'Updated_At'];
const TEXR_SHEET_ = 'M_Exemption_Reasons';
const TEXR_COLS_ = ['Reason', 'Default_Type', 'Applies_Recruiter', 'Applies_Position', 'Proof_Required', 'Max_Days', 'Active', 'Note'];
const TEXR_SEED_ = [
  ['Department / HOD delay', 'Days', 'Yes', 'Yes', 'Yes', '', 'Yes', 'Department feedback, JD or questions validation or interview slots took longer than the policy norms'],
  ['Candidate notice buy-out / DOJ shift by company', 'Days', 'Yes', 'Yes', 'Yes', '', 'Yes', 'The company moved the joining date or the notice buy-out was not approved'],
  ['Niche / scarce skill, re-advertised', 'Days', 'No', 'Yes', 'No', '', 'Yes', 'Extends the position TAT only; the recruiter KPI is unchanged'],
  ['Budget, grade or MRF change mid-way', 'Pause', 'Yes', 'Yes', 'Yes', '', 'Yes', 'The clock is paused while the MRF was being changed']];
const TEX_LOCK_DAYS_ = 5;
const TEX_OPEN_ = ['Open', 'Offered', 'On Hold'];

function exemptSchema_() {
  addSheet_(T.TEX.name, TEX_COLS_);
  const fresh = !ss_().getSheetByName(TEXR_SHEET_);
  addSheet_(TEXR_SHEET_, TEXR_COLS_);
  if (fresh || readTable_(TEXR_SHEET_, true).rows.length === 0) sheet_(TEXR_SHEET_).getRange(2, 1, TEXR_SEED_.length, TEXR_COLS_.length).setValues(TEXR_SEED_);
  addColumns_(T.MRF.name, ['Notice_Proof_File', 'Notice_Ext_Status', 'Notice_Ext_Note', 'Notice_Ext_By', 'Notice_Ext_On']);
  dropStale_(T.TEX.name); dropStale_(TEXR_SHEET_);
}

/* ---------------- Calculation helpers (used by Tat.gs and Kpi.gs) ---------------- */

/** Approved exemptions per position: { lineId: [{ type, days, from, to, r, p, reason, id }] }. */
function exemptIndex_() {
  const out = {};
  if (!ss_().getSheetByName(T.TEX.name)) return out;
  readTable_(T.TEX.name).rows.forEach(function (x) {
    if (String(x.Status) !== 'Approved') return;
    (out[String(x.Line_ID)] = out[String(x.Line_ID)] || []).push({ id: String(x.Exemption_ID), type: String(x.Type), days: Number(x.Days) || 0,
      from: ymd_(x.From_Date), to: ymd_(x.To_Date), r: String(x.Applies_Recruiter) === 'Yes', p: String(x.Applies_Position) === 'Yes', reason: String(x.Reason) });
  });
  return out;
}
/** The approved exemptions of one position that apply to a clock ('r' recruiter and KPI, 'p' position). */
function exemptFor_(ctx, l, which) {
  const list = ((ctx && ctx.exempt) || {})[String(l.Line_ID)] || [];
  const mine = list.filter(function (x) { return which === 'p' ? x.p : x.r; });
  return { days: mine.filter(function (x) { return x.type === 'Days'; }).reduce(function (s, x) { return s + x.days; }, 0),
    pauses: mine.filter(function (x) { return x.type === 'Pause' && x.from && x.to; }), reasons: mine.map(function (x) { return x.reason; }) };
}
/** Notice days above the grace, unless the Head of HR rejected the extension. */
function noticeExt_(l, grace) {
  if (String(l.Notice_Ext_Status || '') === 'Rejected') return 0;
  return Math.max((Number(l.Notice_Period_Days) || 0) - grace, 0);
}
/** On-hold periods from Hold_Log lines "yyyy-mm-dd to yyyy-mm-dd (n days): reason", as [from, to) day ranges. */
function holdRanges_(l) {
  const out = [], re = /(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/g;
  let m; const s = String(l.Hold_Log || '');
  while ((m = re.exec(s))) out.push([m[1], m[2]]);
  return out;
}
/**
 * Days of approved pauses that fall inside the clock [start, end) and are not already excluded as on hold.
 * Pause dates are inclusive (From to To); each calendar day counts once even if pauses overlap.
 */
function pausedDays_(l, pauses, start, end) {
  if (!start || !end || !pauses || !pauses.length) return 0;
  const holds = holdRanges_(l), seen = {};
  let n = 0;
  pauses.forEach(function (p) {
    let d = p.from < start ? start : p.from;
    const last = p.to;
    let guard = 0;
    while (d <= last && d < end && guard++ < 1000) {
      const held = holds.some(function (h) { return d >= h[0] && d < h[1]; });
      if (!held && !seen[d]) { seen[d] = true; n++; }
      d = addDays_(d, 1);
    }
  });
  return n;
}

/* ---------------- Rules and lock ---------------- */

function exemptReasons_(all) {
  if (!ss_().getSheetByName(TEXR_SHEET_)) return [];
  return readTable_(TEXR_SHEET_).rows.filter(function (r) { return all || String(r.Active) !== 'No'; }).map(function (r) {
    return { reason: String(r.Reason), type: String(r.Default_Type) === 'Pause' ? 'Pause' : 'Days', r: String(r.Applies_Recruiter) === 'Yes',
      p: String(r.Applies_Position) === 'Yes', proof: String(r.Proof_Required) === 'Yes', max: Number(r.Max_Days) || 0, active: String(r.Active) !== 'No', note: String(r.Note || '') };
  });
}
/** A closed position can still be changed until TEX_LOCK_DAYS_ after the end of the month it closed in. */
function exemptLock_(l) {
  const st = positionStatus_(l);
  if (TEX_OPEN_.indexOf(st) >= 0) return { locked: false, until: '' };
  const end = ymd_(l.Actual_DOJ) || ymd_(l.TAT_End_Date) || ymd_(l.Replaced_On) || ymd_(l.No_Vacancy_Date) || ymd_(l.Not_Needed_Date);
  if (!end) return { locked: false, until: '' };
  const p = end.split('-'), last = new Date(Date.UTC(+p[0], +p[1], 0)).toISOString().slice(0, 10), until = addDays_(last, TEX_LOCK_DAYS_);
  return { locked: ymd_(new Date()) > until, until: until };
}
function requireUnlocked_(u, l) {
  const k = exemptLock_(l);
  if (k.locked && u.role !== ROLES.ADMIN) throw new Error('This position closed and its KPI month is locked (changes were allowed until ' + k.until + '). Ask the admin to correct it.');
}
/** Recalculates a position's stored TAT after an exemption or notice decision and marks the Overview and KPI stale. */
function exemptRecalc_(lineId, u) {
  _tables[T.TEX.name] = null; _tables[T.MRF.name] = null;
  const l = lineOf_(lineId); if (!l) return;
  update_(T.MRF, lineId, storedTat_(computeTat_(l, tatContext_())), u);
  markDashDirty_(T.MRF.name);
}
function texRow_(x) {
  return { id: String(x.Exemption_ID), line: String(x.Line_ID), mrf: String(x.MRF_No || ''), type: String(x.Type), days: Number(x.Days) || 0,
    from: ymd_(x.From_Date), to: ymd_(x.To_Date), reason: String(x.Reason), remark: String(x.Remark || ''), proof: String(x.Proof_File || ''),
    r: String(x.Applies_Recruiter) === 'Yes', p: String(x.Applies_Position) === 'Yes', status: String(x.Status),
    by: String(x.Requested_By || ''), on: ymd_(x.Requested_On), decidedBy: String(x.Decided_By || ''), decidedOn: ymd_(x.Decided_On), note: String(x.Decision_Note || '') };
}
function texOf_(id) {
  const x = readTable_(T.TEX.name, true).rows.filter(function (r) { return String(r.Exemption_ID) === String(id); })[0];
  if (!x) throw new Error('Exemption ' + id + ' was not found. Refresh the page.');
  return x;
}
function requireExemptDecider_(u) { if (!can_(u, 'tat_exempt')) throw new Error('Only the Head of HR or the admin can decide TAT exemptions.'); }

/* ---------------- API ---------------- */

/** Everything the position drawer needs: the exemptions, reasons, notice extension and what this user may do. */
function apiExemptionsForLine(lineId) {
  const u = currentUser_(); ensureSchema_();
  const l = lineOf_(lineId); if (!l) throw new Error('Position ' + lineId + ' was not found.');
  const ctx = tatContext_(), rule = ruleFor_(ctx, l.Grade, tatStart_(l));
  const items = readTable_(T.TEX.name).rows.filter(function (x) { return String(x.Line_ID) === String(lineId); }).map(texRow_)
    .sort(function (a, b) { return b.id.localeCompare(a.id); });
  const k = exemptLock_(l);
  return { items: items, reasons: exemptReasons_(false), canDecide: can_(u, 'tat_exempt'), canRequest: canEditLine_(u, l),
    me: u.email, lock: { locked: k.locked && u.role !== ROLES.ADMIN, until: k.until },
    notice: { days: Number(l.Notice_Period_Days) || 0, grace: rule.grace, ext: Math.max((Number(l.Notice_Period_Days) || 0) - rule.grace, 0),
      status: String(l.Notice_Ext_Status || ''), proof: String(l.Notice_Proof_File || ''), note: String(l.Notice_Ext_Note || ''),
      by: String(l.Notice_Ext_By || ''), on: ymd_(l.Notice_Ext_On) } };
}

/** Raises a request; a Head of HR / admin may grant it directly (approveNow). */
function apiExemptionRequest(lineId, d) {
  const u = currentUser_(); ensureSchema_();
  d = d || {};
  const l = requireLineEdit_(u, lineId);
  requireUnlocked_(u, l);
  const reason = exemptReasons_(false).filter(function (r) { return r.reason === String(d.reason || ''); })[0];
  if (!reason) throw new Error('Pick a reason from the list.');
  const type = d.type === 'Pause' ? 'Pause' : 'Days';
  const remark = clean_(String(d.remark || '').trim());
  if (remark.length < 5) throw new Error('Write a remark explaining the exemption.');
  const today = ymd_(new Date()), rec = { Line_ID: String(lineId), MRF_No: String(l.MRF_No || ''), Type: type, Reason: reason.reason, Remark: remark.slice(0, 1000),
    Status: 'Pending', Requested_By: u.email, Requested_On: new Date() };
  if (type === 'Days') {
    const n = Number(d.days);
    if (!(n >= 1 && Math.round(n) === n && n <= 365)) throw new Error('Enter the extra days as a whole number (1 or more).');
    if (reason.max && n > reason.max) throw new Error(reason.reason + ' allows at most ' + reason.max + ' days.');
    rec.Days = n;
  } else {
    const from = String(d.from || ''), to = String(d.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Enter the pause from and to dates.');
    if (from > to) throw new Error('The pause cannot end before it starts.');
    if (to > today) throw new Error('A pause can be requested once it has ended (the to date cannot be in the future).');
    const start = [tatStart_(l), posStart_(l)].filter(Boolean).sort()[0];
    if (start && to < start) throw new Error('The pause is before the TAT started (' + start + ').');
    const n = daysBetween_(from, to) + 1;
    if (reason.max && n > reason.max) throw new Error(reason.reason + ' allows at most ' + reason.max + ' days.');
    const clash = readTable_(T.TEX.name, true).rows.filter(function (x) {
      return String(x.Line_ID) === String(lineId) && String(x.Type) === 'Pause' && ['Pending', 'Approved'].indexOf(String(x.Status)) >= 0 && ymd_(x.From_Date) <= to && ymd_(x.To_Date) >= from;
    })[0];
    if (clash) throw new Error('These dates overlap exemption ' + clash.Exemption_ID + ' (' + ymd_(clash.From_Date) + ' to ' + ymd_(clash.To_Date) + ').');
    rec.From_Date = parseYmd_(from); rec.To_Date = parseYmd_(to); rec.Days = n;
  }
  const direct = !!d.approveNow && can_(u, 'tat_exempt');
  if (direct) {
    if (reason.proof && !d.proofComing) throw new Error(reason.reason + ' needs proof: attach it, then grant.');
    Object.assign(rec, { Status: 'Approved', Applies_Recruiter: reason.r ? 'Yes' : 'No', Applies_Position: reason.p ? 'Yes' : 'No',
      Decided_By: u.email, Decided_On: new Date(), Decision_Note: 'Granted directly by ' + u.name });
  }
  const saved = insert_(T.TEX, rec, u);
  if (direct) exemptRecalc_(lineId, u);
  return { id: saved.Exemption_ID, line: apiExemptionsForLine(lineId) };
}

function apiExemptionDecide(id, action, note) {
  const u = currentUser_(); ensureSchema_();
  requireExemptDecider_(u);
  const x = texOf_(id), l = lineOf_(String(x.Line_ID));
  if (!l) throw new Error('The position of this exemption was not found.');
  requireUnlocked_(u, l);
  if (String(x.Status) !== 'Pending') throw new Error('This request is already ' + String(x.Status).toLowerCase() + '.');
  note = clean_(String(note || '').trim()).slice(0, 500);
  if (action === 'Reject') {
    if (!note) throw new Error('Give a reason for rejecting.');
    update_(T.TEX, id, { Status: 'Rejected', Decided_By: u.email, Decided_On: new Date(), Decision_Note: note }, u);
  } else if (action === 'Approve') {
    const reason = exemptReasons_(true).filter(function (r) { return r.reason === String(x.Reason); })[0];
    if (!reason) throw new Error('The reason "' + x.Reason + '" no longer exists. Reject the request and ask for a new one.');
    if (reason.proof && !String(x.Proof_File || '')) throw new Error(reason.reason + ' needs proof, and none is attached yet.');
    update_(T.TEX, id, { Status: 'Approved', Applies_Recruiter: reason.r ? 'Yes' : 'No', Applies_Position: reason.p ? 'Yes' : 'No',
      Decided_By: u.email, Decided_On: new Date(), Decision_Note: note }, u);
    exemptRecalc_(String(x.Line_ID), u);
  } else throw new Error('Choose Approve or Reject.');
  return apiExemptionsForLine(String(x.Line_ID));
}

function apiExemptionWithdraw(id) {
  const u = currentUser_(); ensureSchema_();
  const x = texOf_(id);
  requireLineEdit_(u, String(x.Line_ID));
  if (String(x.Status) !== 'Pending') throw new Error('Only a pending request can be withdrawn.');
  update_(T.TEX, id, { Status: 'Withdrawn', Decided_By: u.email, Decided_On: new Date(), Decision_Note: 'Withdrawn by ' + u.name }, u);
  return apiExemptionsForLine(String(x.Line_ID));
}

function apiExemptionRevoke(id, note) {
  const u = currentUser_(); ensureSchema_();
  requireExemptDecider_(u);
  const x = texOf_(id), l = lineOf_(String(x.Line_ID));
  if (l) requireUnlocked_(u, l);
  if (String(x.Status) !== 'Approved') throw new Error('Only an approved exemption can be revoked.');
  note = clean_(String(note || '').trim()).slice(0, 500);
  if (!note) throw new Error('Give a reason for revoking.');
  update_(T.TEX, id, { Status: 'Revoked', Decided_By: u.email, Decided_On: new Date(), Decision_Note: note }, u);
  exemptRecalc_(String(x.Line_ID), u);
  return apiExemptionsForLine(String(x.Line_ID));
}

/** Head of HR verifies or rejects the automatic notice-period extension of a position. */
function apiNoticeExtDecide(lineId, action, note) {
  const u = currentUser_(); ensureSchema_();
  requireExemptDecider_(u);
  const l = lineOf_(lineId); if (!l) throw new Error('Position ' + lineId + ' was not found.');
  requireUnlocked_(u, l);
  if (['Verify', 'Reject', 'Reset'].indexOf(action) < 0) throw new Error('Choose Verify or Reject.');
  note = clean_(String(note || '').trim()).slice(0, 500);
  if (action === 'Reject' && !note) throw new Error('Give a reason for rejecting the notice extension.');
  if (action === 'Verify' && !String(l.Notice_Proof_File || '')) throw new Error('Attach the notice proof before verifying.');
  update_(T.MRF, lineId, { Notice_Ext_Status: action === 'Verify' ? 'Verified' : action === 'Reject' ? 'Rejected' : '', Notice_Ext_Note: note,
    Notice_Ext_By: u.email, Notice_Ext_On: new Date() }, u);
  exemptRecalc_(lineId, u);
  return apiExemptionsForLine(lineId);
}

/** Admin → TAT exemptions: every request with its position, and notice extensions to verify. Leads see it. */
function apiExemptionRegister(filter) {
  const u = currentUser_(); ensureSchema_();
  if (!isLead_(u) && !can_(u, 'tat_exempt')) throw new Error('Only a TA Lead, the Head of HR or the admin can see the exemption register.');
  const lines = {};
  readTable_(T.MRF.name).rows.forEach(function (l) { lines[l.Line_ID] = l; });
  const ctx = tatContext_();
  const rows = readTable_(T.TEX.name).rows.map(function (x) {
    const o = texRow_(x), l = lines[o.line] || {};
    return Object.assign(o, { position: String(l.Position || ''), dept: String(l.Dept || ''), recruiter: String(l.Recruiter || ''), lineStatus: positionStatus_(l) });
  }).sort(function (a, b) { return (a.status === 'Pending' ? 0 : 1) - (b.status === 'Pending' ? 0 : 1) || (a.status === 'Pending' ? a.on.localeCompare(b.on) : b.id.localeCompare(a.id)); });
  const notices = Object.keys(lines).map(function (id) { return lines[id]; }).filter(function (l) {
    const st = positionStatus_(l); if (st === 'Removed') return false;
    const g = ruleFor_(ctx, l.Grade, tatStart_(l)).grace;
    return (Number(l.Notice_Period_Days) || 0) > g && (TEX_OPEN_.indexOf(st) >= 0 || !exemptLock_(l).locked);
  }).map(function (l) {
    const g = ruleFor_(ctx, l.Grade, tatStart_(l)).grace;
    return { line: String(l.Line_ID), mrf: String(l.MRF_No || ''), position: String(l.Position || ''), dept: String(l.Dept || ''), recruiter: String(l.Recruiter || ''),
      days: Number(l.Notice_Period_Days) || 0, ext: Math.max((Number(l.Notice_Period_Days) || 0) - g, 0), proof: String(l.Notice_Proof_File || ''),
      status: String(l.Notice_Ext_Status || ''), note: String(l.Notice_Ext_Note || '') };
  });
  return { rows: rows, notices: notices, reasons: exemptReasons_(true), canDecide: can_(u, 'tat_exempt'), pending: rows.filter(function (r) { return r.status === 'Pending'; }).length };
}

function apiSaveExemptionReasons(list) {
  const u = currentUser_(); ensureSchema_();
  requireExemptDecider_(u);
  withLock_(function () {
    const t = readTable_(TEXR_SHEET_, true), have = {};
    t.rows.forEach(function (r) { have[String(r.Reason)] = r; });
    const seen = {};
    (list || []).forEach(function (x) {
      const name = clean_(String(x.reason || '').replace(/\s+/g, ' ').trim());
      if (!name) throw new Error('A reason cannot be blank.');
      if (name.length > 80) throw new Error('Keep "' + name.slice(0, 30) + '…" under 80 characters.');
      if (seen[name.toLowerCase()]) throw new Error('"' + name + '" is listed twice.');
      seen[name.toLowerCase()] = true;
      const max = x.max === '' || x.max == null ? '' : Number(x.max);
      if (max !== '' && !(max >= 1 && Math.round(max) === max)) throw new Error('Max days for "' + name + '" must be a whole number, or blank.');
      const row = [name, x.type === 'Pause' ? 'Pause' : 'Days', x.r ? 'Yes' : 'No', x.p ? 'Yes' : 'No', x.proof ? 'Yes' : 'No', max, x.active === false ? 'No' : 'Yes', clean_(String(x.note || '')).slice(0, 300)];
      const old = have[x.orig || name];
      if (old) {
        if (x.orig && x.orig !== name) throw new Error('A reason cannot be renamed (past exemptions refer to it). Deactivate it and add a new one.');
        const before = TEXR_COLS_.map(function (h) { return String(old[h] == null ? '' : old[h]); }).join('|'), after = row.map(String).join('|');
        if (before === after) return;
        t.sheet.getRange(old._row, 1, 1, row.length).setValues([row]);
        audit_(u, TEXR_SHEET_, name, 'Update', 'Reason', before, after);
      } else {
        t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        audit_(u, TEXR_SHEET_, name, 'Create', '', '', row.join('|'));
      }
    });
    dropStale_(TEXR_SHEET_);
  });
  return apiExemptionRegister({});
}
