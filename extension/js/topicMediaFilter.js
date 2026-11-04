// Filter only the posts already loaded on this topic page. Keep their DOM,
// players and reply form intact; no other topic pages are fetched.
(function () {
    'use strict';
    const page = document.getElementById('page-body');
    if (!page || location.pathname !== '/forum/viewtopic.php' || document.getElementById('ivh-media-filter')) return;
    const types = globalThis.iveltMediaTypes;
    const ignored = 'blockquote, .signature, .postprofile';
    const results = new Map(), checking = new Set();
    const topicLink = page.querySelector('h2.topic-title a[href]') || document.querySelector('link[rel="canonical"]');
    const topicId = new URL(topicLink?.href || location.href).searchParams.get('t');
    const preferenceKey = /^[1-9]\d*$/.test(topicId || '') ? 'ivhTopicMediaFilter:' + topicId : null;
    let mode = 'all', includeNetFree = false, scheduled = false;
    try {
        const saved = preferenceKey && sessionStorage.getItem(preferenceKey);
        if (['video', 'media'].includes(saved)) mode = saved;
        includeNetFree = !!preferenceKey && sessionStorage.getItem(preferenceKey + ':netfree') === 'true';
    } catch (e) { /* Filtering still works when browser storage is unavailable. */ }
    const toolbar = document.createElement('section');
    toolbar.id = 'ivh-media-filter';
    toolbar.dir = 'rtl';
    toolbar.setAttribute('aria-label', 'פילטער תגובות אויפן בלאט');
    toolbar.innerHTML = `
        <span class="ivh-media-label">אויפן בלאט:</span>
        <div class="ivh-media-options" role="group" aria-label="וועלכע תגובות צו ווייזן">
            <button type="button" data-media="all" aria-pressed="true">אלע תגובות</button>
            <button type="button" data-media="video" aria-pressed="false">נאר ווידיאס</button>
            <button type="button" data-media="media" aria-pressed="false">ווידיאס און בילדער</button>
        </div>
        <label class="ivh-media-netfree" hidden>
            <input type="checkbox"> אויך נעטפרי לינקס <span>(פייל סארט אומבאשטעטיגט)</span>
        </label>
        <span class="ivh-media-status" role="status" aria-live="polite"></span>
        <button type="button" class="ivh-media-retry" hidden>פרוביר נאכאמאל</button>
        <p class="ivh-media-empty" hidden>קיין פאסיגע תגובות אויף דעם בלאט. קלויבט "אלע תגובות" צו ווייזן די שמועסן.</p>`;
    const status = toolbar.querySelector('.ivh-media-status');
    const retry = toolbar.querySelector('.ivh-media-retry');
    const empty = toolbar.querySelector('.ivh-media-empty');
    const netFreeOption = toolbar.querySelector('.ivh-media-netfree');
    const netFreeCheckbox = netFreeOption.querySelector('input');
    netFreeCheckbox.checked = includeNetFree;

    function posts() {
        return [...page.querySelectorAll('.post[id]')].filter(post => /^p\d+$/.test(post.id));
    }
    if (!posts().length) return;
    const topBar = page.querySelector('.action-bar.bar-top');
    if (topBar) topBar.after(toolbar);
    else posts()[0].before(toolbar);

    function text(element, value) {
        if (element.textContent !== value) element.textContent = value;
    }

    function classify(post) {
        const kinds = new Set(), links = new Set();
        let netFree = false;
        for (const root of post.querySelectorAll('.postbody .content, .postbody .attachbox')) {
            for (const element of root.querySelectorAll('video, img, iframe, embed, object, a[href]')) {
                // A discussion quoting somebody else's media is still a discussion.
                if (element.closest(ignored)) continue;
                if (element.tagName === 'VIDEO') { kinds.add('video'); continue; }
                if (element.tagName === 'IMG') {
                    const src = element.getAttribute('src') || element.getAttribute('data-src') || '';
                    if (src && !element.matches('.smilies, .emoji') && !/\/images\/smilies\//i.test(src) &&
                        !element.closest('video, .video-js, .plyr')) kinds.add('image');
                    continue;
                }
                const value = element.getAttribute('href') || element.getAttribute('src') || element.getAttribute('data');
                if (!value) continue;
                let url;
                try { url = new URL(value, location.href); } catch (e) { continue; }
                if (!/^https?:$/.test(url.protocol)) continue;
                if (element.tagName === 'A' && types.isNetFreeLink(url.href)) {
                    netFree = true;
                    continue;
                }
                const mime = types.mimeType(element.getAttribute('type') || '');
                const kind = mime || types.knownType(url.href);
                if (kind) { kinds.add(kind); continue; }
                const preview = types.previewUrl(url.href);
                if (preview) {
                    // A bare Drive ID gives no type information. Resolve the
                    // preview's actual MIME type/filename instead of guessing.
                    links.add(preview);
                    const result = results.get(preview);
                    if (result === 'video' || result === 'image') kinds.add(result);
                } else if (element.tagName === 'A' && url.origin === location.origin && url.pathname === '/forum/download/file.php') {
                    const name = element.getAttribute('download') || element.textContent.trim();
                    const attachmentType = types.filenameType(name);
                    if (attachmentType === 'video' || attachmentType === 'image') kinds.add(attachmentType);
                }
            }
        }
        return { kinds, links, netFree };
    }

    function check(url, refresh = false) {
        if (checking.has(url) || (!refresh && results.has(url))) return;
        checking.add(url);
        chrome.runtime.sendMessage({ type: 'mediaLinkType', url, refresh }).then(response => {
            results.set(url, ['video', 'image', 'other'].includes(response?.kind) ? response.kind : 'unknown');
        }).catch(() => { results.set(url, 'unknown'); }).finally(() => {
            checking.delete(url);
            schedule();
        });
    }

    function update() {
        const list = posts();
        let visible = 0, netFreeShown = 0;
        const unresolved = new Set(), candidates = new Set();
        for (const post of list) {
            const { kinds, links, netFree } = classify(post);
            const matchedMedia = kinds.has('video') || (mode === 'media' && kinds.has('image'));
            const show = mode === 'all' || matchedMedia || (includeNetFree && netFree);
            if (mode !== 'all' && includeNetFree && netFree && !matchedMedia) netFreeShown++;
            if (mode !== 'all') links.forEach(url => {
                candidates.add(url);
                if (!results.has(url)) check(url);
                if (results.get(url) === 'unknown') unresolved.add(url);
            });
            if (show) visible++;
            if (!show && !post.classList.contains('ivh-media-filtered-out'))
                post.querySelectorAll('video, audio').forEach(player => player.pause());
            post.classList.toggle('ivh-media-filtered-out', !show);
        }
        const pending = [...candidates].filter(url => checking.has(url)).length;
        let message = mode === 'all' ? list.length + ' תגובות' : visible + ' פון ' + list.length + ' תגובות';
        if (netFreeShown) message += ' · ' + netFreeShown + ' מיט אומבאשטעטיגטע נעטפרי לינקס';
        if (pending) message += ' · מען קוקט נאך ' + pending + ' פייל לינקס…';
        if (unresolved.size) message += ' · ' + unresolved.size + ' פייל לינקס קען מען נישט באשטעטיגן';
        text(status, message);
        empty.hidden = mode === 'all' || visible > 0 || pending > 0;
        retry.hidden = !unresolved.size;
        retry.disabled = pending > 0;
        netFreeOption.hidden = mode === 'all';
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; update(); });
    }

    function select(value) {
        mode = value;
        try {
            if (preferenceKey) sessionStorage.setItem(preferenceKey, mode);
        } catch (e) { /* Do not interrupt filtering if storage is disabled/full. */ }
        toolbar.querySelectorAll('[data-media]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.media === mode));
        });
        update();
    }

    toolbar.querySelectorAll('[data-media]').forEach(button => {
        button.addEventListener('click', () => select(button.dataset.media));
    });
    netFreeCheckbox.addEventListener('change', () => {
        includeNetFree = netFreeCheckbox.checked;
        try {
            if (preferenceKey) sessionStorage.setItem(preferenceKey + ':netfree', String(includeNetFree));
        } catch (e) { /* Keep the option usable when storage is unavailable. */ }
        update();
    });
    retry.addEventListener('click', () => {
        posts().forEach(post => classify(post).links.forEach(url => {
            if (results.get(url) === 'unknown') { results.delete(url); check(url, true); }
        }));
        update();
    });
    window.addEventListener('hashchange', () => {
        const target = document.getElementById(location.hash.slice(1));
        if (target?.classList.contains('ivh-media-filtered-out')) {
            select('all');
            target.scrollIntoView({ block: 'start' });
        }
    });
    // Players and attachments may be inserted after the content script runs.
    new MutationObserver(mutations => {
        if (mutations.some(mutation => !toolbar.contains(mutation.target))) schedule();
    }).observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src', 'data-src', 'type'] });
    select(mode);
}());
