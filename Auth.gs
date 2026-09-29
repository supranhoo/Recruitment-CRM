/** Identifies the signed-in team member from the Users sheet. */
function currentUser_() {
  const email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!email) throw new Error('ACCESS: Could not read your Google account. Sign in to Google, open the app link again and approve the permission prompt.');
  const u = usersCached_().filter(function (r) {
    return String(r.Email).toLowerCase().trim() === email && String(r.Active || 'Yes') !== 'No';
  })[0];
  if (!u) throw new Error('ACCESS: ' + email + ' is not on the recruitment team list. Ask the CRM admin to add you in the Users sheet.');
  return { email: email, name: String(u.Name), role: String(u.Role || ROLES.RECRUITER), recruiter: String(u.Recruiter_Name || u.Name) };
}

function isLead_(u) { return u.role === ROLES.ADMIN || u.role === ROLES.HEAD; }

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
