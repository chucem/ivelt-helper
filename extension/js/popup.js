// Signed in or not, from the forum's user cookie: a guest's is 1, and a browser that never visited
// the forum (or cleared its cookies) has none, which is signed out too
let logoutSid = null; // the session's number, which the forum's sign-out link needs

chrome.cookies.get({ url: 'https://www.ivelt.com', name: 'phpbb3_sw7kk_u' }, function (cookie) {
    const userId = cookie ? cookie.value : '';
    if (userId.length > 1) {
        chrome.cookies.get({ url: 'https://www.ivelt.com', name: 'phpbb3_sw7kk_sid' }, function (sid) {
            logoutSid = sid ? sid.value : null;
        });
        document.getElementById('emergency_sign_out').style.display = 'block';
    } else {
        document.getElementById('quick_sign_in').style.display = 'block';
    }
});

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
    window.close();
}

function emergency_sign_out() {
    // without the session's number the forum would only ask to confirm, so then open its sign-out page
    const url = logoutSid
        ? 'https://www.ivelt.com/forum/ucp.php?mode=logout&sid=' + encodeURIComponent(logoutSid)
        : 'https://www.ivelt.com/forum/ucp.php?mode=logout';
    chrome.tabs.create({url: url, active: !logoutSid});
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
        makeRoomForScrollbar();
    });
}

// The browser sizes the popup to its content, and only then a scrollbar comes (a tall popup, with
// the accounts and the colors), which takes its width from the content: the colors stuck out of
// their card. So then the popup asks for the scrollbar's width more
function makeRoomForScrollbar() {
    requestAnimationFrame(function () {
        const body = document.body;
        const scrollbar = window.innerWidth - document.documentElement.clientWidth;
        body.style.minWidth = '';
        body.style.width = 'max-content';
        const content = body.getBoundingClientRect().width;
        body.style.width = '';
        body.style.minWidth = scrollbar > 0 ? Math.ceil(content + scrollbar) + 'px' : '';
    });
}

// The saved accounts (background.accounts.js): a click switches to one, the background does the
// switching and reloads the forum's tabs. Shown when turned on in the settings
function initAccounts() {
    chrome.storage.local.get(['multiAccounts', 'savedAccounts'], function (items) {
        if (!items.multiAccounts)
            return;
        document.getElementById('accountsSection').hidden = false;

        chrome.cookies.get({ url: 'https://www.ivelt.com', name: 'phpbb3_sw7kk_u' }, function (cookie) {
            const currentId = cookie && cookie.value !== '1' ? cookie.value : '';
            const accounts = items.savedAccounts || [];
            showAccounts(accounts, currentId);
            // signed in with an account that isn't saved yet
            document.getElementById('save_account').hidden = !currentId || accounts.some(a => a.userId === currentId);

            // no name yet for the signed-in account: the forum's pages find it (js/accounts.js), its
            // own profile page always has it
            const current = accounts.find(a => a.userId === currentId);
            document.getElementById('open_own_profile').hidden = !current || !!current.name;
        });
    });
}

function open_own_profile() {
    chrome.cookies.get({ url: 'https://www.ivelt.com', name: 'phpbb3_sw7kk_u' }, function (cookie) {
        if (cookie)
            openForumLink('https://www.ivelt.com/forum/memberlist.php?mode=viewprofile&u=' + encodeURIComponent(cookie.value));
    });
}

function showAccounts(accounts, currentId) {
    const list = document.getElementById('accountsList');
    list.replaceChildren();

    accounts.forEach(function (account) {
        const name = account.name || 'באנוצער ' + account.userId;
        const row = document.createElement('div');
        row.className = 'account_row';
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.classList.toggle('current', account.userId === currentId);
        row.classList.toggle('expired', !!account.expired && account.userId !== currentId);

        let avatar;
        // the picture itself is kept with the account, the forum doesn't let the popup load its address
        if (/^data:image\//.test(account.avatar || '')) {
            avatar = document.createElement('img');
            avatar.src = account.avatar;
            avatar.alt = '';
        } else {
            avatar = document.createElement('span');
            avatar.textContent = name.charAt(0);
        }
        avatar.className = 'account_avatar';

        const nameElement = document.createElement('span');
        nameElement.className = 'account_name';
        nameElement.textContent = name;

        const status = document.createElement('span');
        status.className = 'account_status';
        if (account.userId === currentId)
            status.textContent = 'אריינגעלאגט';
        else if (account.expired)
            status.textContent = 'לאג אריין נאכאמאל';

        const forget = document.createElement('button');
        forget.className = 'account_forget';
        forget.textContent = '×';
        forget.title = 'מעק אויס דעם אקאונט פון דער ליסטע';
        forget.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!confirm('אויסמעקן ' + name + ' פון דער ליסטע? (מען בלייבט נישט ארויסגעלאגט פונעם פארום, נאר דאס עקסטענשען געדענקט עס מער נישט)'))
                return;
            chrome.runtime.sendMessage({ type: 'forgetAccount', userId: account.userId }, initAccounts);
        });

        row.append(avatar, nameElement, status, forget);
        row.addEventListener('click', () => accountClicked(account, currentId));
        row.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                accountClicked(account, currentId);
            }
        });
        list.appendChild(row);
    });

    // with many accounts the list scrolls, the signed-in one is shown
    const current = list.querySelector('.account_row.current');
    if (current)
        current.scrollIntoView({ block: 'nearest' });
    makeRoomForScrollbar();
}

function showAccountsMessage(text) {
    const message = document.getElementById('accountsMessage');
    message.textContent = text;
    message.hidden = !text;
}

function accountClicked(account, currentId) {
    if (account.userId === currentId)
        return;

    // the forum doesn't take its cookies any more, so it signs in from the start
    if (account.expired) {
        add_account();
        return;
    }

    showAccountsMessage('מען טוישט דעם אקאונט…');
    chrome.runtime.sendMessage({ type: 'switchAccount', userId: account.userId }, function (response) {
        if (chrome.runtime.lastError || !response || response.error) {
            showAccountsMessage('עס האט נישט געקלאפט, פרובירט נאכאמאל');
            return;
        }
        if (response.expired) {
            showAccountsMessage((account.name || 'דער אקאונט') + ' איז מער נישט אריינגעלאגט. קליקט אויף אים זיך אריינצולאגן נאכאמאל');
            initAccounts();
            return;
        }
        window.close();
    });
}

function add_account() {
    chrome.runtime.sendMessage({ type: 'addAccount' }, () => window.close());
}

function save_account() {
    chrome.runtime.sendMessage({ type: 'saveAccount' }, initAccounts);
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
    document.getElementById('add_account').addEventListener('click', add_account);
    document.getElementById('save_account').addEventListener('click', save_account);
    document.getElementById('open_own_profile').addEventListener('click', open_own_profile);
    initAccounts();
});

document.addEventListener('DOMContentLoaded', function () {
    const manifest = chrome.runtime.getManifest();
    document.getElementById('popup_version').textContent = 'v' + (manifest.version_name || manifest.version);
});
