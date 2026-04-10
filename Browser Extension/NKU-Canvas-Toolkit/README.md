# NKU Canvas Toolkit — Browser Extension

A sideloadable Chrome/Edge/Firefox browser extension that combines the **Canvas Enrollment Manager** and **Canvas Module Diagnostics** tools into a single panel. The panel is injected into Canvas course pages and displays only the sections each user is authorized to see, based on their account-level role.

---

## Features

| Section | Visible to | Capabilities |
|---|---|---|
| **Admin Toolkit** | Users with the **CETI** account role (ID 19) | Enroll self as Designer, unenroll self, run link validator, check assignment due dates |
| **Helpdesk Toolkit** | Users with the **Enroll Help Desk** account role (ID 178) | Enroll self as Helpdesk, unenroll self, scan module completion requirements, diagnose individual student completion issues |

Users who hold **both** roles see both sections in the same panel.

---

## Installation (Sideloading in Chrome or Edge)

1. **Download or clone** this repository.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `Browser Extension/NKU-Canvas-Toolkit` folder.
5. The extension is now active. Navigate to any NKU Canvas course page (`nku.instructure.com/courses/...`) to use it.

> **Note:** Chrome displays a persistent "Developer mode extensions" notification when unpacked extensions are loaded. This is expected behaviour for sideloaded extensions and does not indicate a problem.

---

## Installation (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select the `manifest.json` file inside `Browser Extension/NKU-Canvas-Toolkit`.
3. The extension loads for the current browser session only. Repeat after restarting Firefox.

For a permanent Firefox installation, the extension would need to be signed by Mozilla or deployed via enterprise policy.

---

## Automatic Updates

This extension does **not** auto-update when sideloaded. To update:

1. Pull the latest changes from the GitHub repository (or re-download the folder).
2. Open `chrome://extensions` and click the **reload** icon (↻) on the NKU Canvas Toolkit card.

The version icon (ℹ️) in the panel header checks GitHub daily and changes to 🔔 when a newer version is available, reminding you to reload after pulling the latest files.

---

## Role Requirements

The extension silently exits for users who do not hold either qualifying account-level role. No panel is rendered.

| Role | ID | Type | Panel section unlocked |
|---|---|---|---|
| CETI | 19 | AccountMembership | Admin Toolkit |
| Enroll Help Desk | 178 | AccountMembership | Helpdesk Toolkit |

Role IDs are NKU-specific. Users on other Canvas instances will need to look up their own role IDs via `GET /api/v1/accounts/:id/roles` and update the constants in `content.js`.

---

## Supported Domains

The extension only activates on the three NKU Canvas environments:

| Domain | Environment |
|---|---|
| `nku.instructure.com` | Production |
| `nku.beta.instructure.com` | Beta |
| `nku.test.instructure.com` | Test |

---

## Version History

| Version | Notes |
|---|---|
| 1.0 | Initial browser extension release. Combines Canvas Enrollment Manager v1.12 and Canvas Module Diagnostics v1.5 into a single role-gated panel. Replaces `GM_xmlhttpRequest` with `fetch()`. |

---

## Notes for Developers

- **No build step required.** The extension is plain JavaScript (ES2020). Load the folder directly from `chrome://extensions`.
- **API transport:** All Canvas API calls use `fetch()` with an `AbortController`-based timeout (replacing `GM_xmlhttpRequest` from the Tampermonkey versions). Cross-origin requests to `status.instructure.com` and `raw.githubusercontent.com` are permitted via `host_permissions` in `manifest.json`.
- **CSRF token:** Read from `document.cookie` (`_csrf_token`) and sent as the `X-CSRF-Token` request header on all mutating requests, matching the approach in the userscript versions.
- **Heading hierarchy:** The panel uses `h3` → `h4` → `h5` to maintain WCAG 2.1 AA heading structure.
- **Version bump:** Increment `"version"` in `manifest.json` **and** `SCRIPT_VERSION` in `content.js` together for every release.
- **Permissions:** The manifest requests only the minimum necessary host permissions. No `tabs`, `cookies`, `storage`, or background service worker permissions are used.

---

## Disclaimer

This extension was built and tested against NKU's Canvas instance. It is intended for use by authorized NKU staff only. NKU-specific values (role IDs, account ID `1`, etc.) may not apply to other Canvas instances.
