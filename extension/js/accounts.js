// More than one account (background.accounts.js): tells the background that a forum page is signed
// in, it then looks up the account's name and avatar now and then, for the list of accounts in the
// popup. Which account is known from the forum's cookie; nothing of the saved accounts comes to the page.
(function () {
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    chrome.storage.local.get('multiAccounts', function (items) {
        if (items.multiAccounts && document.getElementById('username_logged_in'))
            chrome.runtime.sendMessage({ type: 'accountSeen' });
    });
})();
