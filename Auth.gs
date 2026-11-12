/** Identifies the signed-in team member from the Users sheet. */
var _curUser_ = null;
function currentUser_() {
  if (_curUser_) return Object.assign({}, _curUser_, { perms: _curUser_.perms.slice() });   // v165: once per run (it was four service calls each time)
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('ACCESS: Could not read your Google account. Sign in to Google, open the app link again and approve the permission prompt.');
  const u = usersCached_().filter(function (r) {
    return String(r.Email).toLowerCase().trim() === email && String(r.Active || 'Yes') !== 'No';
  })[0];
  if (!u) throw new Error('ACCESS: ' + email + ' is not on the recruitment team list. Ask the admin to add you in Admin \u2192 Users.');
  const role = normRole_(u.Role);
  const perms = effectivePerms_(role);
  if (typeof voiceHasAccess_ === 'function' && perms.indexOf('voice_call') < 0) { try { if (voiceHasAccess_(email)) perms.push('voice_call'); } catch (e) { } }
  _curUser_ = { email: email, name: String(u.Name), role: role, recruiter: String(u.Recruiter_Name || u.Name), perms: perms };
  _perfUser_ = _curUser_;
  return Object.assign({}, _curUser_, { perms: perms.slice() });
}

/** A plausible e-mail address, lower-cased and trimmed; '' when it is not one. */
function cleanMail_(s) { const e = String(s == null ? '' : s).trim().toLowerCase(); return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(e) ? e : ''; }
/**
 * Where mail for a Users row goes: the official address when one is recorded, else the sign-in account.
 * The sign-in account (Users.Email) stays the only key for access; correspondence uses this.
 */
function mailTo_(row) { return cleanMail_(row && row.Official_Email) || cleanMail_(row && row.Email); }
/** The mail address for a sign-in account (falls back to the account itself). */
function mailOfLogin_(email) {
  const k = String(email || '').trim().toLowerCase();
  const r = readTable_('Users').rows.filter(function (x) { return String(x.Email || '').trim().toLowerCase() === k; })[0];
  return r ? mailTo_(r) : k;
}

/** Accepts older or informal role names from the Users sheet: "Head", "Head HR", "Lead TA" and so on. */
function normRole_(r) {
  const s = String(r || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'admin' || s === 'administrator') return ROLES.ADMIN;
  if (s === 'head' || s === 'headhr' || s === 'headofhr' || s === 'hrhead') return ROLES.HEAD;
  if (s === 'talead' || s === 'leadta' || s === 'tl' || s === 'lead') return ROLES.TALEAD;
  if (s === 'onboarding' || s === 'onboard' || s === 'onboardingteam' || s === 'onboardingexecutive') return ROLES.ONBOARDING;
  return ROLES.RECRUITER;
}
/** A role's built-in permissions plus the CTC permissions the admin has given it (CTC calculator > Access). */
function effectivePerms_(role) {
  const base = (PERMS_[role] || []).slice();
  if (typeof ctcGrants_ === 'function') {
    try { (ctcGrants_()[role] || []).forEach(function (p) { if (base.indexOf(p) < 0) base.push(p); }); } catch (e) { }
  }
  return base;
}
function can_(u, perm) { return (u.perms || PERMS_[u.role] || []).indexOf(perm) >= 0; }
function isLead_(u) { return can_(u, 'lead'); }

function requireAdmin_(u) {
  if (u.role !== ROLES.ADMIN) throw new Error('Only the CRM admin can do this.');
}

/**
 * For functions meant to be run from the script editor or by a trigger (setup, sharing, jobs, test harness). They are also
 * callable from the browser, so a signed-in web user must be the database owner or an Admin. A trigger or the editor has no
 * browser user and passes.
 */
function requireEditorOrAdmin_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) return;
  try {
    const owner = DriveApp.getFileById(ss_().getId()).getOwner();
    if (owner && String(owner.getEmail()).toLowerCase() === email) return;
  } catch (e) { }
  requireAdmin_(currentUser_());
}

/** Recruiters edit their own positions; Head and Admin edit all. */
function canEditLine_(u, line) {
  return isLead_(u) || String(line.Recruiter).trim().toLowerCase() === u.recruiter.trim().toLowerCase();
}

/** True when the user is on the position: its lead recruiter, a tagged recruiter, or a lead (TA Lead, Head of HR, Admin). */
function onPosition_(u, line) {
  return canEditLine_(u, line) || isTagged_(u, line.Line_ID);
}
function isTagged_(u, lineId) {
  const me = String(u.recruiter || '').trim().toLowerCase();
  return !!me && posRecTagged_(lineId).some(function (n) { return String(n).trim().toLowerCase() === me; });
}
function isCardOwner_(u, app) {
  const me = String(u.recruiter || '').trim().toLowerCase(), who = String(app.Owner_Recruiter || '').trim().toLowerCase();
  return !!me && me === who;
}
/** Everything a card's own recruiter may do (move, reject, hold, withdraw, back out): leads, the position's recruiter, or the recruiter who added the candidate while still on the position. */
function canActCard_(u, line, app) {
  return canEditLine_(u, line) || (isCardOwner_(u, app) && isTagged_(u, line.Line_ID));
}
/** Who is on a position, for messages: "Priya, with Rahul and Sana". */
function positionPeople_(line) {
  const t = posRecTagged_(line.Line_ID), lead = String(line.Recruiter || 'nobody');
  return lead + (t.length ? ', with ' + t.join(' and ') : '');
}
/** The position, if the user is on it (lead recruiter or tagged) or is a lead; otherwise an error naming the people on it. Used for adding candidates, follow-ups, screening and interviews, and moving a card forward. */
function requireOnPosition_(u, lineId) {
  const l = lineOf_(lineId);
  if (!l) throw new Error('Position ' + lineId + ' was not found.');
  if (!onPosition_(u, l)) throw new Error('This position belongs to ' + positionPeople_(l) + '. Only they, a TA Lead or the Head of HR can work on its pipeline.');
  return l;
}
/** The position, if the user may reject, hold, withdraw or back out this card; otherwise an error that says who can. */
function requireCardAct_(u, app) {
  const l = lineOf_(app.Line_ID);
  if (!l) throw new Error('Position ' + app.Line_ID + ' was not found.');
  if (!canActCard_(u, l, app)) {
    const owner = String(app.Owner_Recruiter || '').trim();
    throw new Error((owner ? 'This candidate was added by ' + owner + '. ' : '') + 'Only ' + (owner ? 'they, ' : '') + 'the position\u2019s recruiter (' + String(l.Recruiter || 'nobody') + '), a TA Lead or the Head of HR can change the status. You can move the card forward.');
  }
  return l;
}

/** Users list cached for 5 minutes so every page action doesn't re-read the Users sheet. */
function usersCached_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('users_v1');
  if (hit) return JSON.parse(hit);
  const rows = readTable_('Users').rows.map(function (r) {
    return { Email: String(r.Email), Name: String(r.Name), Role: String(r.Role), Recruiter_Name: String(r.Recruiter_Name), Active: String(r.Active) };
  });
  cache.put('users_v1', JSON.stringify(rows), 300);
  return rows;
}
