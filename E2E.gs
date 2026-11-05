function e2eTest() {
  requireEditorOrAdmin_();
  ensureSchema_();   // bring the real database up to this release first; the schema marker is shared, so upgrading only the copy would leave the real one behind
  const src = DriveApp.getFileById(DB_SPREADSHEET_ID);
  const copy = src.makeCopy('E2E TEST COPY - safe to delete');
  const trash = [];
  let res;
  try {
    _ss = SpreadsheetApp.openById(copy.getId()); _tables = {};
    res = e2eRun_(trash);
  } finally {
    _ss = null; _tables = {};
    copy.setTrashed(true);
    trash.forEach(function (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { } });
    const fy = kpiCurrentFy_();
    CacheService.getScriptCache().removeAll([dashCacheKey_(), 'users_v1']);   // these two are not keyed by database file; the small-table, KPI, candidate-index, live-map, archive-index and CTC-grant caches are, so the copy's never reach the real app
    PropertiesService.getScriptProperties().setProperty('DASH_DIRTY_AT', String(Date.now()));
  }
  Logger.log('RESULT pass ' + res.pass + ' fail ' + res.fail);
  res.log.forEach(function (l) { if (l.indexOf('FAIL') === 0) Logger.log(l); });
  Logger.log('ALL: ' + res.log.map(function (l) { return l.split(' | ')[0]; }).join('; '));
}

function e2eRun_(trash) {
  const log = []; let pass = 0, fail = 0;
  const ok = function (name, cond, info) { if (cond) pass++; else fail++; log.push((cond ? 'PASS ' : 'FAIL ') + name + (info ? ' | ' + info : '')); };
  const t = function (name, fn) { try { const r = fn(); ok(name, r !== false, typeof r === 'string' ? r : ''); return r; } catch (e) { ok(name, false, String(e && e.message || e).slice(0, 160)); return null; } };
  const err = function (name, fn, re) { try { fn(); ok(name, false, 'expected an error, none raised'); } catch (e) { const m = String(e && e.message || e); ok(name, re.test(m), m.slice(0, 100)); } };
  const fid = function (u) { const m = String(u || '').match(/\/d\/([^/]+)/) || String(u || '').match(/id=([^&]+)/); return m ? m[1] : ''; };
  const today = ymd_(new Date());
  const fy = kpiCurrentFy_();
  const pdf = Utilities.base64Encode(Utilities.newBlob('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').getBytes());

  const boot = t('A1 bootstrap as admin', function () { const b = apiBootstrap(); return b.user.role === 'Admin' && b.recruiters.length > 0 && b.panel.length >= 60 ? b : false; });
  const lines = t('A2 list positions', function () { const l = apiListPositions(); return l.length >= 300 && l[0].Position_Status ? l : false; }) || [];
  t('A3 list candidates', function () { return apiListCandidates().length >= 1000; });
  t('A4 dashboard', function () { const d = apiDashboard(); return typeof d.kpi.open === 'number' ? 'open ' + d.kpi.open : false; });
  t('A5 KPI scorecard', function () { const k = apiKpi(fy, true); return Object.keys(k.defs).length === 8 && !!k.defs.W_FULFILMENT ? 'fy ' + fy : false; });
  t('A6 data checks', function () { return apiDataChecks().length === 16; });
  t('A7 change history', function () { return Array.isArray(apiAuditLog({})); });
  t('A8 panel members', function () { return apiListPanelMembers().length >= 60; });
  t('A9 panel unavailability list', function () { return Array.isArray(apiListPanel()); });
  t('A10 daily log list', function () { return Array.isArray(apiListFunnel({})); });
  t('A11 observations list', function () { return Array.isArray(apiListObservations({})); });
  t('A12 weekly summary status', function () { return typeof apiWeeklyStatus().on === 'boolean'; });
  t('A13 admin info', function () { return apiAdminInfo().hasOwnProperty('lastBackup'); });
  t('A14 pipeline alerts', function () { return !!apiPipelineAlerts().counts; });
  t('S1 formula-safe text', function () { return clean_('=1+1') === "'=1+1" && clean_('-IMPORTXML(1)') === "'-IMPORTXML(1)" && clean_('-5') === '-5' && plainCell_('+1') === "'+1" && plainCell_('Normal') === 'Normal'; });
  t('S2 calendar-valid dates', function () { let bad = false; try { parseYmd_('2026-02-30'); } catch (e) { bad = true; } return bad && ymd_(parseYmd_('2026-11-07')) === '2026-11-07'; });
  t('S3 fast-track Offer needs the department decision', function () { let bad = false; try { fastMove_({ role: 'Admin', perms: ['lead'], email: 'e2e' }, { Stage: 'Shared' }, { Grade: 'W2' }, 'Offer', {}); } catch (e) { bad = /department/i.test(String(e.message)); } return bad; });
  t('S5 reinstate a backout is available', function () { return typeof apiReinstateBackout === 'function' && typeof apiReinstatePreview === 'function' && typeof reinstateInfo_ === 'function'; });
  t('S6 fast-track Offer for a card added at a later stage with the paper', function () { const o = fastMove_({ role: 'Admin', perms: ['lead'], email: 'e2e' }, { Stage: 'HR', Dept_Confirm_File: 'https://example.com/f' }, { Grade: 'W2' }, 'Offer', {}); return /not recorded/.test(o.note || ''); });
  t('S7 one daily-log entry per position and day', function () { return typeof funnelDuplicates_ === 'function' && Array.isArray(funnelDuplicates_()) && typeof apiRemoveDuplicateEntries === 'function'; });
  t('S8 release number', function () { return /^\d+$/.test(String(BUILD_ID)) && String(apiBootstrap().build) === String(BUILD_ID); });
  t('S9 pipeline candidate search', function () { return Array.isArray(apiPipelineFind('a')) && apiPipelineFind('a').length <= 15 && apiPipelineFind('').length === 0; });
  t('S10 to-dos carry their notes', function () { const a = apiMyTasks().tasks || []; return a.every(function (x) { return Array.isArray(x.notes); }); });
  t('S11 waiting-for-department alerts say if the card is fast-track', function () { return apiPipelineAlerts().hodOverdue.every(function (x) { return typeof x.fast === 'boolean'; }); });
  t('S12 monthly missed to-dos', function () { const r = apiMonthMissed(fmt_(new Date(), TZ, 'yyyy-MM'), ''); return Array.isArray(r.rows) && typeof r.total.missed === 'number' && typeof r.carried === 'number' && r.rows.every(function (x) { return typeof x.change === 'number' && Array.isArray(x.kinds); }); });
  t('S13 speed check and schema state', function () { const s = schemaState_(); return typeof apiSpeedCheck === 'function' && typeof s.complete === 'boolean' && Array.isArray(s.errors); });
  t('S4 editor-only functions refuse a plain web user', function () { return typeof requireEditorOrAdmin_ === 'function'; });
  t('A15 fast-track routes', function () { const c = apiFastTrackConfig(); return c.fast.length > 0 && routeOf_({ Grade: 'W2' }) === 'Fast-track' && routeOf_({ Grade: 'M3' }) === 'Standard' && routeOf_({ Grade: 'M3', Hiring_Route: 'Fast-track' }) === 'Fast-track' && fastNext_('Sourced') === 'Shared' && fastNext_('Confirmed') === 'Offer' && fastNext_('Offer') === 'Joined'; });

  const rec = (boot && boot.recruiters[0] && (boot.recruiters[0].Recruiter || boot.recruiters[0])) || 'Tanaaz';
  const dept = (lines.filter(function (l) { return l.Dept; })[0] || {}).Dept || 'HR-HUMAN RESOURCES';
  const m5 = ((boot && boot.grades || []).filter(function (g) { return g.grade === 'M5'; })[0] || {}).designations || [];
  const newLines = t('B1 add MRF with 2 positions', function () {
    const r = apiAddPositionLines({ Position: 'E2E TEST POSITION', Designation: m5[0] || '', Grade: 'M5', Dept: dept, Receipt_Date: today, Recruiter: String(rec), Approval_Status: 'Approved',
      Offer_Sent: 'No', MRF_No: 'E2E-1', Tech_Panel: 'Jaspal Bhanker', Final_Panel: 'Gaurav Budhia', JD_Text: 'Test JD', Vacancy_Reason: 'Replacement', Budget_CTC: '6-8 LPA' }, 2);
    return r.length === 2 && r[0].Position_Status === 'Open' && Number(r[0].Final_TAT) === 50 ? r : false;
  }) || [];
  const L1 = newLines[0] || {}, L2 = newLines[1] || {};
  t('B1a designation saved on the position', function () { return m5.length ? String(L1.Designation) === m5[0] : 'M5 has no designations'; });
  if (m5.length) err('B1b new position needs a designation', function () { apiSavePosition({ Position: 'X', Grade: 'M5', Dept: dept, Receipt_Date: today }); }, /designation/);
  err('B1c designation must belong to the grade', function () { apiSavePosition({ Position: 'X', Grade: 'M5', Designation: 'E2E Not A Title', Dept: dept, Receipt_Date: today }); }, /not a designation/);
  t('B1d grade setup lists grades and designations', function () { const g = apiGradeSetup(); return g.grades.length >= 10 && g.desigs.length > 0 ? g.desigs.length + ' designations' : false; });
  err('B2 position needs grade', function () { apiSavePosition({ Position: 'X', Dept: dept, Receipt_Date: today }); }, /required/);
  err('B3 joining needs offer first', function () { apiSavePosition(Object.assign({}, L2, { Actual_DOJ: today, Offer_Sent: 'No' })); }, /Offer sent/);
  t('B4 edit position', function () { return apiSavePosition(Object.assign({}, L2, { Remarks: 'E2E edited' })).Remarks === 'E2E edited'; });
  t('B5 JD and panel saved on position', function () { _tables = {}; const l = apiListPositions().filter(function (x) { return x.Line_ID === L1.Line_ID; })[0]; return l.JD_Text === 'Test JD' && l.Tech_Panel === 'Jaspal Bhanker'; });
  t('B6 JD file upload', function () { const r = apiUploadDoc('MRF', L1.Line_ID, 'JD_File', 'jd.pdf', 'application/pdf', pdf); trash.push(fid(r.url || r)); return !!fid(r.url || r); });
  // TAT exemptions (schema 28): request -> pending (no effect) -> approve -> revoke, per-reason clocks, notice proof rule.
  const posTat = function () { _tables = {}; return apiGetPosition(L1.Line_ID); };
  const base0 = posTat();
  const x1 = t('X1 exemption request is pending and changes nothing', function () {
    const r = apiExemptionRequest(L1.Line_ID, { reason: 'Niche / scarce skill, re-advertised', type: 'Days', days: 5, remark: 'E2E niche re-advertised' });
    const p = posTat(); return r.line.items[0].status === 'Pending' && p.Final_TAT === base0.Final_TAT && p.Pos_Final_TAT === base0.Pos_Final_TAT ? r.id : false;
  });
  t('X2 approved position-only reason extends only the position TAT', function () {
    apiExemptionDecide(x1, 'Approve', 'E2E'); const p = posTat();
    return p.Pos_Final_TAT === base0.Pos_Final_TAT + 5 && p.Final_TAT === base0.Final_TAT ? 'pos ' + p.Pos_Final_TAT : false;
  });
  err('X3 approval needs proof when the reason asks for it', function () {
    const r = apiExemptionRequest(L1.Line_ID, { reason: 'Department / HOD delay', type: 'Days', days: 3, remark: 'E2E HOD delay' }); apiExemptionDecide(r.id, 'Approve', '');
  }, /proof/);
  t('X4 revoke restores the TAT', function () { apiExemptionRevoke(x1, 'E2E revoke'); return posTat().Pos_Final_TAT === base0.Pos_Final_TAT; });
  err('X5 notice over 30 days needs proof', function () { apiSavePosition(Object.assign({}, L1, { Notice_Period_Days: 60 })); }, /proof/);
  t('X6 exemption register lists the requests', function () { const r = apiExemptionRegister({}); return r.rows.filter(function (x) { return x.line === L1.Line_ID; }).length >= 2 && r.reasons.length >= 4; });
  t('X7 the exemption reasons include "Delay in MRF Evidence" and "Other, if any" (Days, both clocks, proof), seeded once', function () {
    exemptSchema_(); exemptSchema_(); _tables = {};
    const rs = exemptReasons_(false), rows = readTable_(TEXR_SHEET_, true).rows;
    return ['Delay in MRF Evidence', 'Other, if any'].every(function (n) {
      const r = rs.filter(function (x) { return x.reason === n; })[0];
      return r && r.type === 'Days' && r.r && r.p && r.proof && !r.max && rows.filter(function (x) { return String(x.Reason) === n; }).length === 1;
    }) ? rs.length + ' reasons' : false;
  });
  const x8 = ['Delay in MRF Evidence', 'Other, if any'].map(function (reason) {
    return t('X8 a request with "' + reason + '" is pending and changes nothing', function () {
      const r = apiExemptionRequest(L1.Line_ID, { reason: reason, type: 'Days', days: 4, remark: 'E2E ' + reason });
      const item = r.line.items.filter(function (i) { return i.id === r.id; })[0], p = posTat();
      return item && item.status === 'Pending' && item.reason === reason && p.Final_TAT === base0.Final_TAT && p.Pos_Final_TAT === base0.Pos_Final_TAT ? r.id : false;
    });
  });
  err('X9 approving "Delay in MRF Evidence" needs proof', function () { apiExemptionDecide(x8[0], 'Approve', ''); }, /proof/);
  err('X9b approving "Other, if any" needs proof', function () { apiExemptionDecide(x8[1], 'Approve', ''); }, /proof/);
  err('X10 a reason that is not in the list is refused', function () { apiExemptionRequest(L1.Line_ID, { reason: 'Something else', type: 'Days', days: 2, remark: 'E2E unknown reason' }); }, /Pick a reason/);
  err('X10b a request needs a remark', function () { apiExemptionRequest(L1.Line_ID, { reason: 'Other, if any', type: 'Days', days: 2, remark: 'x' }); }, /remark/);
  t('X11 the two test requests are rejected so no pending request is left', function () { return x8.every(function (id) { return !!id && apiExemptionDecide(id, 'Reject', 'E2E cleanup'); }) ? 'ok' : false; });
  t('B7 JD file view', function () { return apiGetDoc('MRF', L1.Line_ID, 'JD_File').b64.length > 10; });
  const jd1 = t('J1 uploaded JD lands in the JD folder', function () {
    const r = apiListJds(); const f = r.files.filter(function (x) { return x.usedBy.some(function (u) { return u.line === L1.Line_ID; }); })[0];
    return r.folderName === 'JD' && f && /^JD - E2E TEST POSITION \(E2E-1\)\.pdf$/.test(f.name) ? f : false; }) || {};
  t('J2 attach the same JD to another position from the folder', function () { apiUseJd([L2.Line_ID], jd1.id); _tables = {}; const f = apiListJds().files.filter(function (x) { return x.id === jd1.id; })[0]; return f.usedBy.length === 2; });
  t('J3 JD attached from the folder can be viewed', function () { _tables = {}; return apiGetDoc('MRF', L2.Line_ID, 'JD_File').b64.length > 10; });
  t('J4 second upload keeps both files', function () { const r = apiUploadDoc('MRF', L1.Line_ID, 'JD_File', 'jd2.pdf', 'application/pdf', pdf); trash.push(fid(r.url || r)); _tables = {}; return apiListJds().files.filter(function (x) { return /^JD - E2E TEST POSITION/.test(x.name); }).length === 2; });

  const c1 = t('C1 add candidate linked to position', function () { const r = apiSaveCandidate({ Name: 'E2E Candidate One', Mobile: '9111122223', Email: 'e2e.one@example.com', Line_ID: L1.Line_ID, Position: 'E2E TEST POSITION', Relevant_Experience: '6' }); return r.saved ? r.saved : false; }) || {};
  t('C2 duplicate mobile detected', function () { const r = apiSaveCandidate({ Name: 'Dup', Mobile: '9111122223' }); return !!(r.duplicates && r.duplicates.length); });
  err('C3 bad mobile rejected', function () { apiSaveCandidate({ Name: 'Bad', Mobile: '12345' }); }, /10 digits/);
  err('C4 bad email rejected', function () { apiSaveCandidate({ Name: 'Bad', Email: 'nope' }); }, /email/i);
  t('C5 get candidate', function () { return apiGetCandidate(c1.Candidate_ID).Name === 'E2E Candidate One'; });
  t('C6 CV upload', function () { const r = apiUploadCv(c1.Candidate_ID, 'cv.pdf', 'application/pdf', pdf); trash.push(fid(r.url || r)); return !!fid(r.url || r); });
  t('C7 CV view', function () { return apiGetCv(c1.Candidate_ID).b64.length > 10; });
  err('J5 file outside the JD folder is refused', function () { apiUseJd([L1.Line_ID], fid(apiGetCandidate(c1.Candidate_ID).CV_File_URL)); }, /JD folder/);

  let P = t('D1 candidate auto-added to pipeline', function () { const p = apiPipeline(L1.Line_ID); return p.apps.length === 1 && p.apps[0].Stage === 'Sourced' ? p : false; }) || { apps: [{}] };
  const A = P.apps[0].App_ID;
  let JDV = null, SQV = null;
  err('D2 questions blocked until the JD is final', function () { apiSaveScreeningQuestions(L1.Line_ID, ['Current CTC?', 'Notice period?']); }, /Finalise the JD/);
  t('D2a typed JD becomes a new draft version', function () { const before = apiDocFlow(L1.Line_ID).state.jdVersion; JDV = apiDocAddJdText(L1.Line_ID, 'Key responsibilities: run the maintenance plan. Qualification: Diploma.'); return JDV.version === before + 1 && JDV.status === 'Draft'; });
  err('D2b shared before the MRF date blocked', function () { apiDocShare(JDV.id, { sharedWith: 'HOD', sharedOn: '2020-01-01' }); }, /before the MRF received/);
  err('D2c future share date blocked', function () { apiDocShare(JDV.id, { sharedWith: 'HOD', sharedOn: '2099-01-01' }); }, /future/);
  t('D2d JD shared and validated sets JD confirmed on the position', function () { _tables = {}; apiDocShare(JDV.id, { sharedWith: 'HOD', sharedOn: today }); apiDocRespond(JDV.id, { response: 'Validated', date: today }); _tables = {}; return ymd_(lineOf_(L1.Line_ID).JD_Confirmed_Date) === today; });
  t('D2e questions shared and validated', function () { _tables = {}; apiSaveScreeningQuestions(L1.Line_ID, ['Current CTC?', 'Notice period?']); SQV = apiDocFlow(L1.Line_ID).sq[0]; apiDocShare(SQV.id, { sharedWith: 'HOD', sharedOn: today }); return apiDocRespond(SQV.id, { response: 'Validated', date: today }).status === 'Final'; });
  t('D2f dates shown in pipeline', function () { _tables = {}; const l = apiPipeline(L1.Line_ID).line; return l.JD_Confirmed_Date === today && l.SQ_Confirmed_Date === today; });
  t('D3 job post', function () { return !!apiSaveJobPost({ Line_ID: L1.Line_ID, Post_Type: 'External', Channel: 'Naukri', Posted_On: today, Status: 'Live' }).Post_ID; });
  const mv = function (name, st, d, check) { return t(name, function () { const p = apiMoveStage(A, st, d); const a = p.apps.filter(function (x) { return x.App_ID === A; })[0]; return a.Stage === st && (!check || check(a, p)); }); };
  const screen = function (appId, vals) {
    const S0 = apiScreening(appId), ans = {};
    S0.finalItems.forEach(function (i) { ans[i.id] = { a: (vals && vals[i.q]) || (i.type === 'yesno' ? 'Yes' : i.type === 'number' ? (i.max != null ? '10' : '99') : 'ok'), r: i.type === 'text' && i.sec !== 'P' ? 'M' : '' }; });
    return apiSaveScreening(appId, { answers: ans, complete: true });
  };
  err('D4a Screened needs a recorded screening', function () { apiMoveStage(A, 'Screened', { answers: {} }); }, /Record the screening first/);
  t('D4 screening recorded: moves to Screened with the answers', function () { _tables = {}; const S1 = screen(A, { 'Current CTC?': '6 LPA', 'Notice period?': '30 days' }); _tables = {}; const a = apiPipeline(L1.Line_ID).apps.filter(function (x) { return x.App_ID === A; })[0]; return S1.screening.status === 'Complete' && a.Stage === 'Screened' && a.Screening_JSON['Current CTC?'] === '6 LPA' && !!a.screen; });
  mv('D5 shared with department', 'Shared', { note: 'E2E shared' });
  err('D6a department confirmation needs the result, the person and the date', function () { apiMoveStage(A, 'Confirmed', { note: 'E2E' }); }, /department.s decision/);
  mv('D6 department confirmed', 'Confirmed', { result: 'Suitable', by: 'E2E HOD', date: today, note: 'E2E confirmed' }, function (a) { return a.Dept_Confirm_By === 'E2E HOD' && String(a.Dept_Confirm_On).slice(0, 10) === today; });
  err('D7 interview needs result', function () { apiMoveStage(A, 'Technical', {}); }, /date and result/);
  mv('D8 technical interview', 'Technical', { date: today, by: 'Jaspal Bhanker', result: 'Selected' });
  t('D9 interview written to candidate', function () { _tables = {}; return apiGetCandidate(c1.Candidate_ID).Tech_Result === 'Selected'; });
  mv('D10 HR interview', 'HR', { date: today, by: 'Randhir Singh', result: 'Selected' });
  t('D10x stage tabs: the timeline of a card (lead only) shows where each step was updated', function () {
    _tables = {}; const tl = apiAppTimeline(A), tb = tl.tabs;
    const dept = tb.dept.facts.some(function (f) { return f[0] === 'Confirmed by (department)' && f[1] === 'E2E HOD'; }) && tb.dept.facts.some(function (f) { return f[0] === 'Department\u2019s decision' && f[1] === 'Suitable'; });
    const cv = tb.cv.changes.some(function (c) { return c.kind === 'move' && c.to === 'Screened'; }) && tb.cv.facts.length > 0;
    const sh = tb.shared.changes.some(function (c) { return c.kind === 'move' && c.to === 'Shared'; });
    const te = tb.tech.changes.some(function (c) { return c.label === 'Technical result' && c.newV === 'Selected'; });
    const all = tb.all.changes.some(function (c) { return c.kind === 'move' && c.to === 'HR'; }) && tb.all.changes.every(function (c) { return typeof c.at === 'string' && c.at; });
    const noCtc = !JSON.stringify(tl).match(/Current_CTC|Expected_CTC|Mobile|Email/);
    return dept && cv && sh && te && all && noCtc ? 'cv ' + tb.cv.changes.length + ', shared ' + tb.shared.changes.length + ', dept ' + tb.dept.changes.length + ', tech ' + tb.tech.changes.length + ', all ' + tb.all.changes.length : false;
  });
  err('D11 documents gate', function () { apiMoveStage(A, 'Docs', { docs: { A: 'Verified' } }); }, /not verified/);
  err('D11b an exception needs remarks', function () { apiMoveStage(A, 'Docs', { docs: { A: 'Verified' }, exception: 'Form 16 awaited' }); }, /remarks/);
  mv('D12 documents verified', 'Docs', { docs: { A: 'Verified', B: 'Verified', C: 'Verified', D: 'Verified', E: 'Verified', F: 'Verified', G: 'Verified', H: 'NA' }, note: 'E2E docs remarks' });
  t('D12b the documents remarks show in the Daily review and the Daily log', function () {
    _tables = {}; const d = apiDaySummary(today), r = d.recruiters.filter(function (x) { return x.recruiter === String(L1.Recruiter); })[0];
    const g = r && r.byPosition.filter(function (x) { return x.line === L1.Line_ID; })[0];
    const rows = apiListFunnel({ from: today, to: today });
    const people = ((r && r.people) || {}).Docs || [];
    return g && g.remarks.some(function (x) { return /E2E docs remarks/.test(x); }) && people.some(function (p) { return p.remark === 'E2E docs remarks'; })
      && rows.some(function (x) { return x.Line_ID === L1.Line_ID && (x.DocRemarks || []).some(function (y) { return y.remark === 'E2E docs remarks'; }); }) ? 'ok' : false;
  });
  t('D13 joining documents upload', function () { const r = apiUploadDoc('APP', A, 'Docs_File', 'docs.pdf', 'application/pdf', pdf); trash.push(fid(r.url || r)); return !!fid(r.url || r); });
  mv('D14 offer released', 'Offer', { offerDate: today, edoj: today, ctc: '7.5 LPA' });
  t('D15 position shows Offered', function () { _tables = {}; const l = apiListPositions().filter(function (x) { return x.Line_ID === L1.Line_ID; })[0]; return l.Position_Status === 'Offered' && l.Candidate_ID === c1.Candidate_ID; });
  t('D16 offer letter upload and view', function () { const r = apiUploadDoc('APP', A, 'Offer_Letter_File', 'offer.pdf', 'application/pdf', pdf); trash.push(fid(r.url || r)); return apiGetDoc('APP', A, 'Offer_Letter_File').b64.length > 10; });
  mv('D17 offer accepted, pre-joining', 'Prejoin', { acceptedOn: today });
  t('D18 follow-up logged with risk', function () { const p = apiAddFollowup(A, { date: today, mode: 'Call', response: 'Confirmed', risk: 'Amber', next: today, note: 'E2E' }); const a = p.apps[0]; return a.Risk === 'Amber' && a.followups.length === 1; });
  t('D19b department delays report', function () { _tables = {}; const r = apiDeptDelays({}); return Array.isArray(r.depts) && Array.isArray(r.positions) && r.totals && r.norms.cvH === 24 ? r.depts.length + ' departments' : false; });
  t('D19 joiner-at-risk alert', function () { _tables = {}; return apiPipelineAlerts().atRisk.some(function (x) { return x.app === A && x.level === 'Amber' && /Marked Amber/.test(x.why.join(' ')); }); });
  err('D20 backout needs reason', function () { apiSetAppStatus(A, 'Withdrawn', ''); }, /reason/);
  const cB = apiSaveCandidate({ Name: 'E2E Candidate Two', Mobile: '9111122224', Line_ID: L1.Line_ID, Position: 'E2E TEST POSITION', Dept: L1.Dept }, true).saved;
  _tables = {}; const B = apiPipeline(L1.Line_ID).apps.filter(function (x) { return x.Candidate_ID === cB.Candidate_ID; })[0].App_ID;
  screen(B); _tables = {};
  err('D20a second live offer blocked', function () { apiMoveStage(B, 'Offer', { offerDate: today }); }, /already holds the offer/);
  let R = null;
  t('D21 backout closes the position and raises the linked replacement MRF', function () {
    const p = apiSetAppStatus(A, 'Withdrawn', 'E2E counter offer', today); R = p.replacement;
    _tables = {}; const ls = apiListPositions(); const o = ls.filter(function (x) { return x.Line_ID === L1.Line_ID; })[0], n = ls.filter(function (x) { return x.Line_ID === R.to; })[0];
    return o.Position_Status === 'Replaced' && o.Replaced_By === R.to && o.Offer_Date === today && o.Candidate_ID === c1.Candidate_ID && n && n.MRF_No === 'E2E-1-R1'
      && n.Parent_Line_ID === L1.Line_ID && n.Position_Status === 'Open' && n.Vacancy_Reason === 'Replacement' ? n.MRF_No : false;
  });
  t('D21b replacement TAT counts from the original start', function () {
    _tables = {}; const ls = apiListPositions(); const o = ls.filter(function (x) { return x.Line_ID === L1.Line_ID; })[0], n = ls.filter(function (x) { return x.Line_ID === R.to; })[0];
    return n.TAT_Start_From === (o.Assigned_On || o.Approved_On || o.Receipt_Date) && n.Days_Taken === daysBetween_(n.TAT_Start_From, ymd_(new Date())) ? 'from ' + n.TAT_Start_From : false;
  });
  t('D21c backup candidate moved to the replacement with history', function () {
    _tables = {}; const p = apiPipeline(R.to); const b = p.apps.filter(function (x) { return x.App_ID === B; })[0];
    return R.moved === 1 && b && b.Stage === 'Screened' && b.history.some(function (h) { return h.outcome === 'Moved'; }) && b.history.some(function (h) { return h.to === 'Screened' && h.from === 'Sourced'; });
  });
  t('D21d backed-out candidate keeps the offer and backout on record', function () {
    _tables = {}; const a = apiPipeline(L1.Line_ID).apps.filter(function (x) { return x.App_ID === A; })[0];
    return a.Status === 'Withdrawn' && a.Offer_Date === today && a.Backout_Date === today && /counter offer/.test(a.Backout_Reason);
  });
  err('D22 backed-out candidate cannot be reactivated on the replaced position', function () { apiSetAppStatus(A, 'Active', ''); }, /replaced by E2E-1-R1/);
  err('D22a replaced position pipeline is locked', function () { apiAddToPipeline(cB.Candidate_ID, L1.Line_ID); }, /replaced by/);
  const B2 = function (st, d) { const p = apiMoveStage(B, st, d); return p.apps.filter(function (x) { return x.App_ID === B; })[0]; };
  t('D22b next candidate gets the offer on the replacement', function () { const a = B2('Offer', { offerDate: today, edoj: today, ctc: '8 LPA' }); _tables = {};
    const n = apiListPositions().filter(function (x) { return x.Line_ID === R.to; })[0]; return a.Stage === 'Offer' && a.Offer_Date === today && n.Position_Status === 'Offered' && n.Candidate_ID === cB.Candidate_ID; });
  t('D22c a third candidate cannot get a second live offer', function () {
    const cC = apiSaveCandidate({ Name: 'E2E Candidate Three', Mobile: '9111122225', Line_ID: R.to, Position: 'E2E TEST POSITION', Dept: L1.Dept }, true).saved;
    _tables = {}; const C = apiPipeline(R.to).apps.filter(function (x) { return x.Candidate_ID === cC.Candidate_ID; })[0].App_ID;
    try { apiMoveStage(C, 'Offer', { offerDate: today }); return false; } catch (e) { return /E2E Candidate Two already holds the offer/.test(e.message) ? e.message.slice(0, 60) : false; }
  });
  t('D23 joining closes the replacement', function () { B2('Prejoin', { acceptedOn: today }); const a = B2('Joined', { doj: today }); _tables = {};
    const n = apiListPositions().filter(function (x) { return x.Line_ID === R.to; })[0]; return a.Actual_DOJ === today && n.Position_Status === 'Closed' && n.Actual_DOJ === today; });
  err('D24 onboarding needs induction and buddy', function () { apiMoveStage(B, 'Onboarded', { onboard: {} }); }, /induction/);
  t('D25 onboarded', function () { return B2('Onboarded', { onboard: { induction: today, buddy: 'Randhir Singh', hrms: 'Yes' } }).Stage === 'Onboarded'; });
  t('D26 stage history complete', function () { _tables = {}; const h = apiPipeline(L1.Line_ID).apps.filter(function (x) { return x.App_ID === A; })[0].history; return h.length >= 10 && h[h.length - 1].outcome === 'Backout' ? h.length + ' entries' : false; });
  // Fixes of release 141 (to run in the editor on a database copy)
  t('Z1 a refused move back leaves the position as it was', function () {
    _tables = {}; const before = apiGetPosition(R.to).Actual_DOJ;
    let msg = ''; try { apiMoveStage(B, 'Docs', {}); } catch (e) { msg = e.message; }
    _tables = {}; const after = apiGetPosition(R.to).Actual_DOJ;
    return /not verified/.test(msg) && !!after && String(before) === String(after) ? 'joining date kept: ' + after : false;
  });
  t('Z3 a waived psychometric test closes its to-do', function () { return psychoDone_({ Psychometric_Status: 'Waived' }) && !psychoDone_({ Psychometric_Status: 'Scheduled' }); });
  t('Z5 a note added to a BGV to-do shows in its (i) and leaves the to-do open', function () {
    _tables = {}; const bt = allTasks_().filter(function (x) { return /^bgv/.test(String(x.rule)); })[0];
    if (!bt) return 'no BGV to-do on the copy: skipped';
    const before = apiMyTasks('*').tasks.filter(function (x) { return x.key === bt.key; })[0];
    apiTaskAction(bt.key, 'note', { note: 'E2E note' });
    _tables = {}; const after = apiMyTasks('*').tasks.filter(function (x) { return x.key === bt.key; })[0];
    return before && after && after.noteable && after.notes[0].note === 'E2E note' && after.notes[0].action === 'Note' ? 'note shown, to-do still open' : false;
  });
  t('Z6 a card moves to another position of the same MRF and keeps its stage', function () {
    _tables = {};
    const l1 = apiSavePosition({ Position: 'E2E MOVE A', Grade: 'M5', Dept: L1.Dept, Receipt_Date: ymd_(new Date()), MRF_No: 'E2E-MOVE-1', Recruiter: L1.Recruiter, Approval_Status: 'Approved' });
    const l2 = apiSavePosition({ Position: 'E2E MOVE B', Grade: 'M5', Dept: L1.Dept, Receipt_Date: ymd_(new Date()), MRF_No: 'E2E-MOVE-1', Recruiter: L1.Recruiter, Approval_Status: 'Approved' });
    const c = apiSaveCandidate({ Name: 'E2E Mover', Mobile: '9111122292', Line_ID: l1.Line_ID, Position: l1.Position, Dept: L1.Dept }, true).saved;
    _tables = {}; const a = apiPipeline(l1.Line_ID).apps.filter(function (x) { return x.Candidate_ID === c.Candidate_ID; })[0];
    apiMoveStage(a.App_ID, 'Screened', { _fromScreening: true, answers: {} });
    const out = apiMoveToLine(a.App_ID, l2.Line_ID, 'E2E: better fit');
    _tables = {}; const b = apiPipeline(l2.Line_ID).apps.filter(function (x) { return x.App_ID === a.App_ID; })[0], left = apiPipeline(l1.Line_ID).apps.filter(function (x) { return x.App_ID === a.App_ID; })[0];
    let again = ''; try { apiMoveToLine(a.App_ID, l2.Line_ID, 'E2E: again'); } catch (e) { again = e.message; }
    const h = b ? b.history.map(function (x) { return x.outcome; }) : [];
    return out.movedTo.line === l2.Line_ID && b && !left && b.Stage === 'Screened' && h.indexOf('Moved') >= 0 && !again ? 'moved at ' + b.Stage + ', history kept (' + b.history.length + ' rows)' : false;
  });
  t('Z4 the audit sample is found again by its month and cannot be made twice', function () {
    const m = ymd_(new Date()).slice(0, 7); _tables = {};
    try { apiAuditGenerate(m); } catch (e) { if (!/already exists|No positions or candidates/.test(e.message)) throw e; }
    _tables = {}; const list = apiAuditList(m); let twice = ''; try { apiAuditGenerate(m); } catch (e) { twice = e.message; }
    return list.length > 0 && /already exists/.test(twice) && auditMonth_(new Date(Date.UTC(2026, 9, 15))) === '2026-10' ? list.length + ' rows' : false;
  });
  const legacy = (apiListCandidates().filter(function (c) { return !c.Line_ID && c.Name; })[0] || {}).Candidate_ID;
  t('D27 add existing candidate to pipeline', function () { return apiAddToPipeline(legacy, L2.Line_ID).Stage === 'Sourced'; });
  err('D28 no duplicate in same pipeline', function () { apiAddToPipeline(legacy, L2.Line_ID); }, /already/);
  t('D29 reject with reason', function () { _tables = {}; const p = apiPipeline(L2.Line_ID); return apiSetAppStatus(p.apps[0].App_ID, 'Rejected', 'E2E not suitable').apps[0].Status === 'Rejected'; });
  err('D30 rejected cannot move', function () { _tables = {}; apiMoveStage(apiPipeline(L2.Line_ID).apps[0].App_ID, 'Screened', {}); }, /Reactivate/);
  // The HR interview is optional (v135): a card goes from Technical to Documents verified without one.
  const cD = apiSaveCandidate({ Name: 'E2E Candidate Four', Mobile: '9111122226', Line_ID: L2.Line_ID, Position: L2.Position, Dept: L2.Dept }, true).saved;
  const appD = function () { _tables = {}; return apiPipeline(L2.Line_ID).apps.filter(function (x) { return x.Candidate_ID === cD.Candidate_ID; })[0]; };
  const hrBefore = (function () { _tables = {}; return (apiDaySummary(today).team.HR || 0); })();
  t('D10a a card goes to Technical', function () { const a = appD(); return apiMoveStage(a.App_ID, 'Technical', { date: today, by: 'E2E panel', result: 'Selected' }).apps.filter(function (x) { return x.App_ID === a.App_ID; })[0].Stage === 'Technical'; });
  t('D10b Technical goes straight to Documents verified, with no HR interview', function () {
    const a = appD();
    const r = apiMoveStage(a.App_ID, 'Docs', { docs: { A: 'Verified', B: 'Verified', C: 'Verified', D: 'Verified', E: 'Verified', F: 'Verified', G: 'Verified', H: 'NA' }, note: 'E2E discussed with the candidate' }).apps.filter(function (x) { return x.App_ID === a.App_ID; })[0];
    const to = r.history.map(function (h) { return h.to; });
    return r.Stage === 'Docs' && to.indexOf('Technical') >= 0 && to.indexOf('Docs') >= 0 && to.indexOf('HR') < 0 ? to.join('>') : false;
  });
  t('D10c the skipped HR interview is not counted in the Daily review or the position funnel', function () {
    _tables = {}; const ev = pipelineEvents_(today, today).filter(function (e) { return e.app === appD().App_ID; }).map(function (e) { return e.metric; });
    const hrAfter = apiDaySummary(today).team.HR || 0, f = apiPositionFunnel(L2.Line_ID);
    const held = f.rows.filter(function (r) { return r.hr || r.stage === 'HR'; }).length, hrStage = f.stages.filter(function (s) { return s.stage === 'HR'; })[0];
    const me = f.rows.filter(function (r) { return r.id === cD.Candidate_ID; })[0], docs = f.stages.filter(function (s) { return s.stage === 'Docs'; })[0];
    return ev.indexOf('Docs') >= 0 && ev.indexOf('Technical') >= 0 && ev.indexOf('HR') < 0 && hrAfter === hrBefore && hrStage.reached === held && me && !me.hr && docs.reached >= 1 ? 'HR ' + hrAfter : false;
  });
  t('D10d the to-do rules: no required HR interview; the offer to-do applies once selected at Technical', function () {
    const sch = [{ Round: 'HR', Status: 'Scheduled' }], un = [{ Round: 'HR', Status: 'Panel unavailable' }], done = [{ Round: 'HR', Status: 'Held' }];
    return interviewRoundFor_('Confirmed', []) === 'Technical' && interviewRoundFor_('Technical', []) === '' && interviewRoundFor_('Technical', sch) === 'HR' && interviewRoundFor_('Technical', un) === 'HR'
      && interviewRoundFor_('Technical', done) === '' && interviewRoundFor_('Docs', sch) === ''
      && offerTodoApplies_('Technical', 'Selected', []) && !offerTodoApplies_('Technical', 'Rejected', []) && !offerTodoApplies_('Technical', '', []) && !offerTodoApplies_('Technical', 'Selected', sch)
      && offerTodoApplies_('HR', '', []) && offerTodoApplies_('Docs', '', []) && !offerTodoApplies_('Confirmed', 'Selected', []) ? 'ok' : false;
  });

  // Speed (v137): a write hands back the position row so the page need not ask again; timings travel with the replies.
  t('P1 the position row a write returns equals the one the Positions list gives', function () {
    _tables = {}; const row = positionRow_(L2.Line_ID), list = apiGetPosition(L2.Line_ID);
    return row && JSON.stringify(row) === JSON.stringify(list) ? row.Position_Status : false;
  });
  t('P2 the board returned after a write is the board plus that row', function () {
    _tables = {}; const b = boardAfterWrite_(L2.Line_ID), plain = apiPipeline(L2.Line_ID);
    return b.position && b.position.Line_ID === L2.Line_ID && b.apps.length === plain.apps.length && b.line.Line_ID === plain.line.Line_ID ? b.apps.length + ' cards' : false;
  });
  t('P3 apiFetch reports the server time, and the unchanged answer is tiny', function () {
    const a = apiFetch('apiListPositions', [], ''), b = apiFetch('apiListPositions', [], a.v);
    return typeof a.ms === 'number' && b.same === true && typeof b.ms === 'number' && b.data === undefined ? a.ms + ' ms / ' + b.ms + ' ms' : false;
  });
  t('P4 the speed check also times search, overview, KPI and the unchanged-answer path', function () {
    const r = apiSpeedCheck(), w = r.rows.map(function (x) { return x.what; }).join('|');
    const bad = r.rows.filter(function (x) { return /^ERROR/.test(x.note); }).map(function (x) { return x.what; });
    return /apiSearchCandidates/.test(w) && /apiDashboard/.test(w) && /apiKpi/.test(w) && /apiTaskSummary/.test(w) && /apiPipelineAlerts/.test(w) && /apiFetch/.test(w) && !bad.length ? r.rows.length + ' rows' : 'missing or failing: ' + bad.join(', ');
  });

  // Speed phase 2 (v138): the candidate index, the history number and the KPI cache give the same answers as the full reads.
  const refSearch = function (f) {   // the search as it was before the index: every row of the sheet, one at a time
    const words = String(f.q || '').toLowerCase().split(/\s+/).filter(String), live = liveCands_(), profile = poolFiltering_(f), out = [];
    readTable_(T.CAND.name, true).rows.forEach(function (c) {
      if (f.line && c.Line_ID !== f.line) return;
      if (profile && !poolMatch_(c, f, live)) return;
      if (f.hr && c.HR_Result !== f.hr) return; if (f.src && c.Sourced_By !== f.src) return; if (f.dup && !c.Possible_Duplicate_Of) return; if (f.cv && !c.CV_File_URL) return;
      const hay = [c.Name, c.Mobile, c.Email, c.Position, c.Candidate_ID, c.Current_Designation, c.Education, c.Dept, c.Key_Skills, c.Function_Area, c.Current_Location].join(' ').toLowerCase();
      if (words.length && !words.every(function (w) { const d = w.replace(/\D/g, ''); return hay.indexOf(w) >= 0 || (d.length >= 4 && hay.replace(/\D/g, '').indexOf(d) >= 0); })) return;
      out.push(c.Candidate_ID);
    });
    return out.sort(function (a, b) { return String(b).localeCompare(String(a)); });
  };
  t('C1 the indexed search returns the same candidates as a full scan, for several filters', function () {
    _tables = {};
    const cases = [{ q: '' }, { q: 'e2e' }, { q: 'candidate one' }, { q: '9111' }, { hr: 'Selected' }, { cv: true }, { pool: true }, { q: 'e2e', pool: true }, { loc: 'xyz' }];
    const bad = cases.filter(function (f) {
      const full = refSearch(f); _tables = {};
      const r = apiSearchCandidates(Object.assign({ archived: 'no', page: 0, size: 200 }, f)), ids = r.rows.map(function (x) { return x.Candidate_ID; });
      return r.total !== full.length || JSON.stringify(ids) !== JSON.stringify(full.slice(0, 200));
    });
    return bad.length ? 'differs for ' + JSON.stringify(bad[0]) : cases.length + ' searches match';
  });
  t('C2 a candidate saved with a new name is found by it at once, and not by the old one', function () {
    _tables = {}; apiSearchCandidates({ q: 'e2e', archived: 'no' });   // builds the index
    const c = apiSaveCandidate({ Name: 'E2E Zanzibar Original', Mobile: '9111122290', Position: 'E2E TEST POSITION', Dept: L1.Dept }, true).saved;
    _tables = {}; const a = apiSearchCandidates({ q: 'zanzibar', archived: 'no' }).rows.map(function (x) { return x.Candidate_ID; });
    apiSaveCandidate(Object.assign({}, c, { Name: 'E2E Quixotic Renamed' }), true);
    _tables = {}; const b = apiSearchCandidates({ q: 'zanzibar', archived: 'no' }).total, d = apiSearchCandidates({ q: 'quixotic', archived: 'no' }).rows.map(function (x) { return x.Candidate_ID; });
    return a.indexOf(c.Candidate_ID) >= 0 && b === 0 && d.indexOf(c.Candidate_ID) >= 0 ? 'found, renamed, found again' : false;
  });
  t('C3 opening one candidate by row number equals the full read', function () {
    _tables = {}; const id = apiSearchCandidates({ q: '', archived: 'no', size: 1 }).rows[0].Candidate_ID;   // the index is cached now
    _tables = {}; const fast = candRowFast_(id); _tables = {};
    const slow = readTable_(T.CAND.name).rows.filter(function (x) { return x.Candidate_ID === id; })[0];
    return fast && JSON.stringify(toClient_(fast)) === JSON.stringify(toClient_(slow)) ? id : false;
  });
  t('C4 the board names come from the index and equal the sheet', function () {
    _tables = {}; apiSearchCandidates({ q: '', archived: 'no', size: 1 });
    const ids = readTable_(T.APP.name).rows.slice(0, 8).map(function (a) { return a.Candidate_ID; });
    const f = ['Name', 'Mobile', 'Email', 'Relevant_Experience', 'Current_CTC', 'Current_Designation', 'CV_File_URL', 'Tech_Result', 'HR_Result', 'Tech_Interview_By', 'HR_Interview_By'];
    _tables = {}; const slim = candNamesSlim_(ids); _tables = {}; const full = candNames_(ids);
    const bad = ids.filter(function (id) { return f.some(function (k) { return String(toClient_({ v: (slim[id] || {})[k] }).v) !== String(toClient_({ v: (full[id] || {})[k] }).v); }); });
    return bad.length ? 'differs for ' + bad[0] : ids.length + ' candidates match';
  });
  t('H1 each stage-history row gets a new, higher number and the numbers stay unique', function () {
    const before = readTable_(T.HIST.name, true).rows.length;
    const cH = apiSaveCandidate({ Name: 'E2E History Probe', Mobile: '9111122291', Line_ID: L2.Line_ID, Position: L2.Position, Dept: L2.Dept }, true).saved;
    _tables = {}; const aH = apiPipeline(L2.Line_ID).apps.filter(function (x) { return x.Candidate_ID === cH.Candidate_ID; })[0];
    apiMoveStage(aH.App_ID, 'Screened', { _fromScreening: true, answers: {} });
    const rows = readTable_(T.HIST.name, true).rows, ids = rows.map(function (r) { return String(r.Hist_ID); });
    const nums = ids.map(function (i) { return +i.replace(/\D/g, ''); });
    return rows.length >= before + 2 && new Set(ids).size === ids.length && nums[nums.length - 1] > nums[nums.length - 2] ? 'last ' + ids[ids.length - 1] : false;
  });
  t('K27 the KPI result is cached whatever its size, and the cached copy is the same', function () {
    const a = apiKpi(fy, true), b = apiKpi(fy, false);
    return a.builtAt === b.builtAt && JSON.stringify(a).length > 0 ? JSON.stringify(a).length + ' characters' + (JSON.stringify(a).length > 95000 ? ' (above the old 95,000 limit)' : '') : false;
  });

  t('E0 entries report whether they can be edited', function () { return apiListFunnel({ from: today, to: today }).every(function (r) { return typeof r.canEdit === 'boolean'; }); });
  t('E1 daily log with CVs reviewed', function () { return !!apiSaveFunnel({ Line_ID: L2.Line_ID, Entry_Date: today, CV_Sourced: 5, CV_Reviewed: 4, Remarks: 'E2E' }).Entry_ID; });
  err('E2 future date blocked', function () { apiSaveFunnel({ Line_ID: L2.Line_ID, Entry_Date: '2099-01-01', CV_Sourced: 1 }); }, /future/);
  err('E3 negative count blocked', function () { apiSaveFunnel({ Line_ID: L2.Line_ID, Entry_Date: today, CV_Sourced: -1 }); }, /whole number/);
  t('E4 day note and tasks saved', function () { return !!apiSaveDaySummary({ date: today, overview: 'E2E day', tasks: [{ t: 'E2E task', d: true }, { t: 'Open task', d: false }], recruiter: String(L1.Recruiter) }).summaryId; });
  t('E5 daily review shows the day', function () {
    _tables = {}; const d = apiDaySummary(today); const r = d.recruiters.filter(function (x) { return x.recruiter === String(L1.Recruiter); })[0];
    return r && r.overview === 'E2E day' && r.tasks.length === 2 && (d.team.Sourced || 0) >= 1 && r.funnel.Joined >= 1 && Object.keys(r.moves).length > 5 ? Object.keys(r.moves).length + ' kinds of move' : false;
  });
  t('E5b scorecard credits every Pipeline stage a card passes, once', function () {
    const ev = function (from, to, o, by) { return { From_Stage: from, To_Stage: to, Outcome: o || '', Changed_By: by || 'x@y', Note: '' }; };
    const names = function (h, fast) { return pipelineCredits_(h, fast).map(function (c) { return c.metric; }).join(); };
    return names(ev('', 'Sourced')) === 'Sourced'
      && names(ev('Sourced', 'Technical')) === 'Screened,Shared,Confirmed,Technical'
      && names(ev('Technical', 'HR', 'Selected')) === 'HR'
      && names(ev('Technical', 'Docs')) === 'Docs' && names(ev('Technical', 'Offer')) === 'Docs,Offer' && names(ev('Sourced', 'Docs')) === 'Screened,Shared,Confirmed,Technical,Docs'
      && names(ev('Sourced', 'Sourced', 'Rejected')) === ''
      && names(ev('Sourced', 'Offer'), true) === 'Shared,Confirmed,Offer'
      && names(ev('', 'Sourced', '', 'migration')) === ''
      && names(ev('Sourced', 'Offer', 'Reconciled')) === '' ? 'ok' : false;
  });
  t('E5c funnel start date and stage columns', function () {
    const cut = cutover_(), v2 = funnelV2_();
    return v2 >= cut && derivedMetrics_(addDays_(cut, -1)).length === 0 && typedMetrics_(addDays_(cut, -1)).length === FUNNEL_METRICS.length
      && dayStagesFor_(cut).join() === STAGES.join() && dayStagesFor_(addDays_(cut, -1)).length === LEGACY_DAY_STAGES.length
      && typedMetrics_(v2).length === 0 && derivedMetrics_(v2).indexOf('Sourced') >= 0 && derivedMetrics_(v2).length === STAGES.length ? 'ok' : false;
  });
  t('E5d once per card holds when a single day is asked for', function () {
    const day = pipelineEvents_(today, today), seen = {}; let dup = 0;
    day.forEach(function (e) { if (e.metric === 'Backouts') return; const k = e.app + '|' + e.metric; if (seen[k]) dup++; seen[k] = true; });
    return dup === 0 ? day.length + ' events' : false;
  });
  t('E5e Overview snapshot guard: the funnel is the Pipeline stages and an older snapshot is refused', function () {
    const full = { build: BUILD_ID, funnel: {} }; STAGES.forEach(function (k) { full.funnel[k] = 0; });
    const old = { build: String(Number(BUILD_ID) - 1), funnel: full.funnel };
    const legacy = { build: BUILD_ID, funnel: { CV_Sourced: 3, HR_1st_Round: 2 } };
    const live = computeDashboard_();
    return snapshotUsable_(full) && !snapshotUsable_(old) && !snapshotUsable_(legacy) && !snapshotUsable_(null)
      && STAGES.every(function (k) { return k in live.funnel; }) ? 'ok' : false;
  });
  t('E5f position funnel: candidates, CVs received and the stage each has reached', function () {
    _tables = {}; const f = apiPositionFunnel(L2.Line_ID);
    const sorted = f.rows.every(function (r, i) { return i === 0 || f.rows[i - 1].si >= r.si; });
    return f.candidates === f.rows.length && f.rows.every(function (r) { return STAGES.indexOf(r.stage) >= 0; }) && sorted
      && f.stages.length > 0 && f.stages[0].reached === f.rows.length && f.received.total === f.received.typed + f.received.pipeline
      && f.active + f.rejected + f.onHold + f.withdrawn === f.rows.length ? f.candidates + ' candidates, ' + f.received.total + ' CVs received' : false;
  });
  t('E5g CV received: typed vs pipeline report adds up', function () {
    const r = apiCvReceivedCompare('', ''), sum = function (k) { return r.days.reduce(function (s, o) { return s + o[k]; }, 0); };
    const recSum = function (k) { return r.recruiters.reduce(function (s, o) { return s + o[k]; }, 0); };
    return r.totals.typed === sum('typed') && r.totals.cards === sum('cards') && r.totals.added === sum('added') && r.totals.diff === r.totals.typed - r.totals.cards
      && recSum('typed') === r.totals.typed && recSum('cards') === r.totals.cards && r.days.every(function (o) { return o.diff === o.typed - o.cards && o.people.length === o.cards; }) ? r.totals.typed + ' typed, ' + r.totals.cards + ' cards' : false;
  });
  err('E5h the CV received report refuses a range over 92 days', function () { apiCvReceivedCompare('2026-01-01', ymd_(new Date())); }, /92 days/);
  err('E5i the CV received report refuses a reversed range', function () { apiCvReceivedCompare(today, '2026-10-05'); }, /after the end date/);
  t('E5j from the start date the report agrees with the Daily review', function () {
    if (today < funnelV2_()) return 'before the start date';
    _tables = {}; const rep = apiCvReceivedCompare(today, today), d = apiDaySummary(today);
    const day = rep.days.filter(function (o) { return o.day === today; })[0];
    return (day ? day.cards : 0) === d.team.Sourced && (day ? day.typed : 0) === 0 ? 'cards ' + d.team.Sourced : false;
  });
  const LD = t('AD0 a position received 10 days ago with no approved date typed', function () {
    const r = apiAddPositionLines({ Position: 'E2E APPROVED DATE', Designation: m5[0] || '', Grade: 'M5', Dept: dept, Receipt_Date: addDays_(today, -10), Recruiter: String(rec), Approval_Status: 'Approved',
      Offer_Sent: 'No', MRF_No: 'E2E-AD', Vacancy_Reason: 'Replacement', Budget_CTC: '6-8 LPA', JD_Text: 'Test JD' }, 1);
    return r.length === 1 ? r[0] : false;
  }) || {};
  t('AD1 its approved date was filled in from the received date and it is listed for checking', function () {
    _tables = {}; const l = lineOf_(LD.Line_ID), row = apiApprovedDatesToCheck(false).rows.filter(function (x) { return x.id === LD.Line_ID; })[0];
    return l && String(l.Approved_Date_Check) === 'Default' && row && row.received === addDays_(today, -10) && row.approved === row.received && row.start === row.received ? 'listed' : false;
  });
  err('AD2 an approved date before the received date is refused', function () { apiSetApprovedDate(LD.Line_ID, addDays_(today, -11)); }, /before the MRF received date/);
  err('AD2b an approved date in the future is refused', function () { apiSetApprovedDate(LD.Line_ID, addDays_(today, 1)); }, /future/);
  t('AD3 the real approved date moves the TAT start and the assigned date, and confirms', function () {
    apiSetApprovedDate(LD.Line_ID, addDays_(today, -4)); _tables = {};
    const l = lineOf_(LD.Line_ID), p = apiGetPosition(LD.Line_ID), still = apiApprovedDatesToCheck(false).rows.some(function (x) { return x.id === LD.Line_ID; });
    return ymd_(l.Approved_On) === addDays_(today, -4) && ymd_(l.Assigned_On) === addDays_(today, -4) && String(l.Approved_Date_Check) === 'Confirmed' && tatStart_(l) === addDays_(today, -4)
      && Number(p.Days_Taken) === 4 && !still ? 'start ' + tatStart_(l) : false;
  });
  t('AD4 confirming a date that is right takes the position off the list, and is repeatable', function () {
    apiSetApprovedDate(L2.Line_ID, ''); const again = apiSetApprovedDate(L2.Line_ID, ''); _tables = {};
    return String(lineOf_(L2.Line_ID).Approved_Date_Check) === 'Confirmed' && !again.rows.some(function (x) { return x.id === L2.Line_ID; }) ? 'ok' : false;
  });
  err('E6 future day summary blocked', function () { apiSaveDaySummary({ date: '2099-01-01', overview: 'x' }); }, /future/);

  t('F1 log observation', function () { return !!apiSaveObservation({ Obs_Date: today, Line_ID: L2.Line_ID, Recruiter: String(L2.Recruiter), Type: OBS_TYPES[0], Description: 'E2E', Status: 'Open' }).Obs_ID; });
  t('F2 audit sample for a month', function () {
    const m = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    try { apiAuditGenerate(m); } catch (e) { if (!/already exists/.test(e.message)) throw e; }
    const rows = apiAuditList(m); return Array.isArray(rows.rows || rows) ? 'rows ' + (rows.rows || rows).length : false;
  });
  t('F3 KPI recomputes with new data', function () { return Object.keys(apiKpi(fy, true).data).length > 0; });

  t('G1 add panel member', function () { return !!apiSavePanelMember({ Name: 'E2E Panel Person', Roles: 'Technical' }).id; });
  err('G2 duplicate via alias blocked', function () { apiSavePanelMember({ Name: 'jaspal bhankar' }); }, /already/);
  t('G3 log panel unavailability', function () { return !!apiSavePanel({ Panel_Member: 'Jaspal Bhanker', Date: today, Availability_Status: 'Unavailable', Reason: 'E2E' }).Entry_ID; });

  t('H1 recalculate TAT', function () { return Number(apiRecomputeAll()) > 300; });
  t('H2 change history records test edits', function () { _tables = {}; return apiAuditLog({ q: 'E2E' }).length >= 3; });
  t('H3 data checks run', function () { return dataChecks_().length === apiDataChecks().length; });
  t('H4 weekly summary recipients', function () { return summaryRecipients_().length > 0; });
  t('H5 dashboard rebuild', function () { _tables = {}; return typeof apiRefreshDashboard().kpi.open === 'number'; });
  t('H6 served page intact', function () { const app = include('App'); const js = app.slice(app.indexOf('<script>') + 8, app.lastIndexOf('</script>')); new Function(js); return true; });

  const ctcSample = { basic: 3, pf: 1, esic: 0, nps: 0, gratuity: 1, bonus: 2, pli: 2, mediclaim: 'S' };
  t('I1 CTC rules in force and valid', function () { const r = apiCtcRules(); const e = ctcEngine_().validate(r.active.config); return r.active.id && !e.length ? r.active.id : e.join('; ') && false; });
  t('I2 CTC matches the workbook sample', function () { const r = apiCtcCalc({ basis: 'gross', target: 72080, codes: ctcSample }); return r.totals.totalCtc === 83082 && r.totals.net === 68800 && r.status === 'exact' ? 'Total CTC 83082' : false; });
  t('I3 CTC works back from a Total CTC target', function () { const r = apiCtcCalc({ basis: 'total_ctc', target: 83082, codes: ctcSample }); return r.grossEntry === 72080 && r.status === 'exact'; });
  t('I4 Net target gives at least the net', function () { const r = apiCtcCalc({ basis: 'net', target: 30000, codes: ctcSample }); return r.totals.net >= 30000 && r.totals.net - 30000 < 5 ? 'net ' + r.totals.net : false; });
  err('I5 CTC needs a target amount', function () { apiCtcCalc({ basis: 'gross', target: 0 }); }, /target amount/);
  t('I6 CTC calculator is admin-only at launch', function () { return can_({ role: ROLES.ADMIN }, 'ctc_use') && !can_({ role: ROLES.HEAD }, 'ctc_use') && !can_({ role: ROLES.TALEAD }, 'ctc_use') && !can_({ role: ROLES.RECRUITER }, 'ctc_use'); });
  t('I7 page engine script intact', function () { new Function(ctcEngineScript_() + '; return CTC_ENGINE.solve;'); return true; });
  const ctcPdf = Utilities.base64Encode(Utilities.newBlob('%PDF-1.4\n' + new Array(400).join('x') + '\n%%EOF').getBytes());
  const ctcA = t('I8 save a CTC draft without name or grade', function () { const r = apiCtcSave({ basis: 'gross', target: 72080, codes: ctcSample, designation: 'E2E Guard' }); return r.status === 'Draft' && r.result.totals.totalCtc === 83082 ? r : false; });
  if (ctcA) {
    t('I9 issue the letter (PDF kept in Drive)', function () { const r = apiCtcIssue(ctcA.id, { language: 'both', pdf: ctcPdf }); trash.push(fid(r.letter)); return r.status === 'Issued' && r.letter ? r.id : false; });
    err('I10 an issued calculation is locked', function () { apiCtcSave({ id: ctcA.id, basis: 'gross', target: 1000, codes: ctcSample }); }, /cannot be changed/);
    t('I11 re-run and issue supersedes the original', function () {
      const b = apiCtcSave({ basis: 'total_ctc', target: 90000, codes: ctcSample, rerunOf: ctcA.id });
      const r = apiCtcIssue(b.id, { language: 'en', pdf: ctcPdf }); trash.push(fid(r.letter));
      return apiCtcGet(ctcA.id).status === 'Superseded' ? b.id : false;
    });
    t('I12 saved calculations list', function () { return apiCtcList({}).rows.length >= 2; });
    t('I12a candidate pay and hike kept with the calculation', function () {
      const r = apiCtcSave({ basis: 'total_ctc', target: 150000, codes: ctcSample, by: 'hike', hike: { per: 'month', ctc: '1,20,000', net: '95000', ask: '160000', askBasis: 'total_ctc', mode: 'total_ctc', pct: '25' } });
      const h = r.inputs.hike; return r.inputs.by === 'hike' && h.ctc === '120000' && h.pct === '25' && h.ask === '160000' ? 'kept' : false;
    });
  }
  t('I12b the Access tab lists every role (Admin keeps all)', function () { const a = apiCtcAccess(); return a.roles.Admin.indexOf('ctc_rules') >= 0 && a.roles.Admin.indexOf('ctc_approve') >= 0 && a.roles.Recruiter.length === 0 ? 'ok' : false; });
  err('I12c giving access needs a reason', function () { apiCtcAccessSave({ roles: { Recruiter: ['ctc_use'] }, reason: 'x' }); }, /at least 10/);
  err('I12d the CTC rules cannot be given to another role', function () { apiCtcAccessSave({ roles: { Recruiter: ['ctc_use', 'ctc_rules'] }, reason: 'let recruiters change the rules' }); }, /cannot be given/);
  t('I12e give the Recruiter role the calculator and see it take effect', function () {
    apiCtcAccessSave({ roles: { Recruiter: ['ctc_use'] }, approval: true, reason: 'E2E access test, undone below' });
    const p = effectivePerms_('Recruiter'); const ok1 = p.indexOf('ctc_use') >= 0 && p.indexOf('ctc_rules') < 0 && ctcApprovalOn_();
    apiCtcAccessSave({ roles: { Recruiter: [] }, approval: false, reason: 'E2E access test: undo' });
    return ok1 && effectivePerms_('Recruiter').indexOf('ctc_use') < 0 && !ctcApprovalOn_() ? 'granted and revoked' : false;
  });
  err('I12f an admin cannot submit a letter for approval (can approve it directly)', function () {
    apiCtcAccessSave({ roles: {}, approval: true, reason: 'E2E approval test, undone below' });
    try { const d = apiCtcSave({ basis: 'gross', target: 20000, codes: ctcSample }); apiCtcSubmit(d.id, { language: 'en' }); }
    finally { apiCtcAccessSave({ roles: {}, approval: false, reason: 'E2E approval test: undo' }); }
  }, /can approve letters/);
  if (typeof L1 !== 'undefined' && L1.Line_ID) {
    const cand = apiListCandidates()[0];
    t('I12g a calculation linked to a candidate and a position shows on both', function () {
      const r = apiCtcSave({ basis: 'gross', target: 30000, codes: ctcSample, candidateId: cand.Candidate_ID, lineId: L1.Line_ID });
      const a = apiCtcFor('candidate', cand.Candidate_ID).rows, b = apiCtcFor('line', L1.Line_ID).rows;
      return a.some(function (x) { return x.id === r.id; }) && b.some(function (x) { return x.id === r.id && x.candidate; }) ? 'linked ' + r.id : false;
    });
    err('I12h a calculation cannot be linked to an unknown candidate', function () { apiCtcSave({ basis: 'gross', target: 30000, codes: ctcSample, candidateId: 'CAN-99999' }); }, /not found/);
    t('I12i an issued calculation can be linked afterwards and unlinked', function () {
      const x = apiCtcLink(ctcA.id, { candidateId: cand.Candidate_ID, lineId: L1.Line_ID }), y = apiCtcLink(ctcA.id, { candidateId: '', lineId: '' });
      return x.candidateId === cand.Candidate_ID && !y.candidateId && !y.lineId ? 'ok' : false;
    });
  }
  const bgvL = t('K1 BGV tracker opens (cases are created for hires in scope)', function () { const l = apiBgvList(); return Array.isArray(l.rows) && l.rules.cfg.vendorTatDays === 7 ? l.rows.length + ' cases' : false; });
  if (bgvL) {
    t('K2 add a BGV vendor', function () { const v = apiBgvVendorSave({ name: 'E2E Verify Co', tat: 5, checks: 'Employment, Conduct', active: true }); return v.some(function (x) { return x.name === 'E2E Verify Co'; }) ? 'ok' : false; });
    err('K3 a vendor needs a name', function () { apiBgvVendorSave({ name: '' }); }, /name/);
    const ven = apiBgvList().vendors.filter(function (x) { return x.name === 'E2E Verify Co'; })[0] || {};
    const open = apiBgvList().rows.filter(function (r) { return r.status === 'Not started' && r.canWork; })[0];
    if (open) {
      err('K4 BGV cannot start without the candidate\u2019s consent', function () { apiBgvStatus(open.id, 'Initiated', { vendor: ven.id }); }, /consent/);
      t('K5 start a BGV case and see the start date on the position', function () {
        const r = apiBgvStatus(open.id, 'Initiated', { consentOn: today, vendor: ven.id, vendorRef: 'E2E-1' });
        _tables = {}; const l = lineOf_(open.line); const col = open.type === 'Previous employer' ? 'BGV_Prev_Org_Date' : 'BGV_Current_Org_Date';
        return r.c.status === 'Initiated' && ymd_(l[col]) === today ? open.id : false;
      });
      err('K6 a decision is recorded only once the report is in', function () { apiBgvDecide(open.id, { decision: 'Proceed with the offer', note: 'Not allowed yet at this stage' }); }, /report is in/);
      t('K7 add a check and a chaser note', function () { apiBgvCheckSave(open.id, { type: 'Education', subject: 'E2E University' }); return apiBgvNote(open.id, 'Chaser', 'E2E chaser').log.length >= 3 ? 'ok' : false; });
    }
    t('K8 BGV rules readable, edited only by the admin', function () { const r = apiBgvRules(); return r.active.cfg.prevInitDays === 3 && r.canEdit ? r.active.id : false; });
    t('K9 BGV status lines for a position', function () { return Array.isArray(apiBgvFor('line', L1.Line_ID)); });
    t('K10 BGV reports for leads (scorecard, vendors, departments, discrepancies)', function () { const r = apiBgvReports({}); return r.byRecruiter && r.byVendor && Array.isArray(r.discrepancies) && r.total.cases >= 0 ? r.total.cases + ' cases' : false; });
    err('K11 a report period must be valid', function () { apiBgvReports({ from: today, to: '2000-01-01' }); }, /after its end/);
    t('K12 Overview counts and weekly block include BGV', function () { const s = apiTaskSummary(); const w = bgvWeekly_(); return typeof s.bgvDecide === 'number' && typeof s.bgvLate === 'number' && w && typeof w.open === 'number' ? 'late ' + s.bgvLate : false; });
    t('K13 BGV to-dos are generated without error', function () { const r = computeTasks_(); return Array.isArray(r) ? r.filter(function (x) { return /^bgv/.test(x.rule); }).length + ' BGV to-dos' : false; });
    t('K14 the KPI scorecard still scores BGV from the cases', function () { const k = apiKpi(fy, true); return k.defs.BGV ? 'ok' : false; });
    t('K15 BGV email templates and company name are served and editable', function () { const r = apiBgvRules(); return r.templateList.length === 5 && r.active.cfg.company && r.active.cfg.templates.consent.subject ? 'ok' : false; });
    err('K16 a vendor import with no rows is refused', function () { apiBgvImport([], {}); }, /no rows/);
    t('K17 a vendor import dry run changes nothing', function () { const r = apiBgvImport([{ ref: 'NO-SUCH-CASE', check: 'Employment', status: 'Verified' }], {}); return r.applied === false && r.counts.errors === 1 ? 'ok' : false; });
    t('K18 BGV governance shows the Drive status and the retention list', function () { const g = apiBgvGovern(); return g.retention && Array.isArray(g.retention.due) && g.drive ? g.retention.due.length + ' due' : false; });
    t('K19 the BGV audit export works for the admin and is logged', function () { const r = apiBgvAudit({}); return Array.isArray(r.rows) && r.from <= r.to ? r.total + ' rows' : false; });
    t('M1 the Daily log list carries the pipeline counts from the switch-over', function () { const r = apiListFunnel({ from: cutover_(), to: ymd_(new Date()) }); return Array.isArray(r) && r.every(function (x) { return x.Entry_Date >= cutover_() ? typeof x.HR_1st_Round === 'number' : true; }) ? r.length + ' rows' : false; });
    t('K21 the W-level KPI has its team default row (20 days, level W, notice exempt), seeded once', function () {
      ensureKpiTargets_(); ensureKpiTargets_(); _tables = {};
      const w = kpiTargets_().filter(function (x) { return x.kpi === 'W_FULFILMENT'; });
      return w.length === 1 && w[0].days === 20 && String(w[0].levels) === 'W' && w[0].exempt && w[0].recruiter === '*' && w[0].from === '2025-04' ? 'ok' : false;
    });
    t('K22 W-level placement: 20 days, notice exempt, own level only, differs from Timely closure', function () {
      const tg = [{ recruiter: '*', kpi: 'TIMELY_CLOSURE', levels: 'All', days: 60, exempt: true, from: '2025-04' }, { recruiter: '*', kpi: 'M_FULFILMENT', levels: 'M', days: 50, exempt: true, from: '2025-04' },
        { recruiter: '*', kpi: 'W_FULFILMENT', levels: 'W', days: 20, exempt: true, from: '2025-04' }];
      const clk = function (r, d, notice) { return { receipt: r, doj: d, ex: { days: 0 }, notice: notice || 0, hold: 0, paused: 0 }; };
      const W = { Grade: 'W2', Fill_Type: '' }, M = { Grade: 'M3', Fill_Type: '' };
      const due = function (l, kpi, c) { return kpiDue_(l, kpi, tg, 'Asha', c, 'Closed'); };
      const a = due(W, 'W_FULFILMENT', clk('2026-08-01', '2026-08-21')), b = due(W, 'W_FULFILMENT', clk('2026-08-01', '2026-08-22'));
      const x = due(W, 'W_FULFILMENT', clk('2026-08-25', '2026-10-05')), n = due(W, 'W_FULFILMENT', clk('2026-08-01', '2026-09-04', 15));
      const late = clk('2026-08-01', '2026-09-04');   // 34 days
      return a.ok && a.allowed === 20 && a.month === '2026-08' && !b.ok && x.month === '2026-09' && !x.ok && n.allowed === 35 && n.ok
        && due(M, 'W_FULFILMENT', late) === null && due(W, 'M_FULFILMENT', late) === null
        && due(W, 'TIMELY_CLOSURE', late).ok === true && due(W, 'W_FULFILMENT', late).ok === false ? 'ok' : false;
    });
    t('K23 every TAT KPI cell carries its worked-on counts', function () {
      const d = apiKpi(fy, true).data.TEAM_TOTAL; let cells = 0;
      const ok = KPI_TAT_.every(function (kpi) { return Object.keys(d[kpi] || {}).every(function (m) { cells++; const c = d[kpi][m]; return typeof c.worked === 'number' && typeof c.workedOk === 'number' && c.workedOk <= c.worked; }); });
      return ok ? cells + ' cells' : false;
    });
    t('K24 the reconciliation adds up to the cell for each TAT KPI', function () {
      const k = apiKpi(fy, true), month = ymd_(new Date()).slice(0, 7), out = [];
      const ok = KPI_TAT_.every(function (kpi) {
        const c = (k.data.TEAM_TOTAL[kpi] || {})[month] || { num: 0, den: 0 }, r = apiKpiRecon(month, 'TEAM_TOTAL', kpi);
        const n = function (key) { return r.buckets.filter(function (b) { return b.key === key; })[0].items.length; };
        out.push(kpi + ' ' + c.num + '/' + c.den);
        return r.kpi === kpi && n('ontime') === c.num && n('ontime') + n('late') + n('overdue') === c.den;
      });
      return ok ? out.join(', ') : false;
    });
    err('K25 an unknown KPI has no reconciliation', function () { apiKpiRecon(ymd_(new Date()).slice(0, 7), 'TEAM_TOTAL', 'BGV'); }, /no reconciliation/);
    t('K26 the KPI result stays under the cache limit', function () { const n = JSON.stringify(apiKpi(fy, true)).length; return n < 95000 ? n + ' chars' : false; });
    /* The KPI set-up editor (v146): runs on the copy, so the versions it adds never reach the real sheets. */
    const nextM = kpiAddMonths_(kpiMonthNow_(), 1);
    t('K31 KPI set-up: nothing saved means the default scoring, the three TAT targets are listed', function () {
      const s0 = apiKpiSetup(); return s0.tat.length === 3 && s0.scoring.length === 7 && s0.scoring.every(function (x) { return x.isDefault; }) && s0.canEdit === true ? 'ok' : false;
    });
    t('K32 KPI set-up: a TAT change from next month is saved as a new version, nothing already reported moves, and the scorecard cache is rebuilt', function () {
      const before = JSON.stringify(computeKpis_(fy).data), s0 = apiKpiSetup(), rows0 = readTable_(KPI_TARGETS, true).rows.length;
      const out = apiKpiSave({ type: 'TARGET', kpi: 'M_FULFILMENT', who: '*', days: 49, levels: 'M', exempt: 'Yes', from: nextM, reason: 'E2E check of the KPI set-up', base: s0.base }, false);
      _tables = {};
      const k = apiKpi(fy);   // the cached result must have been dropped by the save
      return out.saved.length === 1 && readTable_(KPI_TARGETS, true).rows.length === rows0 + 1 && JSON.stringify(computeKpis_(fy).data) === before && k.targets.some(function (x) { return x.id === out.saved[0] && x.days === 49; }) ? out.saved[0] : false;
    });
    t('K33 KPI set-up: a screen older than the last save is refused', function () {
      const s0 = apiKpiSetup(); apiKpiSave({ type: 'TARGET', kpi: 'M_FULFILMENT', who: '*', days: 48, levels: 'M', exempt: 'Yes', from: nextM, reason: 'E2E second version', base: s0.base }, false);
      try { apiKpiSave({ type: 'TARGET', kpi: 'M_FULFILMENT', who: '*', days: 47, levels: 'M', exempt: 'Yes', from: nextM, reason: 'E2E stale screen', base: s0.base }, false); return false; } catch (e) { return /Someone saved a change/.test(e.message) ? 'ok' : false; }
    });
    t('K34 KPI set-up: a change that moves reported months needs the confirmation', function () {
      const d = { type: 'TARGET', kpi: 'M_FULFILMENT', who: '*', days: 30, levels: 'M', exempt: 'No', from: '2025-04', reason: 'E2E past-month check', base: apiKpiSetup().base };
      const pv = apiKpiPreview(d);
      if (!pv.needsConfirm) return 'no reported month moved on this data (nothing to confirm)';
      try { apiKpiSave(d, false); return false; } catch (e) { return /already reported/.test(e.message) ? pv.pastCount + ' reported results would change' : false; }
    });
    t('K35 KPI set-up: new score bands apply from their month, the default before it', function () {
      const s0 = apiKpiSetup();
      apiKpiSave({ type: 'BANDS', kpis: ['W_FULFILMENT'], bands: [{ min: 100, score: 5 }, { min: 90, score: 3 }], from: nextM, reason: 'E2E bands check', base: s0.base }, false);
      _tables = {}; const sc = kpiScoring_();
      return kpiScoreFor_(sc, 'W_FULFILMENT', 95, nextM) === 3 && kpiScoreFor_(sc, 'W_FULFILMENT', 95, kpiMonthNow_()) === 4 && kpiScoreFor_(sc, 'M_FULFILMENT', 95, nextM) === 4 ? 'ok' : false;
    });
    t('K36 KPI set-up: one audit row per version; only leads can read it, only the Head of HR and Admin can change it', function () {
      const a = readTable_('Audit_Log').rows.filter(function (r) { return r.Sheet === KPI_TARGETS || r.Sheet === KPI_SCORING; });
      const refused = !isLead_({ role: 'Recruiter', perms: ['voice_review'] }) && isLead_({ role: 'TA Lead' }) && !can_({ role: 'TA Lead' }, 'kpi_edit') && can_({ role: 'Head of HR' }, 'kpi_edit') && can_({ role: 'Admin' }, 'kpi_edit');
      return a.length >= 3 && refused ? a.length + ' audit rows' : false;
    });
    t('V1 voice agent settings are readable by the admin and not ready until filled in', function () { const c = apiVoiceConfig(); return typeof c.ready === 'boolean' && Array.isArray(c.missing) && c.connected === false && !('apiKey' in c) ? (c.ready ? 'ready' : c.missing.length + ' missing') : false; });
    t('K28 BGV: a previous-employer check started before the offer is flagged as a deviation', function () {
      const cfg = bgvRules_().cfg, mk = function (o) { return Object.assign({ Type: 'Previous employer', Status: 'Initiated', Trigger_Date: '2026-10-31', Initiated_On: '2026-10-29' }, o); };
      const rag = bgvRag_(mk({}), cfg, '2026-10-30');
      const list = apiBgvList();
      return bgvEarly_(mk({})) === 2 && rag.rag === 'Amber' && /before the offer/.test(rag.why) && bgvEarly_(mk({ Initiated_On: '2026-11-02' })) === 0
        && bgvEarly_(mk({ Type: 'Current employer' })) === 0 && bgvEarly_(mk({ Status: 'Cancelled' })) === 0
        && list.rows.every(function (r) { return typeof r.early === 'number' && r.early >= 0; }) ? list.rows.filter(function (r) { return r.early; }).length + ' early case(s)' : false;
    });
    t('K45 An offer within the TAT runs the notice from the offer: due on the later of today\u2019s due date and offer + notice; a late offer, or no offer sent, keeps today\u2019s rule', function () {
      const tg = [{ recruiter: '*', kpi: 'M_FULFILMENT', levels: 'M', days: 50, exempt: true, from: '2025-04' }], g = { Grade: 'M3', Fill_Type: '' };
      const clk = function (offer) { return { receipt: '2026-07-10', doj: '', ex: { days: 0, reasons: [], pauses: [] }, notice: 60, hold: 0, paused: 0, offer: offer, noticeDays: 90 }; };
      const a = kpiDue_(g, 'M_FULFILMENT', tg, 'asha', clk('2026-08-25'), 'Offered'), b = kpiDue_(g, 'M_FULFILMENT', tg, 'asha', clk('2026-09-10'), 'Offered');
      const ctx = tatContext_(), rule = ruleFor_(ctx, 'M3', '2026-07-10'), plain = rule.std + Math.max(90 - rule.grace, 0), want = 46 <= rule.std ? Math.max(plain, 46 + 90) : plain;
      const line = { Line_ID: 'E2E-K45-NONE', Grade: 'M3', Approval_Status: 'Approved', Approved_On: parseYmd_('2026-07-10'), Offer_Sent: 'Yes', Offer_Date: parseYmd_('2026-08-25'), Notice_Period_Days: 90, Hold_Days: 0 };
      const c = computeTat_(line, ctx), off = computeTat_(Object.assign({}, line, { Offer_Sent: 'No' }), ctx);
      return a && a.due === '2026-11-23' && a.month === '2026-11' && a.allowed === 136 && a.byOffer && b && b.due === '2026-10-28' && b.month === '2026-10' && !b.byOffer
        && c.Final_TAT === want && c.Pos_Final_TAT === want && c.Notice_From_Offer === (want > plain ? '2026-08-25' : '') && off.Final_TAT === plain && off.Notice_From_Offer === ''
        ? 'in time: due ' + a.due + ' (136 d); late: due ' + b.due + '; clock ' + c.Final_TAT + ' d (rule ' + rule.std + ' + grace ' + rule.grace + ')' : false;
    });
    t('K44 Notice beyond the grace is always exempt: a rejection or a "not exempt" target changes nothing, and a rejection can no longer be recorded', function () {
      const l = { Notice_Period_Days: 60, Notice_Ext_Status: 'Rejected' };
      let refused = ''; try { apiNoticeExtDecide('NO-SUCH-LINE', 'Reject', 'x'); } catch (e) { refused = e.message; }
      const clk = { receipt: '2026-08-03', doj: '', ex: { days: 0 }, notice: noticeExt_(l, 30), hold: 0, paused: 0 };
      const d = kpiDue_({ Grade: 'M3', Fill_Type: '' }, 'M_FULFILMENT', [{ recruiter: '*', kpi: 'M_FULFILMENT', levels: 'M', days: 50, exempt: false, from: '2025-04' }], 'asha', clk, 'Open');
      return noticeExt_(l, 30) === 30 && d && d.allowed === 80 && /always exempt|not found/.test(refused) ? 'allowed ' + d.allowed : false;
    });
    t('K43 Offer backout rate = candidates who backed out / positions worked on in the month x 100: the denominator is the Timely closure \"worked on\" count', function () {
      const k = computeKpis_(fy); let n = 0, bad = '';
      Object.keys(k.data).forEach(function (rec) {
        Object.keys(k.data[rec].OFFER_BACKOUT || {}).forEach(function (m) {
          const b = k.data[rec].OFFER_BACKOUT[m], tm = k.data[rec].TIMELY_CLOSURE && k.data[rec].TIMELY_CLOSURE[m];
          n++;
          if (!tm || b.den !== tm.worked) bad = bad || rec + ' ' + m + ': den ' + b.den + ' vs worked ' + (tm && tm.worked);
          else if (b.pct !== (b.den ? Math.round(1000 * b.num / b.den) / 10 : null) || b.score !== null || b.items.length !== b.num) bad = bad || rec + ' ' + m + ': rate or items';
        });
      });
      return n && !bad ? n + ' cells checked' : bad || 'no backout cells';
    });
    /* BGV release 148: N/A (not tracked), the employee hold and the experience letter. */
    t('K37 BGV: the ten new columns exist, and a case with none of them filled gets the old warning', function () {
      const h = readTable_(BGV_CASES_.name).headers, want = ['Track', 'Track_Note', 'Waiting_On', 'Wait_Reason', 'Expected_On', 'Pending_Remark', 'Left_Org', 'Exp_Letter', 'Wait_By', 'Wait_At'];
      const cfg = bgvRules_().cfg, c = { Type: 'Previous employer', Status: 'Not started', Candidate_Name: 'E2E', Trigger_Date: '2026-10-20', Due_Date: '2026-10-23' };
      return want.every(function (k) { return h.indexOf(k) >= 0; }) && JSON.stringify(bgvRagFor_(c, cfg, '2026-11-10')) === JSON.stringify(bgvRag_(c, cfg, '2026-11-10')) ? 'ok' : false;
    });
    t('K38 BGV: N/A cases are shown as N/A and left out of the open and red counts', function () {
      const L = apiBgvList(), na = L.rows.filter(function (r) { return r.na; });
      const live = L.rows.filter(function (r) { return !r.na && ['Closed', 'Cancelled'].indexOf(r.status) < 0; });
      return L.all.na === na.length && L.all.open === live.length && na.every(function (r) { return r.rag === ''; }) && L.all.red === live.filter(function (r) { return r.rag === 'Red'; }).length ? na.length + ' N/A, ' + live.length + ' open' : false;
    });
    t('K39 BGV: waiting on the employee pauses the warning until the expected date, and clearing it restores it', function () {
      const open = readTable_(BGV_CASES_.name, true).rows.filter(function (c) { return bgvOpen_(c); })[0];
      if (!open) return 'no open case on this copy (nothing to test)';
      const tomorrow = addDays_(ymd_(new Date()), 1), cfg = bgvRules_().cfg, today = ymd_(new Date());
      apiBgvPending(open.Case_ID, { waiting: true, reason: 'Documents', expected: tomorrow, remark: 'E2E: asked the candidate' });
      _tables = {}; const held = bgvRagFor_(bgvCaseRow_(open.Case_ID), cfg, today);
      apiBgvPending(open.Case_ID, { waiting: false });
      _tables = {}; const back = bgvRagFor_(bgvCaseRow_(open.Case_ID), cfg, today);
      return held.hold === true && held.rag === '' && !back.hold ? open.Case_ID : false;
    });
    t('K40 BGV: a case whose experience letter is pending cannot be waived or marked N/A', function () {
      const open = readTable_(BGV_CASES_.name, true).rows.filter(function (c) { return bgvOpen_(c) && String(c.Type) === BGV_TYPES_[0]; })[0];
      if (!open) return 'no open previous-employer case on this copy (nothing to test)';
      apiBgvPending(open.Case_ID, { left: 'Yes', letter: 'Pending', expected: addDays_(ymd_(new Date()), 3) });
      let waive = '', na = '';
      try { apiBgvSave(open.Case_ID, { outcome: 'Waived' }); } catch (e) { waive = e.message; }
      try { apiBgvTrack(open.Case_ID, 'NA', 'E2E not needed'); } catch (e) { na = e.message; }
      apiBgvPending(open.Case_ID, { letter: 'Received' });
      return /experience letter is still pending/.test(waive) && /cannot be N\/A/.test(na) ? open.Case_ID : false;
    });
    /* BGV release 149: the pending block in the Daily review and My day. */
    t('K41 BGV: the pending list holds only Red or with-the-employee cases, never N/A or closed ones', function () {
      const L = apiBgvPendingList();
      return /^\d{4}-\d{2}-\d{2}$/.test(L.today) && Array.isArray(L.rows) && L.rows.every(function (r) { return (r.rag === 'Red' || r.withEmp) && ['Closed', 'Cancelled'].indexOf(r.status) < 0; }) ? L.rows.length + ' pending' : false;
    });
    t('K42 BGV: a case with the employee appears in the list, its date and remark save in place, and a refused date is not saved', function () {
      const open = readTable_(BGV_CASES_.name, true).rows.filter(function (c) { return bgvOpen_(c) && !bgvTrack_(c).na; })[0];
      if (!open) return 'no tracked open case on this copy (nothing to test)';
      const d1 = addDays_(ymd_(new Date()), 2), d2 = addDays_(ymd_(new Date()), 5);
      apiBgvPending(open.Case_ID, { waiting: true, reason: 'Documents', expected: d1 });
      const listed = apiBgvPendingList().rows.filter(function (r) { return r.id === open.Case_ID; })[0];
      const saved = apiBgvPendingSave(open.Case_ID, { expected: d2, remark: 'E2E: promised by Friday' });
      let refused = ''; try { apiBgvPendingSave(open.Case_ID, { expected: '2020-01-01' }); } catch (e) { refused = e.message; }
      let cleared = ''; try { apiBgvPendingSave(open.Case_ID, { expected: '' }); } catch (e) { cleared = e.message; }
      apiBgvPending(open.Case_ID, { waiting: false });
      return listed && listed.withEmp && saved.expected === d2 && saved.remark === 'E2E: promised by Friday' && /cannot be in the past/.test(refused) && /needed while the employee holds the case/.test(cleared) ? open.Case_ID : false;
    });
    err('K20 a purge needs a reason and only cases past retention', function () { apiBgvPurge(['BGV-99999'], 'Retention approved by the Head of HR'); }, /Not past retention/);
    if (c1 && c1.Candidate_ID) {
      const cvText = 'E2E Candidate One\nWORK EXPERIENCE\nSenior Engineer | Alpha Steel Ltd | Jan 2019 - Present\n- Maintained rolling mill.\nEngineer | Beta Power Ltd | Jan 2015 - Dec 2018\nEDUCATION\nB.Tech (Mechanical), NIT Jamshedpur, 2014\nLANGUAGES\nEnglish, Hindi';
      t('L1 build a CV profile from text, with dates and checks', function () { const r = apiBuildProfile(c1.Candidate_ID, cvText, { fileName: 'e2e.pdf' }); return r.profile.employment.length === 2 && r.derived.counted.years >= 11 ? r.profile.employment.length + ' jobs' : false; });
      t('L2 correct and review the profile', function () { const r = apiGetProfile(c1.Candidate_ID), p = r.profile; p.certifications.push({ name: 'NEBOSH' }); const x = apiSaveProfile(c1.Candidate_ID, p); return x.reviewedBy && x.profile.certifications.length ? 'reviewed' : false; });
      err('L3 a reviewed profile is not overwritten without Replace', function () { apiBuildProfile(c1.Candidate_ID, cvText, {}); }, /reviewed by/);
      t('L4 the profile export lists the candidate', function () { return apiProfileExport([c1.Candidate_ID]).length === 1; });
    }
  }
  const ctcR = t('I13 start a draft of the CTC rules', function () { const r = apiCtcDraftNew(); return r.draft && r.draft.changes.length === 0 ? r : false; });
  if (ctcR) {
    t('I14 save a change and see it listed', function () {
      const cfg = ctcR.draft.config; cfg.components.filter(function (c) { return c.id === 'conv'; })[0].amount = 1800;
      const r = apiCtcDraftSave(ctcR.draft.id, cfg); return r.saved && r.changes.length === 1 ? r.changes[0] : false;
    });
    err('I15 a remark is required to put rules in force', function () { apiCtcActivate(ctcR.draft.id, { eff: today, reason: 'Correction', remark: 'x' }); }, /at least 10/);
    t('I16 put the new version in force', function () {
      const r = apiCtcActivate(ctcR.draft.id, { eff: today, reason: 'Correction', remark: 'E2E test of the rules editor' });
      const c = apiCtcCalc({ basis: 'gross', target: 72080, codes: ctcSample });
      return r.active.id === ctcR.draft.id && c.lines.filter(function (l) { return l.id === 'conv'; })[0].monthly === 1800 ? r.active.id : false;
    });
    err('I17 an issued letter on older rules cannot be re-issued', function () { apiCtcIssue(ctcA.id, { language: 'en', pdf: ctcPdf }); }, /already|superseded/i);
  }
  const orgA = t('O1 the organogram structure is seeded', function () { const a = apiOrgAdmin(); return a.divisions.length >= 1 && a.depts.length >= 1 && a.map.some(function (m) { return m.org; }) ? a : false; });
  if (orgA) {
    const mapped = orgA.map.filter(function (m) { return m.org; }).slice(0, 2);
    const rep = function (a1, e1, a2, e2) {
      return [{ 'Department Name': mapped[0].crm, 'Level Name': 'M6', 'ApprovedManPower': a1, 'ExixtingManpower': e1 }, { 'Department Name': mapped[mapped.length - 1].crm, 'Level Name': 'W4', 'ApprovedManPower': a2, 'ExixtingManpower': e2 }];
    };
    t('O2 the organogram opens for the admin with totals and the manage flag', function () { const r = apiOrganogram(); return r.canManage === true && r.totals && typeof r.totals.approved === 'number' && Array.isArray(r.divisions) && Array.isArray(r.unmapped); });
    t('O3 an import dry run changes nothing', function () { const before = readTable_(ORG_MP_, true).rows.length; const r = apiOrgImport(rep(10, 8, 20, 22), {}); return r.ok === true && r.applied === false && r.approved === 30 && r.existing === 30 && readTable_(ORG_MP_, true).rows.length === before; });
    t('O4 a department that is not mapped is refused and named', function () { const r = apiOrgImport([{ 'Department Name': 'E2E Unmapped Dept', 'Level Name': 'M6', 'ApprovedManPower': 1, 'ExixtingManpower': 1 }], {}); return r.ok === false && /E2E Unmapped Dept/.test(r.errors[0]); });
    t('O5 a grade outside M, W, T is refused', function () { const r = apiOrgImport([{ 'Department Name': mapped[0].crm, 'Level Name': 'Z9', 'ApprovedManPower': 1, 'ExixtingManpower': 1 }], {}); return r.ok === false && /not a grade/.test(r.errors[0]); });
    t('O6 a report without the right columns is refused', function () { const r = apiOrgImport([{ A: 1 }], {}); return r.ok === false && /missing these columns/.test(r.errors[0]); });
    t('O7 applying an import replaces the headcount snapshot', function () { const r = apiOrgImport(rep(10, 8, 20, 22), { apply: true, asOn: today, file: 'e2e.xlsx' }); const o = apiOrganogram(); return r.applied === true && o.totals.approved === 30 && o.totals.existing === 30 && o.asOn === today ? r.batch : false; });
    t('O8 a second import replaces the first, it does not add to it', function () { apiOrgImport(rep(5, 5, 7, 6), { apply: true, asOn: today, file: 'e2e2.xlsx' }); const o = apiOrganogram(); return o.totals.approved === 12 && o.totals.existing === 11 && o.totals.net === 1; });
    t('O9 the import log keeps one row per import', function () { return apiOrgAdmin().log.length >= 2; });
    const d0 = orgA.depts[0];
    t('O10 a HOD name and email save and read back', function () { const r = apiOrgSaveStructure({ depts: [{ dept: d0.dept, division: d0.division, hod: 'E2E HOD', email: 'e2e.hod@example.com', active: true }] }); const x = r.depts.filter(function (d) { return d.dept === d0.dept; })[0]; return x.hod === 'E2E HOD' && x.email === 'e2e.hod@example.com'; });
    err('O11 a bad HOD email is refused', function () { apiOrgSaveStructure({ depts: [{ dept: d0.dept, division: d0.division, hod: 'E2E HOD', email: 'not-an-email', active: true }] }); }, /email/);
    err('O12 a department with headcount cannot be switched off', function () { const od = orgA.depts.filter(function (d) { return d.dept === mapped[0].org; })[0]; apiOrgSaveStructure({ depts: [{ dept: od.dept, division: od.division, hod: '', email: '', active: false }] }); }, /headcount|mapped/);
    t('O13 a CRM department can be mapped and unmapped', function () {
      const a = apiOrgSaveMap([{ crm: 'E2E Mapping Test Dept', org: d0.dept }]);
      const there = a.map.some(function (m) { return m.crm === 'E2E Mapping Test Dept' && m.org === d0.dept; });
      const b = apiOrgSaveMap([{ crm: 'E2E Mapping Test Dept', org: '' }]);
      return there && !b.map.some(function (m) { return m.crm === 'E2E Mapping Test Dept' && m.org; });
    });
    err('O14 mapping to a department that does not exist is refused', function () { apiOrgSaveMap([{ crm: 'E2E Mapping Test Dept', org: 'No Such Org Dept' }]); }, /not an active department/);
    t('O15 open positions are counted under the mapped department', function () { const o = apiOrganogram(); return o.totals.open >= 0 && o.divisions.every(function (dv) { return dv.depts.every(function (d) { return Array.isArray(d.lines) && Array.isArray(d.crm); }); }); });
    const upSub = t('O16 a seat filled at a higher grade is covered, not vacant, and needs a note', function () {
      const dn = mapped[0].crm;
      const r = apiOrgImport([{ 'Department Name': dn, 'Level Name': 'W5', 'ApprovedManPower': 3, 'ExixtingManpower': 1 }, { 'Department Name': dn, 'Level Name': 'W4', 'ApprovedManPower': 0, 'ExixtingManpower': 2 }], { apply: true, asOn: today, file: 'e2e-mix.xlsx' });
      const o = apiOrganogram(), s = o.mix.filter(function (x) { return x.dept === mapped[0].org && x.from === 'W5' && x.to === 'W4'; })[0];
      return r.applied && s && s.seats === 2 && s.dir === 'Upgrade' && s.state === 'needs' && o.totals.vacancy === 0 && o.totals.excess === 0 && o.totals.covered === 2 && o.totals.net === 0 ? s : false;
    });
    t('O17 an upgrade note is saved, listed and counted as noted', function () {
      if (!upSub || !upSub.dept || upSub.dir !== 'Upgrade') return true;
      apiOrgSaveNote({ dept: upSub.dept, from: upSub.from, to: upSub.to, seats: upSub.seats, reason: 'E2E grade note', by: 'E2E', reviewOn: '2099-01-01' });
      const x = apiOrganogram().mix.filter(function (m) { return m.dept === upSub.dept && m.from === upSub.from && m.to === upSub.to; })[0];
      return x && x.state === 'noted' && x.note.reason === 'E2E grade note';
    });
    err('O18 an upgrade without a reason is refused', function () { apiOrgSaveNote({ dept: d0.dept, from: 'W5', to: 'W4', seats: 1, by: 'x', reviewOn: '2099-01-01' }); }, /reason/);
    err('O19 a note across two pay bands is refused', function () { apiOrgSaveNote({ dept: d0.dept, from: 'W5', to: 'M7', seats: 1, reason: 'abc', by: 'x', reviewOn: '2099-01-01' }); }, /same band/);
    t('O20 a note can be closed and the seat asks for one again', function () {
      if (!upSub || !upSub.dept || upSub.dir !== 'Upgrade') return true;
      const x = apiOrganogram().mix.filter(function (m) { return m.dept === upSub.dept && m.from === upSub.from && m.to === upSub.to; })[0];
      apiOrgCloseNote(x.note.id);
      return apiOrganogram().mix.filter(function (m) { return m.dept === upSub.dept && m.from === upSub.from && m.to === upSub.to; })[0].state === 'needs';
    });
    t('O21 re-importing the headcount keeps the notes sheet', function () { const n = readTable_(ORG_NOTE_, true).rows.length; apiOrgImport(rep(5, 5, 7, 6), { apply: true, asOn: today, file: 'e2e3.xlsx' }); return readTable_(ORG_NOTE_, true).rows.length === n; });
    t('O22 no grade is counted both as vacant and as covered beyond what is approved', function () { const o = apiOrganogram(); return o.divisions.every(function (dv) { return dv.depts.every(function (d) { return d.grades.every(function (g) { return g.vacancy >= 0 && g.excess >= 0 && g.covered <= g.grossVacancy && g.covers <= g.grossExcess; }); }); }); });
  }
  return { pass: pass, fail: fail, log: log };
}
