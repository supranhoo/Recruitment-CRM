# Stage 9: Implementation Readiness Test (round 2, revised design)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md`, DetailedRange lines 410 to 518 (Detailed Implementation)
**Date:** 2026-11-08
**Reviewers:** `egm-implementation-readiness` (R) and `egm-codebase-details` (K), both against `implementation-readiness-standard.md`, and `egm-style` (Y). All three completed. R and K were allowed to read the source files named in the Detailed Implementation (`VoiceScreen.gs`, `Tasks.gs`, `App.html`, `Styles.html`, `Config.gs`, `Compliance.gs`, `Dashboard.gs`, `E2E.gs`) and the design, and nothing else; the Y reviewer read the document only. That goes beyond a reading list and is why they could check code.
**Round result:** not clean. R's verdict: the section fails the Zero-Decision Rule and the phasing rule as written. K's verdict: no item the document calls current is simply absent; the findings are gaps, contradictions and decisions left to the implementer.

**Verified by me against the source after the reports came in:** `voiceApplyResult_` stores any status that is not `Failed` as `Completed` (`VoiceScreen.gs:534`); `apiVoiceApplyResult` is Admin-only (`requireVoiceAdmin_`, line 526); `voiceUserFor_` throws if an email is not on the team list (line 861); `apiVoiceFetchResult` has its own inline variable reader that drops objects (about line 1300); `hodOf_` exists at `Pipeline.gs:1187`. **Not independently checked:** K's claim that E2E V1 already fails (V1 asserts `c.connected === false`; `voiceProviderConnected_` is `voicePlaceWritten_() && voiceDndWritten_()` and `voiceDndWritten_` returns true, so it depends on `voicePlaceWritten_`); K's claim of about 139 block comments in `App.html` against ADR-010 (a grep of lines 6010 to 6340 found 5 comment-like markers, which may sit inside strings); the lines K cites for the two-step ingest write.

Ids: `R`, `K`, `Y` followed by each reviewer's own number (`B` blocker, `M` major, `N` nit). Merged findings list every source id.

## Blockers

### IR-B1. Deferred rows are stranded in Release 1a (R B1)
Gate refusals in 1a set queue rows to `Scheduled` with `Not_Before`; the `voiceQueuePick_` change that picks due `Scheduled` rows is listed only under Release 2. The trigger rule is in the 1a list, but nothing in 1a picks the rows up, and `voiceQueueJob` turns the trigger off when no `Waiting` or `Calling` rows exist, so every deferred row sits until the 48-hour sweep and test T2 cannot pass.
**Fix:** move the pick change (due `Scheduled` rows plus the row-to-number map) and the V6 update into 1a, with the `Not_Before` due test.

### IR-B2. Release 1a writes columns that exist only from 1b, and the 1b list has no schema line (R B2; K M10)
`voiceStartFor_` writes `Batch_ID` in 1a and `voiceLog_` accepts the reserve in 1a, but `Batch_ID` and `Reserved_Min` are 1b columns. The 1b list never adds `Reserved_Min`, `Batch_ID`, `Voice_Budget` or `Voice_Admin_Notes` in `voiceSchema_`. `voiceLog_` fills columns by header name, so a missing column silently drops the value. The 1a `apiVoiceFetchResult` bullet also calls the Release 2 retry decision. **Fix:** put `Batch_ID` in 1a or drop the instruction; add a 1b `voiceSchema_` line; align each bullet with the data-model release column.

### IR-B3. The screening-time baseline cannot be entered before the pilot (R B3)
Section 6 (1a) says the Admin enters it "before the pilot", but the sheet and entry page are 1b, and the first real batch runs after 1a and before 1b. **Fix:** move the baseline half to 1a, or state that it is recorded without code.

### IR-B4. The gate's "one open call", "same number" and monthly-count facts have no data source (R B4; K M9)
Check 5 needs "the same card or the same number", but `Voice_Calls` stores only `Phone_Last4` and `Voice_Contacts` has no open-call field. The design says the gate reads small sheets, not `Voice_Calls`, but the existing open-call check and `voiceUsedToday_` read `voiceCallsRows_`. `VOICE_MAX_CALLS_MONTH` has no counter in 1a (`Voice_Budget` is 1b and counts minutes). The per-batch cap of 30 is enforced today only in `voiceBatchCheck_` (line 888), not at placement. Whether the existing open-call check and its `problems` entry (lines 432 to 436) stay or go is not said. **Fix:** for each of the five checks, name the exact sheet and column and how the number is derived; say what happens to the existing check.

### IR-B5. The first deploy can fail open: `Voice_Contacts` starts empty (K B1; R M3)
Today the opt-out check reads `Voice_DND` directly (`voiceDndCheck_`, `voiceDndNumbers_`). The plan makes `Voice_Contacts` the gate's only input, and `voiceSchema_` creates it empty, while `Voice_DND` can already hold thousands of rows (uploads of up to 5,000, provider syncs of up to 20,000). Until the Admin presses the rebuild button every registered number passes the gate, which breaks "none to a number on the opt-out register". The rollout preconditions do not list the rebuild. **Fix:** build `Voice_Contacts` from `Voice_DND` inside the schema step when the sheet is first created, or have the gate OR both sources; add the rebuild to the preconditions.

## Major

### IR-M1. A gate refusal has no defined path through `voiceStartFor_`, and the old checks are not folded in (K M1, M2; R M1, M2)
`voiceStartFor_` signals every refusal by throwing today (the open-call problem at line 434, the opt-out throw at line 450), and the queue job turns any throw into `Failed`, feeding the "three failed" rule. The plan says the gate "does not throw" but not whether `voiceStartFor_` returns a structured result or throws a typed error, nor how the card toast and `voicePreviewDialog` get the reason, nor how `voiceQueueJob` reads `kind`. The old open-call problem would throw before the gate runs, so a queue row with an open call would still become `Failed` (the thing the plan says must not happen). The `out.dnd` text and the "DND check not connected" problem (lines 435, 442) are tied to `dndRequired` and not listed; `voicePreviewDialog` renders `r.dnd` (App.html:6333). The daily limit is already enforced earlier by `voiceRequireCaller_` (line 631), which throws, and the plan puts it in the gate too without removing the throw; `voiceQueueStopReason_` still matches the limit text while gate refusals "no longer go through it". The gate's contract (field names, exact `reason` strings, `kind` for the daily limit, per-batch and monthly caps, a monthly cap deferring up to the 48-hour window, the "presumed spent" state which `Voice_Budget` has no marker for) is not specified. **Fix:** decide throw versus return once and write the contract.

### IR-M2. Ingest idempotency and atomicity for the new statuses are undefined (K M3; R)
The repeat-delivery guards depend on a non-empty `Interaction_ID` and on `Status === 'Completed'` with a transcript (lines 1220, 1225). A `No answer` or `Busy` result typically has neither, so a re-delivered webhook would be applied again, double-incrementing `Attempts` and `Attempt_Times`, repeating the retry decision and duplicating to-dos. Ingest also writes in two steps (`voiceApplyResult_`, then `voiceUpdate_`); a failure between them leaves the call `Completed`, and the new "retry up to 3 times" then lands on the guard and marks the row processed, losing outcome, duration, variables and cost for good (line numbers 1227 to 1234 as reported by K; not independently checked). **Fix:** one atomic write, or an idempotency rule keyed on a result-recorded marker for every status.

### IR-M3. `Ratings_State` and `Payload_Keys` cannot be computed from `voiceVars_` (K M4)
`voiceVars_` drops every object value including an empty `{}`, so `present`, `empty` and `absent` cannot be told apart from its output; ingest must read the raw `p.final_agent_variables.screening_ratings`, which the plan does not say. `apiVoiceFetchResult` has its own inline reader (verified), so extending `voiceVars_` misses it, and the fetch path has no inbox row, so it cannot write `Inbox_Key` or `Payload_Keys`. A payload hard-cut at the 45,000-character limit is invalid JSON and ends as "Unreadable payload" (ingest `JSON.parse`, line 1211), so the result is lost although T10 expects `Payload_Keys`.

### IR-M4. `apiVoiceFetchResult` cannot map "through `voiceOutcome_`" (K M5)
`voiceOutcome_` reads `p.status` or `p.completion_status` from the webhook payload. The fetch works from the analytics attempt record (`connectivity_status`, `duration_in_seconds`, `interaction_id`) and sets `Failed` whenever `interaction_id` is absent. Passing the attempt record to `voiceOutcome_` yields "No result". The plan does not say which attempt field maps to `No answer` or `Busy`. The fetch ends in `apiVoiceApplyResult`, which is Admin-only (verified), so a recruiter or lead who passes the fetch permission check then fails; and no principal is given for the retry and opt-out writes it is meant to run.

### IR-M5. The opt-out to-do mechanics do not work as designed (K M6; R M3)
`voiceTaskRows_(apps)` takes `Applications` rows and builds the task key `voice_<key>|<callId>` (Tasks.gs:397 to 401). `Voice_Contacts` is keyed by number and has no `App_ID` or `Call_ID`; the plan does not say how a number maps to a card, which card or recruiter gets the to-do when a number sits on several cards, or what `callId` goes in the key. Adding `do_not_call -> optout` to `voiceDispositionAction_` already makes the existing path emit `voice_optout|callId`; a second source from `Voice_Contacts` would duplicate it, and the disposition-derived to-do has no suppression after Confirm or Undo (the code suppresses only `review` and `incomplete`). A transcript-only opt-out has no disposition, so only the contact-record path can produce its to-do. The read must tolerate the sheet not existing (the existing code guards `Voice_Calls` with `getSheetByName`, line 1141). Who may Confirm is not stated (only Undo is Admin-only, Q3), and the Confirm and Undo buttons have no API behind them; the pending opt-out list is placed in `renderVoiceAdmin`, but the register and batches panels are in `voiceAdminExtras`.

### IR-M6. The single-call "did not answer" to-do is promised and not delivered (K M7; R M12 in Stage 7)
Non-Goals say a single call from a card that ends unanswered gets the same to-do, but the plan builds it only from queue rows whose retries ended (Release 2), and a single call has no queue row. In 1a, with the statuses live, unanswered calls produce no to-do at all, and the `noanswer` action key is added in 1a while its task rule `voice_noanswer` is in Release 2.

### IR-M7. The function that computes the next calling window is missing (K M8; R M1)
Nothing computes "next calling window start", needed for `Scheduled.Not_Before`, T2's "09:00 next window", the 15-minute backoff, the Sunday skip and the Release 2 11:00 rule. `voiceInHours_` returns only true or false (line 827). Name and specify it (including the case where 11:00 falls outside the window).

### IR-M8. The system principal and the identity used by ingest are under-specified (K M14; R M2)
The queue job builds users with `voiceUserFor_`, which throws if the email is not on the team list (verified), so a named `system` principal fails. `voiceStartFor_` also runs `voiceRequireCaller_`; a principal that bypasses the daily limit has to carry `voice_agent` or be special-cased, and neither is stated. `voiceIngest_(u)` is also called with the viewing user in `apiVoiceConfig` (line 84), `apiVoicePlanDraft` (299) and `apiVoiceCallsFor` (1390); the plan switches only the queue job and the dashboard job. The text uses three names ("synthetic Admin user", "named system user", "named `system` principal") for what may be one object. Specify the object literal once and state that the side-effect writes inside `voiceIngestRun_` ignore the caller identity.

### IR-M9. Several new callable functions are not named (K M15; R M3)
Missing: confirm and undo opt-out, the pending opt-out list, close call (sets `Cancelled`), save and read the baseline and invoice, the API wrappers for the two rebuild buttons, the phrase-scan function (the phrase list and "languages in use" are left to the implementer, which the standard forbids). Not stated: the permission each uses, how each is exposed to the page, and whether any registration file such as `Api.gs` is touched.

### IR-M10. Settings work is incomplete (K M17, M18; R M4)
The outer hours bound is enforced only on save, but the Settings sheet can be edited directly and `voiceInHours_` accepts windows up to 24:00, so the gate must clamp at read time. "Omitted settings keep their value" is wider than the plan says: `enabled` (line 131), `openingLine`, `entryState`, `questionsVar`, `webhookUrl` and `fromNumber` also reset to blank or No when omitted, so T12 would fail for them unless the scope is widened. `voiceCfg_` still has `dndRequired` and `voiceCfgOut_` returns it; whether these are deleted, hard-wired to Yes or left is not said. It is not stated where new keys are registered or seeded. "Planned minutes" has no source (it may always equal `VOICE_MAX_CALL_MIN`). "The higher of configured and invoice rate" does not say which invoice. The `Voice_Budget.Month` key format is not given.

### IR-M11. `voiceStats_` and the status class lack shapes (K M12; R M5)
The plan says `voiceStats_` "keeps its five-argument form" and also "gains" buckets and that `apiVoiceStats` "passes new inputs"; V4 (E2E.gs:657 to 662) asserts values that do not change if the signature is unchanged. Return keys for ratings counts and median minutes are not named, nor the `voiceStatusClass_` identifiers, the status-to-class map (for `Cancelled`, `Started`, "presumed spent" and the legacy `Blocked (Do Not Disturb)`), the CSV header columns, the `apiVoiceHealth` return shape, or the `apiVoiceBatches` field for the `Scheduled` count. Answer rate and completion rate need screening data `voiceStats_` does not have.

### IR-M12. Batch visibility and Stop do not work for `Scheduled` rows (K M13)
The batch status table is in `voiceAdminExtras` (App.html:6115 to 6117), fed by `apiVoiceBatches`, not in `voiceBatchDialog`. `apiVoiceBatches` computes `open` as `Waiting` plus `Calling` and the Stop button shows only when `b.open`, so a batch with only `Scheduled` rows shows no Stop button. That contradicts the rollback step "stop all batches including `Scheduled` rows".

### IR-M13. Schema work is incomplete (K M11; R M6)
Only `Voice_Queue` is called out for the `addColumns_` fix; `Voice_Inbox` has the same creation-only problem (`addSheet_` with `VOICE_INBOX_.cols`, line 44), so `Error_Count` will not appear on an existing sheet. `VOICE_CALL_EXTRA_` (line 18) is the list that gets the new `Voice_Calls` columns. Constants for the new sheets are not named. `voiceTaskRows_` and the `allTasks_` stamps must tolerate absent new sheets; writers must call `dropStale_` for the `allTasks_` stamp to help (only `Voice_DND` and `Voice_Queue` do today). `Voice_Admin_Notes` columns are not defined.

### IR-M14. The share message depends on code that is not callable or is exact-match only (K M16)
`voiceShareBuild_` needs the flag labels, which are built inline inside `apiVoiceCallDetail` (lines 1325 to 1331), not in a reusable function; no refactor is listed. `panelEmailIndex_` and `panelKey_` do exist and match exact normalised keys only and do not filter inactive members, so "a name matched by approximate spelling is marked" is new, unspecified logic. Existing panel splits use `;` only; the plan splits on commas as well. `hodOf_` exists (`Pipeline.gs:1187`), though `Tasks.gs` builds the HOD map inline and never calls it. The `apiVoiceShareDraft(callId, who)` signature takes a call id while the text says "latest completed screening of the card"; pick one.

### IR-M15. The tests are not executable as written (K M20, N10; R M8)
`voiceQueueJob` uses `Date.now()` directly, so T2's "clock passes 19:00" has no time seam; two simultaneous gate calls (T3) cannot be produced in a single-threaded `e2eTest()`. There is no mapping from T1 to T14 to `e2eTest()` names (existing are V1 to V6; the text says V7 onward). Existing V2 (dispositions), V3 (access and register) and V5 (DND mirror) touch changing code, but only V4 and V6 are listed for update. No tests are listed for `voiceFindCost_`, the ingest `Error_Count` stop, the trigger arming and one-shot rule, the "already queued" skip, the two rebuild functions, `apiVoiceBatchStop` on `Scheduled`, the 48-hour sweep, confirm and undo, the baseline and invoice rate, the settings audit before and after values, and the 45,000-character truncation.

### IR-M16. The file boundary is not exact (K M19; R M15 of round 1 pattern, N3)
Nothing is labelled Create, Modify or Delete; reported once per the standard. `Styles.html` is "no change" and `Compliance.gs` is "no change": say "not modified" and drop them from the boundary. The `App.html` bullets are tagged "releases 1 to 4" with no release mapping; the `Scheduled` display, the "already queued" reason and the share buttons belong to later releases. `VoiceScreen.gs` omits functions the plan changes or depends on (`voiceLog_`, `voiceCfgOut_`, `voiceQueueStopReason_`, `apiVoiceBatches`, `apiVoiceBatchStop`, `apiVoiceFetchResult`, `voiceQueueTrigger_`, and the writers and readers of `Reason` that move to `Stop_Reason`: `voiceQueueJob` line 986, `apiVoiceBatchStop` line 941, `apiVoiceBatches` line 957).

### IR-M17. Style: the section does not follow its own rule, and bullets are overloaded (Y 1 to 5)
Line 412 says "Behaviour is described once, in the Architecture; here each item says what changes and why", but items restate behaviour (error text and bounds at line 434, the three-failure stamping rule at 429, the cost-key rule at 431, task text at 460); delete the claim or move the rules. "T ids are assumed to follow V6" hedges with no decision: state the mapping or say the T ids are document-local. "There is no test command in the repository, so the deploy check is still a syntax gate" cites no evidence (name the step; the visual check has no owner). "Nearly every voice function" is imprecise; the `miss` class reference is circular because the map is new in this release. Lines 428, 434 and 435 each carry 5 to 9 semicolon-separated changes and hide scope (the rate-reset fix is a separate behaviour change); split them.

## Nits

*   Line 431: "sibling key naming a currency" does not define "sibling". Line 427: the 1a bullet for `apiVoiceFetchResult` says "run the retry decision (Release 2)", an instruction to call a function that does not exist yet. (R N1, N2)
*   `Dashboard.gs`: name the new step key beside the existing ingest `runStep_` (about line 84). The "already queued" reason text and the preview field it appears in are not stated. SSOT section numbers and the ADR count could not be checked. (R N4 to N6)
*   `voiceQueuePick_` does no per-number dedupe today (`doneNumbers` is read into `seen` and never used; the job passes `[]` at line 973); state the new signature and parameter order. V6 calls `(rows, 1, [])`. (K N2)
*   `voiceBatchCheck_` already runs `voiceDndCheck_` and `voiceStartFor_` dry-run per card (lines 899 to 900); "read facts once per batch" gives no mechanism to pass the facts in. (K N3)
*   The Problem Statement says calling hours are checked "in the batch paths (`voiceQueueJob`, `voiceBatchCheck_`)"; `voiceBatchCheck_` only reports `inHours` (line 909) and only `voiceQueueJob` enforces it. (K N4)
*   `voiceFindCost_` change drops `charge` and `billed` keys silently (the current regex is `cost|charge|credit|price|billed`) and `Cost_Unit` changes meaning from key name to currency; state it. (K N5)
*   `noanswer` is a retry-exhaustion result, not a disposition, so it does not fit the map keyed by the agent's disposition string; give the key. (K N6)
*   The legacy `Blocked (Do Not Disturb)` value must be recognised by both `voiceStatusClass_` and `VOICE_STATUS_CLASS_`, or T9's "unknown status logged loudly" fires for every old row. There is no "neutral text class": neutral statuses use an empty class; only `.ok` and `.miss` exist (Styles.html:254). (K N7, N8)
*   ADR-010: K reports `App.html` containing many comments; clarify what ADR-010 forbids (my grep of lines 6010 to 6340 found 5 comment-like markers; unchecked whether they are in strings). (K N9)
*   History.gs, Timeline.gs and Archive.gs may read `Voice_Calls` status (E2E.gs:643 shows `histBuild_` takes a `calls` input); the reader list and T9 cover only `VoiceScreen.gs`, `Tasks.gs` and `App.html`. (K N13)
*   `voiceIngest_` holds `withLock_` for the whole run (line 1201); the gate's lock waits behind it and the plan adds work under that lock. Nested `withLock_` already exists; reentrancy could not be confirmed without `Db.gs`. (K N12)
*   `BUILD_ID` keys the dashboard snapshot cache (Dashboard.gs:9, 15), so each release invalidates it; where the page's copy of `BUILD_ID` lives is not found in `App.html`. (K N14)
*   Style: "This is the list of repository changes" is filler; "currently '159'" should be code format; "(new)" and "(existing)" are used inconsistently (`apiVoiceHealth`, `voiceStatusClass_`, `voiceQueueStopReason_ (existing)`); "stays" and "still" imply history; `voiceQueueReap_ (new): the reaper` is circular; `open` is a bucket, not a function; the "up to 10 minutes" figure needs its source constant; the sweep call from `refreshDashboardJob` is stated three times; line 495 is a 130-word bullet and its "one ADR each" count is ambiguous; T9 expects unknown-status logging that no item implements; expected-result cells mix tense and semicolon chains; "Also:" should be "Additional checks". (Y 6 to 18)

## What passes

The file inventory by release and the repository paths are real; the `BUILD_ID` plan (159 to 160 to 163); the existing function names used (`voiceInHours_`, `voiceQueuePick_`, `voiceQueueTrailingFails_`, `panelEmailIndex_`, `panelKey_`, `hodOf_`, `withLock_`, `addColumns_`); most 1b formulas (reserve, ceiling equality, blank ceiling, no-rate block). Existing-behaviour claims that match the code (K): `voiceOutcome_`, `voiceApplyResult_` collapsing non-Failed to `Completed`, `voiceUsedToday_` (line 614), `voiceQueueTrailingFails_` (850), `voiceQueueTrigger_(on)` (872), `voiceCfgOut_` (69), `voiceVars_` (1185), the `voiceFindCost_` regex (1109), `voiceStats_` five-argument form (1009), `voiceDispositionAction_` as a pure map, the rate reset to 0 (121), `Candidate_ID` written empty on queue rows (924), `BUILD_ID` '159', `SCHEMA_VERSION` '47' and the `voiceSchema_` step, the `voice_*` task rule shape, the missing stamp-list entries (Tasks.gs:469), and `refreshDashboardJob` calling ingest as a synthetic Admin (Dashboard.gs:84 to 86).

## Traceability

| Consolidated | Source ids |
|---|---|
| IR-B1 | R B1 |
| IR-B2 | R B2, K M10 |
| IR-B3 | R B3 |
| IR-B4 | R B4, K M9 |
| IR-B5 | K B1, R M3 |
| IR-M1 | K M1, K M2, R M1, R M2 |
| IR-M2 | K M3 |
| IR-M3 | K M4 |
| IR-M4 | K M5 |
| IR-M5 | K M6, R M3 |
| IR-M6 | K M7 |
| IR-M7 | K M8, R M1 |
| IR-M8 | K M14, R M2 |
| IR-M9 | K M15, R M3 |
| IR-M10 | K M17, K M18, R M4 |
| IR-M11 | K M12, R M5 |
| IR-M12 | K M13 |
| IR-M13 | K M11, R M6, R M7 |
| IR-M14 | K M16 |
| IR-M15 | K M20, K N10, R M8 |
| IR-M16 | K M19, R N3 |
| IR-M17 | Y 1 to 5 |
| Nits | R N1, N2, N4 to N6; K N1 to N9, N11 to N14; Y 6 to 18 |
