# Voice screening: a safe first batch, retries, and sharing results

*   **Author:** Claude
*   **Status:** Draft
*   **Date:** 2026-11-08

--------------------------------------------------------------------------------

## Overview

The Recruitment CRM can already place Sarvam voice calls to candidates. A recruiter, or any person the Admin has named, can call one candidate from the candidate's card, or start a batch of up to 30 candidates from a position's board. The agent asks the position's screening questions. The answers come back as a draft screening, and a person completes it. Nobody has used this on real candidates yet.

This design covers what has to change before and just after the first real use:

1. Put the four hard limits (calling hours, opt-out, no wrong rejection, spend) in one place that every call passes through.
2. Run a small first batch and learn what the provider actually returns.
3. Give candidates who do not answer a controlled second chance, and cap spend.
4. Send the relevant result to the technical interviewer and the person who raised the MRF.

Other call types (interview reminders, offer follow-ups, joining-date check-ins) are planned for later and are only sketched here, so the first stages do not block them.

Context: the CRM is a Google Apps Script web app over Google Sheets. Calls go through the provider's outbound API. Results come back through a separate webhook receiver and are read by a 30-minute job. Today's voice behaviour is described in `docs/BFCL_Recruitment_CRM_SSOT.md` section 8.7 and in `./EGM.md`.

## The Problem

Screening by phone costs recruiter time. Candidates often do not answer. The quality of answers varies from recruiter to recruiter, and recruiters sometimes skip required questions. The voice agent should take over the repeated first-round questions and hand the recruiter a draft to check.

The feature exists in code, but four things stop it from being safe to use at scale:

- **The hard limits are not all enforced.** Calling hours are checked only for batches, so a single call from a card can go out at night or on a Sunday. The opt-out check can be switched off by an Admin setting. A candidate who says "do not call me again" on a call is recorded as "not interested", which creates a to-do and does not add the number to the opt-out register, so the next batch or retry would call them again. There is no spend limit at all: the only limit is a count of calls per person per day.
- **Unanswered calls are not recorded as a distinct result.** No answer, busy and a failed placement all become the status `Failed`. A retry rule cannot tell them apart, and unanswered calls stop counting against the daily limit once their result arrives.
- **Two things the owner expects to arrive do not arrive.** On the first agent version tested, the suggested ratings came back as an empty object, and the provider sends no cost figure. Neither can be fixed by CRM code alone.
- **Results cannot reach the people who need them.** The CRM sends e-mail only to Admins (a weekly summary and job-failure alerts). The technical interviewer is a name in free text on the MRF line. No field records who raised the MRF.

The proposed solution is a staged change: first a single check that every call must pass and a small observed first batch, then retry and a spend ceiling, then result sharing through a controlled outbox. Each stage is safe to stop after.

## Goals

*   Every call, whether single, batch or retry, passes one check that enforces calling hours, opt-out, the daily limit, the budget and "one open call per candidate". A blocked call is logged with a named reason.
*   No call is placed outside calling hours, and none to a number on the opt-out register. The opt-out check cannot be switched off for real calls.
*   A candidate who says "do not call me again" on a call is added to the opt-out register, and a person can undo it.
*   Unanswered calls (no answer, busy) are recorded as a distinct result and count against the limits.
*   A monthly spend ceiling and a per-batch ceiling stop further calls when reached, using a reserve before each call and the real minutes after.
*   After the first real batch, the owner knows the real answer rate, the real minutes per call, whether suggested ratings arrive and in what shape, and what the provider's billing basis is.
*   A candidate who did not answer is retried under a fixed rule (attempts, spacing, stop conditions) and, after the last attempt, the recruiter gets a to-do. The card is never closed or rejected.
*   The success rate is the share of placed calls that end in a screening completed by a person. Minutes saved per hire is measured against a recruiter-time baseline taken before the pilot.
*   The technical interviewer and the MRF owner learn that a result is ready, after a recruiter has completed the screening, through a message that carries a link and a short summary, not a transcript.
*   A person always decides: no call result moves a stage, rejects a candidate, or messages a candidate.

## Non-Goals

*   Automatic stage moves, rejections or messages to candidates from a call result.
*   Free-form, user-defined call types or a rule builder.
*   Reminders, offer follow-ups and joining-date check-ins in the first stages. One of them is chosen after the first real batch.
*   E-mailing transcripts, recordings, phone numbers or the agent's suggested ratings.
*   Language switching and a short question set for W and T levels (already parked).
*   Replacing the provider, or reading the provider's Do Not Disturb list through an API the provider has not documented.
*   Fixing the agent's post-call prompt inside the CRM. That is a change in the provider's workspace, confirmed with one real call.

## Open Questions

These come from the concepts brief. None can be answered from the code. Each blocks part of the design and needs a decision from the owner.

*   **Budget**: the unit (rupees, or minutes if no rupee figure exists), the period (day, batch, month), who sets it, whether the Admin is exempt, and what happens at the limit (stop, or ask a lead).
*   **Retry rule**: which outcomes retry, how many attempts, the gap, whether attempts rotate through times of day, whether Sundays and holidays count, and what a person sees after the last attempt.
*   **Spoken opt-out**: whether "do not call me again" writes the register automatically or after a person confirms, and what the agent's prompt must say to tell it apart from "not interested in this job".
*   **Result sharing**: the channel (to-do, link, e-mail), the content, where the interviewer's and the MRF raiser's addresses come from, whether either gets a CRM login, and the Apps Script mail quota tier (consumer or Workspace).
*   **Completed screening**: confirm that the success numerator is "a recruiter completed the draft", and agree how the baseline of recruiter minutes per screening is taken.
*   **First later call type and "configurable"**: interview reminder or joining-date check-in first, and whether "configurable" means a type name, an agent id, a variable list and a fixed menu of safe actions.
*   **Provider facts to confirm with one real call**: whether the post-call step runs for API-placed calls and what shape `screening_ratings` has; whether unanswered rings are billed; whether the provider retries on its own and whether it honours our hours.

## Critical User Journeys (CUJs)

### CUJ 1: A recruiter places a call outside calling hours

*   **Given**: A recruiter with call access opens a candidate's card at 22:00, or on a Sunday. The card has final screening questions and the candidate is not on the opt-out register.
*   **When**: The recruiter presses *Place the call*.
*   **Then**: No call is placed. The card shows "Outside calling hours (09:00 to 19:00, Monday to Saturday)". A `Voice_Calls` row with status `Blocked (Outside hours)` and the reason is logged. Opt-out, daily limit and budget are not consulted for this attempt.

### CUJ 2: The first real batch

*   **Given**: The Admin has set the rate, the monthly ceiling and the per-batch ceiling. A recruiter selects 10 candidates for one position and starts a batch during calling hours.
*   **When**: The one-minute job places the calls through the gate, one at a time.
*   **Then**: Each call is placed or logged as blocked with a reason. When results arrive, each call has a status (`Completed`, `No answer`, `Busy`, `Failed`). The command center shows calls placed, answered, no answer, busy, failed, minutes, and whether suggested ratings arrived. The raw provider payload is kept on every call so the owner can read what the provider really returned.

### CUJ 3: A candidate does not answer

*   **Given**: A batch call ended `No answer` and the candidate is not on the opt-out register. The card has had fewer than the maximum attempts.
*   **When**: The retry time arrives (not before the earliest next time, and inside calling hours).
*   **Then**: The same queue row is called again through the gate, which re-checks hours, opt-out, limits and budget at that moment. After the last attempt the recruiter gets a to-do "Candidate did not answer after N attempts". The card is not rejected, moved or closed.

### CUJ 4: A candidate says "do not call me again"

*   **Given**: The agent ends a call with the disposition `do_not_call`.
*   **When**: The result is read by the ingest.
*   **Then**: The card's retries stop (stop reason "asked not to be called"). A to-do asks a person to confirm. If the setting `VOICE_OPTOUT_AUTO` is on, the number is also added to `Voice_DND` at once (source "Candidate opted out"); a person can undo it with a reason. No later call, batch or retry reaches that number.

### CUJ 5: The interviewer and MRF owner are told a result is ready

*   **Given**: A recruiter has completed a screening that began as a voice call draft.
*   **When**: The recruiter presses *Prepare message for the interviewer* or *for the MRF owner*.
*   **Then**: The app shows a short message (candidate and position, link to the card, outcome, the answers the recruiter confirmed, flags) and a Teams or e-mail link for the recruiter to send. It never includes the transcript, recording link, phone number or the agent's suggested ratings. If no address is on file, the screen says so. The app records "message prepared" in the change log. It cannot know whether the recruiter sent it.

## Technical Plan (Architecture)

All changes are inside the existing Apps Script project. The provider, the separately deployed webhook receiver and the Sheets database stay as they are. New columns and sheets are created by the existing self-healing `voiceSchema_`, so the schema version number does not change.

### 1. One gate in front of every call

Every call already reaches the provider through `voiceStartFor_` (single call, follow-up call, approved request, and each batch row). A new function `voiceMayCall_` is called at the top of `voiceStartFor_`, after the card, caller and phone are known and before anything is logged as `Starting`. It returns "allow", or a named reason, and the reason is written to the call log.

Checks, in this order, stopping at the first failure:

1. **Hours.** `voiceInHours_` with the configured window. Applies to real calls from every path. A preview shows the same answer.
2. **Opt-out.** `Voice_DND` lookup on the normalised number. The Admin setting `VOICE_DND_REQUIRED` stops affecting real calls; it only controls whether a preview warns. A number match is re-read at placing time, never cached from queueing time.
3. **Daily limit.** `voiceAccessEval_` as today, but unanswered calls now count (see section 2).
4. **Budget.** Reserve check (section 3).
5. **One open call.** No `Starting` or `Started` call for the same card in the last 30 minutes, and now also none for the same phone number.

The core of `voiceMayCall_` is a pure function that takes the facts (now, window, register hit, calls used, limit, reserved and spent minutes, ceilings, open calls) and returns the decision, so it can be tested without sheets, in the same style as `voiceQueuePick_` and `voiceStats_`. It fails closed: if a fact cannot be read, the answer is "blocked: could not check".

```
 card / batch row / retry
          |
          v
   voiceStartFor_  --->  voiceMayCall_ (pure core)
          |                   | allow / reason
          | allow             v
          v              Voice_Calls row (Blocked + reason)
   voiceLog_  (Starting, Reserved_Min set)
          |
          v
   provider outbound API  --->  call happens
                                    |
   Voice_Inbox  <--- webhook receiver (separate project)
          |
          v
   voiceIngest_  (30-minute job, and first step of every queue run)
          |
          v
   Voice_Calls: Status, Outcome, Duration_Sec, raw payload kept;
   Reserved_Min released; retry state on the queue row updated
```

Overrides: none for opt-out. Whether the Admin may override the hours is an open question; until it is decided there is no override.

### 2. Unanswered calls get their own status

`voiceOutcome_` maps provider statuses as follows: `connected`, `completed`, `partial` stay `Completed`; `no_answer` becomes `No answer`; `busy` becomes `Busy`; `failed` and any unknown value stay `Failed` with the raw text in the note. `Failed` then means a provider or placement error only.

Readers that must change, because they read `Status`:

*   `voiceUsedToday_`: `No answer` and `Busy` count against the daily limit. `Failed` and `Blocked` still do not.
*   `voiceStats_`: separate buckets for no answer, busy and failed. The success rate keeps its definition (calls with answers over calls placed), and a second figure counts calls that ended in a screening a person completed, joined from `Screenings` by card.
*   `voiceQueueTrailingFails_` and the batch stop rule: only `Failed` placements count toward "three in a row". A run of `No answer` results does not stop a batch.
*   `voiceTaskRows_` and the screens that show status chips: show the two new values.
*   The list of valid statuses and the call log's status filter.

One-time repair: a pass inside `voiceSchema_` rewrites old `Failed` rows whose `Outcome` is "No answer" or "Busy". The pass is idempotent. Because a reader that still tests for `Failed` would misclassify the new values without an error, a search for every use of `'Failed'` in `VoiceScreen.gs`, `Tasks.gs` and `App.html` is part of the implementation, and an e2e case covers each reader.

### 3. Spend ceiling with a reserve before each call

New settings (units are an open question; the plan assumes rupees and falls back to minutes if the owner has no rate): `VOICE_BUDGET_MONTH`, `VOICE_BUDGET_BATCH`, and the existing `VOICE_RATE_PER_MIN`. A third setting, `VOICE_MAX_CALL_MIN`, is the worst-case length of one call used for the reserve (default: the existing 8-minute warning level).

*   New column `Voice_Calls.Reserved_Min`: set when a call is logged as `Starting` (planned minutes, capped at `VOICE_MAX_CALL_MIN`), cleared when a result arrives.
*   Spent this month = minutes from calls with a result (`Duration_Sec`) times the rate. Reserved = `Reserved_Min` of calls without a result yet. The gate refuses a call when spent plus reserved plus this call's reserve would exceed the monthly ceiling.
*   Per-batch ceiling: checked in `apiVoiceBatchPreview` (shows how many calls fit) and again by the gate for each row.
*   A sweep inside `voiceQueueJob` clears `Reserved_Min` on calls that have had no result for more than `VOICE_MAX_CALL_MIN` plus 60 minutes, and marks them for a person to fetch or close, so a lost webhook cannot hold budget for ever.
*   The Admin is not exempt.
*   The command center shows spent, reserved and the ceiling, labelled "estimate". A weekly reconciliation against the provider's invoice is a manual step for the Admin: they enter the invoice minutes and amount, and the effective rate is shown next to the configured one.
*   Unanswered rings that the provider bills are not in the minutes. Whether they are billed is an open provider fact.

### 4. Retry on the queue

Retry state lives on `Voice_Queue` rows (decision of the author). New columns: `Attempts`, `Max_Attempts`, `Not_Before`, `Stop_Reason`. A new status `Scheduled` means "waiting for a later retry".

*   When a result arrives as `No answer` or `Busy`, ingest sets the queue row to `Scheduled` with `Not_Before` taken from a retry table (setting `VOICE_RETRY_PLAN`, for example "busy 30m, no answer 4h, then next day 11:00"). With `Attempts` equal to `Max_Attempts`, the row becomes `Stopped` with reason "no answer after N attempts" and a to-do is created for the recruiter.
*   A retry is never made after `not_interested`, `wrong_number`, `do_not_call`, a completed screening, or a `Blocked` result. `callback_requested` creates a to-do for the recruiter until the agent reliably returns the time the candidate asked for; it does not schedule a call yet.
*   `voiceQueuePick_` picks `Waiting` rows and `Scheduled` rows whose `Not_Before` has passed, oldest first, one per number. The caller now passes the numbers already in open rows, so one number cannot be in two batches or called twice in a run.
*   Mitigating the known weakness of keeping retry state on queue rows:
    *   A `Scheduled` row does not count as an open batch, so the owner can start another batch while retries wait.
    *   The one-minute trigger stays installed while any `Waiting`, `Calling` or `Scheduled` row exists, and returns at once when nothing is due. A `Scheduled` row older than 48 hours becomes `Stopped` with reason "retry window ended".
    *   The same card in a second batch is refused at queueing time when an open row for that card or number exists.
*   Ingest runs as the first step of every `voiceQueueJob` run, so the retry decision uses fresh results, not the 30-minute job's.
*   Stale `Calling` rows: a reaper at the start of each run looks, for each `Calling` row older than 5 minutes, for a `Voice_Calls` row for the same card started since the claim. If one exists, the row becomes `Placed`. If none exists, the row becomes `Failed` with the note "Run ended before the call was placed; check the provider". The reaper never puts the row back to `Waiting`, because the call may already have been placed.
*   The hours check is now inside the gate, so a run that begins at 18:58 cannot keep calling after 19:00.

### 5. Opt-out spoken during a call

*   The agent's prompt gains a `do_not_call` disposition, separate from `not_interested` ("not interested in this job"). This is a change in the provider's workspace, made and tested by the Admin.
*   `voiceDispositionAction_` maps `do_not_call` to: stop retries for the card; a to-do "Candidate asked not to be called: confirm"; and, if `VOICE_OPTOUT_AUTO` is on, a `Voice_DND` row with source "Candidate opted out". The setting starts off until the owner decides.
*   Undo is a person's action on the register, with a reason, as removal works today (the row is kept and marked inactive). Undoing does not restart retries.

### 6. What the first batch must capture

*   Every call keeps the provider's raw payload in `Voice_Calls.Final_Vars_JSON` (it already holds scalar variables) plus a new `Payload_Keys` note listing the top-level field names, so an unknown field such as a cost or billing figure can be seen without reading raw JSON.
*   `voiceStats_` gains "ratings arrived" (present, empty, absent) and median minutes per answered call.
*   If the post-call `screening_ratings` arrives as an object, `voiceVars_` is extended to read that object. This is conditional on seeing a real payload. Until then the reader stays as it is and the absence is counted, not hidden.
*   The Admin records a baseline of recruiter minutes per manual screening (a short list of timed screenings entered in Admin, stored as settings or a small table) before the pilot, so "minutes saved per hire" has a denominator.

### 7. Sharing a result with the interviewer and MRF owner

*   New function `apiVoiceShareDraft(callId, who)`, `who` being `interviewer` or `mrf_owner`. It is allowed only for a person who may review the card, and only when the screening is complete.
*   Recipient lookup:
    *   Interviewer: the names in the position's `Tech_Panel` (or the scheduled interview's panel), resolved to addresses through the existing panel-member index. Names that match nobody are listed as "no address on file".
    *   MRF owner: no field exists for who raised the MRF. Until the owner decides (open question), the message goes to the department head's address from the department master (`HOD_Email`), labelled as such.
*   Content is built by a pure function from the screening the recruiter completed: candidate name and position, link to the card, the outcome, the confirmed answers, and flags. The interviewer's message carries the answers. The MRF owner's message carries the outcome and counts only. Neither includes the transcript, recording link, phone number or the agent's suggested ratings.
*   The function returns text and a prepared Teams or e-mail link. The CRM sends nothing. It writes an audit row "Result message prepared" with the card, call and recipient role, and no message body.
*   The link opens the app, which needs a `Users` row. A recipient who has none gets a message the recruiter can paste in full, so the message text carries the answers, not only the link.

### 8. Data model changes

| Where | Change |
|---|---|
| `Voice_Calls` | Status values `No answer`, `Busy`, `Blocked (Outside hours)`, `Blocked (Budget)`; columns `Reserved_Min`, `Payload_Keys` |
| `Voice_Queue` | Status value `Scheduled`; columns `Attempts`, `Max_Attempts`, `Not_Before`, `Stop_Reason` |
| `Settings` | `VOICE_BUDGET_MONTH`, `VOICE_BUDGET_BATCH`, `VOICE_MAX_CALL_MIN`, `VOICE_RETRY_PLAN`, `VOICE_OPTOUT_AUTO`; existing `VOICE_RATE_PER_MIN`, `VOICE_CALL_HOURS` |
| Agent (provider workspace) | `do_not_call` disposition; post-call ratings output confirmed on a real call |

All additions are created by `voiceSchema_` and read as blank for old rows ("first attempt", "no reservation").

### 9. Rollout and rollback

*   Order of deployment: the gate and the status change together (they depend on each other through the limit), then the first real batch with retries switched off (`VOICE_RETRY_PLAN` empty), then retry, then the sharing message.
*   Rollback: stop waiting rows with `apiVoiceBatchStop`, remove the one-minute trigger, then redeploy the previous version. Calls already placed cannot be recalled. Old code ignores the new columns and would read `No answer` as an unknown status; rows written by the new code during a rollback window should be reviewed.
*   The webhook receiver is not changed by this plan. A change in the payload shape (for example ratings as an object) needs the CRM reader to ship first, because the receiver stores the payload as it arrives.
*   Before the first real batch, rotate the receiver's secret and place test calls only to numbers the team owns.

### 10. Testing

*   Pure-function tests for `voiceMayCall_` (each check, order, fail-closed), the retry decision, the budget reserve, and the message builder, in the style of the existing pure helpers.
*   `E2E.gs` cases for each hard limit: a call outside hours is refused on the single-call path and in a batch loop; a number on the register is refused with the setting off; an unanswered call counts against the daily limit; a reserve blocks the call that would pass the ceiling; a `do_not_call` disposition stops retries.
*   A search-based check that no reader still treats `Failed` as "unanswered".
*   There is still no automated test command in the repository, so the deploy check remains a syntax gate; the new tests run from the editor with `e2eTest()`.
