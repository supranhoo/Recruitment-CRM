# BFCL Recruitment CRM — Single Source of Truth

| | |
|---|---|
| **Document version** | 1.18 (v62 deployed: grades and designations separated; UI speed changes unreleased) |
| **Describes app version** | **v62** (Apps Script deployment version 62, 29 Sep 2026) |
| **Database schema version** | **27** (Script Property `SCHEMA_V`) |
| **Owner** | Ankit Choudhary (Admin, CRM product owner) |
| **Business owner** | Jaspal Bhanker, Sr GM-HR (Head of HR) |
| **Policy basis** | BFCL Recruitment Policy, Version 2.0, effective 16 July 2026, revision due 01 May 2027 |
| **Status** | Authoritative. Where this document and the code disagree, the code in the live deployment is the fact and this document must be corrected. |

> **How to maintain this document.** Every release adds a changelog entry (§14), updates any section whose behaviour changed, and bumps "Describes app version". Every design decision with lasting effect gets an ADR (§13). Items that are inferred rather than confirmed from release notes are marked *(inferred)*.

---

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Environment, links and accounts](#2-environment-links-and-accounts)
3. [Users, roles and permissions](#3-users-roles-and-permissions)
4. [Architecture](#4-architecture)
5. [Data model](#5-data-model)
5A. [JD Master](#5a-jd-master-v47-phase-1-of-the-jd-engine)
5B. [JD Maker](#5b-jd-maker-v49-phase-2-of-the-jd-engine)
5C. [JD and screening-question validation](#5c-jd-and-screening-question-validation-v52)
5D. [Candidate screening, fitment and sharing](#5d-candidate-screening-fitment-and-sharing-v53)
6. [Positions (MRF lines) and status](#6-positions-mrf-lines-and-status)
7. [TAT: rules, two clocks and calculation](#7-tat-rules-two-clocks-and-calculation)
8. [Candidates, CV bank, archive, talent pool and CV parser](#8-candidates-cv-bank-archive-talent-pool-and-cv-parser)
9. [Candidate pipeline](#9-candidate-pipeline)
10. [Daily work: daily log, My day, Daily review, to-do engine, interviews](#10-daily-work)
11. [Reporting: Overview, KPI scorecard, compliance, weekly email, data checks](#11-reporting)
12. [Administration, settings, jobs and operations](#12-administration-settings-jobs-and-operations)
13. [Architecture Decision Records (ADRs)](#13-architecture-decision-records-adrs)
14. [Changelog](#14-changelog)
15. [Open items, known risks and roadmap](#15-open-items-known-risks-and-roadmap)
16. [Glossary](#16-glossary)
17. [Appendix: validation and error messages](#17-appendix-validation-and-error-messages)

---

## 1. Purpose and scope

The BFCL Recruitment CRM replaces the Excel "MRF Tracker / CV Tracker" workbook used by the Talent Acquisition (TA) team of Bihar Foundry & Castings Ltd (BFCL), Ramgarh. The original brief (23 Sep 2026):

- *"Scrap the currently used Excel sheet into the CRM and then build the detailed CRM functionality."*
- It is an **internal tool of the recruitment department only**. All input is made by the recruitment team (for example, a department's MRF is entered by HR, not by the department). Existing manual processes stay; the CRM records and controls them.
- Deployed on **Google Apps Script**; data stored on **Google Drive / Google Sheets**; users access it through the Apps Script web-app link. The Excel workbook was the base of the data.

**In scope:** manpower requisitions (MRF lines) and their TAT; candidates and CVs; the per-candidate hiring pipeline from CV to onboarding; daily activity logging; the automatic to-do list; interview scheduling support; panel members and their unavailability; the monthly KPI scorecard and compliance evidence; oversight (Overview, Daily review, weekly email, data checks, change history); administration (users, roles, TAT rules, task rules, backups, archive).

**Out of scope (by decision):** sending email or messages from the app (ADR-012; the only exception is the opt-in weekly summary to leads); departments or candidates using the app directly; payroll/HRMS onboarding execution; paid AI services (ADR-018).

## 2. Environment, links and accounts

| Item | Value |
|---|---|
| Apps Script project | Script ID `122O8qTkAJrxOf9VFA6ETHArMe-t3w3wnMB0eZQD9cazv2u9zO28I6xNI`, owned by `ankitchoudharymba@gmail.com` |
| Live web app (fixed URL, never changes between versions) | `https://script.google.com/macros/s/AKfycbySIs5CLOQUp32R_roFHW3wlSlYe0cHah_-sNyJHPWLjxUTfI30RrmOD8PKQekX3s9xeg/exec` |
| Test deployment (HEAD, used before each publish) | `https://script.google.com/macros/s/AKfycbzoKHKHmTjgU5l2XK8XCXaiFNHp-sDzA3XmdZ_QsRSM/dev` |
| Database | Google Sheet "BFCL Recruitment CRM - Database" `1MY4Zpvb7TROiqj_fkbsYCP-gNZaRJAwldenhGC7UyVQ` (ID also held in Script Property `DB_ID`) |
| CV folder | Drive folder "BFCL Recruitment CRM - CVs" (Setting `CV_FOLDER_ID`); sub-folders **JD** (`JD_FOLDER_ID`), **Archive** (`CV_ARCHIVE_FOLDER_ID`), "Position documents", "Psychometric reports", "Joining documents" |
| Backups | Private "Backups" folder of the owner account; copies kept `BACKUP_KEEP_DAYS` (default 14) |
| Execution model | Web app **executes as the user accessing it**; access "anyone with a Google account", gated by the Users sheet (§3) |
| Time zone | `Asia/Kolkata` (IST, fixed +5:30; ADR-007) |
| Source package | `bfcl-recruitment-crm-source.zip` (all `.gs` and `.html` files; `E2E.gs` test harness excluded) |

**Consequence of "execute as user":** every active user needs **edit access to the database file and the CV folder**. Admin → Users grants and removes this automatically (§3.3). This is also the app's main structural weakness: users could edit the sheet directly, bypassing app rules (§15, R-1).

**Known Google limitation:** a browser signed into several Google accounts can fail to open Apps Script web apps ("multi-account bug"). Users should open the app in a browser profile with only their work account signed in.

## 3. Users, roles and permissions

### 3.1 Identity

- The signed-in Google account email (`Session.getActiveUser()`) is matched, case-insensitively, against the **Users** sheet. Only rows with `Active ≠ No` get in.
- Failure messages start with `ACCESS:`; the page shows a sign-in help screen instead of the app.
- The users list is cached for 5 minutes (`users_v1`); any change through Admin → Users clears the cache immediately.
- Each user has a **Recruiter_Name**: the name under which positions are assigned (`MRF.Recruiter`). Recruiters own positions **by name**, not by email.

### 3.2 Roles

Four roles (constant `ROLE_LIST`): **Admin, Head of HR, TA Lead, Recruiter**. Older or informal values in the Users sheet are normalised by `normRole_`: `Head`, `Head HR`, `HR Head`, `Head of HR` → Head of HR; `TA Lead`, `Lead TA`, `TL`, `Lead` → TA Lead; `Admin`, `Administrator` → Admin; anything else → Recruiter.

Permissions are **named** and mapped to roles in one place (`PERMS_` in Config.gs; ADR-021):

| Permission | Meaning | Recruiter | TA Lead | Head of HR | Admin |
|---|---|:-:|:-:|:-:|:-:|
| *(none)* | Use the app; view all positions, candidates, pipeline and reports; edit **own** positions, their pipeline and candidates; log own daily activity | ✓ | ✓ | ✓ | ✓ |
| `lead` | Team-wide powers: edit **all** positions, assign/reassign, move candidates back a stage, "Linked in error", correct locked fields (dates, pipeline fields after switch-over), edit locked daily-log entries, team views (Daily review, team to-dos), Admin page (data checks, change history, HOD contacts, task rules), observations, audit sample, edit/deactivate panel members | – | ✓ | ✓ | ✓ |
| `tat_view` | See Admin → TAT rules | – | ✓ | ✓ | ✓ |
| `withdraw_offer` | Close a position without a hire while a candidate holds an offer ("Offer withdrawn by the company") | – | – | ✓ | ✓ |
| `tat_edit` | Preview and save TAT rule changes | – | – | ✓ | ✓ |
| `users_view` | See Admin → Users | – | – | ✓ | ✓ |
| `users_edit` | Add, change, deactivate users; Fix access | – | – | – | ✓ |
| `jd_manage` | Sign off and edit the JD Master (grades, competency departments, duplicate groups, responsibilities, skills, department map) | – | ✓ | ✓ | ✓ |
| `system` | Backups, candidate archive run, system tools, JD library import | – | – | – | ✓ |

Server checks: `can_(u, perm)`, `isLead_(u) = can_(u,'lead')`, `requireAdmin_(u)` (role = Admin; used by Recalculate TAT). Client checks: `can(perm)` / `isLead()` from `S.boot.user.perms`. The Admin → **Roles & permissions** tab shows this matrix read-only.

**Ownership rule (`canEditLine_`):** a user may edit a position if they hold `lead` **or** the position's `Recruiter` equals their Recruiter_Name (case-insensitive). The same rule guards the position's pipeline, attachments and tasks.

**Current team (as recorded):** Ankit Choudhary — Admin; Jaspal Bhanker — Head of HR; recruiters Aditya, Shibashis, Tanaaz, Tishar, Manish (active) and Avinash, Purnima, Randhir (inactive). A TA Lead user is to be added.

### 3.3 User management (Admin → Users) — `Users.gs`

- **List:** name, email, role, recruiter name, status, access status (database / CV folder), added by/on.
- **Add / edit** (`apiSaveUser`, `users_edit`): email (valid format, must be the Google sign-in account), name, role, recruiter name, active.
- **No delete.** Users are deactivated, preserving history and the audit trail.
- **Automatic access** (`syncAccess_`): adding or reactivating shares the database file and CV folder as editor; deactivating removes the access. Failures never block the save; they are reported and can be retried with **Fix access** (`apiFixAccess`).
- **Guards:**
  - cannot deactivate yourself;
  - cannot remove your own Admin role;
  - the last active Admin is protected;
  - recruiter names must be unique;
  - a recruiter name **cannot be renamed** once referenced by positions, candidates, the daily log or KPI history (it would split history);
  - deactivating a user who still has open positions returns `needsReassign` with the list; the save completes only with `reassignTo` (a different recruiter), which reassigns those positions.
- `syncRecruiterList_` keeps **M_Recruiters** (the recruiter dropdown) in step: Recruiters and TA Leads appear; the list follows their active status.
- Every change is written to **Audit_Log**. Added_By/On and Updated_By/At columns were added in schema 19.

## 4. Architecture

### 4.1 Overview

```
 Browser (each team member, own Google account)
   Index.html  → Styles.html + App.html (single-page app, vanilla JS)
      │  google.script.run  (one bridge: api(fn, ...args) with version-check wrapper)
      ▼
 Apps Script web app (executes AS THE USER)
   Api.gs, Pipeline.gs, Tasks.gs, … (server functions apiXxx)
      │  Db.gs data layer (readTable_/insert_/update_/audit_, LockService, CacheService)
      ▼
 Google Sheet "Database" (one sheet per table)      Google Drive (CVs, JD, documents, archive, backups)
      ▲
 Time-driven triggers (owner account): nightlyJob 01:00 · refreshDashboardJob every 30 min · weeklySummaryJob Mon 09:00 (opt-in)
```

- **No external services.** No database server, no paid APIs, no email sending except the opt-in weekly summary (MailApp).
- **Browser libraries** are loaded on demand only where needed: pdf.js 3.11.174 (CV/document viewer and PDF text), JSZip 3.10.1 (Word .docx text including headers/footers), Tesseract.js 5.1.1 with English data (OCR for images and scanned PDFs), mammoth 1.6.0 (legacy viewer path). Sources: cdnjs / jsdelivr. Fonts: Barlow and Barlow Semi Condensed (Google Fonts).
- The page is served by `doGet()` → `Index` template, which inlines `Styles` and `App` with `include()`.

### 4.2 Source files

| File (editor slot) | Responsibility |
|---|---|
| `Main.gs` (file_1) | `doGet`, `include` |
| `Config.gs` (file_2) | Table definitions `T` (sheet, id column, id prefix, date columns, editable columns), `FUNNEL_METRICS`, roles, `PERMS_` |
| `Db.gs` (file_3) | Data access: `readTable_`, `readTableFrom_` (tail read), table cache, fast IST date formatting, `insert_`, `update_` (with guard + audit), `audit_`, `nextId_` (never-reused IDs), version stamps, `withLock_`, `prepare_`/`clean_` (formula-injection guard), `settings_` |
| `Auth.gs` (file_4) | `currentUser_`, `normRole_`, `can_`, `isLead_`, `requireAdmin_`, `canEditLine_`, users cache |
| `Tat.gs` (file_5) | TAT levels, rules lookup (`tatContext_`, `tatRulesMap_`, `ruleFor_`), `positionStatus_`, `tatStart_`/`posStart_`, `tatClock_`, `computeTat_`, `storedTat_`, `orgTat_`, `daysBetween_` |
| `Grades.gs` | Grades and designations (schema 27): `M_Designations`, `checkDesignation_`, `lineTitle_`, Admin → Grades & designations, migration |
| `Api.gs` (file_6) | Bootstrap, positions, daily log, candidates, CV upload/view, panel unavailability, dashboard computation, recompute/nightly job, version-check fetch (`apiFetch`), packed lists (`apiPacked`) |
| `Setup.gs` (file_7) | One-time `setup()` (sheets check, CV folder, admin user, nightly trigger), `shareWithTeam()` |
| `Import.gs` (file_8) | One-time `importDatabase()` from the migrated Excel data |
| `Index.html` / `Styles.html` / `App.html` (file_9/10/11) | Page shell, CSS design system, all client logic |
| file_13 (concatenation) | `Dashboard.gs` (snapshot), `Kpi.gs`, `Compliance.gs` (**schema upgrades** + observations, audit sample, documents, panel master), `Admin.gs` (backups, change history, data checks, weekly email), `DayReview.gs`, `Pipeline.gs`, `Jd.gs`, `Tasks.gs`, `Reconcile.gs` (switch-over check), `Closure.gs`, `Archive.gs`, `Pool.gs`, `CvParse.gs`, `Users.gs`, `TatRules.gs` |
| `E2E.gs` | End-to-end test harness (not deployed in the source zip) |

### 4.3 Request flow and client state

1. Page load → skeleton shell (§4.6) → `apiBootstrap()` returns the user (name, role, perms), master lists (grades, departments, recruiters, lists, panel members), settings needed by the page, `tatRules`, cut-over date and archive days. Bootstrap runs `ensureSchema_()` (§4.8).
2. Navigation is client-side (hash routes: `#overview`, `#myday`, `#review`, `#positions`, `#pipeline`, `#candidates`, `#daily`, `#kpi`, `#compliance`, `#panel`, `#admin`). Global state object `S`.
3. Records open in a right-hand **drawer** (up to 1,000 px wide; ≤ 94 % of the screen). Files (CVs, JDs, BGV reports) open in an **in-app viewer**, fetched as base64 with the user's own Drive access (limit 15 MB) so browser account mix-ups don't matter.
4. Every server function first resolves the user (`currentUser_`), so nothing is reachable without a Users-sheet entry.

### 4.4 Performance design (see ADR-003, 005, 006, 007, 008, 009)

| Layer | Mechanism |
|---|---|
| Overview | Never computed on page load. Reads a **snapshot** (script cache `dash_v1`, then `Dash_Snapshot` sheet). Rebuilt by **Refresh** button, by the 30-minute trigger when `DASH_DIRTY_AT` is newer than the snapshot, and nightly. Saves only mark it dirty. |
| Small tables | `CACHED_TABLES_` = Settings, M_Grades, M_Designations, TAT_Rules, M_Recruiters, M_Lists, M_Departments, KPI_Targets, M_Panel_Members, Users — script cache 10 minutes (`tbl3_<name>`), dropped on every app write to that table. Sheets under 1,000 rows are read in one trip. |
| Growing tables | `readTableFrom_(name, dateField, from)` reads only the tail from the first row on/after a date (Daily_Funnel, Audit_Log, Stage_History, Candidates). |
| Dates | `fmt_`/`ymd_` compute IST with a fixed +5:30 offset (≈400× faster than `Utilities.formatDate`, identical output); any other zone or pattern falls back to Google's formatter. |
| Payload | Big lists are sent **packed** as `{cols, rows}` (≈ ⅓ size) and only list columns; full records load when opened. After a save, only the changed row is refreshed (`apiGetPosition`). |
| Version check ("ETag") | Each table has a **version stamp** bumped on every write (`bumpStamp_`, cache TTL 1 h). `apiFetch(fn, args, known)` returns `{same:true}` when the stamps (and the period: per day / per hour) are unchanged. Covered: Positions (MRF, M_Grades, Settings, Users; per day), Candidates, Daily log (per day), Pipeline board (Applications, Stage_History, Followups, Candidates, MRF, Job_Posts, Interviews, M_Panel_Members; per hour). Client copies are kept **in memory only**. |
| Daily review (past days) | Pre-computed per day (`daysnap2_<ver>_<date>`, up to 6 h), invalidated precisely by writes touching that day; reassignment/team changes clear all days; today is always live. The 30-minute job pre-builds yesterday. |
| Tasks | Computed from data, cached until underlying data changes or 10 minutes; state reconciled in the background every 30 minutes. |
| KPIs | Cached per financial year; refreshed after data changes or on request. |
| Archive index | Slim candidate index (ID, name, mobile, email, …) cached in chunks per archive version, used for duplicate checks, names and search. |
| Candidates page | Server-side search, one page at a time (`apiSearchCandidates`), so it stays fast at 10,000+ candidates. |

Measured on the live app after the speed work (v23–v24): app start-up 1.2–1.6 s; Positions list 1.5–2.5 s (≈0.5–0.8 s when unchanged); Daily review (past day) 1.0–1.3 s; My day / today's review ≈3.5 s (computed live).

### 4.5 Concurrency, integrity and IDs

- **Locking:** every insert/update/multi-row operation runs inside `withLock_` (script lock, 20 s wait; message *"Someone else is saving right now. Try again in a few seconds."*). Locks are **not re-entrant**; code called inside a lock uses lock-free variants (e.g. `syncGradeTableNoLock_`).
- **Formula injection:** text beginning with `=`, `+` or `@` is stored as plain text by prefixing an apostrophe (`clean_`); all text is trimmed.
- **IDs are never reused (ADR-016):** `nextId_` issues `prefix + zero-padded (max(highest in sheet, highest ever issued) + 1)`. The highest ever issued is kept in Script Property `IDMAX_<table>`, seeded once from Audit_Log. Prefixes: MRL- (positions), DLY- (daily log), CAN- (candidates), PNL- (unavailability), OBS-, PM-, DS-, APP-, SH-, JP-, FU-, AUD-, TR- (TAT rules); tasks use deterministic keys.
- **Audit trail:** `update_` writes one Audit_Log row per changed field (old → new, user, time); creates and special actions are logged too. Calculated clock fields (Pos_*) are **not** stored or audited.
- **Only calculated TAT fields are stored:** `storedTat_()` copies exactly `Position_Status, Standard_TAT, Exemption_Days, Final_TAT, TAT_End_Date, Days_Taken, TAT_Result` onto the position row.

### 4.6 User interface shell

- **Side panel (rail)** defined once (`buildRail`): groups *Daily work* (Overview, My day, Daily review — leads only, Positions, Pipeline, Candidates, Daily log), *Reports* (KPI scorecard, Compliance), *Setup* (Interview panel, Admin — leads only). Head: brand "BFCL / RECRUITMENT" and the only collapse toggle. Foot: profile (initials avatar, name, role, email tooltip). Collapses to a 68 px icon rail with tooltips; preference stored in `localStorage['bfcl.rail']`; screens under 1,100 px start collapsed; phones get a bottom bar. The menu scrolls while the profile stays pinned. No blue top bar (removed in v44).
- **Loading skeletons** (v27): shown only if loading takes > ~0.25 s, kept ≥ 0.4 s once shown; shaped like the real content; shimmer disabled under "reduce motion"; screen readers announce "Loading …".
- **Accessibility:** tabs use `role="tab"`/`aria-selected`; toasts are `aria-live`; drawer has a labelled close button.

### 4.7 The comment-stripping rule (ADR-010)

Google's HTML service can mangle inline scripts containing `//` or `/* */` in some contexts (it broke the app in v13). **Rule:** `App.html`'s `<script>` must contain no `//`, `/*` or `*/` at all, including inside strings. URLs are built as `'https:' + String.fromCharCode(47, 47) + …` or with escaped slashes `'https:\/\/…'`. Every change is checked mechanically before deploy.

### 4.8 Schema upgrades

`ensureSchema_()` (Compliance.gs) runs on bootstrap and other entry points. If Script Property `SCHEMA_V` ≥ `SCHEMA_VERSION` it costs one property read; otherwise, under the lock, it runs every idempotent step (add missing columns/sheets, seeds, migrations) and records the new version. Current: **21**. Steps, in order: BGV & panel columns on MRF → seed panel members → `CV_Reviewed` on Daily_Funnel → pipeline sheets (Applications, Stage_History, Job_Posts, Followups; existing linked candidates get a card) → JD/SQ confirmed dates → JD folder migration → Approved_On/Assigned_On → task sheets → replacement columns (Parent_Line_ID, Replaced_By, Replaced_On, TAT_Start_From) and per-candidate offer fields on Applications → reconcile columns → closure columns → panel To_Date/Kind → archive → pool fields → parse log → Users audit columns → **TAT_Rules seed** → **JD Master sheets (schema 21)** → Daily_Summary, psychometric columns, Observations, Audit_Checks → `KPI_CAPTURE_FROM` default (next month).

### 4.9 Background jobs (triggers run under the account that installed them — the Admin)

| Trigger | Schedule | Does |
|---|---|---|
| `nightlyJob` | Daily 01:00 | Backup (`backupDb_`), recompute stored TAT for all positions, rebuild Overview snapshot |
| `refreshDashboardJob` | Every 30 min | Rebuild snapshot if data changed; reconcile tasks (record new / critical / resolved); pre-build yesterday's Daily review; daily candidate archive and CV moves (`archiveDaily_`) |
| `weeklySummaryJob` | Mondays 09:00 (only when turned on) | Weekly summary email to leads + `WEEKLY_SUMMARY_TO` |

`installTriggers()` (safe to re-run) installs the nightly and 30-minute jobs; Admin → Tools turns the weekly one on/off.

## 5. Data model

All tables are sheets in the database file; row 1 holds headers; columns are addressed by header name, so column order does not matter. Date columns listed in `T.<table>.dates` are parsed from `yyyy-MM-dd` on write and returned as `yyyy-MM-dd` strings. Only columns in `T.<table>.editable` can be written from the client (`prepare_`).

### 5.1 Core tables

| Sheet | Key | Purpose and columns |
|---|---|---|
| **MRF** | `Line_ID` (MRL-) | One row **per resource** (a 3-position MRF = 3 lines, same MRF_No). Requisition: MRF_No, Receipt_Date, Position, Grade, Dept, Recruiter, No_Of_Positions, Approval_Status, No_Vacancy_Date, Not_Needed_Date, Approved_On, Assigned_On, Justification, Budget_CTC, Vacancy_Reason, MRF_Form_File, JD_Text, JD_File, JD_Confirmed_Date, Screening_Questions, SQ_Confirmed_Date, Tech_Panel, Final_Panel, Notice_Period_Days, Remarks. Offer/joining (pipeline-derived after switch-over): Offer_Sent, Offer_Date, EDOJ, Actual_DOJ, Backout_Date, Candidate_ID. BGV: BGV_Required (Auto/Yes/No), BGV_Prev_Org_Date (initiated), BGV_Current_Org_Date, BGV_Remarks, BGV_Prev_Org_File, BGV_Current_Org_File. Replacement: Parent_Line_ID, Replaced_By, Replaced_On, TAT_Start_From. Closure: Closure_Reason, Closure_Requested_By, Hold_Days, Hold_Log. Switch-over: Reconciled_On/By, Reconcile_Note. Stored TAT: Position_Status, Standard_TAT, Exemption_Days, Final_TAT, TAT_End_Date, Days_Taken, TAT_Result. Legacy_Row; Created/Updated By/At. |
| **Candidates** | `Candidate_ID` (CAN-) | Person record: Name, Mobile (10 digits), Email, Education, Relevant_Experience, Current_CTC, Current_Designation, Current_Company, Offered_Designation, Position, Dept, Business_Unit, Division, Line_ID (current link), CV_Box, CV_File_URL, Possible_Duplicate_Of, Sourced_By, Source_Channel, Notes; interviews (legacy fields): Tech_/HR_Interview_Date/By/Result, Interview_Remarks, DOJ; psychometric: Psychometric_Status/Date/Score/Report/File; pool profile: Function_Area, Key_Skills, Total_Exp_Years, Current_Location, Expected_CTC, Notice_Days; Last_Activity, Legacy_SNo, Legacy_Row; Created/Updated. |
| **Candidates_Archive** | `Candidate_ID` | Same columns + Archived_On, Archive_Reason, CV_Archived. |
| **Applications** | `App_ID` (APP-) | One card per candidate per position: Candidate_ID, Line_ID, MRF_No, Recruiter, **Stage**, **Status** (Active / Rejected / On hold / Withdrawn / Removed), Status_Reason, Stage_Since, Screening_JSON, Docs_JSON, Docs_File, Offer_CTC, Offer_Letter_File, Offer_Date, Offer_Accepted_On, EDOJ, Actual_DOJ, Backout_Date, Backout_Reason, Risk, Next_Followup, Onboard_JSON. |
| **Stage_History** | `Hist_ID` (SH-) | Append-only: App_ID, Candidate_ID, Line_ID, Recruiter, From_Stage, To_Stage, Outcome, Note, Changed_By, Changed_At. **Source of the scorecard after switch-over.** |
| **Daily_Funnel** | `Entry_ID` (DLY-) | Daily log: Line_ID, MRF_No, Entry_Date, Recruiter, CV_Sourced, CV_Reviewed, HR_1st_Round, CV_Shared_Dept, Shortlisted_Dept, Interviews_Done, Selected_Final, FB_From_Dept, Remarks, Exemption_Days, Created_By/At. |
| **Daily_Summary** | `Summary_ID` (DS-) | Recruiter's day note and task list: Summary_Date, Recruiter, Overview, Tasks_JSON. |
| **Job_Posts** | `Post_ID` (JP-) | Line_ID, MRF_No, Post_Type (internal/external), Channel, Posted_On, Closes_On, Reference, Status, Notes. v52 adds JD_Version, SQ_Version (versions the post was made with), Override_Reason, Override_By (Head of HR / Admin posting before both were final). |
| **Screenings** (v53) | `Screen_ID` (SCR-nnnnn) | One screening per candidate per position (App_ID): Line_ID, Candidate_ID, MRF_No, Position, SQ_Doc_ID, SQ_Version, JD_Version, Items_JSON (snapshot of the questions used), Answers_JSON ({id: {a answer, r rating M/P/G, o override}}), Note, Band, Score_Pct, Met, Partly, Gaps, Total, KO_Failed, Status (Draft / Complete), Shared_On, Shared_With, Share_Reason. Text written with the text guard. |
| **Position_Docs** (v52) | `Doc_ID` (PDV-nnnnn) | Every JD and screening-question version of a position: Line_ID, MRF_No, Doc_Type (JD / SQ), Version (1, 2 …), Status (Draft, Shared, Changes requested, Final, Superseded, Re-confirm), Content (typed JD or questions JSON), File_URL, Source, Shared_On, Shared_With, Response_On, Response, Dept_Comments, Final_On, Note. Text is written with the JD-library text guard (§5A). |
| **Followups** | `FU_ID` (FU-) | Pre-joining check-ins: App_ID, Candidate_ID, Line_ID, FU_Date, Mode, Response, Risk (Green/Amber/Red), Next_Date, Note, By. |
| **Interviews** | `Interview_ID` | App_ID, Candidate_ID, Line_ID, Recruiter, Round (Technical/HR), Mode (Teams/In person), Start, Duration_Min, Location, Panel, Status, Attendance_Confirmed, Unavailable, Notes. |
| **Tasks** | `Task_Key` | Task state: Rule, Recruiter, Line_ID, App_ID, Title, Context, First_Seen, Critical_At, Resolved_At, Chase_Count, Last_Chased_At, Snoozed_Until, Snooze_Reason, Done_At, Done_By, Updated_At. |
| **Task_Actions** | `Action_ID` | Append-only log of chased / done / snoozed. |
| **Panel_Unavailability** | `Entry_ID` (PNL-) | Panel_Member, Department, Designation, Interview_For, Date, To_Date, Kind (Full days / Part of a day), From_Time, To_Time, Reason, Availability_Status, Remarks. |
| **Observations** | `Obs_ID` (OBS-) | Process-adherence findings: Obs_Date, Line_ID, MRF_No, Recruiter, Type, Description, Status. |
| **Audit_Checks** | `Audit_ID` (AUD-) | Monthly 20 % sample: Month, Entity, Record_ID, Label, Recruiter, Result (Pending/Correct/Error), Error_Field, Critical, Remarks. |
| **TAT_Rules** | `Rule_ID` (TR-) | Version_ID, Effective_From, Level, Standard_Days, Grace_Days, Risk_Pct, Status (Active/Superseded), Note, Created_By/At. |
| **CV_Parse_Log** | `Log_ID` | Candidate_ID, File_Name, Parsed_JSON, Saved_JSON, Chars, By, At (parser pilot accuracy). |
| **Audit_Log** | — | Timestamp, User, Sheet, Record_ID, Action, Field, Old_Value, New_Value. Append-only change history. |

### 5.1a JD Master tables (schema 21)

| Sheet | Key | Contents |
|---|---|---|
| **JDM_Templates** | `JD_ID` (JD-nnn) | Job profiles from the workbook's JD_Register: function, job family, unit, division, department, designation, grade (inferred) and band, grade basis, reporting line, role summary, experience and qualification as written, source file, competency department and mapping basis; Status (Active / Variant / Retired), Primary_JD; sign-off columns Grade_/Dept_/Dup_Confirmed_By/On; Review_Note |
| **JDM_Statements** | `Stmt_ID` (workbook key `JD-001|1`, or `JST-nnnnn` when added in the app) | Responsibility statements: JD_ID, Seq, KRA area as written, standard KRA category, text, Source (Workbook / App), Status (Active / Retired) |
| **JDM_Skills** | `Skill_ID` (workbook key, or `JSK-nnnnn`) | Skill statements: type (Technical / Functional, Behavioural / Leadership), suggested framework competency |
| **JDM_Competencies** | `Code` | The 368 framework competencies with category, criticality and L1–L5 definitions, assessment method |
| **JDM_Comp_Levels** | Comp_Dept + Code | Required level (0–5) of each competency per framework department (75 + Common Core) for every grade W5…M1 |
| **JDM_Grades / JDM_Qual_Norms / JDM_Band_KRAs / JDM_KRA_Categories** | — | Grade master (band, typical designations, recommended experience), qualification by job family × band, standard responsibilities per band (38 in 6 bands), 23 KRA categories |
| **JDM_Review_Notes** | — | The workbook's review log |
| **JDM_Dept_Map** | `CRM_Dept` | CRM department → framework department; Basis (Exact / Suggested / Confirmed / Not mapped), confirmed by/on, note with closest options |
| **JDM_Import_Log** | Lib_Version | Each import: version, when, who, file, counts, warnings |
| **JDM_Drafts** (v49) | `Draft_ID` (JDD-nnnnn) | Each JD generated for a position: Line_ID, MRF_No, Version (1.0, 2.0 …), Template_ID (library profile or `standards only`), Status (`Generated`), File_URL (Word file in the JD folder), Flags (review notes shown to the recruiter), Draft_JSON (the composed content, up to 45,000 characters), Created_By/At. Never replaced by a library import. |

### 5.2 Master and configuration tables

| Sheet | Columns | Notes |
|---|---|---|
| **Users** | Email, Name, Role, Recruiter_Name, Active, Added_By, Added_On, Updated_By, Updated_At | Team list and access (§3) |
| **M_Recruiters** | Recruiter, Email, Active | Recruiter dropdown, kept in sync by Users |
| **M_Grades** | Grade, Designations, Band, Standard_TAT_Days, Active | 17 levels; Standard_TAT_Days mirrors the TAT rule in force **today** (kept in sync; no longer the source of truth). From schema 27, **Designations is a read-only summary** of the grade's active rows in M_Designations; Band and Active are edited in Admin → Grades & designations (ADR-038) |
| **TAT_Exemptions** | Exemption_ID (TEX-), Line_ID, MRF_No, Type (Days / Pause), Days, From_Date, To_Date, Reason, Remark, Proof_File, Applies_Recruiter, Applies_Position, Status (Pending / Approved / Rejected / Withdrawn / Revoked), Requested_By/On, Decided_By/On, Decision_Note | Schema 28 (ADR-039). Applies_* are copied from the reason when decided |
| **M_Exemption_Reasons** | Reason, Default_Type, Applies_Recruiter, Applies_Position, Proof_Required, Max_Days, Active, Note | Schema 28. Seeded: Department / HOD delay; Candidate notice buy-out / DOJ shift by company; Niche / scarce skill, re-advertised (position TAT only); Budget, grade or MRF change mid-way (Pause) |
| **M_Designations** | Designation_ID (DSG-), Designation, Grade, Active, Note, Created/Updated | Schema 27. One row per designation per grade (M6 → Engineer, Senior Engineer, Officer, Senior Officer). Unique per grade; deactivated, never deleted |
| **M_Departments** | Dept, Business_Unit, Division, HOD_Name, HOD_Email | 85 departments; HOD contacts drive task messages |
| **M_Lists** | List, Value | Dropdown values (Approval_Status, Offer_Sent, Interview_Result, CV_Box, Source_Channel, …) |
| **M_Panel_Members** | Panel_ID (PM-), Name, Aliases, Designation, Department, Email, Roles, Active, Note | Seeded with 68 people from the CV Tracker's interviewer names; aliases merge spelling variants |
| **KPI_Targets** | Recruiter, KPI, Levels, TAT_Days, Notice_Exemption, Effective_From, Note | Recruiter `*` = team default (Timely closure 60 days all levels; M fulfilment 50 days M) |
| **Settings** | Key, Value, Note | §12.2 |
| **Dash_Snapshot** | — | Serialised Overview snapshot |
| **Import_Report / Import_Exceptions** | — | One-time migration record (13 checks; 71 exceptions) |

### 5.3 Migration from Excel (v1)

The workbook's MRF tracker (348 lines), CV tracker (1,087 candidates), daily funnel (≈4,230 rows) and panel unavailability were imported by `importDatabase()` (gzip+base64 payload) with `Legacy_Row` back-references, an import report and an exceptions list. Migrated records carry `Created_By = migration`, which the archive and activity rules ignore. Historical candidates are not linked to positions, so pipeline boards started empty (v16).

## 5A. JD Master (v47, phase 1 of the JD engine)

Purpose: turn the BFCL Master JD Library workbook (204 job profiles from the Protiviti exercise, 5,422 responsibilities, 1,024 skills, the Skill Competency Framework v3) into a governed library in the CRM, as the base for building and checking JDs for MRFs (phases 2–5, §15.4).

- **Page:** Setup → **JD Master** (everyone can view). Tabs: Overview, Job profiles, Departments, Norms.
- **Import (Admin, `system`):** the workbook is read in the browser (SheetJS 0.18.5) and sent in parts (1,500 rows per call) to staging sheets; the server maps columns by header name (order-independent, prefix matches for long headers), drops note/total rows, validates, then copies staging over the live `JDM_*` sheets in one write per sheet. **Blocking errors** (nothing changes): missing required sheet or column, duplicate JD ID or statement key, a grade outside W5–W1/T/M7–M1, a grade missing from Grade_Master. **Warnings** (import proceeds): orphan statements/skills (skipped), competency codes without definitions, profiles naming an unknown competency department, statements with a non-standard KRA category. Each import is a library version `L<n>`.
- **Re-import keeps work done in the app:** confirmed grades, departments and duplicate decisions; profiles edited in the app keep their edited fields; statements/skills added in the app are kept; workbook statements edited or retired in the app keep those changes; the department map is never overwritten where confirmed.
- **Sign-off (`jd_manage`):** confirm grades (one by one or in bulk for a filtered list, two-click confirm), confirm competency departments, choose the primary of each duplicate group (others become Variants), retire profiles; edit designation, reporting line, summary, experience and qualification; add, edit, retire and restore responsibilities (must use a standard KRA category) and skills; identical wording within a profile is refused. All changes are audited (bulk writes audited in one batch).
- **Department map:** every CRM department (master list and positions) is mapped to a framework department automatically where the names match exactly (normalised; `&` = `and`); otherwise a suggestion is made only when a single framework department clearly fits (token match on synonyms such as E&I, MGMT, MECH, plural stems). If the matched words fit more than one framework department the mapping is left **Not mapped** with the closest options, for a person to decide. At v47 on live-like data: 62 exact, 13 suggested (all correct), 10 not mapped.
- **Profile view:** grade and band, competency department, reporting line, source file; experience in the profile vs the workbook norm vs the **Policy Appendix F minimum** (flagged when below); qualification vs the job-family/band norm; the band's standard responsibilities; responsibilities grouped by KRA category; skills by type; every department and Common Core competency required at the profile's grade with its level definition (safety-critical and statutory highlighted).
- **Norms:** grades with workbook experience ranges vs policy minimums (all seven M grades flagged: M7 0–3 < 2, M6 2–6 < 4, M5 5–10 < 6, M4 8–15 < 10, M3 12–20 < 15, M2 15–25 < 20, M1 20+ < 25), qualification matrix, standard responsibilities by band, KRA categories with counts, workbook review notes.
- **Policy supersedes experience (v48):** the experience a JD asks for is the profile's figure **raised to the Policy Appendix F minimum** wherever it is lower; a profile with no figure takes the policy minimum; figures above the policy are kept. Minimums (degree/diploma, 12th/ITI): M1 25; M2 20; M3 15/20; M4 10/16; **M5 Asst / Dy Manager 8/14, M5 Junior Manager 6/12** (designation-aware; without a designation the stricter 8/14 applies); M6 4/12; M7 2/10; none for W and T grades. Grade norms are shown policy-applied (e.g. M4 8–15 → 10–15). Entering a minimum experience below the policy in the app is refused with the policy message. Talent-pool suggestions use the same designation-aware minimums.
- **Competencies per the framework (v48):** a profile's competencies are those the Skill Competency Framework requires for its competency department and the Common Core at its grade (level ≥ 1), with the level definitions. A competency department **can be confirmed only if the framework requires at least one department competency at the profile's grade**; bulk confirmation skips and lists profiles that fail this. Each skill statement is classified against the framework: department competency, common core, another department's matrix, or not in the framework (on the workbook data: 133 / 703 / 37 / 151).
- **Findings at import:** 89 of 194 active profiles are raised to the policy minimum (84 before the M5 split); the library is white-collar heavy (2 profiles at W3–W5 against 61 % of positions being W3–W5), so workmen JDs will be composed from band standards and competencies in phase 2.
- **Text protection (v50):** Google Sheets re-reads written strings as if typed, so workbook ranges such as `1-3`, `2-5`, `5-8`, `8-12`, `2-6`, `5-10`, `8-15`, `12-20` were stored as dates (e.g. 3 Jan 2026) and the Norms page showed dates (W4–W1) or wrong M ranges (M6 "6+", M4 "15+"). Every write to a `JDM_` sheet now stores strings Sheets could reinterpret (leading digit, `-`, `(`, `.`, currency, TRUE/FALSE, month-name + number) as plain text; real numbers and dates are unaffected. Cells already converted are read back as their original `M-D` text in every column except `_On`/`_At` dates, so no re-import is needed; the next import stores them as text.
- **Decisions assumed (user said "let's start" without answering):** policy minimum is binding; sign-off in the app; TA Lead or Head of HR approves library changes.

## 5B. JD Maker (v49, phase 2 of the JD engine)

Purpose: compose a JD for a position (MRF line) from the JD Master, let the recruiter adjust it, and produce the BFCL Word JD, saved to the JD folder and attached to the position.

- **Where:** Pipeline readiness bar → **Create JD** (shown when the user can edit the position); position form → **Create JD from JD Master** (next to *Choose from JD folder*; the position must be saved first). Anyone who can view a position can compose and download; saving needs edit rights on the line (its recruiter, TA Lead, Head of HR; server rule `canEditLine_`).
- **Prerequisites:** the library must be imported (otherwise: *The JD library has not been imported yet (JD Master).*); the position must have a grade (otherwise: *Set the position's grade before creating its JD.*). Grades T1–T4 are treated as T.
- **Library profile ranking** (`jdmCandidates_`, top 6, active profiles only): same competency department **+5**; shared designation words **+2 each, max +6** (generic level words such as manager, senior, assistant, head, officer, executive, trainee and grade titles are ignored; E and I are read as one token; plural *s* is dropped only for words longer than three letters, not ending in *ss*); same grade **+3**, else same grade band **+2**, else adjacent grade **+1**. A profile qualifies only with score ≥ 3 **and** (department match or a shared designation word). Ties: nearer grade, then JD ID. Each candidate shows its reasons.
- **Default choice:** staff roles take the top candidate. **Workman roles (W grades) use a profile only if it is in the same grade band, the same competency department and shares a designation word** — a different trade is never borrowed. The recruiter can pick another candidate or **No profile** (standards and competencies only).
- **Responsibilities:** taken from the chosen profile (active statements, in sequence, duplicates removed, grouped by KRA category) when the profile is in the same band or both are management/officer bands; otherwise only its job family is used and the band standards apply. A profile from another grade is flagged *re-levelled to <grade>: review items that belong to a different level*. The **band standard duties** are always included. The recruiter can untick any duty and add **Trade duties** (workman/supervisory) or **Additional duties** (one per line).
- **Competencies:** the framework requirements for the position's competency department and the Common Core **at the position's grade** (never the profile's grade), with SAFETY/STATUTORY markers. If the department is not mapped, the profile's department is used (flagged); with neither, only Common Core (flagged).
- **Qualification:** the qualification norm for the job family and the position's band. Job family = the profile's; otherwise the most common family in the competency department; otherwise the most common family among departments with the same function (e.g. *E And I* across plants). Flagged when inferred; flagged *enter with the HOD* when none is found.
- **Experience:** M grades — Policy Appendix F minimum (designation-aware for M5), raised further only by the profile's own figure when the profile is at the **same grade** (ADR-032); W and T grades — the profile figure at the same grade, else the lower bound of the grade norm. The 12th/ITI minimum is shown alongside for M3–M7.
- **Always flagged:** working conditions and preferred experience to be confirmed with the HOD.
- **Word document** (built in the browser with docx 9.6.1, loaded on first use): the approved compact layout — header with BFCL logo, title block (JD ref and version, *On confirmation*, MRF reference), 1 Position details, 2 Role purpose, 3 Key responsibilities (two columns by KRA category, band standard line), 4 Competency requirements (levels L5→L1; under each level one list in three columns, the competency department's items first, then the Common Core; no group sub-headings since v52, as every item listed is required of this role), 5 Skills, qualification and experience, 6 Working conditions and safety, 7 Approval (Recruiter prefilled, HOD, Head of HR; no employee acceptance box), footer with page numbers and source note. Typical length: 1 page for workmen, 2 pages for officers/managers.
- **Save to JD folder and attach** (`apiJdmSaveJd`): uploads the file through the standard JD upload (named by the JD naming rule), sets the position's JD file, records a `JDM_Drafts` row with the next version number. The next draft for the same position shows the following version.
- **Not in phase 2:** HOD confirmation (phase 4 — *JD confirmed* on the readiness bar is unchanged by generating a JD), suggested screening questions, standard workman profiles by trade × level (to be added to the library).

## 5C. JD and screening-question validation (v52)

Process (user instruction, 27 Sep): once the MRF is received, the proposed JD is shared with the department for validation; the department may ask for changes, which produce a revised JD until it is final; screening questions are then written from the final JD, shared, and finalised; only then is the job posted, with the final JD and questions.

- **Versions:** every JD and every set of questions is a numbered version in `Position_Docs`. Statuses: *Draft* (not shared) → *Shared* (with the department) → *Final* (validated) or *Changes requested* (the department's comments are recorded; the next version follows). A new version supersedes open drafts. Revising a final JD supersedes it, clears *JD final on* and *Questions final on*, and puts the latest questions into *Re-confirm*.
- **How a JD version is created:** Create JD (JD Master), choose from the JD folder, upload a file, type it in the panel, or change the JD text on the position form. Each creates a draft version with its source recorded (e.g. *Create JD (JD Master, profile JD-109)*).
- **Share:** records who (default: the department's HOD) and when (not in the future, not before the MRF received date; questions not before the JD's final date). The panel prepares the message: *Copy message*, and, when the HOD's email is on file, *Open in Outlook* and *Open Teams chat*. The JD file is attached by the recruiter.
- **Department's reply:** recorded by the recruiter: *Validated as is* (makes the version Final and sets *JD final on* / *Questions final on* on the position; for a JD also points the position's JD file/text to that version) or *Changes requested* (comments required). The reply date cannot be before the share date, and questions cannot be final before the JD.
- **Questions:** can only be saved and shared once the JD is final. *Suggest from the final JD* adds starter questions: qualification (from the Create JD draft or asked open), minimum experience (Create JD draft, else Policy Appendix F), relevant experience and up to three safety-critical / statutory competencies from the Create JD draft, current and expected CTC, notice period, location.
- **Posting:** a new job post is refused unless both the JD and the questions are final. The Head of HR (or Admin) can post earlier with a reason, recorded on the post. Every post records the JD and question versions. Live posts are flagged when the JD is being revised or when the final JD has moved to a later version.
- **Where:** Pipeline → **JD & questions** (everyone who can see the board; actions need edit rights on the position). The readiness bar shows *JD final* and *Questions final* with version, rounds and dates (e.g. *v2 final 27 Sep 2026 · 2 rounds*), and *Job posted* shows *ready to post* when both are final. *JD final on* and *Screening questions final on* on the position form are read-only.
- **To-dos:** share_jd, dept_reply, revise_doc, share_questions (§10), for open positions whose TAT started in the last 30 days.
- **Existing positions (migration at schema 23):** a JD with a confirmed date became Final v1 (dated), a JD without one became Draft v1; questions with a confirmed date (and a confirmed JD) became Final v1, otherwise Draft v1. Runs once.
- **Decisions (27 Sep, user approved the recommendations):** hard stop on posting with a Head of HR override and recorded reason; sourcing from the CV bank and referrals may start before posting; department reply time 24 h; departments reply by email/Teams and the recruiter records it; a revised JD always sends the questions back for re-confirmation.
- **Not included yet:** time-to-validate and revision-round figures in the KPI scorecard and reports (the data is recorded per version).

## 5D. Candidate screening, fitment and sharing (v53)

Process (user instruction, 27–28 Sep): once the screening questions are approved, the recruiter calls the candidate, records the answers on the same sheet, and shares the CV with the answered sheet with the department in one step; the fit (how the candidate meets the requirement and where the gaps are) must be clear to recruiter and HOD, and kept on the candidate's record even if the candidate is not selected.

- **Question model:** each question has an id (E1… eligibility, R1… role fit, P1… practical), short label, question text, type (text / number / yes-no), requirement ("Needed / meets if"), number rules (min; or max with a "partly" limit), importance (Must ×3, Important ×2, Nice to have ×1), knock-out flag (eligibility only), theme (role fit), source, "a good answer mentions" and "watch for" (recruiter guidance only). Older plain question lists are read as role-fit text questions.
- **Drafting from the final JD** (JD & questions → *Draft from the final JD*): uses the Create JD draft behind the final JD version, else a JD Master composition, else grade and policy only. Eligibility: qualification (knock-out), total experience from Policy Appendix F (knock-out, number), relevant experience from the JD (knock-out, number), rotational shifts (only when the role mentions shifts or is a W grade), plant location (knock-out), notice period (Important; meets ≤30 days, partly ≤60). Role fit: two highest-level technical competencies (Important), two safety-critical / statutory competencies (Must, with red flags), two key responsibilities, problem solving, leading a team (M1–M6 or reportees), records / ERP (Nice to have); requirements use the competency's level definition. Practical: current CTC, expected CTC, earliest joining, location and reason, currently employed, relatives in BFCL (Policy 17.2) — recorded, never scored.
- **Editor:** structured rows (section, label, question; type, requirement, importance, knock-out, number limits, theme; good answer / watch for / source), reorder, add, remove; saved as a new question version (v52 validation flow unchanged). *Download questions* produces the PDF for the HOD (status, summary strip, eligibility with red knock-outs, role fit by theme, practical details, assessment rules).
- **Screening:** Pipeline → candidate → *Record screening* (replaces the free-text Screened form when the position has final questions; moving to Screened without a completed screening is refused). Numbers and yes/no are rated automatically against the requirement (marked "auto"); the recruiter can override (recorded); descriptive answers are rated Meets / Partly / Gap. The fit updates live. *Complete screening* requires every scored answer rated; it moves a candidate at CV received to Screened. A screening keeps the question version it used; if the department later confirms new questions it is flagged, with *Start again on vN*.
- **Scoring:** Meets 1, Partly 0.5, Gap 0, weighted Must 3 / Important 2 / Nice 1; bands Strong ≥85%, Good 70–84%, Borderline 50–69%, Weak <50%; any knock-out rated Gap → Not eligible; not all rated → Incomplete. Shown as band + counts (e.g. *Good fit · 9 of 13 met · 3 partly · 1 gap · knock-outs 4/4 · 84%*).
- **Answered sheet (PDF, one page):** candidate, position, screened on / by / question version; fit strip; eligibility (requirement, needed, answer, rating); role fit (asked about, answer, rating); summary (strengths — *All eligibility met* first when true, then role-fit strengths; gaps; partly, each with the answer); recruiter's note; practical details. Recruiter guidance is not printed.
- **Share with department:** dialog with the fit, the two attachments (CV from the candidate record; screening PDF generated now) and an editable message (To: the department's HOD email from Admin → HOD contacts; subject; strengths, gaps, partly; feedback by next day). Actions: *Download files*; *Copy message*; *Open in Outlook* (Outlook web compose with recipient, subject and message; the same click downloads both files to drag in — Outlook does not allow a web app to attach files). Copy or Outlook records the share (who, when) and, if ticked, moves the candidate to *Shared with dept*. A Not eligible candidate needs a recorded reason. Automatic attachment needs Microsoft Graph with BFCL IT's app registration (not built).
- **Record:** candidate profile → *Screening history*: every position screened, band, counts, gaps, shared date, PDF. Pipeline cards show the fit chip.

## 6. Positions (MRF lines) and status

### 6.1 Position status (`positionStatus_`) — derived, never typed

Evaluated in this order:

| Condition | Status |
|---|---|
| `Replaced_By` is set | **Replaced** (closed after a backout; see §9.6) |
| Approval_Status = No Vacancy | **No Vacancy** (headcount withdrawn) |
| Approval_Status = Not Needed | **Not Needed** (cancelled by the department) |
| Approval_Status = On Hold | **On Hold** |
| Approval_Status = Approved and Offer_Sent ≠ Yes | **Open** |
| Approved, Offer_Sent = Yes, no Actual_DOJ | **Offered** |
| Approved, Offer_Sent = Yes, Actual_DOJ set | **Closed** |
| Anything else (blank approval) | *(blank)* |

"Active" statuses are Open and Offered. Replaced positions are excluded from open counts so a vacancy is counted once.

### 6.2 Creating and editing positions (`apiSavePosition`, `apiAddPositionLines`)

- Required: Position, Grade, Dept, MRF receipt date. **Designation** (schema 27, `checkDesignation_`): the form lists only the active designations of the grade picked; a **new** position must pick one when its grade has any; a value must belong to the grade (the line's existing value is kept if it was later deactivated or the grade's list changed); existing positions without one can still be saved. The grade dropdown shows grade and band only.
- A multi-position MRF is added as N identical lines (tracker keeps one row per resource).
- **Dates** (`assignDates_`, ADR-013): when Approval status is Approved and the approved date is blank, MRF approved on defaults to MRF received on; Position assigned on defaults to MRF approved on. Neither may be in the future; approved ≥ received; assigned ≥ approved. **Recruiters can set these dates only while blank**; after that only `lead` users can change them. **Reassigning** a position to another recruiter restarts the recruiter clock: Assigned_On becomes today, unless a `lead` user deliberately sets a different assigned date in the same save; the change history keeps the original.
- **JD / screening-question confirmation dates** (`checkConfirmDates_`): received ≤ JD confirmed ≤ SQ confirmed, none in the future; SQ date needs the JD date first and needs questions.
- Status-date rules: No Vacancy needs No_Vacancy_Date; Not Needed / On Hold need Not_Needed_Date; Actual DOJ requires Offer sent = Yes.
- **Ownership:** only the assigned recruiter or a `lead` user can edit (§3.2).
- On save the TAT is recomputed and the **stored** TAT fields written (§4.5); the Overview is marked dirty.

### 6.3 Switch-over lock (`guardPipelineFields_`, ADR-015)

From **`PIPELINE_CUTOVER`** (Setting; default `2026-10-05`):
- Offer sent, Offer letter date, Expected joining date, Actual joining date, Backout date and Selected candidate are **recorded from the pipeline only**. Recruiters cannot type them on the position form; `lead` users can correct them (logged).
- Approval status can only move to Not Needed / No Vacancy / On Hold through **Close without hiring**, and back through **Resume position** (§6.4), so every closure carries a reason.
- A **Replaced** position is read-only: *"Work on the replacement."*

### 6.4 Close without hiring and resume (`Closure.gs`, ADR-017)

**Close without hiring** (position panel or Pipeline board; Open or Offered positions only):

| Field | Rule |
|---|---|
| Outcome | *Cancelled by department* (Not Needed), *Headcount withdrawn* (No Vacancy), *On hold* |
| Date | Required; not in the future; not before the MRF receipt date |
| Reason | Required |
| Requested by | Who in the department asked |
| Candidates | Per active card: reject, keep on hold, or move to another **open** position the user can edit. Unlisted cards are rejected (kept on hold when the outcome is On hold) |

Effects: status and TAT stop on the date; open counts and KPIs exclude it; scheduled interviews are cancelled; the position's other tasks stop; an "Inform candidates and panel" task appears; the Daily review shows the closure. **If a candidate holds an offer**, only `withdraw_offer` (Head of HR, Admin) can close; the card becomes *Withdrawn — "Offer withdrawn by the company"*, which is **not** a candidate backout (no replacement MRF, no backout-rate effect). A position where a candidate has **joined** cannot be closed without a hire.

**Resume position** (On Hold only): resume date not in the future and not before the hold started. The days on hold are **added to `Hold_Days`** and appended to `Hold_Log`, and **excluded from TAT** (pause, not restart — decision 26 Sep). Held candidates can be reactivated.

**Backlog helper:** Open/Offered positions whose remarks match *cancelled, not required, not needed, no longer required, closed by, position closed, on hold, withdrawn, dropped, no vacancy* are listed so they can be closed properly.

### 6.5 JD library, screening questions, job posts, documents

- **JD folder (ADR-014):** one Drive folder named **JD** inside the CV folder holds every job description. `apiListJds` lists files (newest first) with the positions using each; `apiUseJd` attaches one file to one or many positions; JDs uploaded in the app are saved into the folder (named from the position). Google Docs are accepted. Older JDs were migrated once (`jdMigrate_`).
- **Screening questions** are set per position (`apiSaveScreeningQuestions`) with the date the department confirmed them; answers are captured at the *Screened* stage.
- **Job posts** (`apiSaveJobPost`): channel and posting date required. Internal postings (IJP) shorter than **15 working days** are flagged (Policy 7.4).
- **Attachments** (`apiUploadDoc` / `apiGetDoc`): PDF, Word, JPG, PNG, ≤ ~10 MB upload, viewer ≤ 15 MB. Types: MRF form, JD, BGV previous-employer report, current-employer BGV proof (Position documents); psychometric report (Psychometric reports); joining documents and offer letter (Joining documents).

### 6.6 Interview panel (Interview panel page)

- **Panel members master** (`M_Panel_Members`): anyone can add a member (duplicate names/aliases refused, matched ignoring titles like Sir/Mr/Dr); only `lead` users edit or deactivate. The position form's Technical and Final panel multi-selects are pre-filled from the policy panel matrix (§8.6 of the policy) by grade and can be adjusted.
- **Unavailability log** (`apiSavePanel`): *Full days* (From date – To date, max 90 days per entry) or *Part of a day* (date + from/to time; end after start). `panelConflicts_` flags any panel member unavailable on a date/overlapping time; interview scheduling refuses conflicts (§10.5). Marking a member unavailable on a scheduled interview writes an entry here automatically.

## 7. TAT: rules, two clocks and calculation

### 7.1 Policy basis

Policy 20.1: closure by grade from **MRF approval to joining date, excluding the MRF approved date** — W levels 20 days, M levels 50 days; **notice period > 30 days is added**. Appendix A defines M-level stage timings. Trainee levels are not stated in the policy.

### 7.2 Versioned rules (Admin → TAT rules; `Tat.gs`, `TatRules.gs`; ADR-023)

- **Levels (17):** W1–W5, M1–M7, T, T1–T4. T1–T4 follow T when they have no rule of their own.
- **Each rule row:** Level, Standard days (1–365, whole), Notice grace days (0–180, whole), At-risk threshold (50–99 %), **Effective from** date, Version ID, Status (Active / Superseded), Note, Created by/at.
- **Rule lookup (`ruleFor_`):** for a clock that started on date *S*, use the **latest Active version effective on or before S** (if S is before every version, the earliest one). A level with no rules falls back to M_Grades days + Settings grace/risk.
- **Baseline V1** (seeded by schema 20): every level, effective **all dates** (`1900-01-01`), from the grade table with **W1–W3 corrected to 20 days** per policy; M1–M7 = 50; W4–W5, T, T1–T4 = 20; grace 30; at-risk 80 %.
- **Changing rules** (`tat_edit`: Head of HR, Admin; TA Lead views):
  1. Edit the levels; changed rows highlight.
  2. Choose **Takes effect from** and the **apply mode**:
     - *Positions whose clock starts on or after this date* — earlier positions keep their rules, **past results don't change**; an existing version with the same date for that level is superseded;
     - *Every position, past and present* — all Active rows for those levels are superseded and the new values apply to all dates.
  3. **Preview impact** (mandatory before Save): recalculates every affected position under the proposal for both clocks, shows the number of positions that change, the result moves (e.g. *Recruiter: Achieved → Missed: 10*) and up to 60 examples. Nothing is saved.
  4. **Save**: writes a new version `V<n>` (superseded rows kept as history), syncs M_Grades to today's values, audits the change, drops caches and Daily-review snapshots, **recalculates stored TAT on every position immediately**, and marks the Overview dirty.
- The tab shows today's rule per level, any upcoming (future-dated) change, and the version history.

### 7.3 Two clocks (ADR-022)

| Clock | Starts at (`start`) | Used by |
|---|---|---|
| **Recruiter TAT** (stored fields) | `TAT_Start_From` ‖ Assigned_On ‖ Approved_On ‖ Receipt_Date (`tatStart_`) | Recruiters' lists and position progress bars; KPI scorecard; to-do "Positions past TAT"; stored TAT columns |
| **Position TAT** (`Pos_*`, calculated only) | `TAT_Start_From` ‖ Approved_On ‖ Receipt_Date (`posStart_`) | TA Lead / Head of HR / Admin lists (bars, "TAT used" sort); Overview; weekly email overdue list |

`TAT_Start_From` is set on replacement MRFs to the original position's start, so a backout never resets either clock. The position form shows both clocks side by side with their start dates, basis and rule versions; the browser preview (`previewTat`) mirrors the server using `S.boot.tatRules`.

### 7.4 Calculation (`tatClock_`, per clock)

```
rule        = ruleFor_(grade, start)
notice      = max(Notice_Period_Days − rule.grace, 0)        // only days above the grace; 0 if Notice_Ext_Status = Rejected
extra       = Σ approved TAT exemption days for this clock    // Type Days; Applies_Recruiter (recruiter clock) / Applies_Position (position clock)
exemption   = notice + extra                                  // stored Exemption_Days (recruiter clock)
allowed     = rule.std + exemption                            // Final_TAT
end         = Actual_DOJ
              ‖ No_Vacancy_Date            (status No Vacancy)
              ‖ Not_Needed_Date            (status Not Needed / On Hold)
              ‖ Replaced_On ‖ Backout_Date (status Replaced)
              ‖ today
paused      = days of approved Pause exemptions for this clock inside [start, end), not already on hold (Hold_Log), each day once
days        = max(0, calendarDaysBetween(start, end) − Hold_Days − paused)   // start day excluded
result      = Open/Offered : days > allowed → Overdue; days ≥ risk × allowed → At risk; else On track
              Replaced     : Replaced
              otherwise    : days > allowed → Missed; else Achieved
```

Calendar days (decision 26 Sep); notice adds only days above the grace; on-hold days excluded. Stored results are refreshed on every position save, nightly, on TAT rule save, and by Admin → Tools → Recalculate TAT (Admin).

**Known impact of the W1–W3 correction (v46, measured on live-like data):** 36 W1–W3 positions; 11 change result — 10 closed positions Achieved → Missed, 1 open On track → Overdue. Reversible via TAT rules (set 50 for every position, then 20 from a chosen date).

## 8. Candidates, CV bank, archive, talent pool and CV parser

### 8.1 Candidate records (`apiSaveCandidate`)

- Name required; mobile normalised to **10 digits**; email format checked.
- **Duplicate check** on mobile and email against active **and archived** candidates. A duplicate warns and needs an explicit override (`force`); an archived match offers **Restore** instead of a new record.
- A candidate saved with a position link gets a pipeline card automatically (`ensureApp_`).
- **CV upload** with the candidate form (PDF, Word, JPG, PNG; ~10 MB); replacing a CV keeps the old file in Drive. CVs open in the in-app viewer with the user's own access.

### 8.2 Candidates page and search (`apiSearchCandidates`, ADR-019)

Server-side, paged search. Every typed word must match somewhere (name, mobile, email, position, ID, designation, education, department). Filters: HR result, source, possible duplicates, has CV, linked position, archive scope (*exclude / include / only archived*), and pool profile filters (function, experience range, location, notice, expected CTC).

### 8.3 Archive (`Archive.gs`; decision 26 Sep)

- **Rule:** no activity for `ARCHIVE_DAYS` (default **180**) **and** no Active or On-hold pipeline card. Activity = latest of interview/DOJ/psychometric dates, and non-migration create/update times of the candidate and their cards.
- **Where:** rows move to **Candidates_Archive** (appended first, then the main sheet compacted in place — a failure can never lose a row); CV files move in batches to the **Archive** sub-folder (links keep working).
- **Effect:** archived candidates don't affect lists, search, to-dos or reports, but duplicate checks and "Include archived" search still see them.
- **Restore:** manual (`apiRestoreCandidate`) or automatic when an archived candidate is used again (added to a pipeline, reactivated, linked).
- **Runs** daily from the 30-minute job; Admin can run it now (`system`).

### 8.4 Talent pool (`Pool.gs`)

- The pool = candidates with **no Active or On-hold card** (added without a position, or whose last application ended). CVs can be saved **without a position**.
- Profile fields: Function_Area (fixed list, e.g. Production / Operations, Mechanical Maintenance, Electrical Maintenance, Instrumentation & Automation, …), Key_Skills, Total_Exp_Years (or first number in the legacy experience text), Current_Location, Expected_CTC (parsed to LPA from "8 LPA", "65000 per month", …), Notice_Days.
- **"Find candidates for this position"** (`apiSuggestForLine`) scores pool candidates: function matches the department's function **+3**; shared title/skill words **+2 each (max +4)** (stop-words ignored); experience vs the grade minimum from Policy Appendix F (degree: M1 25, M2 20, M3 15, M4 10, M5 6, M6 4, M7 2 years; 12th/ITI: M3 20, M4 16, M5 12, M6 12, M7 10) **+2** if met, **+1** if ≥ 75 %, **−1** if below; notice ≤ 30 days **+1**. Needs a function or title match and a score ≥ 2; ranked by score then recency; each result lists its reasons. One click adds to the pipeline.

### 8.5 Free CV parser (`CvParse.gs` + browser; ADR-018)

- **Where:** Candidates → Add candidate → **Fill from a CV** (one CV), and **Upload CVs** (bulk queue for quick review).
- **Text extraction in the browser:** PDF via pdf.js (lines rebuilt by position; email/phone links behind icons captured); Word .docx via JSZip (body **plus every header/footer**, text boxes, hyperlinks); images and scanned PDFs via **Tesseract.js OCR**, **two passes** (upscaled to ≈2,600 px with grayscale/contrast, plus native size; scanned PDF pages rendered at high resolution ×1.6). **No data leaves Google/the browser; no AI service; no cost.**
- **Parsing on the server** (`parseCvText_`): Name (`pickName_`: 2–4-word spans, title-word exclusion, scoring by email local part and "My name is"), Mobile (OCR digit fixes O→0, l/I/|→1, S→5, B→8 on number-like runs; landlines not mistaken for mobiles), Email ("name @ gmail . com", "[at]/[dot]", run-on addresses), Education (ordered levels + discipline from the same line), Total experience (incl. value on the line after the label), Current designation (incl. the title printed under the name), Current company, Location (known city list, "City New Delhi"), Current/Expected CTC, Notice days, Key skills (skill dictionary), Function area. Each field returns **found** or **check**.
- **Only empty form fields are filled**; the message says how many already had a value. The recruiter reviews before saving. The **duplicate check** runs immediately (active + archive).
- **Pilot measurement:** parsed vs saved values are logged per candidate (`CV_Parse_Log`); Admin → Tools → **CV parser accuracy** shows per field how often the value was kept, corrected or missed. Target: 30–50 real CVs before deciding whether any AI option is needed. Benchmark at v42: 43/43 fields correct on 8 test CVs in the browser; 52/52 on the sample suite.
- **"Show the text that was read"** helps diagnose misses (missing text = OCR/format issue; present text = parser pattern gap).

## 9. Candidate pipeline

### 9.1 Model (ADR-015)

One **candidate** (person) → one **application card per position** (`Applications`) → every move appended to **Stage_History**. The card is the only place a candidate's progress, offer and joining live; the position's offer/joining fields are derived from its live card; the daily scorecard, KPIs and to-dos read from the same moves.

### 9.2 Stages (the user's 12-step process, 23 Sep)

| # | Process step | Stage key | Stage name | Required when moving in |
|---|---|---|---|---|
| 1–4 | MRF, JD, screening questions, job post | — | *Position readiness strip* on the board (JD, questions, job post shown orange until done). Since v51 each step can be opened by anyone who can see the board, including read-only (closed / on-hold) boards: **View MRF** (signed MRF form in the in-app preview; the step shows approval status, approval date and *form attached* / *no signed form*), **View JD** (attached JD file in the preview, or the typed JD text in a dialog), **View questions** (read-only list with the department confirmation date; *Edit questions* for users who can edit the position). Step subtitles wrap instead of being cut off. | — |
| 5 | CV received | `Sourced` | CV received | — (card created) |
| 5 | Screening by recruiter | `Screened` | Screened by recruiter | Answers to the position's screening questions |
| 6 | Share with department | `Shared` | Shared with department | — (starts the 24 h HOD-feedback clock) |
| 7 | Post-confirmation | `Confirmed` | Dept confirmed for interview | — |
| 7 | Technical interview | `Technical` | Technical interview | Interview date and result (panel optional). Result *Reject…* → card Rejected; *Hold…* → card On hold |
| 8 | HR interview | `HR` | HR interview | Same as Technical |
| 9 | Document verification | `Docs` | Documents verified | Joining checklist sections A–H each *Verified* or *NA*, **or** an approved exception recorded (Policy 9.3; outcome logged "Conditional: …") |
| 10 | Offer | `Offer` | Offer released | Offer letter date (CTC and expected joining optional). Writes Offer_Sent = Yes, Offer_Date, EDOJ, Candidate_ID to the position → status **Offered** |
| 11 | Joining status check / fail-safe | `Prejoin` | Pre-joining follow-up | Offer acceptance date; risk set to Green |
| 12 | Joining | `Joined` | Joined | Actual joining date. Writes Actual_DOJ (and Offer_Sent = Yes) to the position → status **Closed**; candidate DOJ set |
| 12 | Onboarding | `Onboarded` | Onboarded | Induction date **and** buddy assigned (Policy 14.3); HRMS and 1/2/3-month check-ins recorded |

Joining document sections (Policy Appendix B): A Core joining pack · B Identity, age and address proof · C Education and technical qualification · D Employment history and compensation proof · E Payroll, tax, PF and ESI · F Medical, safety and verification · G Company declarations and acknowledgements · H Role-specific and operational documents.

### 9.3 Movement controls (`apiMoveStage`)

- Only the position's recruiter or a `lead` user can change its pipeline. The position must not be Replaced, closed without a hire, or on hold.
- The card must be **Active**.
- **Forward** moves may go to any later stage. **Moving back** (or re-recording the same stage) requires `lead`; a backward move clears all Daily-review snapshots and cancels, in the scorecard, the forward moves it undid (§10.3).
- **One live offer per position:** no card may enter Offer or later while another card on the position holds Offer, Pre-joining, Joined or Onboarded (`liveOfferHolder_`). Backups can advance up to Documents.
- Detail saves without moving (`apiSaveAppDetails`): screening answers, document checklist, onboarding details.

### 9.4 Card statuses (`apiSetAppStatus`)

Active · Rejected · On hold · Withdrawn · Removed (switch-over/"linked in error" only). Any status other than Active needs a reason. Reactivating needs an open position and, at Offer or later, no other live offer holder; archived candidates are restored automatically.

### 9.5 Pre-joining fail-safe (`apiAddFollowup`)

Check-ins record date, mode, response, **risk (Green / Amber / Red)** and the next check-in date. Alerts: HOD feedback overdue (card at *Shared* > 24 h), joiners at risk (Amber/Red), follow-ups due today (and Pre-joining cards with no next date). These show on the Overview, in the weekly email and as to-dos.

### 9.6 Backout and replacement MRF — Policy 9.5 (ADR-015)

Withdrawing a card at **Offer or Pre-joining** is a **backout**:
1. Backout date required; not in the future; not before that candidate's offer date. The backout stays on record under the candidate's name.
2. The original position closes as **Replaced** (Replaced_By, Replaced_On = backout date, Backout_Date, Candidate_ID).
3. A **replacement MRF** is created: MRF number `J00039` → `J00039-R1` → `J00039-R2` …; copies requirement fields (position, grade, department, recruiter, JD, questions, panel, budget, approval), `Parent_Line_ID` = original, Vacancy_Reason = Replacement, Approval = Approved, and **`TAT_Start_From` = the original's start**, so TAT continues across any number of backouts.
4. Other Active/On-hold cards (backups) move to the replacement with a history note; their scheduled interviews and candidate links move too.
5. A to-do "Replacement MRF: move the next candidate forward" is raised.

Effects: the vacancy is counted once (Replaced excluded from open counts; the closure counts when the replacement closes); backout rate counts named backout events. **Offer withdrawn by the company** (via Close without hiring) is *not* a backout.

### 9.7 Switch-over check (`Reconcile.gs`, ADR-015)

Before the switch-over date, Open/Offered positions whose typed details disagree with the pipeline are listed (banner count on Positions; recruiter filter; progress counts). Issues and fixes:

| Issue code | Meaning | Fix action |
|---|---|---|
| `orphan` | Card whose candidate record was deleted | **Remove card** (history kept) |
| `offer_unlinked` | Position marked Offered but no card holds the offer | **Who holds the offer?** — pick or create (name, optional 10-digit mobile) the holder at Offer or Pre-joining with offer/acceptance/expected dates; optionally record an **earlier backout** first (creates the replacement; the holder goes on the replacement) |
| `legacy_backout` | Backout recorded the old way (position reopened) | **Convert** to a Policy 9.5 backout, or **keep as is** with a note |
| `joined_open` | Card at Joined/Onboarded but no joining date on the position | **Record joining** (closes the position) |
| `maybe_closed` | Remarks suggest closed/held | Use **Close without hiring** |

**Keep as is** (`apiReconcileReviewed`) needs a note and removes the position from the list. **Correct a wrong link** (`apiUnlinkApp`, `lead`): removes a card linked by mistake without recording a backout ("Linked in error"; counts for nothing in the scorecard) and returns the position to the check. As of 26 Sep the check showed *"Nothing to fix"* after the team's clean-up (a few items remain to confirm, §15).

## 10. Daily work

### 10.1 Daily log (`Daily_Funnel`)

- Per position per day: CVs sourced, CVs reviewed, HR 1st round, shared with dept, shortlisted by dept, interviews done, selected (whole numbers ≥ 0), HOD feedback, remarks. At least one count or a remark. Date not in the future.
- **From the switch-over date only CVs sourced and CVs reviewed are typed**; the other columns are counted from candidate moves (ADR-015).
- **Edit window (v21):** recruiters can edit only entries **they** logged, **on the day they saved them**; locked from midnight. `lead` users can always correct.
- A "Today's tasks" strip shows the recruiter's open/critical counts and next 3 tasks.

### 10.2 My day and day notes (`Daily_Summary`)

My day (every user) shows today's activity tiles, the to-do list (top 7, critical first, "show all"), the day note and task checklist, and what the app recorded ("Picked up from the app"). Notes can be written for **today and yesterday** only (leads: any past day; never future).

### 10.3 Daily review (leads; `DayReview.gs`)

Per recruiter for a chosen date: funnel counts (typed and, from the switch-over, **derived from moves with the named candidates behind each number**), offers, joinings, candidates added, app changes made, day note, task activity (done / chased / snoozed) and **Missed** tasks, plus positions closed without a hire.

Scorecard derivation (`pipelineEvents_`, from `PIPELINE_CUTOVER`): HR 1st round = moves to Screened; Shared = moves to Shared; Shortlisted = moves to Confirmed; Interviews done = Technical/HR recorded; Selected = selected results; Offers = moves to Offer; Joined = moves to Joined; backouts = backout events; credited to the **position's recruiter**. Cards removed as *linked in error* (or at the switch-over clean-up) count for nothing. A backward move by a lead never counts and **cancels the earlier forward moves it undid**, even on earlier days (v35).

### 10.4 To-do engine (`Tasks.gs`, ADR-012)

**Principles:** tasks are **never typed**; each rule reads the pipeline/positions and creates a task for the **owning recruiter** when a policy deadline is near or past; tasks **close themselves** when the data shows the step done; the app **never sends messages** — each task carries a ready message and **Teams / Outlook deep links** the recruiter opens and sends from their own account (plus **Copy message** for WhatsApp/phone). Levels: Critical, Due, Info. Same-position tasks group on one line; one "Chase HOD feedback" task per HOD lists all waiting CVs.

**Buttons:** *I've chased* (records a chase; the task returns at the next reminder point), *Snooze* (reason required, time-limited; snoozed critical items still show in Daily review), *Done* (only for tasks the app cannot detect finishing).

**Rules** (defaults; hours from the event that starts the clock; Admin → Task rules lets leads change due/critical hours (0–720; critical ≥ due) and switch rules on/off, stored in `TASK_RULES_JSON`):

| Rule | Title | Due h | Critical h | Counts as missed | Policy |
|---|---|---|---|---|---|
| share_jd (v52) | Share the proposed JD with the department | 0 | 24 | ✓ | 8.2: JD reviewed with the department before sourcing; open positions started in the last 30 days |
| dept_reply (v52) | Chase the department: JD / questions reply | 24 | 48 | ✓ | Department validates within 24 h (the *reply time*; change it in Admin → To-do rules) |
| revise_doc (v52) | Revise with the department’s changes | 0 | 24 | ✓ | Changes requested: share the revised version |
| share_questions (v52) | Share (or re-confirm) screening questions | 0 | 24 | ✓ | Questions from the final JD, validated before posting |
| bgv_join (v55) | Start current-employer BGV | 0 | 48 | ✓ | Current-employer BGV within 2 days of joining; Manager+ or BGV required = Yes (never No); joinings in the last 30 days; closes when “Current employer BGV started on” is filled; missed judged by that date |
| share_cvs | Share CVs with the department | 48 | 72 | ✓ | App. A step 2: CVs within 72 h of MRF approval |
| hod_feedback | Chase HOD feedback | 24 | 48 | ✓ | App. A step 3: feedback within 24 h |
| schedule_interview | Schedule the interview | 0 | 72 | ✓ | App. A step 4: within 72 h of shortlisting |
| confirm_attendance | Confirm interview attendance | 0 | — | | Day before the interview |
| reschedule | Reschedule the interview | 0 | 0 | ✓ | Panel member unavailable |
| record_result | Record the interview result | 0 | 48 | ✓ | App. A step 6: decision within 48 h |
| psychometric | Psychometric (Mettl) test | 0 | — | ✓ | 8.7.1: Manager and above, before the final interview |
| release_offer | Release the offer | 24 | 72 | ✓ | App. A step 7: offer within 72 h of finalisation |
| bgv | Start background verification | 0 | 72 | ✓ | 9.1.1: BGV within 3 days of the offer (Manager+) |
| offer_acceptance | Chase offer acceptance | 72 | — | | 9.1.2: acceptance within 3 days |
| followup | Joining follow-up | 0 | — | ✓ | Check-in due; Red risk is critical |
| joining | Record the joining | 0 | 24 | ✓ | Joining day |
| onboarding | Complete onboarding (induction and buddy) | 0 | 48 | ✓ | 14.3: buddy on the day of joining |
| checkin | New-joiner check-in | 0 | — | | 14.5: 1st, 2nd, 3rd month for M levels |
| replacement_next | Replacement MRF: move the next candidate forward | 0 | 72 | ✓ | 9.5 |
| filled_cleanup | Position filled: close the remaining candidates | 0 | — | | Reject, hold or move candidates left on a filled position |
| inform_closed | Inform candidates and panel: position closed | 0 | — | | 18: keep candidates informed |
| switchover | Switch-over check: positions to fix | 0 | — | | Before the switch-over date |
| tat_overdue | Positions past TAT | 0 | — | | Recruiter clock |
| day_note | Write your day note | 0 | — | | After 5 pm when nothing is logged today |

**Missed** (Daily review): tasks that became critical before the day ended and were still open at its end, with lateness and chase count. **Recorded dates win (v34):** a step done on time but typed later (e.g. BGV initiated date) never counts as missed; a late one counts only for the days it was actually late. "Not chased" shows only on chaseable tasks.

**Where tasks appear:** My day (own), Daily log strip (own), position panel and Pipeline (that position), Daily review (per recruiter, leads), Overview (counts: own, or team for leads). State is kept in **Tasks** / **Task_Actions**; reconciled every 30 minutes.

**HOD contacts** (Admin → HOD contacts; `M_Departments.HOD_Name/HOD_Email`, lead-editable, email validated) address the pre-written messages.

### 10.5 Interview scheduling (`apiScheduleInterview`, `apiInterviewAction`)

From a pipeline card: round (Technical/HR), date, time, duration, mode (**Teams** or **In person**), location, panel (≥ 1). Refused if the time is more than an hour in the past or any panel member is logged unavailable (conflict text lists who and why). The recruiter then opens a pre-filled **Teams meeting / Outlook invite** from their own account (the app cannot see Teams replies). Actions: **Confirm** attendance; **Panel unavailable** (who + reason → automatic Panel_Unavailability entry + Reschedule task); **Cancel**. Closing a position cancels its scheduled interviews.

## 11. Reporting

### 11.1 Overview (all users; snapshot, §4.4)

Headline counts and TAT picture on the **Position clock**; funnel; per-recruiter figures; watch list of positions closest to/over TAT; pipeline alerts (HOD feedback > 24 h, joiners at risk, follow-ups due); task counts (own, or team for leads). Shows "Updated <time> by <name>" and a **Refresh** button.

### 11.2 KPI scorecard (`Kpi.gs`)

Financial-year grid (April–March), team or per recruiter, value + score (0–5) + drill-down to the exact records. Cached per FY.

| KPI | Definition | Score |
|---|---|---|
| **Timely closure of vacant positions** | Positions **filled in the month** (Closed, DOJ in month) within the recruiter's target days (KPI_Targets; default 60, all levels) + notice exemption (days above `NOTICE_GRACE_DAYS`, unless rejected) + approved recruiter exemptions, with on-hold and approved paused days not counted (schema 28) ÷ positions filled in the month; measured on the **recruiter clock** | 5 ≥100 %, 4 ≥95, 3 ≥90, 2 ≥85, 1 ≥80, else 0 |
| **Fulfilment of M-level positions within TAT** | M-level positions **targeted** in the month (due = start + target days (default 50) + exemption, or filled that month) that were filled within TAT ÷ targeted; months up to the current one | same bands |
| **Offer backout rate** | Backouts in the month ÷ offers made in the month | % only (scoring bands not yet given) |
| **Mettl psychometric test** | Shortlisted **Manager+** candidates in the month without a completed or waived test | 0 → 5, 1 → 3, >1 → 0 |
| **MRF & assessment process adherence** | Observations logged against the recruiter in the month | 0→5, 1→4, 2→3, 3→2, 4→1, >4→0 |
| **Background verification compliance** | New hires (Closed, DOJ in month) where BGV is required (BGV_Required = Yes, or Auto and Manager+) **missing** previous-employer BGV **initiated within 3 days after the offer** (Policy 9.1.1), or current-employer BGV **started within 2 days of joining** (pending until the deadline passes) | 0 → 5, 1 → 2, >1 → 0 |
| **Recruitment & CV tracker accuracy** | Errors in the month's 20 % audit sample | 0 → 5, else 0 |

- **Targets:** `KPI_Targets` rows with Recruiter `*` are team defaults; a named recruiter's row overrides from its Effective_From month; Levels = All, M, W or T.
- **Manager & above** = grades M1–M4; without a grade, judged from designation (Manager, AGM, DGM, GM, VP, President, Head, Director; excluding Assistant/Deputy/Junior Manager).
- The four **compliance KPIs** are scored only from **`KPI_CAPTURE_FROM`** (currently 2026-10). Every tracked month gets a cell for every active recruiter, so "0 misses" shows as a full score. Team rows sum numerators and denominators.

### 11.3 Compliance page

- **Observations** (lead-only entry): date, type — *Hiring started before MRF approval; MRF incomplete (JD / KRA / budget / grade); Candidate evaluation form missing; Interview panel not as per policy matrix; Offer issued without required approval; Other* — recruiter (or linked position), description, status.
- **Monthly audit** (lead): generates a random **20 %** sample of positions and candidates added or changed in the month (once per month); each item marked Correct or Error (error field required; Critical flag). Feeds tracker accuracy.
- Psychometric fields (status, date, score, report file) on candidates; BGV fields and files on positions ("Previous employer BGV **initiated** on" — relabelled in v34).

### 11.4 Weekly summary email (`Admin.gs`)

Off by default. Admin → Tools: **Send a test to me**, **Turn on/off**. Mondays 09:00, runs under the admin who turned it on. Recipients: every active Users row with a lead role plus `WEEKLY_SUMMARY_TO`. Content: open positions, offered awaiting joining, joined this month, positions past TAT (**Position clock**, most overdue first), pipeline alerts, KPI note ("Scored from …"). Uses MailApp (the one email the app sends; ADR-012 exception).

### 11.5 Data checks (Admin → Data checks; lead)

Grouped likely errors, each record clickable: positions missing key details; offer sent but no offer date; joining date before offer/MRF/assigned date; **joined on a day other than Monday or Thursday** (Policy 2.3); candidates with missing/invalid mobile; candidates sharing a mobile or email; selected candidates not linked to a position; pipeline cards without a candidate; offer on the position but no holder; backout recorded by reopening; joined in the pipeline but position not closed; remarks say closed/on hold but still open.

### 11.6 Change history (Admin → Change history; lead)

Audit_Log newest first (max 300 rows per view) with filters; every field change with old/new value, user and time.

## 12. Administration, settings, jobs and operations

### 12.1 Admin page tabs

| Tab | Who | Contents |
|---|---|---|
| Data checks | lead | §11.5 |
| Change history | lead | §11.6 |
| Tools | lead (system actions Admin) | Back up now; Recalculate TAT (Admin); weekly email test/on/off; archive status and **Archive now**; CV parser accuracy; database/folder links |
| HOD contacts | lead | Department → HOD name/email |
| Task rules | lead | Due/critical hours and on/off per rule |
| TAT exemptions | lead (act: `tat_exempt` = Head of HR, Admin) | Awaiting the Head of HR (oldest first, Approve / Reject), notice extensions to review (Verify / Reject), register with filters and CSV, reasons editor (add, deactivate; no rename) |
| Grades & designations | lead | Grades: band, active, add a grade (code + starting TAT days). Designations: add, rename (carried to every position of that grade using the old name), move to another grade (only while unused), deactivate, note. Short forms are expanded on save (Sr → Senior, Engr → Engineer, SE → Senior Engineer). All changes audited (`apiGradeSetup`, `apiSaveGradeSetup`) |
| TAT rules | tat_view (edit: tat_edit) | §7.2 |
| Users | users_view (edit: users_edit) | §3.3 |
| Roles & permissions | everyone with Admin page | Read-only matrix |

### 12.2 Settings (sheet `Settings`)

| Key | Default / current | Meaning |
|---|---|---|
| `PIPELINE_CUTOVER` | 2026-10-05 | Switch-over date: pipeline-only offers/joinings/backouts; scorecard from moves |
| `NOTICE_GRACE_DAYS` | 30 | Default notice grace (TAT rules carry their own per level) |
| `TAT_AT_RISK_PCT` | 0.8 | Default at-risk threshold (TAT rules carry their own) |
| `KPI_CAPTURE_FROM` | '2026-10 | First month scored for psychometric, BGV, observation and audit KPIs |
| `JOINING_WEEKDAYS` | Mon,Thu | Allowed joining days (Policy 2.3) |
| `ARCHIVE_DAYS` | 180 | Candidate inactivity before archiving |
| `BACKUP_KEEP_DAYS` | 14 | Backup retention |
| `WEEKLY_SUMMARY` / `WEEKLY_SUMMARY_TO` | Off / — | Weekly email on/off and extra recipients |
| `TASK_RULES_JSON` | — | Task rule overrides |
| `CV_FOLDER_ID`, `JD_FOLDER_ID`, `CV_ARCHIVE_FOLDER_ID` | set by setup | Drive folders |
| `APP_NAME` | BFCL Recruitment CRM | Display name |

Settings are cached up to 10 minutes; Admin → Tools → Recalculate TAT applies a change immediately.

### 12.3 Script Properties

`DB_ID`, `SCHEMA_V`, `IDMAX_<table>`, `DASH_DIRTY_AT`, `ARCHIVE_VER`, version stamps and snapshots live in CacheService (`ver_<table>`, `dash_v1`, `daysnap2_…`, `tbl3_…`, `users_v1`).

### 12.4 Backups

`backupDb_` copies the database into a private **Backups** folder nightly and on demand, keeping `BACKUP_KEEP_DAYS`.

### 12.5 Release procedure

1. Change the local source; run the checks: `node --check` on the concatenated server code and on the extracted page script; **no `//`, `/*`, `*/` in App.html's script** (§4.7).
2. Run the tests (§12.6).
3. Build line-diff patches per editor file with a **baseline check** (length + rolling hash `h = (h*31 + c) >>> 0`) and an **after-checksum**; apply them to the Monaco editor models; large patches in parts, only the last clicks **Save project to Drive**.
4. Reload the editor and verify every file hash (changed and unchanged).
5. Try on the **test deployment** where relevant, then **Deploy → Manage deployments → Edit → New version → Deploy** on the fixed deployment (URL never changes).
6. Update the local "live" baselines and the source zip; update this document (§14).
7. **Propagation caution (v25 incident):** for a short time after a release Google may serve a page built against the previous version's function list. New server functions must be tolerated as missing by the page, or introduced a release before the page calls them.

### 12.6 Test assets

| Suite | Checks |
|---|---|
| End-to-end server suite (`e2e_local.js`, local Apps Script mock over a copy of live data) | 95 |
| Feature suites | edit 8, assign 17, equiv 9, snapshot 13, etag 22, tasks 35, pipeline P1 18 / P2 14 / P3 24, fix 9, close 23, BGV 9, undo 7, panel 13, archive 17, pool 17, CV API 5, CV contact 8, OCR fix 7, roles 5, users 24, **TAT rules 23** |
| CV parser sample suite | 52/52 fields |
| Browser click-through (Playwright, 48 steps) | run twice per release |
| Release-specific browser checks | e.g. v46: 8/8 |

## 13. Architecture Decision Records (ADRs)

Format: **Context → Decision → Consequences.** Status is *Accepted* unless noted. Dates are when the decision was taken (2026).

**ADR-001 — Platform: Google Apps Script + Sheets + Drive** (23 Sep)
Context: internal tool for a ~6-person TA team; data lives in an Excel workbook; users have Google accounts; no budget for hosting; an initial React/TypeScript/Supabase plan was drafted first. Decision: a single Apps Script web app, Google Sheets as the database, Drive for files, the fixed Apps Script URL as the entry point. Consequences: zero hosting cost and familiar data; subject to Apps Script quotas (6-minute execution, ~0.5–1 s per server call, `google.script.run` payload limits), no real HTTP control (see ADR-006), and sheet-level access issues (ADR-004).

**ADR-002 — The Excel tracker is the data base; one row per resource** (23 Sep)
Decision: import the workbook as-is with `Legacy_Row` references, an import report and an exceptions list; keep "one MRF line per resource" as the tracker did. Consequences: history preserved and traceable; multi-position MRFs appear as several lines sharing an MRF number.

**ADR-003 — Overview from a snapshot, never computed on load** (23 Sep)
Context: Overview read ~5 sheets and recalculated 348 positions on every visit; must not threaten the 6-minute limit. Decision: pre-computed snapshot (cache + sheet), rebuilt on Refresh, every 30 minutes when data changed, and nightly; saves only set a dirty flag. Consequences: ~1 s Overview; figures can be up to 30 minutes old (shown with "Updated … by …").

**ADR-004 — Execute as the signed-in user; Users sheet gates access** (23 Sep)
Decision: the web app runs as each user; only active Users rows get in; everyone needs editor access to the database and CV folder. Consequences: per-user identity and audit trail, and Drive files open with the user's own rights; **but users can edit the sheet directly** (risk R-1). The proper fix (run as a single owner on Google Workspace with a private database) needs a Workspace account.

**ADR-005 — Performance by measurement** (25 Sep)
Decision: after profiling in the editor, (1) replace `Utilities.formatDate` with fixed-offset IST arithmetic (ADR-007), (2) read small sheets in one trip and cache small tables for 10 minutes, (3) read only the tail of growing sheets, (4) send packed, list-only columns and refresh single rows after saves. Consequences: typical screens 1–2.5 s (from 5–21 s), behaviour unchanged.

**ADR-006 — "ETag" as a version check, memory only** (25 Sep)
Context: requested HTTP ETags; `google.script.run` exposes no headers or status codes. Decision: per-table version stamps; the page sends the stamps it has and gets `{same:true}` when nothing changed; client copies held **in memory only** (no candidate data in browser storage). Consequences: unchanged lists return in ~0.5–0.8 s and the page can re-check on every visit (fresher data); no help for "today" views. The first release (v25) broke during Google's propagation window and was rolled back; re-released as v26.

**ADR-007 — Fixed IST offset for dates** (25 Sep)
Decision: India has no daylight saving, so date formatting uses +5:30 arithmetic; other zones/patterns fall back to Google's formatter. Consequences: ~400× faster; output verified identical on 3,000 dates.

**ADR-008 — Pre-computed Daily review for past days** (25 Sep)
Decision: cache each past day's whole-team review (≤ 6 h), invalidated precisely by writes that touch that day; today always live; yesterday pre-built by the 30-minute job. Consequences: past days 1.0–1.3 s; correctness proven by equivalence tests (pre-built = fresh).

**ADR-009 — Loading skeletons** (25 Sep)
Decision: content-shaped skeletons (designed on a Claude Design canvas) shown only after ~0.25 s and kept ≥ 0.4 s; respect reduce-motion; screen-reader labels. Consequences: no flash on fast loads, no layout jump.

**ADR-010 — No comment markers in the page script** (23 Sep)
Context: Google's HTML service stripped/mangled content around `//` in the served page, breaking the app (v13). Decision: App.html's script contains no `//`, `/*`, `*/` anywhere (URLs built with `String.fromCharCode(47,47)` or escaped slashes); checked mechanically every release; the served page is compared with the source after releases. Consequences: a small coding constraint; the bug class is eliminated.

**ADR-011 — In-app file viewer** (23 Sep)
Context: Drive links opened in the browser's default Google account, which lacked access. Decision: fetch files server-side with the user's own access and render PDFs/images in the page (Word: download). Consequences: works regardless of browser account; 15 MB limit.

**ADR-012 — The app does not send messages; tasks carry ready-made messages** (25 Sep)
Context: first plan emailed HODs automatically; the user revised it: *"we don't want to mail directly from the app, but recruiter should get tasks to do."* Decision: an automatic to-do engine; each task has Teams/Outlook deep links and copyable text; the recruiter sends from their own account; misses surface in the Daily review. Only exception: the opt-in weekly summary to leads. Consequences: no Microsoft 365 app registration, no mailbox or Gmail limits; the app can't see replies, so declines are recorded with one click and "confirm attendance" tasks prevent gaps.

**ADR-013 — MRF approved / position assigned dates** (25 Sep)
Decision: add both dates; approved defaults to received (when Approved), assigned defaults to approved; recruiters set them only while blank, leads correct later; reassignment restarts the recruiter's clock (history keeps the original). Consequences: TAT reflects when the recruiter actually got the position; migrated positions fall back to the received date, so historical results didn't move. *Superseded in part by ADR-022* (two clocks).

**ADR-014 — A single JD folder** (24 Sep)
Decision: one Drive folder named "JD" inside the CV folder; files there can be attached to many positions; JDs uploaded in the app are saved there. Consequences: one place to maintain JDs; reuse across positions.

**ADR-015 — Candidate-centric pipeline is the single source; Policy 9.5 replacement MRFs; switch-over** (25–26 Sep)
Context: J00039 — candidate A backed out, B got an offer; the position form had one offer slot, the daily log held untraceable numbers, and the pipeline ran alongside. The user: *"Once we have created a candidate anywhere, that candidate will move from one place to another instead of just random numbers on the daily scorecard."* Decisions:
- A candidate is created once; attaching to a position creates a card; every move is recorded; offers/joinings/backouts live on the card; position offer fields become derived and locked.
- **Policy 9.5:** a backout closes the position as *Replaced* and raises a linked replacement MRF (`-R1`, `-R2`), **TAT counted from the original start** (user decision 25 Sep).
- One live offer per position.
- "CVs sourced" and "CVs reviewed" stay typed; everything from HR screening onward is derived from moves.
- A **switch-over date** (`PIPELINE_CUTOVER`, 5 Oct 2026) after which the rules apply; a one-time **Switch-over check** reconciles open/offered positions; closed history stays as legacy.
Consequences: figures can't disagree and every number is traceable to named candidates; recruiters' routine changes (training needed); vacancies counted once; backouts visibly consume TAT.

**ADR-016 — IDs are never reused** (26 Sep)
Context: a test candidate row deleted directly in the sheet freed CAN-01088, which was reissued to a new person; an old card then showed the wrong name on J00039. Decision: remember the highest ID ever issued per table (Script Property, seeded from the audit log) and always issue above it. Consequences: deleting rows can no longer re-link history. Rows should still never be deleted in the sheet.

**ADR-017 — Close without hiring; On hold pauses TAT; company withdrawal is not a backout** (26 Sep)
Context: positions closed by departments stayed Open because the only route was changing Approval status. Decisions: an explicit *Close without hiring* action with outcome, date, reason, requested-by and candidate handling; after switch-over, status changes only through it; **On hold pauses TAT** (hold days excluded on resume — user's choice over restart or new MRF); a live offer can be withdrawn only by Head of HR/Admin and is recorded as *Offer withdrawn by the company*, not a backout. Consequences: every closure has a reason; TAT fair to recruiters; backout rate not polluted.

**ADR-018 — Free rule-based CV parser with browser OCR; no AI service for now** (26 Sep)
Context: a Gemini-based parser (multi-key rotation) was assessed and parked; the user asked for a lightweight parser, ideally free. Free AI tiers may use submitted data (conflict with Policy §19 and India's DPDP Act); paid AI needs billing, keys and a documented data-sharing decision. Decision: option A — text extraction in the browser (pdf.js, JSZip, Tesseract.js OCR), pattern-based parsing on the server, human review before save, and a measured pilot (30–50 CVs) before considering a hybrid "Improve with AI". Consequences: zero cost, no data leaves Google/the browser; weaker on name/company/designation for unusual layouts — measured via the accuracy report.

**ADR-019 — Scale: server-side search, archive at 180 days, talent pool** (26 Sep)
Context: 2,000–5,000 CVs expected in months; the Candidates page downloaded everything (450 KB at 1,087) and ~26 places read the full sheet. The "1,000 rows" figure was only a read-strategy switch, not a limit. Decisions: paged server search; slim cached index; archive inactive candidates (no activity for 180 days and no active/on-hold card) to a separate sheet and folder, still visible to duplicate checks, restorable; CVs can be kept without a position and suggested for positions. Consequences: normal processing unaffected by old CVs; duplicate detection covers the archive.

**ADR-020 — Daily-log edits only on the day saved** (25 Sep)
Decision: recruiters edit their own entries only on the day they saved them; leads correct later. Consequences: stable daily figures; corrections are visible and attributable.

**ADR-021 — Four roles with named permissions; no user deletion; automatic access** (26 Sep)
Decision: Admin, Head of HR, TA Lead, Recruiter; ~60 role checks replaced with named permissions mapped in one place (`PERMS_`), tested per role; Admin → Users with automatic sharing/unsharing of the database and CV folder, guards (self, last Admin, unique and non-renamable recruiter names, reassignment on deactivation) and full audit. TA Lead edits all positions (user decision). Consequences: least privilege; role changes take effect immediately; access no longer depends on running a script by hand.

**ADR-022 — Two TAT clocks** (26 Sep)
Context: Policy 20.1 measures from MRF approval; the team measures recruiters from assignment. User decision: *keep the assigned date for recruiters and MRF approval for TA Lead and Head of HR.* Decision: every position computes a Recruiter clock (stored; recruiter views, KPIs) and a Position clock (calculated; leadership views, Overview, weekly email); leads' lists show the Position clock; the form shows both. Consequences: no argument about "whose TAT"; stored columns unchanged for compatibility.

**ADR-023 — Versioned, effective-dated TAT rules with mandatory impact preview** (26 Sep)
Context: TAT days were one number per grade applied to past and present alike; W1–W3 were 50 days against the policy's 20. User decisions: rules configurable per level and **by period** (e.g. January ≠ February); on save choose "from an effective date (past unchanged)" or "recalculate everything"; W1–W3 = 20; calendar days; notice adds only days above 30; T/T1–T4 = 20 configurable; W and T stage timings start the same as M. Decision: `TAT_Rules` sheet of versioned rows; lookup by each clock's start date; superseded rows kept; preview required before save; stored TAT recalculated on save; M_Grades mirrors today's values. Consequences: history can be preserved or deliberately restated; the W1–W3 correction as seeded restates 11 past/open results (reversible).

**ADR-024 — Panel master with aliases; unavailability as date ranges** (23 & 26 Sep)
Decision: `M_Panel_Members` seeded from interviewer names with aliases merging spelling variants; panel selection by dropdown; unavailability as full-day ranges (≤ 90 days) or part-day slots, checked when scheduling. Consequences: consistent names; leave spanning days is respected.

**ADR-025 — Recorded dates win; BGV "initiated within 3 days"** (26 Sep)
Context: J00075's BGV started on time but was typed later and showed as missed; the form and KPI required BGV *before* the offer, contradicting Policy 9.1.1. Decision: Missed lists judge by the date entered; BGV compliant if initiated ≤ offer + 3 days; field relabelled "initiated on". Consequences: KPIs match the policy.

**ADR-026 — Scorecard corrections** (26 Sep)
Decision: cards removed as *linked in error* count for nothing; a lead's backward move never counts and cancels the forward moves it undid, even on earlier days. Consequences: corrections don't inflate or double-count recruiter figures.

**ADR-027 — KPI interpretations** (23 Sep; assumptions stated to and accepted by the user)
Timely closure uses a flat **60 days** for all levels (with the notice exemption); M-level fulfilment uses **50 days**; a position is "targeted" in the month its TAT deadline falls or when filled; **Manager & above = M1–M4**; BGV "0 for <1" read as "0 for more than 1"; offer backout rate shown as % until scoring bands are given; compliance KPIs scored from `KPI_CAPTURE_FROM`.

**ADR-028 — Minimal browser storage** (25–26 Sep)
Decision: nothing personal is stored in the browser; the only `localStorage` item is the side-panel preference (`bfcl.rail`). Consequences: no candidate data left on shared PCs.

**ADR-030 — JD Master as a governed, versioned library imported from the workbook** (27 Sep)
Context: the JD Library workbook is formula-driven and person-edited; the JD engine needs one authoritative, auditable source that learns from department input. Decision: import into `JDM_*` sheets through the app (browser-side parsing, staged server import, validation with blocking errors vs warnings, library versions); sign-off and edits happen in the app with audit; re-imports preserve app-side work; Policy Appendix F experience minimums override workbook norms. Consequences: the workbook can keep evolving and be re-imported without losing sign-off; the Excel file stops being the operational source.

**ADR-031 — Each navigation renders into a fresh container** (27 Sep)
Context: a page that was still loading (e.g. the Overview's to-do strip and alerts) could write into the next page after the user navigated away. Decision: the router creates a new inner container per navigation; late writes from an abandoned page land in a detached element. Consequences: no cross-page leakage; no change to individual pages.

**ADR-032 — The Recruitment Policy supersedes the library on experience; competencies follow the framework** (27 Sep, user instruction)
Decision: experience is always at least the Appendix F minimum (designation-aware for M5), applied on display, in norms, on save and in pool suggestions, without altering the imported source text; competency requirements come only from the Skill Competency Framework, and competency-department confirmation is refused where the framework has no requirement at the grade. Consequences: JDs built in phase 2 cannot ask for less than the policy or state competencies outside the framework; 89 profiles show a raised figure; 151 unlinked and 37 cross-department skills are visible for review.

**ADR-033 — JD Maker composes, it does not invent** (27 Sep)
Context: the library is white-collar heavy and department JDs vary; a generated JD must not borrow the wrong trade's duties or state requirements below the policy. Decision: rank library profiles by department, designation and grade with a minimum evidence rule; workmen use a profile only for the same department, band and trade; duties are reused only within the same band family and flagged when re-levelled; competencies come from the framework at the position's grade; experience follows ADR-032; every gap (unmapped department, no profile, inferred qualification, HOD confirmations) is shown as a flag rather than filled silently. Consequences: some JDs (notably workmen) start as standards plus HOD-supplied duties; nothing in a generated JD is unexplained.

**ADR-039 — TAT exemptions are requested, approved by the Head of HR, and apply per reason** (30 Sep, user decisions)
Context: the only exemption was the automatic notice extension, typed by recruiters without proof; nothing let the Head of HR grant time for causes outside the recruiter's control, and the KPI ignored on-hold days while the TAT screens excluded them. Decision: recruiters and TA Leads request extra days or a paused date range with a reason, remark and proof; the Head of HR or Admin (`tat_exempt`) approves, rejects, grants directly or revokes; each reason says whether it changes the recruiter clock and KPI and/or the position clock, copied at decision time; the notice extension stays automatic but needs proof and can be rejected; the KPI excludes hold days and applies recruiter exemptions; a closed position's exemptions lock 5 days after its closing month (Admin can still correct). Consequences: one calculation (`tatClock_`) feeds every screen and the KPI; pending, rejected, withdrawn and revoked requests have no effect; past KPI months with on-hold positions improve slightly.

**ADR-038 — A grade and a designation are separate; documents use the position's own designation** (29 Sep, v62, user decision)
Context: each grade carried one free-text label ("M6 — Engr/SE, Officer/Sr Officer") shown in the grade dropdown, and the JD printed the grade's generic description, so a JD for an HR Officer read "M6 – Officers/Engineers". One grade holds many designations. Decision: `M_Designations` holds one row per designation per grade; every position stores its own `Designation`; the position form lists only the chosen grade's designations; the JD Grade cell shows "grade – the position's designation" and never the grade's list; rules that read the title (M5 Junior Manager experience, shift questions) use designation and position title together (`lineTitle_`). Migration seeds designations by splitting the old labels and fills a position's designation only where its title names exactly one. Consequences: grades and designations are configured separately in Admin; renames flow to positions; existing JD files already saved in Drive keep their old wording until regenerated; positions whose title matched no single designation need one picked.

**ADR-037 — Screening is structured, scored the same way for everyone, and kept per candidate** (28 Sep, v53, user process)
Context: screening answers were free text with no link to the JD, no judgement and nothing the HOD could compare. Decision: questions are drafted from the final JD with requirements, importance and knock-outs; answers are rated (automatically where objective); one transparent weighted score and band; the answered sheet and CV go to the HOD together; every screening is kept with the exact question version. PDFs are built in the browser (jsPDF) so they can be tested end to end; attachments are downloaded because Outlook web links cannot carry files. Consequences: recruiters must complete a screening before Screened; HOD contacts need emails for pre-addressed mail; old free-text answers remain for earlier candidates.

**ADR-036 — JD and screening questions are versioned and validated with the department before posting** (27 Sep, v52, user process)
Context: the CRM recorded only end dates, a replaced JD file erased the proposal, and posting was possible without a validated JD or questions. Decision: every JD and question set is a version with a status and share/reply record; the confirmed dates are set only by the department's validation; all existing ways of attaching a JD create versions; posting is gated with a recorded Head of HR override; a JD revision reopens the questions and flags live posts. Consequences: full audit of what was proposed, changed and approved; recruiters can no longer type a confirmation date; the E2E and click-through tests follow the real flow.

**ADR-035 — JD library cells are written as text where Sheets could reinterpret them** (27 Sep, v50)
Context: `setValues` parses strings like typed input; experience ranges in `JDM_Grades` became dates, corrupting the Norms page, grade-norm experience in the JD Maker and the policy comparison. The test mock did not model this, so all tests passed. Decision: a single guard (`jdmSafeText_`) on every `JDM_` write path (staging, library replace, department map, bulk sign-off edits, generic insert/update) plus a read repair (`jdmUndate_`) for already-converted cells; the test mock now strips a leading apostrophe like Sheets and a dedicated test reproduces Sheets' date coercion. Consequences: library text is stored as written; other CRM sheets are unchanged (their dates are real dates).

**ADR-034 — Generated JDs are versioned app records; the Word file is built in the browser** (27 Sep)
Decision: each save creates a new version in `JDM_Drafts` with the composed content and flags, attaches the file to the position and stores it in the JD folder; library imports never touch this sheet (`JDM_NOIMPORT_`: Dept_Map, Import_Log, Drafts). The Word document is generated client-side (docx library) so the server stays within Apps Script limits. Consequences: full history of what was generated from which profile; the browser needs the CDN library on first use.

**ADR-029 — Release safety** (ongoing)
Decision: every patch is checksum-verified before and after; unchanged files are verified too; each release passes the full suites and a 48-step browser click-through twice; the served page is compared with the source; new server functions are introduced tolerant of Google's propagation window (v25 lesson). Consequences: 46 releases without data loss; one rolled-back release (v25).

## 14. Changelog

All times IST. Every version was published to the same fixed deployment URL. *(inferred)* marks contents reconstructed from session notes rather than an explicit release note. Schema numbers are given where recorded.

### 2026-09-30

**Unreleased — TAT exemptions approved by the Head of HR** (schema 28; new `Exemptions.gs`; ADR-039)
- **Request** (position drawer → TAT exemptions; the position's recruiter or a lead): extra days or a paused date range (ended, not overlapping another pause), reason, remark, proof (required when the reason says so; `apiUploadDoc` entity `TEX`). **Decide** (`tat_exempt`: Head of HR, Admin): approve (proof enforced), reject or revoke with a note, or grant directly. Withdraw while pending. All audited.
- **Effect**: approved days add to Final_TAT and approved pauses come off Days_Taken for the clocks the reason names (recruiter clock + KPI and/or position clock); a paused day already on hold counts once. Drawer readout shows e.g. "50 standard + 15 notice + 10 exemption = 75 d · 6 d paused"; positions list shows an "Exempt" badge.
- **Notice extension**: a notice above the grace needs "Notice period proof" attached when it is entered or changed; the Head of HR can verify or reject it (rejected = not counted). New data check "Notice beyond the grace without proof" (13 checks).
- **KPI**: Timely closure and M-level fulfilment now exclude on-hold and approved paused days and add approved recruiter exemptions; the drill-down shows them with reasons.
- **Lock**: a closed position's exemptions can be changed until 5 days after the end of its closing month; then only the admin.
- Admin → **TAT exemptions** tab; Overview to-do strip and weekly email show exemptions awaiting the Head of HR; Roles matrix updated. The Daily_Funnel `Exemption_Days` column is legacy (from the tracker) and unused.
- Tests: calculation cases (notice kept/rejected, per-clock days, pauses clipped and not double-counted with holds, month lock), approval API cases as recruiter / other recruiter / Head of HR / Admin, KPI cases, browser checks of the drawer section and Admin tab; E2E X1–X6.

**Unreleased — Reports → Dept delays: department bottlenecks measured** (no schema change; new `Departments.gs`)
- New page (all users; leads see every department, a recruiter their own positions), period last 30 / 90 / 180 days or custom, from records already kept:
  - **CV feedback time**: a card's time at "Shared with department" (Stage_History) until the department confirms or the card is rejected, put on hold or withdrawn; average, median, number over the 24 h policy (Appendix A step 3); CVs waiting now with the oldest.
  - **JD / screening-question validation**: each version's shared date to the department's reply (Position_Docs); average reply, versions awaiting now.
  - **Positions: time to final JD and questions**, split into recruiter time (before sharing, revising) and department time (awaiting reply), with rounds; "only delayed" filter (over 3 days or TAT lost).
  - **Days waiting on departments** per position (overlapping waits count once), **TAT lost** = time beyond the norms (24 h CV feedback, 1 day JD / questions reply), share of the period's TAT days; per department (worst first, with HOD and past-TAT count) and per recruiter ("recruiter time lost waiting").
  - **Waiting on departments now**: every CV and JD / question version awaiting a reply, and since when.
  - Click a department to filter its positions; click a position to open it; Download CSV on every table.
- Limits: sharing logged only as daily counts (not by moving cards) cannot be timed; migrated history rows are skipped as their share time is unknown.
- E2E: D19b checks the report's shape.
**Unreleased — More on one screen: wider pop-ups, drawers and pipeline board** (no schema change; `App.html`, `Styles.html`)
Measured in a browser harness at 1780×900 (1366×768 in brackets), before → after:
- Candidate card (Pipeline): 1000 px wide, 1.78 screens tall → up to 1680 px (97% of the screen), **1.12** screens (2.10 → 1.71). Three columns: next step and joining follow-ups | interviews and other actions | screening, documents, offer, onboarding and history. Short form fields sit two to a row.
- Position drawer (and every side drawer): 1000 → up to 1320 px wide; a long form's sections sit side by side in two columns and each section's fields flow into two or more columns: 3.77 → **2.22** screens (4.48 → 2.64).
- Pipeline board: stages with no candidates shrink to a narrow labelled strip, so the board fits the screen: 2,190 px of columns in 1,500 px (scrolled sideways) → fits at both sizes.
- Wide pop-ups (JD & questions, JD picker, close position, job posts) 1000 → 1280 px; screening 1040 → 1320 px; share with department 720 → 920 px; screening-questions view and editor, add-a-candidate search and panel-member form 520 → 860 px.
- Overview at 1366 px: the right column no longer pushes the page 118 px sideways (grid items could not shrink below their table width).

**Unreleased — Overview pipeline alerts: full details and honest risk** (no schema change)
- *Joiners at risk* no longer depends only on a risk picked at a check-in: it also lists joiners whose expected joining date has passed with no joining recorded (Red), whose offer is not accepted 7 days after the letter (`OFFER_ACCEPT_RISK_DAYS_`, Amber), and whose joining is recorded on the position while the card was not moved to Joined (Amber). Each item says why. The box states how many joiners have never been checked on (risk not known).
- `pipelineAlerts_` returns every item with its detail: candidate and mobile, position, MRF, grade, department, recruiter, stage and since when, offer / acceptance / expected joining dates, last check-in (date, mode, risk, response, note, by) and number of check-ins, next check-in, what is pending and for how many days; HOD for department feedback. Sorted longest pending first.
- Overview: box titles and "View all N" open a pop-up with the three lists as tabs, recruiter filter and search, an ageing summary (never checked in / no next check-in / overdue / due today; Red / Amber; waiting over 3 days), "Open card" to the candidate in the Pipeline, and Download CSV.
- *Waiting for department feedback* is unchanged in logic: it counts cards at "Shared with department" for over 24 hours, so it fills once recruiters move cards to that stage (sharing logged only as daily counts does not appear).
- Weekly email: at-risk rows show Red/Amber with the reason; the summary line adds joiners never checked on.

### 2026-09-29

**Unreleased — UI speed and stability** (no schema change)
- Screens no longer re-ask the server for the positions list on every menu click: the list in memory is shown at once and checked in the background (at most every 15 s, or on the next screen after any server action); if it changed, the list is swapped and the Positions screen redraws. After a save the next load still waits for the server as before. The list is prefetched 1.5 s after the first page, and simultaneous requests share one call.
- A position drawer opened from memory re-reads that position: untouched, it redraws with the newer values; once typed in, it warns so a colleague's change is not overwritten.
- Overview: to-do counts and pipeline alerts are requested together with the dashboard, and their space is reserved, so the page no longer jumps (layout shift 0.18 → 0 in the browser harness). Daily log reserves its tasks strip; the switch-over banner and a position's open tasks are drawn from the last answer on later visits.
- Pipeline: the board and its tasks are requested together and drawn once (about 1.9 s → 0.85 s at 700 ms per server call).
- Loading placeholders appear only when a page is not ready by the next frame, with no 250 ms blank before and no 400 ms minimum after; they fade out.
- Searches wait 150–200 ms after typing (Positions, Interview panel, JD Master, departments, Users, JD picker); JD Master shows the first 150 profiles with "Show all", and its filter chips no longer reload the library from the server.
- The side menu collapses without animating the page grid (which re-laid out the whole page every frame).
- Set `localStorage['bfcl.perf'] = '1'` in the browser console to log every server call and page time.
- Server: the to-do list is cached in chunks (`cacheBigPut_`), so a list over the 100 KB single-entry limit is cached instead of being rebuilt from about ten sheets on every call; chunks are now 30,000 characters so multi-byte text cannot overflow an entry.
- Server slow-step log: sheet reads and to-do rebuilds taking 400 ms or more are written to the execution log as `[perf] …` (Apps Script → Executions).

**v62 — deployed 29 Sep — Grades and designations separated** (schema 27, ADR-038)
- New `M_Designations` sheet (one row per designation per grade) and `MRF.Designation` column; `M_Grades` gains `Active`, and its `Designations` column becomes a read-only summary. New `Grades.gs`; the v54 functions `apiGradeDesignations` / `apiSaveGradeDesignations` are replaced by `apiGradeSetup` / `apiSaveGradeSetup`.
- Migration: old grade labels split on commas and slashes with short forms expanded ("Engr/SE, Officer/Sr Officer" → Engineer, Senior Engineer, Officer, Senior Officer); each position's designation filled only when its title names exactly one designation of its grade (longest match; ties and no match left blank).
- Admin → **Grades & designations** (lead): grades (band, active, add) and designations (add, rename with carry-over to positions, move while unused, deactivate, note), filter by grade.
- Position form: grade shows grade and band only; a Designation dropdown lists the grade's designations and refreshes when the grade changes; required on new positions. Positions list shows the designation under the grade.
- JD: the Grade cell reads "M6 – Officer" (the position's designation), no longer the grade's generic description; the JD Maker header shows the same. JD Master profile view no longer shows the grade description next to a profile's grade. M5 Junior Manager experience, screening-question drafts, pool suggestions and shift detection read the designation with the title.
- Tests: E2E B1 now passes a designation; new B1a–B1d (designation saved, required on new positions, must belong to the grade, grade setup lists). Source syntax checked; Apps Script E2E to be run before deploy.

**v61 — 23:45 — Create JD save hotfix** (no schema change)
- Fixed the Create JD save/download error caused by duplicate `jmWork` IDs after the wide responsibility editor release. The responsibility editor now uses its own container and the working-conditions textarea is read safely.
- Tests: source syntax and full local harness unchanged at 91/109 because existing v58 legacy defects remain.

**v60 — 23:19 — Wider Create JD workspace** (no schema change)
- The Create JD drawer now opens as a wide workspace on desktop so dense responsibility categories and editable statement rows have more horizontal room. Other drawers keep their earlier width.
- Tests: source syntax and full local harness unchanged at 91/109 because existing v58 legacy defects remain.

**v59 — 23:12 — Dynamic Create JD responsibility editing** (no schema change)
- Create JD now uses a local working copy for responsibilities: users can add categories, add/edit/reorder/remove responsibilities and immediately download or save the generated Word JD from that working copy without database calls on every edit.
- Reusable library saves are explicit and restricted to `jd_manage`; the batch save writes app-added responsibilities into `JDM_Statements`, adds new KRA categories into `JDM_KRA_Categories`, retires removed profile responsibilities, preserves audit history and reloads the refreshed JD Master draft.
- Tests: source syntax and full local harness unchanged at 91/109 because existing v58 legacy defects remain; focused batch-responsibility API smoke passed.

### 2026-09-28

**v58 — 12:04 — Daily review cache fix** (no schema change)
- Reported: Day’s status column blank (“—”) in the Daily review. Cause: past days are cached up to 6 hours and the cache key did not include the code version, so days cached by v55 code (no status data) were still served after v56. The key now includes DAYSNAP_CODE_ (bumped on releases that change the Daily review data), and a cached day without status data is ignored and rebuilt. Checked: on real data, every row of four past days has a status.
- Tests: snapfix 3/3; all server suites; E2E 96/96.

**v57 — 11:24 — Remove a position created in error** (no schema change)
- Close without hiring gains “Created in error: remove the position”. Approval_Status becomes “Created in Error” and the derived status **Removed** (positionStatus_). Date in Not_Needed_Date, reason and requested-by in Closure_Reason / Closure_Requested_By. Nothing is deleted.
- A removed position has no TAT result (TAT ends on the removal date), is out of Overview counts, KPIs, to-dos, data checks and the switch-over list, and is treated as never existing in Day’s Status; the Daily review lists the removal for its day. Saving it or any pipeline action is refused (requireNotReplaced_ and apiSavePosition).
- Recruiters can remove their own positions only if no candidate was ever added; otherwise a TA Lead or the Head of HR must (active candidates are then closed as usual). A lead can **Restore position** (reason required, audited): Approved and Open again.
- Positions page: new “Removed” chip; “All” leaves removed positions out. Removed positions are left out of the Pipeline “Other positions” list and the observation form.
- Tests: remove 17/17; browser 8/8; all server suites; E2E 96/96; click-through 48/48; Day’s Status browser 15/15; screening 20/20.

**v56 — 11:10 — Day’s Status and internal fill** (schema 26)
- **Day’s Status** (user decisions: the Positions statuses; automatic with recruiter override; Daily review shows all open positions; configurable in Admin). New column “Day’s status” in the by-position table of the Daily review and My day. The automatic status is the position’s status as it stood on that day (statusAsOf_: replaced, internal fill, joining, closure with its date, past holds from Hold_Log, offer, approval). A recruiter (own positions, today or yesterday) or a lead can override it with any active status and a required note; the override carries forward until the automatic status changes or it is cleared (“Back to automatic”). New sheets Day_Status (overrides) and M_Day_Status (list: the 7 automatic statuses, which cannot be switched off, plus custom ones with colour, order, active, description). Admin → Day’s Status tab (leads). Daily review lists every Open or Offered position of the recruiter, including those without activity, with an “Only positions with activity” toggle. Saving an override clears the cached past days.
- **Internal fill closure.** Close without hiring gains “Filled internally (transfer / IJP)”: employee (required), employee code, transferring from, decision date, effective date (up to 60 days ahead). Stored in new MRF columns Fill_Type, Internal_Employee, Internal_Emp_Code, Internal_From_Dept, Internal_Decided_On, Internal_Effective_Date; approval stays Approved and no joining date is written, so no BGV, joining or onboarding to-dos fire. Status Offered until the effective date, then Closed; TAT ends on the effective date; excluded from the M-level fulfilment KPI. The position shows the fill with a lead-only “Undo internal fill” (reason required); a filled position cannot be closed again. The Daily review lists it as “filled internally”.
- Db text guard now covers Day_Status and treats a column named Date as a date.
- Tests: dstat 35/35; browser 15/15; all server suites; E2E 96/96; click-through 48/48; screening 20/20; JD & questions flow 20/20.

**v55 — 10:31 — Post-joining BGV to-do** (no schema change)
- Question from the user: was a to-do raised for the current-employer BGV within 2 days of joining? It was not: only the KPI scorecard checked it after the fact, and the offer-stage BGV to-do stops once the position closes at joining. New rule bgv_join (see the to-do table): created on the joining date, critical 48 h after, context shows the deadline; the Daily review counts it as missed unless the BGV date entered is on time.
- Tests: bgvj 15/15 (scope Auto / Yes / No / below Manager, 30-day window, future joining, closes on entry, missed and late-typed, Task rules edit and switch-off); all server suites; E2E 96/96. On a copy of the live data, 2 tasks appear at go-live (both critical).

**v54 — 10:06 — Grade designations configurable** (schema 25)
- New Admin → **Grades** tab (TA Lead, Head of HR, Admin): edit the designations shown next to each grade in the position form, with a live preview; band and TAT days read-only (TAT days are set in TAT rules). Changes are audited and apply to everyone on their next refresh. Server: apiGradeDesignations, apiSaveGradeDesignations (required, ≤ 200 characters).
- Schema 25 sets M6 to “Engr/SE, Officer/Sr Officer” (Recruitment Policy Appendix F) only if it still reads “Engr/SE”; an edited value is never overwritten.
- Tests: grade suite 11/11; browser 8/8 (tab, preview, save, position-form labels, recruiter has no Admin page); all server suites; E2E 96/96; screening flow 20/20; click-through 48/48.

**v53 — 00:10 — Candidate screening, fitment and sharing with the department** (schema 24)
- Structured screening questions drafted from the final JD, editor, questions PDF for the HOD; screening dialog with automatic and recruiter ratings, live fit, completion moves to Screened; answered-sheet PDF; Share with department (download files, copy message, Open in Outlook, move to Shared, reason for Not eligible); screening history on the candidate profile; fit chip on pipeline cards (§5D).
- Tests: screening server 23/23; browser full flow 20/20 (drafting, editor, both PDFs, screening, sharing with both downloads and Outlook link, history, knock-out reason); E2E 96/96 (D4 now records a screening); click-through 48/48, JD & questions 20/20, JD Maker 15/15, readiness views 12/12; all server suites.
- Live: first load after deploy ran the schema upgrade (about a minute); J000130 board shows JD v1 final and questions not written yet.

### 2026-09-27

**v52 — 22:38 — JD and screening-question validation with the department** (schema 23)
- New **JD & questions** panel on the pipeline; versioned JDs and questions with share, department reply (validated / changes requested with comments), revision rounds and history; questions only from the final JD, with suggested starter questions; posting gated (Head of HR override with reason); posts record the versions used; to-dos share_jd, dept_reply, revise_doc, share_questions; confirmed dates now set only by validation; migration of existing positions (§5C).
- Word JD (Create JD, template and sample): the competency section no longer shows the sub-headings *Specific to this role (…)* and *Required of every employee*; each level is one list (role-specific first).
- Live check: J000130 migrated to *JD v1 final 26 Sep 2026*, questions *not written yet*, posting *after the JD and questions are final*, critical to-do *Write and share screening questions*.
- Tests: workflow rules 41/41 (including migration); browser workflow 20/20; E2E 95/95 (D2 rewritten to the new flow); click-through 48/48 (U7–U10 follow the new flow); JD Maker browser 15/15; readiness views 12/12; all server suites.

**v51 — 21:47 — View MRF, JD and screening questions from the pipeline**
- Readiness bar: **View MRF** (signed MRF form), **View JD** (file, or typed text), **View questions** (read-only, with *Edit questions* for editors); available on read-only boards too. MRF step now shows the approval date and whether the signed form is attached. Subtitles wrap instead of truncating.
- Browser-only change (no server or schema change). Tests: readiness views 12/12 (owner and read-only closed board, file and text JDs); click-through 48/48; JD Maker browser 15/15. Live: J000130 shows *Approved 26 Sep 2026 · no signed form* and *View JD*.

**v50 — 21:24 — Fix: JD library experience ranges shown as dates**
- Norms showed "Sat Jan 03 2026 … yrs" for W4 (and W3–W1), and wrong policy-applied ranges for M6–M3, because Google Sheets had converted ranges such as `1-3` and `8-15` into dates on import. Library writes now store such text as text; cells already converted are read back correctly (no re-import needed). Also fixes the JD Maker's grade-norm experience for W and T grades.
- Tests: new Sheets-coercion test 10/10 (reproduces the bug, then import, read repair, JD Maker and real dates); all suites; e2e 95/95. Live: the Overview's policy line (same data) shows M6 2–6 → 4–6, M5 5–10 → 8–10, M4 8–15 → 10–15, M3 12–20 → 15–20.

**v49 — 13:39 — JD Maker (phase 2 of the JD engine)** (schema 22)
- New **Create JD** on the pipeline readiness bar and **Create JD from JD Master** on the position form: ranked library profiles with reasons, composition from the profile, band standards and framework competencies at the position's grade, policy experience, job-family qualification, review flags; the recruiter can switch profile, untick duties, add trade/additional duties, preferred experience and working conditions (§5B).
- **Download Word** in the approved compact layout; **Save to JD folder and attach** records a version in the new `JDM_Drafts` sheet (protected from library re-imports).
- Tests: JD Maker 22/22; browser 15/15 (desktop and phone layout checked); e2e 95/95; all suites; click-through 48/48. Deployment checksum-verified after save and reload.
- **Live smoke test incomplete:** the Create JD button appears on live positions, but in the automated live check the panel did not open, and the browser automation then lost connection (see K-6).

**v48 — 11:48 — Policy supersedes experience; competencies confirmed against the framework**
- Experience required = profile figure raised to Policy Appendix F (M5 split: Asst / Dy Manager 8/14, Junior Manager 6/12); shown in the list ("raised from"), profile drawer (required vs stated, superseded) and Norms (policy-applied ranges); saving a lower figure is refused; talent-pool scoring uses the same rule.
- Framework check in each profile (competencies required at the grade, safety-critical count, skill-by-skill fit); competency-department confirmation requires framework requirements at the grade (single and bulk).
- Tests: JD Master 55/55; browser 7/7; e2e 95/95; all suites; click-through 48 × 2.


**v47 — 11:22 — JD Master (phase 1 of the JD engine)** (schema 21)
- New **Setup → JD Master** page: Overview (library version, contents, sign-off progress, policy conflicts, import history), Job profiles (filters, bulk grade/department confirmation, duplicates, below-policy experience), profile drawer (norms, band responsibilities, responsibilities by KRA category, skills, competencies at grade with level definitions, sign-off and editing), Departments (CRM → framework mapping), Norms.
- **Import of the BFCL Master JD Library workbook** by the Admin, read in the browser, staged, validated and versioned; re-import keeps app sign-offs and edits.
- New permission `jd_manage` (TA Lead, Head of HR, Admin); Roles & permissions matrix extended; 11 new `JDM_*` sheets.
- Fix: pages still loading could leak content into the next page after navigating away (router now uses a fresh container per page).
- Tests: JD Master 39/39 on the real workbook; browser 19/19; e2e 95/95; all feature suites; click-through 48 × 2.


**v46 — 00:18 — TAT rules and two TAT clocks** (schema 20)
- New **Admin → TAT rules** tab: per-level rules for W1–W5, M1–M7, T, T1–T4 (standard days, notice grace, at-risk %), effective-from dating, version history, upcoming changes. Edit: Head of HR, Admin; view: TA Lead.
- Change editor: effective date, apply mode (*from date — past unchanged* / *every position*), **Preview impact required before Save**, note; save creates `V<n>`, supersedes replaced rows, syncs M_Grades, audits, recalculates stored TAT immediately.
- **Two clocks:** Recruiter TAT (from assignment; stored; recruiter views and KPIs) and Position TAT (from MRF approval; leads' lists, Overview, weekly email). Position form shows both with start dates and rule versions; browser preview mirrors the server rules.
- New sheet **TAT_Rules**, seeded V1 (all dates) with **W1–W3 corrected from 50 to 20 days** (Policy 20.1); TAT_Rules added to cached tables; bootstrap sends rules.
- Fix: saving, closing/resuming and replacing positions now store only the defined TAT columns (no audit noise from calculated fields).
- Impact: 11 of 36 W1–W3 positions change result (10 Achieved → Missed, 1 On track → Overdue).
- Tests: TAT rules 23/23; e2e 95/95; all feature suites; browser 8/8; click-through 48 × 2.

### 2026-09-26

**v45 — 23:58 — Roles, permissions and user management** (schema 19)
- Four roles (Admin, Head of HR, TA Lead, Recruiter) with named permissions; legacy "Head" and variants recognised; every check re-mapped; weekly email to lead roles; messages reworded.
- **Admin → Users** (list, add, edit, deactivate/reactivate, no delete, access status, **Fix access**) with automatic sharing of the database and CV folder; guards (self-deactivation, own Admin role, last Admin, unique recruiter names, rename blocked when referenced, reassign open positions on deactivation); M_Recruiters synced; full audit; Users gains Added/Updated columns.
- **Admin → Roles & permissions** read-only matrix.
- Tests: roles 5/5, users 24/24, browser 9, click-through 48 × 2.

**v44 — 23:24 — Layout:** blue top bar removed (full height); rail head with brand "BFCL / RECRUITMENT" and the single collapse toggle; profile (initials, name, role, email) pinned at the rail foot; menu scrolls independently; grid fix for the main view.

**v43 — 22:41 — New side panel:** one navigation definition with SVG icons and groups (Daily work, Reports, Setup); collapsible 68 px icon rail with tooltips, remembered per browser; auto-collapsed under 1,100 px; phone bottom bar. Fixed the stale menu held in the page template.

**v42 — 21:40 — CV parser fixes for low-resolution images** (a real 727 px WhatsApp CV)
- Two-pass OCR (upscaled ≈2,600 px with grayscale/contrast + native size); scanned PDF pages rendered at high resolution ×1.6.
- Better name picking (`pickName_`), job title under the name fills the designation, experience value on the line after its label, "City New Delhi" without a colon, education discipline from the same line; message shows how many fields already had a value. 43/43 fields on 8 CVs.

**v41 — 21:26 — OCR:** free in-browser OCR (Tesseract.js) for image CVs and scanned PDFs; confirmed working in Google's page sandbox.

**v40 — 21:07 — CV parser contact fixes:** Word reader replaced (mammoth → JSZip) to include headers/footers, text boxes and links; PDF reader captures email/phone links behind icons and rebuilds lines by position; parser handles "name @ gmail . com", "[at]/[dot]", run-on addresses, spaced digits, landlines; names from "NAME | email | phone" header lines.

**v39 — 20:53 — Free CV parser (Step 3)** (schema 18): *Fill from a CV* and bulk *Upload CVs*; fields marked found/check; only empty fields filled; immediate duplicate check (active + archive); `CV_Parse_Log` and Admin → Tools → CV parser accuracy for the pilot.

**v38 — 20:34 — Talent pool (Step 2)** (schema 17): candidates without a position; pool profile fields (function, skills, experience, location, expected CTC, notice); pool filters on Candidates; **Find candidates for this position** with scored, explained suggestions (Appendix F experience bands).

**v37 — 20:23 — Candidate archive and scale (Step 1)** (schema 16): server-side paged candidate search; slim cached index; archive after 180 days of inactivity (never with an active/on-hold card) to Candidates_Archive and a Drive Archive folder; duplicate checks and "Include archived" still see them; restore (manual or automatic); daily archive job; Admin archive status / run now.

**v36 — 19:15 — Panel leave as date ranges:** unavailability *Full days* (From–To, ≤ 90 days) or *Part of a day*; scheduling checks every day in the range.

**v35 — 18:42 — Scorecard corrections:** cards removed as *linked in error* count for nothing; a lead's backward move cancels the forward moves it undid, even on earlier days.

**v34 — 17:58 — BGV rule fixes:** field relabelled "Previous employer BGV initiated on" (within 3 days of the offer, Policy 9.1.1); BGV KPI compliant if initiated ≤ offer + 3 days; Missed list judged by the recorded date; "not chased" only on chaseable tasks. (J00075 no longer shown as missed.)

**v33 — 17:35 — Pipeline reform Phase 2: scorecard from candidate moves.** From the switch-over date the Daily review/scorecard columns after "CVs reviewed" are derived from Stage_History with the named candidates behind each number; the Daily log form accepts only CVs sourced/reviewed after switch-over. Switch-over check confirmed *"Nothing to fix"* on the live database.

**v32 — 17:02 — Close without hiring and On hold:** *Close without hiring* action (outcome, date, reason, requested by, per-candidate reject/hold/move), interviews cancelled, "Inform candidates and panel" task, offer withdrawal by Head of HR/Admin recorded as company withdrawal (not a backout), **Resume position** with hold days excluded from TAT (Hold_Days, Hold_Log), backlog helper for remarks suggesting closure; status changes only through these actions after switch-over.

**v31 — 16:44 — Data-integrity fixes:** leftover J00039 test card (APP-00001) removed with history; **IDs never reused** (highest-ever tracking per table); **Correct a wrong link** ("Linked in error") tool for leads.

**v30 — 09:48 — Pipeline reform Phase 3: Switch-over check** — reconciliation screen for open/offered positions (orphan cards, unlinked offers, legacy backouts, joined-but-open, remarks suggesting closure) with fix actions, recruiter filter and progress; banner on Positions; data checks for the same issues; `PIPELINE_CUTOVER` setting (5 Oct 2026). *(Phase/version mapping from session notes.)*

**v29 — 00:12 — Pipeline reform Phase 1: Policy 9.5**
- Backout at Offer/Pre-joining closes the position as **Replaced** and raises replacement MRF `-R1/-R2…` with TAT from the original start; backups, interviews and links move; backout kept under the candidate's name; backout date validation.
- Offer/joining/backout stored per candidate card; **one live offer per position**; Replaced positions read-only; **position form lock** from the switch-over date (leads can correct).
- "Replaced" status excluded from open counts; new to-do rules *Replacement MRF: move the next candidate forward* and *Position filled: close the remaining candidates*; orphan cards ignored. Suite 95/95.

### 2026-09-25

**v28 — 22:55 — To-do automation and interview scheduling:** rule-based to-do engine (Tasks, Task_Actions), self-closing tasks, Critical/Due/Info, Teams/Outlook deep links and copyable messages, I've chased / Snooze / Done; task strips on My day, Daily log, position panel and Pipeline; Missed section in Daily review; interview scheduling (Interviews sheet) with panel conflict check, confirm/unavailable/cancel (auto unavailability entry + reschedule task); Admin → HOD contacts and Task rules.

**v27 — 21:44 — Loading skeletons** across app start, Positions, Pipeline, My day, Candidates and the position panel (Claude Design canvas).

**v26 — 21:26 — Version check ("ETag equivalent")** for Positions, Candidates, Daily log and Pipeline boards; in-memory client copies; 22 tests.

**v25 — 21:16 — Version check, first attempt — rolled back.** Screens failed for users because Google briefly served pages built against the previous version's function list. Lesson recorded in §12.5.

**v24 — 20:41 — Performance Phase 3:** pre-built Daily review for past days (yesterday pre-built every 30 min); small sheets read in one trip; team list in the 10-minute cache. Daily review (past day) 1.0–1.3 s.

**v23 — 20:26 — Performance Phases 1 and 2:** fast IST date formatting, tail reads of growing sheets, packed list-only payloads, single-row refresh after saves, batched reads. Start-up 1.3–1.8 s; Positions 1.5–2.5 s; Daily log 1.7–3 s.

**v22 — 19:52 — MRF approved on / Position assigned on** with defaults, validation, lock after first entry, reassignment restart; TAT counted from the assigned date (fallbacks approved → received); readout shows the basis.

**v21 — 19:33 — Daily log edit window:** own entries editable only on the day saved; leads can correct.

**v20 — 19:22 — UI:** side panel widened to 1,000 px (≤ 94 % of screen), activity boxes in one row, remarks column in lists, CV panel layout improvements. *(details partly inferred)*

### 2026-09-24

**v19 — 12:49 — Single JD folder** ("JD" inside the CV folder): attach from the folder to one or many positions; uploads saved there; existing JDs migrated.

**v18 — 11:46 — JD confirmed on / Screening questions confirmed on** dates with ordering rules.

**v17 — 10:25 — KPI scorecard fix:** a field name refused by `google.script.run` had broken the scorecard for real users; renamed, cache reset, all read functions scanned.

**v16 — 09:22 — Candidate pipeline:** 11 stages mapping the 12-step hiring process; readiness strip (JD, screening questions, job posts; IJP < 15 working days flagged); Applications, Stage_History, Job_Posts, Followups sheets; document gate A–H with approved exception; offer/joining effects on the position; pre-joining check-ins with risk; alerts on Overview and weekly email; candidate moves in Daily review; existing linked candidates placed at their stage.

### 2026-09-23

**v15 — 23:40 — Daily recruiter summary:** My day (everyone) and Daily review (Head/Admin); Daily_Summary (note + task list).

**v14 — 23:23 — Fix: Google comment-stripping bug** in the served page (app failed to load); page script freed of comment markers; served page verified identical to source. **v13 — 23:22** — first release of this fix *(inferred)*.

**v12 — 23:11 — Weekly email summary** (Mondays 09:00, off by default, test send; adds the email permission).

**v11 — 23:05 — Admin page:** Data checks, Change history, Tools (backups — nightly, 14 days kept; Back up now); visible to Head and Admin.

**v10 — 22:47 — Panel members master:** M_Panel_Members seeded with 68 names from the CV Tracker (aliases); Technical/Final panel multi-selects on positions pre-filled from the policy panel matrix; interviewer dropdowns; "+ Add panel member".

**v9 — 22:39 — Supporting attachments:** BGV reports on positions, psychometric report on candidates; in-app viewer.

**v8 — 22:33 — Compliance data capture (Stage 3):** BGV section on positions (required Auto/Yes/No, dates); psychometric (Mettl) fields on candidates; Observations log; monthly 20 % audit tool; all seven KPIs on the scorecard; `KPI_CAPTURE_FROM`.

**v7 — 22:24 — KPI scorecard (Stage 2):** financial-year grid, team/recruiter, drill-downs: timely closure, M-level fulfilment, offer backout rate; KPI_Targets sheet.

**v6 — 22:16 — Stage 1:** Overview snapshot with Refresh and 30-minute rebuild; CV upload with the candidate form; in-app CV viewer; CV column/filter; multi-select status filter.

**v2–v5 — 23 Sep** — early deployment iterations after the MVP; no release notes were recorded.

**v1 — 23 Sep — Phase 1 MVP ("v1 - Phase 1 MVP"):** database imported from the Excel tracker (348 MRF lines, 1,087 candidates, ≈4,230 daily-log rows, panel unavailability; import report and exceptions); positions with TAT calculation and status; daily funnel log; candidates; panel availability; Overview; Users-sheet access; CV folder; nightly TAT refresh. Deployed executing as the visiting user.

### Schema versions (recorded)
16 archive (v37) · 17 talent pool (v38) · 18 CV parse log (v39) · 19 Users audit columns (v45) · 20 TAT_Rules (v46). Earlier steps are listed in §4.8.

## 15. Open items, known risks and roadmap

### 15.1 Before the 5 Oct 2026 switch-over
- **J00039:** enter candidate B (15 Sep offer), keeping the pre-ticked backout of Bharat Kumar Rao (4 Sep); do not click "Record joining".
- **J000115:** confirm whether linking Dr Rajiv Kumar was a mistake (use *Linked in error* if so).
- **J00056:** confirm the offer to Piyush Agarwal actually went out.
- **Six BGV tasks** (383, 426, J00039, J00045, J00056, J00063): enter BGV initiation dates.
- **J000135:** remove the wrongly added Ankit Ashtikar card.
- **Recruiter guide / training deck:** predates v18; must cover the pipeline, switch-over rules, close without hiring, panel leave, archive, pool, CV reader/OCR, roles and TAT rules.
- **Decide on the W1–W3 restatement** (keep, or restore past results via TAT rules; §7.4).

### 15.2 Setup and decisions waiting on the business
- Add the **TA Lead** user; confirm Jaspal shows as Head of HR; check Admin → Users access column and use Fix access where needed.
- Turn on the **weekly email** (currently Off).
- **KPI:** per-recruiter targets; **scoring bands for offer backout rate**; confirm `KPI_CAPTURE_FROM` (2026-10).
- **HOD contacts** and **panel member emails** (for pre-addressed messages and invites); confirm ambiguous panel names.
- Fill **MRF approved/assigned dates** on open positions.
- **CV parser pilot:** 30–50 real CVs, then review the accuracy report.

### 15.3 Data clean-up (Admin → Data checks, last count)
25 joinings on days other than Monday/Thursday; 20 missing/invalid mobiles; 23 duplicate groups; test records ("AGM - TA_TEST" position, test candidate) to remove through the app.

### 15.4 Planned features (roadmap)
- **JD engine phases 3–5** (phase 2, the JD Maker, delivered in v49 except suggested screening questions and standard workman profiles by trade × level): (3) JD Check — upload/paste the department's JD, statement matching against the library, gap report (missing / conflict / weaker / duplicate / new / relevance), merged proposed JD; (4) HOD confirmation loop — pre-written Teams/Outlook message, per-item decisions, versioned confirmed JD, *JD confirmed on*, to-do rule; (5) learning loop — new confirmed items to a proposals queue with duplicate check and approval into the library. Open decisions: standard workman profiles (trade × level, per Appendix F) to seed the library; confirmation strictness (block pipeline or critical to-do; recommended: sourcing may start, with a critical to-do). Decided: BFCL Word JD template (compact, no employee acceptance box; M5+ acceptance to be tracked in the CRM).
- **Phase 4 — stage timings per band** (W/T same as M initially), wired into the to-do and Missed rules (Appendix A per band).
- **Positions month filter** (From/To + choice of date field).
- **JD acceptance tracking for M5 and above** (Policy 8.2: signed within 3 working days of joining).
- Later candidates from earlier reviews: error alerts to the Admin; duplicate-merge tool; faster "today" views (running tally); offer letter from template (F05); monthly management report (PDF/Excel); phone-layout testing; data-retention and delete-on-request (DPDP); working-day calendar if rules move to working days.

### 15.5 Known risks and issues
| ID | Risk / issue | Mitigation |
|---|---|---|
| R-1 | Users have edit rights to the database sheet (execute-as-user) and can bypass app rules | Protect key sheets; audit log; long-term: Workspace, run as owner, private database |
| R-2 | No automatic alert when server calls fail | Planned error log + Admin email |
| R-3 | No retention policy / deletion on request (DPDP Act) | To define with HR; archive is a first step |
| R-4 | Background triggers and the weekly email run under the Admin's account; if that account loses access or re-authorisation lapses, jobs stop | Keep the owner account active; re-approve permissions after scope changes |
| R-5 | Browsers signed into several Google accounts may fail to open the app | Use a single-account browser profile |
| R-6 | Google propagation window right after a release (v25) | Release procedure §12.5 step 7 |
| K-1 | A replacement MRF's `TAT_Start_From` is taken from the original's **recruiter-clock** start (assigned date); the Position clock reads `TAT_Start_From` first, so a replacement's Position TAT starts at the original's assigned date rather than its approval date (usually the same day; never resets) | Candidate fix: store a separate position-clock start for replacements |
| K-2 | Pipeline forward moves may skip stages (only backward moves are restricted); the design intent was one stage at a time | Decide whether to enforce |
| K-3 | Rows deleted directly in the sheet orphan related records (IDs are no longer reused, but links break) | Never delete in the sheet; use app actions |
| K-4 | Historical (migrated) candidates aren't linked to positions and don't appear on boards | By design; add current candidates to boards |
| K-5 | JD library sign-off completed on 27 Sep (grades 204/204, competency departments 204/204, CRM department map 85/85, 10 duplicate groups resolved). Follow-ups: JD-187 reporting line; differentiate JD-193/194 duties; HOD trims JD-147 | HR follow-ups |
| K-6 | v49 live check: clicking **Create JD** on a live position did not open the panel during the automated check. On 27 Sep (v50) the same automation could not click *any* control inside the live app (e.g. the Norms tab), so this is most likely an automation limitation, not an app fault; not yet confirmed by a manual click. All local browser tests pass. | Click Create JD manually on a live position; if it does not open, capture the error and fix; roll back to v48 in Manage deployments if needed |
| K-7 | Admin can save through the server (`canEditLine_`) but the pipeline hides edit buttons unless the user is a lead or the position's recruiter | Align client and server rules |

## 16. Glossary

| Term | Meaning |
|---|---|
| **MRF** | Manpower Requisition Form (Policy 4.1). In the app, each resource on an MRF is a **position / line** (`Line_ID`). |
| **TAT** | Turnaround time from the clock start to joining (Policy 20). See Recruiter TAT / Position TAT. |
| **Recruiter TAT** | Clock from the position assigned date (stored; recruiter views, KPIs). |
| **Position TAT** | Clock from MRF approval (leadership views, Overview, weekly email). |
| **Notice exemption / grace** | Notice-period days above the grace (default 30) added to the allowed TAT. |
| **Hold days** | Days a position spent On hold, excluded from TAT after it resumes. |
| **Level / grade / band** | W1–W5 (workmen), M1–M7 (managerial/staff), T, T1–T4 (trainees); Policy Appendix F. |
| **Manager & above** | Grades M1–M4 (or equivalent designation). |
| **Pipeline / card / application** | A candidate's journey on one position; one card per candidate per position. |
| **Live offer** | A card at Offer, Pre-joining, Joined or Onboarded. |
| **Backout** | Withdrawal at Offer/Pre-joining by the candidate → Policy 9.5 replacement MRF. |
| **Replacement MRF** | New linked position (`-R1`, `-R2`) raised after a backout, TAT from the original start. |
| **Replaced** | Status of a position closed by a backout and superseded by its replacement. |
| **Switch-over / cut-over** | `PIPELINE_CUTOVER` date (5 Oct 2026) from which offers, joinings, backouts and the scorecard come only from the pipeline. |
| **Switch-over check** | One-time reconciliation screen for open/offered positions. |
| **Linked in error** | Lead correction that removes a wrongly linked card without recording a backout. |
| **Close without hiring** | Action closing a position as Not Needed / No Vacancy / On Hold with reason and candidate handling. |
| **HOD** | Head of Department. |
| **BGV** | Background verification (Policy 9.1.1). |
| **Mettl / psychometric** | Psychometric test for Manager & above (Policy 8.7.1). |
| **IJP** | Internal Job Posting, at least 15 working days (Policy 7.4). |
| **Observation** | A recorded process-adherence lapse (MRF & assessment KPI). |
| **Talent pool** | Candidates with no active or on-hold card. |
| **Snapshot** | Pre-computed result (Overview, past Daily reviews) served instead of recalculating. |
| **Version stamp** | Per-table change marker used by the version check ("ETag equivalent"). |
| **Lead** | Anyone with the `lead` permission: TA Lead, Head of HR, Admin. |

## 17. Appendix: validation and error messages

Generated mechanically from the v46 source: every message the server can show a user, by area. `{…}` marks a value filled in at run time (a name, date, count or ID). These messages are the enforced business conditions; if behaviour changes, regenerate this appendix.


### Access (`Auth.gs`)

- ACCESS: Could not read your Google account. Sign in to Google, open the app link again and approve the permission prompt.
- ACCESS: {…} is not on the recruitment team list. Ask the admin to add you in Admin → Users.
- Only the CRM admin can do this.

### Positions, daily log, candidates, CVs, panel unavailability (`Api.gs`)

- Position {…} was not found.
- Unknown list.
- Position, grade, department and MRF receipt date are required.
- Add the date the position was marked No Vacancy.
- Add the date the position was marked {…}.
- Set Offer sent to Yes before entering the actual joining date.
- This position is assigned to {…}. Only they, a TA Lead or the Head of HR can edit it.
- This position was closed after a backout and replaced by another MRF. Work on the replacement.
- Use “Close without hiring” or “Resume position” to change this status, so the reason and the candidates are handled.
- {…} is recorded from the candidate pipeline now. Move the candidate in the Pipeline instead, or ask a TA Lead or the Head of HR to correct it.
- {…} is already set to {…}. Only a TA Lead, the Head of HR or the admin can change it.
- The MRF approved date cannot be in the future.
- The position assigned date cannot be in the future.
- The MRF approved date cannot be before the MRF received date.
- The position assigned date cannot be before the MRF approved date.
- Pick the position this activity is for.
- Pick the activity date.
- The activity date cannot be in the future.
- {…} must be a whole number, 0 or more.
- From {…}, HR 1st round, shared, shortlisted, interviews and selected are counted from the candidate pipeline. Enter only CVs sourced and CVs reviewed here.
- Enter at least one count or a remark.
- You can only edit entries you logged.
- This entry was saved on {…}. Entries can be changed only on the day they are saved. Ask a TA Lead or the Head of HR to correct it.
- Candidate {…} was not found.
- Candidate name is required.
- Mobile number must have 10 digits.
- That email address does not look right.
- CV folder is not set. Ask the admin to run setup().
- Save the candidate before uploading a CV.
- Upload the CV as PDF, Word, JPG or PNG.
- No CV has been uploaded for this candidate yet.
- The CV link on this record is not a Google Drive file link.
- You do not have access to this CV file. Ask the CRM admin to run shareWithTeam.
- This CV is larger than 15 MB. Open it from Drive instead.
- Panel member and date are required.
- The last day cannot be before the first day.
- One entry can cover at most 90 days. Add another entry for a longer absence.
- The end time must be after the start time.

### Pipeline (`Pipeline.gs`)

- That pipeline record was not found. Reload the page.
- Position {…} was not found.
- This position belongs to {…}. Only they, a TA Lead or the Head of HR can change its pipeline.
- Pick a position.
- Candidate {…} was not found.
- {…} is already in this position’s pipeline.
- Unknown stage.
- This candidate is {…}. Reactivate them first.
- {…} already holds the offer for this position. Only one live offer is allowed: record their backout first (it creates the replacement MRF), or ask a TA Lead or the Head of HR.
- Only a TA Lead, the Head of HR or the admin can move a candidate back to an earlier stage.
- Add the interview date and result.
- Sections {…} are not verified. Verify them or record the approved exception (Policy 9.3).
- Add the offer letter date.
- Add the date the candidate accepted the offer.
- Add the actual joining date.
- Record the induction date and the buddy assigned.
- Unknown status.
- Give a short reason.
- {…} already holds the offer for this position, so this candidate cannot be reactivated at the offer stage.
- Add the backout date.
- The backout date cannot be in the future.
- The backout date cannot be before this candidate’s offer date ({…}).
- This position was closed after a backout and replaced by {…}. Work on the replacement.
- Date, mode and risk are required.
- Risk must be Green, Amber or Red.
- The JD confirmed date cannot be in the future.
- The screening questions confirmed date cannot be in the future.
- The JD confirmed date cannot be before the MRF received date.
- Add the JD confirmed date first; screening questions are confirmed after the JD.
- The screening questions confirmed date cannot be before the JD confirmed date.
- Add the screening questions before recording the confirmation date.
- Channel and posting date are required.

### Close without hiring / resume (`Closure.gs`)

- This position is on hold. Resume it first. / This position is closed without a hire ({…}).
- Only open or offered positions can be closed without a hire.
- Pick the outcome.
- Add the date.
- The date cannot be in the future.
- The date cannot be before the MRF was received ({…}).
- Add the reason.
- A candidate has already joined on this position, so it cannot be closed without a hire.
- A candidate holds an offer on this position. Only the Head of HR or the admin can close it (the offer is then withdrawn by the company).
- Pick a different position to move the candidate to.
- You cannot add candidates to {…}.
- {…} is not open.
- Only positions on hold can be resumed.
- Check the resume date.
- The resume date cannot be in the future.
- The resume date cannot be before the hold started ({…}).

### Switch-over check (`Reconcile.gs`)

- Candidate {…} was not found.
- Pick the candidate or type their name.
- Mobile should be 10 digits.
- Add the {…}.
- Check the {…}.
- The {…} cannot be in the future.
- Only open or offered positions can be checked here.
- The acceptance date cannot be before the offer date.
- The earlier backout must be on or before this offer date ({…}).
- The candidate who backed out and the one holding the offer must be different people.
- {…} already holds the offer on {…}.
- Only reopened (open) positions can be converted.
- Add a short note on why this position is fine as it is.
- Only a TA Lead, the Head of HR or the admin can correct a wrong link.
- Add the reason for the correction.
- Position not found.

### To-dos, interviews, HOD contacts, task rules (`Tasks.gs`)

- This task is already closed. Refresh the list.
- This task belongs to {…}.
- This task closes on its own once the step is recorded.
- Add a reason for snoozing.
- This task closes on its own once the step is recorded in the app.
- Unknown action.
- Application not found.
- Pick the interview date.
- Pick the interview time.
- Pick the interview round.
- Pick Teams or in person.
- Pick at least one panel member.
- Panel unavailable: {…}.
- The interview time is in the past.
- Interview not found.
- Pick who is unavailable.
- Add the reason.
- Only a TA Lead, the Head of HR or the admin can change these.
- Only a TA Lead, the Head of HR or the admin can change HOD contacts.
- Check the email for {…}.
- Only a TA Lead, the Head of HR or the admin can change task rules.
- Check the hours for {…}.
- Critical hours for {…} must be at least the due hours.

### Observations, audit sample, attachments, panel members (`Compliance.gs`)

- Only a TA Lead, the Head of HR or the admin can log observations.
- Date and observation type are required.
- Pick the recruiter this observation is against, or link a position.
- Only a TA Lead, the Head of HR or the admin can create the audit sample.
- Pick a month.
- A sample for {…} already exists.
- No positions or candidates were added or changed in {…}.
- Only a TA Lead, the Head of HR or the admin can record audit results.
- Result must be Correct or Error.
- Say which field was wrong.
- Unknown attachment type.
- Save the record before attaching a file.
- The documents folder is not set. Ask the admin to run setup().
- Only {…} or a TA Lead or the Head of HR can attach files to this position.
- Only {…} or a TA Lead or the Head of HR can attach files for this position.
- Attach the file as PDF, Word, JPG or PNG.
- No file is attached here yet.
- You do not have access to this file. Ask the CRM admin to run shareWithTeam.
- This file is larger than 15 MB. Open it from Drive instead.
- Panel member name is required.
- {…} is already in the panel list as {…}.
- Only a TA Lead, the Head of HR or the admin can edit panel members.

### Admin (`Admin.gs`)

- Only a TA Lead, the Head of HR or the admin can open this page.
- Only a TA Lead, the Head of HR or the admin can see the change history.
- Only a TA Lead, the Head of HR or the admin can run data checks.
- Only a TA Lead, the Head of HR or the admin can see this.

### Daily review / day notes (`DayReview.gs`)

- Pick a date.
- You cannot write a summary for a future date.
- You can update today and yesterday only. Ask a TA Lead or the Head of HR to change older days.

### Archive (`Archive.gs`)

- Only the admin can run the archive.
- Candidate {…} is not in the archive.

### Talent pool (`Pool.gs`)

- Position not found.

### JD library (`Jd.gs`)

- The documents folder is not set. Ask the admin to run setup().
- That JD file was not found. Refresh the list.
- Pick a file from the JD folder.

### Users (`Users.gs`)

- Only the Head of HR or the admin can see the team list.
- Only the admin can add or change users.
- Enter a valid email address (the Google account they sign in with).
- Enter the person’s name.
- Pick a role.
- {…} is already on the team list{…}
- {…} is not on the team list.
- You cannot deactivate yourself.
- You cannot remove your own Admin role. Ask another admin.
- This is the last active Admin. Make someone else Admin first.
- The recruiter name “{…} ” is already used by {…}. Recruiter names must be unique.
- The recruiter name “{…} ” is on {…} positions and candidates, and in the daily log and KPI history. Renaming it would split that history, so keep the name.
- Pick a different recruiter to take over the positions.
- Only the admin can change access.

### TAT rules (`TatRules.gs`)

- Only a TA Lead, the Head of HR or the admin can see the TAT rules.
- Change at least one level.
- Unknown level {…}.
- {…} : standard TAT must be a whole number of days from 1 to 365.
- {…} : notice grace must be 0 to 180 days.
- {…} : "at risk" must be between 50% and 99%.
- Pick the date the new rules take effect.
- Only the Head of HR or the admin can change TAT rules.

### Data layer (`Db.gs`)

- The database has no sheet named "{…} ". Check the DB file.
- Invalid date "{…} ". Use the date picker.
- Someone else is saving right now. Try again in a few seconds.
- {…} was not found. It may have been deleted.

### Setup (editor only) (`Setup.gs`)

- Paste the database sheet ID into Config.gs first.
- Database is missing sheets: {…}
- Run setup() first so the CV folder exists.

### Import (editor only) (`Import.gs`)

- A database was already imported (Script Properties → DB_ID). Delete that property first to import again.
