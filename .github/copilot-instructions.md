# GitHub Copilot Instructions

## Repository Overview

This repository contains **Tampermonkey userscripts** and utilities for Canvas LMS administrators and instructional designers at **Northern Kentucky University (NKU)**. Scripts are designed primarily for NKU's Canvas instances; they may load on other Canvas instances but NKU-specific values (role IDs, domain checks, etc.) will differ.

## Repository Structure

```
Canvas-Helper-Scripts/
├── Admin Tools/
│   ├── Canvas-Enrollment-Plugin/
│   │   └── canvas-enrollment-manager.user.js   ← main userscript
│   └── README.md
├── Helpdesk Tools/
│   ├── Canvas-Module-Diagnostics/
│   │   └── canvas-module-diagnostics.user.js   ← helpdesk userscript
│   ├── Custom-CSS-Theme/
│   │   ├── theme-inject.js
│   │   └── helpdesk-role-styles.css
│   └── README.md
└── README.md
```

New plugins for Canvas admins and instructional designers go under `Admin Tools/<Plugin-Name>/`.
New tools for helpdesk staff go under `Helpdesk Tools/<Tool-Name>/`.
Both follow the same conventions: each folder has its own `README.md` and `*.user.js` file.

---

## FERPA Compliance

**FERPA compliance is a top-priority requirement for every task in this repository.**

These tools are used by staff who have access to student education records. The Family Educational Rights and Privacy Act (FERPA) governs how that data must be handled.

- **Never log student data or Personally Identifiable Information (PII)** to the console, local storage, or any external service. PII includes (but is not limited to): student names, email addresses, user IDs, enrollment records, grades, and SIS IDs.
- If logging is absolutely necessary for a specific debug scenario, it must be gated behind `DEBUG = true` **and** the reason must be clearly documented in a comment at the point of the log call.
- API responses that contain student data must be consumed transiently in memory only — never persisted to `localStorage`, `sessionStorage`, cookies, or any cache that outlives the page session, unless the sole purpose of caching is a non-PII operational value (e.g., a version string or a timestamp with no user data attached).
- Tools must not transmit student data to any third-party service. All Canvas API calls must go directly to the institution's own Canvas domain.
- When designing new features, default to requesting the minimum Canvas API permissions and data fields needed. Avoid requesting roster data, grades, or SIS information unless the feature explicitly requires it.

### Agent Session Data Handling

When an AI coding agent (e.g., GitHub Copilot) works in this repository, it may encounter sensitive information in API responses, logs, test fixtures, or user-provided context. The following rules govern what an agent **must never** do with that information:

- **Do not store PII or sensitive data in agent memory.** The `store_memory` tool (or any equivalent persistent-memory mechanism) must only be used for codebase conventions, patterns, and non-sensitive technical facts. Never save student names, user IDs, email addresses, enrollment records, grades, SIS IDs, API tokens, passwords, or any other PII — even in summarised or paraphrased form.
- **Do not include sensitive data in commit messages, PR descriptions, or code comments.** If a real value must be shown as an example, use a clearly fictional placeholder (e.g., `user_12345`, `student@example.com`).
- **Treat sensitive data as transient.** Any PII or credentials encountered during a session exist only in the current context window. Do not reference, repeat, or act on them beyond the immediate task at hand.
- **Do not transmit sensitive data outside the repository's own Canvas domain.** All Canvas API calls that handle or may handle student data must target the institution's own `*.instructure.com` endpoint. Non-PII operational requests (for example, version or status checks) to third-party services are allowed, but they must never include PII or credentials.
- **When in doubt, omit.** If it is unclear whether a value is sensitive, treat it as sensitive and do not persist or share it.

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
// @match        https://*.instructure.com/courses/*
// @grant        GM_xmlhttpRequest
// @connect      *.instructure.com
// @updateURL    https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/<path>/<script>.user.js
// @downloadURL  https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/<path>/<script>.user.js
// ==/UserScript==
```

- `@match` uses the `*.instructure.com` wildcard so the script loads on any Canvas instance. Scripts detect the current domain at runtime and show a contextual warning to users on non-NKU instances where NKU-specific values (role IDs, etc.) may not apply.
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

Scripts load on any Canvas instance via the `*.instructure.com` wildcard `@match`, but NKU-specific values (role IDs, domain-gated features, etc.) are only guaranteed to work on these three domains. Users on other instances will see a contextual warning at runtime.

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
| 177 | `Helpdesk` | Helpdesk | Course | `TeacherEnrollment` (custom) |
| 178 | `Enroll Help Desk` | Enroll Help Desk | Account | `AccountMembership` (custom) |

**`DESIGNER_ROLE_ID = 6`** — Use this constant when enrolling users as Designer. (Role ID 5 is TaEnrollment, not Designer.)

**`HELPDESK_ROLE_ID = 177`** — Course enrollment role for helpdesk staff. Used in `canvas-module-diagnostics.user.js`.

**`ENROLL_HELPDESK_ADMIN_ROLE_ID = 178`** — Admin permission role ("Enroll Help Desk"). Users with this role can enroll/unenroll the Helpdesk role in courses. The Helpdesk Tools panel is only shown to users who hold this role.

### Version Numbering

- `1.x` → bug fixes and minor improvements
- `x.0` → major new features or breaking changes

Always update the `@version` field in the metadata block **and** the `SCRIPT_VERSION` constant in the script body together.

---

## Canvas API Reference

**Primary reference: [Instructure Developer Documentation](https://developerdocs.instructure.com/)**
Use this documentation to understand every API endpoint before implementing it — including required parameters, optional fields, expected response shapes, and pagination behaviour.

Secondary reference: https://canvas.instructure.com/doc/api/ (legacy, less detailed)

### Pagination

The Canvas REST API paginates list responses. The next page URL is returned in the `Link` response header with `rel="next"`. Scripts that fetch lists (enrollments, assignments, sections, etc.) **must** follow pagination links until no `rel="next"` is present, or results will be silently truncated.

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
- **[Kaltura Developer Portal](https://developer.kaltura.com)** — reference for Kaltura media API. NKU uses Kaltura for video/media; future tools may interact with Kaltura session tokens, media entries, or the KMC. Consult this documentation before implementing any Kaltura integration.

---

## Adding a New Plugin

**Admin tools** (for Canvas admins / instructional designers):
1. Create `Admin Tools/<Plugin-Name>/` directory.
2. Add `<plugin-name>.user.js` (follow the conventions above).
3. Add a `README.md` with: Features table, Installation steps, Automatic Updates section, Version History table, Notes for Developers, and Disclaimer.
4. Add a row to the table in `Admin Tools/README.md`.

**Helpdesk tools** (for helpdesk staff):
1. Create `Helpdesk Tools/<Tool-Name>/` directory.
2. Add `<tool-name>.user.js` (follow the conventions above).
3. Add a `README.md` with the same sections listed above.
4. Add a row to the table in `Helpdesk Tools/README.md`.

---

## Institution Notes

Scripts are built and tested against **NKU's Canvas instance**. They load on any Canvas instance via the `*.instructure.com` wildcard `@match`, but display a contextual warning when run outside the three NKU domains, since NKU-specific values (role IDs, etc.) will not match.

### NKU Canvas Instance Details

| Property | Value |
|---|---|
| Root account ID | `1` (used in account-scoped API calls, e.g. `GET /api/v1/accounts/1/roles`) |
| Default timezone | `America/New_York` |
| SIS integration | Active — `sis_course_id`, `sis_user_id`, and `sis_section_id` fields appear in API responses and are FERPA-protected; avoid logging or persisting them |

### Adapting for another institution

- Look up the correct role IDs via `GET /api/v1/accounts/:id/roles` on that instance — NKU's IDs (especially `DESIGNER_ROLE_ID = 6`) will likely differ.
- Verify CSRF token handling matches the target instance.
- Re-evaluate FERPA or equivalent data-privacy obligations for that institution.
