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
