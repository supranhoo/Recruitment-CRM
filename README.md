# BFCL Recruitment CRM Apps Script

Google Apps Script source for the BFCL Recruitment CRM web app.

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
