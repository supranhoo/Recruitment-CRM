/**
 * User management (Admin > Users). The Users sheet is the team list; the app runs as each signed-in person, so
 * everyone active also needs edit access to the database file and the CV folder, which this file keeps in step.
 */
function usersSchema_() { addColumns_('Users', ['Added_By', 'Added_On', 'Updated_By', 'Updated_At']); }
function dropUsersCache_() { try { CacheService.getScriptCache().remove('users_v1'); } catch (e) { } dropStale_('Users'); }

function accessTargets_() {
  const out = [];
  try { out.push({ key: 'database', item: DriveApp.getFileById(DB_SPREADSHEET_ID) }); } catch (e) { }
  const f = settings_().CV_FOLDER_ID;
  if (f) { try { out.push({ key: 'CV folder', item: DriveApp.getFolderById(f) }); } catch (e) { } }
  return out;
}
function editorsOf_(item) {
  const set = {};
  try { item.getEditors().forEach(function (x) { set[x.getEmail().toLowerCase()] = true; }); } catch (e) { }
  try { const o = item.getOwner(); if (o) set[o.getEmail().toLowerCase()] = true; } catch (e) { }
  return set;
}
/** Gives (or removes) edit access to the database and CV folder. Returns a short message; never throws. */
function syncAccess_(email, active) {
  const problems = [];
  accessTargets_().forEach(function (t) {
    try {
      const eds = editorsOf_(t.item);
      let owner = ''; try { owner = t.item.getOwner().getEmail().toLowerCase(); } catch (e) { }
      if (email === owner) return;
      if (active && !eds[email]) t.item.addEditor(email);
      if (!active && eds[email]) t.item.removeEditor(email);
    } catch (e) { problems.push(t.key + ': ' + String(e.message || e).slice(0, 80)); }
  });
  return problems.length ? 'Access could not be updated (' + problems.join('; ') + '). The owner of the database can fix this with "Fix access".' : (active ? 'Access to the database and CV folder is set.' : 'Access to the database and CV folder is removed.');
}

function openLinesByRecruiter_() {
  const out = {};
  readTable_(T.MRF.name).rows.forEach(function (l) {
    if (['Open', 'Offered', 'On Hold'].indexOf(positionStatus_(l)) < 0) return;
    const k = String(l.Recruiter || '').trim().toLowerCase(); if (!k) return;
    (out[k] = out[k] || []).push({ id: String(l.Line_ID), mrf: String(l.MRF_No || ''), position: String(l.Position || ''), status: positionStatus_(l) });
  });
  return out;
}

function apiListUsers() {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'users_view')) throw new Error('Only the Head of HR or the admin can see the team list.');
  const targets = accessTargets_(), eds = targets.map(function (t) { return editorsOf_(t.item); });
  const open = openLinesByRecruiter_();
  const users = readTable_('Users', true).rows.filter(function (r) { return String(r.Email || '').trim(); }).map(function (r) {
    const email = String(r.Email).trim().toLowerCase(), rec = String(r.Recruiter_Name || r.Name || '').trim();
    return { email: email, name: String(r.Name || ''), role: normRole_(r.Role), recruiter: rec, active: String(r.Active || 'Yes') !== 'No',
      addedBy: String(r.Added_By || ''), addedOn: ymd_(r.Added_On), updatedBy: String(r.Updated_By || ''), updatedAt: r.Updated_At instanceof Date ? fmt_(r.Updated_At, TZ, 'd MMM yyyy, HH:mm') : '',
      access: targets.length ? eds.every(function (s) { return !!s[email]; }) : null, openPositions: (open[rec.toLowerCase()] || []).length };
  });
  return { me: u.email, canEdit: can_(u, 'users_edit'), roles: ROLE_LIST, accessChecked: targets.length > 0, users: users,
    recruiters: readTable_('M_Recruiters').rows.filter(function (r) { return String(r.Active) !== 'No'; }).map(function (r) { return String(r.Recruiter); }) };
}

/**
 * Adds or updates one user. d = { email, name, role, recruiter, active, isNew, reassignTo }.
 * Deactivating someone with open positions returns { needsReassign: [...] } until reassignTo is given.
 */
function apiSaveUser(d) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'users_edit')) throw new Error('Only the admin can add or change users.');
  d = d || {};
  const email = String(d.email || '').trim().toLowerCase(), name = clean_(String(d.name || '')).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address (the Google account they sign in with).');
  if (!name) throw new Error('Enter the person\u2019s name.');
  const role = ROLE_LIST.indexOf(d.role) >= 0 ? d.role : '';
  if (!role) throw new Error('Pick a role.');
  const recruiter = clean_(String(d.recruiter || name)).trim(), active = d.active !== false;
  const res = withLock_(function () {
    const t = readTable_('Users', true);
    const rows = t.rows.filter(function (r) { return String(r.Email || '').trim(); });
    const cur = rows.filter(function (r) { return String(r.Email).trim().toLowerCase() === email; })[0];
    if (d.isNew && cur) throw new Error(email + ' is already on the team list' + (String(cur.Active) === 'No' ? ' (inactive). Open it and reactivate instead.' : '.'));
    if (!d.isNew && !cur) throw new Error(email + ' is not on the team list.');
    const wasActive = cur ? String(cur.Active || 'Yes') !== 'No' : false, oldRole = cur ? normRole_(cur.Role) : '';
    const oldRec = cur ? String(cur.Recruiter_Name || cur.Name || '').trim() : '';
    if (cur && email === u.email && !active) throw new Error('You cannot deactivate yourself.');
    if (cur && email === u.email && oldRole === ROLES.ADMIN && role !== ROLES.ADMIN) throw new Error('You cannot remove your own Admin role. Ask another admin.');
    if (oldRole === ROLES.ADMIN && wasActive && (role !== ROLES.ADMIN || !active)) {
      const others = rows.filter(function (r) { return String(r.Email).trim().toLowerCase() !== email && normRole_(r.Role) === ROLES.ADMIN && String(r.Active || 'Yes') !== 'No'; });
      if (!others.length) throw new Error('This is the last active Admin. Make someone else Admin first.');
    }
    const clash = rows.filter(function (r) { return String(r.Email).trim().toLowerCase() !== email && String(r.Active || 'Yes') !== 'No' && String(r.Recruiter_Name || r.Name || '').trim().toLowerCase() === recruiter.toLowerCase(); })[0];
    if (clash) throw new Error('The recruiter name \u201c' + recruiter + '\u201d is already used by ' + clash.Name + '. Recruiter names must be unique.');
    if (cur && oldRec && oldRec.toLowerCase() !== recruiter.toLowerCase()) {
      const refs = readTable_(T.MRF.name).rows.filter(function (l) { return String(l.Recruiter || '').trim().toLowerCase() === oldRec.toLowerCase(); }).length
        + readTable_(T.CAND.name).rows.filter(function (c) { return String(c.Sourced_By || '').trim().toLowerCase() === oldRec.toLowerCase(); }).length;
      if (refs) throw new Error('The recruiter name \u201c' + oldRec + '\u201d is on ' + refs + ' positions and candidates, and in the daily log and KPI history. Renaming it would split that history, so keep the name.');
    }
    if (cur && wasActive && !active) {
      const open = openLinesByRecruiter_()[oldRec.toLowerCase()] || [];
      if (open.length && !d.reassignTo) return { needsReassign: open, recruiter: oldRec };
      if (open.length && String(d.reassignTo).toLowerCase() === oldRec.toLowerCase()) throw new Error('Pick a different recruiter to take over the positions.');
    }
    const now = new Date(), o = cur ? Object.assign({}, cur) : { Added_By: u.email, Added_On: now };
    Object.assign(o, { Email: email, Name: name, Role: role, Recruiter_Name: recruiter, Active: active ? 'Yes' : 'No', Updated_By: u.email, Updated_At: now });
    const vals = [t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; })];
    if (cur) t.sheet.getRange(cur._row, 1, 1, t.headers.length).setValues(vals);
    else t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues(vals);
    return { cur: cur ? { role: oldRole, active: wasActive, recruiter: oldRec } : null };
  });
  if (res.needsReassign) return res;
  dropUsersCache_();
  // Hand over open positions before the recruiter goes inactive.
  let reassigned = 0;
  if (res.cur && res.cur.active && !active && d.reassignTo) {
    (openLinesByRecruiter_()[res.cur.recruiter.toLowerCase()] || []).forEach(function (l) { update_(T.MRF, l.id, { Recruiter: String(d.reassignTo) }, u); reassigned++; });
  }
  syncRecruiterList_(recruiter, email, role, active);
  const access = (!res.cur || res.cur.active !== active) ? syncAccess_(email, active) : '';
  audit_(u, 'Users', email, res.cur ? 'Update' : 'Create', 'user', res.cur ? res.cur.role + (res.cur.active ? '' : ' (inactive)') : '',
    role + (active ? '' : ' (inactive)') + (reassigned ? '; ' + reassigned + ' positions to ' + d.reassignTo : ''));
  return { saved: true, access: access, reassigned: reassigned };
}

/** Recruiters and TA Leads appear in the recruiter dropdowns; the list follows their active status. */
function syncRecruiterList_(recruiter, email, role, active) {
  const recruits = role === ROLES.RECRUITER || role === ROLES.TALEAD;
  withLock_(function () {
    const t = readTable_('M_Recruiters', true);
    const row = t.rows.filter(function (r) { return String(r.Recruiter || '').trim().toLowerCase() === recruiter.toLowerCase(); })[0];
    const want = { Recruiter: recruiter, Email: email, Active: recruits && active ? 'Yes' : 'No' };
    if (row) {
      const o = Object.assign({}, row, want);
      t.sheet.getRange(row._row, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return o[h] === undefined ? '' : o[h]; })]);
    } else if (recruits && active) {
      t.sheet.getRange(t.sheet.getLastRow() + 1, 1, 1, t.headers.length).setValues([t.headers.map(function (h) { return want[h] === undefined ? '' : want[h]; })]);
    }
  });
  dropStale_('M_Recruiters');
}

function apiFixAccess(email) {
  const u = currentUser_(); ensureSchema_();
  if (!can_(u, 'users_edit')) throw new Error('Only the admin can change access.');
  email = String(email || '').trim().toLowerCase();
  const r = readTable_('Users', true).rows.filter(function (x) { return String(x.Email).trim().toLowerCase() === email; })[0];
  if (!r) throw new Error(email + ' is not on the team list.');
  const msg = syncAccess_(email, String(r.Active || 'Yes') !== 'No');
  audit_(u, 'Users', email, 'Update', 'access', '', msg);
  return msg;
}
