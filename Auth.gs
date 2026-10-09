/** Identifies the signed-in team member from the Users sheet. */
function currentUser_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('ACCESS: Could not read your Google account. Sign in to Google, open the app link again and approve the permission prompt.');
  const u = usersCached_().filter(function (r) {
    return String(r.Email).toLowerCase().trim() === email && String(r.Active || 'Yes') !== 'No';
  })[0];
  if (!u) throw new Error('ACCESS: ' + email + ' is not on the recruitment team list. Ask the admin to add you in Admin \u2192 Users.');
  const role = normRole_(u.Role);
  return { email: email, name: String(u.Name), role: role, recruiter: String(u.Recruiter_Name || u.Name), perms: effectivePerms_(role) };
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

/** Recruiters edit their own positions; Head and Admin edit all. */
function canEditLine_(u, line) {
  return isLead_(u) || String(line.Recruiter).trim().toLowerCase() === u.recruiter.trim().toLowerCase();
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
