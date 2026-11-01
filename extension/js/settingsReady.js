// Runs in the page, listed first in each of the manifest's MAIN world entries: Chrome doesn't
// promise an order between entries, so each one that needs it brings it along.
// settingsHandler.js adds the #iveltHelperSettings element only once storage answers, which
// can be after these scripts run, so the ones that read it at start-up wait for it here.
// Not every forum page is the forum (e.g. Cloudflare's check page), so those never start.
function whenIveltSettingsReady(callback) {
    if (!document.getElementById('page-body')) return;
    if (document.getElementById('iveltHelperSettings')) callback();
    else document.addEventListener('iveltHelperSettingsReady', callback, { once: true });
}
