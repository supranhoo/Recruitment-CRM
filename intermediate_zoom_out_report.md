# Stage 8: Intermediate Zoom Out Review

**Document:** `docs/designs/voice-screening-gate-retry-sharing.md` (all 406 lines, unchanged since Stage 5)
**Date:** 2026-11-08
**Reviewer:** `egm-zoom-out` (Zoom-Out Standard), given the document and `zoom_out_report.md` only. It did not read the comprehension or critic reports and did not search the code, so claims that something "already exists" (`voiceDndAdd_`, `panelEmailIndex_`, `HOD_Email`) are unverified.
**Context sufficiency:** passes. The objective and the reason for it are clear.

## Part 1: Do the Stage 5 Blockers and Majors still stand?

The document has not been edited, so all of them stand. The reviewer checked each against the text.

- **B1, opt-out hole in the first batch: stands, and is the worst problem.** Line 30 names the defect. Goals (line 41), line 96 and CUJ 4 promise the fix. Line 191 starts `VOICE_OPTOUT_AUTO` off. Line 295 puts the `do_not_call` disposition in Release 3, after the first real batch and after retry. Release 2 turns on retries while "do not call me again" is still filed as "not interested". The Rollout order (line 224) leaves opt-out out entirely.
- **B2, a refused queue row: stands.** Nothing in lines 108 to 145 or 173 to 186 says what status a refused `Voice_Queue` row gets. Line 178 says never retry after a `Blocked` result, and line 120 fails closed. Together they make a transient read error permanent for that candidate.
- **M1, race in the gate: stands.** No lock is mentioned anywhere.
- **M2, the reserve is not a true bound and is built too early: stands.** Line 163 defaults the worst-case length to the existing 8-minute warning. Line 168 releases a lost reservation silently, which fails open.
- **M3, no per-candidate cap on every path: stands.** Line 266 claims it is "covered", but only while a queue row is open.
- **M4, the gate reads the large sheet: stands.** Lines 270 and 59 reject reading `Voice_Calls` for retry state because it is large. The gate reads it on every call.
- **M5, retry designed in full before it is needed: stands.** Lines 175 to 186 and 320 to 325. The free-text `VOICE_RETRY_PLAN` is speculative configurability. The "Call again" to-do option is still missing from Alternatives.
- **M6, sharing: stands.** Line 209 pastes answers in full, the exposure line 250 rejects. The goal on line 47 says "learn that a result is ready", but line 102 says delivery cannot be known. Line 206 sends MRF outcomes to the department head as a stand-in.
- **M7, success measures: stands.** Line 46 and line 154 give one name two meanings. "Minutes saved per hire" cannot be measured in a batch of 5 to 10. The baseline and the invoice step are not in Detailed Implementation.
- **M8, `Blocked` statuses: stands.** Two values are defined (line 215), but the stats list four reasons (line 308).
- **M9, hard limits are editable: stands.** Line 405 admits the audit gap and leaves the fix out of the file list.
- **M10, status-change cost and the repair: stands.** `voiceQueueTrailingFails_` is in line 156 but absent from the Release 1 file list. The repair on line 315 is irreversible.
- **M11, spoken opt-out relies on one classification: stands.**
- **M12, rollback: stands.** Line 225 does not say the gate's protections disappear on rollback.
- **M13, altitude and consistency: stands.** Both gate names are still present (lines 110 and 303), and Detailed Implementation lists signatures under "There is no code here".

## Part 2: What the later stages add at this altitude

The reviewer did not have the comprehension and critic reports. Reading the unchanged document fresh, it adds the following.

### New Blocker

**NB1. The architecture has no single owner of "this number must not be called".** (Sections 1, 4, 5 and the Problem.)
The opt-out register, the card-level retry stop, the one-open-call check, the daily limit and the queue-row duplicate check each cover part of the question. They differ in key (number versus card) and scope (card, caller or batch), and each is designed separately. A per-number "contact state" would answer it once: opted out (provisional or confirmed), attempts in the last N days, last outcome. The gate would read that state. It would also fix B1, M3 and part of M4. Without it, the gate looks centralised but its inputs are not.
**Fix:** define one per-number record, a small ledger sheet keyed on the normalised number, holding opt-out state (including "Pending confirmation"), recent attempt count and last-contact time. The gate, ingest and retry all read and write only that record. State it as the design's core data structure in the Technical Plan.

### New Majors

**NM1. Altitude and flow of the Technical Plan.** The diagram (lines 122 to 143) shows only the happy path. It leaves out the refused-row path, the retry loop back to the queue, and the reaper and sweep, which are the new moving parts. Add them, or add a second diagram with the state machine for a queue row (Waiting, Calling, Placed, Scheduled, Stopped, Failed, with the event that moves it). That one picture would have exposed B2.

**NM2. The first batch is meant to learn facts, but Release 1 builds more than those facts need.** The goal on line 44 is to learn four things: answer rate, real minutes, ratings shape and billing basis. Release 1 ships the gate, the status change, the reserve, the reaper, the sweep, seven settings and a command-center rework. The learning needs the gate's hours and opt-out checks, the new statuses and the raw payload capture. The reserve, sweep, per-batch ceiling and `VOICE_MAX_CALL_MIN` are the cost-control part and depend on facts the batch will give.
**Fix:** split Release 1 into 1a (hours, opt-out including the provisional hold, statuses, payload capture, a fixed call-count cap) and 1b (reserve and ceilings), after the batch. This matches both the "stop anywhere" framing and the standard's preference for the smallest design.

**NM3. The "no wrong rejection" limit has no mechanism.** Line 19 lists it as one of four hard limits and line 48 states it as a goal. It is enforced only by absence (the non-goals, line 51). Say so, or add a structural guarantee, such as the call-result writer having no access to stage or reject functions.

### New Nits

- Sections 1 and 8 never state the time zone for the 09:00 to 19:00 window or the month boundary for the monthly ceiling.
- Line 145 leaves "Admin override of hours" undecided yet says "no override". Make "no override" the decision and drop the open question.
- Line 227 asks for the receiver's secret to be rotated before the first batch, but the receiver is out of scope. Make this a named release gate with an owner.

## Simplifications to adopt (ordered by payoff)

1. A per-number ledger as the one input to the gate (NB1). It removes the large-sheet reads, the cross-path cap gap and the opt-out scope gap.
2. Split Release 1 and defer the reserve and ceilings until the first batch (NM2, M2).
3. Replace the retry plan text and its parser with constants, and add the "Call again" to-do to Alternatives (M5).
4. Use one `Blocked` status with a reason field, and one `voiceStatusClass_` mapping (M8, M10).
5. Drop the one-time repair; clear the test rows by hand (M10).

## Overall verdict

The direction is sound: a single fail-closed gate, small releases that can each be stopped after, and a human decision on every outcome. The architecture is **not yet sound enough to proceed to implementation planning**. Three problems must be settled first:

1. Move opt-out protection into Release 1, using a provisional hold keyed on the number (B1, NB1).
2. Define what happens to a refused queue row, as defer or terminal (B2, NM1).
3. Decide Release 1's scope, whether the reserve and ceilings wait for the first batch (NM2), and add the lock around the gate (M1).

The remaining Majors can be resolved during planning. None of them blocks it. After these three changes the document is ready to plan.
