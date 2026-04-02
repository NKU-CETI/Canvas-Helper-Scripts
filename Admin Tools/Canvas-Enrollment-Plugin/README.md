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

## What is Tampermonkey?

[Tampermonkey](https://www.tampermonkey.net/) is a free browser extension that lets you install and run small JavaScript programs called **userscripts**. A userscript runs automatically when you visit a matching website, allowing it to add buttons, panels, or other features to pages without you having to do anything beyond the initial install. Userscripts are commonly used by power users and staff to streamline repetitive workflows — in this case, managing Canvas course enrollments without navigating through multiple Canvas menus.

Tampermonkey is available for Chrome, Firefox, Edge, Safari, and Opera.

---

## Installation

### Step 1 — Install Tampermonkey

> **Chrome users:** Chrome requires you to enable **Developer mode** (or the newer **Allow User Scripts** toggle) before Tampermonkey can run userscripts from the Chrome Web Store.
>
> 1. Open Chrome and go to `chrome://extensions`.
> 2. In the top-right corner, toggle **Developer mode** on (Chrome 120 and earlier) **or** look for an **Allow user scripts** toggle and enable it (Chrome 121+, shown near the top of the Extensions page).
> 3. Install Tampermonkey from the [Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo).
> 4. After installation, click the Tampermonkey puzzle-piece icon in the toolbar and pin it for easy access.

For **Firefox**, **Edge**, or **Opera**, simply install Tampermonkey from the relevant extension store — no additional settings change is needed.

### Step 2 — Install the script

Click the link below to install the script directly:

**[Install Canvas Enrollment Manager](https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Admin%20Tools/Canvas-Enrollment-Plugin/canvas-enrollment-manager.user.js)**

Tampermonkey will open a confirmation page showing the script's metadata. Click **Install**.

### Step 3 — Use the tool

Navigate to a Canvas course home page or settings page (`https://*.instructure.com/courses/<id>` or `.../courses/<id>/settings`). The **Enrollment Management** panel appears automatically.

> **Note:** The panel intentionally appears only on the course **home page** and **settings page**. It will not appear inside Speedgrader, the Gradebook, or other course sub-pages.

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
| 1.8 | Panel now only appears on the course home page and settings page; no longer shows up in Speedgrader, Gradebook, or other course sub-pages |
| 1.7 | Reverted `@match` to `*.instructure.com` wildcard; restored contextual non-NKU warning message for users on other Canvas instances |
| 1.6 | Restricted `@match` to NKU domains only (`nku.instructure.com`, `nku.beta.instructure.com`, `nku.test.instructure.com`); fixed `DESIGNER_ROLE_ID` from 5 to 6 (id 5 is TaEnrollment; id 6 is DesignerEnrollment) |
| 1.5 | Added GitHub version check: the ℹ️ tooltip now shows ✅ (up to date) or 🔔 (update available) by fetching the latest `@version` from GitHub on page load |
| 1.4 | Fixed link validator false negative: POST response carried stale "no broken links" data; now always polls via GET after triggering a new job |
| 1.3 | Added permission check: non-admin users see a contextual "no access" panel; fixed `@updateURL`/`@downloadURL` to point to this repository |
| 1.2 | Fixed link validator false negative (results suppressed for up to 2 min on fast jobs); added `@updateURL`/`@downloadURL` for auto-update; added this README |
| 1.1 | Fixed link validator stale-result false positive; added ℹ️ version tooltip; added last-run timestamp; fixed CSRF token reading; fixed HTTP 422 on bodyless POSTs |
| 1.0 | Initial release |

---

## Notes for Developers

- **`DESIGNER_ROLE_ID = 6`** — NKU's Canvas role ID for the Designer enrollment role (`DesignerEnrollment`). Verify via `GET /api/v1/accounts/:id/roles` if roles change.
- The script requires Tampermonkey's `GM_xmlhttpRequest` permission to make cross-origin API calls.
- `DEBUG = false` by default. Set to `true` in the source to enable verbose console logging.

---

## Disclaimer

This script was created for use by instructional design staff at **Northern Kentucky University**. It is provided as-is, without warranty. Use at your own risk. Always verify enrollment changes in Canvas directly.
