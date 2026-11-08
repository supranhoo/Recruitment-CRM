## What this proposes

The CRM can already place Sarvam voice-agent calls to candidates, but it has never been used on real candidates. The design makes it safe to use in four releases. Release 1a adds one gate in front of every call. The gate enforces calling hours, opt-out, a per-number attempt cap, call-count caps and "one open call". Release 1a also adds distinct statuses for No answer and Busy, a "Pending confirmation" opt-out state for a candidate who says "do not call me again", and capture of what the provider really returns. Release 1b adds a rupee spend ceiling with a reserve before each call. Release 2 retries unanswered batch candidates up to three attempts in total, then gives the recruiter a to-do. Release 3 prepares a message that the recruiter sends to the technical interviewer and the MRF owner. Throughout, a person decides: a call result never moves a stage, rejects a candidate or messages a candidate.

## How the existing system works, per this document

A recruiter, or someone the Admin has named, can call one candidate from a card, or start a batch of up to 30 from a position's board. Every call goes through `voiceStartFor_` to the provider. The provider's result arrives through a separate webhook receiver into a `Voice_Inbox` sheet. A 30-minute job, or the queue job, ingests it into `Voice_Calls` as a draft screening that a person completes. Today the hours check exists only on the batch paths. The opt-out check can be turned off by `VOICE_DND_REQUIRED`. A spoken "do not call" only creates a to-do. No answer, busy and failed placement all become `Failed`. The only spend limit is a per-person daily call count. The CRM e-mails Admins only, and the interviewer is free text in `Tech_Panel`.

I could write both paraphrases. Separate from the findings below, the "existing system" part leans on SSOT section 8.7 and on code names for its detail, and does not describe the system itself. Examples are the queue lifecycle, the access-request flow and what `voiceInHours_` does.

## Findings

(Stage 6, round 2. Reviewer: `egm-comprehension`, a fresh reader given only the document, ranges FeatureRange lines 1 to 409 and DetailedRange lines 410 to 518 of `docs/designs/voice-screening-gate-retry-sharing.md`. Ids are `K` followed by the number.)

### Blockers

**K1. Release 1a creates `Scheduled` queue rows, but the picker that reads them only arrives in Release 2.**
- Scope: CUJ 5, test T2, Architecture 1 table and Architecture 4, Detailed `voiceQueuePick_` and `apiVoiceBatchStop`, the "each safe to stop after" claim.
- Hours-deferred rows become `Scheduled` with `Not_Before` in Release 1a. CUJ 5 and T2 are Release 1a cases.
- Detailed lists "picks due `Scheduled` rows" under Release 2 only. It also lists `apiVoiceBatchStop` stopping `Scheduled` rows under Release 2 only. Yet the rollback text (Release 1a) says to stop `Scheduled` rows.
- Architecture 4, under Release 2, says the one-shot trigger for `Scheduled` rows belongs to Release 2. Detailed puts that trigger rule in Release 1a.
- A reader cannot tell whether, after Release 1a, deferred rows are ever placed. The "each release is safe to stop after" claim therefore fails for 1a.
- The 48-hour expiry of `Scheduled` rows is described in Architecture 1, but no Detailed item implements it.

### Major

**K2. Release labels for `Batch_ID` and the baseline disagree.**
- Scope: Data model table, Architecture 3, 4 and 6, Detailed.
- `Batch_ID` is labelled Release 1b in the data model. Detailed Release 1a has `voiceStartFor_` write `Batch_ID`.
- Release 2's ingest finds the queue row by `Batch_ID`. Yet the rollout says Release 2 needs only Release 1a's contact record and statuses.
- The baseline of recruiter minutes must be entered "before the pilot", and Section 6 is labelled 1a. The baseline store (`Voice_Admin_Notes`) is Release 1b, after the first batch. The baseline therefore cannot exist before the pilot.
- The invoice list is also 1b, but the goal says the first batch tells the owner the provider's billing basis.

**K3. Test calls versus "real" calls.**
- Scope: Overview, Architecture 1, Goals, Rollout precondition 2.
- "Real" is defined as calls to candidate numbers rather than team-owned numbers. Hours and opt-out "cannot be switched off for real calls", and `voiceMissing_` "stops every real call".
- Nothing says how the gate tells a real call from a test call. Nothing says whether the gate also blocks the team-number test call that precondition 2 requires, for example at night.

**K4. Single-call unanswered to-do versus Detailed.**
- Scope: Non-Goals line 78, Detailed `Tasks.gs` `voiceTaskRows_`, Release 2.
- The Non-Goals say a single call from a card that is not answered gets the same "did not answer" to-do.
- Detailed derives the `noanswer` to-do only from queue rows whose retries ended (Release 2). A single call has no queue row. No release delivers the single-call to-do.

**K5. The gate's refusal classes for limits are unspecified.**
- Scope: Architecture 1 (Refusals and queue-row table), Q1, Detailed `voiceQueueStopReason_`.
- `defer` is listed as hours, "a budget window", could not check, open call. `terminal` is opt-out, per-number cap, "a hard stop". Nobody says which kind applies to the daily limit, per-batch cap, monthly call cap or rupee ceiling.
- "A budget window" has no defined `Not_Before`. A deferred monthly refusal would loop on 15-minute backoffs for 48 hours. Q1's default says the queue stops at the ceiling.
- Detailed says `voiceQueueStopReason_` keeps matching limit texts, but "gate refusals no longer go through it".
- The system principal for retries "does not use the recruiter's daily limit", yet check 4 applies the daily limit. How the system principal passes check 4 is not stated.

**K6. The reaper's list of "placed" statuses omits the new statuses.**
- Scope: Architecture 4 (Stale `Calling` rows), test T8.
- The reaper treats a stale `Calling` row as `Placed` only if a call row is `Starting`, `Started` or `Completed`. A call that was placed and quickly ended `No answer` or `Busy` matches none of these.
- Such a row would be marked `Failed` with "Run ended before the call was placed". That is wrong and contradicts the reaper's own purpose.

**K7. The share-message content contradicts itself for non-users.**
- Scope: Architecture 7 (content table versus "Non-users").
- The table says the MRF owner's message has counts only and no answers. The Non-users bullet says that for a recipient without a CRM account "the message text carries the confirmed answers in full".
- The interviewer table row already includes answers, so it is unclear what changes for non-users. It is unclear whether the MRF owner then receives answers, which the table forbids.

**K8. The opt-out contact record is empty at go-live.**
- Scope: Architecture 1, Rollout, Detailed `voiceContactsRebuild_`.
- The gate reads opt-out and attempt counts only from `Voice_Contacts`, a new sheet. `Voice_DND` is "mirrored" by new writes and by an Admin rebuild button.
- No rollout step or precondition says to run the rebuild before the first batch. Numbers already on `Voice_DND` are therefore unprotected until someone does.
- Nothing says who writes `Attempt_Times`, or when: at placement or at result. The per-number cap depends on this.
- Detailed `voiceStartFor_` does not list a `Voice_Contacts` write.

**K9. Opt-out features in the architecture have no matching implementation item.**
- Scope: Architecture 5, Detailed.
- The transcript phrase scan has no named function. The phrase list is undefined, and "the languages in use" are never named.
- Confirm and Undo exist as `App.html` buttons, but there is no API or server function for them in the Detailed list.
- It is not stated who may confirm. Only undo is Admin-only, per Q3.
- Undoing a confirmed opt-out is said to "clear the state". It does not say it also removes the number from `Voice_DND`.

**K10. Goals are not delivered by the Detailed section.**
- Scope: Goals (measures, "no access to stage or reject functions"), Architecture 8, Detailed.
- "Completion rate" and "recruiter minutes per completed screening" have no Detailed function. No data source is named for the recruiter minutes that the voice-assisted screening took.
- "Candidates reached" and "calls with answers" are not tied to any status. A `Completed` status includes a `partial` call. "The pilot" is never defined, and it is used interchangeably with "the first batch".
- The goal that "the call-result writer has no access to the stage or reject functions" is not implemented or tested anywhere in Detailed. It appears only as an EGM invariant in the Documents list.

**K11. Planned minutes and the sweep are underspecified.**
- Scope: Architecture 3, Detailed Release 1b.
- "Planned minutes" is passed to the gate, but its source is not stated. It may always equal `VOICE_MAX_CALL_MIN`.
- The Close action sets `Cancelled`. `Cancelled` is called "existing" but is not in the status list. It has no class in `voiceStatusClass_`, whose five classes do not cover `Cancelled`, `Started` or "presumed spent".
- The sweep is said to run from `voiceQueueJob`, but Detailed lists the sweep call only in `refreshDashboardJob`.
- `voiceLog_` is told to accept the reserve in Release 1a's list. `voiceStartFor_` in 1a already writes the reserve inside the lock, although the reserve is Release 1b.

**K12. Retry timing is ambiguous.**
- Scope: Q2 versus Architecture 4, CUJ 3.
- Q2's default is "no answer after 4 hours, then the next window at 11:00". Architecture 4 says retry in 4 hours, "each retry is moved to the next calling window", at 11:00 if inside the window, else the window start.
- If now plus 4 hours is already inside hours, does the retry still move to the next day at 11:00? Does Busy's 30-minute retry get moved too? The text allows either reading.
- The Stopped reason reads "no answer after 3 attempts" even if the last attempt was Busy.

**K13. Two sentences are wrong or unclear about `screening_ratings`.**
- Scope: Architecture 6 versus T10.
- Architecture 6 says `voiceVars_` drops object values, so an object-valued `screening_ratings` is lost. It then says `Ratings_State` "records that the field was empty or absent".
- T10 expects an object payload to give `present`. So the object case is recorded as present, not empty or absent, and the sentence is inconsistent with T10.
- It is not stated how `Ratings_State` is computed independently of `voiceVars_`.

### Nits and smaller gaps

- **Terms used without definition.**
  - Sheets and states: `Voice_Calls`, `Voice_Queue`, `Voice_Inbox` and `Voice_DND` (only the last two are named in the glossary), the queue row states (`Waiting`, `Calling`, `Placed`, `Stopped`, `Scheduled`) and the call state `Starting`.
  - Voice flow: "follow-up call" and "approved request" (the access or approval flow is never described), "ingest", "the reaper", "preview", "board".
  - Mechanics: `withLock_` and the "one-minute job".
  - "Plan desk" is defined but used only in Alternatives.
- **Three names for the system identity.** The text uses "synthetic Admin user" (Architecture 4), "named system user" (Architecture 5) and "named `system` principal" (Architecture 4). It is unclear whether these are one identity.
- **Hours.**
  - The calling-hours window is called "configured", yet no hours setting name or default appears. The data-model Settings row and the `voiceCfg_` list do not include one. Only the outer bounds 08:00 to 21:00 appear.
  - The CUJ 1 message hard-codes 09:00 to 19:00, Monday to Saturday.
  - Whether `voiceInHours_` already excludes Sundays is not stated.
- **Caps.** CUJ 2 says the Admin sets the per-batch cap. Elsewhere the per-batch cap of 30 is existing and fixed.
- **Q8.** "Blocks 1a (retry and hours)" uses "retry" for the provider's own retry, but a reader will take it as this design's Release 2 retry.
- **Q4.** It asks about the "Apps Script mail quota tier", but the CRM sends no mail, and the Risks table says "n/a".
- **Readers of `Status`.** Architecture 2 says `voiceTaskRows_` is not affected. T9 lists "task rows" as a reader to check, and Detailed changes `voiceTaskRows_` in other ways.
- **`voiceStats_`.** It "keeps its five-argument form", yet `apiVoiceStats` "passes new inputs" and test V4 must be updated.
- **Alternatives, final option.** The heading "a call-count cap with a provider-side limit in place of a rupee ceiling" does not describe what was chosen. The chosen design uses call-count caps first and then a rupee ceiling.
- **Alternatives, spend cap on cost.** The parenthesis "(up to 30 minutes for a single call; during a queue run ingest now runs first)" is hard to follow.
- **Header.** The status line cites "the egm-review findings", which no reader can look up.
- **Three wordings of the no-answer to-do.**
  - CUJ 3: "did not answer after 3 attempts".
  - Architecture 4 Stopped reason: "no answer after 3 attempts".
  - Detailed task rule: "no answer after the last attempt".
  - The figure 3 also appears as a hard-coded text.
- **Release 1a extras without rationale.** `apiVoiceHealth`, the inbox age and the queue depth have no counterpart in the Architecture or Goals.
- **Scheduled-row expiry.** The 48-hour limit does not say what the age is measured from.
- **Test gaps.**
  - No test covers `voiceFindCost_`, the three-failure error stamp on `Voice_Inbox`, the monthly call cap, the "already queued" skip or the 48-hour expiry.
  - Test ids are called T1 to T14 but are said to follow V6 as "V7 onward".
- **Open-call window.** The 30-minute "one open call" window can lapse while a call or its result is still pending. The sweep waits `VOICE_MAX_CALL_MIN` plus 60 minutes. The two numbers are not reconciled.
- **Rollout preconditions.** They say "owner of each is the Admin", but the call-site code audit (item 1) is an engineering task.
- **Share message.** The share message "Outcome" is ambiguous. The glossary's Outcome is the provider's text, not the recruiter's confirmed result.

## Cross-reference summary

- **Agree:** BUILD_ID 160 to 163 for four releases. Q-numbers referenced in the Architecture and Alternatives (Q1 to Q8). Settings names and the 1 to 5,000, 10,000,000 and 30 bounds. Test ids T3 and T9 as cited in Risks. The 5-minute reaper under the 6-minute run cap. The 30 percent threshold in Q5 and the WhatsApp alternative.
- **Disagree:** the items under findings K1, K2, K4, K6 and K7 above.
