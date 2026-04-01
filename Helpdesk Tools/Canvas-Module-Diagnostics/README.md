# Canvas Module Diagnostics

A Tampermonkey userscript that adds a **Helpdesk Tools** panel to Canvas course pages, allowing helpdesk staff to enroll themselves in courses and quickly diagnose module completion requirement issues that prevent students from progressing.

> **⚠️ Made for Northern Kentucky University (NKU)**
> This script uses NKU-specific Canvas role IDs and has been tested against NKU's Canvas instance (`nku.instructure.com`). It may not work correctly at other institutions without code changes (particularly the `HELPDESK_ROLE_ID` constant).

---

## Features

| Feature | Description |
|---|---|
| Enroll as Helpdesk | Adds yourself to a course with the Helpdesk role |
| Unenroll Completely | Removes all your helpdesk/teacher/designer enrollments from a course |
| Scan Modules | Lists every module that has completion requirements, with direct links to each required item |
| Diagnose Student Issues | Search for a student by name and see exactly which completion requirements they have not yet met |

---

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Click the link below to install the script directly:

   **[Install Canvas Module Diagnostics](https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js)**

   Tampermonkey will open a confirmation page — click **Install**.

3. Navigate to any Canvas course page (`https://*.instructure.com/courses/*`). The **Helpdesk Tools** panel appears automatically in the left sidebar.

---

## How to Use

### Scan Modules

1. Open any course page in Canvas.
2. In the **Helpdesk Tools** panel, click **Scan Modules**.
3. The panel lists every module that has completion requirements, with each required item and its requirement type linked directly to the item in Canvas.

**Requirement types explained:**

| Type | What the student must do |
|---|---|
| Must View | Open and view the page/file/video |
| Must Mark Done | Manually click the "Mark as done" button |
| Must Contribute | Post a reply to a discussion |
| Must Submit | Submit an assignment |
| Min Score | Achieve a minimum score on a quiz or assignment |

### Diagnose a Specific Student

1. In the **Diagnose Student Issues** section, type part of the student's name and click **Search** (or press Enter).
2. A list of matching students appears — click **Diagnose** next to the student's name.
3. The panel shows every module requirement the student has **not yet completed**, grouped by module, with direct links to each blocking item. If all requirements are met, a green checkmark is shown instead.

---

## Automatic Updates

The script is configured for automatic updates via Tampermonkey. When a new version is published here:

- Tampermonkey checks for updates periodically (default: every 24 hours).
- You can also trigger a manual check: **Tampermonkey dashboard → the script → "Check for updates"**.
- You will be prompted before any update is applied.

---

## Version History

| Version | Notes |
|---|---|
| 1.0 | Initial release — enroll/unenroll as Helpdesk, scan module completion requirements, diagnose individual student completion issues |

---

## Notes for Developers

- **`HELPDESK_ROLE_ID = 9`** — This is NKU's internal Canvas role ID for the Helpdesk role. Other institutions will have a different value. Find yours with `GET /api/v1/accounts/:account_id/roles` and look for the role named "Helpdesk" (or your equivalent).
- The script uses the same account-admin permission check as the Canvas Enrollment Manager — users must have admin access to at least one Canvas account to use it.
- `DEBUG = false` by default. Set to `true` in the source to enable verbose console logging.
- The student-completion check works by calling `GET /api/v1/courses/:id/modules?student_id=:id&include[]=items`, which returns each item's `completion_requirement.completed` boolean from the student's perspective.

---

## Disclaimer

This script was created for use by helpdesk staff at **Northern Kentucky University**. It is provided as-is, without warranty. Use at your own risk. Always verify completion status in Canvas directly.
