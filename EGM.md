# BFCL Recruitment CRM Blueprint

## System Overview
A Google Apps Script web app (V8, time zone Asia/Kolkata) over a Google Sheets
database, with Drive for CVs and documents. `Main.gs:doGet` serves the `Index`
HTML template; the browser calls the `api*` functions in the `.gs` files through
`google.script.run`. Every `api*` function resolves the user first
(`Auth.gs:currentUser_`), so nothing is reachable without an active row in the
`Users` sheet. Tables are read and written only through `Db.gs`
(`readTable_`, `insert_`, `update_`, `nextId_`, `audit_`). Schema upgrades run
step by step in `Compliance.gs:ensureSchema_` (`SCHEMA_VERSION` '50'). The release
number is `Config.gs:BUILD_ID` ('163'). Files in `.html` (`Index.html`,
`App.html`, `Styles.html`) are the page and are outside this contract. Business
rules and decisions are in [docs/BFCL_Recruitment_CRM_SSOT.md](./docs/BFCL_Recruitment_CRM_SSOT.md);
[README.md](./README.md) holds the human-written setup and release notes.

## Local Interface & Invariants
Contracts per file (public entry points are the `api*` functions; `name_` helpers are internal).

### Foundation
- `Config.gs`: `T` table definitions (name, id column, prefix, width, editable whitelist), `ROLES`/`ROLE_LIST` (Admin, Head of HR, TA Lead, Recruiter, Onboarding), `PERMS_` role-to-permission map, `BUILD_ID`, `DB_SPREADSHEET_ID` (Script Property `DB_ID`).
- `Auth.gs`: `currentUser_`, `can_`, `isLead_`, `requireAdmin_`, `requireEditorOrAdmin_`, `canEditLine_`, `normRole_`. Unknown roles become Recruiter. `voice_call` is added from `Voice_Access` via `voiceHasAccess_`, never by role.
- `Db.gs`: all writes run in `withLock_`; IDs are never reused (`nextId_` with `IDMAX_<table>`); values starting with `=`, `+`, `@` are apostrophe-guarded (`clean_`, `plainCell_`); `update_` writes and audits only changed fields.
- `Compliance.gs`: `ensureSchema_`, `addSheet_`, `addColumns_`, observations, monthly audit sample, attachments (`apiUploadDoc`, `apiGetDoc`, 15 MB limit), interview panel members.
- `Setup.gs`, `Import.gs`: editor-run setup (CV folder, admin user, nightly trigger, `shareWithTeam`) and the one-time database import (reads `DATA_B64`, which is not in this repository; refuses if `DB_ID` is already set).
- `Dashboard.gs`: snapshot cache plus `Dash_Snapshot` sheet, `refreshDashboardJob` (30 minutes), `installTriggers`.
- `Admin.gs`: backups (`backupDb_`), job health (`runStep_`, `jobLog_`), data checks (`dataChecks_`), audit-log viewer, `setSetting_`, weekly summary e-mail and its Monday trigger.
- `Users.gs`: user management (`users_view`, `users_edit`), keeps `M_Recruiters` and Drive edit access in step; cannot remove the last active Admin.

### Positions, time and KPIs
- `Api.gs`: bootstrap, positions (`apiSavePosition`, `apiListPositions`), daily funnel, candidates, CV upload, panel availability, `nightlyJob`, `computeDashboard_`; after the switch-over date (`cutover_`) recruiters cannot type pipeline-owned fields (`guardPipelineFields_`).
- `Tat.gs`, `TatRules.gs`, `Exemptions.gs`: `positionStatus_`, `computeTat_` (recruiter and position clocks), versioned `TAT_Rules`, exemption workflow, closed-month lock after `TEX_LOCK_DAYS_`.
- `Closure.gs`, `Reconcile.gs`: close without hire, internal fill, created in error, resume; switch-over mismatch check.
- `Kpi.gs`, `KpiAdmin.gs`: monthly scorecard from `KPI_Targets` and `KPI_Scoring`; KPI set-up is append-only and versioned (`kpi_edit`).
- `Checkin.gs`: check-in plan (versioned `Checkin_Plan`: timeline, questions, facts to tell; `checkinSchedule_` dates; `apiCheckinPlan/Preview/Save/For`); plans and shows dates only, places no call (v161).
- `Policy.gs`: policy library (Drive folder `Policies`, `Policy_Docs`/`Policy_Chunks`/`Policy_Queries`), browser-read upload in parts, BM25 passage search with a not-covered gate; no AI and no policy text leaves the sheet (v162).
- `PosRec.gs`: several recruiters per position (`Position_Recruiters`: lead and tagged rows; `Applications.Owner_Recruiter`; `apiPosRecList/Set`); rights helpers `onPosition_`, `canActCard_`, `requireOnPosition_`, `requireCardAct_` are in `Auth.gs`. Credit stays with `MRF.Recruiter` (v163).
- `Departments.gs`, `Grades.gs`: department delay report (read only); grade and designation master data.

### Candidates and pipeline
- `Pipeline.gs`: one `Applications` card per candidate and position, `apiMoveStage` with per-stage validation, `apiMoveToLine` (same MRF only), backout and replacement MRF, reinstatement, follow-ups, job posts, JD and screening-question versions, structured screening.
- `FastTrack.gs`: fast-track route for W and T levels (stage skipping, department confirmation, document checks).
- `History.gs`, `Timeline.gs`: read-only candidate history across positions; lead-only card timeline from a field whitelist.
- `Archive.gs`, `Pool.gs`, `CvParse.gs`, `CvProfile.gs`: candidate archive and search index, talent-pool suggestions, free regex CV parser, CV profile checks.
- `Tasks.gs`: rule-driven to-do engine, interview scheduling, task rules and HOD contacts.
- `Jd.gs`, `JdMaster.gs`: JD folder and library; JD Master import (`jd_manage`, import is Admin only) and JD drafts.

### Specialist modules
- `Bgv.gs`, `BgvGov.gs`: background-verification cases, RAG deadlines, KRA exclusion while a former employer's release is awaited, restricted Drive folders, retention purge (Admin), audit export (`bgv_decide`). Only the case's recruiter or a lead may work a case.
- `Ctc.gs`: CTC calculator engine, saved calculations with approval and PDF letters, rules versions, role grants.
- `Org.gs`: organogram, manpower report import, department mapping, versioned manpower plan (`org_manage`).
- `VoiceScreen.gs`: voice screening calls through the provider's outbound API, Do Not Disturb register, per-person access and daily limits, requests, batch queue (`voiceQueueJob`), result ingest, review into a DRAFT screening. It never completes a screening by itself.
- `E2E.gs`: end-to-end test (`e2eTest`, run from the editor); it is pushed with the project (not in `.claspignore`).

## Subdirectories & System Boundaries
- [docs](./docs/EGM.md): documentation, including the separately deployed voice result receiver.
- `.github/workflows`: deploy workflow (`deploy.yml`) with a syntax-check job and an approval-gated deploy job; not source code, so it has no contract here.

## Global Invariants
- Access: a signed-in Google account must be an active row in `Users`; permissions come from `PERMS_` plus computed `voice_call` and CTC grants.
- Editing a position: `canEditLine_` (lead, or the position's recruiter); pipeline writes call `requireLineEdit_`.
- Every row write goes through `insert_`/`update_` under the script lock, with audit rows in `Audit_Log`.
- Nothing about a candidate is deleted by a move, reject, hold, withdrawal or backout; history is read through `History.gs`.
- Opt-out: the Do Not Disturb register is always checked before a real voice call (no setting turns it off), and a candidate who asks on a call not to be called again is added to it at once (`voiceOptoutFromCall_`); a person can undo it.
- Voice calls and results only produce DRAFT screenings; a person completes them.
- Code in `App.html` must not contain `//` or `/* */` comments (ADR-010 in the SSOT).
- No code or document in this repository stores recruitment data.

## Global Side Effects
- Google Sheets database (id in Script Property `DB_ID`); sheets are listed in the SSOT data model (§5).
- Script Properties: `DB_ID`, `SCHEMA_V` and related schema keys, `IDMAX_<table>`, dirty stamps (`DASH_DIRTY_AT`, `KPI_DIRTY_AT`), job and backup status, `VOICE_API_KEY`, archive and import state.
- Script cache: table copies, user list, grants, dashboard and KPI snapshots, day snapshots.
- Time triggers: `nightlyJob` (daily 01:00), `refreshDashboardJob` (30 minutes), `weeklySummaryJob` (Mondays, optional), `voiceQueueJob` (1 minute, only while a voice batch is waiting).
- Drive: CV, JD, CTC letter and backup folders; restricted BGV folders with per-user sharing.
- Mail: weekly summary and job-failure e-mails to Admins (`MailApp`).
- Network: the voice provider's outbound and analytics API (`UrlFetchApp`, `X-API-Key`).

## System Verification
- No automated test command is defined in this repository. Run `e2eTest()` from the Apps Script editor; the deploy workflow's `check` job runs a syntax gate over every `.gs` file and the page script.
