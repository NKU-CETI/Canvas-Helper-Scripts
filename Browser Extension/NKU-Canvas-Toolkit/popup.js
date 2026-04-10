// NKU Canvas Toolkit — popup script
// Reads and writes per-section visibility preferences using chrome.storage.sync.
// Settings are consumed by content.js on the next page load.

'use strict';

const DEFAULTS = {
    adminSectionEnabled: true,
    helpdeskSectionEnabled: true,
};

document.addEventListener('DOMContentLoaded', () => {
    const adminToggle = document.getElementById('admin-toggle');
    const helpdeskToggle = document.getElementById('helpdesk-toggle');
    const versionLabel = document.getElementById('version-label');

    // Set version label from manifest to keep it in sync automatically.
    versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

    // Populate toggles from stored preferences (fall back to defaults).
    chrome.storage.sync.get(DEFAULTS, (prefs) => {
        adminToggle.checked = prefs.adminSectionEnabled;
        helpdeskToggle.checked = prefs.helpdeskSectionEnabled;
    });

    // Persist changes immediately when the user flips a toggle.
    adminToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ adminSectionEnabled: adminToggle.checked });
    });

    helpdeskToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ helpdeskSectionEnabled: helpdeskToggle.checked });
    });
});
