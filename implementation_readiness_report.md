# Stage 9: Implementation Readiness Test (round 1)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md`, DetailedRange lines 284 to 406 (the Detailed Implementation section)
**Date:** 2026-11-08
**Reviewers:** `egm-implementation-readiness` and `egm-codebase-details` (both against `implementation-readiness-standard.md`) and `egm-style`. All three completed; none is "not run".
**Scope note.** Earlier stages ran with no files beyond the document. Here the two reviewers who check the plan against code were allowed to read the source files that the plan itself names (`VoiceScreen.gs`, `Tasks.gs`, `App.html`, `Styles.html`, `Config.gs`, `Compliance.gs`, `Dashboard.gs`, `E2E.gs`) and nothing else, so they could say whether an engineer could act on the text. The style reviewer read the document only. The choice was made so the codebase reviewer could do its job; it goes beyond your "no extra context" answer, which covered a reading list.
**Round result:** not clean. The readiness reviewer's verdict is that the section does not meet the Zero-Decision Rule: an engineer following it literally would produce wrong behaviour in places, and in others would have to make design decisions.

I checked two of the claims myself against `VoiceScreen.gs`. `voiceApplyResult_` stores any status that is not `Failed` as `Completed` (line 534), and `voiceDispositionAction_` is a pure string-to-label function with no call, card or user (line 1163). Both are true.

Finding ids: `R` readiness, `K` codebase, `Y` style; numbers follow each reviewer's own list. Findings raised by both R and K are merged.

## Blockers

### E1. The new `No answer` and `Busy` statuses never reach the call row (R B1, K 2)

The plan changes `voiceOutcome_` to return the new statuses (line 306) but lists `voiceApplyResult_` only for `Payload_Keys` and `Reserved_Min` (line 316). `voiceApplyResult_` (VoiceScreen.gs:534) stores `Failed` as `Failed` and every other status as `Completed`. Followed literally, `No answer` and `Busy` calls would be stored as `Completed`: the daily-limit change would not apply, retry would never fire, and the answered-call to-do path would treat them as answered, with no error. The manual fetch path (`apiVoiceFetchResult`, about lines 1277 to 1306) sets its own `Outcome` from the connection status, passes only `Failed` or `Completed`, and is not in the plan, so a fetched unanswered call is never classified and no retry decision is made.
**Needed:** say how `voiceApplyResult_` accepts the four result statuses (and fix its comment and the answers-draft branch), and what `apiVoiceFetchResult` does for an unanswered call, including whether it triggers the retry decision.

### E2. The first batch's main learning goal has nowhere to be stored (R B2, K 1)

The design says the raw provider payload is kept on every call in `Voice_Calls.Final_Vars_JSON`. The code does not do that. `voiceVars_` (VoiceScreen.gs:1183 to 1187) keeps only non-empty, non-object, scalar variables, capped at 4,000 characters each, so an object-valued `screening_ratings` is discarded and an empty one never reaches the sheet. The raw payload exists only in `Voice_Inbox.Payload`, which has no link to a call. `Payload_Keys` lists only top-level field names, and `screening_ratings` is nested under the variables, so "ratings arrived: present, empty or absent" cannot be derived from what the plan stores. Release 1 cannot answer the question it exists to answer.
**Needed:** define exactly what is persisted per call (for example a ratings-state column, nested key paths, or a link from the inbox row to the call) and how `voiceStats_` reads it. Correct the design's "raw payload is kept" statement.

### E3. The spend ceiling cannot be coded without design choices (R B3)

Not stated: which unit applies (line 310 blocks a rupee ceiling with no rate; the design says it falls back to minutes) and which setting selects it; whether a blank or zero ceiling means unlimited or blocked (the gate is meant to fail closed); whether "month" is the calendar month in India time, and whether it is counted from `Started_At` or `Completed_At`. `voiceMayCall_(u, app, cand, phone, cfg, opts)` has no batch id or planned seconds, though the reserve needs the plan's seconds and the per-batch ceiling needs a batch. How a batch's spend is summed (queue rows joined to `Call_ID`) is not said, nor that single calls skip the batch ceiling (K 10: `voiceQueueJob` calls `voiceStartFor_(u, appId, {})`, so the gate does not know the batch; `Voice_Calls` has no batch id).
**Needed:** one rule for each, and the missing inputs added to the signature.

### E4. A gate refusal inside the queue run has no defined outcome (R B4, K 4, K 5)

Today `voiceQueueJob` marks the queue row `Failed` whenever `voiceStartFor_` throws, counts consecutive `Failed` rows, and stops the batch with the "check the key and the connection" message (VoiceScreen.gs:966 to 995; the stop regex matches only the limit and access texts, lines 844 to 845). The plan does not say whether a gate refusal throws or returns, or what the row becomes for each reason (hours, budget, opt-out, limit, could not check). Kept as is, a run that crosses 19:00 drains every remaining `Waiting` row to `Failed`, three budget or opt-out refusals trip the "three in a row" stop with a misleading message, and `Scheduled` retry rows refused by the gate are lost as `Failed`. Whether the top-of-run hours return (line 967) stays is not said; if it goes, every row is claimed and failed out of hours. The E2E case "a run that crosses 19:00" (line 366) has no defined expected result.
**Needed:** per refusal type, the row's next status (`Waiting`, `Scheduled`, `Stopped` or `Failed`), whether the batch stops, which refusals count toward three in a row, and how an hours refusal ends the run.

### E5. Release 3 puts a write inside a read-time function (K 3)

`voiceDispositionAction_(disposition)` (VoiceScreen.gs:1163 to 1173) is a pure string-to-`{key, title, why}` mapper. It is called at read time from `voiceTaskRows_` (line 1154) and `apiVoiceCallDetail` (line 1339), and has no call, card, phone or user. The plan makes it stop retries and write `Voice_DND` (lines 328 and 191). That would write on every task refresh or detail open, and the function cannot reach the data it needs. CUJ 4 says the write happens "when the result is read by the ingest".
**Needed:** move the register write and the retry stop into `voiceIngestRun_`, and keep `voiceDispositionAction_` for the to-do mapping only. State that undo is Admin-only today (`apiVoiceDndRemove` calls `requireVoiceAdmin_`, line 692), because the goal says "a person can undo it".

## Major

### E6. The gate's reasons and statuses are inconsistent with the existing code (R M6, K 4)

There are five gate reasons plus "could not check", but only two new `Blocked` values are added beside the existing `Blocked (Do Not Disturb)`. Limit, open-call and could-not-check refusals have no status, so "calls blocked by reason (hours, opt-out, budget, limit)" (line 308) cannot be computed except by parsing note text. The daily limit is already enforced earlier in `voiceRequireCaller_` (line 631), which throws before any row is written and is skipped in preview. The open-call problem at line 432 already exists. The dry run returns at line 444, before the register check. The plan does not say whether the gate replaces or duplicates these, whether a refusal throws or is returned as a preview `problems` entry, or that preview must not write a `Blocked` row.

### E7. The reserve is not released on a failed placement, and `voiceLog_` is not in the change list (R M1, K 8)

`Reserved_Min` is written when the call is logged `Starting` and cleared only by ingest or the sweep. When `voicePlaceCall_` throws (VoiceScreen.gs:459) the row becomes `Failed`, no result ever arrives, and the reserve holds budget for `VOICE_MAX_CALL_MIN` plus 60 minutes. `voiceLog_` (line 496) takes no reserve argument. The sweep's marker "No result: fetch or close" has no home: no "close" action exists (`Cancelled` is listed but nothing sets it), and the Fetch button appears only when `last.status === 'Started'` (App.html:6199), so a swept call still shows Fetch.

### E8. The check-and-reserve is not atomic (R M2)

The gate reads facts outside any lock, and `voiceLog_` takes the lock only for its own write. A single call and a queue run (or two queue runs) can both pass and over-commit a hard limit. State whether gate and reserve write sit inside one `withLock_`.

### E9. The sweep and reaper do not run when the trigger is off (R M3)

`voiceQueueJob` returns early when no `Waiting` or `Calling` row exists (VoiceScreen.gs:966) and removes the trigger. `voiceBudgetSweep_` and `voiceQueueReap_` run inside that job, so with no open batch a lost webhook keeps budget reserved against single calls until a later batch starts. The plan says `Dashboard.gs` needs no change; say where the sweep runs when no batch is open.

### E10. Ingest as the first step of the queue job has no user (R M4, K 6)

`voiceIngestRun_(u)` skips any call that the user may not review (line 1215). `refreshDashboardJob` passes a synthetic Admin object (Dashboard.gs:85). The plan does not say what the queue job passes, so results may be silently skipped.

### E11. The reaper treats any call row as "placed" (R M5, K 17)

The rule "a `Voice_Calls` row for the same card started since the claim means `Placed`" also matches a `Blocked` or `Failed` row logged in that window. Only `Starting`, `Started` or `Completed` rows should count. The claim time must come from `Updated_At` (`voiceQueueWrite_`, line 868).

### E12. Retry fields and bookkeeping are unsourced (R M7, K 11)

Where `Max_Attempts` is written is not said (`apiVoiceBatchStart` builds the row, line 924, and is not listed for it), and no setting holds the default of 3. When `Attempts` is incremented (claim, placing or result) is not said. A queue row's `Call_ID` is overwritten on each attempt, so ingest cannot find the row by it. Single calls from a card have no queue row, so they get no retry and no "did not answer" to-do, though the Goals say a candidate who did not answer is retried. The retry plan text has two spellings and no grammar, nothing says what applies to attempt 3 and later, how `apiVoiceConfigSave` validates it, or that an empty plan means retry off. `voiceRetryNext_(row, outcome, plan, now, hours)` has no disposition, screening-complete or blocked input, though it "stops on" them (and those cases are largely unreachable because it retries only after `No answer` or `Busy`). "Next day 11:00" can fall outside a configured window or on a Sunday; which wins is not said. `Stop_Reason` here and the existing `Reason` column in `voiceQueueJob` should be one.

### E13. `apiVoiceBatchStop` leaves `Scheduled` rows live; `voiceQueueTrigger_` does not hold the keep-trigger rule (R M8, K 11)

`apiVoiceBatchStop` stops only `Waiting` rows (VoiceScreen.gs:941) and is not in the file list. After Release 2 the owner and the rollback procedure cannot cancel scheduled retries, which place calls and spend money. `apiVoiceBatches` counts `open` from `Waiting` plus `Calling` (line 960), and the plan does not say how the batch-progress counts for `Scheduled` rows are built. `voiceQueueTrigger_` (line 872) takes only `on`; the keep-trigger condition lives inline in `voiceQueueJob` (lines 966, 994), not in `voiceQueueTrigger_` as the plan says.

### E14. The to-do changes have no home or mechanism (R M9, K 12)

Tasks.gs builds a task id as `voice_` plus `action.key`, so the keys must be `optout` and `noanswer` to match the rules `voice_optout` and `voice_noanswer`; the plan does not say so. `voiceTaskRows_(apps)` reads only `Completed` calls with `Final_Vars_JSON` (line 1144), so an exhausted no-answer card, which has neither, cannot feed the `noanswer` to-do. To-dos are derived by `reconcileTasks_`, so "ingest creates the to-do" (design line 177) conflicts. "`voiceTaskRows_` shows the two new values" (line 157) is a no-op because it shows no status. `voiceDndAdd_(u, numbers, source, note)` needs the full number, but a call row holds only the last four digits, and the plan does not say who `u` is when called from ingest. Line 337 gives rule titles but not the full shape (`due`, `crit`, `missed`, `policy`). `allTasks_` caches on a stamp list that omits `Voice_Calls` and `Voice_Queue` (Tasks.gs:469), so new to-dos can lag up to 10 minutes.

### E15. `voiceStats_` cannot be changed as written (R M10, K 14)

`voiceStats_(calls, from, to, rate, labels)` is pure over a date window. Spent, reserved and ceiling are monthly and need other inputs, and the screenings join needs another. The output field names are undefined, and `App.html` `voiceCommand` consumes them. The existing result key `noAnswer` means "completed with no answers" (VoiceScreen.gs:1028, 1042; App.html:6072), so the new "no answer" bucket needs a different name. Existing E2E V4 (`E2E.gs:657` to `662`, five-argument call) and V6 (`voiceQueuePick_` with the old signature) are not listed for update. "Oldest unprocessed inbox row age and queue depth" (line 342) has no backend producer.

### E16. Ingest error handling, cost reading and the repair lack mechanism (R M11, K 7, K 16)

"After 3 failures it is marked with the error": `Voice_Inbox` has no counter column (line 20) and the plan adds none. Today an error is caught and the row stamped `Processed_At` with "Error: ..." (lines 1231, 1234). Re-running after a partial success would hit "This call already has its result" (line 533) or the repeat-delivery guard (line 1225). `voiceFindCost_` is to accept only keys that "name a cost and carry a currency or unit" and to ignore "credit balance" and "pending charges", but no key list or pattern is given. `voiceStatusRepair_` is "one-time" but `voiceSchema_` runs on nearly every voice function (including `voiceCallsRows_`), so an unguarded repair would scan a transcript-heavy sheet on every call and could recurse. `ensureSchema_` returns early once `SCHEMA_V >= 47`, so it will not run the step either; a property guard and a call site must be named, and the "Compliance.gs: no change" decision depends on the lazy `voiceSchema_` calls. New `Voice_Queue` columns need an extra-column list and an `addColumns_` call, because `VOICE_QUEUE_.cols` is used only when the sheet is created.

### E17. Same-number matching cannot be done from stored data (R M6a, K 9)

Queue rows carry no phone number, and `apiVoiceBatchStart` writes `Candidate_ID: ''` (line 924). `Voice_Calls` holds only `Phone_Last4`. `voiceQueuePick_` is pure, has no phone per row, and its `doneNumbers` argument filters nothing today (the comment at line 832 claims "one per number" but the code does not dedupe). The plan says only "resolved from the candidate record" with no new signature such as a row-to-number map. It does not say how `apiVoiceBatchStart` and `voiceBatchCheck_` do the "refuse a card or number already open" check, or whether a clash refuses the whole batch or skips that card (the preview needs the "already queued" reason, so `voiceBatchCheck_` must change, not only `apiVoiceBatchStart`). The facts (opt-out register, calls, spend) should be read once per batch, not per card, because `voiceBatchCheck_` already runs `voiceStartFor_` as a dry run per card (line 900). How numbers are gathered inside the lock in `voiceQueueJob`, which calls `voiceQueuePick_(rows, 1, [])` (line 973), is not said.

### E18. Settings changes are incomplete (R M12, K 15, Y1)

`voiceCfgOut_` (VoiceScreen.gs:69 to 73) returns an explicit field list, so the new settings will not reach the page unless it changes. `apiVoiceConfigSave` resets `ratePerMin` to 0 when it is omitted (line 121), unlike other fields that default to the previous value, and the budget depends on the rate. Only `VOICE_MAX_CALL_MIN` has a range; the ceilings, the retry plan and `VOICE_OPTOUT_AUTO` have no accepted values or failure messages. The preview text "Not required (switched off)" (line 442) must change with the `VOICE_DND_REQUIRED` label. The before-and-after audit for the new settings (line 405, "a small addition worth making") is neither in nor out of scope: decide, and put it in the `apiVoiceConfigSave` entry or drop it.

### E19. The call card hides the real result behind a newer row (K 13)

`voiceCardSection` (App.html:6193) takes `last = calls[0]`, the newest call of any status. A new `Blocked` or `No answer` row would replace the real result and hide *View result* and *Ask remaining questions* (App.html:6197). Missed readers of `Status` or the result path the plan should list: `apiVoiceFetchResult`, `voiceCallFlags_` (line 1132), `voiceCallOut_` (line 338), App.html `VOICE_STATUS_CLASS_` (6011, only `ok` and `miss`), the `voiceCommand` KPI "Failed, no answer or busy" (6064) and the CSV header (6073 to 6077). `voiceQueueTrailingFails_` (lines 850 to 856) reads `Voice_Queue.Status`, not `Voice_Calls.Status`, so it does not see `No answer` and needs no change for that reason; its risk is gate refusals counted as `Failed` (E4). App.html has no call-log status filter (the Recent calls table at 6039 has none), and statuses show as plain text classes, so the plan's "chips and filters" and a `Styles.html` change may not be needed; the plan should choose the class mapping or say "no change".

### E20. The sharing message cannot be built from the text (R M13, K 18)

Missing: the card link format, the Teams or mailto link format, the subject and the message template; what "confirmed answers", "outcome", "flags" and "counts only" mean in terms of `Screenings` fields and `voiceRowFlags_` and `voiceCallFlags_`; the field shapes of `{text, links, missing}`. The department master is ambiguous: `hodOf_(dept)` in `Pipeline.gs` reads `M_Departments`, while `Org.gs` has a separate `ORG_DEPT_` that also has `HOD_Email`, and `Pipeline.gs` is not in the file list. `panelEmailIndex_` is keyed by `panelKey_(name)` (Tasks.gs:446 to 453), the stored format of `Tech_Panel` is unspecified, and how a multi-valued panel is split is not said. Which screening applies when a card has several calls is not said. There is no field for the MRF raiser in the eight files.

### E21. The test plan has titles, not tests (R M14, K 21, Y)

No inputs, expected results or boundaries are given. Boundaries needed: 09:00 and 19:00 exactly, 18:59, Saturday evening into Sunday, ceiling equality, `Attempts` equal to `Max_Attempts`, `Not_Before` equal to now. The design promises "an e2e case covers each reader", but the list covers `voiceUsedToday_` and the gate only; status display, `voiceTaskRows_`, the batch stop rule and `voiceStats_` are uncovered. No cases are named for `voiceBudgetSweep_`, `voiceStatusRepair_`, the ingest failure counter, settings validation, rate-unset fail-closed, or the fetch path's status. The `'Failed'` code search (line 393) has no check that can be run. Eight names (V7 to V14) are given for more than ten cases. Y: "assumed V7 to V14" adds nothing; fix the names or drop "assumed".

### E22. The file boundary is not exact (R M15, K)

`Styles.html` "as needed, reusing existing chip classes where possible" cannot be enforced as an allowlist (see E19). The `App.html` bullets (lines 339 to 346) are tagged "releases 1 to 4" but not mapped to releases: the `Scheduled` display, the "already queued" reason and the share buttons belong to later releases. The `VoiceScreen.gs` list omits functions the plan itself changes or depends on: `voiceLog_`, `voiceCfgOut_`, `voiceQueueStopReason_`, `apiVoiceBatches`, `apiVoiceBatchStop`, `apiVoiceFetchResult`, `voiceQueueTrigger_` and a status-class map (named in the design as `voiceStatusClass_`, in the code as `VOICE_STATUS_CLASS_` on the page side).

### E23. Style: uncalibrated claims and caveats (Y1 to Y3)

Line 403 ("are the only guard") is an absolute that the plan itself contradicts (step 3, the E2E list). Line 404's rate risk follows no decision (line 310 already says what happens with no rate). Line 405 ends "a small addition worth making", a judgement that leaves scope unsaid. Line 286 says assumed defaults change "in one place, a setting or constant", but the default for `Max_Attempts` and the plan text sit inline at line 320 and are not named as settings. Lines 354 and 362 ("Listed so a reviewer sees it was considered", "Listed to record the decision") describe why a line exists, not behaviour; the three "no change" entries (lines 360 to 362, 377 to 379, 381 to 383) can be one line each. Line 350 states a dark and light theme requirement that step 8 (line 398) does not check.

## Nits

- **Line 302:** "never allow" repeats "returns blocked". **Line 286:** "There is no code here." is filler, and "the single list of everything that changes" is an unprovable absolute (the provider workspace, line 385, and the secret rotation, line 383, sit outside it); say "the list of repository changes". **Line 290:** "Each can be stopped after." is vague. **Line 292:** "the owner reads the results" is a noun phrase mixed with a clause, and "the owner" differs from "MRF owner" (line 333). **Line 312:** "no longer at the top of the run only" is a double negative; say it is checked at each placement as well as at the start. **Line 317:** "real" appears twice; say "until a captured provider payload contains a cost field". **Lines 342 and 343:** long semicolon-chained bullets would read better as sub-bullets. **Line 344:** "clear refusals" is subjective. **Line 322:** "cannot" is absolute, and line 323 uses a second mechanism; say which enforces which case. **Line 331:** "Allowed only to a person who may review the card" is awkward. **Line 358:** write "SSOT section 12.5" in full, as line 375 does. **Line 387:** the Admin's real test call has no release or step attached; add it to the step list. (Y4 to Y17)
- **Line 358:** `BUILD_ID` is the string `'159'`; give the four target values (for example 160 to 163). (R)
- **Line 392:** Release 1 adds retry and opt-out settings and the `Scheduled` schema before any release uses them; harmless, but say so. (R)
- **Line 398:** "preview at phone width" has no pass criterion. (R)
- **The no-change entries** for `Dashboard.gs` and `Compliance.gs` are good practice, but the `Dashboard.gs` entry should be revisited under E9 and E10. (R, K)

## What checked out (current-state claims that are true)

Every named current function exists as stated: `voiceStartFor_` (VoiceScreen.gs:408), `voiceOutcome_` (1189), `voiceUsedToday_` (612), `voiceStats_` (1009), `voiceQueuePick_` (833), `voiceQueueTrailingFails_` (850), `voiceTaskRows_` (1140), `voiceDispositionAction_` (1163), `voiceFindCost_` (1102), `voiceIngest_` and `voiceIngestRun_` (1200, 1203), `voiceApplyResult_` (529), `voiceCfg_` (55), `apiVoiceConfigSave` (91), `voiceBatchCheck_` and `apiVoiceBatchPreview` (885, 880), `apiVoiceBatchStart` (912), `voiceQueueJob` (963), `voiceQueueTrigger_` (872), `voiceSchema_` (43), `voiceDndAdd_` (642). Also true: `VOICE_STATUSES_` (30), the settings `VOICE_RATE_PER_MIN`, `VOICE_CALL_HOURS` and `VOICE_DND_REQUIRED` (60), the 8-minute `VOICE_WARN_MIN_` (269), the `App.html` functions named, `TASK_RULES_DEFAULT_` with existing `voice_*` rules (Tasks.gs:21, 49 to 53), `panelEmailIndex_` (447), `HOD_Email` on `M_Departments` (80), `Tech_Panel` on the MRF line, `SCHEMA_VERSION` '47' and `BUILD_ID` '159', and `refreshDashboardJob` calling `voiceIngest_` (Dashboard.gs:85). Behaviour claims that hold: `voiceOutcome_` maps everything not answered to `Failed`; `voiceUsedToday_` excludes `Failed` and `Blocked`; the opt-out check sits inside `cfg.dndRequired` (line 447); hours are checked only in the batch paths (967); `apiVoiceBatchStart` counts only `Waiting` and `Calling` (921); the Admin has no daily limit (592); the settings audit logs names only (136). Style kept: the lost-webhook rationale (line 314), the fail-closed statement (line 367) and the first half of line 405's audit wording.

## Traceability

| Consolidated | Raw findings |
|---|---|
| E1 | R B1, K 2 |
| E2 | R B2, K 1 |
| E3 | R B3, K 10 |
| E4 | R B4, K 4, K 5 |
| E5 | K 3 |
| E6 | R M6, K 4 |
| E7 | R M1, K 8 |
| E8 | R M2 |
| E9 | R M3 |
| E10 | R M4, K 6 |
| E11 | R M5, K 17 |
| E12 | R M7, K 11 |
| E13 | R M8, K 11 |
| E14 | R M9, K 12 |
| E15 | R M10, K 14 |
| E16 | R M11, K 7, K 16 |
| E17 | R M6a, K 9, K 22, K 23 |
| E18 | R M12, K 15, K 20, Y1 |
| E19 | K 13, K 19 |
| E20 | R M13, K 18 |
| E21 | R M14, K 21 |
| E22 | R M15 |
| E23 | Y1 to Y3 |
| Nits | R nits, Y4 to Y17 |
