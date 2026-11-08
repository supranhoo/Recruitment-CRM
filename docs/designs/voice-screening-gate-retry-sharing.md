# Voice screening: a safe first batch, retries, and sharing results

*   **Author:** Claude
*   **Status:** Proposed (revised after the egm-review findings, 2026-11-08)
*   **Date:** 2026-11-08

--------------------------------------------------------------------------------

## Glossary

*   **MRF**: manpower requisition form. A department's request to hire. One MRF has one or more **lines** (also called **positions**): one row per vacancy in the `MRF` sheet.
*   **Card**: one candidate on one position's pipeline (an `Applications` row).
*   **Voice call**: one call placed by the Sarvam voice agent through the provider's outbound API. **Sarvam** is the voice provider. The **agent** is the provider's configured voice bot.
*   **Status, outcome, disposition**: **Status** is the CRM's state for a call (`Started`, `Completed`, `No answer`, ...). **Outcome** is a short text recorded from the provider's result. **Disposition** is the agent's own label for how the conversation ended (`completed`, `not_interested`, `do_not_call`, ...).
*   **Gate**: the one function every call must pass before it is placed.
*   **Opt-out register**: the list of numbers that must not be called (`Voice_DND`, mirrored into `Voice_Contacts`).
*   **Command center**: the panel at the top of Admin → Voice agent that shows calls, success and cost.
*   **Plan desk**: the screen on a card where the recruiter picks which questions the agent asks.
*   **W and T levels**: grade levels of blue-collar hires, which follow a fast-track route; they are not part of this design.
*   **`Tech_Panel`**: the free-text names of technical interviewers on an MRF line.
*   **Owner** and **Admin**: the business owner decides policy questions; the Admin configures the system. They may be the same person.
*   Source documents: [`concepts_brief.md`](../../concepts_brief.md) (the brief this design came from), [SSOT](../BFCL_Recruitment_CRM_SSOT.md) section 8.7 (how voice screening works today), [`EGM.md`](../../EGM.md) (the code blueprint).

## Overview

The Recruitment CRM can already place Sarvam voice calls to candidates. A recruiter, or a person the Admin has named, can call one candidate from the card, or start a batch of up to 30 candidates from a position's board. The agent asks the position's screening questions. The answers come back as a draft screening and a person completes it. Nobody has used this on candidates yet. In this document "real" means calls to candidate numbers, as opposed to numbers the team owns.

This design covers what has to change before and just after the first real use. Four releases, each safe to stop after:

1.  **Release 1a, the safe first batch:** one gate in front of every call, new statuses for unanswered calls, spoken opt-out protection, call-count caps, and capture of what the provider really returns.
2.  **Release 1b, spend control:** a rupee ceiling with a reserve before each call, shipped after the first batch has shown real minutes.
3.  **Release 2, retry:** a second chance for batch candidates who did not answer.
4.  **Release 3, sharing:** a prepared message for the technical interviewer and the MRF owner.

Other call types (interview reminders, offer follow-ups, joining-date check-ins) are a non-goal for these releases. One of them is chosen after the first real batch, and it would pass through the same gate.

## Problem Statement

Screening by phone costs recruiter time. The owner's view is that candidates often do not answer, that answer quality varies from recruiter to recruiter, and that recruiters sometimes skip required questions. These are assumptions the pilot tests; no figures exist yet. The voice agent should take over the repeated first-round questions and give the recruiter a draft to check.

The feature exists in code, but four things stop it from being safe to use on candidates. The code locations are as of 8 November 2026.

*   **The hard limits are not all enforced.**
    *   Calling hours are checked only in the batch paths (`voiceQueueJob`, `voiceBatchCheck_`), so a single call from a card can go out at night or on a Sunday.
    *   The opt-out check sits inside `if (cfg.dndRequired ...)` in `voiceStartFor_`, so an Admin setting can switch it off.
    *   A candidate who says "do not call me again" is recorded as `not_interested`, which only creates a to-do (`voiceDispositionAction_`, `voiceTaskRows_`). Nothing adds the number to the register, so the next batch would call the person again.
    *   There is no spend limit. The only limit is a per-person count of calls per day (`voiceUsedToday_`).
*   **Unanswered calls are not recorded as a distinct result.** `voiceOutcome_` maps no answer, busy and failed placement all to status `Failed`. A retry rule cannot tell them apart, and `voiceUsedToday_` stops counting a call as soon as its result arrives as `Failed`.
*   **Two things the owner expects have not been seen.** In the payloads inspected so far (SSOT section 8.7) no cost field was seen, and one test call on agent version 6 returned `screening_ratings` as an empty object. One call does not establish the general case, so the first batch confirms both. A cost figure and filled ratings cannot be fixed by CRM code alone.
*   **Results cannot reach the people who need them.** The CRM sends e-mail only to Admins (a weekly summary and job-failure alerts). The technical interviewer is a name in free text on the MRF line (`Tech_Panel`). No field records who raised the MRF.

Two smaller defects are fixed on the way. `voiceFindCost_` takes the first number under any key that looks like a cost, so a credit balance would be recorded as a call's cost. A failed write of a result is stamped as processed and the result is lost.

## Goals & Non-Goals

### Goals

*   Every call, whether single, batch or retry, passes one gate that enforces calling hours, opt-out, a per-number attempt cap, call-count caps and "one open call per card and per number". A refused call is logged with a named reason.
*   No call is placed outside calling hours, and none to a number on the opt-out register. Neither check can be switched off for real calls.
*   A candidate who says "do not call me again" on a call is protected at once: the number is marked "Pending confirmation", the gate treats it as an opt-out, and a person confirms or undoes it.
*   Unanswered calls (no answer, busy) are recorded as distinct statuses and count against the limits.
*   After the first real batch the owner knows the answer rate, the real minutes per call, whether suggested ratings arrive and in what shape, and the provider's billing basis.
*   Once real minutes are known, a monthly and a per-batch rupee ceiling stop further calls, using a reserve before each call and the real minutes after.
*   A candidate in a batch who did not answer is retried under fixed constants and, after the last attempt, the recruiter gets a to-do. The card is never closed or rejected.
*   Two named measures: **answer rate** (calls with answers over calls placed) and **completion rate** (candidates whose voice draft a recruiter completed over candidates reached). The pilot also reports recruiter minutes per completed screening against a baseline taken before the pilot.
*   The technical interviewer and the MRF owner can be told that a result is ready: the app prepares a message after a recruiter completes the screening, and the recruiter sends it.
*   A person always decides. A call result never moves a stage, rejects a candidate, or messages a candidate. The call-result writer has no access to the stage or reject functions.

### Non-Goals

*   Automatic stage moves, rejections or messages to candidates from a call result.
*   Free-form, user-defined call types or a rule builder.
*   Reminders, offer follow-ups and joining-date check-ins in these releases.
*   E-mailing transcripts, recordings, phone numbers or the agent's suggested ratings.
*   Language switching and a short question set for W and T levels (already parked).
*   Replacing the provider, or reading the provider's Do Not Disturb list through an API the provider has not documented.
*   Fixing the agent's post-call prompt inside the CRM. That is a change in the provider's workspace.
*   Retry for a single call from a card. Such a call that is not answered gets the same "did not answer" to-do and the recruiter decides.

## Open Questions

Each question blocks the release shown. The assumed default is what this design uses until the owner decides, and is changed in one setting or constant. "Owner" is the business owner (Head of HR); "Admin" configures the system.

| # | Question | Blocks | Decides | Assumed default |
|---|---|---|---|---|
| Q1 | Budget: period and who sets it, and what happens at the limit (stop, or ask a lead). The unit is rupees. Is the Admin exempt? | 1b | Owner | Monthly and per-batch ceilings set by the Admin; the queue stops at the ceiling; the Admin is not exempt |
| Q2 | Retry: attempts, gaps, Sundays and holidays, and what happens after the last attempt | 2 | Owner | 3 attempts in total; busy after 30 minutes; no answer after 4 hours, then the next window at 11:00; no Sundays; no holiday list; then a to-do |
| Q3 | Who may undo a pending or confirmed opt-out | 1a | Owner | Admin only, with a reason |
| Q4 | Result sharing: where the interviewer's and the MRF raiser's addresses come from; whether either gets a CRM login; the Apps Script mail quota tier. Add a `Raised_By` field on the MRF? | 3 | Owner | Interviewer from the panel master; MRF owner = department head (`HOD_Email`), labelled; no login; no `Raised_By` field |
| Q5 | Thresholds for moving from the first batch to Release 1b and Release 2 | 1b, 2 | Owner | Answer rate above 30 percent and no hard-limit breach in the batch |
| Q6 | Candidate consent to automated and recorded calls, and disclosure that the caller is an AI agent | 1a | HR and legal | Not decided; the existing agent script is not changed by this design |
| Q7 | Retention period for transcripts and payloads held in the sheets | Before wide use | HR and legal | Not decided; nothing is deleted by this design |
| Q8 | Whether unanswered rings are billed, whether the provider retries on its own and honours our hours, the shape of `screening_ratings`, and the provider's billing rounding | 1a (retry and hours), 1b (billing) | Admin, with one test call | Not billed; no provider retry; ratings unknown |

## Critical User Journeys (CUJs)

### CUJ 1: A recruiter places a call outside calling hours

*   **Given**: A recruiter with call access opens a card at 22:00, or on a Sunday. The card has final screening questions and the number is not on the opt-out register.
*   **When**: The recruiter presses *Place the call*.
*   **Then**: No call is placed. The card shows "Outside calling hours (09:00 to 19:00, Monday to Saturday, India time)". A `Voice_Calls` row with status `Blocked` and `Block_Reason` "Outside hours" is logged. Nothing else is checked.

### CUJ 2: The first real batch

*   **Given**: Release 1a is live. The Admin has set the per-batch and per-month call-count caps. A recruiter selects 10 candidates for one position and starts a batch during calling hours, with the Admin alongside.
*   **When**: The one-minute job places calls through the gate, one at a time.
*   **Then**: Each call is placed or refused with a reason. When results arrive each call has a status (`Completed`, `No answer`, `Busy`, `Failed`), and the command center shows calls placed, answered, no answer, busy, failed, minutes, and whether suggested ratings were present, empty or absent. The call row records the provider payload's field names and, for ratings, a state, and the full provider payload stays in `Voice_Inbox` linked to the call, so the owner can read what the provider returned.

### CUJ 3: A candidate does not answer (Release 2)

*   **Given**: A batch call ended `No answer`. The candidate's number is not opted out and the card has had fewer than three attempts.
*   **When**: The retry time arrives.
*   **Then**: The same queue row is called again through the gate, which re-checks hours, opt-out, caps and budget at that moment. After the last attempt the recruiter gets a to-do "Candidate did not answer after 3 attempts". The card is not rejected, moved or closed.

### CUJ 4: A candidate says "do not call me again"

*   **Given**: The agent ends a call with the disposition `do_not_call`, or the transcript contains a do-not-call phrase.
*   **When**: The result is read by the ingest.
*   **Then**: The number's contact record becomes "Pending confirmation" at once, the gate refuses every later call, batch row and retry to that number on any card, and the card's retries stop. A to-do asks a person to confirm. Confirming writes the number to the register (`Voice_DND`, source "Candidate opted out"); undoing it clears the state, with a reason.

### CUJ 5: A gate refusal during a batch

*   **Given**: A batch is running at 18:58 and 25 rows are still `Waiting`.
*   **When**: The clock passes 19:00 during the run.
*   **Then**: The remaining rows become `Scheduled` with `Not_Before` at the next calling window. The batch does not stop and no row becomes `Failed`. One `Blocked` log row per card records "Outside hours" once.

### CUJ 6: The interviewer and MRF owner are told a result is ready (Release 3)

*   **Given**: A recruiter has completed a screening that began as a voice call draft.
*   **When**: The recruiter presses *Prepare message for the interviewer* or *for the MRF owner*.
*   **Then**: The app shows a short message and the resolved addresses, and a Teams or e-mail link for the recruiter to send. The CRM sends nothing and records only that the message was prepared.

## Proposed Architecture

All changes are inside the existing Apps Script project. The provider, the separately deployed webhook receiver and the Sheets database stay as they are. New columns and sheets are created by the existing self-healing `voiceSchema_`, so the schema version number does not change. Functions marked (existing) are in `VoiceScreen.gs` today; the others are new.

### 1. One gate in front of every call

Every call already reaches the provider through `voiceStartFor_` (existing: single call, follow-up call, approved request and each batch row). The gate is two functions. `voiceMayCall_` reads the facts and decides under a lock. `voiceGateDecide_` is the pure core that takes the facts and returns the decision, so it can be tested without sheets in the style of `voiceQueuePick_` and `voiceStats_` (both existing). The gate runs before the call is logged as `Starting`. `VOICE_ENABLED` (existing, "Allow calls") remains in force: with it off, `voiceMissing_` (existing) stops every real call.

Checks, in this order, stopping at the first failure:

1.  **Hours.** `voiceInHours_` (existing) with the configured window, in India time. Applies to real calls from every path, at every placement and at the start of each queue run. Holidays are out of scope.
2.  **Opt-out.** The number's `Optout_State` in `Voice_Contacts` is "Pending confirmation" or "Confirmed". The check is read at placing time and is never cached from queueing time. The `VOICE_DND_REQUIRED` setting no longer affects real calls.
3.  **Per-number attempt cap.** Attempts to this number in the last 7 days are fewer than 3 (assumed; held as a constant), counted from `Voice_Contacts.Attempt_Times` on every path, independent of queue rows.
4.  **Daily limit and call-count caps.** The per-person daily limit (existing `voiceAccessEval_`, now counting `No answer` and `Busy`); a per-batch cap of 30 (existing) and a per-month cap `VOICE_MAX_CALLS_MONTH` (assumed 300). From Release 1b the rupee ceilings are checked here too (section 3).
5.  **One open call.** No `Starting` or `Started` call for the same card or the same number in the last 30 minutes.

**Concurrency.** The gate, the write of the reserve and the write of the `Starting` row run inside one `withLock_` (existing). The provider call happens afterwards, outside the lock. If a fact cannot be read the answer is "blocked: could not check" (fails closed).

**Refusals.** The gate returns `{ok:false, reason, kind}`. It does not throw. `kind` is `defer` (hours, a budget window, could not check, an open call) or `terminal` (opt-out, per-number cap reached, a hard stop). A refused call writes one `Voice_Calls` row with status `Blocked` and the reason in a new `Block_Reason` column, once per card and change of reason, not once per poll. Preview shows the gate's answer and never writes a row. The existing `voiceRequireCaller_` (access, edit rights on the position) still runs before the gate and throws as it does today.

**What happens to a queue row.**

| Gate answer | Queue row becomes | Counts toward "three failed in a row" |
|---|---|---|
| allow | `Placed` | no |
| `defer` | `Scheduled`, `Not_Before` = next calling window or a 15-minute backoff | no |
| `terminal` | `Stopped`, `Stop_Reason` = the reason | no |
| provider or placement error | `Failed` | yes (existing rule) |

A `Scheduled` row older than 48 hours becomes `Stopped` with reason "retry window ended". The "three failed in a row" rule (existing `voiceQueueTrailingFails_`, which reads `Voice_Queue.Status`) counts only provider and placement failures, so gate refusals cannot trip the stop with a misleading "check the key" message.

**One input for "must this number be called?"** The new sheet `Voice_Contacts` holds one row per normalised 10-digit number: `Number_Key`, `Optout_State` (blank, Pending confirmation, Confirmed), `Attempt_Times` (the last five attempt timestamps), `Last_Outcome`, `Updated_At`. The gate reads only this record for opt-out and attempt counts. `Voice_DND` (existing) stays as the human-readable register: `voiceDndAdd_` and the removal function (existing) also update `Voice_Contacts`, and an Admin button rebuilds `Voice_Contacts` from `Voice_DND` and `Voice_Calls` if they drift.

```text
 card / batch row / retry
          |
          v
   voiceRequireCaller_ (existing: access, edit rights)
          |
          v
   voiceMayCall_ --lock--> voiceGateDecide_ (pure core)
          |                      |
          | ok:false, kind       | ok:true
          v                      v
   Voice_Calls row (Blocked,     voiceLog_ (Starting, reserve set)
   Block_Reason); queue row            |
   Scheduled / Stopped                 v
                               provider outbound API ---> the call
                                                              |
   Voice_Inbox <--- webhook receiver (separate project) <-----+
          |
          v
   voiceIngest_ (30-minute job, and first step of every queue run)
          |
          v
   voiceApplyResult_ -> Voice_Calls: status, outcome, minutes,
   payload fields, ratings state; Voice_Contacts updated;
   retry decision on the queue row; reserve released
```

There is no override for opt-out. There is no override for hours either: the decision is that the Admin cannot place a late call by hand.

### 2. Unanswered calls get their own status

`voiceOutcome_` (existing) maps provider statuses: `connected`, `completed`, `partial` stay `Completed` (a `partial` call, where a candidate hangs up midway, is not retried and gets an incomplete draft); `no_answer` becomes `No answer`; `busy` becomes `Busy`; `failed` and any unknown value stay `Failed` with the raw text in the note. `Failed` then means a provider or placement error only.

**The status must reach the call row.** `voiceApplyResult_` (existing) today stores any status that is not `Failed` as `Completed`. It is changed to store the status it is given (`Completed`, `No answer`, `Busy`, `Failed`). Its "already has its result" check applies only to `Completed`, and its answers-draft branch runs only for `Completed`. `apiVoiceFetchResult` (existing, the manual fetch) maps the provider status through `voiceOutcome_`, stores the result status, and makes the same retry decision as ingest, so a fetched unanswered call is classified.

**One status class function.** A new `voiceStatusClass_(status)` returns one of: answered, unanswered, provider error, blocked, in progress. Every reader uses it, and an unknown status is logged loudly. Readers that change:

*   `voiceUsedToday_`: unanswered counts against the daily limit; provider error and blocked do not.
*   `voiceStats_`: separate buckets `unanswered` (no answer plus busy, shown as two figures), `failed` and `blocked`. The new key is named `unanswered` because the existing key `noAnswer` means "completed with no answers".
*   `voiceCallFlags_` and `voiceCallOut_` (existing): carry the new statuses.
*   The page's `VOICE_STATUS_CLASS_` (in `App.html`): `No answer` and `Busy` use the existing `miss` class; `Blocked` uses the neutral class.
*   `voiceCardSection` (in `App.html`) today shows the newest call of any status, so a newer blocked or unanswered row would hide *View result* and *Ask remaining questions*. It is changed to show the latest call that has a result, with a separate line for a newer blocked attempt.
*   The command center KPI "Failed, no answer or busy" and the CSV header (in `App.html`).
*   `apiVoiceFetchResult`, as above.

`voiceTaskRows_` and `voiceQueueTrailingFails_` do not read `Voice_Calls.Status` in a way that changes, and are not on this list.

Old rows hold test calls only, so there is no repair pass. The Admin clears the test rows by hand before the first real batch.

### 3. Spend control (Release 1b)

Release 1a bounds spend with call counts: 30 per batch and `VOICE_MAX_CALLS_MONTH` per month. Release 1b adds a rupee ceiling with a reserve before each call, after the first batch has shown real minutes per call.

*   **Unit and rules.** The unit is rupees. A blank ceiling means "no limit for that period" and the page shows "no limit". A rupee ceiling with no `VOICE_RATE_PER_MIN` blocks every call with "Set the cost per minute". "This month" is the calendar month in India time, counted from `Started_At`. The Admin is not exempt.
*   **Settings (existing: `VOICE_RATE_PER_MIN`).** New: `VOICE_BUDGET_MONTH`, `VOICE_BUDGET_BATCH`, `VOICE_MAX_CALL_MIN` (worst-case call length in minutes; it must equal the maximum call duration the Admin sets in the provider agent, which is a rollout precondition, so the reserve is a true bound).
*   **Reserve.** When a call is logged as `Starting` the gate writes `Voice_Calls.Reserved_Min` (planned minutes, capped at `VOICE_MAX_CALL_MIN`). Spent this month is real minutes (`Duration_Sec`) times the rate; reserved is `Reserved_Min` of calls with no result yet. The gate refuses a call when spent plus reserved plus this call's reserve would exceed the ceiling. A failed placement clears its reserve at once. A result replaces the reserve with real minutes.
*   **Batch.** `Voice_Calls.Batch_ID` (new) ties a call to its batch. The batch's spend is its calls' minutes times the rate, and a retry counts against the batch it came from. A single call skips the batch ceiling. The gate gets `opts.batchId` and the planned minutes as inputs.
*   **Monthly counter.** A new sheet `Voice_Budget` holds one row per month (`Month`, `Spent_Min`, `Reserved_Min`), updated by the gate and ingest, so the gate does not read the large call log. An Admin button rebuilds it from `Voice_Calls`.
*   **Lost webhooks.** A sweep turns a reserve with no result for more than `VOICE_MAX_CALL_MIN` plus 60 minutes into "presumed spent" until a person closes the call (a new *Close* action sets the existing status `Cancelled`), so a lost result never loosens the ceiling. The sweep runs from `voiceQueueJob` and from `refreshDashboardJob` (existing), so it runs with no batch open.
*   **Rate.** The price used is the higher of the configured rate and the effective rate the Admin derives from an invoice (two manual fields on the Admin page below). The command center shows spent, reserved and the ceiling labelled "estimate". Unanswered rings that the provider bills are outside the minutes (Q8).

### 4. Retry on the queue (Release 2)

Retry state lives on `Voice_Queue` rows. The columns `Not_Before` and `Stop_Reason` and the status `Scheduled` already exist from Release 1a (refused rows use them). Release 2 adds `Attempts`.

*   **Constants.** 3 attempts in total including the first; after `No answer` retry in 4 hours, after `Busy` in 30 minutes, and each retry is moved to the next calling window, to 11:00 if 11:00 is inside the window and otherwise the window start; Sundays are excluded. These are code constants, not a setting.
*   **Attempts.** `Attempts` is incremented when a call is placed. Ingest finds the queue row by the call's `Batch_ID` and card.
*   **Rule.** When a result arrives as `No answer` or `Busy`, ingest sets the row to `Scheduled` with `Not_Before`, or to `Stopped` with "no answer after 3 attempts" and creates the to-do. A pure function `voiceRetryNext_(row, status, now, hours)` decides. No retry follows `not_interested`, `wrong_number`, `do_not_call`, a completed call, or a terminal refusal. `callback_requested` creates a to-do; no call is scheduled until the agent reliably returns the time the candidate gave.
*   **Pick.** `voiceQueuePick_` (existing) picks `Waiting` rows and `Scheduled` rows whose `Not_Before` has passed, oldest first, one per number. A row-to-number map built once per batch from candidate records (queue rows carry no phone, and `Candidate_ID` is written empty today) is passed in, so one number cannot be called twice in a run.
*   **Duplicates.** A `Scheduled` row counts as open for duplicate checks, so the same card or number is refused or skipped in a second batch with the reason "already queued". It does not count as an open batch for the existing rule "one open batch per person", so the owner can start another batch while retries wait.
*   **System principal.** Retries are placed as a named `system` principal and do not use the recruiter's daily limit. The per-number attempt cap still applies.
*   **Stopping.** `apiVoiceBatchStop` (existing) also stops `Scheduled` rows.
*   **Trigger.** The one-minute trigger runs only while `Waiting` or `Calling` rows exist. While only `Scheduled` rows remain, a one-shot trigger is armed for the earliest `Not_Before` and re-armed after each run. The rule lives in `voiceQueueTrigger_` (existing, which today takes only on or off) and `voiceQueueJob` (existing) together.
*   **Ingest first.** `voiceQueueJob` runs ingest first, as the same synthetic Admin user `refreshDashboardJob` uses, because ingest skips calls the user may not review.
*   **Stale `Calling` rows.** A reaper at the start of each run takes each `Calling` row older than 5 minutes (claim time from the row's `Updated_At`) and looks for a `Voice_Calls` row for the same card started since the claim with status `Starting`, `Started` or `Completed`. If one exists the row becomes `Placed`. If none, the row becomes `Failed` with "Run ended before the call was placed; check the provider". It never sets `Waiting`, because the call may already have been placed.

### 5. Opt-out spoken during a call (Release 1a)

*   The agent's post-call analysis gains a `do_not_call` disposition, separate from `not_interested` ("not interested in this job"). This is a change in the provider's workspace, made and tested by the Admin, and is a rollout precondition.
*   A deterministic phrase scan of the transcript is a second signal and raises the same state if the disposition is missing or wrong. The phrase list covers the languages in use; language switching stays parked.
*   Work happens in `voiceIngestRun_` (existing), run as a named system user. `voiceDispositionAction_` (existing) stays a pure label map: it gains `do_not_call` with key `optout` (task `voice_optout`) and a key `noanswer` for retry exhaustion (task `voice_noanswer`).
*   On a `do_not_call`, ingest sets `Voice_Contacts.Optout_State` to "Pending confirmation" for the number (the full number comes from the card's candidate record, because the call row keeps only four digits), stops the card's retries, and the to-do asks a person to confirm.
*   Confirming writes the number to `Voice_DND` through `voiceDndAdd_` (existing) and sets "Confirmed". Undoing clears the state with a reason. Undo is Admin-only until the owner decides (Q3). Undoing does not restart retries.

### 6. What the first batch must capture (Release 1a)

*   The full provider payload stays in `Voice_Inbox.Payload` (existing). Each call row gets `Inbox_Key` (new, the inbox row's key), `Payload_Keys` (new: the field names of the payload, including nested names under the agent's variables), and `Ratings_State` (new: `present`, `empty` or `absent`), all written by ingest.
*   The existing reader `voiceVars_` drops object values and caps each at 4,000 characters, so an object-valued `screening_ratings` is lost. If a real payload shows ratings arriving as an object, `voiceVars_` is extended to read it. Until then it is unchanged, and `Ratings_State` records that the field was empty or absent, so the loss is counted, not hidden.
*   `voiceStats_` reports `Ratings_State` counts and median minutes per answered call.
*   The Admin enters a baseline of recruiter minutes per manual screening (Admin page below) before the pilot.
*   Payloads over 45,000 characters lose trailing transcript entries first, then are cut at the limit (the receiver already does this), so a cell never exceeds the 50,000-character limit.

### 7. Sharing a result with the interviewer and MRF owner (Release 3)

The CRM sends nothing. It prepares a message and the recruiter sends it.

*   `apiVoiceShareDraft(callId, who)`, `who` being `interviewer` or `mrf_owner`. Allowed only for a user who can review the card, and only when the screening is complete. It uses the latest completed screening of the card. It returns `{text, links, missing}`: `text` is the message body, `links` is an object with a Teams link and an e-mail link, `missing` is a list of names that have no address.
*   **Content**, built by the pure function `voiceShareBuild_`:

| Part | Interviewer | MRF owner |
|---|---|---|
| Candidate and position, card link | yes | yes |
| Outcome | yes | yes |
| Answers the recruiter confirmed | yes | no |
| Flags (the labels `voiceRowFlags_` and `voiceCallFlags_` produce) | yes | no |
| Counts | no | questions answered and not answered |
| Transcript, recording link, phone number, the agent's suggested ratings | never | never |

*   **Recipients.** Interviewer: the names in the position's `Tech_Panel` are split on commas and semicolons and each is looked up through `panelEmailIndex_` and `panelKey_` (existing in `Tasks.gs`). MRF owner: no field holds who raised the MRF, so until the owner decides (Q4) the message goes to the department head, `M_Departments.HOD_Email` through `hodOf_` (existing in `Pipeline.gs`), labelled as such. The recruiter sees every resolved address, and a name matched by approximate spelling is marked, before sending.
*   **Non-users.** The card link opens the app, which needs a `Users` row. For a recipient without one, the message text carries the confirmed answers in full. This is a deliberate trade-off: it is the same kind of exposure as the rejected e-mailed transcript, with a smaller payload, and the audit records "prepared", not "sent".
*   An audit row "Result message prepared" records the card, call and recipient role, with no message body.

### 8. Admin page: screening time baseline and invoice

A new section in Admin → Voice agent holds two manual lists, both stored in new sheet `Voice_Admin_Notes`: (a) *Screening time baseline* (date, recruiter, minutes for one manual screening call) and (b) *Provider invoice* (month, minutes, amount in rupees, from which the effective rate is shown beside the configured rate). The completion measure reports "recruiter minutes per completed screening" against the baseline mean.

### 9. Data model changes

| Where | Change | Release |
|---|---|---|
| `Voice_Calls` | Status values `No answer`, `Busy`, `Blocked` (replaces `Blocked (Do Not Disturb)` for new rows; old rows keep their value); columns `Block_Reason`, `Inbox_Key`, `Payload_Keys`, `Ratings_State` | 1a |
| `Voice_Calls` | Columns `Reserved_Min`, `Batch_ID` | 1b |
| `Voice_Queue` | Status value `Scheduled`; columns `Not_Before`, `Stop_Reason` (replaces `Reason` for stops) | 1a |
| `Voice_Queue` | Column `Attempts` | 2 |
| `Voice_Contacts` (new sheet) | `Number_Key`, `Optout_State`, `Attempt_Times`, `Last_Outcome`, `Updated_At` | 1a |
| `Voice_Budget` (new sheet) | `Month`, `Spent_Min`, `Reserved_Min` | 1b |
| `Voice_Admin_Notes` (new sheet) | baseline and invoice entries | 1b |
| `Voice_Inbox` | Column `Error_Count` | 1a |
| `Settings` | `VOICE_MAX_CALLS_MONTH` (1a); `VOICE_BUDGET_MONTH`, `VOICE_BUDGET_BATCH`, `VOICE_MAX_CALL_MIN` (1b) | as shown |
| Tasks (`Tasks.gs`) | Rules `voice_optout` (1a), `voice_noanswer` (2) | as shown |
| Agent (provider workspace) | `do_not_call` disposition; a maximum call duration; ratings output confirmed on a real call | 1a, 1b |

All additions are created by `voiceSchema_` and read as blank for old rows ("first attempt", "no reservation").

### 10. Rollout, preconditions and rollback

*   **Preconditions for any real batch** (owner of each is the Admin):
    1.  A call-site audit: a code search lists every place that calls the provider's API, and the result is recorded in the release notes. Every call must reach it through `voiceStartFor_`.
    2.  One test call to a team-owned number that confirms whether the provider retries on its own and whether it honours our hours (Q8), and shows the raw payload, including the shape of `screening_ratings`.
    3.  The `do_not_call` disposition added to the agent and tested.
    4.  The old test rows in `Voice_Calls` cleared by hand.
    5.  The webhook receiver's secret rotated (the receiver itself is not changed by this design).
    6.  A maximum call duration set in the agent, before Release 1b.
*   **Order:** Release 1a, then the first real batch of 5 to 10 candidates for one position with the Admin alongside and retry not yet built, then Release 1b when the owner has the numbers behind Q1 and Q5, then Release 2, then Release 3. Stopping after any release leaves its limits in force, and no earlier limit depends on a later release. The exceptions: Release 1b needs the real minutes the first batch shows; Release 2 needs Release 1a's contact record and statuses.
*   **Rollback is by roll-forward.** If the gate has a defect, set `VOICE_ENABLED` to No (the existing kill switch), stop all batches including `Scheduled` rows (`apiVoiceBatchStop`), remove the trigger, fix, redeploy. A rollback build, if unavoidable, must keep the hours and opt-out checks. Calls already placed cannot be recalled. Old code ignores the new columns and would read `No answer` as an unknown status.
*   The receiver stores the payload as it arrives, so a change in payload shape (for example ratings as an object) needs the CRM reader to ship first.

## Risks & Mitigations

| Risk | Effect | Mitigation | Owner |
|---|---|---|---|
| Two executions pass the gate at once | Double call; ceiling overshoot | Gate, reserve and `Starting` write run in one `withLock_`; E2E case T3 | Engineer |
| A refused queue row has no defined outcome | Rows drained to `Failed` or logged every minute | Defer or terminal handling and one block row per change (section 1) | Engineer |
| A missed reader of `Status` | Unanswered calls counted as answered, silently | `voiceStatusClass_`, reader list in section 2, one test per reader (T9) | Engineer |
| Spoken opt-out missed or misclassified | A person is called again | Provisional state at once, phrase scan as a second signal, number-keyed record | Engineer, Admin |
| A pending opt-out wrongly blocks a number | Candidate not reached | The to-do asks a person to confirm or undo; undo is logged | Recruiter, Admin |
| Provider retries on its own or ignores our hours | Hard limits are not hard | Preconditions 1 and 2; Q8 | Admin |
| Reserve is not a true bound | Ceiling exceeded | Maximum call duration set in the agent; unresolved reserves become "presumed spent" | Admin |
| Rate is wrong or unset | Ceiling wrong | Rupee ceiling with no rate blocks calls; higher of configured and invoice rate; manual invoice entry | Admin |
| Apps Script limits: the 6-minute run cap and daily trigger runtime | A run is cut off; triggers stop | One-minute trigger only while rows are `Waiting` or `Calling`, one-shot trigger otherwise; 4-minute loop budget (existing); the gate reads small sheets (`Voice_Contacts`, `Voice_Budget`), not `Voice_Calls`; the reaper threshold of 5 minutes sits under the run cap | Engineer |
| Sheet and cell growth | Cells over 50,000 characters; slow reads | Payload truncation (section 6); the large call log is read only by stats and rebuilds | Engineer |
| Candidate data in sheets and in prepared messages | Exposure beyond the app's access control | Messages exclude transcript, recording, phone and ratings; the non-user trade-off is stated (section 7); Q7 retention | Owner, HR and legal |
| Webhook secret leaks, or a payload is forged or replayed | A forged row is processed | Ingest requires a matching call id or attempt id, so a forged row cannot change an unrelated call; opt-out state comes only from an ingest of a matched call; secret rotated before the first batch | Admin |
| Consent to automated and recorded calls | Legal exposure | Q6, decided by HR and legal; not changed by this design | HR and legal |
| Apps Script mail quota (Release 3 only if mail is sent by a person, not by the CRM) | None for the CRM, which sends nothing | The CRM sends no mail in this design | n/a |
| Setting changes alter a hard limit | A limit is loosened | Outer bounds compiled in (hours 08:00 to 21:00, rupee ceiling at most 10,000,000, `VOICE_MAX_CALL_MIN` at most 30); before and after values stored in the audit row | Engineer |
| The gate fails closed and blocks every call | No calls placed | The block reason is shown on the card and in the command center; `VOICE_ENABLED` and the gate's cause are visible to the Admin | Admin |

## Alternatives Considered

The first six come from [`concepts_brief.md`](../../concepts_brief.md). The rest are options not chosen while this design was drafted, or added after review.

### Not chosen: a configurable call-type framework now

Reminders, offer follow-ups and joining check-ins would be data rows with their own agent, outcomes and actions. It would be designed from one working example. Each new type needs its own agent in the provider, and the screening code (plan desk, answer parser, review dialog, disposition map) cannot be reused by calls that have no questions. One later call type is chosen after the first real batch and passes through the same gate.

### Not chosen: a spend cap on the provider's cost figure

No cost field was seen in the payloads inspected, so there is nothing to cap on until a real payload shows one. A cap on recorded minutes alone overshoots, because results can arrive up to 30 minutes after the call (up to 30 minutes for a single call; during a queue run ingest now runs first).

### Not chosen: e-mailing the transcript or recording to the interviewer and MRF owner

It copies candidate data out of the app's access control with no way to take it back and no audit, and the recipients may not be CRM users.

### Not chosen: resetting a stuck `Calling` queue row to `Waiting`

The call may already have been placed, which would call the candidate twice. The reaper checks `Voice_Calls` and marks the row `Placed` or `Failed`.

### Deferred: a WhatsApp or SMS nudge in place of redialling

The app has no candidate messaging today. Revisit if the first batch's answer rate is below 30 percent.

### Deferred: automatic retry before the first real batch

Nobody has seen a real answer rate, and retry spends money. Retry is Release 2, after the first batch.

### Not chosen: a separate `Voice_Attempts` sheet for retry state

A separate record per card (attempts used, maximum, earliest next time, stop reason) with the queue left as a plain list. Retry state is on `Voice_Queue` columns instead: it reuses the queue and trigger and is the smaller change. The separate sheet's advantage, a cap that holds across batches, is provided another way: the per-number attempt cap in the gate (from `Voice_Contacts`) holds on every path, including single calls, and does not depend on open queue rows. What the chosen option gives up is an independent attempt record: retries across several days keep rows alive, which the `Scheduled` status and the 48-hour window manage.

### Not chosen: deriving retry state from `Voice_Calls`

Count a card's earlier calls and read the last outcome from existing rows. Every read of `Voice_Calls` is large, because rows carry transcripts, and a callback or time-of-day rotation needs a future time that cannot be stored.

### Not chosen: a second `Outcome_Class` column for unanswered calls

A new column beside `Status` leaves two fields describing one call, and a path that writes only one leaves them inconsistent. New `Status` values are used; the cost is that every reader changes, handled by `voiceStatusClass_`.

### Not chosen: matching the existing `Outcome` text for unanswered calls

It misses any provider status string the mapping does not know, and breaks silently if the wording changes.

### Not chosen: an outbox sheet with link-only mail for result sharing

An outbox drained by a trigger would send reliably, with a log and a daily ceiling. It fails when the recipient is not a CRM user or is matched by approximate spelling, and a used-up mail quota would silence the failure alert. A prepared message the recruiter sends adds no mail path, quota or access boundary, and a person sees each message before it leaves. It cannot guarantee delivery.

### Not chosen: to-dos for in-app users only for result sharing

No e-mail at all and the access rules unchanged, but most interviewers and MRF owners are not CRM users, so most results would reach nobody.

### Not chosen: checking only recorded spend

A batch can overshoot by every call placed during the result lag. The reserve avoids this.

### Not chosen: a call-count cap with a provider-side limit in place of a rupee ceiling

Release 1a uses call-count caps for the first batch. A count alone does not follow call length, and a provider-side limit depends on the provider offering one. The rupee ceiling with a reserve follows from Release 1b; its cost is a rate that someone must set and check against the invoice.

### Not chosen: enforcing hours and opt-out in the provider instead of the CRM

The provider's campaign windows and its own Do Not Disturb list cannot be read by the CRM and do not cover calls placed from a card. The CRM gate is needed in any case. Provider limits stay a backstop where offered.

### Not chosen: an Admin override for calling hours

The decision is that there is none, so a late call cannot be placed by hand. Revisit if a business case appears.

### Not chosen: a `Raised_By` field on the MRF now

It would remove the department head stand-in but changes MRF entry for every user. Deferred to Q4.

### Not chosen: a recruiter "Call again" to-do instead of automatic retry

After a no-answer the recruiter gets a to-do and a *Call again* button on the card, which goes through the already-gated single-call path. It needs no scheduler, extra state or trigger rule, and fits "a person always decides". Automatic retry was chosen because batches are meant to run without a recruiter at the screen. Revisit if the first batch shows retry is rarely useful.

## Detailed Implementation

This is the list of repository changes, by file and release. The provider workspace changes and the manual Admin steps are under Rollout in the Architecture. Names in `code style` are new or changed functions, columns and settings. Behaviour is described once, in the Architecture; here each item says what changes and why.

### Delivery order

Four releases, each with its own pull request, `BUILD_ID` increase (currently '159'; targets 160 to 163 in order 1a, 1b, 2, 3), tests and document updates.

### `VoiceScreen.gs`

Release 1a:
*   `voiceMayCall_`, `voiceGateDecide_` (new): the gate (Architecture 1). Signature: facts in (now, hours text, contact record, attempts, limits and caps, open calls), `{ok, reason, kind}` out.
*   `voiceStartFor_`: call the gate after `voiceRequireCaller_` and before `voiceLog_`; the gate, the reserve write and the `Starting` log run in one `withLock_`; the opt-out check no longer depends on `dndRequired`; preview shows the gate's answer and writes nothing; write `Batch_ID` when called from the queue.
*   `voiceLog_`: accept the reserve (Release 1b) and `Block_Reason`.
*   `VOICE_STATUSES_`: add `No answer`, `Busy`, `Blocked`. `voiceStatusClass_` (new): the class map.
*   `voiceOutcome_`: new mapping (Architecture 2).
*   `voiceApplyResult_`: store the status it is given; keep the "already has its result" check for `Completed` only; answers draft only for `Completed`.
*   `apiVoiceFetchResult`: map through `voiceOutcome_`, store the status, run the retry decision (Release 2) and the opt-out scan.
*   `voiceUsedToday_`, `voiceStats_`, `voiceCallFlags_`, `voiceCallOut_`: use `voiceStatusClass_`. `voiceStats_` keeps its five-argument form for the date window and gains `unanswered` buckets, `Ratings_State` counts and median minutes; `apiVoiceStats` passes monthly figures and screenings as new inputs. A new `apiVoiceHealth` returns the oldest unprocessed inbox row age and the queue depth for the command center.
*   `voiceIngestRun_`: write `Inbox_Key`, `Payload_Keys`, `Ratings_State`; do the opt-out work (Architecture 5) as a named system user; count errors in `Voice_Inbox.Error_Count` and, after 3 failures, stamp the row with the error for an Admin to see (a failed write is no longer stamped as processed on the first error).
*   `voiceDispositionAction_`: add `do_not_call` (key `optout`) and `noanswer`. It stays a pure label map.
*   `voiceFindCost_`: accept a number only under a key containing `cost`, `price` or `amount` with a sibling key naming a currency (`currency` or `unit`), and ignore keys containing `balance`, `pending` or `credit`.
*   `voiceDndAdd_` and the register removal function: also update `Voice_Contacts`. `voiceContactsRebuild_` (new): rebuild from `Voice_DND` and `Voice_Calls`, with an Admin button.
*   `voiceSchema_`: new columns and sheets for Release 1a (Data model); an extra-column list and an `addColumns_` call for `Voice_Queue`, because `VOICE_QUEUE_.cols` is used only when the sheet is created.
*   `voiceCfg_`, `voiceCfgOut_`, `apiVoiceConfigSave`: add `VOICE_MAX_CALLS_MONTH` (whole number 1 to 5,000; error "Enter a whole number from 1 to 5,000"); `voiceCfgOut_` returns an explicit field list, so it must include every new setting; every new setting keeps its previous value when omitted (the existing rate is reset to 0 when omitted and is fixed the same way); `VOICE_DND_REQUIRED` is removed from the page and from the real-call path; store before and after values for the new settings in the audit row; outer bounds compiled in (hours 08:00 to 21:00).
*   `voiceQueueJob`: ingest first as the synthetic Admin user; the reaper; the hours check at the start of the run stays as an early exit and each placement is also checked; gate refusals set the queue row per Architecture 1; `voiceQueueTrigger_` and `voiceQueueJob` together hold the trigger rule (Architecture 4, minute trigger while `Waiting` or `Calling`, one-shot otherwise).
*   `voiceQueueReap_` (new): the reaper.
*   `voiceBatchCheck_`, `apiVoiceBatchPreview`, `apiVoiceBatchStart`: read the facts once per batch, build the row-to-number map, skip a card with the reason "already queued" when an open row for the card or number exists, and show the gate's reason per card.
*   `apiVoiceBatches`: count `Scheduled` rows separately from `open`.
*   `voiceQueueStopReason_` (existing): keep matching the limit and access texts; gate refusals no longer go through it.

Release 1b:
*   `voiceBudgetCheck_` (new, pure), `voiceBudgetSweep_` (new), `voiceBudgetRebuild_` (new): the reserve, the sweep to "presumed spent", and the monthly counter rebuild. A *Close* action for a call with no result (sets `Cancelled`). The reserve is written by `voiceLog_` and cleared by ingest, by a failed placement and by the sweep.
*   `voiceCfg_`, `voiceCfgOut_`, `apiVoiceConfigSave`: add `VOICE_BUDGET_MONTH`, `VOICE_BUDGET_BATCH` (rupees, at most 10,000,000; blank means no limit) and `VOICE_MAX_CALL_MIN` (whole number 1 to 30).
*   `apiVoiceStats`: spent, reserved and ceiling labelled "estimate".
*   The Admin baseline and invoice lists (`Voice_Admin_Notes`) and the functions to save and read them.
*   Call `voiceBudgetSweep_` from `refreshDashboardJob` (see `Dashboard.gs`).

Release 2:
*   `voiceRetryNext_` (new, pure): the retry decision (Architecture 4).
*   `voiceIngestRun_` and `apiVoiceFetchResult`: call it after recording a result.
*   `voiceQueuePick_`: picks `Waiting` and due `Scheduled` rows with the row-to-number map passed in; existing test V6 changes with it.
*   `apiVoiceBatchStop`: also stops `Scheduled` rows.
*   `voiceSchema_`: the `Attempts` column.

Release 3:
*   `apiVoiceShareDraft`, `voiceShareBuild_`, `voiceShareRecipients_` (new): Architecture 7.

### `Tasks.gs`

*   `TASK_RULES_DEFAULT_`: add `voice_optout` (1a: "Candidate asked not to be called: confirm", due 0, no critical time, not counted as missed, policy text "a person confirms or undoes the opt-out") and `voice_noanswer` (2: "Voice screening: no answer after the last attempt", same shape). Both are switchable in Admin → Task rules.
*   `voiceTaskRows_`: Release 2 takes the queue rows as a second input so a card whose retries ended without an answer produces the `noanswer` to-do; today it reads only completed calls with variables. Release 1a adds the `optout` row from `Voice_Contacts`.
*   `allTasks_`: the stamp list adds `Voice_Calls`, `Voice_Queue` and `Voice_Contacts`, so these to-dos do not lag by up to 10 minutes.

### `App.html`

*   Release 1a: `voicePreviewDialog` and the card's call area show "Outside calling hours" and the gate's reason as refusals; `VOICE_STATUS_CLASS_` and `voiceCardSection` (Architecture 2); `voiceBatchDialog` shows the per-batch and per-month caps, the gate's reason per card and "already queued"; `renderVoiceAdmin` shows the new setting and no longer shows the Do Not Disturb setting, and has a pending-opt-out list with *Confirm* and *Undo*; `voiceCommand` shows the unanswered buckets, ratings state, blocked calls by reason, the inbox age and queue depth, and the CSV header.
*   Release 1b: `voiceCommand` shows spent, reserved and the ceiling; `renderVoiceAdmin` has the ceiling settings and the baseline and invoice section; a *Close* button for a call with no result.
*   Release 2: `voiceBatchDialog` shows `Scheduled` rows with the next attempt time.
*   Release 3: `voiceResultDialog` shows *Prepare message for the interviewer* and *for the MRF owner* when the screening is complete, the returned text, a copy button, the links, and the missing-address lines.
*   The page script must not contain `//` or `/* */` comments (ADR-010 in the SSOT).

### `Styles.html`

*   Release 1a: no new classes. `No answer` and `Busy` use the existing `miss` class and `Blocked` uses the neutral text class (`App.html` `VOICE_STATUS_CLASS_`).

### `Dashboard.gs`

*   Release 1b: `refreshDashboardJob` calls `voiceBudgetSweep_`, so reserves are released when no batch is open. The 30-minute ingest call stays as the fallback when no batch is running.

### `Config.gs`

*   `BUILD_ID`: raised in every release's pull request (project rule, SSOT section 12.5).

### `Compliance.gs`

*   No change. `voiceSchema_` is already a step of `ensureSchema_`, and the schema version stays at 47. The new columns and sheets are created lazily by `voiceSchema_`, which nearly every voice function calls.

### `E2E.gs`

*   Update V4 (`voiceStats_`, five-argument call) and V6 (`voiceQueuePick_`, old signature). Add the cases in the table below.

### Documents

*   `EGM.md` (root): Global Invariants (hours, opt-out and the per-number cap are enforced in one gate with no override; no wrong rejection is structural) and the `VoiceScreen.gs` entry.
*   `docs/BFCL_Recruitment_CRM_SSOT.md`: section 8.7 (gate, statuses, opt-out state, retry, budget, share message, settings), section 12.2 (new keys), section 5 (new columns and sheets), section 10.4 (two task rules), section 13 (one ADR each for the gate and unanswered-call statuses, the reserve, retry on the queue, the opt-out state, and the share message), section 14 (a changelog entry per release).

### Testing

Cases run from the editor with `e2eTest()` and, for the pure functions, directly. `T` ids are assumed to follow V6 in `E2E.gs` as V7 onward.

| Id | Setup | Action | Expected |
|---|---|---|---|
| T1 | Window 09:00 to 19:00 | Gate at 08:59, 09:00, 18:59, 19:00, and Saturday 18:59 then Sunday 09:00 | Refused, allowed, allowed, refused, allowed, refused (`defer`) |
| T2 | A batch run starts at 18:58 with 3 rows | Clock passes 19:00 after the first | First row `Placed`; the others `Scheduled` with `Not_Before` at 09:00 next window; none `Failed`; one `Blocked` row per card |
| T3 | Two attempts on one card at once | Both call the gate | One allowed, one refused "open call" |
| T4 | A number with `Optout_State` Pending confirmation | A single call, a batch row and a retry, each from a different card | All refused `terminal`; same with the old `VOICE_DND_REQUIRED` set to No |
| T5 | A `do_not_call` result, and a transcript phrase with no disposition | Ingest | Contact record "Pending confirmation"; card retries stop; `voice_optout` to-do; undo by the Admin clears it |
| T6 | A provider result `no_answer` | Ingest, and the manual fetch | Call stored as `No answer`, not `Completed`; counts against the daily limit; fetch makes the same retry decision |
| T7 | Number with 3 attempts in 7 days | Single call from a new card | Refused `terminal` (per-number cap) |
| T8 | A queue row `Calling` older than 5 minutes, with and without a `Starting` call row for the card | Reaper | `Placed` with a call row; `Failed` without; never `Waiting`; a `Blocked` or `Failed` call row does not count as placed |
| T9 | One call of each status | Every reader of `voiceStatusClass_` (limit, stats, flags, card section, task rows, chips) | Each class read correctly; an unknown status is logged and not counted as answered |
| T10 | Payload with `screening_ratings` empty, object, and absent | Ingest | `Ratings_State` `empty`, `present`, `absent`; `Payload_Keys` lists nested names; payload over 45,000 characters is cut to the limit |
| T11 | Release 1b: reserve, ceiling | Ceiling equals spent plus reserved plus one call | Call at equality allowed, next refused; failed placement clears its reserve; sweep turns a stale reserve into presumed spent; blank ceiling means no limit; ceiling with no rate blocks |
| T12 | Settings | Save a value outside a range, and omit a setting | Error with the stated message; omitted settings keep their value; before and after values appear in the audit row |
| T13 | Release 2: `Attempts` at 3 and at 2; `Not_Before` now and one minute ahead | Pick and retry decision | Attempt 3 `Stopped` with the to-do; due row picked, future row not; `callback_requested`, `not_interested` and `wrong_number` never retried |
| T14 | Release 3: a completed screening | Share message for each role | Interviewer text has answers and flags; MRF owner text has counts; neither has transcript, phone or ratings; missing addresses listed |

Also: a code search for `'Failed'` and `'Completed'` in `VoiceScreen.gs`, `Tasks.gs` and `App.html` lists the readers checked in T9; there is no test command in the repository, so the deploy check is still a syntax gate. Release steps end with a visual check of the changed screens at 375 px width in the light and dark themes, with no text clipped.
