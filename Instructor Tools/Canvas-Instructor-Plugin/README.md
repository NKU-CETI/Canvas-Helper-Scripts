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

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Click the link below to install the script directly:

   **[Install Canvas Instructor Helper](https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Instructor%20Tools/Canvas-Instructor-Plugin/canvas-instructor-helper.user.js)**

   Tampermonkey will open a confirmation page — click **Install**.

3. Navigate to any Canvas course page (`https://*.instructure.com/courses/*`) where you are enrolled as an instructor or TA. The panel appears automatically in the left sidebar.

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
