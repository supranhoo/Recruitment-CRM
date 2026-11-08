# Stage 5: Initial Zoom Out Review (round 2, revised design)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md` (revised, 518 lines, whole file)
**Date:** 2026-11-08
**Reviewers:** `egm-zoom-out` (Zoom-Out Standard) and `egm-inventive-catalyst` (Mode: REVIEW). Each had only the document and was told not to read other files or any earlier report. Neither searched the code, so reuse claims (`voiceStatusClass_`, `voiceContactsRebuild_`, `voiceQueueReap_` and others) are unverified.
**Context sufficiency:** passes. The first round's reports are in git history; they are not used here.

**Kept as sound by the reviewers:** one gate with no override and fail-closed behaviour, distinct unanswered statuses, the reserve plus sweep, the reaper that never resets to `Waiting`, roll-forward rollback, and the number-keyed contact record. The catalyst reviewer found no false compromise in the foundational architecture.

## Blockers

### Z-B1. Consent and AI disclosure (Q6) is undecided and is not a rollout precondition (zoom-out)

*Sections: Open Questions Q6, Rollout preconditions, Risks.*
Q6 says it blocks Release 1a, with the assumed default "not decided; the existing agent script is not changed". The six preconditions for any real batch do not include consent or disclosure. As written, the design permits the first real call to a candidate with no legal decision.
**Fix:** add a numbered precondition "HR and legal have decided Q6 in writing"; say what the first batch may do if disclosure is required (a script change in the provider workspace); make Q6 and Q3 explicit go or no-go items.

### Z-B2. The document commits to a detailed design for four releases when only Release 1a is justified by evidence (zoom-out)

*Sections: Overview, Architecture 3, 4, 7, 8, Delivery order, Alternatives "Deferred: automatic retry".*
The Overview says nobody has used voice screening on candidates and the Problem Statement says no figures exist. Releases 1b, 2 and 3 depend on numbers the first batch will produce (minutes per call, answer rate, ratings shape, billing basis). The document defers retry "because nobody has seen a real answer rate" and then specifies retry constants, columns, triggers, a reaper and tests in full, and assigns build numbers 160 to 163. This is speculative design and it hides the part that is needed.
**Fix:** scope the design to Release 1a (gate, unanswered statuses, spoken opt-out, call-count caps, payload capture). Replace Architecture 3, 4, 7 and 8 with a short "Follow-ups decided after the pilot" section: the trigger condition (the Q5 thresholds) and a paragraph of direction each. Write the full design when the data exists.

## Major

### Z-M1. A second source of truth for opt-out, accepted as drift (catalyst 1; zoom-out M1)

`Voice_DND` stays the human-readable register while the gate reads only `Voice_Contacts`; drift is answered with an Admin rebuild button. A number added to `Voice_DND` by any path that does not go through `voiceDndAdd_` (a hand edit, an import) is invisible to the gate, so the check the design calls non-overridable fails open. The zoom-out reviewer adds that `Voice_Contacts` and `Voice_Budget` are premature at a call cap of 300 a month, when `Voice_Calls` is small and no read problem has been measured.
**Options offered:** make `Voice_Contacts` the only store and render `Voice_DND` as a view; or have the gate also read `Voice_DND` (a small sheet) and fail closed on a mismatch; or, for 1a, keep opt-out state as a status column on `Voice_DND` and count attempts from `Voice_Calls` over 7 days, and add a derived index only if a measured read time forces it.

### Z-M2. Spend control is heavy for a pilot (zoom-out M2)

Reserve, sweep to "presumed spent", a monthly counter sheet, an invoice-derived rate, a *Close* action and a compiled-in cap on call length. The 1a call-count caps already bound spend. If a maximum call duration is a rollout precondition anyway, a ceiling of calls times maximum minutes times rate is a one-line check with no reserve or sweep.
**Fix:** start 1b with that bound; add the reserve only if the pilot shows it is too loose.

### Z-M3. Retry is more complex than needed, and the document names the simpler option (zoom-out M3)

A recruiter to-do with a *Call again* button needs no scheduler, trigger rule, system principal or `Attempts` column, and fits "a person always decides". It was rejected because "batches are meant to run without a recruiter at the screen", a preference, not evidence.
**Fix:** choose the to-do and button for the first pass; adopt automatic retry only if the pilot shows retries are wanted and the manual route is a bottleneck.

### Z-M4. The per-number cap contradicts "a person decides" (zoom-out M4)

After 3 attempts the recruiter gets a to-do and is meant to decide. The per-number cap (3 attempts in 7 days) then refuses any further call to that number as `terminal`, including a manual call from the card, for up to 7 days; the "Call again" alternative would be refused by the same gate. Nothing says the recruiter can override.
**Fix:** say whether the cap blocks manual calls. If not, apply it to automated and retry calls only. If it should, change the to-do wording so the recruiter is told the number is locked.

### Z-M5. Release assignment is inconsistent between sections (zoom-out M5; catalyst nit)

The baseline and invoice page (`Voice_Admin_Notes`) is a Release 1b item, but the baseline is needed "before the pilot", the first batch after 1a, so that batch cannot report the recruiter-minutes measure. `Batch_ID` is a 1b column but is written from the queue in 1a. Q8 says it blocks 1a for "retry and hours", though retry is Release 2. The test table has retry cases in 1a.
**Fix:** reconcile each item into one release. The simplest fix for the baseline is an ordinary document kept by the owner, not a sheet.

### Z-M6. Altitude: Detailed Implementation and the test table are code-level (zoom-out M6)

They list function signatures, argument names, per-function column lists, validation message text, CSS class choices and a 375 px check, and restate behaviour from the Architecture (the `voiceFindCost_` key rules, the reaper rule, the trigger rule). Three sections describe the retry trigger. A fresh reader cannot tell the decision from the code plan.
**Fix:** move the file list and test table into a separate implementation plan or the pull request; keep decisions, interfaces, data flow and test intent in a few lines each.

### Z-M7. Release 3 (sharing) is weakly motivated (zoom-out M7)

The only evidence is one sentence. It needs fuzzy name matching, a department-head stand-in for the "MRF owner", and a message carrying answers to people who may have no login, which the document calls "the same kind of exposure as the rejected e-mailed transcript". Q4 asks about the mail quota though the CRM sends no mail.
**Fix:** remove it from this design, or reduce it to a copy-text button with the card link for users with access; revisit on request.

### Z-M8. Reuse is asserted, not evidenced (zoom-out M8)

Many new functions are proposed and only a few are marked existing. For each new function, add "searched for X, found Y, reason not reused", or drop it.

### Z-M9. Reserve correctness depends on a manual cross-system setting (catalyst 2)

`VOICE_MAX_CALL_MIN` "must equal" the provider agent's maximum duration. That is a promise, not a mechanism. **Fix:** when ingest sees a call whose `Duration_Sec` exceeds `VOICE_MAX_CALL_MIN`, raise a visible Admin alert and either block calls until acknowledged or raise the reserve to the observed maximum. Cost: a stricter gate that can block calls that would have fit; one overshooting call can still happen.

### Z-M10. Three overlapping attempt counters with two different 3s (catalyst 3)

`Voice_Contacts.Attempt_Times` (per number, last five), `Voice_Queue.Attempts` (per row) and the "three failed in a row" count. A retried row can stop as "per-number cap" while its own `Attempts` is below 3, and the to-do text still says "after 3 attempts".
**Fix:** make `Attempt_Times` the single counter and derive the row's attempt number from it (or keep the row column for display only); name the two constants differently; state the precedence (per-number cap is the hard stop, per-row count is the schedule); make the to-do text follow the real stop reason. Cost: the window keeps only five timestamps, so history older than 7 days is lost, and a rebuild must reproduce timestamps exactly.

### Z-M11. The fail-closed gate has no degraded mode (catalyst 4)

Behaviour on a lock timeout is not stated, nor how long the lock is held. A systemic fault looks the same as ordinary refusals.
**Fix:** a lock timeout defers with a 15-minute backoff, not terminal; state the maximum lock-hold time; a command-center counter alerts the Admin when "could not check" refusals pass a small number in a run.

### Z-M12. The result lag is treated as a general law (catalyst 5)

Results can arrive up to 30 minutes late; ingest-first helps queue runs but single calls and the reserve release still wait. A reserve can hold budget for a worst-case call plus 60 minutes, a large pessimistic window for a small first-batch budget.
**Options:** have the receiver trigger ingest (the document says the receiver is not changed, so say so and name the lag as a constraint, not a law), or poll faster only while a call is in flight (uses the daily trigger-runtime budget).

### Z-M13. Opt-out depends on a manual provider change the CRM cannot verify (catalyst 6)

The `do_not_call` disposition is a hand change in the provider workspace and the phrase scan is a heuristic; a missed opt-out is the highest-harm outcome. **Fix:** also hold any call that ended very short with no answers captured, and any `not_interested`, from retry pending a person's look (costs a few retries, never a wrong call); make the precondition test an executable check where the Admin runs a scripted test call and the CRM records that a `do_not_call` was seen.

### Z-M14. Retry decision at two call sites (catalyst 8)

Ingest and manual fetch both call `voiceRetryNext_`. If the same call is recorded by both, the "already has its result" check covers only `Completed`, so an unanswered result could be applied twice and write the to-do or retry state twice. **Fix:** make `voiceApplyResult_` idempotent for every status with a result-applied marker, and keep the retry decision inside it so there is one call site.

### Z-M15. The 48-hour expiry and Sundays interact badly (catalyst 9)

A Saturday 18:00 no answer retries Monday 11:00, about 41 hours. A Saturday busy then no-answer chain can exceed 48 hours and stop with "retry window ended" instead of "no answer after 3 attempts". **Fix:** set the expiry in working time, or give the two stops different to-do text.

## Nits

*   Z-N1. Review-process residue: "revised after the egm-review findings" (status line) and "added after review" (Alternatives intro) mean nothing to a new reader; remove or move to a changelog.
*   Z-N2. Line 344's sentence repeats itself ("up to 30 minutes after the call (up to 30 minutes for a single call; during a queue run ingest now runs first)"). Say: results arrive up to 30 minutes after a call; ingest now runs first in each queue run.
*   Z-N3. Q5 sets "answer rate above 30 percent" on a batch of 5 to 10, which is too small to mean much. State a minimum number of calls or call the threshold indicative.
*   Z-N4. Opt-out confirmation: undo is Admin-only, but nothing names who confirms a pending opt-out or how long it may stay pending (catalyst: add an age indicator and a daily reminder to the pending list).
*   Z-N5. Risk table padding: the mail quota row ("None for the CRM") and the "setting changes alter a hard limit" row add length without a decision.
*   Z-N6. The Problem Statement should carry the key facts from the SSOT and the brief itself so the document stands alone.
*   Z-N7. Q8's assumed default ("not billed; no provider retry; ratings unknown") assumes the good case for a hard-limit question. Make the 1a default "assume billed and retried until the test call shows otherwise" (catalyst 10).
*   Z-N8. `Voice_Admin_Notes` is a 1b sheet but the baseline is needed in 1a; the batch ceiling should be stated as conditional on `batchId`; confirm `voiceStatusClass_` maps the legacy `Blocked (Do Not Disturb)` value to "blocked"; make explicit that only the phone mapping is cached, never the opt-out state (CUJ 4 relies on this) (catalyst 12).
*   Z-N9. A scan test for raw status string literals outside `voiceStatusClass_` is a cheaper guard than a manual code search; it is brittle to formatting and the repository has no test runner (catalyst 7).

## Conflicts between the two reviewers

The zoom-out reviewer wants the design cut to Release 1a and the contact and budget sheets, the reserve, retry and sharing removed or deferred (Z-B2, M1, M2, M3, M7). The catalyst reviewer accepts the design's scope and asks for more hardening (a single opt-out store, the observed-maximum guard, a single attempt counter, a lock-timeout rule, a push or faster poll, a conservative hold, an idempotency marker, working-time expiry). These cannot both be done in full: each hardening item adds mechanism to the parts the other reviewer wants removed. The owner decides the scope first.

## Summary

Both reviewers find the core of Release 1a sound. The zoom-out reviewer's verdict is that the document fails the Zoom-Out Standard on simplicity and altitude and on one go or no-go gap (consent). The catalyst reviewer finds no false compromise in the foundation and lists residual duplication, manual preconditions and unaddressed degraded modes.
