// signin.html: asks for access to <id>.chromiumapp.org (see background.webAuth.js),
// then goes on to the sign-in page given after the #
(function () {
    const signInUrl = decodeURIComponent(location.hash.slice(1));
    const permission = { origins: [`https://${chrome.runtime.id}.chromiumapp.org/*`] };
    const allowBtn = document.getElementById('allow');
    const denied = document.getElementById('denied');
    document.getElementById('host').textContent = `${chrome.runtime.id}.chromiumapp.org`;

    // only the two services' sign-in pages, never any other address
    const allowed = /^https:\/\/(accounts\.google\.com|www\.dropbox\.com)\//.test(signInUrl);
    const goOn = () => { if (allowed) location.replace(signInUrl); };

    chrome.permissions.contains(permission, (has) => { if (has) goOn(); });

    allowBtn.addEventListener('click', () => {
        chrome.permissions.request(permission, (granted) => {
            if (chrome.runtime.lastError || !granted) {
                denied.hidden = false;
                return;
            }
            goOn();
        });
    });

    // closing the tab tells the background the sign-in was called off
    document.getElementById('close').addEventListener('click', () => {
        chrome.tabs.getCurrent((tab) => { if (tab) chrome.tabs.remove(tab.id); else window.close(); });
    });
})();
