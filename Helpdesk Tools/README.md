# Helpdesk Tools

This folder contains tools for helpdesk staff at **Northern Kentucky University** who support instructors and students using Canvas LMS.

Helpdesk workers can enroll themselves in courses using the **Helpdesk** Canvas role, which gives them read access to diagnose issues without disrupting course settings.

Each sub-folder is a self-contained tool with its own README and installation instructions.

---

## Available Tools

| Tool | Type | Description |
|---|---|---|
| [Canvas-Module-Diagnostics](./Canvas-Module-Diagnostics/) | Tampermonkey userscript | Adds a **Helpdesk Tools** panel to course pages — enroll as Helpdesk, scan module completion requirements, and diagnose individual student issues |
| [Custom-CSS-Theme](./Custom-CSS-Theme/) | Canvas theme injection | Role-targeted CSS/JS deployed by an admin via the Canvas Theme Editor — highlights completion-related UI for Helpdesk users with no browser extension required |

---

## Which Tool Should I Use?

| Need | Recommended tool |
|---|---|
| Interactive diagnostics (find which items block a specific student) | Canvas Module Diagnostics (userscript) |
| Enroll/unenroll yourself in a course as Helpdesk | Canvas Module Diagnostics (userscript) |
| Subtle visual enhancements for all helpdesk staff, no install required | Custom CSS Theme |
| Quick highlight of locked/required items while on a support call | Custom CSS Theme |

The tools complement each other and can be used together.

---

## Installation

- **Userscripts** — Install [Tampermonkey](https://www.tampermonkey.net/), then follow the installation link in the relevant sub-folder README.
- **Custom CSS Theme** — Deployed once by a Canvas administrator via Admin > Themes; end users need no software.
