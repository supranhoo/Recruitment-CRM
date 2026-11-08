# Goldfish Annotated Review Report

**Status:** open (awaiting your decision)

**Target:** `docs/designs/voice-screening-gate-retry-sharing.md` (`full file`, 406 lines)

**Findings source:** the five review reports in this folder, merged: `zoom_out_report.md` (Stage 5), `comprehension_report.md` (Stage 6), `critic_report.md` (Stage 7), `intermediate_zoom_out_report.md` (Stage 8), `implementation_readiness_report.md` (Stage 9). Overlapping findings are merged into one issue, with the source ids kept so each can be traced. Source ids: `Z` Stage 5 zoom-out (`B1`, `B2`, `M1` to `M13`), `P` Stage 6 comprehension (numbered 1 to 16), `C` Stage 7 critic (`C1` to `C17`, `Y12`), `I` Stage 8 intermediate zoom-out (`NB1`, `NM1` to `NM3`), `E` Stage 9 (`E1` to `E23`).

**Rules applied.** I wrote the design, so a wish to contest is not evidence. Only two findings are contested or escalated, and each has a checkable reason. Severities are not changed. A fix is proposed only where the critique holds. Most reviewers read only the document; where a finding's counter-evidence is in the source code, which the reviewer could not read, the category is ESCALATE, not CONTEST.

**Summary:** 33 items (issues 1 to 32, with issue 4 split into 4a and 4b). 29 PROPOSE FIX, 2 ESCALATE (4b and 10), 1 CONTEST (32), 1 DECLINE (31, the nits as a group).

## Escalated findings (need your knowledge, not only approval)

*   **Issue 10** (no global kill switch): the reviewer could read only the document and says no single setting blocks all calls. The code has one: `VOICE_ENABLED`. `voiceMissing_` (`VoiceScreen.gs:64` to `67`) adds "Switch on ..." when it is off, and `voiceStartFor_` treats any entry in that list as a problem that stops a real call (line 433). The design document never mentions it, so the reviewer's reading was fair. I have not changed the document. Please confirm whether it should say so (a one-line statement that `VOICE_ENABLED` is the kill switch and that the gate must keep honouring it).
*   **Issue 4b** (ingest can double-process an inbox row): the reviewer could read only the document. In the code, `voiceIngest_` wraps `voiceIngestRun_` in `withLock_` (`VoiceScreen.gs:1200` to `1202`), so two runs cannot overlap, and a repeat delivery is skipped by `Interaction_ID` or a completed-with-transcript check (line 1225). This part of the finding is inaccurate for the code as it is today. The gate race in issue 4a is real and is a separate issue.

## Prioritized Findings & AI Suggestions

### [Issue 1] [`egm-design`, `egm-structural`, `egm-zoom-out`, `egm-comprehension`, `egm-inventive-catalyst`] - Severity: Blocker
*   **Affected Scope:** [Lines 41, 96, 191, 224, 292-295](docs/designs/voice-screening-gate-retry-sharing.md#L41-L295) (Goals, CUJ 4, Technical Plan 5, Rollout, Delivery order)
*   **Discrepancy Description:** The first real batch goes out with the opt-out hole open. A spoken "do not call me again" is filed as `not_interested` until Release 3, and `VOICE_OPTOUT_AUTO` starts off, so nothing is written to the register and another card or batch can still call the number. The Goal and CUJ 4 say the number is added and no later call reaches it. (Source: Z B1, C C3, P 2, I B1/NB1, E5.)
*   **Rationale:** Opt-out is the first hard limit the design names. Fixed text contradicts its own Goal.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The critique is valid and four reviewers raised it independently. The safer failure is wrongly suppressing a number that a person can undo, not calling someone who asked not to be called. The false either/or (automatic write versus person confirms) is resolved by writing a provisional entry the gate treats as an opt-out.
*   ***Proposed Edit:***
    *   Location: Goals, CUJ 4, Technical Plan 5, Detailed Implementation (Release 3 items), Delivery order, Rollout (section 9).
    *   Change: Move spoken opt-out into Release 1. On a `do_not_call` disposition, the ingest writes a `Voice_DND` row at once with state "Pending confirmation"; the gate treats pending and confirmed rows alike; a person confirms or undoes it with a reason; matching is on the normalised number, not the card. Delete the `VOICE_OPTOUT_AUTO` setting. List the provider-prompt change (adding `do_not_call`) as a rollout precondition with the Admin as owner. Until the agent has the disposition, add a deterministic phrase scan of the transcript as a second signal that raises the same provisional entry and to-do (phrase list to cover the languages in use; language switching stays parked). Section 9 order: gate and statuses, opt-out, first batch, retry, sharing.

### [Issue 2] [`egm-zoom-out`] - Severity: Blocker
*   **Affected Scope:** [Lines 104-234](docs/designs/voice-screening-gate-retry-sharing.md#L104-L234) (Technical Plan 1, 4, 5)
*   **Discrepancy Description:** No single owner of "this number must not be called". The register, the card-level retry stop, the one-open-call check, the daily limit and the queue duplicate check differ in key (number versus card) and scope (card, caller, batch). The gate looks central but its inputs are not. (Source: I NB1; related E E17, Z M3, M4, C C8.)
*   **Rationale:** Fixes B1, M3 and part of M4 at once.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The critique is valid. A per-number record is the smallest structure that gives the gate one input. It also answers the "large sheet read on every call" objection (issue 13). Trade-off to weigh in the breakdown: it adds a sheet that can drift from the call log and needs a periodic rebuild. The Stage 5 reviewer would rather add nothing before the first batch; this issue and issue 20 pull in opposite directions, and you decide.
*   ***Proposed Edit:***
    *   Location: Technical Plan, new subsection "Per-number contact record"; Detailed Implementation `voiceSchema_` and `voiceMayCall_` entries.
    *   Change: Add a sheet `Voice_Contacts` keyed on the normalised 10-digit number: `Number_Key`, `Optout_State` (blank, Pending confirmation, Confirmed), `Last_Attempt_At`, `Attempts_Recent`, `Last_Outcome`, `Updated_At`. The gate, ingest and retry read and write only this record for opt-out and attempt counts. A rebuild function recomputes it from `Voice_Calls` and `Voice_DND` and runs from the Admin screen.

### [Issue 3] [`egm-inventive-catalyst`, `egm-design`, `egm-structural`, `egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 39, 110-120, 173-186, 215, 302-313, 366](docs/designs/voice-screening-gate-retry-sharing.md#L39-L366) (Technical Plan 1, 4; data model; `voiceQueueJob`)
*   **Discrepancy Description:** The design does not say what a queue row becomes when the gate refuses it, or how a refusal is reported. Today any thrown error marks the row `Failed` and feeds the "three in a row" stop (`VoiceScreen.gs:966` to `995`), so a run crossing 19:00 would drain every waiting row, three budget refusals would stop the batch with a misleading "check the key" message, and a transient read error would end a candidate's retries for good. Only two `Blocked (...)` statuses exist, and stats promise "blocked by reason". (Source: Z B2, C C4, E E4, E6, P 3, Stage 7 D6/S7.)
*   **Rationale:** Without a defined outcome the E2E case "a run that crosses 19:00" has no expected result.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The critique is valid. Fail-closed and "never retry after a block" are both stated as absolutes, and a temporary condition and a policy refusal must not share an outcome.
*   ***Proposed Edit:***
    *   Location: Technical Plan 1 and 4; data model table; Detailed Implementation `voiceStartFor_`, `voiceQueueJob`, `voiceStats_`.
    *   Change: Refusals are returned (not thrown) as `{ok:false, reason, kind}` where `kind` is `defer` (hours, budget window, could not check, open call) or `terminal` (opt-out, hard stop). A deferred queue row becomes `Scheduled` with `Not_Before` set to the next calling window or a short backoff; a terminal row becomes `Stopped` with `Stop_Reason`. Neither counts toward "three failed in a row", which counts only provider or placement failures. One `Blocked` status with the reason in a new `Block_Reason` column replaces the per-reason statuses; one block row is logged per row per change of reason, not per poll; preview never writes a block row. The top-of-run hours check stays as an early exit; each placement is also checked. Deferred rows expire after 48 hours as `Stopped`.

### [Issue 4a] [`egm-design`, `egm-inventive-catalyst`, `egm-implementation-readiness`] - Severity: Blocker
*   **Affected Scope:** [Lines 108-120, 161-171, 184-185, 302-304](docs/designs/voice-screening-gate-retry-sharing.md#L108-L304) (Technical Plan 1, 3)
*   **Discrepancy Description:** The gate reads facts and later writes the `Starting` row and `Reserved_Min`, with no lock around the pair. A recruiter's click and the one-minute job can both pass "one open call" and the budget check. (Source: C C2, Z M1, E E8.)
*   **Rationale:** The reserve exists to prevent exactly this overshoot.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The critique is valid: `voiceLog_` takes the lock only for its own write.
*   ***Proposed Edit:***
    *   Location: Technical Plan 1; Detailed Implementation `voiceStartFor_`, `voiceLog_`.
    *   Change: State that the gate, the reserve write and the `Starting` log run inside one `withLock_`; the provider call happens after, outside the lock. Add E2E cases for two simultaneous attempts on one card and on the last unit of budget.

### [Issue 4b] [`egm-design`] - Severity: Blocker
*   **Affected Scope:** [Lines 184, 316](docs/designs/voice-screening-gate-retry-sharing.md#L184-L316) (ingest idempotency, part of C C2)
*   **Discrepancy Description:** "Ingest is not stated to be idempotent: overlapping runs could double-process one `Voice_Inbox` row."
*   **Rationale:** Duplicate to-dos, double-counted attempts, duplicate register rows.
*   ***AI Suggestion:*** ESCALATE
*   ***Justification:*** The evidence is in `VoiceScreen.gs:1200` to `1202` (`voiceIngest_` runs `voiceIngestRun_` inside `withLock_`) and line 1225 (the repeat-delivery guard), which the reviewer could not read. It is outside every file the reviewer saw. The code already serialises ingest. What remains true is that the design should say the new retry bookkeeping inside ingest stays under that lock (it does, by construction).
*   ***Proposed Edit:***
    *   Location: none proposed.
    *   Change: none unless you want one sentence added saying new work inside ingest stays under the existing lock.

### [Issue 5] [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 149-150, 306, 316](docs/designs/voice-screening-gate-retry-sharing.md#L149-L316) (Technical Plan 2; `voiceOutcome_`, `voiceApplyResult_`, `apiVoiceFetchResult`)
*   **Discrepancy Description:** The new `No answer` and `Busy` statuses never reach the call row. `voiceApplyResult_` (`VoiceScreen.gs:534`) stores any status that is not `Failed` as `Completed`; the plan lists it only for `Payload_Keys` and `Reserved_Min`. The manual fetch path sets its own outcome and passes only `Failed` or `Completed`. (Source: E E1.)
*   **Rationale:** Unanswered calls would count as answered and retry would never fire, with no error.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid, and I confirmed the coercion at `VoiceScreen.gs:534`.
*   ***Proposed Edit:***
    *   Location: Detailed Implementation `voiceApplyResult_` and `apiVoiceFetchResult`; Technical Plan 2.
    *   Change: `voiceApplyResult_` accepts `Completed`, `No answer`, `Busy` and `Failed` and stores the status it is given; the "already has its result" check applies only to `Completed`; the answers-draft branch runs only for `Completed`. `apiVoiceFetchResult` maps the provider status through `voiceOutcome_`, stores the result status, and calls the same retry decision as ingest.

### [Issue 6] [`egm-implementation-readiness`, `egm-codebase-details`, `egm-comprehension`] - Severity: Blocker
*   **Affected Scope:** [Lines 84, 196-198, 308, 316](docs/designs/voice-screening-gate-retry-sharing.md#L84-L316) (CUJ 2, Technical Plan 6)
*   **Discrepancy Description:** The design says the raw provider payload is kept on every call in `Final_Vars_JSON`. The code keeps only non-empty scalar variables (`voiceVars_`, `VoiceScreen.gs:1183` to `1187`, drops objects, capped at 4,000 characters). The raw payload exists only in `Voice_Inbox.Payload`, with no call link. "Ratings arrived" cannot be derived from top-level `Payload_Keys`, because `screening_ratings` is nested. (Source: E E2, P 11.)
*   **Rationale:** The first batch's main learning goal cannot be met as written.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid; checked against `voiceVars_`.
*   ***Proposed Edit:***
    *   Location: CUJ 2; Technical Plan 6; Detailed Implementation `voiceIngestRun_`, `voiceSchema_`, `voiceStats_`.
    *   Change: Correct "the raw payload is kept" to "the provider payload stays in `Voice_Inbox.Payload`, linked to the call by a new `Voice_Calls.Inbox_Key`". Add `Voice_Calls.Ratings_State` (`present`, `empty`, `absent`) and `Payload_Keys` listing nested key paths of the variables, both written by ingest; `voiceStats_` reads `Ratings_State`. If a real payload shows ratings as an object, extend `voiceVars_` (conditional, stated as such).

### [Issue 7] [`egm-implementation-readiness`, `egm-comprehension`, `egm-inventive-catalyst`, `egm-design`] - Severity: Blocker
*   **Affected Scope:** [Lines 161-171, 163, 302-303, 308-311](docs/designs/voice-screening-gate-retry-sharing.md#L161-L311) (Technical Plan 3, `voiceBudgetCheck_`)
*   **Discrepancy Description:** The spend ceiling cannot be coded without design choices: the unit and the fallback contradict each other (line 163 versus 310); a blank or zero ceiling is undefined; "this month" has no boundary, time zone or date field; the gate has no batch id or planned seconds, and there is no data path for a batch's spend; the per-batch ceiling's treatment of retries is unstated. (Source: E E3, P 7, 8, C C9.)
*   **Rationale:** The gate is meant to fail closed, so each undefined case matters.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. These are decisions the document must make, and the author can make defensible ones.
*   ***Proposed Edit:***
    *   Location: Technical Plan 3; Detailed Implementation `voiceCfg_`, `voiceBudgetCheck_`, `voiceMayCall_` signature, `voiceSchema_`.
    *   Change: Unit is rupees only; no minutes fallback. A blank ceiling means "no ceiling for that period", shown on the page as "no limit"; a rupee ceiling with no rate blocks every call with "Set the cost per minute". "This month" is the calendar month in India time, counted from `Started_At`. Add `Voice_Calls.Batch_ID`, and add `opts.batchId` and the planned minutes to the gate's inputs; a batch's spend is its calls' minutes times the rate, and retries count against the batch they came from. Single calls skip the batch ceiling.

### [Issue 8] [`egm-codebase-details`] - Severity: Blocker
*   **Affected Scope:** [Lines 313, 325, 328, 330-333](docs/designs/voice-screening-gate-retry-sharing.md#L313-L333) (Release 3, `voiceDispositionAction_`)
*   **Discrepancy Description:** `voiceDispositionAction_` is a pure string-to-label mapper (`VoiceScreen.gs:1163` to `1173`), called at read time from `voiceTaskRows_` and `apiVoiceCallDetail`. The plan has it stop retries and write `Voice_DND`, which would write on every task refresh and detail open, and it has no call, card, phone or user. Undo is Admin-only today. (Source: E E5, E14.)
*   **Rationale:** The plan assigns work to a function that cannot do it.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid; checked against the source.
*   ***Proposed Edit:***
    *   Location: Detailed Implementation Release 3 (now merged into Release 1 by issue 1); Tasks.gs entry.
    *   Change: The register write and the retry stop move into `voiceIngestRun_`, run as a named system user. `voiceDispositionAction_` stays a label map and gains `do_not_call` with key `optout` (the task id becomes `voice_optout`) and key `noanswer` for `voice_noanswer`. State that undo is Admin-only until the owner decides whether leads may undo. The full number comes from the card's candidate record at ingest time, because the call row keeps only four digits.

### [Issue 9] [`egm-design`, `egm-structural`] - Severity: Blocker
*   **Affected Scope:** [Whole document](docs/designs/voice-screening-gate-retry-sharing.md#L1-L406) (no section)
*   **Discrepancy Description:** No Risks & Mitigations section, which the feature-spec standard requires. Risk content is scattered; security and privacy, scalability limits, quota, cell and sheet size, webhook authenticity and a gate that fails closed are not assessed together. (Source: C C1.)
*   **Rationale:** A fresh reader cannot confirm the design has named its own constraints.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** I confirmed the standard names "Risks & Mitigations" as required.
*   ***Proposed Edit:***
    *   Location: new H2 "Risks & Mitigations" after Alternatives Considered.
    *   Change: A table of risk, effect, mitigation and owner covering: gate race (lock, issue 4a); refused rows (issue 3); lost webhook and held reserves (issue 14); provider-side retry or hours (issue 11); Apps Script execution and trigger quotas (issue 13); cell and sheet size (payload truncation); candidate PII in sheets and who can read it; webhook secret, forgery and replay; consent and recording disclosure (issue 25); mail quota; unaudited setting changes (issue 19); the gate failing closed and blocking every call; a missed reader of `Status`.

### [Issue 10] [`egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 224-227](docs/designs/voice-screening-gate-retry-sharing.md#L224-L227) (Technical Plan 9)
*   **Discrepancy Description:** No global kill switch; rollback stops only batches, so single calls continue. (Source: C C7.)
*   **Rationale:** A live pilot on real candidates needs one switch that blocks all calls.
*   ***AI Suggestion:*** ESCALATE
*   ***Justification:*** The setting exists (see "Escalated findings" above). The reviewer saw only the document and could not know. I did not change anything. If you agree the document should say it, the edit is one sentence in Technical Plan 1 and section 9.
*   ***Proposed Edit:***
    *   Location: Technical Plan 1 (gate) and section 9 (rollback).
    *   Change: "`VOICE_ENABLED` is the existing kill switch: with it off, every real call is refused (`voiceMissing_`). The gate keeps honouring it, and rollback step 1 is to set it to No."

### [Issue 11] [`egm-design`, `egm-structural`, `egm-comprehension`] - Severity: Major
*   **Affected Scope:** [Lines 13-18, 35, 224, 288-295](docs/designs/voice-screening-gate-retry-sharing.md#L13-L295) (Overview, The Problem, section 9, Delivery order)
*   **Discrepancy Description:** The stages differ across the Overview (four), The Problem (three, with "a controlled outbox", the option the design rejects), section 9 and the Detailed Implementation (four releases; spoken opt-out missing from section 9; the spend ceiling in Release 1, not with retry). "Each stage is safe to stop after" cannot be verified and conflicts with rollback leaving rows to review. (Source: C C5, P 1, E.)
*   **Rationale:** A reader cannot tell what ships when.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. Combined with issues 1 and 20 the release list changes anyway.
*   ***Proposed Edit:***
    *   Location: Overview, The Problem (solution paragraph), section 9, Delivery order.
    *   Change: One numbered release list used in all four places (after issues 1 and 20: Release 1a gate, statuses, hours, opt-out, payload capture, count caps; Release 1b reserve and ceilings; Release 2 retry; Release 3 result message). Delete "controlled outbox". Replace "each stage is safe to stop after" with the actual condition: stopping after a release is safe because each release leaves the previous release's limits in force and no earlier limit depends on a later one; list the exceptions.

### [Issue 12] [`egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 110, 70, 227](docs/designs/voice-screening-gate-retry-sharing.md#L70-L227) (Technical Plan 1, Open Questions, rollout)
*   **Discrepancy Description:** "Every call goes through `voiceStartFor_`" is asserted, not shown. If the provider retries on its own, or the provider workspace can place or schedule calls, the hard limits are not hard. (Source: C C6.)
*   **Rationale:** The gate cannot protect against calls it never sees.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. Confirmation with team-owned numbers is cheap.
*   ***Proposed Edit:***
    *   Location: Technical Plan 9 (rollout); Detailed Implementation steps.
    *   Change: Add two preconditions for any real batch, owner Admin: (a) a call-site audit listing every place that calls the provider API (done by a code search before Release 1a merges, results recorded in the release notes); (b) a test call to a team-owned number that confirms whether the provider retries on its own and whether it honours our hours.

### [Issue 13] [`egm-design`, `egm-inventive-catalyst`] - Severity: Major
*   **Affected Scope:** [Lines 163-171, 182, 196, 270](docs/designs/voice-screening-gate-retry-sharing.md#L163-L270) (Technical Plan 3, 4, 6; Alternatives)
*   **Discrepancy Description:** The design rejects "derive retry state from `Voice_Calls`" because reads of it are large, yet the gate reads that sheet on every call. A one-minute trigger stays alive up to 48 hours (about 1,440 runs a day) against Apps Script daily trigger-runtime quotas. Payloads in a cell risk the 50,000-character limit with no stated behaviour. (Source: C C8, Z M4.)
*   **Rationale:** The design contradicts its own reasoning on sheet size.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. The per-number record in issue 2 removes most of the reads. Spent and reserved minutes still need a source, so a small monthly counter row is added.
*   ***Proposed Edit:***
    *   Location: Technical Plan 3 and 4; Risks & Mitigations (issue 9).
    *   Change: The gate reads `Voice_Contacts` (opt-out, attempts) and one `Voice_Budget` row per month (spent and reserved minutes, updated by the gate and ingest, rebuilt from `Voice_Calls` by an Admin button). The trigger runs every minute only while `Waiting` or `Calling` rows exist; while only `Scheduled` rows remain, a one-shot trigger is armed for the earliest `Not_Before`. State pilot volumes (up to 30 calls a batch, about 20 a day per person) and that payloads over 45,000 characters lose trailing transcript entries (the receiver already does this).

### [Issue 14] [`egm-design`, `egm-inventive-catalyst`, `egm-implementation-readiness`, `egm-codebase-details`] - Severity: Major
*   **Affected Scope:** [Lines 161-171, 313-314](docs/designs/voice-screening-gate-retry-sharing.md#L161-L314) (Technical Plan 3; `voiceBudgetSweep_`, `voiceQueueReap_`)
*   **Discrepancy Description:** The reserve is not a true bound: `VOICE_MAX_CALL_MIN` defaults to the existing 8-minute warning, which is not a cap. The sweep clears a lost reservation silently, which fails open. A failed placement never releases its reserve. Billing rounding and billed rings are outside the estimate. The sweep and reaper live in a job that returns early and removes its trigger when no batch is open. The reaper counts a blocked or failed call row as "placed". (Source: C C9, Z M2, E E7, E9, E11.)
*   **Rationale:** The ceiling can be exceeded silently and a lost webhook can hold budget.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. Some of these are cheap to fix in the text.
*   ***Proposed Edit:***
    *   Location: Technical Plan 3; Detailed Implementation `voiceStartFor_`, `voiceLog_`, `voiceBudgetSweep_`, `voiceQueueReap_`.
    *   Change: Ask the Admin to set a maximum call duration in the provider agent (rollout precondition), so the reserve is a true bound; keep `VOICE_MAX_CALL_MIN` equal to it. A failed placement clears its reserve at once. The sweep turns an unresolved reserve into "presumed spent" until a person closes the call (add a Close action that sets `Cancelled`), so it never loosens the ceiling. Price at the higher of the configured and the invoice-derived rate. The sweep also runs from `refreshDashboardJob`, so it runs with no open batch. The reaper counts only `Starting`, `Started` and `Completed` rows as placed, with the claim time taken from the queue row's `Updated_At`. Keep a provider-side prepaid limit as a backstop if the provider offers one (an Admin step, listed in the risks).

### [Issue 15] [`egm-design`, `egm-inventive-catalyst`] - Severity: Major
*   **Affected Scope:** [Lines 179-183, 266, 322-323](docs/designs/voice-screening-gate-retry-sharing.md#L179-L323) (Technical Plan 4; Alternatives `Voice_Attempts`)
*   **Discrepancy Description:** A `Scheduled` row does not count as an open batch, so another batch can queue the same number with `Attempts` reset. The Alternatives claim the cross-batch cap is "covered" only while a row is open. The daily limit counts per caller, so there is no per-candidate or per-number cap across cards, positions or recruiters. System retries consume the recruiter's limit. (Source: C C10, Z M3.)
*   **Rationale:** With retries, a contact cap that holds on every path is needed.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid; the per-number record (issue 2) gives it a home.
*   ***Proposed Edit:***
    *   Location: Technical Plan 1 (gate check list), 4; Alternatives (`Voice_Attempts` entry).
    *   Change: Add a gate check "attempts to this number in the last 7 days is below 3" (assumed limits, from `Voice_Contacts`), independent of queue rows and applying to single calls. System retries are placed by a named `system` principal and do not use the recruiter's daily limit. A `Scheduled` row counts as open for duplicate checks (same card or number), and does not count as an open batch for the "one open batch per person" rule; state both. Amend the Alternatives entry to say the cap holds through the per-number check, not through open rows.

### [Issue 16] [`egm-zoom-out`, `egm-implementation-readiness`, `egm-comprehension`] - Severity: Major
*   **Affected Scope:** [Lines 173-186, 320-325](docs/designs/voice-screening-gate-retry-sharing.md#L173-L325) (Technical Plan 4; Release 2)
*   **Discrepancy Description:** Retry is specified in full before the first batch shows it is needed: four queue columns, `Scheduled`, a 48-hour window, trigger rules, time-of-day rotation, and a free-text retry plan with no grammar, no source for `Max_Attempts`, no statement of when `Attempts` is incremented, no meaning for attempt 3 and later, an unresolved "next day 11:00" outside the window or on a Sunday, `Stop_Reason` versus `Reason`, `apiVoiceBatchStop` leaving `Scheduled` rows live, and single calls getting no retry although the Goals say retry applies. The "Call again" to-do option is missing from Alternatives. (Source: Z M5, E E12, E13, P 10.)
*   **Rationale:** An engineer would have to invent the rules; the free-text plan is configurability nobody has asked for.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. The author's choice (retry state on `Voice_Queue` columns) is kept; the surrounding mechanism is simplified and completed.
*   ***Proposed Edit:***
    *   Location: Technical Plan 4; Release 2 items; Alternatives; Goals.
    *   Change: Replace `VOICE_RETRY_PLAN` with constants (3 attempts in total including the first; busy retries after 30 minutes, no answer after 4 hours, then the next calling window at 11:00 or the next window start if 11:00 is outside it; Sundays excluded). `Attempts` increments when a call is placed. `Max_Attempts` is the constant and is not stored per row. `Stop_Reason` is the one reason field and replaces `Reason` for stops. `apiVoiceBatchStop` also stops `Scheduled` rows. State plainly that single calls from a card are not retried; they get the same "did not answer" to-do. Change the Goal to "a candidate in a batch who did not answer is retried". Add "Call again to-do on a failed call, with a button on the card" to Alternatives with the reason automatic retry was chosen (the author wants unattended batches).

### [Issue 17] [`egm-design`, `egm-zoom-out`, `egm-inventive-catalyst`, `egm-comprehension`, `egm-implementation-readiness`] - Severity: Major
*   **Affected Scope:** [Lines 47, 98-102, 203-209, 250, 276-278, 331-333](docs/designs/voice-screening-gate-retry-sharing.md#L47-L333) (Goals, CUJ 5, Technical Plan 7, Alternatives, Release 4)
*   **Discrepancy Description:** Result sharing contradicts itself and cannot meet its goal. CUJ 5 and section 7 disagree on the MRF owner's content. The MRF owner is not a data field, so the department head is used. The goal says recipients "learn" a result is ready, but the CRM sends nothing and cannot know. For recipients with no login the answers are pasted in full, the harm used to reject e-mailed transcripts. Names are matched fuzzily. Missing: link formats, subject, template, field meanings, the shape of `{text, links, missing}`, which department master (`hodOf_` reads `M_Departments`; `Org.gs` has a separate `ORG_DEPT_`), how a multi-valued `Tech_Panel` is split, which screening applies when a card has several calls. (Source: Z M6, C C11, E E20, P 14.)
*   **Rationale:** Not buildable from the text, and internally inconsistent.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. The author's choice (a prepared message the recruiter sends) is kept.
*   ***Proposed Edit:***
    *   Location: Goals; CUJ 5; Technical Plan 7; Alternatives (outbox entry); Release 4.
    *   Change: Goal becomes "prepares a message for the recruiter to send". CUJ 5 and section 7 use one content table: interviewer gets candidate, position, card link, outcome, the answers the recruiter confirmed, and flags (the flag labels `voiceRowFlags_` and `voiceCallFlags_` produce); MRF owner gets outcome, number of questions answered and not answered. State as a deliberate trade-off that for a recipient with no login the confirmed answers travel in the message text and that this differs from the rejected transcript option only in sensitivity, and that the audit row says "prepared", not "sent". Show the recruiter every resolved address before sending, and say a name matched by approximate spelling is shown as such. Name the master: `M_Departments.HOD_Email` through `hodOf_`. Add a `Raised_By` option to the Open Questions (owner decides; until then the department head, labelled). Split `Tech_Panel` on commas and semicolons and look each name up with `panelKey_`. The latest completed screening of the card is used. Define `{text, links, missing}` as: `text` the message body, `links` an object of Teams and e-mail links, `missing` a list of names with no address.

### [Issue 18] [`egm-zoom-out`, `egm-comprehension`, `egm-structural`, `egm-style`] - Severity: Major
*   **Affected Scope:** [Lines 44-46, 68, 154, 199, 308](docs/designs/voice-screening-gate-retry-sharing.md#L44-L308) (Goals, Open Questions, Technical Plan 2, 6)
*   **Discrepancy Description:** The success rate has two definitions (Goal: completed screenings over placed calls; Technical Plan 2: calls with answers over calls placed, with the Goal's figure as a "second figure"). No metric has a target or go/no-go criterion. "Minutes saved per hire" cannot be measured from about 10 candidates; the recruiter-minutes baseline and the invoice step appear in the plan but not in Detailed Implementation. Counting per placed call makes each retry lower the rate. (Source: Z M7, C C12, P 4, 5.)
*   **Rationale:** One name must mean one thing, and each measure needs a home.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid.
*   ***Proposed Edit:***
    *   Location: Goals; Technical Plan 2 and 6; Detailed Implementation; Open Questions.
    *   Change: Two named measures: **answer rate** (calls with answers over calls placed, per call) and **completion rate** (candidates whose voice draft a recruiter completed over candidates reached, per candidate). Pilot measure: "recruiter minutes per completed screening", replacing "minutes saved per hire" for the pilot; "per hire" is reported only after enough hires exist. The baseline is a manual list the Admin enters in a new Admin section ("Screening time baseline", fields: date, recruiter, minutes), and the invoice reconciliation is a manual two-field entry on the same page; both appear in the file list. Thresholds for moving from the first batch to Release 2 are an Open Question with an assumed default (answer rate above 30 percent and no hard-limit breach).

### [Issue 19] [`egm-inventive-catalyst`, `egm-codebase-details`, `egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 145, 309, 405](docs/designs/voice-screening-gate-retry-sharing.md#L145-L405) (Technical Plan 1; settings; Risks)
*   **Discrepancy Description:** The hard limits are editable settings: the hours window and the ceilings can be changed, so "no override" is only as strong as the setting. The audit stores names, not values, and the before-and-after fix is left as "worth making" and is not in any file list. `voiceCfgOut_` is not listed, so the new settings will not reach the page. `apiVoiceConfigSave` resets the rate to 0 when it is omitted. Only `VOICE_MAX_CALL_MIN` has a validation range; the preview text for `VOICE_DND_REQUIRED` must also change. (Source: C C5, E E18.)
*   **Rationale:** A wrong value silently changes a limit.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid.
*   ***Proposed Edit:***
    *   Location: Technical Plan 1; Detailed Implementation `voiceCfg_`, `voiceCfgOut_`, `apiVoiceConfigSave`; Risks.
    *   Change: Compile in an outer bound (hours between 08:00 and 21:00; ceiling at most 10,000,000 rupees; `VOICE_MAX_CALL_MIN` at most 30); the setting can only narrow within it. Store before and after values for the new settings in the audit row. Add `voiceCfgOut_` to the change list. Use the "default to previous value" pattern for the rate and every new setting. Give each new setting a range and a failure message in the list. Remove `VOICE_DND_REQUIRED` from the page and from the real-call path; preview shows the register result always.

### [Issue 20] [`egm-zoom-out`, `egm-structural`] - Severity: Major
*   **Affected Scope:** [Lines 288-325](docs/designs/voice-screening-gate-retry-sharing.md#L288-L325) (Delivery order; Release 1)
*   **Discrepancy Description:** The first batch is meant to learn four facts (answer rate, real minutes, ratings shape, billing basis), but Release 1 builds the reserve, sweep, per-batch ceiling, seven settings and a command-center rework, which depend on facts the batch will show. The spend ceiling arrives before the rate is known. (Source: I NM2, Z M2, C C9.)
*   **Rationale:** Simplest design that meets the first goal.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid as timing, with a cost: you chose the reserve mechanism, and this proposal keeps it, but ships it after the first batch. It also changes CUJ 2, which assumed ceilings are set before the batch. A fixed call-count cap per batch and per month bounds spend for the first batch. If you prefer the reserve first, decline this item.
*   ***Proposed Edit:***
    *   Location: Delivery order; Release 1; CUJ 2; Technical Plan 3.
    *   Change: Split Release 1 into 1a (hours, opt-out including the provisional hold, statuses, payload capture, a call-count cap per batch and per month, the lock) and 1b (reserve and ceilings in rupees, sweep, per-batch ceiling), shipped after the first batch. CUJ 2 uses the count caps. The first batch runs after 1a.

### [Issue 21] [`egm-implementation-readiness`, `egm-codebase-details`, `egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 155-159, 306-308, 315, 342-346](docs/designs/voice-screening-gate-retry-sharing.md#L155-L346) (Technical Plan 2; `Status` readers; repair; App.html)
*   **Discrepancy Description:** The status change is a repeating cost and the reader inventory is incomplete or wrong: `voiceQueueTrailingFails_` reads `Voice_Queue.Status`, not `Voice_Calls.Status`, so it needs no change for `No answer`; missed readers are `apiVoiceFetchResult`, `voiceCallFlags_`, `voiceCallOut_`, the page's `VOICE_STATUS_CLASS_`, `voiceCardSection` (which takes the newest call of any status and would hide a real result behind a newer blocked or no-answer row), and the command-center KPI and CSV header. `voiceTaskRows_` shows no status, so "show the two new values" is a no-op. The page has no call-log status filter. The one-time repair rewrites old rows irreversibly, runs inside `voiceSchema_` (called by nearly every reader, so it could recurse or rescan the transcript-heavy sheet), and `ensureSchema_` will not run it. (Source: C C-nits/Stage 7 D/E, E E16, E19, Z M10.)
*   **Rationale:** A missed reader misclassifies silently; the repair is risky and the old rows are test calls.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid; each point checked against the reviewers' file and line citations.
*   ***Proposed Edit:***
    *   Location: Technical Plan 2; Detailed Implementation `VoiceScreen.gs`, `App.html`, `Styles.html`, E2E.
    *   Change: Add one `voiceStatusClass_(status)` (answered, unanswered, provider error, blocked, in progress) used by every reader, and log an unknown status loudly. Write the real reader list into the plan (the ones above); remove `voiceQueueTrailingFails_` from the "reads `Status`" list and say it must not count gate refusals. `voiceCardSection` shows the latest call that has a result, with a separate line for a newer blocked attempt. Delete `voiceStatusRepair_`; the Admin clears the test rows by hand before the first batch (a rollout step). Remove "chips and filters"; map `No answer` and `Busy` to the existing `miss` class and `Blocked` to a neutral class in `Styles.html`, or state "no `Styles.html` change".

### [Issue 22] [`egm-implementation-readiness`, `egm-codebase-details`] - Severity: Major
*   **Affected Scope:** [Lines 312-316, 322-325](docs/designs/voice-screening-gate-retry-sharing.md#L312-L325) (`voiceQueueJob`, ingest, same-number match, to-dos)
*   **Discrepancy Description:** Several mechanisms are missing: ingest as the first step of the queue job has no user (`voiceIngestRun_` skips calls the user may not review, line 1215; `refreshDashboardJob` passes a synthetic Admin, `Dashboard.gs:85`). Ingest errors have no counter column (`Voice_Inbox` has fixed columns). `voiceFindCost_` has no key rule. New `Voice_Queue` columns need an `addColumns_` call. Queue rows carry no phone and `Candidate_ID` is written empty, so same-number checks need a row-to-number lookup; the batch preview must show "already queued"; facts should be read once per batch (the dry-run gate runs per card). `voiceStats_` collides with the existing `noAnswer` key, has no inputs for monthly figures, and existing E2E V4 and V6 need updating. The "oldest inbox row age and queue depth" figure has no producer. The `noanswer` to-do needs `voiceTaskRows_` to read `Voice_Queue`, and `allTasks_` does not stamp the voice sheets. (Source: E E10, E14, E15, E16, E17.)
*   **Rationale:** An engineer would have to invent each.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid; these are specification gaps.
*   ***Proposed Edit:***
    *   Location: Detailed Implementation, `VoiceScreen.gs`, `Tasks.gs`, `E2E.gs`.
    *   Change: `voiceQueueJob` builds the same synthetic Admin object as `refreshDashboardJob`. Add `Voice_Inbox.Error_Count` and a rule: after 3 failed attempts the row is stamped with the error and left for an Admin screen to show. `voiceFindCost_` accepts a number only under a key whose name contains `cost`, `price` or `amount` and a sibling key naming a currency (`currency`, `unit`), and ignores keys containing `balance`, `pending` or `credit`. Add an extra-column list for `Voice_Queue` and an `addColumns_` call in `voiceSchema_`. Add a row-to-number map built from candidate records once per batch, passed to `voiceQueuePick_` and `voiceBatchCheck_`; a clash skips that card with the reason "already queued". Rename the new bucket `unanswered`; `apiVoiceStats` passes monthly figures and screenings as new inputs and `voiceStats_` keeps its five-argument form for the date window; V4 and V6 are updated. The command center reads inbox age and queue depth from a new `apiVoiceHealth`. `voiceTaskRows_` takes queue rows as a second input; `allTasks_` stamps `Voice_Calls` and `Voice_Queue`.

### [Issue 23] [`egm-codebase-details`, `egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 224-227, 315](docs/designs/voice-screening-gate-retry-sharing.md#L224-L315) (Technical Plan 9)
*   **Discrepancy Description:** Rollback is weaker than described: rolling back the gate re-opens the original holes (night calls, opt-out), and `apiVoiceBatchStop` leaves `Scheduled` rows live. (Source: C C10, E E13.)
*   **Rationale:** The rollback text promises more than it gives.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid.
*   ***Proposed Edit:***
    *   Location: Technical Plan 9.
    *   Change: State that the gate is rolled forward, not back: if the gate has a defect, set `VOICE_ENABLED` to No, stop all batches (including `Scheduled` rows, issue 16), remove the trigger, fix and redeploy. If a rollback build is unavoidable it must keep the hours and opt-out checks. Drop the repair (issue 21), so nothing irreversible runs.

### [Issue 24] [`egm-zoom-out`, `egm-style`] - Severity: Major
*   **Affected Scope:** [Lines 104-234 versus 284-399](docs/designs/voice-screening-gate-retry-sharing.md#L104-L399) (Technical Plan; Detailed Implementation)
*   **Discrepancy Description:** The document is half design and half code index with heavy duplication: retry mitigations, the reaper, share lookup, the status readers and the gate are each described twice, and the two have begun to drift. The gate's pure core has two names (`voiceMayCall_`, `voiceGateDecide_`). Detailed Implementation lists function signatures under "There is no code here". `voiceFindCost_` hardening and the ingest error behaviour are tied to no goal. (Source: Z M13, P 15, Y5.)
*   **Rationale:** Two descriptions of one behaviour drift apart.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid for the duplication, the names and the unmotivated items. The "no code" objection is not carried forward: the skill allows pseudocode, APIs and schemas, so signatures are allowed; the line "There is no code here" is only filler (Issue 31).
*   ***Proposed Edit:***
    *   Location: Technical Plan 1 to 10; Detailed Implementation.
    *   Change: One description of each behaviour in the Technical Plan. Detailed Implementation keeps, per file, what changes and why, and the signatures and defaults that are decisions; it does not repeat behaviour. Settle the names: `voiceMayCall_` is the gate entry (reads facts, takes the lock) and `voiceGateDecide_` is its pure core; say so once in the Technical Plan. Give `voiceFindCost_` hardening and the ingest error counter a line in the Problem ("a credit balance would be recorded as a call's cost; a failed result write is lost") or remove them.

### [Issue 25] [`egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 11, 196, 226-227](docs/designs/voice-screening-gate-retry-sharing.md#L11-L227) (Overview; Technical Plan 6, 9)
*   **Discrepancy Description:** Privacy, consent, retention and webhook trust are not addressed: nothing on consent to automated or recorded calls, disclosure that the caller is an AI agent, or retention of transcripts and payloads in Sheets; nothing on how forged or replayed payloads are rejected (a forged payload could write the register, release reserved budget or change an outcome). (Source: C C13.)
*   **Rationale:** These are risks the standard expects the document to name.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid as an omission. The consent and disclosure position is a business and legal decision, not an engineering one, so the document records it as an Open Question with an owner and does not decide it.
*   ***Proposed Edit:***
    *   Location: Open Questions; Risks & Mitigations.
    *   Change: Add Open Questions with owner HR and legal: candidate consent and AI-agent disclosure for recorded calls; retention period for transcripts and payloads. State the receiver's protections as they are (secret in the address, compared in constant time, one append-only sheet) and note the ingest requires a matching call id or attempt id, so a forged row cannot change an unrelated call; add "limit what a forged row can do" as a Risks entry with a mitigation (the register write comes only from an ingest of a matched call).

### [Issue 26] [`egm-style`, `egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 11, 26, 28-34, 49, 70, 171, 196, 246](docs/designs/voice-screening-gate-retry-sharing.md#L11-L246) (Overview, The Problem, Goals, Alternatives)
*   **Discrepancy Description:** Claims about existing behaviour are stated flatly or inconsistently. "The provider sends no cost" and "ratings came back as an empty object" are asserted (lines 32, 246) while line 70 lists the post-call step as unconfirmed and line 196 says the first batch will capture "an unknown field such as a cost". "Candidates often do not answer" has no figure. (Source: C C14, Y1, Y2, Y4.)
*   **Rationale:** A reader cannot decide whether to trust the premises.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. Evidence is in the repository's own SSOT section 8.7 and the code, which I can cite.
*   ***Proposed Edit:***
    *   Location: The Problem; Alternatives (cost-cap entry); Technical Plan 6.
    *   Change: Cite the evidence: for the code claims, the function and line (for example `voiceOutcome_`, `voiceUsedToday_`, the `cfg.dndRequired` condition); for the provider claims, "in the payloads inspected so far (SSOT section 8.7) no cost field was seen, and one test call on agent version 6 returned `screening_ratings` as an empty object; one call does not establish the general case; the first batch confirms." Use that wording in all three places. Mark "candidates often do not answer" and the recruiter-quality statement as assumptions the pilot tests.

### [Issue 27] [`egm-design`, `egm-structural`, `egm-style`] - Severity: Major
*   **Affected Scope:** [Lines 236-283, 175](docs/designs/voice-screening-gate-retry-sharing.md#L236-L283) (Alternatives Considered)
*   **Discrepancy Description:** "Rejected by author" appears in nearly every heading and again in each body, and the author is shown as Claude with the owner's decisions unlinked, so the label adds nothing; the concepts brief is cited with no path; important alternatives are missing (enforcing hours and opt-out at the provider, a `Raised_By` field on the MRF, an Admin hours override, the Call-again to-do); three headings bundle two options each; the two "Deferred" entries are not rejections and the nudge has no threshold. (Source: C C15, Y13, Y20.)
*   **Rationale:** The standard forbids attributing a rejection to a maintainer without a link; the label also hides the real reason.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. One reviewer (Y12) said the intro count of "first six, next five" is wrong; that is contested below, so I do not change the count.
*   ***Proposed Edit:***
    *   Location: Alternatives Considered.
    *   Change: Drop "Rejected by author" from headings and bodies; use headings "Not chosen: ...", "Deferred: ...", and state the trade-off and the condition under which it fails. Name the source of the first six: "`concepts_brief.md` in the repository root". Use one heading per option. Add "Not chosen: enforce hours and opt-out in the provider instead of the CRM" (the provider's campaign windows and list are not readable by the CRM and cannot cover calls placed from cards), "Not chosen: an Admin override for hours" (decision: none, issue 11), "Not chosen: a `Raised_By` field now" (deferred to the owner), "Not chosen: a recruiter Call again to-do" (issue 16). Give the nudge a threshold: "revisit if the first batch answer rate is below 30 percent".

### [Issue 28] [`egm-zoom-out`, `egm-comprehension`, `egm-structural`, `egm-style`, `egm-design`] - Severity: Major
*   **Affected Scope:** [Lines 24-70, 60-70, 104](docs/designs/voice-screening-gate-retry-sharing.md#L24-L104) (headers; Open Questions; terms)
*   **Discrepancy Description:** Open Questions have no owner, date or draft default, and assumed answers elsewhere (rupees, `HOD_Email`, "Admin not exempt") are not cross-referenced to them. The standard's blueprint headings are not matched ("The Problem", separate "Goals" and "Non-Goals", "Technical Plan (Architecture)"). Many project terms are undefined for a newcomer (MRF, card, position, line, `Tech_Panel`, command center, plan desk, W and T levels, owner versus Admin, `Voice_DND`, `Voice_Inbox`, status versus outcome versus disposition, SSOT, ADR-010, `EGM.md`). (Source: Z M11, C C16, C17, P 12, Y19.)
*   **Rationale:** A fresh reader must be able to follow the document and find the standard's sections.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid; comprehension gaps are not contested.
*   ***Proposed Edit:***
    *   Location: headings; Open Questions; a new Glossary at the top.
    *   Change: Rename "The Problem" to "Problem Statement", merge Goals and Non-Goals under "Goals & Non-Goals" (two subheadings), and rename "Technical Plan (Architecture)" to "Proposed Architecture". Turn the Open Questions into a table: question, release it blocks, decision owner (the business owner named in the SSOT header, or HR and legal), assumed default, and a back-reference from every assumption in the body. Add a short Glossary after the Overview (MRF, position or line, card, `Tech_Panel`, command center, plan desk, W and T levels, status versus outcome versus disposition) and use "gate", "result" and "owner" consistently (the owner decides, the Admin configures; they may be the same person). Link `docs/BFCL_Recruitment_CRM_SSOT.md` and `EGM.md` with correct relative links from `docs/designs/`.

### [Issue 29] [`egm-style`, `egm-design`, `egm-comprehension`, `egm-implementation-readiness`, `egm-codebase-details`] - Severity: Major
*   **Affected Scope:** [Lines 366-367, 393, 398, 403](docs/designs/voice-screening-gate-retry-sharing.md#L366-L403) (Testing; steps)
*   **Discrepancy Description:** The test plan has titles, not tests: no inputs, expected results or boundaries (09:00 and 19:00 exactly, 18:59, Saturday evening into Sunday, ceiling equality, `Attempts` at the limit, `Not_Before` equal to now); the promised "an e2e case covers each reader" covers only the daily limit and the gate; uncovered: status display, `voiceTaskRows_`, the batch stop rule, `voiceStats_`, `voiceBudgetSweep_`, the ingest counter, settings validation, rate-unset fail-closed, the fetch path; the `'Failed'` code search has no runnable check; eight names for more than ten cases; "assumed V7 to V14"; "are the only guard" is an absolute; the dark and light theme check is not in step 8. (Source: C Stage 7, E E21, Y2, Y3.)
*   **Rationale:** An engineer cannot tell when each case passes.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid.
*   ***Proposed Edit:***
    *   Location: Testing; release steps.
    *   Change: Replace the list with a table: case id, setup, action, expected result. Include each boundary above and one case per reader of `voiceStatusClass_`. Replace the code-search check with a test that fails if any status string outside the class map reaches a reader. Delete "assumed" from the names and use `V7` onward as needed. Reword "are the only guard" to "the guards are the code search, the per-reader cases, and the editor-run E2E". Add dark and light theme to step 8 with a pass criterion (no text clipped at 375 px width).

### [Issue 30] [`egm-implementation-readiness`] - Severity: Major
*   **Affected Scope:** [Lines 339-349, 352-383](docs/designs/voice-screening-gate-retry-sharing.md#L339-L383) (file boundary)
*   **Discrepancy Description:** The file boundary is not exact: `Styles.html` "as needed" cannot be enforced; the `App.html` bullets are tagged "releases 1 to 4" with no release mapping; `VoiceScreen.gs` is missing functions the plan changes or depends on (`voiceLog_`, `voiceCfgOut_`, `voiceQueueStopReason_`, `apiVoiceBatches`, `apiVoiceBatchStop`, `apiVoiceFetchResult`, `voiceQueueTrigger_`); the keep-trigger condition is inline in `voiceQueueJob`, not in `voiceQueueTrigger_`. (Source: E E22, E13.)
*   **Rationale:** An allowlist must be exact to be enforceable.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid.
*   ***Proposed Edit:***
    *   Location: Detailed Implementation file list.
    *   Change: Add the listed functions; map each `App.html` bullet to its release; name the exact `Styles.html` class changes or write "no change"; say the keep-trigger rule changes in `voiceQueueJob` and `voiceQueueTrigger_` together. Add the new sheets (`Voice_Contacts`, `Voice_Budget`), new columns and the new Admin section to the data-model table.

### [Issue 31] [`egm-style`, `egm-comprehension`, `egm-design`] - Severity: Nit
*   **Affected Scope:** [Various lines](docs/designs/voice-screening-gate-retry-sharing.md#L1-L406)
*   **Discrepancy Description:** Wording and consistency nits, grouped: line 20 duplicates Non-Goal line 54 and "sketched here" is filler; line 35 restates the Overview list; "or any person the Admin has named" is wordy; "real" is undefined; the Overview says four hard limits where the gate has five checks and "no wrong rejection" is enforced by a non-goal; "No override" versus an editable window; hours are hard-coded in a CUJ message while the window is a setting; the time zone and holidays are unstated; the reaper threshold (5 minutes) is near the 6-minute execution cap and three timeouts (5, 30 and max-plus-60 minutes) overlap; the queue's `Failed` and the call's `Failed` mean different things; `partial` maps to `Completed` and is never retried; the data-model table omits the register's source and reason fields, the new to-do types and the audit row type; CUJs are missing for a budget block, a register hit, a lost webhook and the fail-closed path; the code fence at lines 122 to 143 has no language tag; the nudge alternative has no cost or consent trade-off; line 159, 234 and 302 wording; "fuzzy name"; "Rejected by author"; bare citations such as "SSOT 12.5"; `BUILD_ID` target values; the Admin test call has no step; line 392 settings arrive before use; the no-change entries pad the file list; the no-wrong-rejection limit has no mechanism (I NM3); line 227 secret rotation has no named gate; the diagram shows only the happy path (I NM1); "Y12" is contested below.
*   **Rationale:** Small, cheap improvements.
*   ***AI Suggestion:*** DECLINE
*   ***Justification:*** These are Nits. They are recorded here. Several are fixed as a side effect of the fixes above (the glossary, the single release list, the status model, the Alternatives rewrite). I propose to fix three on their own because they change meaning: add the state diagram of a queue row (Waiting, Calling, Placed, Scheduled, Stopped, Failed with the event for each move, from Issue 3) and an ASCII language tag; state that "no wrong rejection" is enforced by the call-result writer having no access to stage or reject functions, and say so as a design rule; make the secret rotation a named release gate owned by the Admin. If you want the remaining nits fixed too, say so in the breakdown.
*   ***Proposed Edit:***
    *   Location: Technical Plan (diagram), Goals, section 9.
    *   Change: As in the justification: the queue-row state diagram with a `text` fence, the structural rule for "no wrong rejection", the named secret-rotation gate.

### [Issue 32] [`egm-style`] - Severity: Nit
*   **Affected Scope:** [Lines 238-282](docs/designs/voice-screening-gate-retry-sharing.md#L238-L282) (Alternatives intro)
*   **Discrepancy Description:** "The intro says the first six come from the brief and the next five are the options the author did not choose, which is inconsistent with the actual count (11 headings)." (Source: C Y12.)
*   **Rationale:** The reviewer thought the numbers did not add up.
*   ***AI Suggestion:*** CONTEST
*   ***Justification:*** The structural reviewer checked the same text and found it matches. Reading the document: the intro at line 238 says the first six come from the brief and the next five are the options the author did not choose. The document has 11 headings under it (lines 240 to 282): six from the brief (four rejected, two deferred) and five from the design choices. 6 plus 5 is 11, so the count is correct. The count is correct and the evidence is in the headings the reviewer could read. Severity is not changed; I record it as contested. The headings will be rewritten in issue 27 anyway, so the intro line is rewritten with the real count then.
*   ***Proposed Edit:***
    *   Location: none for this issue.
    *   Change: none; issue 27 rewrites the intro.
