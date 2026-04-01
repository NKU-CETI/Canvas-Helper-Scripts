# Canvas Helpdesk Role — Custom CSS Theme

A **no-Tampermonkey** alternative for surfacing helpdesk-relevant information in Canvas.

Two files are deployed once by a Canvas admin into the institution's **Theme Editor**. After that, any user with the Helpdesk role automatically receives the enhanced view — without installing any browser extension.

> **⚠️ Made for Northern Kentucky University (NKU)**
> Role names (e.g. `Helpdesk`) and Canvas DOM selectors may differ at other institutions. See the notes below before deploying.

---

## Files

| File | Purpose |
|---|---|
| `theme-inject.js` | Detects the Helpdesk role via the Canvas enrollments API and adds a CSS class to `<html>` |
| `helpdesk-role-styles.css` | CSS rules that activate only when that class is present |

---

## How it Works

1. On every Canvas course page, `theme-inject.js` calls `GET /api/v1/courses/:id/enrollments?user_id=self` (same-origin, no Tampermonkey needed).
2. If any returned enrollment has `role === "Helpdesk"`, the class `canvas-role-helpdesk` is added to the `<html>` element.
3. All CSS rules in `helpdesk-role-styles.css` are scoped to `html.canvas-role-helpdesk`, so they only activate for those users.
4. For every other user the page is completely unchanged.

---

## Deployment

1. Log in to Canvas as an administrator.
2. Go to **Admin → [Your Account] → Themes** (also called "Branding" in some Canvas versions).
3. Open or create the theme you want to modify, then:
   - Paste the **contents** of `helpdesk-role-styles.css` into the **Custom CSS** field.
   - Paste the **contents** of `theme-inject.js` into the **Custom JavaScript** field.
4. Save and **Apply** the theme.

Changes take effect immediately for all users on that account.

---

## Visual Changes (with Default CSS)

| Change | Who sees it |
|---|---|
| `[HD]` badge appended to the nav profile link | Helpdesk users only |
| Module completion-requirement labels highlighted in blue | Helpdesk users only |
| Informational banner at the top of the modules list | Helpdesk users only |
| Orange left border on locked module items | Helpdesk users only |

All selectors in `helpdesk-role-styles.css` are commented and can be removed or adjusted.

---

## Customisation

- **Role name** — Change `HELPDESK_ROLE_NAME` in `theme-inject.js` to match your institution's exact role name (case-sensitive, must match the `role` field returned by `GET /api/v1/accounts/:id/roles`).
- **CSS selectors** — Canvas DOM structure can vary between pages and Canvas versions. Use your browser's DevTools inspector to verify selectors against a live page before deploying.

---

## Limitations vs. Tampermonkey

| Capability | Theme JS/CSS | Tampermonkey Userscript |
|---|---|---|
| No install for end users | ✅ | ❌ (requires extension) |
| Visual-only changes | ✅ | ✅ |
| API write operations (enroll/unenroll) | ❌ | ✅ |
| Cross-origin requests | ❌ | ✅ (via GM_xmlhttpRequest) |
| Interactive diagnostic UI | ❌ | ✅ |
| Per-user opt-in | ❌ (affects all matching users) | ✅ |

For the full interactive module completion diagnostic tool, see the [Canvas Module Diagnostics](../Canvas-Module-Diagnostics/) userscript.

---

## Disclaimer

These files were created for use by helpdesk staff at **Northern Kentucky University**. They are provided as-is, without warranty. Always test theme changes in a Canvas test/beta environment before applying them to production.
