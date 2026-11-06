// Runs in the page, listed first in each of the manifest's MAIN world entries: Chrome doesn't
// promise an order between entries, so each one that needs it brings it along.
// The page's scripts can't reach chrome.storage, so settingsHandler.js puts the settings they use
// on the page, in the #iveltHelperSettings element.

// One of those settings, with its real value (true, 3600, 'names'): undefined for one that was never
// set, or before the settings are on the page
function iveltSetting(name) {
    const settings = document.getElementById('iveltHelperSettings');
    try {
        return settings ? JSON.parse(settings.dataset.settings)[name] : undefined;
    } catch (e) {
        return undefined;
    }
}

// settingsHandler.js adds the element only once storage answers, which can be after these scripts
// run, so the ones that read it at start-up wait for it here.
// Not every forum page is the forum (e.g. Cloudflare's check page), so those never start.
function whenIveltSettingsReady(callback) {
    if (!document.getElementById('page-body')) return;
    if (document.getElementById('iveltHelperSettings')) callback();
    else document.addEventListener('iveltHelperSettingsReady', callback, { once: true });
}
