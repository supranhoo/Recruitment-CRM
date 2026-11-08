# Stage 7: Critic Review (round 2, revised design)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md`, FeatureRange lines 1 to 409 (glossary through Alternatives)
**Date:** 2026-11-08
**Reviewers:** `egm-design` and `egm-structural` (both against `feature-spec-standard.md`) and `egm-style`. All three completed. Each had only the document.
**Round result:** not clean. The design and structural reviewers raise Blockers. Ids: `D` design, `S` structural, `Y` style, numbered as in each reviewer's report.

The structural reviewer confirmed that all five blueprint headings the standard names (Problem Statement, Goals & Non-Goals, Proposed Architecture, Alternatives Considered, Risks & Mitigations) are now present and correctly spelled, tables are well formed and no heading level is skipped. That fixes round one's missing-section and header-name findings.

## Blockers

### CR-B1. Release 1a creates `Scheduled` queue rows that nothing in 1a can pick up (D B1, S 1)

*Lines 153 to 162, 229, 234, 237 to 238, CUJ 5, data model rows 288 to 289.*
In 1a a gate `defer` turns a queue row into `Scheduled` with `Not_Before`; CUJ 5 relies on it. The behaviour that makes those rows run (`voiceQueuePick_` picking due `Scheduled` rows, the one-shot trigger, `apiVoiceBatchStop` stopping `Scheduled` rows, the "already queued" rule) is written under Release 2. Section 4 says the status and columns "already exist from Release 1a" but not that the behaviour is needed in 1a. In 1a the one-minute trigger runs only while `Waiting` or `Calling` rows exist, so after CUJ 5 every row is `Scheduled`, the trigger stops, and the rows are stranded until the 48-hour rule. This contradicts "each safe to stop after" (line 28) and line 309. The rollback text (line 310) also depends on `apiVoiceBatchStop` stopping `Scheduled` rows.
**Fix:** move the pick, trigger, stop and duplicate behaviour for `Scheduled` into 1a, or have 1a defer by stopping (a visible `Stopped` with a reason).

### CR-B2. Consent and AI disclosure (Q6) blocks 1a but is not a rollout precondition (D B2)

*Lines 91, 302 to 309, 329.*
The preconditions omit Q6 and Q7, the risk row says only "decided by HR and legal", and the design does not say how the existing agent script handles consent or disclosure today. The first real batch reaches real candidates with the legal basis undecided and no mitigation, which fails the standard's rule that each risk have a mitigation.
**Fix:** make Q6 a hard precondition for any real batch with a named decision owner.

## Major

### CR-M1. A hand edit of `Voice_DND` fails open; opt-out has two sources of truth (D M1)

The gate reads only `Voice_Contacts`; `Voice_DND` is kept in step by code paths plus a manual rebuild. Any writer that touches `Voice_DND` directly (a hand edit, an import, a path not on the list) leaves the gate unaware, so "none to a number on the opt-out register" is false. The call-site audit covers callers of the provider API, not writers of `Voice_DND`.
**Fix:** the gate reads both, or detects drift and fails closed; audit the writers of `Voice_DND` too.

### CR-M2. "Protected at once" is overstated (D M2)

The opt-out state is set only by ingest, which runs on a 30-minute job or at the start of a queue run, so during the lag another card, batch or single call can dial the same person; a lost webhook means the `do_not_call` never arrives (the risk table covers forged webhooks and lost spend results, not a lost opt-out). **Fix:** state the real exposure window; consider running ingest for the specific call before any further call to that number; add a lost-webhook risk row for the opt-out path.

### CR-M3. The phrase scan runs on a transcript whose tail is truncated first (D M3)

Payloads over 45,000 characters lose trailing transcript entries first, and "do not call me again" is usually said near the end. The phrase list (languages, false positives, tests) is unspecified. **Fix:** scan before truncation or keep the tail; specify the list and a test set.

### CR-M4. `Batch_ID` dependency between releases (D M4, S 2)

Release 2 finds the queue row by `Batch_ID` and card, but `Batch_ID` is a 1b column; line 309 says Release 2 needs only 1a's contact record and statuses. Move it to 1a or state the dependency.

### CR-M5. The pilot baseline is needed in 1a but stored in a 1b sheet (D M5, S 3)

`Voice_Admin_Notes` and the Admin page are 1b; the goal says the baseline is taken before the pilot, which is the first batch after 1a. Move it to 1a or drop "against a baseline" for the first batch.

### CR-M6. The first batch is too small for the Q5 gate, and "answer rate" collides with an existing key (D M6)

5 to 10 candidates and "answer rate above 30 percent" carries no statistical weight; there are no targets for completion rate or minutes. "Answer rate" collides with the existing `noAnswer` stats key (completed with no answers); how `partial` counts is undefined. State a sample size or caveat, define "answer" precisely, set targets.

### CR-M7. The "gate reads small sheets only" claim is inconsistent with its checks (D M7)

The daily limit (`voiceAccessEval_`, `voiceUsedToday_`) and the open-call check read `Voice_Calls`; the monthly call count has no source in 1a (`Voice_Budget` is 1b). Specify each check's source and state the cost of reading `Voice_Calls` under the lock at the expected volume.

### CR-M8. Concurrency covers only the gate, not other writers of shared counters (D M8)

`Voice_Contacts` and `Voice_Budget` are also written by ingest, `voiceDndAdd_`, the sweep, the reaper and the rebuild buttons. Read-modify-write from ingest racing the gate can lose an opt-out or an attempt. **Fix:** require the same lock for every writer; state the lock-timeout behaviour (fail closed).

### CR-M9. The 30-minute open-call window equals the maximum call length (D M9)

`VOICE_MAX_CALL_MIN` can be 30 and results lag, so a call can still be in progress when the window expires and a second call be placed. **Fix:** window at least `VOICE_MAX_CALL_MIN` plus the ingest lag, or treat a `Started` call without a result as open until resolved or closed.

### CR-M10. The reaper ignores the new statuses (D M10)

It looks for `Starting`, `Started` or `Completed`, so a call that ended `No answer` or `Busy` is not found, its row is marked `Failed` ("check the provider") and counts toward the three-failed stop. That is the bug `voiceStatusClass_` exists to prevent, and the reaper is not on the reader list. Use `voiceStatusClass_` and add it to the list.

### CR-M11. Ingest idempotency is undefined for unanswered results (D M11)

"Already has its result" applies only to `Completed`, so a duplicate webhook for a `No answer` call could reset `Not_Before`, double-schedule a retry or double-create the to-do. Define a per-call result-applied marker for all statuses.

### CR-M12. The unanswered-call to-do is promised in 1a but its rule ships in Release 2 (D M12)

Non-Goals say a single unanswered call "gets the same did-not-answer to-do"; `voice_noanswer` and the `noanswer` key are Release 2. In 1a the recruiter is not told.

### CR-M13. Retry timing rules are ambiguous (D M13)

"Moved to the next calling window, to 11:00 if 11:00 is inside the window" read literally pushes a busy retry after 30 minutes, or a 4-hour retry at 14:00, to the next day; Q2 describes a different rule. The 48-hour expiry does not say what it is measured from; if from the last update, a repeatedly deferred row never expires. State one rule with worked examples.

### CR-M14. "Attempt" is undefined (D M14)

Does a `Failed` placement, a `Blocked` row or a `partial` call count as an attempt or toward the monthly cap? The 7-day cap of 3 can pre-empt retries after earlier single calls and is classed `terminal` though it expires, so the to-do wording ("after 3 attempts") would be wrong. Define "attempt" once.

### CR-M15. "Real" calls are undefined, so the gate may have a bypass (D M15)

The glossary says real means candidate numbers as opposed to team numbers, and the checks "cannot be switched off for real calls". Nothing says how a call is classified. If it is a setting or number list, it is itself a way to disable the limits. Precondition 2 (a test call to a team number) would also be blocked by hours at night.

### CR-M16. The opt-out number is looked up from the candidate record after the fact (D M16)

The call row keeps four digits; at ingest the full number comes from the candidate record. If the number was edited in between, the wrong number is opted out and the right one stays callable. Store `Number_Key` or a hash on the call row at placement.

### CR-M17. Provider capabilities are assumed without proof (D M17)

The reserve is a "true bound" only if the provider agent supports a maximum call duration equal to `VOICE_MAX_CALL_MIN`; no source shows it does and it is not in Q8. Billing rounding is open (Q8) so spent is systematically underestimated if each call rounds up. The 30-minute lag is the ingest job's cadence, not provider behaviour. `do_not_call` and ratings rely on the post-call analysis that already returned empty ratings once. Add these to Q8 and the preconditions with a fallback.

### CR-M18. The "fixed on the way" defects have no design (D M18, S 4)

The `voiceFindCost_` hardening and the lost-result write are promised fixed, but no Goal, CUJ, section or release covers them; `Voice_Inbox.Error_Count` appears only in the data-model table. Add a short section for each or move them to Non-Goals.

### CR-M19. Alternatives rule (D M19, S 6)

"The decision is that there is none" (Admin hours override) is circular and attributes a decision to no named party. Central architectural choices have no alternative: the single gate, `Voice_Contacts` as the one input beside `Voice_DND`, immediate "Pending confirmation" against confirm-first, the `Voice_Budget` counter against reading `Voice_Calls`. The two "Deferred" entries should be labelled consistently.

### CR-M20. No volume estimates (D M20)

No estimate of calls per month, rows and cells added per month, trigger runtime against Apps Script quotas, or the rupee exposure of 300 calls at the maximum call length (up to 9,000 minutes). Add a sizing table.

### CR-M21. The Open Questions table breaks its own contract (S 5)

Q6 "Blocks 1a" but its default is "Not decided" (a blocker with no usable default); Q8 blocks "1a (retry and hours)" though retry is Release 2; Q7 blocks "Before wide use", not a release. Several assumed constants are not questions: the per-number cap of 3 in 7 days, `VOICE_MAX_CALLS_MONTH` 300, the 48-hour expiry, the 30-minute open-call window, the 15-minute backoff. A full retry cycle uses the whole per-number cap, so any later single call to that number is refused; this is not flagged.

### CR-M22. Style: revision narration, unmeasurable framing, ambiguous status of numbers (Y 1 to 9)

*   Lines 4 and 336 ("revised after the egm-review findings", "added after review") narrate revision history; remove or move to a changelog. (Y 1)
*   The "no cost field was seen" and "empty ratings" evidence is restated at lines 49, 253 and 342 with no count; state the number of payloads inspected and the SSOT 8.7 location once and reference it. (Y 2)
*   The pilot measures name answer and completion rate but set no target; say whether Q5 is the only threshold; the baseline has no sample size. (Y 3)
*   Hard-coded numbers are "assumed" in places and flat elsewhere (3 attempts in 7 days, 300 calls, 15-minute backoff, 48 hours, 5 minutes, the bounds); line 231 says "code constants, not a setting" while Q2 says "one setting or constant". Say which are owner decisions and which are engineer choices. (Y 4)
*   "No override" for opt-out and hours is stated four times (lines 60, 144, 193, 400). Keep it in Goals and one design place. (Y 5)
*   Line 275: "same kind of exposure as the rejected e-mailed transcript, with a smaller payload" is an unmeasured comparison inside a trade-off with no named decision-taker; name who decides (the owner via Q4, or HR and legal). (Y 6)
*   Line 344's nested parenthesis repeats itself; the risk row at line 330 ("None", n/a) has no decision; line 331 says engineer-owned but the Admin changes the values. (Y 7, 8)
*   Line 310 states "would read `No answer` as an unknown status" with no pointer to the code; mark it as an inference. (Y 9)

## Nits (structural, style, design)

*   Section order: the standard lists Alternatives before Risks; the document has Risks first. (S 7)
*   The "(existing)" convention at line 139 says "in `VoiceScreen.gs`" but later entries are existing in `Tasks.gs`, `Pipeline.gs` and `App.html`. (S 8)
*   The glossary says `Voice_DND` is "mirrored into `Voice_Contacts`" as if both exist; `Voice_Contacts` is new; "Pending confirmation" is undefined; the "Source documents" bullet is not a term and its link text is split. (S 9, 10; Y 23)
*   "Admin page below" instead of a section number; sections are tagged with a release inconsistently and not in order; the "as shown" Release cells; no CUJ for 1b, for opt-out undo, or for the failed-write and cost-parsing fixes; the Risks table cites T3 and T9, undefined in this scope; the risk list omits drift between `Voice_DND` and `Voice_Contacts`, lock contention and 10-digit normalisation collisions; 16 flat H3 Alternatives with a mixed "Not chosen"/"Deferred" pattern. (S 11 to 17)
*   Phrases: "so it can be tested without sheets" duplicates the purity statement; "self-healing" is undefined; "safe" is subjective (use "defects that must be fixed before candidates are called"); "reliably" is unmeasured (line 233); "a lost result never loosens the ceiling" is absolute; line 408 misquotes the "a person always decides" goal; "Revisit if..." triggers (lines 356, 400, 408) are measurable only at 356 and 408; the Overview's "real" is undefined in the glossary. (Y 10 to 22)
*   `voiceRequireCaller_` still runs before the gate, and the `system` principal for retries is not said to bypass it (the recruiter may have lost access by retry time); audit attribution for retry calls is unstated. The legacy `Blocked (Do Not Disturb)` status is not covered by `voiceStatusClass_`, so "unknown status is logged loudly" would fire on every old row. A pending opt-out has no confirmation owner, expiry or service time. The presumed-spent sweep does not say how a late result is reconciled, nor who may use *Close*. Message bodies in links can exceed link length limits. "Owner" is overloaded (business owner, MRF owner, the Owner column). Number keys are 10-digit, so Indian numbers only, which is not stated; holidays are out of scope; the compiled hours bound (08:00 to 21:00) versus the 09:00 to 19:00 default is unexplained. The claim that every call reaches the provider through `voiceStartFor_` is stated as fact but only verified by precondition 1; phrase it as an assumption. (D nits 1 to 10)

## Comparison with round one

Fixed since round one: the Risks & Mitigations section exists; the five blueprint headings match the standard; the Alternatives are one heading per option with the brief named; the success rate is now two named measures; the two stages-and-releases lists are consistent; the glossary exists. Still standing in a new form: opt-out has two sources of truth (round one found two owners; the contact record now makes a third place), the queue-row outcome is defined but its release assignment is wrong (CR-B1), and the per-number cap and attempt definitions are not settled. New since the revision: the release-assignment contradictions (CR-B1, CR-M4, CR-M5, CR-M12) are introduced by the split of Release 1 into 1a and 1b.
