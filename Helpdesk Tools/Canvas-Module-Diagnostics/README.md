# Canvas Module Diagnostics

A Tampermonkey userscript that adds a **Helpdesk Tools** panel to Canvas course pages, allowing helpdesk staff to enroll themselves in courses and quickly diagnose module completion requirement issues that prevent students from progressing.

> **⚠️ Made for Northern Kentucky University (NKU)**
> This script uses NKU-specific Canvas role IDs and has been tested against NKU's Canvas instance (`nku.instructure.com`). It may not work correctly at other institutions without code changes (particularly `HELPDESK_ROLE_ID` and `ENROLL_HELPDESK_ADMIN_ROLE_ID`).

---

## Features

| Feature | Description |
|---|---|
| Enroll as Helpdesk | Adds yourself to a course with the Helpdesk role |
| Unenroll Completely | Removes your Helpdesk enrollment from a course |
| Scan Modules | Lists every module that has completion requirements, with direct links to each required item |
| Diagnose Student Issues | Search for a student by name and see exactly which completion requirements they have not yet met |

---

## What is Tampermonkey?

[Tampermonkey](https://www.tampermonkey.net/) is a free browser extension that lets you install and run small JavaScript programs called **userscripts**. A userscript runs automatically when you visit a matching website, allowing it to add buttons, panels, or other features to pages without you having to do anything beyond the initial install. Userscripts are commonly used by power users and staff to streamline repetitive workflows — in this case, enrolling into Canvas courses and diagnosing module completion issues without navigating through multiple Canvas menus.

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

**[Install Canvas Module Diagnostics](https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js)**

Tampermonkey will open a confirmation page showing the script's metadata. Click **Install**.

### Step 3 — Use the tool

Navigate to a Canvas course home page or settings page (`https://*.instructure.com/courses/<id>` or `.../courses/<id>/settings`). The **Helpdesk Tools** panel appears automatically.

> **Note:** The panel intentionally appears only on the course **home page** and **settings page**. It will not appear inside Speedgrader, the Gradebook, or other course sub-pages.

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
| 1.2 | Panel now only appears on the course home page and settings page; no longer shows up in Speedgrader, Gradebook, or other course sub-pages |
| 1.1 | Set correct NKU role IDs (Helpdesk = 177, Enroll Help Desk admin = 178); replaced generic account-admin permission check with a course-enrollment check for role 178; unenroll now only targets role 177 |
| 1.0 | Initial release — enroll/unenroll as Helpdesk, scan module completion requirements, diagnose individual student completion issues |

---

## Notes for Developers

- **`HELPDESK_ROLE_ID = 177`** — NKU's Canvas course enrollment role ID for Helpdesk workers. Other institutions will have a different value. Find yours with `GET /api/v1/accounts/:account_id/roles`.
- **`ENROLL_HELPDESK_ADMIN_ROLE_ID = 178`** — NKU's Canvas role ID for the "Enroll Help Desk" admin permission. The Helpdesk Tools panel is only shown to users who have this role in the current course. Other institutions will have a different value.
- The permission check calls `GET /api/v1/courses/:id/enrollments?user_id=self` and looks for `role_id === 178` in the response. The same response is used to detect whether the user is already enrolled as Helpdesk (`role_id === 177`).
- `DEBUG = false` by default. Set to `true` in the source to enable verbose console logging.
- The student-completion check works by calling `GET /api/v1/courses/:id/modules?student_id=:id&include[]=items`, which returns each item's `completion_requirement.completed` boolean from the student's perspective.

---

## Disclaimer

This script was created for use by helpdesk staff at **Northern Kentucky University**. It is provided as-is, without warranty. Use at your own risk. Always verify completion status in Canvas directly.
