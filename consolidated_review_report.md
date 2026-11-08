# Consolidated Review Report (round 2)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md` (revised, 518 lines)
**Date:** 2026-11-08
**Preset:** Consolidated report, all five stages (egm-review). **Extra context:** none. **Split:** FeatureRange lines 1 to 409, DetailedRange lines 410 to 518 (confirmed by the user).
**Stage reports:** `zoom_out_report.md` (Stage 5), `comprehension_report.md` (6), `critic_report.md` (7), `intermediate_zoom_out_report.md` (8), `implementation_readiness_report.md` (9). Each stage report lists the raw findings with the reviewers' own ids; this report merges them.

## Reviewers

Ten reviewers ran, as read-only subagents with fresh context: Stage 5 `egm-zoom-out` and `egm-inventive-catalyst`; Stage 6 `egm-comprehension`; Stage 7 `egm-design`, `egm-structural`, `egm-style`; Stage 8 `egm-zoom-out`; Stage 9 `egm-implementation-readiness`, `egm-codebase-details`, `egm-style`. **All ten returned a report; none is "not run".** The plan expected about 14 reviewer runs; the harness cannot nest subagents, so each stage was dispatched directly and Stage 6 and Stage 8 each use one reviewer, giving ten.
Scope note: the two Stage 9 code-checking reviewers were allowed to read the source files the plan names (and only those). All other reviewers saw only the document, and none saw earlier reports except Stage 8, which was given the Stage 5 report. Reviewer claims about code and the document were checked by me where marked "verified" below; claims not checked are marked.

## Result: not clean

A round is clean when no reviewer raises a Blocker or Major that is not settled. This round raises **6 consolidated Blockers and 19 consolidated Majors**, with no finding contested or settled yet. The document is **not ready to go to implementation planning**.

**What the reviewers agree is sound:** one gate with no override that fails closed; distinct `No answer` and `Busy` statuses with one status-class function; the pending opt-out state; payload capture; the reaper that never resets a `Calling` row to `Waiting`; roll-forward rollback; the staged, stop-anywhere framing; a document that now has every blueprint section the standard names. The Stage 5 catalyst reviewer found no false compromise in the foundational architecture.

## Comparison with round one

Round one (reports now overwritten, in git history) was also not clean: 3 Blockers at Stage 7, 5 at Stage 9, 2 at Stage 5. The revision (29 applied fixes) changed the picture:

| Round one finding | Now |
|---|---|
| No Risks & Mitigations section; header names | **Fixed.** All five blueprint headings present; a risk table exists (its rows are criticised, see below). |
| Gate has a check-then-act race | **Fixed in text** (one `withLock_`), but other writers of the shared records (ingest, register writes, sweep, rebuilds) are not covered (CON-M17). |
| Spoken opt-out not honoured by default | **Fixed in intent** (provisional state in 1a), but the fix created new problems: the new contact record starts empty and `Voice_DND` can drift (CON-B3), the exposure window and a lost webhook are not addressed (CON-M3). |
| Refused queue row had no defined outcome | **Defined** (defer or terminal table), but the 1a defer path cannot run because the picker is Release 2 (CON-B1), and the path through `voiceStartFor_` is undefined (CON-B4). |
| New statuses overwritten as `Completed` | **Fixed in the Architecture** (`voiceApplyResult_` stores the status), but the manual fetch path cannot map through `voiceOutcome_` (CON-M2). |
| Payload "kept on the call" contradicted code | **Corrected** (inbox key, payload keys, ratings state), but `Ratings_State` cannot be computed from `voiceVars_` (CON-M2). |
| Spend ceiling undefined | **Defined** (units, blank, month), but the reviewers now call the whole reserve mechanism heavy for a pilot (CON-M6). |
| Release 3 write inside a read function | **Fixed** (moved to ingest), but the to-do mechanics do not work from the number-keyed record (CON-M3). |
| Success rate had two meanings | **Fixed** (answer rate and completion rate), but the completion measure and baseline have no implementation (CON-M15, CON-M19). |
| Consent and disclosure | Round one raised it as a Major; both Stage 5 reviewers and the Stage 7 design reviewer now call it a Blocker because it blocks 1a with no precondition (CON-B2). |

**New since the revision:** the split of Release 1 into 1a and 1b created release-assignment contradictions (CON-B1, CON-B5); the new `Voice_Contacts` and `Voice_Budget` sheets add a second source of truth and a drift problem; the longer Detailed Implementation now fails the Zero-Decision Rule in many places (CON-M1 to CON-M13).

## Blockers

### CON-B1. Release 1a creates `Scheduled` rows that nothing in 1a picks up (Stage 6 K1; Stage 7 D B1, S 1; Stage 9 R B1)
Raised by four reviewers at three stages. A `defer` turns a queue row into `Scheduled` with `Not_Before` in 1a (CUJ 5, T2); the code that picks due `Scheduled` rows, arms the one-shot trigger, stops them and refuses duplicates is written under Release 2. In 1a the minute trigger stops once no `Waiting` or `Calling` rows remain, so deferred rows are stranded until the 48-hour sweep. This breaks "each release safe to stop after" and the rollback text. **Fix:** move the pick, trigger, stop and duplicate behaviour into 1a, or have 1a defer by stopping with a visible reason.

### CON-B2. Consent and AI disclosure (Q6) blocks 1a and is not a rollout precondition (Stage 5 Z-B1 both reviewers; Stage 7 D B2; Stage 8)
The six preconditions omit it, its default is "not decided", and the design does not say how the existing agent script handles consent or disclosure today. As written it permits the first real call with no legal decision. **Fix:** a numbered precondition "HR and legal have decided Q6 in writing", with what the first batch may do if disclosure is required; make Q6 and Q3 explicit go or no-go items.

### CON-B3. Opt-out has two sources of truth and the first deploy can fail open (Stage 9 K B1; Stage 5 Z-M1 and catalyst 1; Stage 7 D M1; Stage 8)
The gate reads only `Voice_Contacts`; `Voice_DND` is a hand-editable register kept in step by code paths and a rebuild button. `voiceSchema_` creates `Voice_Contacts` empty while `Voice_DND` can already hold thousands of rows (uploads of up to 5,000, provider syncs of up to 20,000), so every registered number passes until the Admin presses rebuild; the preconditions do not list the rebuild. A hand edit or import that bypasses `voiceDndAdd_` is also invisible to the gate. The Stage 8 reviewer calls this the most important architectural flaw. **Options:** build `Voice_Contacts` from `Voice_DND` in the schema step; or have the gate read `Voice_DND` as well and fail closed on a mismatch; or, for 1a, drop `Voice_Contacts` and keep opt-out as a status column on `Voice_DND` with attempts counted from `Voice_Calls` (the Stage 8 reviewer's preference; it conflicts with the catalyst reviewer's "single store" option only on which sheet is the store).

### CON-B4. The gate's data sources and its refusal path are undefined (Stage 9 R B4, R M1, K M1, K M2, K M9; Stage 7 D M7)
Check 5 needs "the same card or the same number" but `Voice_Calls` stores only `Phone_Last4` and `Voice_Contacts` has no open-call field. The design says the gate reads only small sheets, but the existing open-call check and `voiceUsedToday_` read `Voice_Calls`; the monthly call count has no 1a source (`Voice_Budget` is 1b); the per-batch cap of 30 is enforced only in `voiceBatchCheck_` today. `voiceStartFor_` signals refusals by throwing and the queue job turns a throw into `Failed`; the plan says the gate "does not throw" but not whether `voiceStartFor_` returns a structured result or throws a typed error, so how the toast, the preview and `voiceQueueJob` read `kind` is undecided. The old open-call and DND problems would still throw first. **Fix:** name the sheet and column for each of the five checks; decide throw or return once; write the gate contract (inputs, reason strings, `kind` for each limit).

### CON-B5. Release 1a depends on items assigned to 1b or 2 (Stage 9 R B2, R B3, K M10; Stage 7 D M4, D M5, S 2, S 3; Stage 6 K2; Stage 5 Z-M5; Stage 8)
`Batch_ID` is written in 1a but is a 1b column and Release 2 finds the queue row through it; `voiceLog_` accepts the reserve in 1a though the reserve is 1b, and a missing column silently drops the value (it fills by header name); the 1b list has no schema line for `Reserved_Min`, `Batch_ID`, `Voice_Budget` or `Voice_Admin_Notes`; the screening-time baseline must exist before the pilot but its sheet and page are 1b; the 1a fetch bullet calls the Release 2 retry decision; Q8 "blocks 1a (retry and hours)" though retry is Release 2; the `noanswer` action is 1a but its task rule is Release 2. **Fix:** one table assigning each column, sheet, function, question and test to a single release; the simplest answer for the baseline is an ordinary document the owner keeps.

### CON-B6. Four releases are specified in detail on evidence for one (Stage 5 Z-B2; Stage 8 position)
The Overview says nobody has used the feature and the Problem Statement says no figures exist. Releases 1b to 3 depend on numbers the first batch will give, yet retry, spend control and sharing are specified down to build numbers 160 to 163. Note: the Stage 8 reviewer agrees with the substance but would rate this Major with a narrower fix (freeze 1b to 3 as direction only). Per the rule that severity is not changed in review, it stays a Blocker here and the disagreement is recorded. **Fix:** specify 1a fully; replace Architecture 3, 4, 7 and 8 with a short "follow-ups decided after the pilot" section with the Q5 thresholds as triggers.

## Major

### CON-M1. Ingest idempotency and atomicity for the new statuses (Stage 9 K M3; Stage 7 D M11; Stage 5 Z-M14, catalyst 8)
"Already has its result" now applies only to `Completed`; an unanswered result usually has no interaction id or transcript, so a re-delivered webhook is applied again (double `Attempts`, repeated retry decision, duplicate to-dos). Ingest writes in two steps (`voiceApplyResult_` then `voiceUpdate_`); a failure between them leaves the call `Completed` and the new retry-up-to-3 lands on the guard, losing outcome, duration and variables. The retry decision is also made at two call sites (ingest and fetch). **Fix:** one atomic write, or a result-recorded marker for every status, with one call site.

### CON-M2. The status and payload plumbing is incomplete (Stage 9 K M4, K M5, R M3; round-one fixes)
`apiVoiceFetchResult` cannot map "through `voiceOutcome_`": it works from the analytics attempt record (`connectivity_status`, `duration_in_seconds`, `interaction_id`), not `p.status`, and sets `Failed` whenever `interaction_id` is absent; it ends in `apiVoiceApplyResult`, which is Admin-only (verified), and the plan gives no principal for its retry and opt-out writes. `Ratings_State` cannot be computed from `voiceVars_` (it drops every object including `{}`); ingest must read the raw `final_agent_variables.screening_ratings`, and the fetch path has its own inline reader (verified) and no inbox row. A payload hard-cut at 45,000 characters is invalid JSON and is lost as "Unreadable payload" although T10 expects `Payload_Keys`.

### CON-M3. The opt-out mechanics are incomplete and the protection window is overstated (Stage 9 K M6, R M3, R M9; Stage 7 D M2, M3, M16; Stage 5 Z-M13, catalyst 6; Stage 6 K9)
"Protected at once" holds only after ingest (a 30-minute job or the start of a queue run); a lost webhook means the `do_not_call` never arrives. The phrase scan runs on a transcript whose tail is cut first, and a do-not-call phrase is usually at the end; the phrase list and languages are left to the implementer and the scan function is unnamed. Confirm, undo and the pending list have no API; who may confirm is unstated (only undo is Admin-only); undo does not say it also removes the number from `Voice_DND`. `voiceTaskRows_` takes `Applications` rows and builds `voice_<key>|<callId>`; `Voice_Contacts` has no card or call id, so the mapping from a number to a card and recruiter is undefined, and the disposition path would already emit `voice_optout` (duplicate) with no suppression after confirm or undo. The full number is read from the candidate record at ingest, so an edited number opts out the wrong one: store the key at placement. Reviewers also propose: a conservative hold on short or `not_interested` calls from retry, and an executable test of the `do_not_call` disposition.

### CON-M4. The per-number cap contradicts "a person decides", and attempts are undefined (Stage 5 Z-M4, Z-M10, catalyst 3; Stage 7 D M14; Stage 6 K12; Stage 7 S 5)
After 3 attempts the recruiter gets a to-do to decide, but the per-number cap (3 in 7 days) refuses any further call as `terminal`, including a manual call, for up to 7 days, and the "Call again" alternative would be refused by the same gate. There are three overlapping counters (`Attempt_Times`, `Queue.Attempts`, the trailing-failure count) with two different 3s and no stated precedence. "Attempt" is undefined (does a `Failed` placement, a `Blocked` row or a `partial` call count?). A full retry cycle uses the whole cap. **Fix:** say whether the cap binds manual calls; one derived counter; define "attempt" once; make the to-do text follow the real stop reason.

### CON-M5. Retry: scope, timing and gaps (Stage 5 Z-M3, Z-M15, catalyst 9; Stage 7 D M12, M13; Stage 6 K4, K12; Stage 9 R M7, K M7, K M8)
The simpler option (a *Call again* to-do and button) was rejected on a preference; the retry rules are ambiguous ("moved to the next window, to 11:00 if inside" read literally pushes a 14:00 retry to the next day, and Q2 states a different rule); the 48-hour expiry does not say what it is measured from and breaks on Sundays ("retry window ended" instead of "no answer after 3 attempts"); the stop reason says "no answer after 3 attempts" even if the last was `Busy`; the function that computes the next calling window does not exist (`voiceInHours_` returns only true or false); the single-call "did not answer" to-do promised in the Non-Goals is built nowhere.

### CON-M6. The spend design is heavy for a pilot, and its bound depends on a manual cross-system setting (Stage 5 Z-M2, Z-M9, catalyst 2, 5; Stage 7 D M9, M17; Stage 9 K M11, R M4)
Reserve, sweep, monthly counter sheet, invoice-derived rate, *Close* action and a compiled cap. The 1a call-count caps already bound spend; a ceiling of calls times maximum minutes times rate is a one-line check if the agent enforces a maximum duration. `VOICE_MAX_CALL_MIN` must "equal" a provider setting nobody has shown exists; the sweep could fail open (a billed call with a lost webhook drops out of spent and reserved); "planned minutes" has no source; the 30-minute open-call window equals the maximum call length so a second call can be placed while the first is pending. The Stage 5 catalyst alternative is an alert when ingest sees a call longer than `VOICE_MAX_CALL_MIN`.

### CON-M7. Release 3 (sharing) is weakly motivated, contradicts itself and depends on code that does not exist (Stage 5 Z-M7; Stage 6 K7; Stage 9 K M16)
The only evidence is one sentence. The content table says the MRF owner gets counts only, while the non-user paragraph says the message carries confirmed answers in full. `voiceShareBuild_` needs the flag labels, built inline inside `apiVoiceCallDetail`; panel matching is exact-key only, so "approximate spelling is marked" is new logic; panel splitting elsewhere uses `;` only; the `apiVoiceShareDraft(callId, who)` signature and "latest completed screening of the card" disagree; Q4 asks about a mail quota though the CRM sends no mail. `hodOf_` exists (`Pipeline.gs:1187`, verified) though `Tasks.gs` builds the HOD map inline. **Options:** remove it, or reduce it to a copy-text button with the card link.

### CON-M8. The system principal and identities are under-specified (Stage 9 K M14, R M2; Stage 6 nits)
`voiceUserFor_` throws if an email is not on the team list (verified), so a named `system` principal fails; `voiceRequireCaller_` runs before the gate and would reject it; "synthetic Admin user", "named system user" and "named `system` principal" may be one object or three; ingest is also called with the viewing user in three other places.

### CON-M9. The settings work is incomplete (Stage 9 K M17, K M18, R M4)
The outer hours bound is enforced only on save but the Settings sheet can be edited directly and `voiceInHours_` accepts windows up to 24:00, so clamp at read time. "Omitted settings keep their value" is wider than the rate: `enabled`, `openingLine`, `entryState`, `questionsVar`, `webhookUrl` and `fromNumber` also reset when omitted (so T12 would fail for them). `voiceCfgOut_` returns an explicit field list; `voiceCfg_` still has `dndRequired`; where new keys are registered is not said.

### CON-M10. Stats, statuses and display lack shapes and miss readers (Stage 9 R M5, K M12, K N7; Stage 7 nits)
The five-argument `voiceStats_` "gains" outputs and takes "new inputs"; return keys, the status-to-class map (including `Cancelled`, `Started`, "presumed spent" and the legacy `Blocked (Do Not Disturb)`), the CSV columns and `apiVoiceHealth`'s shape are not named. Readers possibly missed: `History.gs`, `Timeline.gs`, `Archive.gs` (E2E shows `histBuild_` takes a `calls` input). The reaper looks for `Starting`, `Started` or `Completed`, so a call that ended `No answer` or `Busy` is not found and its row becomes `Failed` (Stage 7 D M10, Stage 6 K6).

### CON-M11. `Scheduled` rows cannot be seen or stopped in the UI (Stage 9 K M13)
The batch table is in `voiceAdminExtras`, not `voiceBatchDialog`; the Stop button shows only when `b.open`, which counts `Waiting` plus `Calling`, so a batch with only `Scheduled` rows has no Stop button, contradicting the rollback step.

### CON-M12. Schema and constants are incomplete (Stage 9 K M11, R M6)
`Voice_Inbox` has the same creation-only column problem as `Voice_Queue`, so `Error_Count` will not appear on an existing sheet; `VOICE_CALL_EXTRA_` is the list for the new `Voice_Calls` columns; the new sheets' constants and the `Voice_Admin_Notes` columns are not defined; writers must call `dropStale_` for the new `allTasks_` stamps to help; `voiceTaskRows_` and the stamps must tolerate absent sheets.

### CON-M13. The tests are not executable as written and the E2E list is incomplete (Stage 9 K M20, K N10, R M8; Stage 7 nits)
No time seam for `voiceQueueJob` (T2); two simultaneous gate calls cannot be produced in single-threaded `e2eTest()` (T3); no mapping of T1 to T14 to V ids; existing V2, V3 and V5 touch changing code but only V4 and V6 are listed; many behaviours have no test (`voiceFindCost_`, the ingest error stop, the trigger rule, "already queued", the rebuilds, `apiVoiceBatchStop` on `Scheduled`, the 48-hour sweep, confirm and undo, the baseline and invoice rate, the audit before and after values, truncation). K also reports V1 as already failing (unverified).

### CON-M14. The Detailed Implementation is code-level, repeats the Architecture and does not follow its own rule (Stage 5 Z-M6, Z-M8; Stage 9 Y 1 to 5, K M19, R M15)
It lists signatures, message text, class names and a 375 px check; items restate behaviour although line 412 says behaviour is described once; three sections describe the retry trigger; bullets carry 5 to 9 changes (the rate-reset fix is a hidden separate change); nothing is labelled Create, Modify or Delete; about 20 new functions record no search for reuse. **Fix:** move the file list and test table into a separate implementation plan or the pull request; keep decisions, interfaces, data flow and test intent here.

### CON-M15. The pilot has no pass, exit or drill (Stage 5 Z-N3, N-2, N-3 of Stage 8; Stage 7 D M6, M15, M20)
Q5's "answer rate above 30 percent" on 5 to 10 calls has no statistical weight and no stated minimum; nothing says what happens below it or what would stop the project; "answer" and `partial` are undefined; "real" call is undefined and the gate has no way to tell real from test (a setting or number list would itself disable the limits; the team-number test call at night would be blocked); the kill switch (`VOICE_ENABLED`) is not rehearsed; the first batch cap should be the pilot size, not 30; no volume or rupee exposure estimates (300 calls at the maximum length is up to 9,000 minutes).

### CON-M16. The Alternatives and Open Questions do not meet their contracts (Stage 7 D M19, S 5, S 6; Stage 5)
"The decision is that there is none" (Admin hours override) is circular; the central choices (single gate, `Voice_Contacts` beside `Voice_DND`, immediate pending state against confirm-first, `Voice_Budget` against reading `Voice_Calls`) have no alternatives; Q6's default is "not decided" (a blocker with no usable default); Q7 blocks "before wide use", not a release; several assumed constants are not questions (3 in 7 days, 300 a month, 48 hours, 30-minute window, 15-minute backoff).

### CON-M17. Degraded modes and other writers of shared records (Stage 5 catalyst 4, Z-M11; Stage 7 D M8)
No lock-timeout behaviour, no stated maximum lock hold, no alert when "could not check" refusals pass a small number; `Voice_Contacts` and `Voice_Budget` are also written by ingest, the register functions, the sweep, the reaper and the rebuilds, which race the gate.

### CON-M18. Stated defects and goals with no design or implementation item (Stage 7 D M18, S 4; Stage 6 K10)
The `voiceFindCost_` credit-balance defect and the lost-write defect appear in the Problem Statement but have no Goal, section or release (only `Voice_Inbox.Error_Count` in a table); completion rate and recruiter minutes per completed screening have no function and no data source; the goal "the call-result writer has no access to the stage or reject functions" is implemented or tested nowhere.

### CON-M19. Wording, evidence and calibration (Stage 7 Y 1 to 9, Y nits; Stage 9 Y)
Revision narration in the status line and Alternatives intro; the "no cost field seen" and "empty ratings" evidence restated three times with no count; hard-coded numbers "assumed" in places and flat in others; "no override" stated four times; the non-user trade-off not attributed to a decision-taker; the 30-minute parenthesis repeats itself; two risk rows have no decision ("None", n/a); the glossary lists navigation, not terms; many terms are undefined for a newcomer (MRF, card, `Voice_Calls`, `Voice_Queue`, queue states, ingest, reaper, preview, `withLock_`, "pilot"); "owner" is overloaded; test ids T1 to T14 against V7 onward.

## Nits

Section order (standard lists Alternatives before Risks); "(existing)" convention names only `VoiceScreen.gs`; Alternatives has 16 flat headings and the final heading does not describe what was chosen; CUJs missing for 1b, opt-out undo and the two fixes; the Risks table cites undefined T3 and T9 and omits drift, lock contention and 10-digit number collisions; the legacy `Blocked (Do Not Disturb)` value needs a class; number keys are 10-digit Indian numbers (international numbers unaddressed); holidays out of scope; `voiceFindCost_` change silently drops `charge` and `billed` keys; `BUILD_ID` keys the dashboard snapshot cache so every release invalidates it; `Styles.html` has no "neutral text class" (only `.ok` and `.miss`); the claim of many comments in `App.html` against ADR-010 is unchecked; the rollout owner "Admin" for a code audit that is an engineering task.

## Conflicts between reviewers, with a position

*   **Cut scope versus harden scope (Stage 5 zoom-out versus catalyst).** The Stage 8 reviewer sides with cutting first: the hardening items mostly protect mechanism the cut removes (reserve, sweep, retry expiry), so harden only what remains in 1a: a single opt-out source, the degraded mode, the conservative hold, idempotent result application, one attempt counter. **My read:** this is the order that makes sense, and it is the owner's decision to make before any further edit (see below).
*   **Severity of "four releases in detail" (Stage 5 Blocker, Stage 8 Major).** Recorded above under CON-B6; not changed here.
*   **Whether `hodOf_` exists:** Stage 9 K could not read `Pipeline.gs` and called it unverified; I verified it exists at `Pipeline.gs:1187`.
*   **Single-call to-do:** Stage 6 K4 and Stage 9 K M7 agree the promise is unfulfilled; no reviewer disagrees.

## Verification notes

Verified against the source after the reports: `voiceApplyResult_` collapses non-`Failed` to `Completed` (line 534); `apiVoiceApplyResult` is Admin-only (line 526); `voiceUserFor_` throws for emails off the team list (line 861); the fetch path's inline reader drops objects (about line 1300); `hodOf_` exists. Not checked: V1 already failing; the count of block comments in `App.html`; the exact lines of the two-step ingest write; several K claims about `Api.gs`-level registration (K did not read it).

## Traceability

| Consolidated | Stage 5 | Stage 6 | Stage 7 | Stage 8 | Stage 9 |
|---|---|---|---|---|---|
| CON-B1 | | K1 | D B1, S 1 | | R B1 |
| CON-B2 | Z-B1 | | D B2 | Z-B1 | |
| CON-B3 | Z-M1, catalyst 1 | | D M1 | Z-M1 | K B1, R M3 |
| CON-B4 | | | D M7 | | R B4, R M1, K M1, K M2, K M9 |
| CON-B5 | Z-M5 | K2 | D M4, D M5, S 2, S 3 | Z-M5 | R B2, R B3, K M10 |
| CON-B6 | Z-B2 | | | Z-B2 | |
| CON-M1 | Z-M14, catalyst 8 | | D M11 | Z-M14 | K M3 |
| CON-M2 | | | | | K M4, K M5, R M3 |
| CON-M3 | Z-M13, catalyst 6 | K9 | D M2, D M3, D M16 | Z-M13 | K M6, R M3, R M9 |
| CON-M4 | Z-M4, Z-M10, catalyst 3 | K12 | D M14, S 5 | Z-M4, Z-M10 | |
| CON-M5 | Z-M3, Z-M15, catalyst 9 | K4, K12 | D M12, D M13 | Z-M3, Z-M15 | R M7, K M7, K M8 |
| CON-M6 | Z-M2, Z-M9, catalyst 2, 5 | | D M9, D M17 | Z-M2, Z-M9, Z-M12 | K M11, R M4 |
| CON-M7 | Z-M7 | K7 | | Z-M7 | K M16 |
| CON-M8 | | nits | | | K M14, R M2 |
| CON-M9 | | | | | K M17, K M18, R M4 |
| CON-M10 | | K6 | D M10 | | R M5, K M12, K N7 |
| CON-M11 | | | | | K M13 |
| CON-M12 | | | | | K M11, R M6 |
| CON-M13 | | nits | | | K M20, K N10, R M8 |
| CON-M14 | Z-M6, Z-M8 | | | Z-M6, Z-M8 | Y 1 to 5, K M19, R M15 |
| CON-M15 | Z-N3 | | D M6, D M15, D M20 | N-2, N-3 | |
| CON-M16 | | | D M19, S 5, S 6 | | |
| CON-M17 | catalyst 4, Z-M11 | | D M8 | Z-M11 | |
| CON-M18 | | K10 | D M18, S 4 | | |
| CON-M19 | Z-N1, Z-N2, Z-N5, Z-N6 | nits | Y 1 to 23 | | Y 6 to 18 |

## What to do next

Run `egm-resolve` on `docs/designs/voice-screening-gate-retry-sharing.md` with the findings in this report. **Decide the scope first.** The reviewers' two views cannot both be applied in full: cutting the design to Release 1a removes most of CON-M5, CON-M6, CON-M7, CON-M11, CON-M17 (in part) and several of the largest tangles in CON-B1, CON-B5 and CON-M14, while hardening all four releases adds mechanism to code that may never be built. The three things any version of the document needs regardless: the consent precondition (CON-B2), one source of truth for opt-out that is populated before first use (CON-B3), and a defined refusal path with named data sources for the gate (CON-B4).
