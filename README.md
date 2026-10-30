# BFCL Recruitment CRM Apps Script

Google Apps Script source for the BFCL Recruitment CRM web app.

The CRM tracks every MRF position line and candidate for Human Resources – Talent Acquisition, from approval to onboarding, with the BFCL Recruitment Policy v2.0 built in: TAT, JD and screening-question validation with HODs, pipeline stages, automatic to-dos, Day’s Status, KPIs and compliance.

- **Platform:** Google Apps Script web app · Google Sheets database · Google Drive for CVs and documents
- **Live version:** v61 (29 Sep 2026) · database schema 26
- **Documentation (single source of truth):** [`docs/BFCL_Recruitment_CRM_SSOT.md`](docs/BFCL_Recruitment_CRM_SSOT.md), covering every rule, screen, decision record and the detailed changelog

No recruitment data is stored in this repository. The database, CVs and documents stay in Google Sheets and Drive.

## Linked Apps Script project

This folder is configured for `clasp` through `.clasp.json`.

## Developer setup

1. Install clasp if needed:

   ```powershell
   npm install -g @google/clasp
   ```

2. Sign in to Google:

   ```powershell
   clasp login
   ```

3. Pull the latest Apps Script code before editing:

   ```powershell
   clasp pull
   ```

4. Push local changes back to Apps Script:

   ```powershell
   clasp push
   ```

5. Commit and push code changes to GitHub:

   ```powershell
   git add .
   git commit -m "Update recruitment CRM Apps Script"
   git push
   ```

## Notes

- Keep `.clasp.json` committed so this folder stays linked to the Apps Script project.
- Do not commit `.clasprc.json`; it contains local Google login tokens.
- Deploy a new web app version from the Apps Script editor after pushing code changes when the live app should be updated.

## Releasing a version

1. `clasp push` the tested change.
2. In the Apps Script editor: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The web-app link never changes.
3. Add the release to the changelog in `docs/BFCL_Recruitment_CRM_SSOT.md`, then commit and tag it, for example `git tag v59` and `git push --tags`.

### Standing rule: a confirmed push goes live

When the owner confirms a push, it is not finished until the live web app is updated and checked. Do all of these, in order:

1. `clasp push`, then `clasp pull` into a scratch folder and compare it with the repo. They must match.
2. Create a new version: `clasp version "<build> <short description>"`.
3. Update the **existing** web app deployment (never create a new one, because that changes the link): list it with `clasp deployments`, then `clasp deploy -i <deploymentId> -V <version> -d "<build>"`.
4. Check the live build number (the rail footer, or `apiBootstrap().build`) equals `BUILD_ID` in `Config.gs`.
5. Keep the saved Google login (`~/.clasprc.json`) so the owner is not asked to sign in again; the owner decided this. Never commit it, print it or copy it anywhere. If it is missing or expired (a new cloud session starts without it), ask for a fresh `clasp login --no-localhost`.

Report the result in plain words every time: **"live"** only when step 4 passed, otherwise **"pushed to Apps Script, not live"** with the reason, for example no Google sign-in in a cloud session. Raise `BUILD_ID` before each release. Without the owner's confirmation, push to GitHub only.

The first page load after a release that raises the schema version upgrades the database (up to a minute).
