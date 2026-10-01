function e2eTest() {
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
    CacheService.getScriptCache().removeAll(['dash_v1', 'users_v1', 'kpi_' + fy, 'kpi_' + (fy - 1)]);
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
  t('A5 KPI scorecard', function () { const k = apiKpi(fy, true); return Object.keys(k.defs).length === 7 ? 'fy ' + fy : false; });
  t('A6 data checks', function () { return apiDataChecks().length === 14; });
  t('A7 change history', function () { return Array.isArray(apiAuditLog({})); });
  t('A8 panel members', function () { return apiListPanelMembers().length >= 60; });
  t('A9 panel unavailability list', function () { return Array.isArray(apiListPanel()); });
  t('A10 daily log list', function () { return Array.isArray(apiListFunnel({})); });
  t('A11 observations list', function () { return Array.isArray(apiListObservations({})); });
  t('A12 weekly summary status', function () { return typeof apiWeeklyStatus().on === 'boolean'; });
  t('A13 admin info', function () { return apiAdminInfo().hasOwnProperty('lastBackup'); });
  t('A14 pipeline alerts', function () { return !!apiPipelineAlerts().counts; });

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
  mv('D6 department confirmed', 'Confirmed', {});
  err('D7 interview needs result', function () { apiMoveStage(A, 'Technical', {}); }, /date and result/);
  mv('D8 technical interview', 'Technical', { date: today, by: 'Jaspal Bhanker', result: 'Selected' });
  t('D9 interview written to candidate', function () { _tables = {}; return apiGetCandidate(c1.Candidate_ID).Tech_Result === 'Selected'; });
  mv('D10 HR interview', 'HR', { date: today, by: 'Randhir Singh', result: 'Selected' });
  err('D11 documents gate', function () { apiMoveStage(A, 'Docs', { docs: { A: 'Verified' } }); }, /not verified/);
  mv('D12 documents verified', 'Docs', { docs: { A: 'Verified', B: 'Verified', C: 'Verified', D: 'Verified', E: 'Verified', F: 'Verified', G: 'Verified', H: 'NA' } });
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
  const legacy = (apiListCandidates().filter(function (c) { return !c.Line_ID && c.Name; })[0] || {}).Candidate_ID;
  t('D27 add existing candidate to pipeline', function () { return apiAddToPipeline(legacy, L2.Line_ID).Stage === 'Sourced'; });
  err('D28 no duplicate in same pipeline', function () { apiAddToPipeline(legacy, L2.Line_ID); }, /already/);
  t('D29 reject with reason', function () { _tables = {}; const p = apiPipeline(L2.Line_ID); return apiSetAppStatus(p.apps[0].App_ID, 'Rejected', 'E2E not suitable').apps[0].Status === 'Rejected'; });
  err('D30 rejected cannot move', function () { _tables = {}; apiMoveStage(apiPipeline(L2.Line_ID).apps[0].App_ID, 'Screened', {}); }, /Reactivate/);

  t('E0 entries report whether they can be edited', function () { return apiListFunnel({ from: today, to: today }).every(function (r) { return typeof r.canEdit === 'boolean'; }); });
  t('E1 daily log with CVs reviewed', function () { return !!apiSaveFunnel({ Line_ID: L2.Line_ID, Entry_Date: today, CV_Sourced: 5, CV_Reviewed: 4, Remarks: 'E2E' }).Entry_ID; });
  err('E2 future date blocked', function () { apiSaveFunnel({ Line_ID: L2.Line_ID, Entry_Date: '2099-01-01', CV_Sourced: 1 }); }, /future/);
  err('E3 negative count blocked', function () { apiSaveFunnel({ Line_ID: L2.Line_ID, Entry_Date: today, CV_Sourced: -1 }); }, /whole number/);
  t('E4 day note and tasks saved', function () { return !!apiSaveDaySummary({ date: today, overview: 'E2E day', tasks: [{ t: 'E2E task', d: true }, { t: 'Open task', d: false }], recruiter: String(L1.Recruiter) }).summaryId; });
  t('E5 daily review shows the day', function () {
    _tables = {}; const d = apiDaySummary(today); const r = d.recruiters.filter(function (x) { return x.recruiter === String(L1.Recruiter); })[0];
    return r && r.overview === 'E2E day' && r.tasks.length === 2 && d.team.CV_Reviewed >= 4 && r.funnel.Joined >= 1 && Object.keys(r.moves).length > 5 ? Object.keys(r.moves).length + ' kinds of move' : false;
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
  return { pass: pass, fail: fail, log: log };
}
