// NKU Canvas Toolkit — browser extension content script
// Combines Canvas Enrollment Manager (Admin Toolkit) and Canvas Module Diagnostics (Helpdesk Toolkit).
//
// Role-gated access:
//   AccountAdmin (role ID 1)               → both sections (full Canvas account admin)
//   CETI account role (ID 19)              → Admin Toolkit   (enroll as Designer + course health checks)
//   Enroll Help Desk account role (ID 178) → Helpdesk Toolkit (enroll as Helpdesk + module diagnostics)
//   Multiple roles present                 → all entitled sections visible in a single panel
//
// Section visibility can also be toggled per-user via the extension popup (toolbar icon).
//
// Author: NKU CETI
// Version: 1.1

(function () {
    'use strict';

    // ─── Constants ────────────────────────────────────────────────────────────

    const SCRIPT_VERSION = '1.1';
    const DEBUG = false;
    const REQUEST_TIMEOUT_MS = 15000;
    const LINK_VALIDATOR_POLL_INTERVAL_MS = 4000;
    // After this many polls without seeing queued/running, accept a completed result anyway.
    // This covers fast jobs that finish before the first poll can observe them in-progress.
    // 3 polls × 4 s = 12 s maximum wait before showing results.
    const LINK_VALIDATOR_GRACE_POLLS = 3;
    const ACCOUNT_ADMIN_ROLE_ID = 1;  // Full Canvas account admin — grants access to both sections
    const DESIGNER_ROLE_ID = 6;    // NKU's Canvas role ID for the Designer enrollment role (DesignerEnrollment)
    const CETI_ADMIN_ROLE_ID = 19; // Account-level CETI role — grants Admin Toolkit access
    const HELPDESK_ROLE_ID = 177;  // Course enrollment role: "Helpdesk"
    const HELPDESK_ROLE_NAME = 'Helpdesk';
    const ENROLL_HELPDESK_ADMIN_ROLE_ID = 178; // Account-level "Enroll Help Desk" role — grants Helpdesk Toolkit access
    const CETI_EMAIL = 'CETI@nku.edu';
    const CANVAS_STATUS_URL = 'https://status.instructure.com/api/v2/summary.json';
    const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main';
    // Version check fetches this extension's manifest.json from GitHub to compare versions.
    // The path must be URL-encoded because the directory name contains a space.
    const UPDATE_CHECK_URL = `${GITHUB_RAW_BASE}/Browser%20Extension/NKU-Canvas-Toolkit/manifest.json`;
    const VERSION_TOOLTIP_BASE = `NKU Canvas Toolkit v${SCRIPT_VERSION}\nCombined admin and helpdesk tools for NKU Canvas.\nMade for Northern Kentucky University.`;
    const VERSION_CHECK_CACHE_KEY = 'nku_toolkit_version_check';
    const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const COLLAPSED_STORAGE_KEY = 'nku_toolkit_collapsed';
    const HEALTH_COLLAPSED_STORAGE_KEY = 'nku_toolkit_health_collapsed';
    const MS_PER_MINUTE = 60000;
    const MS_PER_HOUR = 3600000;
    const MS_PER_DAY = 86400000;
    // Canvas status page components to monitor; others are excluded to avoid
    // showing alerts for services NKU does not use.
    const RELEVANT_COMPONENTS = new Set([
        'Canvas LMS',
        'Canvas Commons',
        'Canvas Data 2',
        'Canvas Mobile',
        'Canvas Portfolio',
        'AWS Region us-east-1',
        'Support Tools',
    ]);
    // Human-readable labels for each Canvas completion requirement type
    const COMPLETION_TYPE_LABELS = {
        must_view: 'Must View',
        must_mark_done: 'Must Mark Done',
        must_contribute: 'Must Contribute',
        must_submit: 'Must Submit',
        min_score: 'Min Score',
    };

    const log = (...args) => DEBUG && console.log('NKU Canvas Toolkit:', ...args);
    const warn = (...args) => console.warn('NKU Canvas Toolkit:', ...args);
    const err = (...args) => console.error('NKU Canvas Toolkit:', ...args);

    // ─── Global state ─────────────────────────────────────────────────────────

    const domain = window.location.hostname;
    let courseId;
    let userId;
    let panelContainer;
    let toggleBtn = null;
    let panelBodyEl = null;
    let titleBadgeEl = null;
    let linkValidatorPollInterval = null;
    let lastRunTimerInterval = null;
    let lastRunLineEl = null;
    // Per-check issue flags; recomputed on every result so the badge clears
    // automatically when a re-run reports no issues.
    const panelIssues = { canvasStatus: false, linkValidator: false, dueDates: false };

    // ─── Page check ───────────────────────────────────────────────────────────

    // Only run on course pages
    const courseIdMatch = window.location.pathname.match(/\/courses\/(\d+)/);
    if (!courseIdMatch) {
        log('Not on a course page, exiting');
        return;
    }
    courseId = courseIdMatch[1];
    log('Found course ID:', courseId);

    // Only show the panel on the course home page and the course settings page.
    // Speedgrader, modules, assignments, and other sub-pages should be unaffected.
    const path = window.location.pathname;
    const isCoursePage = /^\/courses\/\d+\/?$/.test(path);
    const isSettingsPage = /^\/courses\/\d+\/settings/.test(path);
    if (!isCoursePage && !isSettingsPage) {
        log('Not on course home or settings page, exiting');
        return;
    }

    // ─── Entry point ──────────────────────────────────────────────────────────

    // Try to get user ID from the page synchronously (methods 1–3), then fall
    // back to the API if not found.
    userId = getUserId();
    if (userId) {
        checkPermissionsAndProceed();
    } else {
        fetchUserIdFromAPI();
    }

    // ─── User ID helpers ──────────────────────────────────────────────────────

    function getUserId() {
        // Method 1: Canvas ENV variable
        if (typeof ENV !== 'undefined' && ENV.current_user_id) {
            log('Found user ID from ENV:', ENV.current_user_id);
            return ENV.current_user_id;
        }
        // Method 2: Profile link href
        const profileLink = document.querySelector('a[href*="/profile"]');
        if (profileLink) {
            const match = /\/users\/(\d+)/.exec(profileLink.getAttribute('href'));
            if (match) {
                log('Found user ID from profile link:', match[1]);
                return match[1];
            }
        }
        // Method 3: Body data attribute
        const dataUserId = document.body.getAttribute('data-user-id');
        if (dataUserId) {
            log('Found user ID from body attribute:', dataUserId);
            return dataUserId;
        }
        return null;
    }

    function fetchUserIdFromAPI() {
        log('Fetching user ID from API');
        makeApiCall(`https://${domain}/api/v1/users/self/profile`, 'GET', null, getCsrfToken(),
            (data) => {
                if (data && data.id) {
                    userId = data.id;
                    log('Found user ID from API:', userId);
                    checkPermissionsAndProceed();
                }
            },
            (error) => { err('Failed to get user profile from API:', error); }
        );
    }

    // ─── Permission check ─────────────────────────────────────────────────────

    // Fetches the current user's account-admin entries for account 1 and checks
    // for qualifying roles in a single API call:
    //   ACCOUNT_ADMIN_ROLE_ID (1)            → full account admin — grants access to both sections
    //   CETI_ADMIN_ROLE_ID (19)              → show Admin Toolkit section
    //   ENROLL_HELPDESK_ADMIN_ROLE_ID (178)  → show Helpdesk Toolkit section
    // If neither role is found, the panel is not rendered (silent exit).
    // User preferences (popup toggles) are layered on top: even if a role grants
    // access, a section that has been disabled in the popup will not be shown.
    function checkPermissionsAndProceed() {
        log('Checking account admin roles (AccountAdmin:', ACCOUNT_ADMIN_ROLE_ID,
            ', CETI:', CETI_ADMIN_ROLE_ID, ', Enroll Help Desk:', ENROLL_HELPDESK_ADMIN_ROLE_ID, ')');
        const adminsUrl = `https://${domain}/api/v1/accounts/1/admins?user_id=${userId}&per_page=100`;
        fetchAllPagesRaw(adminsUrl, getCsrfToken(), [],
            (admins) => {
                const isAccountAdmin = admins.some(a => a.role_id === ACCOUNT_ADMIN_ROLE_ID);
                // AccountAdmin inherits access to both sections.
                const hasCetiRole = isAccountAdmin || admins.some(a => a.role_id === CETI_ADMIN_ROLE_ID);
                const hasHelpdeskAdminRole = isAccountAdmin || admins.some(a => a.role_id === ENROLL_HELPDESK_ADMIN_ROLE_ID);

                if (!hasCetiRole && !hasHelpdeskAdminRole) {
                    log('User has no qualifying account role, hiding panel');
                    return;
                }

                log('User has qualifying role(s) — hasCetiRole:', hasCetiRole,
                    ', hasHelpdeskAdminRole:', hasHelpdeskAdminRole,
                    ', isAccountAdmin:', isAccountAdmin);

                // Fetch current course enrollments to determine enroll/unenroll button state.
                const enrollUrl = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=100`;
                fetchAllPagesRaw(enrollUrl, getCsrfToken(), [],
                    (enrollments) => {
                        const isDesignerEnrolled = hasCetiRole
                            ? enrollments.some(e => e.type === 'DesignerEnrollment' || e.type === 'TeacherEnrollment')
                            : null;
                        const isHelpdeskEnrolled = hasHelpdeskAdminRole
                            ? enrollments.some(e => e.role_id === HELPDESK_ROLE_ID)
                            : null;
                        applyPrefsAndInit(hasCetiRole, isDesignerEnrolled, hasHelpdeskAdminRole, isHelpdeskEnrolled);
                    },
                    (error) => {
                        log('Course enrollment check failed:', error);
                        applyPrefsAndInit(hasCetiRole, null, hasHelpdeskAdminRole, null);
                    }
                );
            },
            (error) => {
                log('Account permission check failed:', error);
                // Silently exit — do not render a panel if the permission check fails.
            }
        );
    }

    // Reads the user's popup preferences from chrome.storage.sync and gates
    // each section behind both the role flag and the user preference.
    function applyPrefsAndInit(hasCetiRole, isDesignerEnrolled, hasHelpdeskAdminRole, isHelpdeskEnrolled) {
        const defaults = { adminSectionEnabled: true, helpdeskSectionEnabled: true };
        chrome.storage.sync.get(defaults, (prefs) => {
            const showAdmin = hasCetiRole && prefs.adminSectionEnabled;
            const showHelpdesk = hasHelpdeskAdminRole && prefs.helpdeskSectionEnabled;

            if (!showAdmin && !showHelpdesk) {
                log('All sections hidden (roles or popup preferences) — not rendering panel');
                return;
            }

            initializePanel(showAdmin, isDesignerEnrolled, showHelpdesk, isHelpdeskEnrolled);
        });
    }

    // ─── Panel initialization ─────────────────────────────────────────────────

    function initializePanel(hasCetiRole, isDesignerEnrolled, hasHelpdeskAdminRole, isHelpdeskEnrolled) {
        if (document.getElementById('nku-toolkit-container')) return;

        panelIssues.canvasStatus = false;
        panelIssues.linkValidator = false;
        panelIssues.dueDates = false;

        panelContainer = document.createElement('div');
        panelContainer.id = 'nku-toolkit-container';
        Object.assign(panelContainer.style, {
            margin: '10px 0',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            border: '1px solid #ddd',
        });

        // ── Title row (always visible, never collapses) ────────────────────────
        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
        });

        // Left group: chevron toggle + title
        let isCollapsed = false;
        try { isCollapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'; } catch (_) {}
        toggleBtn = document.createElement('button');
        toggleBtn.textContent = isCollapsed ? '▶' : '▼';
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        toggleBtn.setAttribute('aria-controls', 'nku-toolkit-body');
        toggleBtn.setAttribute('aria-label',
            isCollapsed ? 'Expand NKU Canvas Toolkit panel' : 'Collapse NKU Canvas Toolkit panel');
        Object.assign(toggleBtn.style, {
            background: 'none',
            border: 'none',
            padding: '0',
            marginRight: '4px',
            cursor: 'pointer',
            fontSize: '0.85em',
            color: '#555',
            lineHeight: '1',
            flexShrink: '0',
        });

        const title = document.createElement('h3');
        title.textContent = 'NKU Canvas Toolkit';
        title.style.margin = '0';

        const titleLeft = document.createElement('div');
        Object.assign(titleLeft.style, { display: 'flex', alignItems: 'center' });
        titleLeft.appendChild(toggleBtn);
        titleLeft.appendChild(title);
        titleRow.appendChild(titleLeft);

        // Right group: issue badge + version icon + Canvas status link
        titleBadgeEl = document.createElement('span');
        titleBadgeEl.textContent = '⚠️';
        titleBadgeEl.title = 'Issues detected — expand panel for details';
        titleBadgeEl.setAttribute('aria-label', 'Issues detected — expand panel for details');
        Object.assign(titleBadgeEl.style, { display: 'none', fontSize: '0.85em', cursor: 'default' });

        const statusLink = document.createElement('a');
        statusLink.textContent = '⚪';
        statusLink.href = 'https://status.instructure.com';
        statusLink.target = '_blank';
        statusLink.rel = 'noopener noreferrer';
        statusLink.title = 'Checking Canvas status…';
        statusLink.setAttribute('aria-label', 'Canvas status: checking…');
        Object.assign(statusLink.style, {
            fontSize: '1.1em',
            textDecoration: 'none',
            cursor: 'pointer',
        });

        const versionIcon = document.createElement('span');
        versionIcon.textContent = 'ℹ️';
        versionIcon.title = `${VERSION_TOOLTIP_BASE}\nChecking for updates…`;
        versionIcon.setAttribute('aria-label', `NKU Canvas Toolkit v${SCRIPT_VERSION} — checking for updates`);
        Object.assign(versionIcon.style, { fontSize: '1em', cursor: 'default' });

        const rightIcons = document.createElement('div');
        Object.assign(rightIcons.style, { display: 'flex', alignItems: 'center', gap: '6px' });
        rightIcons.appendChild(titleBadgeEl);
        rightIcons.appendChild(versionIcon);
        rightIcons.appendChild(statusLink);
        titleRow.appendChild(rightIcons);
        panelContainer.appendChild(titleRow);

        fetchCanvasStatus(statusLink);
        fetchLatestVersion(versionIcon);

        // ── Panel body (collapses when toggle is clicked) ──────────────────────
        panelBodyEl = document.createElement('div');
        panelBodyEl.id = 'nku-toolkit-body';
        if (isCollapsed) panelBodyEl.style.display = 'none';

        toggleBtn.addEventListener('click', () => {
            const nowCollapsed = panelBodyEl.style.display !== 'none';
            panelBodyEl.style.display = nowCollapsed ? 'none' : '';
            toggleBtn.textContent = nowCollapsed ? '▶' : '▼';
            toggleBtn.setAttribute('aria-expanded', String(!nowCollapsed));
            toggleBtn.setAttribute('aria-label', nowCollapsed
                ? 'Expand NKU Canvas Toolkit panel'
                : 'Collapse NKU Canvas Toolkit panel');
            try { localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nowCollapsed)); } catch (_) {}
            updateTitleBadge();
        });

        // Admin Toolkit section (shown to users with the CETI account role)
        if (hasCetiRole) {
            buildAdminSection(panelBodyEl, isDesignerEnrolled);
        }

        // Visual separator between the two sections when both are present
        if (hasCetiRole && hasHelpdeskAdminRole) {
            const divider = document.createElement('hr');
            Object.assign(divider.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
            panelBodyEl.appendChild(divider);
        }

        // Helpdesk Toolkit section (shown to users with the Enroll Help Desk account role)
        if (hasHelpdeskAdminRole) {
            buildHelpdeskSection(panelBodyEl, isHelpdeskEnrolled);
        }

        panelContainer.appendChild(panelBodyEl);
        insertPanel();
    }

    // ─── Admin Toolkit section ────────────────────────────────────────────────

    function buildAdminSection(container, isDesignerEnrolled) {
        const sectionTitle = document.createElement('h4');
        sectionTitle.textContent = 'Admin Toolkit';
        Object.assign(sectionTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
        container.appendChild(sectionTitle);

        // Show enroll button when not enrolled (or status unknown)
        if (isDesignerEnrolled === null || !isDesignerEnrolled) {
            const enrollButton = createButton('Enroll as Designer', 'primary');
            enrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error', enrollButton); return; }
                setButtonsDisabled(true);
                enrollAsDesigner(courseId, uid, domain, getCsrfToken());
            });
            container.appendChild(enrollButton);
        }

        // Show unenroll button when enrolled (or status unknown)
        if (isDesignerEnrolled === null || isDesignerEnrolled) {
            const unenrollButton = createButton('Unenroll Completely', 'danger');
            unenrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error', unenrollButton); return; }
                setButtonsDisabled(true);
                unenrollAsDesigner(courseId, uid, domain, getCsrfToken());
            });
            container.appendChild(unenrollButton);
        }

        // Course Health sub-section (only when confirmed enrolled as Designer/Teacher)
        if (isDesignerEnrolled === true) {
            buildCourseHealthSection(container);
        }
    }

    function buildCourseHealthSection(container) {
        const sep = document.createElement('hr');
        Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
        container.appendChild(sep);

        // Course Health header with its own per-section collapse toggle
        let healthIsCollapsed = false;
        try { healthIsCollapsed = localStorage.getItem(HEALTH_COLLAPSED_STORAGE_KEY) === 'true'; } catch (_) {}

        const healthToggleBtn = document.createElement('button');
        healthToggleBtn.textContent = healthIsCollapsed ? '▶' : '▼';
        healthToggleBtn.setAttribute('aria-expanded', String(!healthIsCollapsed));
        healthToggleBtn.setAttribute('aria-controls', 'nku-toolkit-health-body');
        healthToggleBtn.setAttribute('aria-label',
            healthIsCollapsed ? 'Expand Course Health section' : 'Collapse Course Health section');
        Object.assign(healthToggleBtn.style, {
            background: 'none',
            border: 'none',
            padding: '0',
            marginRight: '4px',
            cursor: 'pointer',
            fontSize: '0.75em',
            color: '#555',
            lineHeight: '1',
            flexShrink: '0',
        });

        const healthTitle = document.createElement('h5');
        healthTitle.textContent = 'Course Health';
        Object.assign(healthTitle.style, { margin: '0', fontSize: '1em' });

        const healthHeaderRow = document.createElement('div');
        Object.assign(healthHeaderRow.style, {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '8px',
        });
        healthHeaderRow.appendChild(healthToggleBtn);
        healthHeaderRow.appendChild(healthTitle);
        container.appendChild(healthHeaderRow);

        const healthBodyEl = document.createElement('div');
        healthBodyEl.id = 'nku-toolkit-health-body';
        if (healthIsCollapsed) healthBodyEl.style.display = 'none';

        healthToggleBtn.addEventListener('click', () => {
            const nowCollapsed = healthBodyEl.style.display !== 'none';
            healthBodyEl.style.display = nowCollapsed ? 'none' : '';
            healthToggleBtn.textContent = nowCollapsed ? '▶' : '▼';
            healthToggleBtn.setAttribute('aria-expanded', String(!nowCollapsed));
            healthToggleBtn.setAttribute('aria-label', nowCollapsed
                ? 'Expand Course Health section'
                : 'Collapse Course Health section');
            try { localStorage.setItem(HEALTH_COLLAPSED_STORAGE_KEY, String(nowCollapsed)); } catch (_) {}
        });

        // Link validator row
        const linkValRow = document.createElement('div');
        linkValRow.style.marginBottom = '8px';
        const linkValBtn = createButton('Run Link Validator', 'default');
        linkValBtn.style.marginBottom = '4px';
        const linkValStatus = document.createElement('div');
        Object.assign(linkValStatus.style, { fontSize: '0.9em', marginTop: '2px' });
        linkValRow.appendChild(linkValBtn);
        linkValRow.appendChild(linkValStatus);
        healthBodyEl.appendChild(linkValRow);

        linkValBtn.addEventListener('click', () => startLinkValidator(linkValBtn, linkValStatus));
        checkLinkValidatorStatus(linkValBtn, linkValStatus);

        // Due-date check row
        const dueDateDiv = document.createElement('div');
        Object.assign(dueDateDiv.style, { fontSize: '0.9em', color: '#404040' });
        dueDateDiv.textContent = 'Checking due dates…';
        healthBodyEl.appendChild(dueDateDiv);

        checkDueDates(dueDateDiv);

        container.appendChild(healthBodyEl);
    }

    // ─── Helpdesk Toolkit section ─────────────────────────────────────────────

    function buildHelpdeskSection(container, isHelpdeskEnrolled) {
        const sectionTitle = document.createElement('h4');
        sectionTitle.textContent = 'Helpdesk Toolkit';
        Object.assign(sectionTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
        container.appendChild(sectionTitle);

        // Show enroll button when not enrolled (or status unknown)
        if (isHelpdeskEnrolled === null || !isHelpdeskEnrolled) {
            const enrollButton = createButton('Enroll as Helpdesk', 'primary');
            enrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error', enrollButton); return; }
                setButtonsDisabled(true);
                enrollAsHelpdesk(courseId, uid, domain, getCsrfToken());
            });
            container.appendChild(enrollButton);
        }

        // Show unenroll button when enrolled (or status unknown)
        if (isHelpdeskEnrolled === null || isHelpdeskEnrolled) {
            const unenrollButton = createButton('Unenroll Completely', 'danger');
            unenrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error', unenrollButton); return; }
                setButtonsDisabled(true);
                unenrollAsHelpdesk(courseId, uid, domain, getCsrfToken());
            });
            container.appendChild(unenrollButton);
        }

        // Module Completion Diagnostics sub-section
        const sep = document.createElement('hr');
        Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
        container.appendChild(sep);

        const diagTitle = document.createElement('h5');
        diagTitle.textContent = 'Module Completion Diagnostics';
        Object.assign(diagTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
        container.appendChild(diagTitle);

        buildModuleDiagnosticsUI(container);
    }

    // ─── Module Diagnostics UI ────────────────────────────────────────────────

    function buildModuleDiagnosticsUI(container) {
        // Scan all modules button + results area
        const scanBtn = createButton('Scan Modules', 'default');
        scanBtn.style.marginBottom = '4px';
        container.appendChild(scanBtn);

        const moduleSummaryDiv = document.createElement('div');
        Object.assign(moduleSummaryDiv.style, { fontSize: '0.9em', marginTop: '4px' });
        moduleSummaryDiv.textContent = 'Click "Scan Modules" to check completion requirements.';
        moduleSummaryDiv.style.color = '#595959';
        container.appendChild(moduleSummaryDiv);

        scanBtn.addEventListener('click', () => {
            scanBtn.disabled = true;
            moduleSummaryDiv.style.color = '';
            moduleSummaryDiv.textContent = 'Scanning modules…';
            scanModules(scanBtn, moduleSummaryDiv);
        });

        // Divider before student search
        const sep = document.createElement('hr');
        Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
        container.appendChild(sep);

        // Student diagnosis section
        const studentSearchTitle = document.createElement('div');
        Object.assign(studentSearchTitle.style, {
            fontSize: '0.9em',
            fontWeight: 'bold',
            marginBottom: '4px',
        });
        studentSearchTitle.textContent = 'Diagnose Student Issues';
        container.appendChild(studentSearchTitle);

        const searchRow = document.createElement('div');
        Object.assign(searchRow.style, { display: 'flex', gap: '4px', marginBottom: '4px' });

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search student name…';
        searchInput.className = 'ic-Input';
        Object.assign(searchInput.style, {
            fontSize: '0.9em',
            padding: '3px 6px',
            flexGrow: '1',
        });

        const searchBtn = createButton('Search', 'default');
        searchBtn.style.margin = '0';

        searchRow.appendChild(searchInput);
        searchRow.appendChild(searchBtn);
        container.appendChild(searchRow);

        const studentResultsDiv = document.createElement('div');
        Object.assign(studentResultsDiv.style, { fontSize: '0.9em', marginTop: '4px' });
        container.appendChild(studentResultsDiv);

        const doSearch = () => {
            const term = searchInput.value.trim();
            if (!term) { studentResultsDiv.textContent = 'Enter a student name to search.'; return; }
            searchBtn.disabled = true;
            studentResultsDiv.textContent = 'Searching…';
            searchStudents(term, studentResultsDiv, searchBtn);
        };

        searchBtn.addEventListener('click', doSearch);
        searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    }

    // ─── Scan all modules ─────────────────────────────────────────────────────

    // Fetches all modules with their items and completion requirements, then
    // renders a summary showing which items require completion in each module.
    function scanModules(btn, resultsDiv) {
        const url = `https://${domain}/api/v1/courses/${courseId}/modules` +
            `?include[]=items&include[]=content_details&per_page=100`;
        fetchAllPagesRaw(url, getCsrfToken(), [],
            (modules) => {
                btn.disabled = false;
                btn.textContent = 'Re-scan Modules';

                if (!modules.length) {
                    resultsDiv.textContent = 'ℹ️ No modules found in this course.';
                    return;
                }

                const modulesWithReqs = modules.filter(
                    m => m.completion_requirements && m.completion_requirements.length > 0);

                if (!modulesWithReqs.length) {
                    resultsDiv.textContent =
                        `✅ ${modules.length} module(s) found — none have completion requirements set.`;
                    return;
                }

                resultsDiv.innerHTML = '';

                const summary = document.createElement('div');
                Object.assign(summary.style, { marginBottom: '6px' });
                summary.innerHTML =
                    `<strong>${modulesWithReqs.length}</strong> of ` +
                    `<strong>${modules.length}</strong> module(s) have completion requirements:`;
                resultsDiv.appendChild(summary);

                modulesWithReqs.forEach(m => {
                    const moduleDiv = document.createElement('div');
                    Object.assign(moduleDiv.style, {
                        marginTop: '6px',
                        paddingLeft: '8px',
                        borderLeft: '3px solid #0770A3',
                    });

                    const moduleLink = document.createElement('a');
                    moduleLink.href =
                        `https://${domain}/courses/${courseId}/modules/${m.id}`;
                    moduleLink.target = '_blank';
                    moduleLink.textContent = m.name || `Module ${m.id}`;
                    Object.assign(moduleLink.style, { fontWeight: 'bold' });
                    moduleDiv.appendChild(moduleLink);

                    const reqList = document.createElement('ul');
                    Object.assign(reqList.style, { margin: '2px 0 0 0', paddingLeft: '16px' });

                    m.completion_requirements.forEach(req => {
                        const item = (m.items || []).find(i => i.id === req.id);
                        const li = document.createElement('li');
                        const label = COMPLETION_TYPE_LABELS[req.type] || req.type;
                        const scoreNote = req.type === 'min_score'
                            ? ` (≥ ${req.min_score})`
                            : '';
                        const itemTitle = item ? item.title : `Item #${req.id}`;
                        const itemLink = item
                            ? `<a href="https://${domain}/courses/${courseId}/modules/items/${item.id}" target="_blank">${escapeHtml(itemTitle)}</a>`
                            : escapeHtml(itemTitle);
                        li.innerHTML = `${itemLink} — <em>${label}${scoreNote}</em>`;
                        reqList.appendChild(li);
                    });

                    moduleDiv.appendChild(reqList);
                    resultsDiv.appendChild(moduleDiv);
                });
            },
            (error) => {
                btn.disabled = false;
                btn.textContent = 'Scan Modules';
                resultsDiv.textContent = `Failed to fetch modules: ${error}`;
            }
        );
    }

    // ─── Student search ───────────────────────────────────────────────────────

    // Searches for students by name within the course, then renders a list with
    // a "Diagnose" button next to each match.
    function searchStudents(term, resultsDiv, searchBtn) {
        const url = `https://${domain}/api/v1/courses/${courseId}/users` +
            `?search_term=${encodeURIComponent(term)}&enrollment_type[]=student&per_page=20`;
        makeApiCall(url, 'GET', null, getCsrfToken(),
            (students) => {
                searchBtn.disabled = false;
                resultsDiv.innerHTML = '';

                if (!students.length) {
                    resultsDiv.textContent = 'No matching students found.';
                    return;
                }

                const list = document.createElement('ul');
                Object.assign(list.style, { margin: '4px 0 0 0', paddingLeft: '0', listStyle: 'none' });

                students.slice(0, 10).forEach(student => {
                    const li = document.createElement('li');
                    Object.assign(li.style, { marginBottom: '3px' });

                    const diagBtn = document.createElement('button');
                    diagBtn.className = 'btn btn-default';
                    Object.assign(diagBtn.style, {
                        fontSize: '0.85em',
                        padding: '2px 8px',
                        marginRight: '6px',
                    });
                    diagBtn.textContent = 'Diagnose';
                    diagBtn.title =
                        `Show incomplete module requirements for this student`;

                    diagBtn.addEventListener('click', () => {
                        const diagDiv = document.createElement('div');
                        Object.assign(diagDiv.style, {
                            marginTop: '8px',
                            padding: '6px',
                            backgroundColor: '#fff',
                            borderRadius: '4px',
                            border: '1px solid #ddd',
                        });
                        diagDiv.textContent = 'Loading completion data…';

                        // Replace any previous diagnostic result panel
                        const existing = resultsDiv.querySelector('.student-diag-results');
                        if (existing) existing.remove();

                        diagDiv.className = 'student-diag-results';
                        resultsDiv.appendChild(diagDiv);
                        showStudentDiagnostics(student.id, diagDiv);
                    });

                    li.appendChild(diagBtn);
                    li.appendChild(document.createTextNode(student.name));
                    list.appendChild(li);
                });

                if (students.length > 10) {
                    const more = document.createElement('li');
                    more.style.color = '#888';
                    more.textContent =
                        `…and ${students.length - 10} more — try a more specific name.`;
                    list.appendChild(more);
                }

                resultsDiv.appendChild(list);
            },
            (error) => {
                searchBtn.disabled = false;
                resultsDiv.textContent = `Search failed: ${error}`;
            }
        );
    }

    // ─── Per-student completion diagnostics ───────────────────────────────────

    // Fetches module completion data for a specific student and renders a list
    // of every incomplete requirement that is currently blocking them.
    // studentId is the Canvas numeric user ID (not a name or SIS ID).
    function showStudentDiagnostics(studentId, diagDiv) {
        const url = `https://${domain}/api/v1/courses/${courseId}/modules` +
            `?student_id=${studentId}&include[]=items&include[]=content_details&per_page=100`;
        fetchAllPagesRaw(url, getCsrfToken(), [],
            (modules) => {
                diagDiv.innerHTML = '';

                const header = document.createElement('div');
                Object.assign(header.style, { fontWeight: 'bold', marginBottom: '6px' });
                header.textContent = 'Completion status:';
                diagDiv.appendChild(header);

                const modulesWithReqs = modules.filter(
                    m => m.completion_requirements && m.completion_requirements.length > 0);

                if (!modulesWithReqs.length) {
                    const note = document.createElement('div');
                    note.textContent = '✅ No modules with completion requirements found.';
                    diagDiv.appendChild(note);
                    return;
                }

                let hasBlockingIssues = false;

                modulesWithReqs.forEach(m => {
                    // Identify requirements that are not yet completed for this student.
                    // When the modules endpoint is called with student_id, each item's
                    // completion_requirement object includes a `completed` boolean.
                    const incompleteReqs = (m.completion_requirements || []).filter(req => {
                        const item = (m.items || []).find(i => i.id === req.id);
                        return item &&
                            item.completion_requirement &&
                            item.completion_requirement.completed === false;
                    });

                    if (!incompleteReqs.length) return; // all requirements met for this module

                    hasBlockingIssues = true;

                    const moduleDiv = document.createElement('div');
                    Object.assign(moduleDiv.style, {
                        marginTop: '6px',
                        paddingLeft: '8px',
                        borderLeft: '3px solid #e66000',
                    });

                    const moduleHeader = document.createElement('div');
                    const moduleLink = document.createElement('a');
                    moduleLink.href =
                        `https://${domain}/courses/${courseId}/modules/${m.id}`;
                    moduleLink.target = '_blank';
                    moduleLink.textContent = m.name || `Module ${m.id}`;
                    Object.assign(moduleLink.style, { fontWeight: 'bold' });
                    moduleHeader.appendChild(moduleLink);

                    if (m.state) {
                        const stateSpan = document.createElement('span');
                        Object.assign(stateSpan.style, {
                            color: '#888',
                            fontSize: '0.9em',
                            marginLeft: '4px',
                        });
                        stateSpan.textContent = `[${m.state}]`;
                        moduleHeader.appendChild(stateSpan);
                    }

                    moduleDiv.appendChild(moduleHeader);

                    const reqList = document.createElement('ul');
                    Object.assign(reqList.style, { margin: '2px 0 0 0', paddingLeft: '16px' });

                    incompleteReqs.forEach(req => {
                        const item = (m.items || []).find(i => i.id === req.id);
                        const li = document.createElement('li');
                        Object.assign(li.style, { color: '#c00' });

                        const label = COMPLETION_TYPE_LABELS[req.type] || req.type;
                        const scoreNote = req.type === 'min_score'
                            ? ` (needs ≥ ${req.min_score})`
                            : '';
                        const itemTitle = item ? item.title : `Item #${req.id}`;
                        const itemLink = item
                            ? `<a href="https://${domain}/courses/${courseId}/modules/items/${item.id}" target="_blank" style="color:#c00">${escapeHtml(itemTitle)}</a>`
                            : escapeHtml(itemTitle);
                        li.innerHTML = `❌ ${itemLink} — <em>${label}${scoreNote}</em>`;
                        reqList.appendChild(li);
                    });

                    moduleDiv.appendChild(reqList);
                    diagDiv.appendChild(moduleDiv);
                });

                if (!hasBlockingIssues) {
                    const allDone = document.createElement('div');
                    allDone.textContent =
                        '✅ All module completion requirements are met for this student.';
                    diagDiv.appendChild(allDone);
                }
            },
            (error) => {
                diagDiv.textContent = `Failed to fetch module data: ${error}`;
            }
        );
    }

    // ─── Enrollment actions ───────────────────────────────────────────────────

    function enrollAsDesigner(courseId, userId, domain, csrfToken) {
        log(`Enrolling user as Designer in course ${courseId}`);

        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments`;
        const data = {
            enrollment: {
                user_id: userId,
                type: 'DesignerEnrollment',
                enrollment_state: 'active',
                notify: false,
            },
        };

        makeApiCall(url, 'POST', data, csrfToken,
            () => {
                showMessage('Successfully enrolled as designer!', 'success');
                setTimeout(() => window.location.reload(), 1500);
            },
            (error, responseText) => {
                if (isAuthOrValidationError(error)) {
                    tryFallbackEnrollment(courseId, userId, domain, csrfToken, 'type');
                } else {
                    showMessage(`Failed to enroll: ${buildErrorMessage(error, responseText)}`, 'error');
                    setButtonsDisabled(false);
                }
            }
        );
    }

    function tryFallbackEnrollment(courseId, userId, domain, csrfToken, payloadVariant) {
        log(`Trying fallback enrollment (variant: ${payloadVariant})`);

        const url = `https://${domain}/courses/${courseId}/enroll_user`;
        const base = {
            user_id: userId,
            enrollment_state: 'active',
            course_section_id: '',
            limit_privileges_to_course_section: 'false',
        };
        const data = payloadVariant === 'type'
            ? { ...base, type: 'DesignerEnrollment' }
            : { ...base, role_id: DESIGNER_ROLE_ID };

        // Canvas web routes expect form-encoded data (not JSON) and require
        // the authenticity_token in the request body.
        makeFormPost(url, data, csrfToken,
            () => {
                showMessage('Successfully enrolled as designer!', 'success');
                setTimeout(() => window.location.reload(), 1500);
            },
            (error, responseText) => {
                if (payloadVariant === 'type' && isAuthOrValidationError(error)) {
                    tryFallbackEnrollment(courseId, userId, domain, csrfToken, 'role_id');
                } else {
                    showMessage(`Failed to enroll: ${buildErrorMessage(error, responseText)}`, 'error');
                    setButtonsDisabled(false);
                }
            }
        );
    }

    function unenrollAsDesigner(courseId, userId, domain, csrfToken) {
        log(`Unenrolling user from Designer/Teacher enrollments in course ${courseId}`);

        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=100`;
        fetchAllPagesRaw(url, csrfToken, [],
            (enrollments) => {
                const targets = enrollments.filter(e =>
                    e.type === 'DesignerEnrollment' || e.type === 'TeacherEnrollment');

                if (targets.length === 0) {
                    showMessage('No designer or teacher enrollments found to remove.', 'warning');
                    setButtonsDisabled(false);
                    return;
                }

                let completed = 0;
                const errors = [];

                targets.forEach(enrollment => {
                    const deleteUrl =
                        `https://${domain}/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=delete`;
                    const concludeUrl =
                        `https://${domain}/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=conclude`;

                    const onSuccess = () => {
                        completed++;
                        if (completed + errors.length === targets.length) {
                            if (errors.length > 0) {
                                showMessage(`Unenrollment completed with ${errors.length} error(s): ${errors.join(', ')}`, 'warning');
                                setButtonsDisabled(false);
                            } else {
                                showMessage('Successfully unenrolled from the course!', 'success');
                                setTimeout(() => window.location.reload(), 1500);
                            }
                        }
                    };
                    const onFailure = (error) => {
                        errors.push(error);
                        log(`Failed to remove enrollment ${enrollment.id}: ${error}`);
                        if (completed + errors.length === targets.length) {
                            showMessage(`Unenrollment completed with ${errors.length} error(s): ${errors.join(', ')}`, 'warning');
                            setButtonsDisabled(false);
                        }
                    };

                    // Try task=delete first; fall back to task=conclude (conclude requires
                    // fewer permissions in some Canvas configurations).
                    makeApiCall(deleteUrl, 'DELETE', null, csrfToken,
                        onSuccess,
                        () => makeApiCall(concludeUrl, 'DELETE', null, csrfToken, onSuccess, onFailure)
                    );
                });
            },
            (error) => {
                showMessage(`Failed to get enrollments: ${error}`, 'error');
                setButtonsDisabled(false);
            }
        );
    }

    function enrollAsHelpdesk(courseId, userId, domain, csrfToken) {
        log(`Enrolling as Helpdesk in course ${courseId}`);

        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments`;
        const data = {
            enrollment: {
                user_id: userId,
                role_id: HELPDESK_ROLE_ID,
                enrollment_state: 'active',
                notify: false,
            },
        };

        makeApiCall(url, 'POST', data, csrfToken,
            () => {
                showMessage(`Successfully enrolled as ${HELPDESK_ROLE_NAME}!`, 'success');
                setTimeout(() => window.location.reload(), 1500);
            },
            (error, responseText) => {
                showMessage(`Failed to enroll: ${buildErrorMessage(error, responseText)}`, 'error');
                setButtonsDisabled(false);
            }
        );
    }

    function unenrollAsHelpdesk(courseId, userId, domain, csrfToken) {
        log(`Unenrolling user from Helpdesk enrollment in course ${courseId}`);

        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=100`;
        fetchAllPagesRaw(url, csrfToken, [],
            (enrollments) => {
                const targets = enrollments.filter(e => e.role_id === HELPDESK_ROLE_ID);

                if (targets.length === 0) {
                    showMessage('No helpdesk enrollments found to remove.', 'warning');
                    setButtonsDisabled(false);
                    return;
                }

                let completed = 0;
                const errors = [];

                targets.forEach(enrollment => {
                    const deleteUrl =
                        `https://${domain}/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=delete`;
                    const concludeUrl =
                        `https://${domain}/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=conclude`;

                    const onSuccess = () => {
                        completed++;
                        if (completed + errors.length === targets.length) {
                            if (errors.length > 0) {
                                showMessage(
                                    `Unenrollment completed with ${errors.length} error(s): ${errors.join(', ')}`,
                                    'warning');
                                setButtonsDisabled(false);
                            } else {
                                showMessage('Successfully unenrolled from the course!', 'success');
                                setTimeout(() => window.location.reload(), 1500);
                            }
                        }
                    };
                    const onFailure = (error) => {
                        errors.push(error);
                        log(`Failed to remove enrollment ${enrollment.id}: ${error}`);
                        if (completed + errors.length === targets.length) {
                            showMessage(
                                `Unenrollment completed with ${errors.length} error(s): ${errors.join(', ')}`,
                                'warning');
                            setButtonsDisabled(false);
                        }
                    };

                    makeApiCall(deleteUrl, 'DELETE', null, csrfToken,
                        onSuccess,
                        () => makeApiCall(concludeUrl, 'DELETE', null, csrfToken, onSuccess, onFailure)
                    );
                });
            },
            (error) => {
                showMessage(`Failed to get enrollments: ${error}`, 'error');
                setButtonsDisabled(false);
            }
        );
    }

    // ─── Shared UI utilities ──────────────────────────────────────────────────

    function setButtonsDisabled(disabled) {
        if (!panelContainer) return;
        panelContainer.querySelectorAll('button').forEach(btn => {
            btn.disabled = disabled;
            btn.style.opacity = disabled ? '0.6' : '1';
            btn.style.cursor = disabled ? 'not-allowed' : '';
        });
    }

    function setPanelIssue(key, hasIssue) {
        panelIssues[key] = hasIssue;
        updateTitleBadge();
    }

    function updateTitleBadge() {
        if (!titleBadgeEl || !panelBodyEl) return;
        const isCollapsed = panelBodyEl.style.display === 'none';
        const anyIssue = Object.values(panelIssues).some(Boolean);
        titleBadgeEl.style.display = (isCollapsed && anyIssue) ? 'inline' : 'none';
    }

    function insertPanel() {
        log('Attempting to insert panel container');

        const targets = [
            () => document.querySelector('.ic-app-main-content__secondary'),
            () => document.querySelector('#content'),
            () => {
                const el = document.querySelector('.course-title');
                return el ? { prepend: (c) => el.after(c) } : null;
            },
            () => document.body,
        ];

        for (const getTarget of targets) {
            const target = getTarget();
            if (target) {
                target.prepend(panelContainer);
                log('Panel container inserted');
                return true;
            }
        }
        return false;
    }

    function getCsrfToken() {
        // Canvas stores the CSRF token URL-encoded in the _csrf_token cookie.
        // Decode and prefer that over the meta tag, which may contain a masked variant
        // that some Canvas versions don't accept on API endpoints.
        const cookieMatch = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
        if (cookieMatch) {
            try { return decodeURIComponent(cookieMatch[1]); }
            catch (e) { warn('Could not decode _csrf_token cookie:', e); }
        }
        const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        if (!token) err('No CSRF token found in page');
        return token ?? '';
    }

    function createButton(text, type) {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = `btn btn-${type}`;
        Object.assign(btn.style, { marginRight: '10px', marginBottom: '5px' });
        return btn;
    }

    function showMessage(message, type, returnFocusEl = null) {
        if (!panelContainer || !document.getElementById('nku-toolkit-container')) {
            err('Cannot show message — panel container not in DOM');
            return;
        }
        const div = document.createElement('div');
        div.className = `alert alert-${type}`;
        div.textContent = message;
        div.style.marginBottom = '10px';
        div.tabIndex = -1;
        if (type === 'danger' || type === 'error') {
            div.setAttribute('role', 'alert');
            div.setAttribute('aria-live', 'assertive');
        } else {
            div.setAttribute('role', 'status');
            div.setAttribute('aria-live', 'polite');
        }
        panelContainer.prepend(div);
        div.focus();
        setTimeout(() => {
            div.style.transition = 'opacity 0.5s';
            div.style.opacity = '0';
            setTimeout(() => {
                div.remove();
                if (returnFocusEl && document.contains(returnFocusEl)) returnFocusEl.focus();
            }, 500);
        }, 3000);
    }

    function isAuthOrValidationError(error) {
        return ['401', '403', '404', '422'].some(code => error.includes(code));
    }

    function buildErrorMessage(error, responseText) {
        try {
            const data = JSON.parse(responseText);
            if (data?.errors) return `${error}: ${JSON.stringify(data.errors)}`;
            if (data?.message) return `${error}: ${data.message}`;
        } catch (_) { /* not JSON */ }
        return error;
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ─── Core API helpers ─────────────────────────────────────────────────────

    // Wraps fetch() with an AbortController-based timeout.
    function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        return fetch(url, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(timeoutId));
    }

    function makeApiCall(url, method, data, csrfToken, successCallback, errorCallback) {
        log(`${method} ${url}`);
        const body = data ? JSON.stringify(data) : null;
        const headers = {
            'X-CSRF-Token': csrfToken,
            Accept: 'application/json',
        };
        // Always declare content type on state-changing requests so Canvas
        // recognises the call as a JSON API request even when the body is empty.
        if (body || ['POST', 'PUT', 'PATCH'].includes(method)) {
            headers['Content-Type'] = 'application/json';
        }

        fetchWithTimeout(url, { method, headers, body })
            .then(async (response) => {
                log(`Response ${response.status} for ${method} ${url}`);
                if (response.ok) {
                    const text = await response.text();
                    let parsed = {};
                    if (text) {
                        try { parsed = JSON.parse(text); }
                        catch (e) { warn('Could not parse response body:', e); }
                    }
                    successCallback(parsed);
                } else {
                    await response.text().catch(() => '');
                    const requestId = response.headers.get('X-Request-Id') || response.headers.get('x-request-id') || '';
                    const requestIdSuffix = requestId ? ` [request id: ${requestId}]` : '';
                    const errorMessage = `HTTP ${response.status} for ${method} ${url}${requestIdSuffix}`;
                    err(errorMessage);
                    errorCallback(errorMessage, '');
                }
            })
            .catch((e) => {
                if (e.name === 'AbortError') {
                    errorCallback('Request timed out', '');
                } else {
                    errorCallback('Network error', '');
                }
            });
    }

    // Fetches all pages of a Canvas API endpoint, following Link rel="next" headers.
    // Calls onComplete(allItems) when done, or onError(msg) on failure.
    function fetchAllPagesRaw(url, csrfToken, accumulated, onComplete, onError) {
        const headers = {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            Accept: 'application/json',
        };

        fetchWithTimeout(url, { method: 'GET', headers })
            .then(async (response) => {
                if (response.ok) {
                    const text = await response.text();
                    let parsed = [];
                    try { parsed = JSON.parse(text); } catch (e) { /* ignore */ }
                    const items = accumulated.concat(Array.isArray(parsed) ? parsed : []);

                    // Follow Link: <url>; rel="next" if present
                    const linkHeader = response.headers.get('link') ?? '';
                    const nextMatch = /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
                    if (nextMatch) {
                        fetchAllPagesRaw(nextMatch[1], csrfToken, items, onComplete, onError);
                    } else {
                        onComplete(items);
                    }
                } else {
                    onError(`HTTP ${response.status}`);
                }
            })
            .catch((e) => {
                if (e.name === 'AbortError') onError('Request timed out');
                else onError('Network error');
            });
    }

    // Sends a form-encoded POST to a Canvas web route (non-API endpoint).
    // Includes authenticity_token in the body (standard Rails CSRF for form submissions).
    function makeFormPost(url, formData, csrfToken, successCallback, errorCallback) {
        const params = new URLSearchParams({ ...formData, authenticity_token: csrfToken }).toString();

        fetchWithTimeout(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json, text/html',
            },
            body: params,
        })
            .then((response) => {
                log(`Form POST response ${response.status} for ${url}`);
                // Web routes typically redirect (→ 200) on success
                if (response.status >= 200 && response.status < 400) {
                    successCallback();
                } else {
                    response.text().then(text => errorCallback(`HTTP ${response.status}`, text))
                        .catch(() => errorCallback(`HTTP ${response.status}`, ''));
                }
            })
            .catch((e) => {
                if (e.name === 'AbortError') errorCallback('Request timed out', '');
                else errorCallback('Network error', '');
            });
    }

    // ─── Canvas Status indicator ──────────────────────────────────────────────

    function fetchCanvasStatus(el) {
        fetchWithTimeout(CANVAS_STATUS_URL, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'omit',
        })
            .then(async (response) => {
                if (response.ok) {
                    try {
                        const data = JSON.parse(await response.text());
                        updateStatusIndicator(el, data);
                    } catch (e) {
                        el.textContent = '⚪';
                        el.title = 'Could not parse Canvas status';
                        el.setAttribute('aria-label', 'Canvas status: unavailable');
                    }
                } else {
                    el.textContent = '⚪';
                    el.title = 'Could not fetch Canvas status';
                    el.setAttribute('aria-label', 'Canvas status: unavailable');
                }
            })
            .catch(() => {
                el.textContent = '⚪';
                el.title = 'Could not reach status.instructure.com';
                el.setAttribute('aria-label', 'Canvas status: unavailable');
            });
    }

    function updateStatusIndicator(el, data) {
        const allComponents = data?.components ?? [];
        const incidents = data?.incidents ?? [];

        // Filter to only the components NKU uses
        const relevant = allComponents.filter(c => RELEVANT_COMPONENTS.has(c.name));

        // If no known component names matched (e.g. Statuspage renamed components or
        // the API omitted the components array), fall back to the aggregate indicator
        // so we never falsely show 🟢 when status is actually unknown.
        if (relevant.length === 0) {
            const aggIndicator = data?.status?.indicator ?? 'none';
            const aggDescription = data?.status?.description ?? 'Unknown';
            el.textContent = aggIndicator === 'none' ? '🟢' : aggIndicator === 'minor' ? '🟡' : '🔴';
            el.title = `Canvas Status: ${aggDescription}`;
            el.setAttribute('aria-label', `Canvas status: ${aggDescription}`);
            setPanelIssue('canvasStatus', aggIndicator !== 'none');
            return;
        }

        // Determine worst status among relevant components.
        // Statuspage component statuses: operational, degraded_performance,
        // partial_outage, major_outage, under_maintenance.
        const STATUS_RANK = {
            operational: 0,
            under_maintenance: 1,
            degraded_performance: 2,
            partial_outage: 2,
            major_outage: 3,
        };
        const STATUS_DESCRIPTIONS = {
            operational: 'All Systems Operational',
            under_maintenance: 'Under Maintenance',
            degraded_performance: 'Partial Disruption',
            partial_outage: 'Partial Disruption',
            major_outage: 'Major Disruption',
        };
        let worstRank = 0;
        let worstStatus = 'operational';
        relevant.forEach(c => {
            const rank = STATUS_RANK[c.status] ?? 0;
            if (rank > worstRank) { worstRank = rank; worstStatus = c.status; }
        });

        const indicator = worstRank === 0 ? 'none' : worstRank >= 3 ? 'major' : 'minor';

        if (indicator === 'none') {
            el.textContent = '🟢';
        } else if (indicator === 'minor') {
            el.textContent = '🟡';
        } else {
            el.textContent = '🔴';
        }

        // Filter incidents to those affecting at least one relevant component
        const relevantIds = new Set(relevant.map(c => c.id));
        const relevantIncidents = incidents.filter(inc =>
            (inc.components ?? []).some(c => relevantIds.has(c.id))
        );

        const description = STATUS_DESCRIPTIONS[worstStatus] ?? 'Degraded';

        let tooltip = `Canvas Status: ${description}`;
        if (relevantIncidents.length > 0) {
            tooltip += '\n\nActive Incidents:';
            relevantIncidents.slice(0, 5).forEach(inc => {
                tooltip += `\n• ${inc.name} [${inc.status}]`;
            });
        }
        el.title = tooltip;
        el.setAttribute('aria-label', `Canvas status: ${description}`);
        setPanelIssue('canvasStatus', indicator !== 'none');
    }

    // ─── GitHub version check ─────────────────────────────────────────────────

    function fetchLatestVersion(el) {
        // Use a cached result if it is less than 24 hours old to avoid hitting
        // GitHub's raw-content servers on every page load.
        try {
            const cached = JSON.parse(localStorage.getItem(VERSION_CHECK_CACHE_KEY) || 'null');
            const age = Date.now() - cached?.ts;
            if (cached && typeof cached.version === 'string' && cached.version &&
                typeof cached.ts === 'number' && age >= 0 && age < VERSION_CHECK_TTL_MS) {
                updateVersionTooltip(el, cached.version);
                return;
            }
        } catch (_) { /* corrupt cache — fall through to a fresh fetch */ }

        fetchWithTimeout(UPDATE_CHECK_URL, {
            method: 'GET',
            credentials: 'omit',
        })
            .then(async (response) => {
                if (response.ok) {
                    try {
                        const data = JSON.parse(await response.text());
                        if (data && typeof data.version === 'string' && data.version) {
                            const latestVersion = data.version;
                            try {
                                localStorage.setItem(VERSION_CHECK_CACHE_KEY,
                                    JSON.stringify({ version: latestVersion, ts: Date.now() }));
                            } catch (_) { /* storage unavailable — ignore */ }
                            updateVersionTooltip(el, latestVersion);
                        } else {
                            el.title = `${VERSION_TOOLTIP_BASE}\n\nCould not determine latest version.`;
                        }
                    } catch (_) {
                        el.title = `${VERSION_TOOLTIP_BASE}\n\nCould not parse version data.`;
                    }
                } else {
                    el.title = `${VERSION_TOOLTIP_BASE}\n\nUpdate check failed (HTTP ${response.status}).`;
                }
            })
            .catch(() => {
                el.title = `${VERSION_TOOLTIP_BASE}\n\nUpdate check failed (network error).`;
            });
    }

    function compareVersions(a, b) {
        const toNums = v => v.replace(/[-+].*$/, '').split('.').map(Number);
        const aParts = toNums(a);
        const bParts = toNums(b);
        const len = Math.max(aParts.length, bParts.length);
        for (let i = 0; i < len; i++) {
            const diff = (aParts[i] || 0) - (bParts[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    function updateVersionTooltip(el, latestVersion) {
        if (compareVersions(latestVersion, SCRIPT_VERSION) <= 0) {
            el.title = `${VERSION_TOOLTIP_BASE}\n\n✅ You are on the latest version.`;
            el.setAttribute('aria-label', `NKU Canvas Toolkit v${SCRIPT_VERSION} — up to date`);
        } else {
            el.textContent = '🔔';
            el.title =
                `${VERSION_TOOLTIP_BASE}\n\n` +
                `⚠️ Update available: v${latestVersion}\n` +
                `Download the latest files from GitHub and reload the extension in chrome://extensions.`;
            el.setAttribute('aria-label', `NKU Canvas Toolkit — update available: v${latestVersion}`);
        }
    }

    // ─── Link Validator ───────────────────────────────────────────────────────

    // Called on panel load — show existing result if one is available
    function checkLinkValidatorStatus(btn, statusDiv) {
        const url = `https://${domain}/api/v1/courses/${courseId}/link_validation`;
        makeApiCall(url, 'GET', null, getCsrfToken(),
            (data) => {
                if (!data || !data.workflow_state) return; // nothing run yet
                if (data.workflow_state === 'completed') {
                    displayLinkValidatorResults(btn, statusDiv, data);
                } else if (data.workflow_state === 'queued' || data.workflow_state === 'running') {
                    statusDiv.textContent = 'Link validation already running…';
                    btn.disabled = true;
                    pollLinkValidator(btn, statusDiv);
                }
            },
            () => { /* silently ignore — no prior run */ }
        );
    }

    function startLinkValidator(btn, statusDiv) {
        if (linkValidatorPollInterval) clearInterval(linkValidatorPollInterval);
        if (lastRunTimerInterval) { clearInterval(lastRunTimerInterval); lastRunTimerInterval = null; }
        btn.disabled = true;
        statusDiv.textContent = 'Starting link validation…';

        const url = `https://${domain}/api/v1/courses/${courseId}/link_validation`;
        makeApiCall(url, 'POST', null, getCsrfToken(),
            () => {
                // Always poll after POST — the POST response may carry a stale
                // "completed" state (empty issues) from a previous run rather than
                // the newly-triggered job's results.  The pollLinkValidator grace-poll
                // logic already handles jobs that finish before the first poll fires.
                statusDiv.textContent = 'Link validation running…';
                pollLinkValidator(btn, statusDiv, true);
            },
            (error) => {
                statusDiv.textContent = `Failed to start: ${error}`;
                btn.disabled = false;
            }
        );
    }

    function pollLinkValidator(btn, statusDiv, isNewRun = false) {
        if (linkValidatorPollInterval) clearInterval(linkValidatorPollInterval);
        const url = `https://${domain}/api/v1/courses/${courseId}/link_validation`;

        // seenInProgress tracks whether a queued/running state has been observed since
        // the new run was started.  For page-load status checks (isNewRun = false) we
        // skip this guard entirely.
        //
        // Grace-poll fallback: if the job completes before we ever observe it as
        // queued/running (fast jobs finish in < 4 s), we accept the completed result
        // after LINK_VALIDATOR_GRACE_POLLS consecutive polls.
        let seenInProgress = !isNewRun;
        let pollCount = 0;

        linkValidatorPollInterval = setInterval(() => {
            pollCount++;
            makeApiCall(url, 'GET', null, getCsrfToken(),
                (data) => {
                    const state = data?.workflow_state;
                    if (state === 'queued' || state === 'running') {
                        seenInProgress = true;
                    }
                    if (state === 'completed' && (seenInProgress || pollCount >= LINK_VALIDATOR_GRACE_POLLS)) {
                        clearInterval(linkValidatorPollInterval);
                        linkValidatorPollInterval = null;
                        displayLinkValidatorResults(btn, statusDiv, data, true);
                    }
                    // else: still queued/running or within grace period — keep polling
                },
                (error) => {
                    clearInterval(linkValidatorPollInterval);
                    linkValidatorPollInterval = null;
                    statusDiv.textContent = `Error polling: ${error}`;
                    btn.disabled = false;
                }
            );
        }, LINK_VALIDATOR_POLL_INTERVAL_MS);
    }

    // ─── Link Validator last-run helpers ─────────────────────────────────────

    function linkValidatorStorageKey() {
        return `nku_toolkit_lv_last_run_${courseId}`;
    }

    function saveLinkValidatorLastRun() {
        try { localStorage.setItem(linkValidatorStorageKey(), new Date().toISOString()); } catch (_) { /* storage unavailable */ }
    }

    function getLinkValidatorLastRun() {
        try {
            const iso = localStorage.getItem(linkValidatorStorageKey());
            if (!iso) return null;
            return new Date(iso);
        } catch (_) { return null; }
    }

    function formatRelativeTime(date) {
        if (!date) return null;
        const diffMs = date.getTime() - Date.now();
        const absMs = Math.abs(diffMs);
        const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        if (absMs < MS_PER_MINUTE) return 'Last run: just now';
        if (absMs < MS_PER_HOUR) return `Last run: ${rtf.format(Math.round(diffMs / MS_PER_MINUTE), 'minute')}`;
        if (absMs < MS_PER_DAY) return `Last run: ${rtf.format(Math.round(diffMs / MS_PER_HOUR), 'hour')}`;
        return `Last run: ${rtf.format(Math.round(diffMs / MS_PER_DAY), 'day')}`;
    }

    function appendLastRunLine(statusDiv) {
        const ts = getLinkValidatorLastRun();
        const text = formatRelativeTime(ts);
        if (!text) return;
        if (lastRunTimerInterval) { clearInterval(lastRunTimerInterval); lastRunTimerInterval = null; }
        const line = document.createElement('div');
        Object.assign(line.style, { fontSize: '0.85em', color: '#595959', marginTop: '3px' });
        line.textContent = text;
        statusDiv.appendChild(line);
        lastRunLineEl = line;
        lastRunTimerInterval = setInterval(() => {
            if (!document.contains(lastRunLineEl)) {
                clearInterval(lastRunTimerInterval);
                lastRunTimerInterval = null;
                return;
            }
            const updatedTs = getLinkValidatorLastRun();
            const updatedText = formatRelativeTime(updatedTs);
            if (updatedText) lastRunLineEl.textContent = updatedText;
        }, MS_PER_MINUTE);
    }

    function displayLinkValidatorResults(btn, statusDiv, data, saveTimestamp = false) {
        btn.disabled = false;
        btn.textContent = 'Re-run Link Validator';
        if (saveTimestamp) saveLinkValidatorLastRun();

        const issues = data.results?.issues || [];
        const reportUrl = `https://${domain}/courses/${courseId}/link_validator`;

        statusDiv.innerHTML = '';
        const resultLine = document.createElement('div');
        setPanelIssue('linkValidator', issues.length > 0);
        if (issues.length === 0) {
            resultLine.innerHTML = `✅ No broken links found. <a href="${reportUrl}" target="_blank">View report</a>`;
        } else {
            const brokenLinkCount = issues.reduce((sum, item) => sum + (item.invalid_links?.length ?? 0), 0);
            resultLine.innerHTML =
                `⚠️ ${brokenLinkCount} broken link(s) across ${issues.length} item(s). ` +
                `<a href="${reportUrl}" target="_blank">View full report →</a>`;
        }
        statusDiv.appendChild(resultLine);
        appendLastRunLine(statusDiv);
    }

    // ─── Due Date Checker ─────────────────────────────────────────────────────

    function checkDueDates(container) {
        const url = `https://${domain}/api/v1/courses/${courseId}/sections?per_page=100`;
        fetchAllPagesRaw(url, getCsrfToken(), [],
            (sections) => {
                const datesWithSections = sections
                    .filter(s => s.start_at)
                    .map(s => ({ name: s.name, start: new Date(s.start_at) }));

                if (datesWithSections.length === 0) {
                    container.textContent = 'ℹ️ No section start dates found — skipping due-date check.';
                    return;
                }

                const earliestEntry = datesWithSections.reduce(
                    (min, s) => s.start < min.start ? s : min
                );
                const hasMultiple = datesWithSections.length > 1;
                fetchAssignmentsAndCheck(container, earliestEntry, hasMultiple);
            },
            () => { container.textContent = 'Could not fetch section data.'; }
        );
    }

    function fetchAssignmentsAndCheck(container, earliestEntry, hasMultiple) {
        const url = `https://${domain}/api/v1/courses/${courseId}/assignments?per_page=100`;
        fetchAllPagesRaw(url, getCsrfToken(), [],
            (assignments) => {
                const earlyDue = assignments.filter(
                    a => a.due_at && new Date(a.due_at) < earliestEntry.start
                );

                container.innerHTML = '';

                if (earlyDue.length === 0) {
                    const dateStr = earliestEntry.start.toLocaleDateString();
                    const note = hasMultiple ? ` (earliest section: "${earliestEntry.name}")` : '';
                    container.textContent = `✅ All due dates are on or after section start${note} (${dateStr}).`;
                    setPanelIssue('dueDates', false);
                    return;
                }

                setPanelIssue('dueDates', true);
                const dateStr = earliestEntry.start.toLocaleDateString();
                const note = hasMultiple
                    ? ` (using earliest section start: "${earliestEntry.name}", ${dateStr})`
                    : ` (${dateStr})`;
                container.innerHTML = `⚠️ ${earlyDue.length} assignment(s) due before section start${note}:`;

                const list = document.createElement('ul');
                Object.assign(list.style, { margin: '4px 0 0 0', paddingLeft: '18px' });

                earlyDue.slice(0, 5).forEach(a => {
                    const li = document.createElement('li');
                    const due = new Date(a.due_at).toLocaleDateString();
                    li.innerHTML =
                        `<a href="https://${domain}/courses/${courseId}/assignments/${a.id}" target="_blank">${escapeHtml(a.name)}</a>` +
                        ` <span style="color:#888">(due ${due})</span>`;
                    list.appendChild(li);
                });

                if (earlyDue.length > 5) {
                    const li = document.createElement('li');
                    li.style.color = '#888';
                    li.textContent = `…and ${earlyDue.length - 5} more`;
                    list.appendChild(li);
                }

                container.appendChild(list);
            },
            () => { container.textContent = 'Could not fetch assignment data.'; }
        );
    }
})();
