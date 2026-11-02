let logout_url;

function getUserId(domain, name) {
    chrome.cookies.get({"url": domain, "name": name}, function (cookie) {
        if (cookie !== null) {
            id = cookie.value;
            checkLoginState();
        }
    });
}

function checkLoginState() {
    if (id.length > 1) {

        function getLogOutCookie(domain, name) {
            chrome.cookies.get({'url': domain, 'name': name}, function (cookie) {
                logout_url = cookie.value;
                setLogOutState();
            });
        }

        function setLogOutState() {
        }

        getLogOutCookie('https://www.ivelt.com', 'phpbb3_sw7kk_sid');
        document.getElementById('emergency_sign_out').style.display = 'block';
    } else {
        document.getElementById('quick_sign_in').style.display = 'block';
    }
}

getUserId('https://www.ivelt.com', 'phpbb3_sw7kk_u');

const FORUM_HOSTS = /(^|\.)ivelt\.com$/;

function isForumUrl(url) {
    try {
        return FORUM_HOSTS.test(new URL(url).hostname);
    } catch (e) {
        return false;
    }
}

function openForumLink(url) {
    chrome.storage.local.get(['popupSameTab'], function (items) {
        chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
            const tab = tabs[0];
            if (items.popupSameTab && tab && tab.url && isForumUrl(tab.url))
                chrome.tabs.update(tab.id, {url: url});
            else
                chrome.tabs.create({url: url});
            window.close();
        });
    });
}

function open_home_page() {
    openForumLink('https://www.ivelt.com/forum/');
}

function open_pm_inbox() {
    openForumLink('https://www.ivelt.com/forum/ucp.php?i=pm&folder=inbox');
}

function open_active_topics() {
    openForumLink('https://www.ivelt.com/forum/search.php?search_id=active_topics');
}

function quick_sign_in() {
    chrome.tabs.create({url: 'https://www.ivelt.com/forum/ucp.php?mode=login', active: true});
    chrome.storage.local.set({'logged_in': '0'});
    window.close();
}

function emergency_sign_out() {
    chrome.tabs.create({url: 'https://www.ivelt.com/forum/ucp.php?mode=logout&sid=' + logout_url, active: false});
    chrome.storage.local.set({'logged_in': '0'});
    window.close();
}

function open_settings() {
    chrome.tabs.create({url: chrome.runtime.getURL('settings.html')});
    window.close();
}

function open_colors() {
    chrome.tabs.create({url: chrome.runtime.getURL('settings.html#colors')});
    window.close();
}

// A click switches the theme right away, the forum tab behind the popup repaints live (js/theme.js)
function initThemeSwatches() {
    const container = document.getElementById('themeSwatches');

    chrome.storage.local.get(['themesEnabled', 'theme', 'customTheme'], function (items) {
        // the colors section is only shown when themes are turned on in the settings
        if (!items.themesEnabled)
            return;
        document.getElementById('themesSection').hidden = false;

        const current = items.theme || 'default';
        const custom = sanitizeTheme(items.customTheme);
        const themes = custom ? themePresets.concat({ ...custom, name: custom.name || 'אייגענע' }) : themePresets;

        themes.forEach(function (theme) {
            const swatch = document.createElement('button');
            swatch.className = 'theme-swatch';
            swatch.title = theme.name;
            swatch.innerHTML = '<span class="sw-header"></span><span class="sw-rows"></span><span class="sw-name"></span>';
            swatch.querySelector('.sw-name').textContent = theme.name;
            swatch.classList.toggle('selected', theme.id === current);

            const vars = themeVars(theme);
            Object.keys(vars).forEach(name => swatch.style.setProperty(name, vars[name]));

            swatch.addEventListener('click', function () {
                container.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('selected'));
                swatch.classList.add('selected');
                chrome.storage.local.set({ theme: theme.id });
            });

            container.appendChild(swatch);
        });
    });
}

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('open_home_page').addEventListener('click', open_home_page);
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('open_pm_inbox').addEventListener('click', open_pm_inbox);
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('open_active_topics').addEventListener('click', open_active_topics);
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('quick_sign_in').addEventListener('click', quick_sign_in);
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('emergency_sign_out').addEventListener('click', emergency_sign_out);
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('open_settings').addEventListener('click', open_settings);
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('open_colors').addEventListener('click', open_colors);
});

document.addEventListener('DOMContentLoaded', initThemeSwatches);

document.addEventListener('DOMContentLoaded', function () {
    const manifest = chrome.runtime.getManifest();
    document.getElementById('popup_version').textContent = 'v' + (manifest.version_name || manifest.version);
});
