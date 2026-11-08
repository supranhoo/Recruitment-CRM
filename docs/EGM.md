# docs

## Overview
Documentation for the BFCL Recruitment CRM plus one separately deployed helper
project. Nothing here is pushed to the main Apps Script project (`docs/**` is
listed in `.claspignore`).

## Subdirectories & Boundaries
- [voice-webhook](./voice-webhook/EGM.md): separate Apps Script receiver that writes the voice provider's call results into the `Voice_Inbox` sheet.

## Files
- [BFCL_Recruitment_CRM_SSOT.md](./BFCL_Recruitment_CRM_SSOT.md): the single source of truth for rules, screens, decisions and changelog. Where it and the code disagree, the live code is the fact (see its header).
