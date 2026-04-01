# GitHub Copilot Instructions

## Repository Overview

This repository contains **Tampermonkey userscripts** and utilities for Canvas LMS administrators and instructional designers at **Northern Kentucky University (NKU)**. Scripts are designed for use on NKU's Canvas instance (`nku.instructure.com`).

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

- `@match` targets Canvas course pages by default; adjust as needed.
- `@grant GM_xmlhttpRequest` is required for cross-origin Canvas API calls.
- `@updateURL`/`@downloadURL` must always point to the `main` branch raw URL so Tampermonkey can auto-update.

### File Naming

Userscript files must end in `.user.js` so Tampermonkey recognizes them as installable scripts.

### Coding Style

- Wrap everything in an **IIFE**: `(function () { 'use strict'; ... })();`
- Prefer `const`/`let` over `var`.
- Keep a `const DEBUG = false;` flag at the top. When `true`, verbose output goes through a `log()` helper that wraps `console.log`; errors always go to `console.error`.
- Named constants for all magic values (timeouts, role IDs, URLs, cache keys, etc.).

### Canvas API Calls

- Use `GM_xmlhttpRequest` for all Canvas API requests (cross-origin requirement).
- Read the CSRF token from `document.cookie` (`_csrf_token` / `csrfToken`) and pass it as the `X-CSRF-Token` header on mutating requests (POST/PUT/DELETE).
- The Canvas REST API base path is `/api/v1/`.
- Include `Content-Type: application/json` and `Accept: application/json` on JSON requests.

### NKU-Specific Values

| Constant | Value | Notes |
|---|---|---|
| `DESIGNER_ROLE_ID` | `5` | NKU's internal Canvas role ID for the Designer role. Other institutions will differ — check via `GET /api/v1/accounts/:id/roles`. |
| NKU domains | `nku.instructure.com`, `nku.beta.instructure.com`, `nku.test.instructure.com` | Used for domain checks. |

### Version Numbering

- `1.x` → bug fixes and minor improvements
- `x.0` → major new features or breaking changes

Always update the `@version` field in the metadata block **and** the `SCRIPT_VERSION` constant in the script body together.

## Canvas API Reference

- **Enroll a user:** `POST /api/v1/courses/:courseId/enrollments`
- **Unenroll a user:** `DELETE /api/v1/courses/:courseId/enrollments/:enrollmentId?task=delete`
- **List enrollments:** `GET /api/v1/courses/:courseId/enrollments?user_id=:userId`
- **Link validation:** `POST /api/v1/courses/:courseId/link_validation` then poll `GET /api/v1/courses/:courseId/link_validation`
- **Course permissions:** `GET /api/v1/courses/:courseId/permissions`
- **Assignments:** `GET /api/v1/courses/:courseId/assignments`
- **Course sections:** `GET /api/v1/courses/:courseId/sections`

Canvas API docs: https://canvas.instructure.com/doc/api/

## Community Resources

- **[jamesjonesmath/canvancement](https://github.com/jamesjonesmath/canvancement)** (ISC licence) — a well-maintained collection of Canvas userscripts. Check here first for Canvas API patterns and prior art before writing new Canvas integrations from scratch.

## Adding a New Plugin

1. Create `Admin Tools/<Plugin-Name>/` directory.
2. Add `<plugin-name>.user.js` (follow the conventions above).
3. Add a `README.md` with: Features table, Installation steps, Automatic Updates section, Version History table, Notes for Developers, and Disclaimer.
4. Add a row to the table in `Admin Tools/README.md`.

## Institution Notes

Scripts are built and tested against **NKU's Canvas instance**. When adapting for another institution:
- Update `DESIGNER_ROLE_ID` to the correct role ID.
- Update any hardcoded domain checks.
- Verify CSRF token handling matches the target instance.
