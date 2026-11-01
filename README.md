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

### Releasing (automatic from GitHub)

**Merging to `main` is the release.** The workflow `.github/workflows/deploy.yml` runs on every merge that changes `*.gs`, `*.html` or `appsscript.json`:

1. Syntax gate: `node --check` on every `.gs` file and on the page script in `App.html`. A broken file is never pushed.
2. `clasp push -f`, then `clasp deploy -i <deployment> -d "v<BUILD_ID> <commit subject>"`. This updates the **existing** web-app deployment, so the link never changes.
3. Verification: it pulls the project back and compares every file with the repository, and checks that the deployment shows `v<BUILD_ID>`. The log ends with **"Result: live"**, or with **"pushed to Apps Script, NOT confirmed live"** and a red run (GitHub e-mails the owner).

Before merging, set `BUILD_ID` in `Config.gs` to the next number. After the run, hard-reload (Ctrl+Shift+R) and check that the footer or Admin \u2192 Tools shows that number, and open every screen the release touched. To re-run without a new commit: GitHub \u2192 Actions \u2192 *Deploy to Apps Script* \u2192 *Run workflow*.

**One-time setup (owner):**

1. On your computer run `clasp login`, then copy the whole contents of `~/.clasprc.json`.
2. GitHub \u2192 this repository \u2192 Settings \u2192 Secrets and variables \u2192 Actions:
   - New repository **secret** `CLASPRC_JSON` = the file contents.
   - New repository **variable** `APPS_SCRIPT_DEPLOYMENT_ID` = the existing web-app deployment ID (`clasp deployments` lists it).
3. Make sure the Apps Script API is switched on for that Google account (script.google.com/home/usersettings).
4. Optional approval step: create a GitHub Environment named `production` with a required reviewer and add `environment: production` to the job.

If the login ever expires, repeat step 1 and replace the secret. Never commit `.clasprc.json`, never paste it into a chat or issue. The workflow writes it to a temporary file with owner-only permissions, never prints it, and deletes it at the end.

Manual fallback (from your computer, on `main`): `clasp push -f`, then `clasp deploy -i <deploymentId> -d "v<BUILD_ID> <description>"`, and check the live build number.

The first page load after a release that raises the schema version upgrades the database (up to a minute).
