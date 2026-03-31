# Canvas Enrollment Manager

A Tampermonkey userscript that adds an **Enrollment Management** panel to Canvas course pages, making it easy to enroll/unenroll yourself as a Designer and run course-health checks.

> **⚠️ Made for Northern Kentucky University (NKU)**
> This script uses NKU-specific Canvas role IDs and has been tested against NKU's Canvas instance (`nku.instructure.com`). It may not work correctly at other institutions without code changes (particularly the `DESIGNER_ROLE_ID` constant and the CSRF token handling).
---

## Features

| Feature | Description |
|---|---|
| Enroll as Designer | Adds yourself to a course with the Designer role |
| Unenroll Completely | Removes all your enrollments from a course |
| Link Validator | Triggers Canvas's built-in link validation job and shows a summary of broken links |
| Due-Date Checker | Checks whether any assignments have due dates falling before their section's start date |
| Canvas Status | Live indicator (🟢/🟡/🔴) linking to status.instructure.com |

---

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Click the link below to install the script directly:

   **[Install Canvas Enrollment Manager](https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Admin%20Tools/Canvas-Enrollment-Plugin/canvas-enrollment-manager.user.js)**

   Tampermonkey will open a confirmation page — click **Install**.

3. Navigate to any Canvas course page (`https://*.instructure.com/courses/*`). The panel appears automatically in the left sidebar.

---

## Automatic Updates

The script is configured for automatic updates via Tampermonkey. When a new version is published here:

- Tampermonkey checks for updates periodically (default: every 24 hours).
- You can also trigger a manual check: **Tampermonkey dashboard → the script → "Check for updates"**.
- You will be prompted before any update is applied.

Version numbering follows this convention:
- `1.x` → bug fixes and minor improvements
- `x.0` → major new features or breaking changes

---

## Version History

| Version | Notes |
|---|---|
| 1.5 | Added GitHub version check: the ℹ️ tooltip now shows ✅ (up to date) or 🔔 (update available) by fetching the latest `@version` from GitHub on page load |
| 1.4 | Fixed link validator false negative: POST response carried stale "no broken links" data; now always polls via GET after triggering a new job |
| 1.3 | Added permission check: non-admin users see a contextual "no access" panel; fixed `@updateURL`/`@downloadURL` to point to this repository |
| 1.2 | Fixed link validator false negative (results suppressed for up to 2 min on fast jobs); added `@updateURL`/`@downloadURL` for auto-update; added this README |
| 1.1 | Fixed link validator stale-result false positive; added ℹ️ version tooltip; added last-run timestamp; fixed CSRF token reading; fixed HTTP 422 on bodyless POSTs |
| 1.0 | Initial release |

---

## Notes for Developers

- **`DESIGNER_ROLE_ID = 5`** — This is NKU's internal Canvas role ID for the Designer role. Other institutions will have a different value. Check yours via `GET /api/v1/accounts/:id/roles`.
- The script requires Tampermonkey's `GM_xmlhttpRequest` permission to make cross-origin API calls.
- `DEBUG = false` by default. Set to `true` in the source to enable verbose console logging.

---

## Disclaimer

This script was created for use by instructional design staff at **Northern Kentucky University**. It is provided as-is, without warranty. Use at your own risk. Always verify enrollment changes in Canvas directly.
