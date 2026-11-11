(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const SETTING_KEY = 'profileCards';
    const SHOW_DELAY_MS = 800;
    const HIDE_DELAY_MS = 300;
    const PROFILE_LINK = '#page-body a[href*="mode=viewprofile"]';
    const KEEP_TAGS = new Set(['a', 'b', 'br', 'div', 'em', 'i', 'img', 'p', 'span', 'strong', 'u']);
    const DROP_TAGS = new Set(['button', 'embed', 'form', 'iframe', 'input', 'noscript', 'object', 'script', 'select', 'style', 'textarea']);
    const MONTHS = 'יאנואר|פעברואר|מארטש|אפריל|מאי|יוני|יולי|אויגוסט|אוגוסט|סעפטעמבער|אקטאבער|נאוועמבער|דעצעמבער';
    const DATE = new RegExp(`^(?:\\S+ )?(${MONTHS}) (\\d{1,2}), (\\d{4})(?: (\\d{1,2}):(\\d{2}) ?(am|pm))?$`, 'i');
    const TIME = /(\d{1,2}):(\d{2}) ?(am|pm)/gi;

    const profiles = new Map();
    const loaded = new Map();
    let card = null;
    let hoveredLink = null;
    let showTimeout;
    let hideTimeout;
    let scrolledAt = 0;
    // A name that slides under a still mouse while the page scrolls isn't the mouse resting on it
    const SCROLL_QUIET_MS = 400;

    function init() {
        if (!chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get([SETTING_KEY], (items) => {
            if (items[SETTING_KEY] !== false) listen();
        });
    }

    function listen() {
        document.addEventListener('mouseover', (event) => {
            if (card && card.contains(event.target)) {
                clearTimeout(hideTimeout);
                return;
            }
            const link = event.target.closest(PROFILE_LINK);
            if (!link || link.querySelector('img')) return;
            if (Date.now() - scrolledAt < SCROLL_QUIET_MS) return;

            clearTimeout(hideTimeout);
            if (link === hoveredLink) return;
            hoveredLink = link;
            clearTimeout(showTimeout);
            showTimeout = setTimeout(() => showCard(link), SHOW_DELAY_MS);
        });

        document.addEventListener('mouseout', (event) => {
            const link = event.target.closest(PROFILE_LINK);
            const leavingLink = link && link === hoveredLink && !link.contains(event.relatedTarget)
                && !(card && card.contains(event.relatedTarget));
            const leavingCard = card && card.contains(event.target) && !card.contains(event.relatedTarget)
                && !(hoveredLink && hoveredLink.contains(event.relatedTarget));
            if (!leavingLink && !leavingCard) return;

            clearTimeout(showTimeout);
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(hideCard, HIDE_DELAY_MS);
        });

        // The page scrolling (not the signature inside the card, its scroll doesn't reach the
        // window): a card about to open doesn't, and an open one closes. Otherwise a card opened
        // under the mouse as names slid by, and over its signature the page stopped scrolling
        window.addEventListener('scroll', () => {
            scrolledAt = Date.now();
            clearTimeout(showTimeout);
            if (card || hoveredLink) hideCard();
        }, { passive: true });
    }

    function hideCard() {
        hoveredLink = null;
        if (card) card.remove();
    }

    async function showCard(link) {
        const address = link.href;
        const fallbackName = cleanText(link.textContent).replace(/^@/, '');

        if (!loaded.has(address)) {
            placeCard(link, { name: fallbackName, loading: true });
            await getProfile(address);
        }

        const profile = loaded.get(address);
        if (link !== hoveredLink) return;
        if (!profile) {
            hideCard();
            return;
        }
        placeCard(link, { ...profile, name: profile.name || fallbackName });
    }

    function getProfile(address) {
        if (!profiles.has(address)) {
            profiles.set(address, fetch(address, { credentials: 'same-origin' })
                .then((response) => (response.ok ? response.text() : ''))
                .then((html) => readProfile(html, address))
                .catch(() => null)
                .then((profile) => {
                    loaded.set(address, profile);
                    return profile;
                }));
        }
        return profiles.get(address);
    }

    function readProfile(html, address) {
        const page = new DOMParser().parseFromString(html, 'text/html');
        const profile = page.getElementById('viewprofile');
        if (!profile) return null;

        const avatar = profile.querySelector('.profile-avatar img');
        const avatarSrc = avatar && (avatar.getAttribute('data-src') || avatar.getAttribute('src'));
        const username = profile.querySelector('.profile-details dd .username, .profile-details dd .username-coloured');
        const rank = profile.querySelector('dl.left-box:not(.details) dd');
        const signature = profile.querySelector('.signature');
        const signatureHeading = signature && signature.closest('.inner') && signature.closest('.inner').querySelector('h3');

        return {
            address,
            avatar: avatarSrc ? new URL(avatarSrc, address).href : '',
            name: username ? cleanText(username.textContent) : '',
            nameColor: username ? username.style.color : '',
            online: !!profile.querySelector('.panel.online'),
            rank: rank ? cleanText(rank.textContent) : '',
            fields: pairs(profile.querySelector('.profile-details')).slice(1).filter((row) => !row.value.querySelector('select')),
            sections: [...profile.querySelectorAll('.column1, .column2')]
                .map((column) => ({ title: textOf(column.querySelector('h3')), rows: pairs(column.querySelector('dl.details')) }))
                .filter((section) => section.rows.length),
            signature: signature && signature.textContent.trim() ? { title: textOf(signatureHeading), content: signature } : null
        };
    }

    function pairs(list) {
        if (!list) return [];
        return [...list.querySelectorAll('dt')]
            .filter((dt) => dt.nextElementSibling && dt.nextElementSibling.tagName === 'DD')
            .map((dt) => ({ label: textOf(dt).replace(/:$/, ''), value: dt.nextElementSibling }))
            .filter((row) => row.label);
    }

    function textOf(node) {
        return node ? cleanText(node.textContent) : '';
    }

    function cleanText(text) {
        return text.replace(/\s+/g, ' ').trim();
    }

    function readableDate(text) {
        const date = text.match(DATE);
        if (!date) return text.replace(TIME, (all, hour, minute, half) => clock(hour, minute, half));

        const [, month, day, year, hour, minute, half] = date;
        return `${Number(day)} ${month} ${year}` + (hour ? ` אום ${clock(hour, minute, half)}` : '');
    }

    function clock(hour, minute, half) {
        const hours = (Number(hour) % 12) + (half.toLowerCase() === 'pm' ? 12 : 0);
        return `${hours}:${minute}`;
    }

    function safeCopy(source, base) {
        const copy = document.createDocumentFragment();
        source.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
                copy.append(node.textContent);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName.toLowerCase();
            if (DROP_TAGS.has(tag)) return;

            const address = tag === 'a' ? safeAddress(node.getAttribute('href'), base)
                : tag === 'img' ? safeAddress(node.getAttribute('data-src') || node.getAttribute('src'), base) : '';
            if (!KEEP_TAGS.has(tag) || ((tag === 'a' || tag === 'img') && !address)) {
                copy.append(safeCopy(node, base));
                return;
            }

            const element = document.createElement(tag);
            if (tag === 'a') element.href = address;
            if (tag === 'img') {
                element.src = address;
                element.alt = node.getAttribute('alt') || '';
            }
            element.append(safeCopy(node, base));
            copy.append(element);
        });
        return copy;
    }

    function safeAddress(value, base) {
        try {
            const url = new URL(value || '', base);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
        } catch (e) {
            return '';
        }
    }

    function placeCard(link, profile) {
        if (!card) {
            card = document.createElement('div');
            card.className = 'ih-profile-card';
        }
        fillCard(profile);
        if (!card.isConnected) document.body.appendChild(card);

        const signature = card.querySelector('.ih-profile-signature');
        if (signature) markSignature(signature);

        const rect = link.getBoundingClientRect();
        const width = card.offsetWidth;
        const height = card.offsetHeight;
        const middle = rect.left + rect.width / 2;
        const left = clamp(middle - width / 2, 8, window.innerWidth - width - 8);
        const below = rect.bottom + 8 + height <= window.innerHeight || rect.top - 8 - height < 0;

        card.classList.toggle('ih-profile-above', !below);
        card.style.top = `${window.scrollY + (below ? rect.bottom + 8 : rect.top - 8 - height)}px`;
        card.style.left = `${window.scrollX + left}px`;
        card.style.setProperty('--ih-pointer-x', `${clamp(middle - left, 14, width - 14)}px`);
    }

    // fades the bottom of a signature while there's more to scroll to
    function markSignature(signature) {
        signature.classList.toggle('ih-profile-signature-more',
            signature.scrollTop + signature.clientHeight < signature.scrollHeight - 2);
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function fillCard(profile) {
        card.textContent = '';
        card.classList.toggle('ih-profile-loading', !!profile.loading);

        const header = element('div', 'ih-profile-header');
        if (profile.avatar) {
            const avatar = element('img', 'ih-profile-avatar');
            avatar.src = profile.avatar;
            avatar.alt = '';
            header.appendChild(avatar);
        } else if (profile.loading) {
            header.appendChild(element('div', 'ih-profile-skeleton ih-profile-avatar'));
        }

        const title = element('div', 'ih-profile-title');
        const name = element('div', 'ih-profile-name', profile.name);
        if (profile.nameColor) name.style.color = profile.nameColor;
        title.appendChild(name);

        const tags = element('div', 'ih-profile-tags');
        if (profile.online) tags.appendChild(element('span', 'ih-profile-tag ih-profile-online', 'אנליין'));
        if (profile.rank) tags.appendChild(element('span', 'ih-profile-tag', profile.rank));
        if (profile.loading) tags.appendChild(element('span', 'ih-profile-skeleton ih-profile-skeleton-tag'));
        if (tags.childNodes.length) title.appendChild(tags);

        header.appendChild(title);
        card.appendChild(header);

        if (profile.loading) {
            card.append(skeletonSection(false), skeletonSection(true));
            return;
        }

        if (profile.fields.length) card.appendChild(section('', profile.fields, profile.address));
        profile.sections.forEach((part) => card.appendChild(section(part.title, part.rows, profile.address)));

        if (profile.signature) {
            const box = element('div', 'ih-profile-section');
            if (profile.signature.title) box.appendChild(element('div', 'ih-profile-heading', profile.signature.title));
            const signature = element('div', 'ih-profile-signature');
            signature.appendChild(safeCopy(profile.signature.content, profile.address));
            box.appendChild(signature);
            card.appendChild(box);

            const markMore = () => markSignature(signature);
            signature.addEventListener('scroll', markMore);
            signature.querySelectorAll('img').forEach((img) => img.addEventListener('load', markMore));
        }
    }

    function section(title, rows, base) {
        const box = element('div', 'ih-profile-section');
        if (title) box.appendChild(element('div', 'ih-profile-heading', title));

        const list = element('dl', 'ih-profile-rows');
        rows.forEach((row) => {
            const value = element('dd');
            if (row.value.querySelector('a, img')) value.appendChild(safeCopy(row.value, base));
            else value.textContent = readableDate(textOf(row.value));
            list.append(element('dt', '', row.label), value);
        });
        box.appendChild(list);
        return box;
    }

    // the shape of a section while the profile loads, so the card doesn't jump much when it's filled
    function skeletonSection(withHeading) {
        const box = element('div', 'ih-profile-section');
        if (withHeading) box.appendChild(element('div', 'ih-profile-skeleton ih-profile-skeleton-heading'));

        const list = element('dl', 'ih-profile-rows');
        for (let i = 0; i < 3; i++) list.append(element('dt', 'ih-profile-skeleton'), element('dd', 'ih-profile-skeleton'));
        box.appendChild(list);
        return box;
    }

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    init();
})();
