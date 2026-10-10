# Voice webhook receiver (set up once, about five minutes)

The voice provider (Sarvam) can only send a call's result to a public address. The CRM is sign-in only, so a separate tiny
Apps Script project receives the result and writes one row into the CRM spreadsheet. It cannot read anything from the CRM.

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
- The provider may see a redirect (HTTP 302) after the post; the result is still saved. If it retries, the repeat is ignored.
- Changing the code later: Deploy > Manage deployments > edit > New version.
