# Stage 7: Critic Review (round 1)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md`, FeatureRange lines 1 to 283 (overview through alternatives)
**Date:** 2026-11-08
**Reviewers:** `egm-design` and `egm-structural` (both against `feature-spec-standard.md`) and `egm-style`. Each was a fresh context with only the document. All three completed; none is "not run".
**Round result:** not clean. Two reviewers raised Blockers and several raised Majors, and nothing is settled yet.

Finding ids are `<reviewer>-1-<n>`: `D` design, `S` structural, `Y` style. Where several reviewers raised the same issue, they are merged and all ids are listed.

## Blockers

### C1. No Risks & Mitigations section (D1, S1)

The feature-spec standard names "Risks & Mitigations" as a required heading (security, scalability, complexity risks and how each is mitigated). The document has none. Risks appear as scattered asides: retry-state mitigations (Technical Plan 4), rollback (section 9), the lost-webhook sweep (section 3). Missing or unassessed: concurrency, Apps Script execution and trigger quotas, sheet and cell size limits (raw payloads in `Final_Vars_JSON` against the 50,000-character cell limit), webhook authenticity and replay, candidate-data privacy, consent and retention, provider behaviour that bypasses the gate, a gate that fails closed and blocks every call.
**Fix:** add one consolidated risk table: risk, effect, mitigation, owner.

### C2. The gate is check-then-act with no lock (D2)

`voiceMayCall_` reads open calls, reserved minutes and the daily count, and only afterwards writes `Starting` and `Reserved_Min`. A recruiter's click, the one-minute job, the 30-minute job and ingest can run at the same time, so two executions can both pass "one open call" and the budget check (a double call, or a ceiling overshoot). Ingest is not stated to be idempotent: overlapping runs could double-process one `Voice_Inbox` row (duplicate to-dos, `Attempts` counted twice, duplicate register rows).
**Fix:** take the script lock around check-and-reserve-and-log, and around ingest; add processed-row markers; add an E2E case.

### C3. A spoken "do not call me again" is not honoured by default, and the Goal and CUJ 4 overstate the result (D3, S6)

Goal line 41 says the candidate "is added to the opt-out register". CUJ 4 says no later call, batch or retry reaches the number. Technical Plan 5 makes the register write conditional on `VOICE_OPTOUT_AUTO`, which starts off. With it off, only that card's retries stop, and the same number on another card, position or batch is still callable. The `do_not_call` agent disposition is also not listed as a precondition in the rollout, so until it ships a spoken opt-out is still filed as `not_interested`.
**Fix:** write the register entry unconditionally (a provisional entry the gate honours, undoable by a person), or add a gate check that blocks any number with a `do_not_call` outcome. List the provider-prompt change as a rollout precondition.

## Major

### C4. A blocked call's reasons, statuses and queue-row fate are not defined (D6, S7)

The data model defines only `Blocked (Outside hours)` and `Blocked (Budget)`. The gate also refuses for opt-out, daily limit, one open call and "could not check", and Goal line 39 promises a named reason for every block. The document never says what a queue row becomes when the gate blocks it. If it stays `Waiting`, the one-minute job writes a `Blocked` row per candidate per minute and a budget block never ends. Blocked rows do not count toward the "three failed in a row" stop, so nothing halts the loop. Line 178's "never retry after a `Blocked` result" turns a temporary block (hours, a read error) into a permanent end to retries.
**Fix:** one `Blocked` status with the reason in a separate field, or list every value. Define queue transitions per reason (hold to the next window for temporary reasons, `Stopped` for opt-out), log a block once per row and reason, and say whether refused clicks create rows.

### C5. Stage structure disagrees across Overview, Problem and Rollout (S5, Y3)

The Overview lists four stages, the Problem section three (check and first batch, then retry and a spend ceiling, then sharing "through a controlled outbox"), the rollout four releases that put the spend ceiling in Release 1 and spoken opt-out in Release 3 (section 9 omits spoken opt-out). The "controlled outbox" is the option the design rejects. CUJ 2 needs the ceilings before the first batch. "Each stage is safe to stop after" cannot be verified and conflicts with rollback leaving rows to review (section 9) and with stage 1's dependency on stage 2 through the limit.
**Fix:** one list of stages and releases used everywhere; delete "outbox"; state real stopping conditions or drop the claim.

### C6. "Every call goes through `voiceStartFor_`" is asserted, not shown; provider-side behaviour is unconfirmed (D4)

No audit of provider-API call sites is listed. Open Questions ask whether the provider retries on its own and honours our hours. If it does, or if the provider workspace can place or schedule calls, the hard limits are not hard.
**Fix:** make provider retry and hours behaviour (checked with team-owned numbers) a precondition of any real batch, and add a call-site audit to the plan.

### C7. No global kill switch (D5)

Rollback stops batches (`apiVoiceBatchStop`) and removes the trigger, but single calls continue. A live pilot on real candidates needs one setting that blocks every call at the gate.

### C8. Scalability and quota claims are absent and partly contradicted (D7, S1)

The design rejects "derive retry state from `Voice_Calls`" because its reads are large, yet the gate reads that sheet for every call (spent, reserved, daily count, open call), as do the 30-minute sweep and `voiceStats_`, with no stated way to keep this cheap (a summary row, a ledger, a date-bounded read). The one-minute trigger stays installed while any `Scheduled` row exists (up to 48 hours, about 1,440 runs a day) against Apps Script daily trigger-runtime quotas, which differ by account tier; Open Questions raise the tier only for mail. Raw payloads in a cell risk the 50,000-character limit, and the over-size behaviour is unspecified.
**Fix:** add pilot volumes and storage and runtime estimates, define truncation, cheapen the gate's reads.

### C9. The reserve ceiling rests on unverified assumptions (D8)

`VOICE_MAX_CALL_MIN` (default 8) is the worst-case call length, but nothing says the provider or agent caps call length. It is not stated whether a reserve is released when a placement fails outright, how billing is rounded, which batch a retry counts against for the per-batch ceiling, what "this month" means (calendar month, time zone, start date or result date), or what the fallback to minutes does in the gate. The 30-minute lag cited in the alternatives is partly obsolete: ingest now runs first in every queue run, though not for single calls.

### C10. `Scheduled` rows versus "open" rows contradict each other, which weakens the retry cap (D9)

A `Scheduled` row does not count as an open batch (so another batch can start), but the same card or number in an open row is refused. If `Scheduled` is not open, a second batch can queue the same number with `Attempts` reset. That is the cross-batch cap the Alternatives claim is "covered" when rejecting the `Voice_Attempts` option. `Max_Attempts` has no source setting. It is not stated when `Attempts` is incremented, whether `Busy` counts, or whether a recruiter re-queueing a stopped card resets the cap. The daily limit counts per caller. There is no per-candidate or per-number cap across cards, positions or recruiters.

### C11. Result sharing contradicts itself and cannot meet its goal (D10, Y14)

CUJ 5 says both messages carry the confirmed answers, while section 7 gives the MRF owner outcome and counts only. The MRF owner is not a data field, so the department head, who may not be entitled to the result, is the fallback. Goal line 47 promises that the recipients "learn" a result is ready, yet the CRM sends nothing and cannot know whether the recruiter sent it. For recipients without a CRM login the answers are pasted in full, the same harm used to reject e-mailed transcripts; the audit row records only "prepared". Interviewer addresses come from a free-text name match, a weakness cited against the outbox option.
**Fix:** reconcile the content, add a real MRF-owner field or ask the owner to approve the HOD fallback, reword the Goal to "prepares a message", and state the rule for non-users.

### C12. The success measure is defined two ways, and no metric has a target or go/no-go (D11, S8, Y3)

Goal line 46 defines success as person-completed screenings over placed calls. Section 2 says the success rate "keeps its definition" (calls with answers over placed) and adds the Goal's definition as a second figure. No metric has a target or threshold, no criterion exists for moving from the first batch to Release 2, and "minutes saved per hire" cannot be measured from about 10 candidates.
**Fix:** one name per definition; thresholds and go/no-go criteria; a per-completed-screening measure for the pilot.

### C13. Privacy, consent, retention and webhook trust are not addressed (D12)

Nothing covers consent to automated or recorded calls, disclosure that the caller is an AI agent, or retention of transcripts and payloads held in Sheets. The receiver is "not changed", with only "rotate the secret"; the document does not say how forged or replayed payloads are rejected, though one could write `Voice_DND`, release reserved budget or change an outcome.

### C14. Claims about existing behaviour are stated flatly or inconsistently (Y1, Y2, Y4)

Lines 11, 28-34 and 49 state facts that cannot be verified from the document: "nobody has used this", the opt-out check switchable, unanswered calls not counting against the limit. Line 32 and line 246 assert that the provider sends no cost field and that ratings came back as an empty object, while line 70 lists the post-call step as unconfirmed and line 196 says the first batch will capture "an unknown field such as a cost". The rejection of the cost-cap alternative rests on this.
**Fix:** cite the evidence (code location, test call id, date) or narrow the claim ("no cost field has been observed in the payloads inspected; one call does not establish the general case"). Mark "candidates often do not answer" and similar motivation as assumptions the pilot tests.

### C15. Alternatives section: attribution, missing options, thin entries (D13, S3, S4, S9, S10, Y13, Y20)

"Rejected by author" appears in nearly every heading and again in each body; the author is shown as Claude and the owner's decisions are not linked, so the label adds nothing. The brief that the first six alternatives come from has no path. Missing alternatives: enforcing hours and opt-out at the provider, a `Raised_By` field on the MRF instead of the HOD fallback, an Admin hours override. The two "Deferred" entries are not rejections and one has no threshold. Three headings bundle two options each.
**Fix:** state the trade-off alone, or link the decision; name the brief by path; add the missing alternatives; one heading per option.

### C16. Open Questions have no owner, date or draft default (D14, S13)

Seven questions "block part of the design". None has an owner or date, several have no assumed default (retry rule, budget unit, spoken opt-out policy), and assumed answers elsewhere (rupee unit, `HOD_Email` fallback, Admin not exempt) are not cross-referenced back to the question.

### C17. Required header names are not matched (S2)

The standard names "Problem Statement", "Goals & Non-Goals" and "Proposed Architecture". The document has "The Problem", separate "Goals" and "Non-Goals", and "Technical Plan (Architecture)". The content is present; rename or alias the headings.

## Nits

- **Hard-limit lists disagree.** The Overview says four hard limits; the gate has five checks (hours, opt-out, daily limit, budget, one open call), and "no wrong rejection" is a non-goal, not a gate check. (D15, Y)
- **Settings versus hard limits.** Hours and ceilings are editable settings, so "no override" is only as strong as the setting. Hours "09:00 to 19:00 Monday to Saturday" are hard-coded in CUJ text while the window is a setting. Time zone and holidays are unstated. `VOICE_DND_REQUIRED` stays as a setting that no longer affects real calls; remove it. (D16)
- **Reaper threshold.** Five minutes is close to the Apps Script 6-minute execution cap; a legitimate run could have its `Calling` row reaped. (D17)
- **`partial` results** map to `Completed` and are never retried, so a candidate who hangs up midway gets an incomplete draft and no follow-up. Say so. (D18)
- **One-time repair** rewrites old `Failed` rows irreversibly; keep the original value in a note column. (D19)
- **Data-model table** omits `Voice_DND` source and reason fields, the new to-do types, the audit row type, and the existing `Stopped` and `Placed` queue states. (D20)
- **CUJs missing** for a budget block, an opt-out register hit, a lost webhook and the "could not check" fail-closed path. (D21)
- **Testing.** Concurrency, ingest idempotency, the reaper, time edges (18:58 to 19:00, Sunday, daylight saving) and the phone-number open-call check have no listed test; a code search is not a test. (D22)
- **Terms and links.** MRF is never expanded; "gate", "check" and `voiceMayCall_` are used interchangeably; "result" means both a provider outcome and a screening result; "real" is undefined; `docs/BFCL_Recruitment_CRM_SSOT.md`, `./EGM.md` and "the concepts brief" lack stable links; "the author" versus "the owner" is unclear. (S3, Y19, Y20, Y10, D23)
- **Style.** Line 20 duplicates Non-Goal line 54; line 35 restates the Overview list; "or any person the Admin has named" is wordy; line 159 is wordy; "still" in line 234 is filler; "fuzzy name" is jargon; "decision of the author" and "Rejected by author" refer to an undefined third party. (Y7 to Y9, Y16, Y18, Y21)
- **Diagram.** The code fence at lines 122 to 143 has no language tag and no caption or prose reference. (S12)
- **Overview line 20** says other call types are "sketched here", but no section sketches them. (S11, Y7)
- **Nudge alternative** (WhatsApp or SMS) states no cost, complexity or consent trade-off. (S9)

## Disputed finding

- **Y12** says the Alternatives intro ("first six come from the concepts brief, the next five are the options the author did not choose") does not match the headings. **S** checked the same text and found it matches the 11 headings (6 from the brief, 5 from the design choices). Reading the headings, the count is correct; Y12 is recorded as contested and not carried forward.

## Kept as sound (all reviewers who commented)

The caveats at lines 102 (the CRM cannot know whether the message was sent), 120 (fail-closed), 185 (the reaper never resets to `Waiting`, with the double-call reason given) and 225 (rollback leaves calls unrecallable), and the statement "The accepted option cannot guarantee delivery" in the alternatives.

## Traceability

| Consolidated | Raw findings |
|---|---|
| C1 | D1, S1 |
| C2 | D2 |
| C3 | D3, S6 |
| C4 | D6, S7 |
| C5 | S5, Y3 |
| C6 | D4 |
| C7 | D5 |
| C8 | D7, S1 |
| C9 | D8 |
| C10 | D9 |
| C11 | D10, Y14 |
| C12 | D11, S8, Y3 |
| C13 | D12 |
| C14 | Y1, Y2, Y4 |
| C15 | D13, S3, S4, S9, S10, Y13, Y20 |
| C16 | D14, S13 |
| C17 | S2 |
| Nits | D15 to D23, S11, S12, Y5 to Y11, Y15 to Y21 |
| Disputed | Y12 |
