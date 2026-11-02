// More than one account (background.accounts.js): tells the background the signed-in account's name
// and avatar from the forum's header, for the list of accounts in the popup. Nothing of the saved
// accounts comes to the page.
(function () {
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    chrome.storage.local.get('multiAccounts', function (items) {
        if (!items.multiAccounts) return;

        const header = document.getElementById('username_logged_in');
        const profile = header && header.querySelector('a[href*="mode=viewprofile"]');
        const userId = profile && /[?&]u=(\d+)/.exec(profile.getAttribute('href'));
        if (!userId) return;

        // "hide my name" (js/settingsHandler.js) keeps the real name in data-name
        const nameElement = header.querySelector('.header-avatar .username, .header-avatar .my_other_name') || header.querySelector('.header-avatar');
        const avatar = header.querySelector('.header-avatar img');
        chrome.runtime.sendMessage({
            type: 'accountSeen',
            userId: userId[1],
            name: (nameElement.dataset.name || nameElement.textContent).trim(),
            avatar: avatar ? avatar.src : ''
        });
    });
})();
