/**
 * Canvas Helpdesk Role — Theme Injection JavaScript
 *
 * PURPOSE
 * -------
 * This snippet detects whether the current user has the Helpdesk role in the
 * current course and, if so, adds the CSS class `canvas-role-helpdesk` to the
 * <html> element.  Once that class is present, the companion CSS file
 * (helpdesk-role-styles.css) activates role-specific visual changes — with no
 * Tampermonkey required.
 *
 * DEPLOYMENT
 * ----------
 * 1. Open Canvas as an admin.
 * 2. Go to Admin > [Your Account] > Themes (or Branding).
 * 3. In the theme editor, paste the CONTENTS of this file into the
 *    "Custom JavaScript" field (or upload it as a JS file if your theme
 *    editor supports file uploads).
 * 4. Similarly paste / upload helpdesk-role-styles.css into the
 *    "Custom CSS" field.
 * 5. Save and apply the theme.  The changes affect every user on every page,
 *    but the CSS rules only activate for users who have the Helpdesk role.
 *
 * LIMITATIONS vs. TAMPERMONKEY
 * -----------------------------
 * - Theme JS runs for ALL users on page load (minor performance cost).
 * - Theme JS cannot use GM_xmlhttpRequest; it uses the native fetch API with
 *   same-origin credentials instead.
 * - Theme JS cannot be easily tested locally — changes must be deployed
 *   through the Canvas theme editor.
 * - Theme JS/CSS is limited to visual changes; it cannot perform write
 *   operations like enrolling users.  For full automation use the
 *   Canvas Module Diagnostics userscript instead.
 *
 * INSTITUTION-SPECIFIC SETTINGS
 * ------------------------------
 * Change HELPDESK_ROLE_NAME below to match the exact role name used in your
 * Canvas instance.  You can find your role names by calling:
 *   GET /api/v1/accounts/:account_id/roles
 */

(function () {
    'use strict';

    // ── Configuration ────────────────────────────────────────────────────────

    // The exact Canvas role name to detect.  Must match the `role` field
    // returned by GET /api/v1/courses/:id/enrollments (case-sensitive).
    const HELPDESK_ROLE_NAME = 'Helpdesk';

    // CSS class added to <html> when the Helpdesk role is detected.
    // Used by helpdesk-role-styles.css to activate its rules.
    const HELPDESK_HTML_CLASS = 'canvas-role-helpdesk';

    // ── Run only on course pages ─────────────────────────────────────────────

    const courseMatch = window.location.pathname.match(/\/courses\/(\d+)/);
    if (!courseMatch) return;
    const courseId = courseMatch[1];

    // ── Role detection ───────────────────────────────────────────────────────

    // Fetch the current user's enrollments in this course via the Canvas REST
    // API using same-origin credentials (no cross-origin token needed).
    fetch(
        `/api/v1/courses/${courseId}/enrollments?user_id=self&per_page=50`,
        {
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-CSRF-Token': getCsrfToken(),
            },
        }
    )
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(enrollments => {
            const isHelpdesk = Array.isArray(enrollments) &&
                enrollments.some(e => e.role === HELPDESK_ROLE_NAME);
            if (isHelpdesk) {
                document.documentElement.classList.add(HELPDESK_HTML_CLASS);
            }
        })
        .catch(() => {
            // Silently ignore — failing to detect the role simply means
            // no helpdesk-specific CSS is applied, which is safe.
        });

    // ── CSRF token helper ────────────────────────────────────────────────────

    function getCsrfToken() {
        const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
        if (m) {
            try { return decodeURIComponent(m[1]); } catch (_) { /* fall through */ }
        }
        return document.querySelector('meta[name="csrf-token"]')?.content ?? '';
    }
})();
