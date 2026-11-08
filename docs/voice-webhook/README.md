# Voice webhook receiver (set up once, about five minutes)

The voice provider (Sarvam) can only send a call's result to a public address. The CRM is sign-in only, so a separate tiny
Apps Script project receives the result and writes one row into the CRM spreadsheet. The code only appends to `Voice_Inbox` and reads nothing else, but its permission (`spreadsheets` in `appsscript.json`) covers the whole spreadsheet and the project runs as the person who deployed it, so keep the address and the project's editors private.

1. Go to script.google.com > **New project**. Name it "BFCL voice webhook".
2. Replace the code with `Code.gs` from this folder. In Project settings tick "Show appsscript.json" and replace it with the
   `appsscript.json` from this folder.
3. Project settings > **Script properties**, add:
   - `WEBHOOK_SECRET` = a long random string (at least 30 characters, letters and digits). Make it up; do not reuse a password.
   - `SHEET_ID` = the id of the CRM spreadsheet (the long text between `/d/` and `/edit` in its address).
4. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**. Deploy and allow the permission
   (it only needs your spreadsheets). Copy the web app address (ends in `/exec`).
5. In the CRM: Admin > Voice agent > **Webhook address**, paste `<web app address>?key=<WEBHOOK_SECRET>` and save.
6. Place a test call. After it ends, open the candidate's card: the result appears (outcome, length, transcript).

Notes
- Anyone with the full address (with the key) can post a result, so keep it private. To change it, change `WEBHOOK_SECRET`,
  redeploy (a new version), and update the address in the CRM.
- The receiver answers with a small JSON body: `{"ok":true}` when saved, `{"ok":true,"duplicate":true}` for a repeat, `{"ok":false,...}` for a wrong key, bad JSON, a missing `attempt_id` or a missing setup. The provider may see a redirect (HTTP 302) after the post; the result is still saved.
- Repeats are ignored in two places: the receiver skips a result whose key (`attempt_id:retry_attempt:status`) is already in the last 200 rows of `Voice_Inbox`; the CRM (`voiceIngest_`) then records each inbox row on its call once.
- The CRM reads the inbox in its 30-minute job, so a result can appear up to about half an hour after the call. A call whose result has not arrived can also be fetched by attempt id from the CRM (Fetch result); that result is applied to the call directly and does not pass through the inbox.
- Changing the code later: Deploy > Manage deployments > edit > New version.
