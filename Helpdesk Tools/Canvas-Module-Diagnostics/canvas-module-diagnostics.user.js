// ==UserScript==
// @name         Canvas Module Diagnostics
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds a Helpdesk Tools panel to Canvas course pages for diagnosing module completion requirement issues
// @author       NKU CETI
// @match        https://*.instructure.com/courses/*
// @grant        GM_xmlhttpRequest
// @connect      *.instructure.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js
// @downloadURL  https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.1';
    const DEBUG = false;
    const REQUEST_TIMEOUT_MS = 15000;
    // NKU's internal Canvas role ID for the Helpdesk course enrollment role.
    // To find yours: GET https://<domain>/api/v1/accounts/:account_id/roles
    const HELPDESK_ROLE_ID = 177; // Course enrollment role: "Helpdesk"
    const HELPDESK_ROLE_NAME = 'Helpdesk'; // Display name of the role in Canvas
    // Account-level admin role that grants permission to enroll/unenroll helpdesk
    // workers.  Only users who have this role in the current course will see the
    // Helpdesk Tools panel.
    const ENROLL_HELPDESK_ADMIN_ROLE_ID = 178; // Admin permission role: "Enroll Help Desk"
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Helpdesk%20Tools/Canvas-Module-Diagnostics/canvas-module-diagnostics.user.js';
    const VERSION_TOOLTIP_BASE = `Canvas Module Diagnostics v${SCRIPT_VERSION}\nDiagnoses module completion requirement issues for helpdesk staff.\nMade for Northern Kentucky University.`;
    const VERSION_CHECK_CACHE_KEY = 'cmd_version_check';
    const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

    // Only run on course pages
    const courseIdMatch = window.location.pathname.match(/\/courses\/(\d+)/);
    if (!courseIdMatch) {
        log('Not on a course page, exiting');
        return;
    }

    courseId = courseIdMatch[1];
    log('Found course ID:', courseId);

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

    // Checks whether the current user has the "Enroll Help Desk" admin role
    // (role_id 178) in this course.  Only users with that role see the panel.
    // The same API response is used to detect whether the user is already
    // enrolled as Helpdesk (role_id 177) so we avoid a second network call.
    function checkPermissionsAndProceed() {
        log('Checking Enroll Help Desk permission (role', ENROLL_HELPDESK_ADMIN_ROLE_ID, ')');
        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=100`;
        fetchAllPagesRaw(url, getCsrfToken(), [],
            (enrollments) => {
                const hasAdminRole = enrollments.some(
                    e => e.role_id === ENROLL_HELPDESK_ADMIN_ROLE_ID);
                if (!hasAdminRole) {
                    log('User does not have Enroll Help Desk role, hiding panel');
                    // No panel shown — the script is silent for users without the role.
                    return;
                }
                log('User has Enroll Help Desk role, proceeding');
                const isEnrolled = enrollments.some(
                    e => e.role_id === HELPDESK_ROLE_ID);
                initializePanel(isEnrolled);
            },
            (error) => {
                log('Permission check failed:', error);
                // Silently exit — do not render a panel for users who may not
                // have access or are not enrolled in the course at all.
            }
        );
    }

    // ─── UI construction ──────────────────────────────────────────────────────

    function initializePanel(isEnrolled) {
        if (document.getElementById('module-diagnostics-container')) return;

        panelContainer = document.createElement('div');
        panelContainer.id = 'module-diagnostics-container';
        Object.assign(panelContainer.style, {
            margin: '10px 0',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            border: '1px solid #ddd',
        });

        // Title row with version icon on the right
        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
        });

        const title = document.createElement('h3');
        title.textContent = 'Helpdesk Tools';
        title.style.margin = '0';
        titleRow.appendChild(title);

        const versionIcon = document.createElement('span');
        versionIcon.textContent = 'ℹ️';
        versionIcon.title = `${VERSION_TOOLTIP_BASE}\nChecking for updates…`;
        Object.assign(versionIcon.style, { fontSize: '1em', cursor: 'default' });
        titleRow.appendChild(versionIcon);

        panelContainer.appendChild(titleRow);
        fetchLatestVersion(versionIcon);

        // ── Enrollment section ────────────────────────────────────────────────

        // Show enroll button when not enrolled (or status unknown)
        if (isEnrolled === null || !isEnrolled) {
            const enrollButton = createButton('Enroll as Helpdesk', 'primary');
            enrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error'); return; }
                setButtonsDisabled(true);
                enrollAsHelpdesk(courseId, uid, domain, getCsrfToken());
            });
            panelContainer.appendChild(enrollButton);
        }

        // Show unenroll button when enrolled (or status unknown)
        if (isEnrolled === null || isEnrolled) {
            const unenrollButton = createButton('Unenroll Completely', 'danger');
            unenrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error'); return; }
                setButtonsDisabled(true);
                unenrollCompletely(courseId, uid, domain, getCsrfToken());
            });
            panelContainer.appendChild(unenrollButton);
        }

        // ── Module Completion Diagnostics section ─────────────────────────────
        const sep = document.createElement('hr');
        Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
        panelContainer.appendChild(sep);

        const diagTitle = document.createElement('h4');
        diagTitle.textContent = 'Module Completion Diagnostics';
        Object.assign(diagTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
        panelContainer.appendChild(diagTitle);

        buildModuleDiagnosticsUI(panelContainer);

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
        container.appendChild(moduleSummaryDiv);

        scanBtn.addEventListener('click', () => {
            scanBtn.disabled = true;
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
        log(`Enrolling user ${userId} as Helpdesk in course ${courseId}`);

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

    function showMessage(message, type) {
        if (!panelContainer || !document.getElementById('module-diagnostics-container')) {
            err('Cannot show message — panel container not in DOM');
            return;
        }
        const div = document.createElement('div');
        div.className = `alert alert-${type}`;
        div.textContent = message;
        div.style.marginBottom = '10px';
        panelContainer.prepend(div);
        setTimeout(() => {
            div.style.transition = 'opacity 0.5s';
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
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
        } else {
            el.textContent = '🔔';
            el.title =
                `${VERSION_TOOLTIP_BASE}\n\n⚠️ Update available: v${latestVersion}\n` +
                `Open the Tampermonkey dashboard to update.`;
        }
    }
})();
