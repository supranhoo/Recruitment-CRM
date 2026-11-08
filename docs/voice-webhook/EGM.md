# Voice webhook receiver

## Overview
A separate, tiny Apps Script project (deployed as a web app, access "Anyone")
that receives the voice provider's call-result POSTs and appends one row per
result to the `Voice_Inbox` sheet of the CRM spreadsheet. It is not part of the
main CRM project (the root `.clasp.json` project does not include this folder;
`docs/**` is in `.claspignore`). The main project reads the inbox later
(`voiceIngest_` in `VoiceScreen.gs`). Setup steps are in [README.md](./README.md).

## Interface
- `Code.gs:doPost(e)`: checks `e.parameter.key` against Script Property `WEBHOOK_SECRET`, parses the JSON body, requires `attempt_id`, appends a row, returns JSON.
  - `{ok:true}` saved; `{ok:true,duplicate:true}` repeat; `{ok:false}` wrong key; `{ok:false,error:'not set up' | 'not json' | 'no attempt_id'}`.
- `Code.gs:doGet()`: returns the text `ok` (health check).
- `Code.gs:same_(a, b)`: constant-time string comparison for the secret.
- `Code.gs:out_(o)`: JSON text output helper.
- `Code.gs:INBOX_` / `INBOX_COLS_`: sheet `Voice_Inbox`, columns `Received_At, Attempt_ID, Event_Key, Payload, Processed_At, Result`.
- `appsscript.json`: scope `https://www.googleapis.com/auth/spreadsheets`, `executeAs: USER_DEPLOYING`, `access: ANYONE_ANONYMOUS`.

## Invariants
- [Code.gs:doPost] Requires Script Properties `WEBHOOK_SECRET` (at least 20 characters) and `SHEET_ID`; otherwise answers `not set up`.
- [Code.gs:doPost] The secret is the only check; the provider documents no signature.
- [Code.gs:doPost] `Event_Key` is `attempt_id:retry_attempt:status`; a result whose key is already in the last 200 rows is skipped (`duplicate:true`).
- [Code.gs:doPost] Payloads over `MAX_CELL_` (45000 characters) lose trailing `interaction_transcript` entries, then are cut.
- [Code.gs:doPost] Written values starting with `=`, `+`, `@`, tab, CR or `-` before a letter are prefixed with an apostrophe (no formula injection).
- [Code.gs:doPost] Appends run inside `LockService.getScriptLock()` (20 s wait).
- The code only appends to `Voice_Inbox`, but the granted scope covers the whole spreadsheet and runs as the deploying user.

## Side Effects
- Appends a row to `Voice_Inbox` (creates the sheet with a header row if missing) in the spreadsheet named by `SHEET_ID`.
- Script lock held during the append.
- No other network, Drive, mail or trigger use.

## Verification
- No automated test command is defined. After deployment, place a test call from the CRM and check that a row appears in `Voice_Inbox` and the result shows on the card (see [README.md](./README.md)).
