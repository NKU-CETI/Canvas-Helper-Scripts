# Canvas Instructor Helper

A Tampermonkey userscript that adds an **Instructor Tools** panel to Canvas course pages, giving instructors at-a-glance course health information and quick links to fix common issues.

> **⚠️ Made for Northern Kentucky University (NKU)**
> This script has been tested against NKU's Canvas instance (`nku.instructure.com`). It may work at other institutions but is not tested or supported outside of NKU.

---

## Features

| Feature | Description |
|---|---|
| Link Validator | Triggers Canvas's built-in link validation job and shows a summary of broken links |
| Due-Date Checker | Checks whether any assignments have due dates falling before their section's start date |
| Grade Weighting | Diagnoses assignment group weight configuration — flags totals ≠ 100%, "extra credit" naming pitfalls, and groups with a disproportionately high weight |
| Canvas Status | Live indicator (🟢/🟡/🔴) linking to status.instructure.com |
| Get Help *(NKU only)* | One-click link to book an appointment with an NKU instructional designer via CETI |
| Expand / Collapse | The panel body can be collapsed to save sidebar space; the state persists across page loads |

The panel is only shown to users with a **Teacher** or **TA** enrollment in the current course.

---

## What is Tampermonkey?

[Tampermonkey](https://www.tampermonkey.net/) is a free browser extension that lets you install and run small JavaScript programs called **userscripts**. A userscript runs automatically when you visit a matching website, allowing it to add buttons, panels, or other features to pages without you having to do anything beyond the initial install. Userscripts are commonly used by power users and staff to streamline repetitive workflows — in this case, getting at-a-glance course health diagnostics without navigating through multiple Canvas menus.

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

**[Install Canvas Instructor Helper](https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Instructor%20Tools/Canvas-Instructor-Plugin/canvas-instructor-helper.user.js)**

Tampermonkey will open a confirmation page showing the script's metadata. Click **Install**.

### Step 3 — Use the tool

Navigate to a Canvas course home page or settings page (`https://*.instructure.com/courses/<id>` or `.../courses/<id>/settings`) where you are enrolled as an instructor or TA. The panel appears automatically.

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
| 1.2 | Panel now only appears on the course home page and settings page; no longer shows up in Speedgrader, Gradebook, or other course sub-pages |
| 1.1 | Current release — added grade weighting diagnostic, expand/collapse panel toggle, and NKU CETI appointment booking link; removed missing due dates and unpublished content checks |
| 1.0 | Initial release — link validator, due-date checker, missing due dates, unpublished content check, Canvas status indicator, and GitHub version check |
| 2.0 (deprecated) | Withdrawn release that was briefly versioned higher than 1.1; superseded by 1.1 to maintain consistent Tampermonkey update behavior |
---

## Notes for Developers

- The permission check queries the course enrollments endpoint (`GET /api/v1/courses/:id/enrollments?user_id=:id`) and requires a `TeacherEnrollment` or `TaEnrollment` to proceed. Users without a qualifying enrollment see a contextual "no access" message.
- The grade weighting check first calls `GET /api/v1/courses/:id` to read `apply_assignment_group_weights`, then fetches all assignment groups with `include[]=assignments` to inspect weights and assignment names.
- The script requires Tampermonkey's `GM_xmlhttpRequest` permission to make cross-origin API calls.
- `DEBUG = false` by default. Set to `true` in the source to enable verbose console logging.
- The link validator last-run timestamp is stored in `localStorage` with the key `canvas_ih_lv_last_run_<courseId>`.
- The version-check result is cached in `localStorage` under `cih_version_check` for 24 hours to avoid hammering GitHub's raw-content CDN.
- The panel collapsed/expanded state is persisted in `localStorage` under `cih_panel_collapsed`.

---

## Disclaimer

This script was created for use by faculty and instructional staff at **Northern Kentucky University**. It is provided as-is, without warranty. Use at your own risk.
