# GitHub Copilot Instructions

## Repository Overview

This repository contains **Tampermonkey userscripts** and utilities for Canvas LMS administrators and instructional designers at **Northern Kentucky University (NKU)**. Scripts are designed for use exclusively on NKU's Canvas instances.

## Repository Structure

```
Canvas-Helper-Scripts/
├── Admin Tools/
│   └── Canvas-Enrollment-Plugin/
│       ├── canvas-enrollment-manager.user.js   ← main userscript
│       └── README.md
│   └── README.md
└── README.md
```

New plugins go under `Admin Tools/<Plugin-Name>/` with their own `README.md` and `*.user.js` file.

---

## FERPA Compliance

**FERPA compliance is a top-priority requirement for every task in this repository.**

These tools are used by staff who have access to student education records. The Family Educational Rights and Privacy Act (FERPA) governs how that data must be handled.

- **Never log student data or Personally Identifiable Information (PII)** to the console, local storage, or any external service. PII includes (but is not limited to): student names, email addresses, user IDs, enrollment records, grades, and SIS IDs.
- If logging is absolutely necessary for a specific debug scenario, it must be gated behind `DEBUG = true` **and** the reason must be clearly documented in a comment at the point of the log call.
- API responses that contain student data must be consumed transiently in memory only — never persisted to `localStorage`, `sessionStorage`, cookies, or any cache that outlives the page session, unless the sole purpose of caching is a non-PII operational value (e.g., a version string or a timestamp with no user data attached).
- Tools must not transmit student data to any third-party service. All Canvas API calls must go directly to the institution's own Canvas domain.
- When designing new features, default to requesting the minimum Canvas API permissions and data fields needed. Avoid requesting roster data, grades, or SIS information unless the feature explicitly requires it.

---

## Accessibility (WCAG 2.1 AA)

All UI produced by scripts in this repository **must meet WCAG 2.1 Level AA** standards, which are required by federal law.

Key requirements to check on every UI change:

| Criterion | Requirement |
|---|---|
| **Color contrast** | Text must have a contrast ratio of at least 4.5:1 (3:1 for large text) against its background |
| **Keyboard navigation** | Every interactive element (buttons, links, inputs) must be reachable and operable by keyboard alone |
| **Focus indicators** | Visible focus rings must not be suppressed; use `:focus-visible` for custom styling |
| **ARIA roles/labels** | Dynamic regions and icon-only controls must carry descriptive `aria-label` or `aria-labelledby` attributes |
| **Status messages** | Live feedback (loading, success, error) must use `aria-live` regions so screen readers announce changes |
| **Semantic HTML** | Use `<button>` for actions, `<a>` for navigation, correct heading hierarchy (`h2` → `h3` → …) |
| **No reliance on color alone** | Status must also be conveyed through text or icons, not color alone |

When injecting UI into Canvas pages, test that the injected elements do not break the surrounding page's tab order.

---

## Script Conventions

### Tampermonkey Metadata Block

Every userscript **must** start with a valid `==UserScript==` metadata block. Required fields:

```js
// ==UserScript==
// @name         <Human-readable name>
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  <Short description>
// @author       NKU CETI
// @match        https://nku.instructure.com/courses/*
// @match        https://nku.beta.instructure.com/courses/*
// @match        https://nku.test.instructure.com/courses/*
// @grant        GM_xmlhttpRequest
// @connect      *.instructure.com
// @updateURL    https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/<path>/<script>.user.js
// @downloadURL  https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/<path>/<script>.user.js
// ==/UserScript==
```

- **`@match` must list all three NKU domains explicitly** — never use the wildcard `https://*.instructure.com/*`. Scripts are NKU-specific and must not run on other institutions' Canvas instances.
- `@grant GM_xmlhttpRequest` is required for cross-origin Canvas API calls.
- `@updateURL`/`@downloadURL` must always point to the `main` branch raw URL so Tampermonkey can auto-update.

### File Naming

Userscript files must end in `.user.js` so Tampermonkey recognizes them as installable scripts.

### Coding Style

- Wrap everything in an **IIFE**: `(function () { 'use strict'; ... })();`
- Prefer `const`/`let` over `var`.
- Keep a `const DEBUG = false;` flag at the top. When `true`, verbose output goes through a `log()` helper that wraps `console.log`; errors always go to `console.error`. Never log PII even when `DEBUG` is `true` — see FERPA section above.
- Named constants for all magic values (timeouts, role IDs, URLs, cache keys, etc.).

### Canvas API Calls

- Use `GM_xmlhttpRequest` for all Canvas API requests (cross-origin requirement).
- Read the CSRF token from `document.cookie` (`_csrf_token` / `csrfToken`) and pass it as the `X-CSRF-Token` header on mutating requests (POST/PUT/DELETE).
- The Canvas REST API base path is `/api/v1/`.
- Include `Content-Type: application/json` and `Accept: application/json` on JSON requests.

### NKU-Specific Values

#### NKU Canvas Domains

Scripts must only run on these three domains (enforced via `@match`):

| Domain | Environment |
|---|---|
| `nku.instructure.com` | Production |
| `nku.beta.instructure.com` | Beta |
| `nku.test.instructure.com` | Test |

#### NKU Canvas Roles

The following roles are defined in NKU's Canvas instance (retrieved via `GET /api/v1/accounts/1/roles`). Use these IDs when building enrollment or permission logic.

| ID | Role key | Label | Type | Base role |
|---|---|---|---|---|
| 1 | `AccountAdmin` | Account Admin | Account | `AccountMembership` |
| 3 | `StudentEnrollment` | Student | Course | `StudentEnrollment` |
| 4 | `TeacherEnrollment` | Teacher | Course | `TeacherEnrollment` |
| 5 | `TaEnrollment` | TA | Course | `TaEnrollment` |
| 6 | `DesignerEnrollment` | Designer | Course | `DesignerEnrollment` |
| 7 | `ObserverEnrollment` | Observer | Course | `ObserverEnrollment` |
| 19 | `CETI` | CETI | Account | `AccountMembership` (custom) |
| 27 | `RPT Builder` | RPT Builder | Course | `TeacherEnrollment` (custom) |
| 29 | `Outcomes Service` | Outcomes Service | Account | `AccountMembership` (custom) |
| 31 | `Quizzes.Next Service` | Quizzes.Next Service | Account | `AccountMembership` (custom) |

**`DESIGNER_ROLE_ID = 6`** — Use this constant when enrolling users as Designer. (Role ID 5 is TaEnrollment, not Designer.)

### Version Numbering

- `1.x` → bug fixes and minor improvements
- `x.0` → major new features or breaking changes

Always update the `@version` field in the metadata block **and** the `SCRIPT_VERSION` constant in the script body together.

---

## Canvas API Reference

**Primary reference: [Instructure Developer Documentation](https://developerdocs.instructure.com/)**
Use this documentation to understand every API endpoint before implementing it — including required parameters, optional fields, expected response shapes, and pagination behaviour.

Secondary reference: https://canvas.instructure.com/doc/api/ (legacy, less detailed)

### Common endpoints used in this repository

| Action | Endpoint |
|---|---|
| Enroll a user | `POST /api/v1/courses/:courseId/enrollments` |
| Unenroll a user | `DELETE /api/v1/courses/:courseId/enrollments/:enrollmentId?task=delete` |
| List enrollments | `GET /api/v1/courses/:courseId/enrollments?user_id=:userId` |
| Link validation (start) | `POST /api/v1/courses/:courseId/link_validation` |
| Link validation (poll) | `GET /api/v1/courses/:courseId/link_validation` |
| Course permissions | `GET /api/v1/courses/:courseId/permissions` |
| Assignments | `GET /api/v1/courses/:courseId/assignments` |
| Course sections | `GET /api/v1/courses/:courseId/sections` |
| Account roles | `GET /api/v1/accounts/:accountId/roles` |
| Current user profile | `GET /api/v1/users/self/profile` |

---

## Community Resources

- **[jamesjonesmath/canvancement](https://github.com/jamesjonesmath/canvancement)** (ISC licence) — a well-maintained collection of Canvas userscripts. Check here first for Canvas API patterns and prior art before writing new Canvas integrations from scratch.

---

## Adding a New Plugin

1. Create `Admin Tools/<Plugin-Name>/` directory.
2. Add `<plugin-name>.user.js` (follow the conventions above).
3. Add a `README.md` with: Features table, Installation steps, Automatic Updates section, Version History table, Notes for Developers, and Disclaimer.
4. Add a row to the table in `Admin Tools/README.md`.

---

## Institution Notes

Scripts are built and tested against **NKU's Canvas instance** and must only run there. The three NKU domains are the only permitted `@match` values. Do not use `*.instructure.com` wildcards.

If adapting a script for another institution (outside this repository):
- Replace all three NKU `@match` entries with the target institution's domain.
- Look up the correct role IDs via `GET /api/v1/accounts/:id/roles` on that instance.
- Verify CSRF token handling matches the target instance.
- Re-evaluate FERPA or equivalent data-privacy obligations for that institution.
