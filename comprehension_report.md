## What this proposes

The document proposes hardening the existing Sarvam voice-screening feature of the Recruitment CRM before and just after its first real use. One gate function, `voiceMayCall_`, would sit in front of every call (single, batch and retry). It would check calling hours, opt-out, daily limit, budget and "one open call", in that order, stopping at the first failure, and it would log a named reason when it blocks a call. Unanswered calls would get their own statuses (`No answer`, `Busy`). Spend would be capped by a monthly and a per-batch ceiling, using a reserve before each call and real minutes after. A first batch of about 5 to 10 candidates would run with retries off so the owner can learn the real answer rate, call length, whether suggested ratings arrive and the billing basis. Afterwards, retry state would live on `Voice_Queue` rows, a spoken "do not call me again" (`do_not_call`) would feed the opt-out register, and a completed screening could be turned into a prepared message (Teams or e-mail link) that the recruiter sends to the technical interviewer and the MRF owner. The CRM itself sends nothing. A person always decides. Delivery is in four releases.

## How the existing system works, per this document

The CRM is a Google Apps Script web app over Google Sheets. A recruiter or Admin-named person can call one candidate from a card, or queue up to 30 candidates from a position's board. Calls go through `voiceStartFor_` to the provider's outbound API. A separate webhook receiver stores results in `Voice_Inbox`, and a 30-minute job turns them into `Voice_Calls` rows. A draft screening is produced, and a person completes it. Today, calling hours are checked only for batches. The opt-out check can be switched off by the Admin setting `VOICE_DND_REQUIRED`. A spoken "do not call me again" is recorded as "not interested". No answer, busy and failed placement all become `Failed`. Unanswered calls stop counting against a per-person daily limit once the result arrives. There is no spend limit. The provider sends no cost, and the suggested ratings came back as an empty object. E-mail goes only to Admins. The interviewer is free text on the MRF line, and no field records who raised the MRF. A one-minute queue job places batch calls.

My paraphrase of every section succeeded. I found no section I could not paraphrase, so I have no Blockers. The findings below are places where the parts do not connect or where the reader is left guessing.

## Findings

(Stage 6, Comprehension Test. Reviewer: `egm-comprehension`, a fresh reader given only the document. Ranges: FeatureRange lines 1 to 283, DetailedRange lines 284 to 406 of `docs/designs/voice-screening-gate-retry-sharing.md`.)

### Major

**1. The stages and releases disagree, and the opening promises "an outbox" that the design rejects.**
- Scope: lines 15-18, 35, 224, 288-295.
- Line 35 describes three stages: gate plus first batch, then retry and a spend ceiling together, then result sharing "through a controlled outbox". The Technical Plan (section 9) gives three steps after the gate, and the Detailed Implementation gives four releases.
- The spend ceiling and reserve are in Release 1, not alongside retry.
- Spoken opt-out (Release 3) appears in neither line 35 nor section 9.
- The "controlled outbox" is exactly the option rejected at lines 276-278. Overview item 4 also says "Send the relevant result", whereas the chosen design only prepares a message.
- A fresh reader cannot tell what ships when, or what "each stage is safe to stop after" refers to.

**2. Opt-out is a stated hard limit, but the fix arrives late and is off by default, and the "confirm" step is never delivered.**
- Scope: Goals line 41, CUJ 4, section 5, Release 3, section 9 rollout order.
- Goal 3 says a candidate who says "do not call me again" is added to the register. CUJ 4 says "No later call, batch or retry reaches that number". Both are unconditional.
- The plan makes the register write conditional on `VOICE_OPTOUT_AUTO`, which "starts off". Otherwise only a to-do "confirm" appears.
- Nothing describes what confirming does or which function adds the number to the register. Only undo is described.
- Release 3 is after the first real batch and after retry. Until then, the exact problem in the Problem section stays live: a do-not-call candidate is recorded as "not interested" and is not registered.
- Section 9 omits this release from its order entirely.

**3. A blocked call must be logged with a named reason, but only two blocked statuses exist.**
- Scope: Goals line 39, CUJ 1, data model table (lines 213-218), `voiceMayCall_` return value (line 302), `voiceStats_` (line 308).
- The data model defines only `Blocked (Outside hours)` and `Blocked (Budget)`.
- The gate also blocks for opt-out, daily limit, open call and "could not check". The stats screen promises "calls blocked by reason (hours, opt-out, budget, limit)".
- The document never says what status or note those other blocks carry, or how the stats are derived.
- It also never says what happens to a queue row whose call is blocked. Line 178 says a retry is never made after a `Blocked` result, so a retry blocked by budget would apparently stop for good. That is not stated as intent.

**4. The success rate is defined two different ways.**
- Scope: Goals line 46 versus section 2 (line 154) and line 308.
- The Goals define the success rate as the share of placed calls that end in a person-completed screening.
- The plan says the success rate "keeps its definition" (calls with answers over calls placed) and adds a second figure for completed screenings. The reader cannot tell which is "the success rate".

**5. Several things the Technical Plan promises have no home in the Detailed Implementation, which calls itself "the single list of everything that changes".**
- **Weekly invoice reconciliation (line 170).** The Admin enters invoice minutes and amount, and the effective rate is shown beside the configured one. No setting, function, sheet or screen is listed.
- **The baseline of recruiter minutes per screening (line 199, Goal line 46).** There is no storage or entry screen. The plan says "settings or a small table" without choosing. Nothing computes "minutes saved per hire", and "per hire" is never tied to any data.
- **`voiceQueueTrailingFails_`, the batch stop rule, and `voiceTaskRows_` status display (lines 155-156).** These are named readers of `Status` in the plan but absent from the file list. Only the generic "search for `'Failed'`" covers them.
- **The `callback_requested` to-do (line 178).** It is unclear whether this exists today or is new. It is not listed.
- **The `voiceVars_` change (line 198).** It is conditional, but its absence from the list is not noted.
- **Audit of before-and-after values for the new settings (line 405).** The Risks section calls it "worth making", but no file entry delivers it.

**6. Tests promised in the plan are not delivered in the detail.**
- Scope: lines 159, 231-233, 366-367, 403.
- Line 159 says "an e2e case covers each reader" of `Status`, and line 403 calls the "per-reader tests" the only guard.
- The listed E2E cases cover only the daily-limit reader. There is no case for `voiceStats_` buckets, the "three Failed in a row" stop rule (including that a run of `No answer` does not stop a batch), task rows or chips.
- The pure-function tests omit `voiceStats_`.
- Line 366 says case names are "V7 to V14", which is 8 names, but about 10 cases are listed.

**7. The budget unit and fallback are contradictory.**
- Scope: line 163 versus line 310.
- The plan says it assumes rupees and "falls back to minutes if the owner has no rate".
- The detail says a rupee ceiling with no rate blocks the call with "Set the cost per minute".
- No setting says which unit is in force, and the Admin screen has only "unit labels".
- "Planned minutes" for the reserve (line 165) and the definition of "this month" (calendar month, timezone, which date counts) are also undefined.

**8. The per-batch ceiling cannot be traced to data.**
- Scope: lines 167, 302, 308, 311.
- The gate's listed facts include "ceilings" but no per-batch spent or reserved minutes.
- Nothing says how a call is tied to its batch, for example a batch id on `Voice_Calls` or the queue row.
- It is also unstated whether retries count toward the original batch's ceiling.

**9. The budget sweep may not run when it is needed.**
- Scope: lines 168, 182, 314.
- The sweep clears reserves for lost webhooks "so a lost webhook cannot hold budget for ever". It lives in `voiceQueueJob`.
- That job's trigger stays installed only while queue rows exist. Single-call reserves would sit and block the monthly ceiling until the next batch runs.
- The `voiceQueueJob` entry (line 312) also does not list the sweep. It appears only in release step 5.

**10. The retry rule is not precisely specified.**
- Scope: lines 177, 320.
- The `VOICE_RETRY_PLAN` example, "busy 30m, no answer 4h, then next day 11:00", mixes outcome-keyed and attempt-keyed entries. Its format is not defined, though settings are "validated".
- It is not stated when `Attempts` is incremented, or whether the first call counts toward `Max_Attempts` (default 3).
- Retries exist only for queue rows. It is unclear whether an unanswered single call from a card is retried, although the Goals say "a candidate who did not answer is retried".
- The Alternatives claim a cap "across batches" (line 266). That holds only while a row is still open. After a row is `Stopped`, the same card can be queued again, apparently with fresh attempts.
- "Daily limit" is "per person". It is unclear whether that is the caller, the candidate or the queue's owner, so it is unclear how it applies to retries placed by the trigger.

**11. Where the raw payload is stored is unclear.**
- Scope: lines 84, 196, `Final_Vars_JSON`.
- CUJ 2 says the raw payload is kept on every call. Section 6 says `Final_Vars_JSON` keeps it but "already holds scalar variables". The detail adds only `Payload_Keys`.
- It is unclear whether the full payload is retained, or only scalars plus key names, and where. This is the main learning goal of the first batch.

**12. Project-specific terms are used without definition.**
- Scope: throughout. This is the main self-containment gap, so a new reader cannot follow the sharing half of the design.
- **MRF** is never expanded, and "MRF line", "MRF owner" and "raised the MRF" are never explained.
- Other undefined terms:
  - "card", "position", "line" (used interchangeably with position and MRF line), "Tech_Panel"
  - "command center", "plan desk", "answer parser", "review dialog", "disposition map"
  - "W and T levels (already parked)"
  - "the owner" versus "Admin" roles
  - `Voice_DND`, `Voice_Inbox`
  - `Status` versus `Outcome` versus "disposition". Their relationship to provider statuses is never given, yet the repair pass keys on `Outcome`.
  - "concepts brief", "root contract", "ADR-010", "SSOT 12.5", `./EGM.md`
- The brief and the EGM file are cited as sources with no link or summary.
- Sarvam appears once, then is only "the provider".

**13. "No override" contradicts the Admin's ability to change settings.**
- Scope: lines 145, 405 versus Goal line 40.
- The doc says there is no hours override, but the Admin can edit the hours window and the ceilings. Line 405 admits this. The Goal "No call is placed outside calling hours" is therefore only as strong as that setting.
- Default hours and timezone are shown only inside a CUJ message (09:00 to 19:00, Monday to Saturday).

### Nit

**14. Names and content differ between the plan, CUJ 5 and the detail.**
- CUJ 5 lists the same content for both recipients, while the plan and detail give the MRF owner "outcome and counts only". "Counts" of what is undefined.
- The plan says interviewers are looked up from `Tech_Panel` "or the scheduled interview's panel". The detail mentions only the line's technical panel.
- CUJ 5 says the change log records "message prepared". The plan and detail say "audit row".
- The ingest function is `voiceIngest_` in the diagram and `voiceQueueJob`, but `voiceIngestRun_` in the detail.
- The goals promise the interviewer and MRF owner "learn" a result is ready. Delivery depends on a person, as the final risk admits. The MRF owner is substituted with the department head until decided.

**15. Detailed Implementation items appear with no earlier rationale.**
- These are the ingest error-retry (stop stamping `Processed_At`, mark after 3 failures), the `voiceFindCost_` hardening against credit-balance and pending-charge keys, and the command-center "oldest unprocessed inbox row age and queue depth".
- None appears in the Problem, Goals or Technical Plan, and `voiceFindCost_` is never introduced.

**16. Smaller items.**
- Line 20 promises other call types are "sketched here". Only one paragraph in the Alternatives mentions them.
- "Creates new sheets" (line 106) is used although no new sheet is decided. The baseline table is undecided.
- There are no go or no-go thresholds for moving from the first batch to Release 2.
- The daily-limit number is never given.
- The Overview says batches can have up to 30 candidates, while the CUJ and release steps use 10 and 5 to 10. This is probably fine but is not explained.
- The "30 minutes" open-call window and the "5 minutes" reaper threshold are both undefined against the 8-minute call and 30-minute result lag.
