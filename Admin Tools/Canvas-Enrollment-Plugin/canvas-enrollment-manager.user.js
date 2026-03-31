// ==UserScript==
// @name         Canvas Enrollment Manager
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Adds buttons to Canvas course pages to modify your enrollment
// @author       NKU CETI
// @match        https://*.instructure.com/courses/*
// @grant        GM_xmlhttpRequest
// @connect      *.instructure.com
// @connect      status.instructure.com
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Admin%20Tools/Canvas-Enrollment-Plugin/canvas-enrollment-manager.user.js
// @downloadURL  https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Admin%20Tools/Canvas-Enrollment-Plugin/canvas-enrollment-manager.user.js
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = '1.5';
    const DEBUG = false;
    const REQUEST_TIMEOUT_MS = 15000;
    const LINK_VALIDATOR_POLL_INTERVAL_MS = 4000;
    const NKU_DOMAINS = ['nku.instructure.com', 'nku.beta.instructure.com', 'nku.test.instructure.com'];
    // After this many polls without seeing queued/running, accept a completed result anyway.
    // This covers fast jobs that finish before the first poll can observe them in-progress.
    // 3 polls × 4 s = 12 s maximum wait before showing results.
    const LINK_VALIDATOR_GRACE_POLLS = 3;
    const DESIGNER_ROLE_ID = 5; // Institution-specific role ID for the Designer role
    const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/NKU-CETI/Canvas-Helper-Scripts/main/Admin%20Tools/Canvas-Enrollment-Plugin/canvas-enrollment-manager.user.js';
    const VERSION_TOOLTIP_BASE = `Canvas Enrollment Manager v${SCRIPT_VERSION}\nManages course enrollment and runs health checks.\nMade for Northern Kentucky University.`;
    const VERSION_CHECK_CACHE_KEY = 'cem_version_check';
    const VERSION_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    const log = (...args) => DEBUG && console.log('Canvas Enrollment Manager:', ...args);
    const warn = (...args) => console.warn('Canvas Enrollment Manager:', ...args);
    const err = (...args) => console.error('Canvas Enrollment Manager:', ...args);

    // Global variables
    const domain = window.location.hostname;
    let courseId;
    let userId;
    let buttonContainer;
    let linkValidatorPollInterval = null;

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
        // We have a user ID — check permissions, then fetch enrollment status and build the UI
        checkPermissionsAndProceed();
    } else {
        // Fall back to the API to retrieve the user ID, then check permissions and build the UI
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

    // Checks whether the current user has account-admin access in Canvas, which
    // is the minimum permission level required to manage course enrollments with
    // this script.  If the check fails or returns no accounts, a contextual
    // "no access" panel is shown instead of the main UI.
    function checkPermissionsAndProceed() {
        log('Checking account admin permissions');
        const url = `https://${domain}/api/v1/accounts?per_page=1`;
        makeApiCall(url, 'GET', null, getCsrfToken(),
            (accounts) => {
                if (Array.isArray(accounts) && accounts.length > 0) {
                    log('User has account admin access, proceeding');
                    fetchEnrollmentAndInit();
                } else {
                    log('User has no account admin access');
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
        if (document.getElementById('enrollment-manager-container')) return;

        const isNkuDomain = NKU_DOMAINS.includes(domain);

        buttonContainer = document.createElement('div');
        buttonContainer.id = 'enrollment-manager-container';
        Object.assign(buttonContainer.style, {
            margin: '10px 0',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            border: '1px solid #ddd',
        });

        const title = document.createElement('h3');
        title.textContent = 'Enrollment Management';
        Object.assign(title.style, { margin: '0 0 8px 0' });
        buttonContainer.appendChild(title);

        const msg = document.createElement('p');
        Object.assign(msg.style, { margin: '0', fontSize: '0.95em' });

        if (isNkuDomain) {
            msg.innerHTML =
                'This script requires account admin permissions in Canvas and will not ' +
                'work for your account. If you think you would have a use for it, please ' +
                'email <a href="mailto:ceti@nku.edu">ceti@nku.edu</a> to inquire about access.';
        } else {
            msg.textContent =
                'This script was built for Northern Kentucky University and requires ' +
                'specific Canvas admin permissions that your account does not appear to have. ' +
                'If it is not working for you, you will need to investigate the compatibility ' +
                'and permission requirements on your own — this project does not provide ' +
                'support for other institutions.';
        }

        buttonContainer.appendChild(msg);
        insertButtonContainer();
    }

    // ─── Enrollment status check ──────────────────────────────────────────────

    function fetchEnrollmentAndInit() {
        log('Fetching current enrollment status');
        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}`;
        makeApiCall(url, 'GET', null, getCsrfToken(),
            (enrollments) => {
                const active = enrollments.filter(e =>
                    e.type === 'DesignerEnrollment' || e.type === 'TeacherEnrollment');
                initializeButtons(active.length > 0);
            },
            (error) => {
                err('Could not fetch enrollment status, showing both buttons:', error);
                initializeButtons(null); // null = unknown, show both
            }
        );
    }

    // ─── UI construction ──────────────────────────────────────────────────────

    function initializeButtons(isEnrolled) {
        if (document.getElementById('enrollment-manager-container')) return;

        buttonContainer = document.createElement('div');
        buttonContainer.id = 'enrollment-manager-container';
        Object.assign(buttonContainer.style, {
            margin: '10px 0',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '4px',
            border: '1px solid #ddd',
        });

        // Title row with Canvas status indicator on the right
        const titleRow = document.createElement('div');
        Object.assign(titleRow.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
        });

        const title = document.createElement('h3');
        title.textContent = 'Enrollment Management';
        title.style.margin = '0';
        titleRow.appendChild(title);

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
        buttonContainer.appendChild(titleRow);

        fetchCanvasStatus(statusLink);
        fetchLatestVersion(versionIcon);

        // Show enroll button when not enrolled (or status unknown)
        if (isEnrolled === null || !isEnrolled) {
            const enrollButton = createButton('Enroll as Designer', 'primary');
            enrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error'); return; }
                setButtonsDisabled(true);
                enrollAsDesigner(courseId, uid, domain, getCsrfToken(), enrollButton);
            });
            buttonContainer.appendChild(enrollButton);
        }

        // Show unenroll button when enrolled (or status unknown)
        if (isEnrolled === null || isEnrolled) {
            const unenrollButton = createButton('Unenroll Completely', 'danger');
            unenrollButton.addEventListener('click', () => {
                const uid = getUserId() || userId;
                if (!uid) { showMessage('Unable to determine user ID', 'error'); return; }
                setButtonsDisabled(true);
                unenrollCompletely(courseId, uid, domain, getCsrfToken(), unenrollButton);
            });
            buttonContainer.appendChild(unenrollButton);
        }

        // ── Course Health section (only available when confirmed enrolled as Designer/Teacher) ──
        if (isEnrolled === true) {
            const sep = document.createElement('hr');
            Object.assign(sep.style, { margin: '10px 0', border: 'none', borderTop: '1px solid #ddd' });
            buttonContainer.appendChild(sep);

            const healthTitle = document.createElement('h4');
            healthTitle.textContent = 'Course Health';
            Object.assign(healthTitle.style, { margin: '0 0 8px 0', fontSize: '1em' });
            buttonContainer.appendChild(healthTitle);

            // Link validator row
            const linkValRow = document.createElement('div');
            linkValRow.style.marginBottom = '8px';

            const linkValBtn = createButton('Run Link Validator', 'default');
            linkValBtn.style.marginBottom = '4px';
            const linkValStatus = document.createElement('div');
            Object.assign(linkValStatus.style, { fontSize: '0.9em', marginTop: '2px' });

            linkValRow.appendChild(linkValBtn);
            linkValRow.appendChild(linkValStatus);
            buttonContainer.appendChild(linkValRow);

            linkValBtn.addEventListener('click', () => startLinkValidator(linkValBtn, linkValStatus));
            checkLinkValidatorStatus(linkValBtn, linkValStatus);

            // Due-date check row
            const dueDateDiv = document.createElement('div');
            Object.assign(dueDateDiv.style, { fontSize: '0.9em', color: '#555' });
            dueDateDiv.textContent = 'Checking due dates…';
            buttonContainer.appendChild(dueDateDiv);

            checkDueDates(dueDateDiv);
        }

        insertButtonContainer();
    }

    function setButtonsDisabled(disabled) {
        if (!buttonContainer) return;
        buttonContainer.querySelectorAll('button').forEach(btn => {
            btn.disabled = disabled;
            btn.style.opacity = disabled ? '0.6' : '1';
            btn.style.cursor = disabled ? 'not-allowed' : '';
        });
    }

    function insertButtonContainer() {
        log('Attempting to insert button container');

        const targets = [
            () => document.querySelector('.ic-app-main-content__secondary'),
            () => document.querySelector('#content'),
            () => { const el = document.querySelector('.course-title'); return el ? { prepend: (c) => el.after(c) } : null; },
            () => document.body,
        ];

        for (const getTarget of targets) {
            const target = getTarget();
            if (target) {
                target.prepend(buttonContainer);
                log('Button container inserted');
                return true;
            }
        }
        return false;
    }

    // ─── Enrollment actions ───────────────────────────────────────────────────

    function enrollAsDesigner(courseId, userId, domain, csrfToken, triggerButton) {
        log(`Enrolling user ${userId} as designer in course ${courseId}`);

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

    function unenrollCompletely(courseId, userId, domain, csrfToken) {
        log(`Unenrolling user ${userId} from course ${courseId}`);

        const url = `https://${domain}/api/v1/courses/${courseId}/enrollments?user_id=${userId}`;
        makeApiCall(url, 'GET', null, csrfToken,
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
                    const deleteUrl = `https://${domain}/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=delete`;
                    const concludeUrl = `https://${domain}/api/v1/courses/${courseId}/enrollments/${enrollment.id}?task=conclude`;

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

    // Sends a form-encoded POST to a Canvas web route (non-API endpoint).
    // Includes authenticity_token in the body (standard Rails CSRF for form submissions).
    function makeFormPost(url, formData, csrfToken, successCallback, errorCallback) {
        const params = new URLSearchParams({ ...formData, authenticity_token: csrfToken }).toString();
        GM_xmlhttpRequest({
            method: 'POST',
            url,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json, text/html',
            },
            data: params,
            onload(response) {
                log(`Form POST response ${response.status} for ${url}`);
                // Web routes typically redirect (→ 200) on success
                if (response.status >= 200 && response.status < 400) {
                    successCallback();
                } else {
                    err(`Form POST failed ${response.status}:`, response.responseText);
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

    function showMessage(message, type) {
        if (!buttonContainer || !document.getElementById('enrollment-manager-container')) {
            err('Cannot show message — button container not in DOM');
            return;
        }
        const div = document.createElement('div');
        div.className = `alert alert-${type}`;
        div.textContent = message;
        div.style.marginBottom = '10px';
        buttonContainer.prepend(div);
        setTimeout(() => {
            div.style.transition = 'opacity 0.5s';
            div.style.opacity = '0';
            setTimeout(() => div.remove(), 500);
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
        return `canvas_em_lv_last_run_${courseId}`;
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

    // ─── Due Date Checker ─────────────────────────────────────────────────────

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
                    return;
                }

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
                        `<a href="https://${domain}/courses/${courseId}/assignments/${a.id}" target="_blank">${a.name}</a>` +
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
