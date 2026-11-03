// More than one account (background.accounts.js): tells the background that a forum page is signed
// in. When the saved account's name and avatar are due to be looked up, the background answers with
// its number, and they're read here: the background can't, Cloudflare answers its requests with its
// check page. First from the header; its name may be hidden (the forum's "hide my name"), then from
// the account's profile page, where js/profileCards.js reads them too. The avatar goes as the
// picture itself, the popup can't load it from the forum.
// Which account is signed in, the background knows from the forum's cookie; nothing of the saved
// accounts comes to the page.
(function () {
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const AVATAR_MAX_BYTES = 200 * 1024;
    const profilePage = /\/memberlist\.php$/.test(location.pathname) && /[?&]mode=viewprofile\b/.test(location.search);
    const profileOf = profilePage ? (/[?&]u=(\d+)/.exec(location.search) || [])[1] : undefined;

    // A switch reloads the forum's tabs, but not one with a post being written (text that isn't
    // what the page came with), it would be lost: the background asks
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.type === 'unsentPost') {
            const unsent = [...document.querySelectorAll('textarea')].some((box) => box.value.trim() && box.value !== box.defaultValue);
            sendResponse({ unsent: unsent });
        }

        // a switch didn't reload this tab (a post being written, or the setting to reload only the
        // tab it's switched in): it still shows the account that was signed in
        if (request.type === 'accountSwitched') showSwitchedBar();
    });

    chrome.storage.local.get('multiAccounts', function (items) {
        if (!items.multiAccounts || !document.getElementById('username_logged_in')) return;

        // the header's name goes along, for an account that gets saved before its lookup
        chrome.runtime.sendMessage({ type: 'accountSeen', profileOf: profileOf, name: fromHeader().name }, function (answer) {
            if (chrome.runtime.lastError || !answer || !answer.lookUp) return;
            lookUp(answer.lookUp).catch(() => {});
        });
    });

    async function lookUp(userId) {
        let found = profileOf === userId ? fromProfile(document, location.href) : fromHeader();
        if (!found.name) {
            const address = location.origin + '/forum/memberlist.php?mode=viewprofile&u=' + encodeURIComponent(userId);
            const response = await fetch(address, { credentials: 'same-origin' });
            if (response.ok)
                found = fromProfile(new DOMParser().parseFromString(await response.text(), 'text/html'), address);
        }
        if (!found.name) return;

        chrome.runtime.sendMessage({
            type: 'accountProfile',
            userId: userId,
            name: found.name,
            avatarUrl: found.avatarUrl,
            avatar: found.avatarUrl ? await pictureData(found.avatarUrl) : ''
        });
    }

    // At the top of the page, with a button that loads it again as the account that's signed in now.
    // Opened again rather than reloaded, a page that came from a form would send it again
    function showSwitchedBar() {
        if (document.getElementById('ih-account-switched')) return;
        const bar = document.createElement('div');
        bar.id = 'ih-account-switched';
        bar.dir = 'rtl';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;display:flex;gap:12px;' +
            'align-items:center;justify-content:center;padding:8px 12px;background:#fff4ce;color:#5c4400;' +
            'border-bottom:1px solid #e6cf7a;font:14px system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.15)';
        const text = document.createElement('span');
        text.textContent = 'מען האט געטוישט דעם אקאונט, דער טאב ווייזט נאך דעם פריערדיגן אקאונט.';
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.textContent = 'רילאויד';
        reload.style.cssText = 'padding:3px 12px;border:1px solid #c9a227;border-radius:4px;background:#fff;color:#5c4400;font:inherit;cursor:pointer';
        reload.addEventListener('click', () => {
            if (location.hash) location.reload();
            else location.replace(location.href);
        });
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.title = 'צומאכן';
        close.style.cssText = 'border:0;background:none;color:inherit;font-size:18px;line-height:1;cursor:pointer';
        close.addEventListener('click', () => bar.remove());
        bar.append(text, reload, close);
        document.body.appendChild(bar);
    }

    // "hide my name" of this extension (js/settingsHandler.js) keeps the real name in data-name; the
    // forum's own leaves no name, and no picture either
    function fromHeader() {
        const header = document.querySelector('#username_logged_in .header-avatar');
        const name = header && header.querySelector('.username, .my_other_name');
        const image = header && header.querySelector('img');
        return {
            name: name ? (name.dataset.name || name.textContent).trim() : '',
            avatarUrl: imageAddress(image, location.href)
        };
    }

    // the first line is the name: in a span of its own on one's own profile
    function fromProfile(page, address) {
        const profile = page.getElementById('viewprofile');
        const name = profile && profile.querySelector('.profile-details dd span');
        return {
            name: name ? name.textContent.trim() : '',
            avatarUrl: imageAddress(profile && profile.querySelector('.profile-avatar img'), address)
        };
    }

    // a picture that loads late has its address in data-src
    function imageAddress(image, base) {
        const src = image && (image.getAttribute('data-src') || image.getAttribute('src'));
        return src ? new URL(src, base).href : '';
    }

    async function pictureData(address) {
        const response = await fetch(address, { credentials: 'same-origin' });
        const blob = response.ok ? await response.blob() : null;
        if (!blob || !/^image\/(png|jpeg|gif|webp)$/.test(blob.type) || blob.size > AVATAR_MAX_BYTES) return '';
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        });
    }
})();
