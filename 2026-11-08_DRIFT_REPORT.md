# Drift report, 8 Nov 2026

Design documents checked: `docs/BFCL_Recruitment_CRM_SSOT.md`, `README.md`, `docs/voice-webhook/`.
Code state: `main` at `6a6e539` (`BUILD_ID` 158 at the time of the check, `SCHEMA_VERSION` 47). Method: the Elephant-Goldfish drift-report procedure, followed by hand (the `/egm-drift-report` command was not loaded in the session). Three read-only checks compared each document slice with the code; the claims marked **verified** were re-checked by the author of this report. Only differences are listed. Severity: **H** wrong behaviour, permission or data; **M** a real feature the document does not cover; **L** wording.

Documents should link the code files they describe (file names or functions) so the next check is cheaper.

## Found while checking, already fixed
- **Release number reused (H, verified, fixed in PR #98).** `BUILD_ID` stayed 158 through eight merges (plan editor, joining date correction, four voice changes, batch calling, candidate history). Convention (SSOT §2) is one new number per release; the number is part of the Overview and Daily-review cache keys and drives the reload banner. Now 159.

## SSOT §3, 4, 5, 6, 7, 12

### §3 Users, roles and permissions
- **H** §3.2 table is incomplete: `kpi_edit` (Head of HR, Admin; `Config.gs` PERMS_, `KpiAdmin.gs`) and the runtime permission `voice_call` (added from `Voice_Access` in `Auth.gs` currentUser_) are not listed; `voice_agent` is described as the permission that "places and fetches calls", but named people place calls through `voice_call`, and `apiVoiceFetchResult` also allows the person who placed the call and any lead. The Roles tab uses its own `ROLE_MATRIX` (App.html), with an Onboarding column, not `PERMS_`.
- **M** `requireEditorOrAdmin_` (Auth.gs) guards setup, installTriggers, shareWithTeam and the scheduled jobs; not documented.
- **M** Users sheet has `Official_Email` (Compliance.gs, Users.gs, Auth.gs `mailTo_`); only in the changelog. The users cache holds five fields, so `Official_Email` is read live.
- **L** `normRole_` also maps onboarding, onboard, onboardingteam, onboardingexecutive.

### §4 Architecture
- **H** §4.8 says the current schema is 37; code is 47.
- **M** §4.8 step list is stale (about 40 steps, each locked and remembered in `SCHEMA_DONE_<v>`, retried with a 10, 30, 60 minute back-off; `ensureSchema_` also runs in the 30-minute and nightly jobs).
- **M** §4.9 job table omits the schema step and BGV folder sync (nightly), the schema step, to-do reconcile, archive and voice-result ingest (30-minute job), `voiceQueueJob` (one minute, `VoiceScreen.gs`), and the per-step JOB_LOG and failure e-mail to Admins (`Admin.gs` runStep_).
- **M** §4.1 says no external services and only the weekly e-mail; the code calls the voice provider (`script.external_request`) and e-mails job failures to Admins.
- **M** §4.2 file list omits `JdMaster.gs`, `History.gs`, `Departments.gs`, README.md and appsscript.json; the `Org.gs` row lists only schema 36 helpers. `E2E.gs` is documented as not deployed; **verified**: `.claspignore` does not exclude it and the workflow pushes every `.gs`, so `e2eTest()` (which copies the live spreadsheet) is in production.
- **M** §4.3/§4.6 routes and rail: code also has org, depts, reconcile, jdm, ctc, bgv; rail adds BGV tracker, CTC calculator (with `ctc_use`), Organogram, Dept delays, JD Master; the rail starts collapsed under 1400 px, not 1100.
- **M** §4.4 cached-table list omits M_Exemption_Reasons, TAT_Exemptions, CTC_Rules, Org_Divisions, Org_Departments, Org_Dept_Map, BGV_Rules; the key is tagged by DB file (`tbl3_<dbTag>_<name>`); tables of 95,000 characters or more are not cached.
- **L** §4.5 formula guard also covers tab, carriage return and a leading minus before a letter, bracket, @ or $; ID prefixes INT-, TA-, DSG-, TEX-, VCL-, VRQ-, VBQ- are not listed; `Day_Status` reuses `DS-`; TAT rule ids are hard-coded `TR-`.
- **L** `setup()` installs only the nightly trigger (`installTriggers` installs both) and appends the Admin with five columns. The CV size limit is not enforced at 10 MB (only the 15 MB viewer limit).

### §5 Data model
- **M** Sheets missing: `M_Day_Status`, `Day_Status` (`DayReview.gs`), `Candidate_CVs` (`History.gs`), `Voice_DND`, `Voice_Access`, `Voice_Requests`, `Voice_Queue` (`VoiceScreen.gs`).
- **M** Columns missing: `Voice_Calls` Plan_JSON, Recording_URL, Cost, Cost_Unit, Suggest_Total, Suggest_Kept, Origin_Line_ID; `Origin_Line_ID` on Interviews, Followups, Screenings; MRF Designation, Approved_Date_Check, Fill_Type, Internal_Employee, Internal_Emp_Code, Internal_From_Dept, Internal_Decided_On, Internal_Effective_Date; Applications Created/Updated By/At. `Voice_Inbox` is also written by the CRM (Processed_At, Result).
- **L** `KPI_Targets` is created lazily by `ensureKpiTargets_`, not by the schema step; Interviews has prefix `INT-`.

### §6 Positions and status
- **H** §6.1 lacks status **Removed** (Approval_Status "Created in error") and the internal-fill rule (Approved with `Fill_Type` Internal is Closed from `Internal_Effective_Date`, else Offered) (`Tat.gs` positionStatus_).
- **H** §6.4 lists three close outcomes; code also has **Filled Internally** (employee, effective date within 60 days, decision date, audited, a lead can undo) and **Created in Error** (a recruiter is refused when candidates were added; only a lead removes it) (`Closure.gs`).
- **M** `guardPipelineFields_` is skipped for any lead and before the cutover.
- **L** IJP check is fewer than 21 calendar days with a note "shorter than 15 working days", not 15 working days (`Pipeline.gs`).

### §7 TAT
- **M** §7.3/§7.4 omit the internal-fill and Removed end rules; No Vacancy, Not Needed, On Hold and Removed give a blank result; `computeTat_` also returns TAT_Rule, TAT_Risk, Notice_Ext_Days, Exempt_Extra_Days, Paused_Days, Exempt_Reasons, Notice_From_Offer.
- **L** The T1-T4 rule pattern matches T0 to T9; the baseline comes from M_Grades (only W1-W3 are forced to 20).

### §12 Administration
- **H** `JOINING_WEEKDAYS` and `APP_NAME` are documented settings that **no code reads** (**verified**); Monday and Thursday are fixed in `Admin.gs` (data check) and `App.html` (hints).
- **M** Settings in code but not listed: FASTTRACK_LEVELS, CTC_APPROVAL, CTC_FOLDER_ID, CV_GAP_MONTHS, BGV_NA_BEFORE, BGV_FOLDER_ID, BGV_FOLDER_MAP, BGV_SYNC_LAST, VOICE_ENABLED, VOICE_AGENT_ID, VOICE_AGENT_VERSION, VOICE_CONNECTION_ID, VOICE_FROM_NUMBER, VOICE_DND_REQUIRED, VOICE_ORG_ID, VOICE_WORKSPACE_ID, VOICE_OPENING_LINE, VOICE_ENTRY_STATE, VOICE_WEBHOOK_URL, VOICE_QUESTIONS_VAR, VOICE_MAX_Q, VOICE_RATE_PER_MIN, VOICE_QUEUE_PER_MIN, VOICE_CALL_HOURS.
- **M** §12.1 tabs missing: KPI targets (`kpit`, edit needs `kpi_edit`), Day's Status (`dstat`, lead only); Hiring routes is shown to `tat_view` holders but changed only with `tat_edit`; Org structure also has Manpower plan and Grade notes; Voice agent also has Command center, Batches, Who can place calls, requests and the Do Not Disturb register; the Tools tab also has the speed check, "Retry the database upgrade now", self-tests and job health.
- **M** §12.3 cache keys contradict §4.4 (`dash_v1`, `daysnap2_`); code uses `dash_b<BUILD_ID>` and `daysnap_b<BUILD_ID>_<ver>_<date>`; Script Properties SCHEMA_ERR, SCHEMA_FAILS, SCHEMA_LAST_MS, SCHEMA_DONE_<v> are not listed; the retry back-off is 10, 30, 60 minutes.
- **L** Backup folder is "BFCL Recruitment CRM - Backups" next to the DB file; weekly e-mail goes to every active user holding `lead`, via the official address when set; `KPI_CAPTURE_FROM` is seeded at upgrade time, so the documented value can differ.

## SSOT §8, 9, 10
### §8.7 Voice screening call
- **H** The "Still not written" bullet and the intro line say the Do Not Disturb check and returning results are not written and that no call is placed while the check is required; code: `voiceDndWritten_()` and `voiceResultsWritten_()` return true, `voiceDndCheck_` reads the `Voice_DND` register, only the provider hook `voiceDndProvider_` is a stub.
- **H** Text saying only the Admin places calls (heading, card section, line "voice_agent … place and fetch calls", `Config.gs` comment) contradicts `voiceRequireCaller_` (Admin, `voice_call` within a daily limit, approved request) and the doc's own later lines.
- **H** `apiVoiceFetchResult` is documented as Admin only; code allows the Admin, the person who placed the call (with `voice_call`) or any lead.
- **M** "Only candidate_name and role_applied are sent" is stale: also the questions variable, `call_mode`, `question_criteria` (version 6 or later); `webhook_config` also sends `metadata {call_id, lead_id}` (ingest matches on `metadata.call_id`); the agent version is a setting, the provider response id may be `attempt_id` first; settings VOICE_AGENT_VERSION, OPENING_LINE, ENTRY_STATE, WEBHOOK_URL, MAX_Q (1-10, default 6), ENABLED are not listed.
- **L** Daily limit is clamped to 1-500 (default 20) and a grant needs a reason of 3 or more characters; Cancelled calls count toward the limit.
### §8.9 Candidate history
- **L** Returns the newest 600 events only; record changes are a whitelist (`TL_FIELDS_.Candidates`) read from the first card's creation date (365 days if no card).
- **H** (decision, not drift) The History shows transcripts, recordings and answers to everyone who opens the candidate, while ADR-048 says transcripts stay Admin-only and §8.7 says only `voice_review` holders see a call. Decision recorded 8 Nov: everyone sees all; ADR-048 and §8.7 to be amended.
### §8.1-8.6, 8.8
- **M** `apiSuggestForLine` takes minimum experience from `jdmPolicyExp_` (JD Master) when available, excludes candidates already carded on the position, caps at 25; archived-candidate search does not match education and ignores pool filters.
- **L** CV size limits differ; `apiParseAccuracy` has no Admin check (any signed-in user can call it); CV profile thresholds (High at 80, Medium at 55, OCR minus 15, gaps of 12 months or more "warn", average tenure under 18 months noted with 3 or more completed jobs, `CV_GAP_MONTHS` 1-24) are not documented.
- **M** Fast-track: a lead can record an exception reason instead of the department's written confirmation file; the skipped to-do list is wider than documented (also confirm_attendance, reschedule, record_result, psychometric, offer_acceptance); `release_offer` and `hod_feedback` are retitled; `FASTTRACK_LEVELS` setting; the hand-set route is any lead (Admin included).
### §9 Pipeline
- **M** `apiMoveToLine` rules are only in §8.9 (reason 3 or more characters, same MRF, lead or recruiter of both positions, card Active or On hold and below Offer, same hiring route, no existing card on the target).
- **M** Documents-verified also needs remarks of 5 or more characters when an exception is used; Onboarded requires only induction date and buddy (HRMS optional; the check-ins are to-dos); a card at Joined or Onboarded cannot be rejected, held or withdrawn; at Offer or Pre-joining it cannot be rejected (use backout); a move back past Offer clears the position's offer fields and Candidate_ID, past Joined clears Actual_DOJ and DOJ; offer-stage validations (acceptance date not before the offer date or in the future; joining not before the offer date); `bgvJoinGuard_` blocks Joined while the previous-employer BGV case is open unless acknowledged.
- **M** §9.5 alerts also list an expired expected joining date, a joining recorded on the position without the card moved, an offer unaccepted 7 days after the offer, an `unassessed` counter and per-stage counts. `apiReconcileRemove` is allowed to the position's recruiter.
### §10 Daily work
- **M** Day's Status has no section (sheets Day_Status and M_Day_Status; `apiDayStatusConfig`, `apiSaveDayStatusConfig`, `apiSetDayStatus`, `apiMyDayStatuses`; lead-only list edit, 40-character names, override note required and at most 300, recruiters limited to today and yesterday, override lapses when the automatic status changes, 7 system statuses, 8-colour palette).
- **M** `apiCvReceivedCompare` (lead, from the switch-over date, at most 92 days) and the HR-stage scorecard credit rule (a card that skips HR is not credited at HR) are not documented.
- **M** To-do table lacks `bgv_release`, `voice_review`, `voice_notint`, `voice_callback`, `voice_incomplete`, `voice_wrongno`; `share_cvs` also uses the 30-day window; snooze options 2h/2d/next day 09:30; a `note` action for BGV to-dos; `day_note` applies to active Recruiters after 17:00 IST; code policy strings for psychometric and bgv_chase differ from the doc.
- **L** Daily review is also visible to recruiters through My day (their own slice); the typed CV_Reviewed window between the switch-over and the funnel start; §8 headings are out of order (8.4, 8.9, 8.7, 8.6, 8.5, 8.8).

## SSOT §11, 13, 14
- **H** §11.8 and ADRs 060/069 say the BGV KPI is unchanged; `Kpi.gs` skips the current-employer start check when `Excl_Status` is Approved; the exclusion workflow (`apiBgvExclRequest`, `apiBgvExclDecide`, the `bgv_release` to-do, the `bgv_excl_over` data check) is not in §11.8.
- **M** §11.4: the weekly e-mail is not "the one e-mail the app sends" (job-failure mail); its content also has backouts and offers, data-check totals, a BGV block, pending TAT exemptions.
- **M** §11.5 listed some other checks and named pipeline checks that no longer exist; `apiDataChecks` has **12** (mrf_missing, offer_no_date, doj_order, doj_day, mobile, dup, selected_unlinked, notice_edoj, daily_dup, kpi_gap, bgv_late, bgv_excl_over). The review pass first reported 17; counting them in `Admin.gs` gave 12, which is what the document now says. "14 checks" in the BGV text was stale.
- **M** No §11 section for Reports → Dept delays (only the changelog).
- **L** §11.9 puts "each import replaces the snapshot" next to "re-import refreshes Existing only"; the code replaces the whole `Org_Manpower` snapshot and keeps the report's approved numbers for comparison only. §11.2 shows `KPI_CAPTURE_FROM` as a fixed value.
- **M** §13: ADR-016 and ADR-045 each appear twice (**verified**); ADR-070 is out of order and dated "7 Oct" although it needs schema 46 (after v158's schema 45); several behaviours have no ADR (candidate history visibility, voice access and batch calling, `correct_data`).
- **H** §14: the intro says nothing is waiting to be deployed while eight entries are headed "Unreleased" (all now part of build 159); the intro also says every Unreleased entry belongs to version 99 or earlier. Joining date correction and plan editor sit under 7 Oct although they need schema 46; "Deploys wait for approval" (2 Nov) and the whole v100 to v158 span sit under "2026-09-30". "Schema versions (recorded)" jumps from 46 to 40, has no 41 to 45 or 47, and labels shipped steps (37, 36, 33, 31, 30) "unreleased".

## README and release process
- **H** SSOT header: document version 1.19, "v99", schema 43; §2: "Deployed version 99". Code: build 158 (now 159), schema 47. README "Live version" says v61 and schema 26; tags stop at v61.
- **H** §2 and §12.5 describe a manual release (`clasp push -f`, `clasp deploy -i … -V …`, editor patches, Manage deployments). The real process is the GitHub workflow (`check` job, `production` approval, `clasp push -f`, `clasp deploy -i … -d`, pull-and-compare verify; the build number is read from `BUILD_ID`), described only in the 2 Nov changelog entry.
- **M** README is inconsistent: Notes and "Releasing a version" step 2 tell the user to deploy from the Apps Script editor; "Releasing (from GitHub, with approval)" says merging and approving does it.
- **L** §12.6 test counts are stale (E2E 95).

## docs/voice-webhook
- **M** README and ADR-048 overstate the receiver's isolation: `appsscript.json` grants the full `spreadsheets` scope, runs as the deployer, `access ANYONE_ANONYMOUS` (**verified**); `Code.gs` opens the whole database by id and is limited to `Voice_Inbox` only by its code. README step 4 says it "only needs your spreadsheets".
- **L** `doPost` returns JSON (`{ok:false,error:…}`), not only "ok"; results appear only after `voiceIngest_` runs (30-minute job or an Admin screen); a row that arrives before the call record carries the provider id waits up to an hour, then "No matching call"; a row for a call the opener cannot review is skipped; duplicates are removed twice (receiver: attempt_id, retry_attempt, status in the last 200 rows; CRM: Interaction_ID and Final_Vars_JSON).

## Follow-ups that need a decision (code, not documents)
1. Make `JOINING_WEEKDAYS` real, or remove it from the settings table.
2. Exclude `E2E.gs` from the production push, or document that it ships.
3. Narrow the voice receiver's scope (it can read and write the whole database).
4. Tag releases again (v62 to v158 were never tagged); the README no longer asks for tags.
5. Decide whether transcripts and recordings should stay visible to everyone in the candidate History (decided: yes, on 8 Nov).

## Status after the documentation pull request (8 Nov 2026)
Fixed in the documents (each statement checked against the code): header, §2, §3.2 (`kpi_edit`, `voice_call`, `requireEditorOrAdmin_`), §4.8 and §4.9, §5 (new sheets and columns), §6.1 and §6.4 (Removed, internal fill), §8.7 (settings, call connection, agent variables, stale "not written" text, transcript visibility decision), §8.9, §11.5 (12 checks), §11.8 (ADR-069 exclusion), §12.2 (`JOINING_WEEKDAYS` and `APP_NAME` removed, missing keys added), §12.5, §13 (ADR-016a, ADR-045a, ADR-070 date, ADR-071 to 073), §14 intro and release labels, schema list, README, `docs/voice-webhook/README.md`.
Not yet done (lower value, no wrong statement left behind that the code contradicts as far as checked): §4.2 and §4.3 file and route lists, §4.4 cache keys, §10.4 full to-do rule list and a Day's Status section, §11.4 weekly e-mail contents, a Dept delays section, §12.1 tab list and §12.3 properties, §12.6 test counts, §14 dating of every Unreleased entry beyond the v159 grouping.
