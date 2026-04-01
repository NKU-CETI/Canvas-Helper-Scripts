# Canvas Helper Scripts

A collection of Tampermonkey userscripts and utilities for Canvas LMS administrators and instructional designers at **Northern Kentucky University (NKU)**.

> **⚠️ Institution-specific**
> Scripts in this repository are built and tested against NKU's Canvas instance (`nku.instructure.com`). Some settings (e.g. role IDs) may need adjustment for use at other institutions.

---

## Repository Structure

| Folder | Description |
|---|---|
| [Admin Tools](./Admin%20Tools) | Plugins for Canvas admins and instructional designers — enrollment management, link validation, and more |
| [Helpdesk Tools](./Helpdesk%20Tools) | Tools for helpdesk staff — module completion diagnostics, student issue lookup, and a Canvas theme for role-specific UI enhancements |

---

## Quick Start

All scripts are Tampermonkey userscripts.

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Browse to the folder for the tool you want (see the table above).
3. Follow the installation instructions in that folder's README.

---

## Versioning

Scripts use simple numeric version numbers compatible with Tampermonkey. The canonical form is three-part: **`MAJOR.MINOR.PATCH`**, but scripts may also use a two-part form **`MAJOR.MINOR`**, which is treated as **`MAJOR.MINOR.0`**.

| Segment | When to increment | Example |
|---|---|---|
| `MAJOR` (first number) | Complete rewrites, fundamental behaviour changes, or intentional breaking changes | `1.x` → `2.0` |
| `MINOR` (second number) | New features, new diagnostics, new UI sections, or meaningful removals — anything a user would notice | `1.0` → `1.1` |
| `PATCH` (third number, optional) | Bug fixes, typo corrections, and internal refactors with no visible change. If omitted in a script header, it is assumed to be `0` (so `1.5` = `1.5.0`). | `1.1` → `1.1.1` |

**In practice**, most updates to these scripts will be `MINOR` bumps. Reserve `MAJOR` increments for genuine rewrites. Tampermonkey only requires the version to be *higher* than the installed one to offer an update, so any increment works — but using the right segment (and treating two-part versions as `.0` patch) makes the changelog easier to read and keeps update ordering predictable.

---

## Disclaimer

These scripts were created for use by Faculty and Staff at **Northern Kentucky University**. They are provided as-is, without warranty. Use at your own risk.
