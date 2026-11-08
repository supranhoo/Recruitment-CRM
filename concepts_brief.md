# Sarvam voice screening: first real batch, retries, result sharing and later call types

* **Author:** Claude
* **Date:** 2026-11-08

## Overview

The CRM can already place Sarvam voice calls to candidates, one at a time from a candidate's card or as a batch of up to 30 from a position's board. Calls only produce a draft screening. A person completes it. Nobody has used this on real candidates yet.

The owner wants three things, in this order:

1. Make the first real batch work. That means a rule for candidates who do not answer, suggested ratings that actually come back, and a cost figure that actually comes back.
2. Send the relevant call result to the technical interviewer and to the person who raised the MRF.
3. Later, add other calls (interview reminders, offer follow-ups, joining-date check-ins) in a structured, configurable way.

Problems to remove: recruiter time, candidates who do not answer, uneven answer quality, and recruiters skipping required questions. Success is the share of calls that end in a completed screening, and minutes saved per hire. Hard limits: no calls outside calling hours, none to anyone who opted out, no wrong rejection (a person always decides), and no spend above a budget.

## Analysis

Seven reviewers read the concept against the code (design, codebase details, zoom out, comprehension, implementation readiness, structural, inventive catalyst). Code claims below were checked against `VoiceScreen.gs` by the author of this brief where marked "checked".

### The four hard limits are not all in place

1. **Calling hours apply only to batches (checked).** `voiceInHours_` is called in the batch preview and in `voiceQueueJob`. The single-call path, `voiceStartFor_`, never checks it, so a person with call access can place a call at night or on a Sunday. The batch job also checks hours once at the start of a run, not between the calls in that run.
2. **Opt-out is partly in place, and it can be switched off.** The Do Not Disturb register is checked before a call, but the Admin setting `VOICE_DND_REQUIRED` turns the check off for real calls (the batch preview still checks). The audit log records the setting's name, not its value, so nobody can later tell whether the check was off during a batch. A candidate who tells the agent "stop calling me" comes back as `not_interested`, which only creates a to-do (checked: nothing writes the number to the register). A retry would call that person again. Matching is on one 10-digit mobile number, so a second number or a corrected number bypasses it.
3. **There is no budget.** The only brake is a per-person count of calls per day. Cost is recorded minutes times an optional rate, labelled an estimate, because the provider sends no cost field. Minutes arrive only with the result, which the system reads up to 30 minutes later, so any cap checked against recorded spend overshoots by that lag. Whether the provider bills unanswered rings is unknown.
4. **"A person decides" holds today** because calls only write drafts and dispositions only create to-dos. It stays true only if retries, mail and ratings never move a stage, reject, or message a candidate.

### Unanswered calls are not recorded as a separate kind of result (checked)

`voiceOutcome_` maps no-answer, busy and failed all to status `Failed`; only the `Outcome` text differs. Three consequences:

- A retry rule cannot tell "rang out" from "the provider rejected the call".
- The per-person daily limit excludes `Failed` calls, so an unanswered call stops counting against the limit when its result arrives. Retries would be free against the limit.
- The command center's success rate falls with every unanswered attempt, which makes it a poor measure of the agent.

There is also no attempt count, next-attempt time or reason on the queue rows. The queue's pick function accepts a list of numbers already called, but the batch job always passes an empty list (checked), so the same number can be called again in a later batch.

### The success measure is not the measure the owner wants (checked in part)

The command center counts a call as a success when it has parsed answers, divided by calls placed. A completed screening needs a recruiter to finish the draft. "Minutes saved per hire" has no data behind it: there is no recorded baseline of recruiter minutes per screening, and review time may take a large share of the saving.

### Ratings and cost cannot be fixed from the CRM alone

- On agent version 6 the post-call `screening_ratings` came back as an empty object, and the provider's simulated chats do not run the post-call step. The first real call is the first real test. The CRM's variable reader also drops any value that is an object (checked: `typeof v !== 'object'`), so a filled object would still be lost. What shape the agent returns has to be seen in one real payload first.
- The provider sends no cost. Cost is minutes times a rate someone sets from the contract or invoice.
- A suggested rating shown to a reviewer, or forwarded to an interviewer, pulls their judgement toward it. The "kept" percentage measures acceptance, not accuracy.

### Sharing results by e-mail crosses the access boundary

- Today a call result is visible to people who may open the candidate in the app. E-mail copies candidate data outside that control, with no revocation and no audit.
- The CRM sends mail only to Admins (weekly summary, job-failure alert). There is no outbox, template store, send log or quota check. Apps Script mail has a daily quota, and a quota used up by result mail would silence the failure alert.
- The technical interviewer is a name in free text on the MRF line (`Tech_Panel`) or on the scheduled interview, matched by name to `M_Panel_Members.Email`. A fuzzy match can pick the wrong person, and a missing address is dropped without a message. No field on the MRF names who raised it (the nearest data is the department head's name and e-mail). Neither person is necessarily a CRM user, so a link into the app may not open for them.
- Interviewers and MRF owners need different content. The MRF owner needs the outcome and counts. The interviewer needs the confirmed answers and flags.

### Other call types do not fit the screening code

The plan desk, agent variables, answer parser, review dialog, disposition map and to-do rules are all built for screening against questions. Reminders, offer follow-ups and joining check-ins have no question plan and no screening draft. Each needs its own agent in the provider. `VoiceScreen.gs` is already about 1,400 lines and mixes the provider client, settings, planning, parsing, the opt-out register, access, the queue, statistics and to-do rules. Offer follow-ups carry the most risk, because a wrong statement on the call can be read as a commitment. The opt-out register has no scope, so someone who refuses screening calls may still need an interview reminder, or may not.

### Smaller risks found

- A queue row set to `Calling` stays there if the run dies before the result is written (checked: only `Waiting` rows are picked). That row keeps the one-minute trigger alive and stops the owner starting another batch. Resetting it to `Waiting` risks a second call to a person who was already called.
- Results arrive by a 30-minute job, so retry timing and the 30-minute "call already in progress" guard overlap.
- The result receiver protects itself with a secret in the address only, runs as the deploying user with access to the whole spreadsheet, and de-duplicates against the last 200 inbox rows. Rotate the secret before real use.
- `voiceFindCost_` takes the first number under any key that looks like a cost, with no unit check. A field such as a credit balance would be recorded as a call's cost.
- Transcripts and recordings are personal data. No code records candidate consent to recording or to sharing it.
- There is no automated test for the queue or the limits. `e2eTest()` runs from the editor, and the deploy check is a syntax gate.

### Resolving the main conflicts (reviewers' proposals)

- **One gate for every call.** Move hours, the opt-out check, the daily limit, the budget and "one open call per candidate" into one function that single calls, batches, retries and any later call type must pass, and that stops with a named reason. Opt-out should not be switchable off. Hours should belong to the call type. Re-check opt-out at the moment of dialling, because a candidate can opt out between attempts.
- **Spend: reserve before dialling.** Check a monthly rupee ceiling and a per-batch ceiling against spent plus reserved, using planned minutes times a rate checked against the invoice. Count unanswered attempts. Warn at 80 percent, pause at 100 percent. The real hard cap should also exist at the provider if it offers prepaid credit or a workspace limit.
- **Retry: a small attempt record per candidate**, separate from the queue, holding attempts used, earliest next time and stop reason. Retry only after no-answer or busy, never after `not_interested`, `wrong_number` or an opt-out. A `callback_requested` schedules a call at the time the candidate gave, or becomes a recruiter to-do until the agent captures a reliable time. After the last attempt the card gets a to-do for the recruiter, never a rejection.
- **Opt-out from the call itself.** Add a separate "do not call again" disposition from `not_interested`, and let it write the register automatically with a person able to undo it.
- **Results to colleagues: a link plus a short summary, not the transcript,** sent only after a recruiter has completed the screening, through an outbox sheet with a send log, a daily ceiling and an Admin switch that starts off. Leave the agent's suggested ratings out, or label them "agent suggestion".
- **Call types as data.** A call type is a record: who it is for, the variables sent, the outcomes it can return, what each outcome does (from a fixed menu of safe actions such as create a to-do, flag a card, notify one person), hours and attempt rule. "Configurable" would mean that, and never a free-form rule that moves a stage or rejects.
- **Question-skip guard.** Show "required questions answered x of y" per call, and refuse to complete a screening with required questions unanswered. This addresses recruiters skipping questions without any new calling feature.
- **Measure the draft against a person.** Run the agent on a batch while a recruiter also screens a sample, and compare the two, to get an accuracy figure.

### Disagreement between reviewers

- **First later call type.** One reviewer favours a joining-date check-in (few rows, simple outcome, feeds a field the Head of HR already corrects). The others favour an interview reminder (no ratings, lowest harm if wrong). One notes a WhatsApp or SMS reminder may beat a voice call. No reviewer favours an offer follow-up first.
- **Retry first or batch first.** Two reviewers want the first real batch with no automatic retry and only a manual "Call again" selection. The inventive review proposes starting with a conservative automatic rule (3 attempts over 2 days at different times of day). The structural and implementation reviews agree that the safety gate comes before any retry.

## Goals vs. Non-Goals

* **In-Scope Goals:**
  - Put the four hard limits in one gate that every call passes.
  - Run a small first real batch and capture the facts it shows: answer rate, call length, whether ratings arrive and in what shape, and the cost basis.
  - Separate unanswered calls from failures, and define "completed screening" so the success rate means what the owner wants.
  - A retry rule, a spend ceiling, and spoken opt-out capture.
  - Result sharing with the technical interviewer and the MRF owner, after a recruiter completes the screening.
* **Out-of-Scope Non-Goals (for now):**
  - Any automatic stage move, rejection, or message to a candidate.
  - Free-form, user-defined call types.
  - Reminders, offer follow-ups and joining-date check-ins until one real batch has run (the first of these is chosen afterwards).
  - E-mailing transcripts, recordings or the agent's suggested ratings.
  - Language switching and a short question set for W and T levels (already parked).

## Alternatives Weighed

- **Rejected: a configurable call-type framework now.** Reason: it would be designed from one working example, each type needs its own agent in the provider, and the screening code cannot be reused by calls with no questions.
- **Rejected: a spend cap on the provider's cost figure.** Reason: the provider sends none. A cap on recorded minutes alone overshoots by the 30-minute lag, so the cap needs a reservation before dialling.
- **Rejected: mailing the call transcript or recording to the interviewer and MRF owner.** Reason: it leaves the access control, cannot be revoked, and may reach people who are not CRM users. A link plus a short summary after recruiter confirmation keeps the control.
- **Rejected: resetting stuck `Calling` rows to `Waiting`.** Reason: the call may already have been placed, which would call the candidate twice. Resolve the row by looking up the attempt at the provider.
- **Deferred: a WhatsApp or SMS nudge in place of redialling.** Reason: the app has no candidate messaging today. Worth testing if the first batch shows a low answer rate.
- **Deferred: automatic retry before the first batch.** Reason: nobody has seen a real answer rate, and retry spends money. Two of seven reviewers want a manual "Call again" first.

## Key Decisions & Staging for Next Steps

**Decisions still owed by the owner** (each blocks design; none can be read from the code):

1. **Budget:** unit (rupees, or minutes if no rupee figure exists), period (day, batch, month), who sets it, whether the Admin is exempt, and what happens at the limit (stop, or ask a lead).
2. **Retry rule:** which outcomes retry, how many attempts, the gap, time-of-day rotation, whether Sundays and holidays count, and what a person sees after the last attempt.
3. **Spoken opt-out:** whether "do not call me again" writes the register automatically or after a person confirms, and what the agent's prompt must say to tell it apart from "not interested in this job".
4. **Result sharing:** channel (to-do, link, e-mail), content (summary only, answers, ratings, recording), the source of the interviewer and MRF-raiser addresses, whether either gets a CRM login, and the Apps Script mail quota tier.
5. **"Completed screening":** the numerator for the success rate (recruiter completed the draft), and a baseline of recruiter minutes per screening, measured before the pilot.
6. **First later call type** and what "configurable" means. Reviewers' proposal: a record with a type name, agent id, variables, outcomes and a fixed menu of safe actions.

**Suggested order:**

1. **The gate.** One pre-call check for hours, a non-switchable opt-out check, daily limit, budget reservation and one open call per candidate. Count unanswered calls. Add the stale `Calling` row reaper. Add e2e cases for each hard limit. Rotate the receiver secret.
2. **One small real batch (about 5 to 10 candidates, one position, no automatic retry)** with a recruiter alongside. Capture the raw provider payload for each call. Learn the answer rate and the real minutes per call, whether ratings arrive and in what shape, and the cost basis. Time a few manual screenings for the baseline.
3. **Fix what the batch shows:** the agent's post-call prompt, the variable reader if ratings are an object, the rate setting, and the "do not call again" disposition.
4. **Retry as an attempt record** over the queue, then the spend ceiling's reconcile step.
5. **Result sharing** through an outbox, after recruiter confirmation, as two notice types (interviewer, MRF owner), with an audit row per send and an Admin switch that starts off.
6. **The second call type**, chosen from the first batch's numbers, defined as a data record through the same gate.

Next step: `/egm:egm-draft` ingests this file as its first intake source.
