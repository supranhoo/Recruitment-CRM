# Stage 5: Initial Zoom Out Review

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md` (406 lines, whole file)
**Date:** 2026-11-08
**Reviewers:** `egm-zoom-out` (Zoom-Out Standard) and `egm-inventive-catalyst` (Mode: REVIEW). Both were given no context beyond the document and were told not to read other files.

**Limits of this review.** Neither reviewer read the code, so neither checked a claim that something "already exists" (`voiceDndAdd_`, `panelEmailIndex_`, `voiceAccessEval_`, `voiceQueuePick_`, the `HOD_Email` master). Reuse findings are judged from the text only. The zoom-out reviewer passed the document on context sufficiency (the objective and the why are clear).

**What both reviewers say to keep.** The fail-closed decision core for the gate, reserving spend before a call, never putting a `Calling` row back to `Waiting`, retry off for the first batch, no automatic stage moves or messages to candidates, no transcripts in messages, and four small releases that can each be stopped after.

## Blockers

### B1. The first real batch goes out with the opt-out hole still open (both reviewers)

*Sections: Goals, CUJ 4, Technical Plan section 5, Delivery order.*

The Problem names the defect: "do not call me again" is filed as "not interested", and the next batch calls the number again. Goals promise the number is added to the opt-out register, and CUJ 4 says no later call reaches it. The plan does the opposite in the first batch:

- The agent's `do_not_call` disposition ships in Release 3, after the first batch (Release 1) and after retry (Release 2). Until then the phrase is still filed as "not interested".
- `VOICE_OPTOUT_AUTO` starts off. With it off, nothing is written to `Voice_DND`. The plan stops retries for the card only, so any other position's batch, or a single call from another card, still rings the number.

The catalyst reviewer calls "write the register automatically versus wait for a person" a false either/or. Proposed fix, from both: write a provisional register entry at once, status "Pending confirmation", and have the gate treat it as an opt-out. A person confirms or undoes it with a reason, so the human decision corrects the default and does not gate it. Match on the number, not the card. Move the `do_not_call` disposition, the provisional entry and its to-do into Release 1 (the provider-prompt change is an Admin task that can run in parallel). Until the agent has the disposition, add a deterministic phrase scan of the transcript as a second signal, or require the recruiter to review every `not_interested` call during the pilot.

### B2. The design does not say what happens to a queue row the gate refuses (catalyst reviewer)

*Sections: 1, 4.*

The gate can refuse at queue-run time for hours, daily limit, budget, an open call, or "could not check". The plan says what is logged on `Voice_Calls`. It does not say what becomes of the `Voice_Queue` row:

- If the row stays `Waiting`, the one-minute trigger writes a new `Blocked` row into the call log every minute. A batch cut off at 19:00 would log 25 blocks a minute until 09:00.
- If the row becomes `Failed`, the "three failures in a row" stop fires on policy refusals, which are not provider errors.
- If a refusal counts as a `Blocked` result, Section 4's "never retry after a `Blocked` result" combined with "fail closed on any unreadable fact" means one transient sheet read error ends that candidate's retries for good.

Proposed fix: classify refusals as defer (hours, a budget window, could not check, an open call: row `Scheduled` with `Not_Before` at the next window or a short backoff, no new log row per attempt) or terminal (opt-out, hard limits: row `Stopped` with a reason). Log one `Blocked` row per row per change of reason, not per poll. Give deferred rows the same 48-hour expiry.

## Major

### M1. The gate has a check-then-act race (both reviewers)

The gate reads open calls, reserved minutes and the daily count, and `voiceLog_` writes the `Starting` row afterwards. A recruiter click and the one-minute job can both pass "one open call" and the budget check for the same card or the same last rupees. No lock is mentioned. Fix: take the script lock around gate, reserve write and `Starting` log, with the provider call after it and outside the lock. Or write the `Starting` row first and re-validate. Add an E2E case.

### M2. The budget reserve is not the bound it is described as (catalyst) and is built too early (zoom-out)

*Section 3.*

- `VOICE_MAX_CALL_MIN` is called a worst-case length but defaults to the existing 8-minute warning, which is not a cap. A longer call exceeds its reserve.
- The sweep clears `Reserved_Min` after the maximum plus 60 minutes if no result arrives. A call that was billed but whose webhook was lost then drops out of both spent and reserved. The ceiling loosens silently, which is fail-open and contradicts the fail-closed statement.
- Billed unanswered rings and per-minute rounding are outside the estimate. The invoice reconciliation is manual and only displayed.
- The zoom-out reviewer adds that the whole mechanism (reserve column, two ceilings, a max-minutes setting, a sweep, reconciliation, a "set the cost per minute" block) is built before anyone has seen a real call, on a rate nobody has set, with a first batch of 5 to 10 candidates. A cap on call count per month and per batch, multiplied by a maximum call length, bounds spend with no reserve lifecycle. The Alternatives section rejects a count cap because it "does not follow call length", and a count times a maximum length does.

Proposed: enforce a maximum call duration in the provider agent so the reserve is a true bound; turn an unresolved reserve into "presumed spent" at its reserve value until a person closes it; price at the higher of the configured and invoice-derived rate; keep a provider prepaid limit as a backstop. Or, as the simpler option, defer real-minute budgeting until the first batch shows the billing basis.

### M3. No per-candidate contact cap that holds on every path (catalyst)

The daily limit counts calls per caller. Attempts live on the queue row. A single call from a card, or a second batch started after the first row is `Stopped`, starts again from zero. The Alternatives claim that the cross-batch cap is "covered" holds only while a row is still open. System retries also consume the recruiter's daily limit, so a batch that uses it up stops retries, and under B2's present wording stops them for good. Fix: add a gate check on attempts to the number in the last N hours or days, independent of queue rows. Give system retries their own quota.

### M4. The gate's own reads contradict the design's reasoning about sheet size (catalyst)

The design rejects "derive retry state from `Voice_Calls`" because reads of that sheet are large (transcripts). The gate reads the same sheet on every call, inside batch loops and on every one-minute run, for used today, spent, reserved and open calls. A one-minute trigger also stays alive for up to 48 hours for `Scheduled` rows, and Apps Script has daily trigger-runtime quotas. Fix: a small ledger sheet (month spent and reserved, per-number attempts, open-call keys) updated by the gate and ingest and read instead of the large log; poll every minute only while `Waiting` or `Calling` rows exist and arm a one-shot trigger for the earliest `Not_Before` otherwise. The ledger needs a periodic rebuild.

### M5. Retry is designed in full before the first batch shows it is needed (zoom-out)

Four queue columns, a `Scheduled` status, a 48-hour window, trigger lifecycle rules, time-of-day rotation, and a free-text retry-plan setting with its own parser. The reviewer calls the free-text plan the speculative configurability the standard rejects: use constants (for example 3 attempts and one gap) until the answer rate is known. Alternatives omits the simplest option, a recruiter to-do after no answer with a "Call again" button on the card, which uses the already-gated single-call path and needs no scheduler or trigger change. At minimum, add it to Alternatives and say why automatic retry beats it.

### M6. Result sharing contradicts its own rejection reasoning and cannot meet its goal (both reviewers)

*Section 7, CUJ 5, Alternatives, Goals.*

- E-mailed transcripts were rejected because they copy candidate data outside the access control. The prepared message carries the confirmed answers in plain text, and for a recipient with no CRM account the recruiter pastes the answers in full. That is the same exposure with a less sensitive payload. Say so as a deliberate trade-off, or send a link plus a one-line status.
- The goal says the interviewer and MRF owner "learn that a result is ready". The design prepares text, records "prepared", and concedes it cannot guarantee delivery. Reword the goal as "prepares a message", or add a "Mark as sent" action with a reminder to-do after N hours.
- No MRF-raiser field exists, so the plan sends the outcome to the department head, who may be the wrong person. Either add a "raised by" field at MRF entry (department head as fallback for old rows) or cut the MRF-owner half until the owner decides. The catalyst also suggests an expiring tokenised read-only link for non-users and notes that Apps Script web apps do not natively authenticate non-Google identities.
- Show the recruiter each resolved address before sending, because names are matched fuzzily from free text.

### M7. Success measures conflict and the headline metric cannot be measured in a pilot (both reviewers)

- Goals define success as completed screenings over placed calls. Section 2 says the success rate "keeps its definition" (calls with answers over calls placed) and adds a second figure. One name has two definitions. Pick one and name the other differently.
- Counting per placed call means each retry lowers the rate. A per-candidate denominator is more meaningful. The numerator measures recruiter diligence, not voice quality.
- "Minutes saved per hire" cannot be computed from 5 to 10 candidates, since hires lag by weeks. The recruiter-minutes baseline, the metric itself and the invoice reconciliation appear in the Technical Plan but not in Detailed Implementation, which calls itself the single list of everything that changes. Add them as scoped items or mark them manual or out of scope. The catalyst proposes "minutes saved per completed screening" for the pilot.

### M8. The `Blocked` statuses do not match the gate (both reviewers)

The gate has five refusal reasons (hours, opt-out, limit, budget, open call, plus "could not check"). Only two `Blocked (...)` values are defined (Outside hours, Budget), yet `voiceStats_` reports blocked by hours, opt-out, budget and limit, and it is unstated where `voiceUsedToday_` treats "any Blocked". A row for every refused click also grows a sheet the document calls large. Fix: one `Blocked` status with the reason in a separate field, or list every value. Decide whether refused clicks should create rows at all.

### M9. Hard limits are editable settings (catalyst)

The goals say no call outside hours and opt-out cannot be switched off, but the hours window and all ceilings are Admin settings, and a bad value changes the limit. The audit stores the name, not the value. The document calls storing before and after "worth making" but leaves it out of Detailed Implementation. Fix: compile in an outer bound for hours (and sane maximums for ceilings and `VOICE_MAX_CALL_MIN`), let the setting only narrow within it, store before and after values, and put the audit change in Release 1. If the hours window comes from a regulation, it belongs here as a fixed bound.

### M10. The status change is a repeating cost, and the one-time repair is risky (both reviewers)

- Every reader of `Status` must change, guarded only by a code search and tests. It will recur when later call types add statuses, and the Release 1 file list already omits `voiceQueueTrailingFails_`, which Section 2 names. Fix: one `voiceStatusClass_` function mapping status to a class (answered, unanswered, provider error, blocked, in progress) used by every reader, with an unknown value logged loudly.
- The one-time repair (`voiceStatusRepair_`) rewrites old `Failed` rows. The document says nobody has used the feature on real candidates, so old rows are test calls. The repair is an irreversible rewrite with no backup, runs inside `voiceSchema_`, which runs on every schema ensure, and scans the large sheet unless a done marker exists. Fix: drop it (clear the test rows by hand), or keep the original status in a note column and add a run-once marker.

### M11. Spoken opt-out depends on one model classification (catalyst)

A candidate who says "do not call me again" but is classified as "not interested" is lost, which repeats the original bug. The transcript is already stored. Add a deterministic phrase scan as a second signal that raises the same provisional hold and to-do. Phrase lists must cover the languages used.

### M12. Rollback is weaker than described (catalyst)

Rolling back the gate re-opens the original holes (night calls, opt-out). The repair is one-way. Prefer roll-forward for the gate, or keep the old safety checks in any rollback build.

### M13. Altitude and internal consistency (zoom-out)

- The document is half design and half code index. Retry mitigations, the reaper, the share lookup, the status readers and the gate are each described twice, in the Technical Plan and again in Detailed Implementation, and the two have begun to drift. Detailed Implementation also lists function signatures and return shapes under the heading "no code here". Keep one description of each behaviour in the Technical Plan and reduce Detailed Implementation to a file and release checklist.
- The gate's pure core has two names, `voiceMayCall_` (line 120) and `voiceGateDecide_` (line 303). The Technical Plan names `voiceMayCall_` as the entry and `voiceGateDecide_` as the pure core in Detailed Implementation; settle the naming in one place.
- The Rollout section omits spoken opt-out (Release 3), which Delivery order includes.
- `voiceFindCost_` hardening and the ingest error-retry behaviour appear only in Detailed Implementation, tied to no goal. Give each a one-line reason or remove it.
- The "first later call type" Open Question and the configurable-call-type alternative keep a speculative future alive, though a non-goal already excludes it. Remove the question.
- Open Questions are not mapped to releases or owners. Add a table: question, release it blocks, decision owner, assumed default.

## Nits

- Overview lists "four hard limits" but the gate has five checks. "No wrong rejection" is enforced by a non-goal, not the gate. Make the lists agree.
- Three timeouts for one idea: a 5-minute reaper, a 30-minute open-call window, a `VOICE_MAX_CALL_MIN` plus 60-minute sweep. Derive them from one constant or explain.
- `VOICE_DND_REQUIRED` stays as a setting that only affects a preview warning. Remove it.
- The queue's `Failed` and the call's `Failed` mean different things. Use distinct names.
- Month boundary, time zone and holiday handling for the hours and "this month" are unstated. The gate knows only a weekday window. State the zone and say holidays are out of scope.
- "Flags" in the share message is undefined.
- Terms a newcomer cannot read: MRF, SSOT, ADR-010, "W and T levels", "plan desk", "command center", `Tech_Panel`, `HOD_Email`, "the concepts brief", and the distinction between "owner" (decides) and "Admin" (configures).
- "None" entries for `Dashboard.gs`, `Compliance.gs`, `README.md` and the receiver pad the file list. One line saying "no change" is enough.
- Mark each function in the Technical Plan `(existing)` or `(new)` so reuse can be checked quickly.
- No statement of how candidates were told about, or agreed to, an automated and possibly recorded call. The design only handles opt-out after the first call.
- A small Node harness could run the pure functions on every pull request, since there is no test command.
- Repeated "Rejected by author" boilerplate in Alternatives adds no information.

## Summary

Both reviewers find the document well motivated and the staged, stop-anywhere framing sound. They disagree on scope: the zoom-out reviewer wants the budget reserve, retry scheduler and MRF-owner sharing cut or deferred until the first batch produces numbers, while the catalyst reviewer wants them kept and hardened (a ledger, a lock, a deferral class, a provisional hold). Both agree on the first fix: move the opt-out protection into Release 1.
