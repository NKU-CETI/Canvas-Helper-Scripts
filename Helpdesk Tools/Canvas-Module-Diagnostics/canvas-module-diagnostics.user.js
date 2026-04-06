// ==UserScript==
// @name         Canvas Module Diagnostics
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Adds a Helpdesk Toolkit panel to Canvas course pages for diagnosing module completion requirement issues
// @author       NKU CETI
// @match        https://*.instructure.com/courses/*
// @grant        GM_xmlhttpRequest
// @connect      *.instructure.com
// @connect      status.instructure.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js
// @downloadURL  https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.4';
    const DEBUG = false;
    const REQUEST_TIMEOUT_MS = 15000;
    // NKU's internal Canvas role ID for the Helpdesk course enrollment role.
    // To find yours: GET https://<domain>/api/v1/accounts/:account_id/roles
    const HELPDESK_ROLE_ID = 177; // Course enrollment role: "Helpdesk"
    const HELPDESK_ROLE_NAME = 'Helpdesk'; // Display name of the role in Canvas
    // Account-level admin role that grants permission to enroll/unenroll helpdesk
    // workers.  Only users who hold this role at the account level see the
    // Helpdesk Tools panel.  This is an AccountMembership role and does NOT
    // appear in course enrollment responses.
    const ENROLL_HELPDESK_ADMIN_ROLE_ID = 178; // Admin permission role: "Enroll Help Desk"
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js';
    const VERSION_TOOLTIP_BASE = `Canvas Module Diagnostics v${SCRIPT_VERSION}\nDiagnoses module completion requirement issues for helpdesk staff.\nMade for Northern Kentucky University.`;
    const VERSION_CHECK_CACHE_KEY = 'cmd_version_check';
    const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const CANVAS_STATUS_URL = 'https://status.instructure.com/api/v2/summary.json';
    const COLLAPSED_STORAGE_KEY = 'module_diagnostics_collapsed';
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

    const log = (...args) => DEBUG && console.log('Canvas Module Diagnostics:', ...args);
    const warn = (...args) => console.warn('Canvas Module Diagnostics:', ...args);
    const err = (...args) => console.error('Canvas Module Diagnostics:', ...args);

    // Global state
    const domain = window.location.hostname;
    let courseId;
    let userId;
    let panelContainer;
    let toggleBtn = null;
    let panelBodyEl = null;
    let titleBadgeEl = null;
    // Per-check issue flags; recomputed on every result so the badge clears
    // automatically when a re-run reports no issues.
    const panelIssues = { canvasStatus: false };

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

    // Try to get user ID from the page synchronously (methods 1–3)
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
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://${domain}/api/v1/users/self/profile`,
            timeout: REQUEST_TIMEOUT_MS,
            headers: { Accept: 'application/json', 'X-CSRF-Token': getCsrfToken() },
            onload(response) {
                if (response.status >= 200 && response.status < 300) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data && data.id) {
                            userId = data.id;
                            log('Found user ID from API:', userId);
                            checkPermissionsAndProceed();
                        }
                    } catch (e) {
                        err('Error parsing user profile response', e);
                    }
                } else {
                    err('Failed to get user profile from API', response.statusText);
                }
            },
            ontimeout() { err('User profile request timed out'); },
            onerror(e) { err('User profile request error', e); },
        });
    }

    // ─── Permission check ─────────────────────────────────────────────────────

    // Checks whether the current user holds the "Enroll Help Desk" account-level
    // admin role (role_id 178).  This is an AccountMembership role and therefore
    // will NOT appear in course enrollment responses — it must be verified via the
    // account admins endpoint.  Only users with that account role see the panel.
    // A second fetch then checks course enrollments for role_id 177 (Helpdesk) to
    // determine whether the user is already enrolled in this course as Helpdesk.
    function checkPermissionsAndProceed() {
        log('Checking Enroll Help Desk account permission (role', ENROLL_HELPDESK_ADMIN_ROLE_ID, ')');
        const adminsUrl = `https://${domain}/api/v1/accounts/1/admins?user_id=${userId}&per_page=100`;
        fetchAllPagesRaw(adminsUrl, getCsrfToken(), [],
            (admins) => {
                const hasAdminRole = admins.some(
                    a => a.role_id === ENROLL_HELPDESK_ADMIN_ROLE_ID);
                if (!hasAdminRole) {
                    log('User does not have Enroll Help Desk account role, hiding panel');
                    // No panel shown — the script is silent for users without the role.
                    return;
                }
                log('User has Enroll Help Desk account role, checking course enrollment status');
                // Check course enrollments to see if this user is already enrolled
                // as Helpdesk in the current course.
                const enrollUrl = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=100`;
                fetchAllPagesRaw(enrollUrl, getCsrfToken(), [],
                    (enrollments) => {
                        const isEnrolled = enrollments.some(
                            e => e.role_id === HELPDESK_ROLE_ID);
                        initializePanel(isEnrolled);
                    },
                    (error) => {
                        log('Course enrollment check failed:', error);
                        // Show the panel anyway — the user has the account permission.
                        // The enroll/unenroll action will reveal any access issue.
                        initializePanel(false);
                    }
                );
            },
            (error) => {
                log('Account permission check failed:', error);
                // Silently exit — do not render a panel for users who may not
                // have this account role or whose request was refused.
            }
        );
    }

    // ─── UI construction ──────────────────────────────────────────────────────

    function initializePanel(isEnrolled) {
        if (document.getElementById('module-diagnostics-container')) return;

        panelIssues.canvasStatus = false;
        panelContainer = document.createElement('div');
        panelContainer.id = 'module-diagnostics-container';
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
        try {
            isCollapsed = localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true';
        } catch (error) {
            isCollapsed = false;
        }
        toggleBtn = document.createElement('button');
        toggleBtn.textContent = isCollapsed ? '▶' : '▼';
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        toggleBtn.setAttribute('aria-controls', 'module-diagnostics-body');
        toggleBtn.setAttribute('aria-label',
            isCollapsed ? 'Expand Helpdesk Toolkit panel' : 'Collapse Helpdesk Toolkit panel');
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
        title.textContent = 'Helpdesk Toolkit';
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
        versionIcon.setAttribute('aria-label', `Canvas Module Diagnostics v${SCRIPT_VERSION} — checking for updates`);
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
        panelBodyEl.id = 'module-diagnostics-body';
        if (isCollapsed) panelBodyEl.style.display = 'none';

        toggleBtn.addEventListener('click', () => {
            const nowCollapsed = panelBodyEl.style.display !== 'none';
            panelBodyEl.style.display = nowCollapsed ? 'none' : '';
            toggleBtn.textContent = nowCollapsed ? '▶' : '▼';
            toggleBtn.setAttribute('aria-expanded', String(!nowCollapsed));
            toggleBtn.setAttribute('aria-label', nowCollapsed
                ? 'Expand Helpdesk Toolkit panel'
                : 'Collapse Helpdesk Toolkit panel');
            try { localStorage.setItem(COLLAPSED_STORAGE_KEY, String(nowCollapsed)); } catch (_) {}
            updateTitleBadge();
        });

        // ── Enrollment section ────────────────────────────────────────────────

        // Show enroll button when not enrolled (or status unknown)
        if (isEnrolled === null || !isEnrolled) {
            const enrollButton = createButton('Enroll as Helpdesk', 'primary');
            enrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error', enrollButton); return; }
                setButtonsDisabled(true);
                enrollAsHelpdesk(courseId, uid, domain, getCsrfToken());
            });
            panelBodyEl.appendChild(enrollButton);
        }

        // Show unenroll button when enrolled (or status unknown)
        if (isEnrolled === null || isEnrolled) {
            const unenrollButton = createButton('Unenroll Completely', 'danger');
            unenrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error', unenrollButton); return; }
                setButtonsDisabled(true);
                unenrollCompletely(courseId, uid, domain, getCsrfToken());
            });
            panelBodyEl.appendChild(unenrollButton);
        }

        // ── Module Completion Diagnostics section ─────────────────────────────
        const sep = document.createElement('hr');
        Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
        panelBodyEl.appendChild(sep);

        const diagTitle = document.createElement('h4');
        diagTitle.textContent = 'Module Completion Diagnostics';
        Object.assign(diagTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
        panelBodyEl.appendChild(diagTitle);

        buildModuleDiagnosticsUI(panelBodyEl);

        panelContainer.appendChild(panelBodyEl);
        insertPanelContainer();
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
                        `Show incomplete module requirements for ${student.name}`;

                    diagBtn.addEventListener('click', () => {
                        const diagDiv = document.createElement('div');
                        Object.assign(diagDiv.style, {
                            marginTop: '8px',
                            padding: '6px',
                            backgroundColor: '#fff',
                            borderRadius: '4px',
                            border: '1px solid #ddd',
                        });
                        diagDiv.textContent =
                            `Loading completion data for ${student.name}…`;

                        // Replace any previous diagnostic result panel
                        const existing =
                            resultsDiv.querySelector('.student-diag-results');
                        if (existing) existing.remove();

                        diagDiv.className = 'student-diag-results';
                        resultsDiv.appendChild(diagDiv);
                        showStudentDiagnostics(student.id, student.name, diagDiv);
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
    function showStudentDiagnostics(studentId, studentName, diagDiv) {
        const url = `https://${domain}/api/v1/courses/${courseId}/modules` +
            `?student_id=${studentId}&include[]=items&include[]=content_details&per_page=100`;
        fetchAllPagesRaw(url, getCsrfToken(), [],
            (modules) => {
                diagDiv.innerHTML = '';

                const header = document.createElement('div');
                Object.assign(header.style, { fontWeight: 'bold', marginBottom: '6px' });
                header.textContent = `Completion status for: ${studentName}`;
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

    function unenrollCompletely(courseId, userId, domain, csrfToken) {
        log(`Unenrolling user ${userId} from course ${courseId}`);

        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=100`;
        fetchAllPagesRaw(url, csrfToken, [],
            (enrollments) => {
                const targets = enrollments.filter(e =>
                    e.role_id === HELPDESK_ROLE_ID);

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

                    // Try task=delete first; fall back to task=conclude (conclude requires
                    // fewer permissions in some Canvas configurations).
                    makeApiCall(deleteUrl, 'DELETE', null, csrfToken,
                        onSuccess,
                        () => makeApiCall(concludeUrl, 'DELETE', null, csrfToken,
                            onSuccess, onFailure)
                    );
                });
            },
            (error) => {
                showMessage(`Failed to get enrollments: ${error}`, 'error');
                setButtonsDisabled(false);
            }
        );
    }

    // ─── Core API helper ──────────────────────────────────────────────────────

    function makeApiCall(url, method, data, csrfToken, successCallback, errorCallback) {
        log(`${method} ${url}`);
        const body = data ? JSON.stringify(data) : null;
        const headers = {
            'X-CSRF-Token': csrfToken,
            Accept: 'application/json',
        };
        if (body || ['POST', 'PUT', 'PATCH'].includes(method)) {
            headers['Content-Type'] = 'application/json';
        }

        GM_xmlhttpRequest({
            method,
            url,
            timeout: REQUEST_TIMEOUT_MS,
            headers,
            data: body,
            onload(response) {
                log(`Response ${response.status} for ${method} ${url}`);
                if (response.status >= 200 && response.status < 300) {
                    let parsed = {};
                    if (response.responseText) {
                        try { parsed = JSON.parse(response.responseText); }
                        catch (e) { warn('Could not parse response body:', e); }
                    }
                    successCallback(parsed);
                } else {
                    err(`Request failed ${response.status}:`, response.responseText);
                    errorCallback(`HTTP ${response.status}`, response.responseText);
                }
            },
            ontimeout() { errorCallback('Request timed out', ''); },
            onerror() { errorCallback('Network error', ''); },
        });
    }

    // Fetches all pages of a Canvas API endpoint, following Link rel="next" headers.
    // Calls onComplete(allItems) when done, or onError(msg) on failure.
    function fetchAllPagesRaw(url, csrfToken, accumulated, onComplete, onError) {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
                Accept: 'application/json',
            },
            onload(response) {
                if (response.status >= 200 && response.status < 300) {
                    let parsed = [];
                    try { parsed = JSON.parse(response.responseText); } catch (e) { /* ignore */ }
                    const items = accumulated.concat(Array.isArray(parsed) ? parsed : []);

                    // Follow Link: <url>; rel="next" if present
                    const linkHeader = response.responseHeaders
                        .split('\n')
                        .find(h => h.trim().toLowerCase().startsWith('link:'));
                    const nextMatch = linkHeader && /<([^>]+)>;\s*rel="next"/.exec(linkHeader);
                    if (nextMatch) {
                        fetchAllPagesRaw(nextMatch[1], csrfToken, items, onComplete, onError);
                    } else {
                        onComplete(items);
                    }
                } else {
                    onError(`HTTP ${response.status}`);
                }
            },
            ontimeout() { onError('Request timed out'); },
            onerror() { onError('Network error'); },
        });
    }

    // ─── Small utilities ──────────────────────────────────────────────────────

    function getCsrfToken() {
        // Canvas stores the CSRF token URL-encoded in the _csrf_token cookie.
        const cookieMatch = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
        if (cookieMatch) {
            try { return decodeURIComponent(cookieMatch[1]); }
            catch (e) { warn('Could not decode _csrf_token cookie:', e); }
        }
        const token = document.querySelector('meta[name="csrf-token"]')
            ?.getAttribute('content');
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
        if (!panelContainer || !document.getElementById('module-diagnostics-container')) {
            err('Cannot show message — panel container not in DOM');
            return;
        }
        const div = document.createElement('div');
        div.className = `alert alert-${type}`;
        div.textContent = message;
        div.style.marginBottom = '10px';
        div.tabIndex = -1;

        // Mark as a live region so screen readers announce status messages.
        // Use an assertive alert role for error/danger messages, and a polite
        // status role for non-urgent informational messages.
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

    // ─── Canvas Status indicator ──────────────────────────────────────────────

    function fetchCanvasStatus(el) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: CANVAS_STATUS_URL,
            timeout: REQUEST_TIMEOUT_MS,
            headers: { Accept: 'application/json' },
            onload(response) {
                if (response.status >= 200 && response.status < 300) {
                    try {
                        const data = JSON.parse(response.responseText);
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
            },
            onerror() {
                el.textContent = '⚪';
                el.title = 'Could not reach status.instructure.com';
                el.setAttribute('aria-label', 'Canvas status: unavailable');
            },
            ontimeout() {
                el.textContent = '⚪';
                el.title = 'Canvas status request timed out';
                el.setAttribute('aria-label', 'Canvas status: unavailable');
            },
        });
    }

    function updateStatusIndicator(el, data) {
        const allComponents = data?.components ?? [];
        const incidents = data?.incidents ?? [];

        // Filter to only the components NKU uses
        const relevant = allComponents.filter(c => RELEVANT_COMPONENTS.has(c.name));

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
        let worstRank = 0;
        relevant.forEach(c => {
            const rank = STATUS_RANK[c.status] ?? 0;
            if (rank > worstRank) worstRank = rank;
        });

        const indicator = worstRank === 0 ? 'none' : worstRank <= 2 ? 'minor' : 'major';

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

        const description = indicator === 'none' ? 'All Systems Operational'
            : indicator === 'minor' ? 'Partial Disruption'
            : 'Major Disruption';

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

    // Escapes HTML special characters to prevent XSS when inserting API-sourced
    // strings (e.g. module item titles) into innerHTML.
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildErrorMessage(error, responseText) {
        try {
            const data = JSON.parse(responseText);
            if (data?.errors) return `${error}: ${JSON.stringify(data.errors)}`;
            if (data?.message) return `${error}: ${data.message}`;
        } catch (_) { /* not JSON */ }
        return error;
    }

    function insertPanelContainer() {
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

    // ─── GitHub version check ─────────────────────────────────────────────────

    function fetchLatestVersion(el) {
        // Use a cached result if it is less than 24 hours old to avoid hitting
        // GitHub's raw-content servers on every page load.
        try {
            const cached = JSON.parse(
                localStorage.getItem(VERSION_CHECK_CACHE_KEY) || 'null');
            const age = Date.now() - cached?.ts;
            if (cached && typeof cached.version === 'string' && cached.version &&
                typeof cached.ts === 'number' && age >= 0 && age < VERSION_CHECK_TTL_MS) {
                updateVersionTooltip(el, cached.version);
                return;
            }
        } catch (_) { /* corrupt cache — fall through to a fresh fetch */ }

        GM_xmlhttpRequest({
            method: 'GET',
            url: UPDATE_CHECK_URL,
            timeout: REQUEST_TIMEOUT_MS,
            onload(response) {
                if (response.status >= 200 && response.status < 300) {
                    const match = response.responseText.match(
                        /\/\/\s*@version\s+([\d.]+(?:[-+][^\s]*)?)/);
                    if (match) {
                        const latestVersion = match[1].trim();
                        try {
                            localStorage.setItem(VERSION_CHECK_CACHE_KEY,
                                JSON.stringify({ version: latestVersion, ts: Date.now() }));
                        } catch (_) { /* storage unavailable — ignore */ }
                        updateVersionTooltip(el, latestVersion);
                    } else {
                        el.title = `${VERSION_TOOLTIP_BASE}\n\nCould not determine latest version.`;
                    }
                } else {
                    el.title =
                        `${VERSION_TOOLTIP_BASE}\n\nUpdate check failed (HTTP ${response.status}).`;
                }
            },
            onerror() {
                el.title = `${VERSION_TOOLTIP_BASE}\n\nUpdate check failed (network error).`;
            },
            ontimeout() {
                el.title = `${VERSION_TOOLTIP_BASE}\n\nUpdate check timed out.`;
            },
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
            el.setAttribute('aria-label', `Canvas Module Diagnostics v${SCRIPT_VERSION} — up to date`);
        } else {
            el.textContent = '🔔';
            el.title =
                `${VERSION_TOOLTIP_BASE}\n\n⚠️ Update available: v${latestVersion}\n` +
                `Open the Tampermonkey dashboard to update.`;
            el.setAttribute('aria-label', `Canvas Module Diagnostics — update available: v${latestVersion}`);
        }
    }
})();
