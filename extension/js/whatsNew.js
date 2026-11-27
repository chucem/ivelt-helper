// What's new pop-up
//
// After the extension updates, the next forum page shows a pop-up with what's new since the
// version the user had (js/whatsNew.data.js): a version skipped on the way, like 2.7.0 when
// going from 2.6.0 straight to 2.7.1, gets its own section under this one's. When the update turned off this user's checks for new replies
// and notifications (see moveToNewCheckTiming in background.js), it says so first, with a button
// to the settings. It stays until its close button is pressed; that closes it in the other tabs
// too, and it doesn't come back. "Remind me later" hides it everywhere for a day.
//
// Runs as a content script (isolated world). The settings page loads it too: there the
// "וואס איז ניי?" link by the version shows it again (window.ihShowWhatsNew), with only a close
// button, and nothing is saved.

(function () {
    'use strict';
    const KEYS = ['whatsNewVersion', 'whatsNewFrom', 'whatsNewCheckTiming', 'whatsNewLaterUntil'];
    const LATER_MS = 24 * 60 * 60 * 1000;

    let overlay = null;

    // before anything returns, so overlay is there when the settings page calls it
    const onSettingsPage = location.protocol === 'chrome-extension:';
    if (onSettingsPage) {
        window.ihShowWhatsNew = showFromSettings;
        return;
    }
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    function init() {
        if (window.top !== window || !chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get(KEYS, (items) => {
            const version = items.whatsNewVersion;
            if (!version || Date.now() < (items.whatsNewLaterUntil || 0)) return;

            const releases = releasesSince(items.whatsNewFrom, version);
            if (!releases.length && !items.whatsNewCheckTiming) {
                chrome.storage.local.remove(KEYS);
                return;
            }
            show(version, releases, items.whatsNewCheckTiming);
        });

        // closed, or put off for later, in another tab
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !overlay) return;
            const closed = changes.whatsNewVersion && !changes.whatsNewVersion.newValue;
            const later = changes.whatsNewLaterUntil && changes.whatsNewLaterUntil.newValue > Date.now();
            if (closed || later) hide();
        });
    }

    // The versions after "from" up to this one that have an entry, newest first. Without "from"
    // (an update before it was kept) only this version
    function releasesSince(from, version) {
        return Object.keys(whatsNewReleases)
            .filter((v) => from ? compareVersions(v, from) > 0 && compareVersions(v, version) <= 0 : v === version)
            .sort((a, b) => compareVersions(b, a))
            .map((v) => ({ version: v, ...whatsNewReleases[v] }));
    }

    function compareVersions(a, b) {
        const pa = a.split('.').map(Number);
        const pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pa[i] || 0) - (pb[i] || 0);
            if (diff) return diff;
        }
        return 0;
    }

    // The newest entries up to this version (the last three, a newer one first), from the settings page
    function showFromSettings() {
        if (overlay) return;
        const version = chrome.runtime.getManifest().version;
        const releases = Object.keys(whatsNewReleases)
            .filter((v) => compareVersions(v, version) <= 0)
            .sort((a, b) => compareVersions(b, a))
            .slice(0, 3)
            .map((v) => ({ version: v, ...whatsNewReleases[v] }))
            .filter((r) => (r.features && r.features.length) || (r.fixes && r.fixes.length));
        show(version, releases, false, true);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hide(); // a click outside the box
        });
        document.addEventListener('keydown', function onKey(e) {
            if (e.key !== 'Escape') return;
            document.removeEventListener('keydown', onKey);
            hide();
        });
    }

    function show(version, releases, checkTiming, fromSettings) {
        overlay = element('div', 'ih-whats-new');
        const dialog = element('div', 'ih-whats-new-dialog');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'ih-whats-new-title');
        dialog.dir = 'rtl';

        const title = element('h2', 'ih-whats-new-title', 'וואס איז ניי אינעם אייוועלט עקסטענשען');
        title.id = 'ih-whats-new-title';
        dialog.append(title, element('div', 'ih-whats-new-version', fromSettings
            ? 'דו האסט ווערסיע ' + version
            : 'דער עקסטענשען איז יעצט אפדעיטעד געווארן צו ווערסיע ' + version));

        if (checkTiming) {
            const notice = element('div', 'ih-whats-new-notice');
            notice.append(
                element('strong', null, 'די נאטיפיקאציע אנשטעלונגען האבן זיך געטוישט'),
                element('p', null, 'מיר האבן מסדר געווען די אנשטעלונגען פון טשעקן פאר נייע תגובות אינעם אשכול און פאר נייע נאטיפיקאציעס, יעדער האט יעצט זיין אייגענע קעסטל און ווי אפט. דערפאר האבן מיר ביידע אויסגעלאשן ביי יעדעם, און מען דארף זיי צוריק אנשטעלן. ווילסטו זיי ווייטער? שטעל זיי אן אין די אנשטעלונגען און קלייב אויס ווי אפט.'),
                button('עפן די נאטיפיקאציע אנשטעלונגען', 'ih-btn-outline', () => openSettings('notifications'))
            );
            dialog.appendChild(notice);
        }

        // with more than one version, each one is headed by its number
        releases.forEach((release) => {
            if (releases.length > 1 || release.version !== version) {
                dialog.appendChild(element('h3', 'ih-whats-new-release', 'ווערסיע ' + release.version));
            }
            addList(dialog, 'נייע זאכן', release.features);
            addList(dialog, 'פארבעסערונגען', release.fixes);
        });

        // closing is the main button, the way out of the pop-up
        const buttons = element('div', 'ih-whats-new-buttons');
        if (fromSettings) {
            buttons.append(button('פארמאך', 'ih-btn-main', hide));
        } else {
            buttons.append(
                button('פארשטאנען און פארמאך', 'ih-btn-main', close),
                button('דערמאן מיך שפעטער', 'ih-btn-second', later),
                button('אלע אנשטעלונגען', 'ih-btn-link', () => openSettings(''))
            );
        }
        dialog.appendChild(buttons);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        // without scrolling to the buttons, the top (the notice) is what matters most
        buttons.querySelector('button').focus({ preventScroll: true });
    }

    function addList(dialog, heading, items) {
        if (!items || !items.length) return;
        dialog.appendChild(element('h3', null, heading));
        const list = element('ul', 'ih-whats-new-list');
        // a line is its text, or { text, setting } for one about a setting: then it ends with a
        // link that opens the settings at that setting (settings.html#<its id>), marked there
        items.forEach((item) => {
            const li = element('li', null, typeof item === 'string' ? item : item.text);
            if (item.setting) {
                const link = element('a', 'ih-whats-new-setting', 'צו דער אנשטעלונג ←');
                link.href = '#';
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    openSettings(item.setting);
                });
                li.append(' ', link);
            }
            list.appendChild(li);
        });
        dialog.appendChild(list);
    }

    function hide() {
        if (overlay) overlay.remove();
        overlay = null;
    }

    // Only the close button closes it for good, here and in other tabs;
    // until then it shows on every forum page
    function close() {
        hide();
        try {
            chrome.storage.local.remove(KEYS);
        } catch (e) {}
    }

    // Hidden everywhere for a day, then it shows again
    function later() {
        hide();
        try {
            chrome.storage.local.set({ whatsNewLaterUntil: Date.now() + LATER_MS });
        } catch (e) {}
    }

    function openSettings(hash) {
        // on the settings page itself: go to that setting there
        if (onSettingsPage) {
            hide();
            // the same address doesn't change, so it's told to go there again
            if (location.hash.slice(1) === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
            else location.hash = hash;
            return;
        }
        try {
            chrome.runtime.sendMessage({ type: 'openSettings', hash });
        } catch (e) {}
    }

    function button(text, className, onClick) {
        const node = element('button', 'ih-btn ' + className, text);
        node.type = 'button';
        node.addEventListener('click', onClick);
        return node;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    init();
})();
