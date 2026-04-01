# Canvas Helper Scripts

A collection of Tampermonkey userscripts and utilities for Canvas LMS administrators and instructional designers at **Northern Kentucky University (NKU)**.

> **⚠️ Institution-specific**
> Scripts in this repository are built and tested against NKU's Canvas instance (`nku.instructure.com`). Some settings (e.g. role IDs) may need adjustment for use at other institutions.

---

## Repository Structure

| Folder | Description |
|---|---|
| [Admin Tools](./Admin%20Tools) | Plugins for Canvas admins and instructional designers — enrollment management, link validation, and more |
| [Instructor Tools](./Instructor%20Tools) | Plugins for Canvas instructors and TAs — course health checks, link validation, due-date analysis, grade weighting diagnostics, and CETI appointment booking |

---

## Quick Start

All scripts are Tampermonkey userscripts.

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Browse to the folder for the tool you want (see the table above).
3. Follow the installation instructions in that folder's README.

---

## Versioning

Scripts follow a simple three-part version number: **`MAJOR.MINOR.PATCH`**

| Segment | When to increment | Example |
|---|---|---|
| `MAJOR` (first number) | Complete rewrites, fundamental behaviour changes, or intentional breaking changes | `1.x` → `2.0` |
| `MINOR` (second number) | New features, new diagnostics, new UI sections, or meaningful removals — anything a user would notice | `1.0` → `1.1` |
| `PATCH` (third number) | Bug fixes, typo corrections, and internal refactors with no visible change | `1.1` → `1.1.1` |

**In practice**, most updates to these scripts will be `MINOR` bumps. Reserve `MAJOR` increments for genuine rewrites. Tampermonkey only requires the version to be *higher* than the installed one to offer an update, so any increment works — but using the right segment makes the changelog easier to read.

---

## Disclaimer

These scripts were created for use by Faculty and Staff at **Northern Kentucky University**. They are provided as-is, without warranty. Use at your own risk.
