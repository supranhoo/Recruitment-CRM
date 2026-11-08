# Stage 8: Intermediate Zoom Out Review (round 2, revised design)

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md` (revised, 518 lines, unchanged since Stage 5)
**Date:** 2026-11-08
**Reviewer:** `egm-zoom-out` (Zoom-Out Standard), given the document and `zoom_out_report.md` (ids Z-B1, Z-B2, Z-M1 to Z-M15) only. It did not read other files, so reuse claims remain unverified, and it did not have the Stage 6 and 7 reports.
**Context sufficiency:** passes.

## Do the Stage 5 Blockers and Majors still stand?

The document is unchanged, so every finding stands. The reviewer's position on each:

*   **Z-B1 (consent Q6 not a precondition): stands, agree. Blocker.** The six rollout preconditions omit consent, so the design permits the first real call with no legal decision.
*   **Z-B2 (four releases specified in detail on evidence for one): stands; the reviewer would downgrade it from Blocker to Major with a narrower fix.** The speculation is real (retry and spend control are specified in full, down to build numbers 160 to 163, while the document defers retry "because nobody has seen a real answer rate"), but the document is already staged and each release is marked safe to stop after. The harm is wasted drafting and review noise and the risk that 1a hardening gets entangled with 1b to 3 mechanism; it is not a safety blocker. Fix: freeze 1b to 3 as direction only.
*   **Z-M1 (second source of truth for opt-out): stands, agree. The most important architectural flaw.** The gate reads only `Voice_Contacts`; `Voice_DND` is still a hand-editable register, so any addition not routed through `voiceDndAdd_` is invisible to the gate and the "non-overridable" check fails open. Preferred fix for 1a: the gate reads `Voice_DND` directly together with an opt-out status column, derives attempts from `Voice_Calls` over 7 days, and `Voice_Contacts` is dropped until a read time is measured.
*   **Z-M2 (spend control heavy for a pilot): stands, agree.** Replace the reserve, sweep, counter sheet, invoice-derived rate and *Close* action with the one-line check (calls times maximum minutes times rate), only if `VOICE_MAX_CALL_MIN` is enforced in the agent.
*   **Z-M3 (manual "Call again" would do): stands, agree.** It reuses the gated single-call path and needs no scheduler, system principal, `Attempts` column or reaper-to-trigger interplay.
*   **Z-M4 (per-number cap versus "a person decides"): stands, agree.** Recommendation: the cap binds automated and retry calls only, or manual calls see a recruiter-visible "locked until <date>" message with the Admin able to lift it (not an override of opt-out or hours).
*   **Z-M5 (release assignments inconsistent): stands, agree.** `Batch_ID` is written in 1a but listed as 1b; the baseline is needed before the pilot but lives in a 1b sheet; Q8 blocks "1a (retry and hours)" though retry is Release 2; the test table puts retry cases in 1a.
*   **Z-M6 (altitude: Detailed Implementation is code-level): stands, agree.** Move it to an implementation plan or the pull request.
*   **Z-M7 (sharing weakly motivated): stands, agree.** Remove it, or reduce it to a copy-text button with the card link.
*   **Z-M8 (reuse asserted, not evidenced): stands, agree.** About 20 new functions are proposed with no recorded search outcome; the reviewer could not run the search.
*   **Z-M9 (reserve bound depends on a manual setting): stands, agree; falls away if Z-M2 is accepted** (it reduces to one alert when ingest sees a call longer than `VOICE_MAX_CALL_MIN`).
*   **Z-M10 (three overlapping attempt counters): stands, agree.** One derived counter.
*   **Z-M11 (fail-closed gate has no degraded mode): stands, agree.** No lock-timeout behaviour, no hold bound, no alert for a systemic fault.
*   **Z-M12 (result lag stated as a law): stands, lower priority.** The receiver is not changed, so name the 30-minute lag as a constraint; it matters mostly for the reserve.
*   **Z-M13 (opt-out depends on an unverifiable provider change): stands, agree. The highest-harm item after consent.** Add the conservative hold on short or `not_interested` calls.
*   **Z-M14 (decision at two call sites applied twice): stands, partly moot.** It stands for the 1a opt-out scan too: ingest and `apiVoiceFetchResult` both run the status and opt-out work, and the "already has its result" check covers `Completed` only. Make `voiceApplyResult_` idempotent for every status.
*   **Z-M15 (48-hour expiry versus Sundays): stands, but vanishes if retry is replaced by the manual button.**

## The conflict between the two Stage 5 reviewers: cut scope versus harden scope

**Position: cut scope first, then harden only what is left.** The two views are not symmetric. Most hardening items (a single opt-out store, the observed-maximum guard, the lock-timeout rule, push-or-faster ingest, working-time expiry) protect mechanisms the cut removes (the reserve, the sweep, automatic retry). Hardening them first would add mechanism to code that may never be built. The hardening items that protect 1a survive and should be done: a single opt-out source (Z-M1), the degraded mode (Z-M11), the conservative opt-out hold (Z-M13), idempotent result application (Z-M14), and one attempt counter (Z-M10). The rest wait for pilot data. A counterweight to the cutters: do not cut the gate, the distinct unanswered statuses, the spoken opt-out protection or the payload capture, which are the root problem.

## New findings at this altitude

### Major

*   **N-1.** The headline guarantee ("neither check can be switched off") depends on a hand-maintained sheet and a manual provider-workspace change. State it as "enforced for numbers known to the CRM" in the Goals.
*   **N-2.** The pilot has no success or abort condition tied to a decision. Q5 gives one threshold for moving on; nothing says what happens below 30 percent (the nudge alternative is only "revisit") or what would end the project. Add a "pilot exit" paragraph: continue, change approach, or stop, with the numbers that select each.
*   **N-3.** No operational owner or drill for the kill switch. Rollback is "set `VOICE_ENABLED` to No" but nothing says who does it, how fast, or that it is tested. Add a precondition: the Admin turns it off during a live test and confirms the next call is refused.

### Nit

*   **N-4.** The first-batch cap should be the pilot size (10), not 30.
*   **N-5.** A fresh reader of the design alone cannot see `concepts_brief.md` or `EGM.md`; the Problem Statement should carry the key facts.

## What the design could be (the reviewer's simplification)

One page: gate (hours, opt-out read from `Voice_DND` plus a status column, attempts from `Voice_Calls`, call-count caps, one open call); distinct `No answer` and `Busy` statuses through one status-class function; spoken opt-out as a pending state; payload capture; a recruiter to-do with a *Call again* button; a "follow-ups decided after the pilot" section. The reserve, sweep, retry scheduler, reaper, sharing, baseline sheet and invoice rate wait for numbers.

## Overall verdict

The architecture of Release 1a is sound and worth building. The document as a whole is **not ready to go to implementation planning**. Before planning: add the consent precondition, fix the opt-out source of truth, freeze Releases 1b to 3 to direction only, resolve the per-number cap against manual calls, reconcile release assignments, and add a pilot exit rule. These are edits to the document, not a redesign. With them, proceed to planning for Release 1a only.
