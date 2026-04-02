// ==UserScript==
// @name         Canvas Instructor Helper
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Adds a Course Health panel to Canvas course pages for instructors
// @author       NKU CETI
// @match        https://*.instructure.com/courses/*
// @grant        GM_xmlhttpRequest
// @connect      *.instructure.com
// @connect      status.instructure.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Instructor%20Tools/Canvas-Instructor-Plugin/canvas-instructor-helper.user.js
// @downloadURL  https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Instructor%20Tools/Canvas-Instructor-Plugin/canvas-instructor-helper.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.2';
    const DEBUG = false;
    const REQUEST_TIMEOUT_MS = 15000;
    const LINK_VALIDATOR_POLL_INTERVAL_MS = 4000;
    // After this many polls without seeing queued/running, accept a completed result anyway.
    // This covers fast jobs that finish before the first poll can observe them in-progress.
    // 3 polls × 4 s = 12 s maximum wait before showing results.
    const LINK_VALIDATOR_GRACE_POLLS = 3;
    // Hard ceiling: 75 polls × 4 s = 5 minutes before we give up and surface a timeout.
    const LINK_VALIDATOR_MAX_POLLS = 75;
    const NKU_DOMAINS = ['nku.instructure.com', 'nku.beta.instructure.com', 'nku.test.instructure.com'];
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Instructor%20Tools/Canvas-Instructor-Plugin/canvas-instructor-helper.user.js';
    const VERSION_TOOLTIP_BASE = `Canvas Instructor Helper v${SCRIPT_VERSION}\nRuns course health checks for instructors.\nMade for Northern Kentucky University.`;
    const VERSION_CHECK_CACHE_KEY = 'cih_version_check';
    const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const CETI_BOOKING_URL = 'https://outlook.office.com/book/CenterforExcellenceinTeachingandInnovation@mymailnku.onmicrosoft.com/?ismsaljsauthenabled';
    const PANEL_COLLAPSED_KEY = 'cih_panel_collapsed';

    const log = (...args) => DEBUG && console.log('Canvas Instructor Helper:', ...args);
    const warn = (...args) => console.warn('Canvas Instructor Helper:', ...args);
    const err = (...args) => console.error('Canvas Instructor Helper:', ...args);

    // Global variables
    const domain = window.location.hostname;
    let courseId;
    let userId;
    let panelContainer;
    let linkValidatorPollInterval = null;

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

    // ─── User ID helpers ─────────────────────────────────────────────────────

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

    // Checks whether the current user has a TeacherEnrollment or TaEnrollment in
    // this course, which is the minimum permission level required for this script.
    // If the check fails or the user has no qualifying enrollment, a contextual
    // "no access" panel is shown instead of the main UI.
    function checkPermissionsAndProceed() {
        log('Checking instructor permissions');
        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}&per_page=50`;
        makeApiCall(url, 'GET', null, getCsrfToken(),
            (enrollments) => {
                const hasInstructorRole = Array.isArray(enrollments) && enrollments.some(e =>
                    e.type === 'TeacherEnrollment' || e.type === 'TaEnrollment'
                );
                if (hasInstructorRole) {
                    log('User has instructor access, proceeding');
                    initializePanel();
                } else {
                    log('User has no instructor access');
                    showNoPermissionPanel();
                }
            },
            (error) => {
                log('Permission check failed:', error);
                showNoPermissionPanel();
            }
        );
    }

    function showNoPermissionPanel() {
        if (document.getElementById('instructor-helper-container')) return;

        const isNkuDomain = NKU_DOMAINS.includes(domain);

        panelContainer = document.createElement('div');
        panelContainer.id = 'instructor-helper-container';
        Object.assign(panelContainer.style, {
            margin: '10px 0',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            border: '1px solid #ddd',
        });

        const title = document.createElement('h3');
        title.textContent = 'Instructor Tools';
        Object.assign(title.style, { margin: '0 0 8px 0' });
        panelContainer.appendChild(title);

        const msg = document.createElement('p');
        Object.assign(msg.style, { margin: '0', fontSize: '0.95em' });

        if (isNkuDomain) {
            msg.innerHTML =
                'This script is for course instructors and teaching assistants only. ' +
                'If you believe you should have access, please contact ' +
                '<a href="mailto:ceti@nku.edu">ceti@nku.edu</a>.';
        } else {
            msg.textContent =
                'This script was built for Northern Kentucky University and requires ' +
                'a Teacher or TA enrollment in the current course. It does not appear ' +
                'that your account meets this requirement. If it is not working for you, ' +
                'you will need to investigate the compatibility and permission requirements ' +
                'on your own — this project does not provide support for other institutions.';
        }

        panelContainer.appendChild(msg);
        insertPanelContainer();
    }

    // ─── UI construction ──────────────────────────────────────────────────────

    function initializePanel() {
        if (document.getElementById('instructor-helper-container')) return;

        panelContainer = document.createElement('div');
        panelContainer.id = 'instructor-helper-container';
        Object.assign(panelContainer.style, {
            margin: '10px 0',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            border: '1px solid #ddd',
        });

        // ── Title row ─────────────────────────────────────────────────────────
        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
        });

        const titleLeft = document.createElement('div');
        Object.assign(titleLeft.style, { display: 'flex', alignItems: 'center', gap: '6px' });

        const collapseBtn = document.createElement('button');
        Object.assign(collapseBtn.style, {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 2px',
            fontSize: '0.75em',
            lineHeight: '1',
            color: '#555',
        });

        const title = document.createElement('h3');
        title.textContent = 'Instructor Tools';
        title.style.margin = '0';

        titleLeft.appendChild(collapseBtn);
        titleLeft.appendChild(title);
        titleRow.appendChild(titleLeft);

        const statusLink = document.createElement('a');
        statusLink.textContent = '⚪';
        statusLink.href = 'https://status.instructure.com';
        statusLink.target = '_blank';
        statusLink.title = 'Checking Canvas status…';
        Object.assign(statusLink.style, {
            fontSize: '1.1em',
            textDecoration: 'none',
            cursor: 'pointer',
        });

        const versionIcon = document.createElement('span');
        versionIcon.textContent = 'ℹ️';
        versionIcon.title = `${VERSION_TOOLTIP_BASE}\nChecking for updates…`;
        Object.assign(versionIcon.style, { fontSize: '1em', cursor: 'default' });

        const rightIcons = document.createElement('div');
        Object.assign(rightIcons.style, { display: 'flex', alignItems: 'center', gap: '6px' });
        rightIcons.appendChild(versionIcon);
        rightIcons.appendChild(statusLink);
        titleRow.appendChild(rightIcons);
        panelContainer.appendChild(titleRow);

        fetchCanvasStatus(statusLink);
        fetchLatestVersion(versionIcon);

        // ── Collapsible body ──────────────────────────────────────────────────
        const panelBody = document.createElement('div');
        panelBody.id = 'instructor-helper-body';

        const isCollapsed = getPanelCollapsed();
        panelBody.style.display = isCollapsed ? 'none' : '';
        collapseBtn.textContent = isCollapsed ? '▶' : '▼';
        collapseBtn.title = isCollapsed ? 'Expand panel' : 'Collapse panel';

        collapseBtn.addEventListener('click', () => {
            const nowCollapsed = panelBody.style.display !== 'none';
            panelBody.style.display = nowCollapsed ? 'none' : '';
            collapseBtn.textContent = nowCollapsed ? '▶' : '▼';
            collapseBtn.title = nowCollapsed ? 'Expand panel' : 'Collapse panel';
            setPanelCollapsed(nowCollapsed);
        });

        // ── Course Health section ──────────────────────────────────────────────
        const sep = document.createElement('hr');
        Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
        panelBody.appendChild(sep);

        const healthTitle = document.createElement('h4');
        healthTitle.textContent = 'Course Health';
        Object.assign(healthTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
        panelBody.appendChild(healthTitle);

        // Link validator row
        const linkValRow = document.createElement('div');
        linkValRow.style.marginBottom = '8px';

        const linkValBtn = createButton('Run Link Validator', 'default');
        linkValBtn.style.marginBottom = '4px';
        const linkValStatus = document.createElement('div');
        Object.assign(linkValStatus.style, { fontSize: '0.9em', marginTop: '2px' });

        linkValRow.appendChild(linkValBtn);
        linkValRow.appendChild(linkValStatus);
        panelBody.appendChild(linkValRow);

        linkValBtn.addEventListener('click', () => startLinkValidator(linkValBtn, linkValStatus));
        checkLinkValidatorStatus(linkValBtn, linkValStatus);

        // Due-date check row (assignments due before section start)
        const dueDateDiv = document.createElement('div');
        Object.assign(dueDateDiv.style, { fontSize: '0.9em', color: '#555', marginBottom: '6px' });
        dueDateDiv.textContent = 'Due date check has not been run yet.';
        panelBody.appendChild(dueDateDiv);

        const dueDateBtn = document.createElement('button');
        dueDateBtn.type = 'button';
        dueDateBtn.className = 'btn btn-default btn-xs';
        dueDateBtn.textContent = 'Run due date check';
        Object.assign(dueDateBtn.style, { marginBottom: '6px' });
        dueDateBtn.addEventListener('click', () => {
            dueDateDiv.textContent = 'Checking due dates…';
            checkDueDates(dueDateDiv);
        });
        panelBody.appendChild(dueDateBtn);

        // Grade weighting check row
        const gradeWeightDiv = document.createElement('div');
        Object.assign(gradeWeightDiv.style, { fontSize: '0.9em', color: '#555', marginBottom: '6px' });
        gradeWeightDiv.textContent = 'Grade weighting check has not been run yet.';
        panelBody.appendChild(gradeWeightDiv);

        const gradeWeightBtn = document.createElement('button');
        gradeWeightBtn.type = 'button';
        gradeWeightBtn.className = 'btn btn-default btn-xs';
        gradeWeightBtn.textContent = 'Run grade weighting check';
        Object.assign(gradeWeightBtn.style, { marginBottom: '6px' });
        gradeWeightBtn.addEventListener('click', () => {
            gradeWeightDiv.textContent = 'Checking grade weighting…';
            checkGradeWeighting(gradeWeightDiv);
        });
        panelBody.appendChild(gradeWeightBtn);

        // ── Get Help section (NKU only) ────────────────────────────────────────
        if (NKU_DOMAINS.includes(domain)) {
            const helpSep = document.createElement('hr');
            Object.assign(helpSep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
            panelBody.appendChild(helpSep);

            const helpTitle = document.createElement('h4');
            helpTitle.textContent = 'Get Help';
            Object.assign(helpTitle.style, { margin: '0 0 6px 0', fontSize: '1em' });
            panelBody.appendChild(helpTitle);

            const helpMsg = document.createElement('p');
            Object.assign(helpMsg.style, { margin: '0 0 6px 0', fontSize: '0.9em', color: '#555' });
            helpMsg.textContent = 'Need help with your course? Schedule time with an NKU instructional designer.';
            panelBody.appendChild(helpMsg);

            const helpLink = document.createElement('a');
            helpLink.textContent = 'Book an Appointment';
            helpLink.href = CETI_BOOKING_URL;
            helpLink.target = '_blank';
            helpLink.rel = 'noopener noreferrer';
            helpLink.className = 'btn btn-default';
            Object.assign(helpLink.style, { display: 'inline-block', fontSize: '0.9em' });
            panelBody.appendChild(helpLink);
        }

        panelContainer.appendChild(panelBody);
        insertPanelContainer();
    }

    function insertPanelContainer() {
        log('Attempting to insert panel container');

        const targets = [
            () => document.querySelector('.ic-app-main-content__secondary'),
            () => document.querySelector('#content'),
            () => { const el = document.querySelector('.course-title'); return el ? { prepend: (c) => el.after(c) } : null; },
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

    // ─── Core API helper ──────────────────────────────────────────────────────

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

    // ─── Small utilities ──────────────────────────────────────────────────────

    function getCsrfToken() {
        // Canvas stores the CSRF token URL-encoded in the _csrf_token cookie.
        // Decode and prefer that over the meta tag, which may contain a masked variant
        // that some Canvas versions don't accept on API endpoints.
        const cookieMatch = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
        if (cookieMatch) {
            try { return decodeURIComponent(cookieMatch[1]); } catch (e) { warn('Could not decode _csrf_token cookie:', e); }
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

    // ─── Canvas Status indicator ──────────────────────────────────────────────

    function fetchCanvasStatus(el) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://status.instructure.com/api/v2/summary.json',
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
                    }
                } else {
                    el.textContent = '⚪';
                    el.title = 'Could not fetch Canvas status';
                }
            },
            onerror() { el.textContent = '⚪'; el.title = 'Could not reach status.instructure.com'; },
            ontimeout() { el.textContent = '⚪'; el.title = 'Canvas status request timed out'; },
        });
    }

    function updateStatusIndicator(el, data) {
        const indicator = data?.status?.indicator ?? 'none';
        const description = data?.status?.description ?? 'Unknown';
        const incidents = data?.incidents ?? [];

        if (indicator === 'none') {
            el.textContent = '🟢';
        } else if (indicator === 'minor') {
            el.textContent = '🟡';
        } else {
            el.textContent = '🔴';
        }

        let tooltip = `Canvas Status: ${description}`;
        if (incidents.length > 0) {
            tooltip += '\n\nActive Incidents:';
            incidents.slice(0, 5).forEach(inc => {
                tooltip += `\n• ${inc.name} [${inc.status}]`;
            });
        }
        el.title = tooltip;
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

        GM_xmlhttpRequest({
            method: 'GET',
            url: UPDATE_CHECK_URL,
            timeout: REQUEST_TIMEOUT_MS,
            onload(response) {
                if (response.status >= 200 && response.status < 300) {
                    const match = response.responseText.match(/\/\/\s*@version\s+([\d.]+(?:[-+][^\s]*)?)/);
                    if (match) {
                        const latestVersion = match[1].trim();
                        try {
                            localStorage.setItem(VERSION_CHECK_CACHE_KEY, JSON.stringify({ version: latestVersion, ts: Date.now() }));
                        } catch (_) { /* storage unavailable — ignore */ }
                        updateVersionTooltip(el, latestVersion);
                    } else {
                        el.title = `${VERSION_TOOLTIP_BASE}\n\nCould not determine latest version.`;
                    }
                } else {
                    el.title = `${VERSION_TOOLTIP_BASE}\n\nUpdate check failed (HTTP ${response.status}).`;
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
            el.title = `${VERSION_TOOLTIP_BASE}\n\n⚠️ Update available: v${latestVersion}\nOpen the Tampermonkey dashboard to update.`;
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
        // after LINK_VALIDATOR_GRACE_POLLS consecutive polls.  This avoids the 2-minute
        // wait of the old time-based fallback while still protecting against reading a
        // stale completed result from a previous run on the very first poll.
        let seenInProgress = !isNewRun;
        let pollCount = 0;

        linkValidatorPollInterval = setInterval(() => {
            pollCount++;

            if (pollCount > LINK_VALIDATOR_MAX_POLLS) {
                clearInterval(linkValidatorPollInterval);
                linkValidatorPollInterval = null;
                statusDiv.textContent = 'Link validation timed out. The job may still be running in Canvas — try again in a few minutes.';
                btn.disabled = false;
                return;
            }

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
        return `canvas_ih_lv_last_run_${courseId}`;
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

    function formatLastRun(date) {
        if (!date) return null;
        return `Last run: ${date.toLocaleString()}`;
    }

    function appendLastRunLine(statusDiv) {
        const ts = getLinkValidatorLastRun();
        const text = formatLastRun(ts);
        if (!text) return;
        const line = document.createElement('div');
        Object.assign(line.style, { fontSize: '0.85em', color: '#777', marginTop: '3px' });
        line.textContent = text;
        statusDiv.appendChild(line);
    }

    function displayLinkValidatorResults(btn, statusDiv, data, saveTimestamp = false) {
        btn.disabled = false;
        btn.textContent = 'Re-run Link Validator';
        if (saveTimestamp) saveLinkValidatorLastRun();

        const issues = data.results?.issues || [];
        const reportUrl = `https://${domain}/courses/${courseId}/link_validator`;

        statusDiv.innerHTML = '';
        const resultLine = document.createElement('div');
        if (issues.length === 0) {
            resultLine.innerHTML = `✅ No broken links found. <a href="${reportUrl}" target="_blank">View report</a>`;
        } else {
            // Count total broken link occurrences across all content items
            const brokenLinkCount = issues.reduce((sum, item) => sum + (item.invalid_links?.length ?? 0), 0);
            resultLine.innerHTML =
                `⚠️ ${brokenLinkCount} broken link(s) across ${issues.length} item(s). ` +
                `<a href="${reportUrl}" target="_blank">View full report →</a>`;
        }
        statusDiv.appendChild(resultLine);
        appendLastRunLine(statusDiv);
    }

    // ─── Pagination helper ────────────────────────────────────────────────────

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
                fetchAssignmentsAndCheckEarly(container, earliestEntry, hasMultiple);
            },
            () => { container.textContent = 'Could not fetch section data.'; }
        );
    }

    function fetchAssignmentsAndCheckEarly(container, earliestEntry, hasMultiple) {
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
                    return;
                }

                const dateStr = earliestEntry.start.toLocaleDateString();
                const note = hasMultiple
                    ? ` (using earliest section start: "${earliestEntry.name}", ${dateStr})`
                    : ` (${dateStr})`;
                container.textContent = `⚠️ ${earlyDue.length} assignment(s) due before section start${note}:`;

                const list = document.createElement('ul');
                Object.assign(list.style, { margin: '4px 0 0 0', paddingLeft: '18px' });

                earlyDue.slice(0, 5).forEach(a => {
                    const li = document.createElement('li');
                    const due = new Date(a.due_at).toLocaleDateString();

                    const link = document.createElement('a');
                    link.href = `https://${domain}/courses/${courseId}/assignments/${a.id}`;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    link.textContent = a.name;

                    const dueSpan = document.createElement('span');
                    dueSpan.style.color = '#888';
                    dueSpan.textContent = ` (due ${due})`;

                    li.appendChild(link);
                    li.appendChild(dueSpan);
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

    // ─── Grade Weighting Checker ──────────────────────────────────────────────

    // Fetches the course settings and assignment groups to diagnose potential
    // issues with grade weighting configuration.
    function checkGradeWeighting(container) {
        const courseUrl = `https://${domain}/api/v1/courses/${courseId}`;
        makeApiCall(courseUrl, 'GET', null, getCsrfToken(),
            (course) => {
                if (!course.apply_assignment_group_weights) {
                    container.textContent = 'ℹ️ This course does not use weighted assignment groups.';
                    return;
                }
                fetchAllPagesRaw(
                    `https://${domain}/api/v1/courses/${courseId}/assignment_groups?include[]=assignments&per_page=100`,
                    getCsrfToken(), [],
                    (groups) => renderGradeWeightResults(container, groups),
                    () => { container.textContent = 'Could not fetch assignment group data.'; }
                );
            },
            () => { container.textContent = 'Could not fetch course data.'; }
        );
    }

    function renderGradeWeightResults(container, groups) {
        container.innerHTML = '';

        if (!groups || groups.length === 0) {
            container.textContent = 'ℹ️ No assignment groups found.';
            return;
        }

        const totalWeight = groups.reduce((sum, g) => sum + (g.group_weight || 0), 0);
        const rounded = Math.round(totalWeight * 10) / 10;
        const settingsUrl = `https://${domain}/courses/${courseId}/assignments`;
        const messages = [];

        if (totalWeight === 0) {
            container.innerHTML =
                `⚠️ Weighted grades are enabled but all assignment groups are at 0%. ` +
                `<a href="${settingsUrl}" target="_blank">Review assignment groups →</a>`;
            return;
        } else if (rounded === 100) {
            // Check for assignments named "extra credit" — these won't actually add
            // extra credit in a standard weighted course where weights sum to 100%.
            const allAssignments = groups.flatMap(g => g.assignments || []);
            const ecAssignments = allAssignments.filter(
                a => /extra\s*credit/i.test(a.name) && a.published !== false
            );
            if (ecAssignments.length > 0) {
                messages.push(
                    `ℹ️ Weights total 100%, but ${ecAssignments.length} assignment(s) appear to be ` +
                    `named "extra credit". Simply naming an assignment "extra credit" does not make ` +
                    `it extra credit in a weighted course. Consider using Canvas's Fudge Points ` +
                    `feature or a dedicated extra credit assignment group weighted above 100%.`
                );
            } else {
                messages.push('✅ Assignment group weights total 100%.');
            }
        } else if (rounded < 100) {
            messages.push(
                `⚠️ Assignment group weights total ${rounded}% (expected 100%). ` +
                `Student grades may not calculate as expected.`
            );
        } else {
            messages.push(
                `ℹ️ Assignment group weights total ${rounded}% — ` +
                `this may apply extra credit to student final grades.`
            );
        }

        // If there are 3 or more groups, flag any single group that accounts for
        // more than 60% of the total weight — likely an accidental misconfiguration.
        if (groups.length >= 3 && totalWeight > 0) {
            const maxGroup = groups.reduce((a, b) =>
                (a.group_weight || 0) > (b.group_weight || 0) ? a : b
            );
            const maxWeight = maxGroup.group_weight || 0;
            if (maxWeight / totalWeight > 0.6) {
                messages.push(
                    `ℹ️ "${maxGroup.name}" is weighted at ${maxWeight}%, ` +
                    `accounting for more than 60% of the total grade weight across ` +
                    `${groups.length} groups. Double-check that this is intentional.`
                );
            }
        }

        messages.forEach((msg, i) => {
            const div = document.createElement('div');
            if (i > 0) div.style.marginTop = '4px';
            div.textContent = msg;
            container.appendChild(div);
        });

        const linkDiv = document.createElement('div');
        Object.assign(linkDiv.style, { marginTop: '4px', fontSize: '0.85em' });
        linkDiv.innerHTML = `<a href="${settingsUrl}" target="_blank">View Assignment Groups →</a>`;
        container.appendChild(linkDiv);
    }

    // ─── Panel collapse helpers ───────────────────────────────────────────────

    function getPanelCollapsed() {
        try { return localStorage.getItem(PANEL_COLLAPSED_KEY) === 'true'; } catch (_) { return false; }
    }

    function setPanelCollapsed(collapsed) {
        try { localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? 'true' : 'false'); } catch (_) { /* storage unavailable */ }
    }

})();
