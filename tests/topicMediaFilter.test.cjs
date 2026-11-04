// node --test tests/topicMediaFilter.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'extension', name), 'utf8');
const typesContext = vm.createContext({ URL });
vm.runInContext(source('js/mediaTypes.js'), typesContext);
const types = typesContext.iveltMediaTypes;
const drive = id => 'https://drive.google.com/file/d/' + id.padEnd(20, '0') + '/view';

test('media URLs recognize files and actual video pages, not arbitrary sites or channels', () => {
    assert.equal(types.knownType('https://files.example/clip.MP4?download=1'), 'video');
    assert.equal(types.knownType('https://files.example/photo%20one.webp'), 'image');
    assert.equal(types.knownType('https://www.youtube.com/watch?v=123'), 'video');
    assert.equal(types.knownType('https://youtu.be/123'), 'video');
    assert.equal(types.knownType('https://player.vimeo.com/video/123'), 'video');
    for (const url of ['javascript:video.mp4', 'https://youtube.com.evil.example/watch?v=1',
        'https://www.youtube.com/@channel', 'https://files.example/file.pdf', drive('video')])
        assert.equal(types.knownType(url), null, url);
    assert.equal(types.previewUrl(drive('video') + '?usp=sharing'), drive('video'));
    assert.equal(types.previewUrl(drive('video') + '?resourcekey=secret-key&usp=sharing'), drive('video') + '?resourcekey=secret-key');
    assert.equal(types.previewUrl('https://drive.google.com/open?id=abcdefghijklmno'), 'https://drive.google.com/file/d/abcdefghijklmno/view');
    assert.equal(types.previewUrl('https://www.dropbox.com/scl/fi/abc/movie.mp4?rlkey=key&dl=1'), 'https://www.dropbox.com/scl/fi/abc/movie.mp4?rlkey=key&dl=0');
    for (const url of ['https://evil.example/file.mp4', 'http://drive.google.com/file/d/abcdefghijk/view',
        'https://drive.google.com/drive/folders/abcdefghijk', 'https://drive.google.com.evil.example/file/d/abcdefghijk/view',
        'https://user:password@drive.google.com/file/d/abcdefghijk/view', 'https://www.dropbox.com/home'])
        assert.equal(types.previewUrl(url), null, url);
});

test('preview metadata distinguishes video, image and documents without treating thumbnails as images', () => {
    assert.equal(types.metadataType('<title>A file without a suffix - Google Drive</title><script>var config={"docs-dm":"video/mp4"}</script>', drive('v')), 'video');
    assert.equal(types.metadataType('<script>var config={"docs-dm":"image/png"}</script>', drive('image')), 'image');
    assert.equal(types.metadataType('<script>var config={"docs-dm":"application/pdf"}</script>', drive('pdf')), 'other');
    assert.equal(types.metadataType('<title>Holiday.mp4 - Google Drive</title><meta property="og:image" content="thumb.jpg">', drive('v')), 'video');
    assert.equal(types.metadataType('<meta content="video/mp4" itemprop="encodingFormat">', drive('v')), 'video');
    assert.equal(types.metadataType('<META PROPERTY="og:video:type" CONTENT="video/webm">', drive('v')), 'video');
    assert.equal(types.metadataType('<title>Document.pdf - Google Drive</title><meta property="og:image" content="thumb.jpg">', drive('pdf')), 'other');
    assert.equal(types.metadataType('<title>Photo.jpg - Google Drive</title>', drive('image')), 'image');
    assert.equal(types.metadataType('<meta property="og:title" content="A &quot;great&quot; film.mov">', drive('v')), 'video');
    assert.equal(types.metadataType('<meta property="og:video" content="https://example/stream">', 'https://www.dropbox.com/s/a/file'), 'video');
    assert.equal(types.metadataType('<title>Page not found</title><script>const supported="video/mp4"</script><meta property="og:image" content="logo.png">', drive('gone')), 'unknown');
});

test('NetFree links recognize modified Drive hosts without allowing preview requests', () => {
    const example = 'https://dri123ve.google.com/file/d/1YMlBfBTXL9K3knxOotDT0sflQP54QNGy/view?usp=sharing';
    assert.equal(types.isNetFreeLink(example), true);
    assert.equal(types.previewUrl(example), null, 'Modified links must not be repaired or fetched');
    for (const host of ['dr123ive', 'dri123ve', 'd123rive', 'driv123e']) {
        const url = `https://${host}.google.com/file/d/abcdefghijklmno/view`;
        assert.equal(types.isNetFreeLink(url), true, host);
        assert.equal(types.previewUrl(url), null, host);
    }
    for (const url of [drive('normal'), 'https://dri123ve.google.com.evil.example/file/d/abcdefghijklmno/view',
        'https://evil.example/dri123ve.google.com/file/d/abcdefghijklmno/view',
        'https://user:password@dri123ve.google.com/file/d/abcdefghijklmno/view',
        'https://dri123ve.google.com:444/file/d/abcdefghijklmno/view',
        'https://dri123ve.google.com/drive/folders/abcdefghijklmno',
        'https://dri123ve.google.com/file/d/short/view'])
        assert.equal(types.isNetFreeLink(url), false, url);
});

function background(fetch) {
    let listener;
    const context = vm.createContext({ URL, TextDecoder, AbortController, setTimeout, clearTimeout, fetch,
        chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } } });
    vm.runInContext(source('js/mediaTypes.js') + '\n' + source('background.media.js'), context);
    return (url, refresh = false) => new Promise(resolve => listener({ type: 'mediaLinkType', url, refresh }, {}, resolve));
}

test('background checks only allowed public previews, deduplicates and retries unknown files', async () => {
    const calls = [];
    let available = false;
    const check = background(async (url, options) => {
        calls.push(url);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.referrerPolicy, 'no-referrer');
        assert.equal(options.redirect, 'error');
        return new Response('<title>Video.mp4 - Google Drive</title>', {
            status: available ? 200 : 404, headers: { 'Content-Type': 'text/html' }
        });
    });
    assert.equal((await check('https://evil.example/')).kind, 'unknown');
    assert.equal(calls.length, 0);
    assert.deepEqual((await Promise.all([check(drive('v')), check(drive('v'))])).map(r => r.kind), ['unknown', 'unknown']);
    assert.equal(calls.length, 1);
    available = true;
    assert.equal((await check(drive('v'))).kind, 'unknown', 'Short negative cache avoids repeat requests');
    assert.equal((await check(drive('v'), true)).kind, 'video');
    assert.equal((await check(drive('v'))).kind, 'video');
    assert.equal(calls.length, 2);
});

test('background bounds concurrency and stops reading media/oversized previews', async () => {
    let active = 0, maximum = 0, cancelled = 0;
    const check = background(async url => {
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode(url.includes('large') ? 'x'.repeat(1024 * 1024 + 1) : 'unused media')); },
            cancel() { cancelled++; }
        }), { headers: { 'Content-Type': url.includes('large') ? 'text/html' : 'video/mp4' } });
    });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => check(drive('video' + i))));
    assert.ok(results.every(r => r.kind === 'video'));
    assert.equal(maximum, 3);
    assert.equal((await check(drive('large'))).kind, 'unknown');
    assert.equal(cancelled, 9, 'Cancel response bodies instead of downloading whole files');
});

test('manifest packages the filter and its background dependency', () => {
    const manifest = JSON.parse(source('manifest.json'));
    const entry = manifest.content_scripts.find(script => script.js?.includes('js/topicMediaFilter.js'));
    assert.ok(entry);
    assert.ok(entry.matches.every(match => match.includes('/forum/viewtopic.php')));
    assert.deepEqual(entry.js, ['js/mediaTypes.js', 'js/topicMediaFilter.js']);
    for (const file of [...entry.js, ...entry.css]) assert.ok(fs.existsSync(path.join(root, 'extension', file)));
    assert.match(source('background.js'), /importScripts\('\.\/js\/mediaTypes.js', '\.\/background.media.js'/);
});

const chromePath = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(file => file && fs.existsSync(file));

async function browser(t) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ivelt-media-test-'));
    const child = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync',
        '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true });
    let socket, nextId = 0;
    t.after(async () => {
        if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close' }));
            if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
        }
        socket?.close();
        if (child.exitCode === null) child.kill();
        if (child.exitCode === null) await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
        if (path.dirname(profile) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('ivelt-media-test-'))
            await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const endpoint = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
        let output = '';
        child.stderr.on('data', data => {
            output += data;
            const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
        });
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', code => { clearTimeout(timeout); reject(new Error('Chrome exited: ' + code + '\n' + output)); });
    });
    socket = new WebSocket(endpoint);
    await once(socket, 'open');
    const pending = new Map(), events = new Map(), exceptions = [];
    socket.addEventListener('message', event => {
        const result = JSON.parse(event.data);
        if (!result.id) {
            if (result.method === 'Runtime.exceptionThrown') exceptions.push(result.params.exceptionDetails.text);
            events.get(result.method)?.(result);
            return;
        }
        const callback = pending.get(result.id);
        pending.delete(result.id);
        if (!callback) return;
        if (result.error) callback.reject(new Error(result.error.message));
        else callback.resolve(result.result);
    });
    function send(method, params = {}, sessionId) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params, sessionId }));
        });
    }
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    }
    return {
        evaluate, exceptions,
        async load(html, setup = '', pathname = '/forum/viewtopic.php?t=48') {
            // Fulfil every request locally, including images/iframes. Browser
            // tests must never visit real topics or load third-party media.
            events.set('Fetch.requestPaused', event => {
                const documentRequest = event.params.request.url === 'https://www.ivelt.com' + pathname;
                send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200,
                    responseHeaders: [{ name: 'Content-Type', value: documentRequest ? 'text/html; charset=utf-8' : 'text/plain' }],
                    body: Buffer.from(documentRequest ? html : '').toString('base64') }, event.sessionId).catch(() => {});
            });
            await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
            const loaded = new Promise(resolve => events.set('Page.loadEventFired', resolve));
            await send('Page.navigate', { url: 'https://www.ivelt.com' + pathname }, sessionId);
            await loaded;
            await evaluate(`const style = document.createElement('style'); style.textContent = ${JSON.stringify(source('css/topicMediaFilter.css'))}; document.head.appendChild(style);`);
            await evaluate(setup || 'void 0');
            await evaluate(source('js/mediaTypes.js'));
            await evaluate(source('js/topicMediaFilter.js'));
        },
        async settle() { await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'); },
        async viewport(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId); },
        async print() { await send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId); },
        async screenshot(file) {
            const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
        }
    };
}

const post = (id, content, extra = '') => `<div class="post bg1" id="p${id}"><dl class="postprofile"><img src="/avatar.png"></dl><div class="postbody"><div id="post_content${id}"><h3>תגובה ${id}</h3><div class="content">${content}</div>${extra}<div class="signature"><img src="/signature.jpg"><a href="https://files.example/signature.mp4">Signature</a></div></div></div></div>`;
const topic = posts => `<!doctype html><html lang="yi" dir="rtl"><head><meta charset="utf-8"><title>Media filter test</title></head><body><main id="page-body"><h2 class="topic-title">ווידיא אשכול</h2><div class="action-bar bar-top"><a href="#next">קומענדיגע בלאט</a></div>${posts}<form id="qr_postform"><textarea>Unsent reply</textarea><button type="button">Reply</button></form><div class="action-bar bar-bottom"><a href="#next">Next page</a></div></main></body></html>`;
const visibleIds = '[...document.querySelectorAll(".post[id]")].filter(p => getComputedStyle(p).display !== "none").map(p => p.id)';

test('browser: filter genuine media, exclude quoted media, preserve replies and handle dynamic players', { skip: !chromePath, timeout: 30000 }, async t => {
    const page = await browser(t), evaluate = page.evaluate;
    await page.load(topic(
        post(1, 'A discussion') +
        post(2, '<a href="https://files.example/clip.mp4?download=1">Video</a>') +
        post(3, '<blockquote><a href="https://files.example/clip.mp4">Quoted video</a><img src="/quoted.jpg"></blockquote>A reply') +
        post(4, '<img class="postimage" src="/photo.jpg">') +
        post(5, '<img class="smilies" src="/forum/images/smilies/smile.gif">') +
        post(6, '', '<dl class="attachbox"><a href="./download/file.php?id=123">clip.webm</a></dl>') +
        post(7, '<iframe src="https://www.youtube.com/embed/abc"></iframe>') +
        '<div class="post" id="post_advs"><img src="/advert.jpg"></div>'
    ), 'window.__messages = []; window.chrome = { runtime: { async sendMessage(m) { __messages.push(m); return { kind: "unknown" }; } } }; document.querySelector("#qr_postform button").addEventListener("click", () => { window.replyClicked = true; });');
    assert.equal(await evaluate('document.querySelectorAll("#ivh-media-filter").length'), 1);
    await evaluate('document.querySelector("[data-media=video]").click()');
    assert.deepEqual(await evaluate(visibleIds), ['p2', 'p6', 'p7', 'post_advs']);
    assert.equal(await evaluate('document.querySelector("[data-media=video]").getAttribute("aria-pressed")'), 'true');
    assert.equal(await evaluate('document.querySelector("#qr_postform textarea").value'), 'Unsent reply');
    await evaluate('document.querySelector("[data-media=media]").click()');
    assert.deepEqual(await evaluate(visibleIds), ['p2', 'p4', 'p6', 'p7', 'post_advs']);
    await evaluate('document.querySelector("#p1 .content").innerHTML = "<video controls></video>"; document.querySelector("[data-media=video]").click()');
    await page.settle();
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2', 'p6', 'p7', 'post_advs']);
    await evaluate('document.querySelector("#p1 video").remove()');
    await page.settle();
    assert.equal(await evaluate('getComputedStyle(document.getElementById("p1")).display'), 'none');
    await evaluate('location.hash = "#p3"');
    await page.settle();
    assert.equal(await evaluate('document.querySelector("[data-media=all]").getAttribute("aria-pressed")'), 'true');
    assert.equal(await evaluate('document.querySelectorAll(".ivh-media-filtered-out").length'), 0);
    await evaluate('document.querySelector("#qr_postform button").click()');
    assert.equal(await evaluate('window.replyClicked'), true);
    assert.equal(await evaluate('__messages.length'), 0);
    assert.deepEqual(page.exceptions, []);
});

test('browser: verify opaque uploaded links, exclude documents, report unknowns and retry', { skip: !chromePath, timeout: 30000 }, async t => {
    const page = await browser(t), evaluate = page.evaluate;
    await page.load(topic(
        post(1, `<a href="${drive('video')}">Upload</a>`) +
        post(2, `<a href="${drive('image')}">Upload</a>`) +
        post(3, `<a href="${drive('pdf')}">Upload</a>`) +
        post(4, `<a href="${drive('gone')}">Upload</a>`) +
        post(5, `<blockquote><a href="${drive('quoted')}">Quoted upload</a></blockquote>Discussion`) +
        post(6, `<a href="${drive('video')}?usp=sharing">Same upload</a>`)
    ), `window.__messages = []; window.__retryWorks = false; window.chrome = { runtime: { async sendMessage(m) {
        __messages.push(m); await new Promise(resolve => setTimeout(resolve, 20));
        return { kind: m.url.includes('/video') || (__retryWorks && m.url.includes('/gone')) ? 'video' : m.url.includes('/image') ? 'image' : m.url.includes('/pdf') ? 'other' : 'unknown' };
    } } };`);
    assert.equal(await evaluate('__messages.length'), 0, 'All replies makes no metadata requests');
    await evaluate('document.querySelector("[data-media=video]").click()');
    assert.ok(await evaluate('document.querySelector(".ivh-media-status").textContent.includes("מען קוקט נאך")'));
    await evaluate('new Promise(resolve => setTimeout(resolve, 60))');
    await page.settle();
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p6']);
    assert.equal(await evaluate('__messages.length'), 4, 'Deduplicate uploads and ignore quoted links');
    assert.equal(await evaluate('document.querySelector(".ivh-media-retry").hidden'), false);
    await evaluate('document.querySelector("[data-media=media]").click()');
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2', 'p6']);
    assert.equal(await evaluate('__messages.length'), 4, 'Reuse verified types across filters');
    await evaluate('__retryWorks = true; document.querySelector("[data-media=video]").click(); document.querySelector(".ivh-media-retry").click()');
    await evaluate('new Promise(resolve => setTimeout(resolve, 60))');
    await page.settle();
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p4', 'p6']);
    assert.equal(await evaluate('__messages.length'), 5);
    assert.equal(await evaluate('__messages.at(-1).refresh'), true);
    assert.equal(await evaluate('document.querySelector(".ivh-media-retry").hidden'), true);
    await evaluate('document.querySelector("[data-media=media]").click()');
    await page.print();
    assert.equal(await evaluate('getComputedStyle(document.getElementById("ivh-media-filter")).display'), 'none');
    assert.equal((await evaluate(visibleIds)).length, 6, 'Normal print keeps all replies');
    assert.deepEqual(page.exceptions, []);
});

test('browser: keep each topic choice across pages and reloads, and restore All when selected', { skip: !chromePath, timeout: 30000 }, async t => {
    const page = await browser(t), evaluate = page.evaluate;
    const html = topic(post(1, '<video controls></video>') + post(2, '<img src="/photo.jpg">') + post(3, 'Discussion'));
    await page.load(html);
    await evaluate('document.querySelector("[data-media=video]").click()');
    await page.load(html, '', '/forum/viewtopic.php?t=48&start=25');
    assert.equal(await evaluate('document.querySelector("[data-media=video]").getAttribute("aria-pressed")'), 'true');
    assert.deepEqual(await evaluate(visibleIds), ['p1']);
    await evaluate('document.querySelector("[data-media=media]").click()');
    await page.load(html, '', '/forum/viewtopic.php?t=48&start=50');
    assert.equal(await evaluate('document.querySelector("[data-media=media]").getAttribute("aria-pressed")'), 'true');
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2']);
    await page.load(html, '', '/forum/viewtopic.php?t=49');
    assert.equal(await evaluate('document.querySelector("[data-media=all]").getAttribute("aria-pressed")'), 'true', 'Other topics start with All');
    await page.load(html, '', '/forum/viewtopic.php?t=48&start=50');
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2']);
    await evaluate('document.querySelector("[data-media=all]").click()');
    await page.load(html, '', '/forum/viewtopic.php?t=48&start=50');
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2', 'p3']);
    assert.deepEqual(await evaluate('[...document.querySelectorAll("[data-media]")].map(b => b.dataset.media)'), ['all', 'video', 'media']);
    assert.deepEqual(page.exceptions, []);
});

test('browser: optional NetFree posts remain unchanged and unrequested; choice persists across pages', { skip: !chromePath, timeout: 30000 }, async t => {
    const page = await browser(t), evaluate = page.evaluate;
    const modified = drive('netfree').replace('drive.google.com', 'dri123ve.google.com') + '?usp=sharing';
    const alternate = drive('alternate').replace('drive.google.com', 'dr123ive.google.com');
    const html = topic(
        post(1, '<video controls></video>') +
        post(2, `<a href="${modified}">נעטפרי לינק</a>`) +
        post(3, `<blockquote><a href="${modified}">Quoted link</a></blockquote>Discussion`) +
        post(4, 'Discussion', `<div class="signature"><a href="${modified}">Signature link</a></div>`) +
        post(5, `<a href="${alternate}">Another NetFree link</a>`) +
        post(6, '<img src="/photo.jpg">') +
        post(7, '<a href="https://dri123ve.google.com.evil.example/file/d/abcdefghijklmno/view">Unrelated site</a>')
    );
    const setup = 'window.__messages = []; window.chrome = { runtime: { async sendMessage(m) { __messages.push(m); return { kind: "unknown" }; } } };';
    await page.load(html, setup);
    assert.equal(await evaluate('document.querySelector(".ivh-media-netfree").hidden'), true);
    await evaluate('document.querySelector("[data-media=video]").click()');
    assert.equal(await evaluate('document.querySelector(".ivh-media-netfree").hidden'), false);
    assert.equal(await evaluate('document.querySelector(".ivh-media-netfree input").checked'), false);
    assert.deepEqual(await evaluate(visibleIds), ['p1']);
    await evaluate('document.querySelector(".ivh-media-netfree input").click()');
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2', 'p5']);
    assert.ok(await evaluate('document.querySelector(".ivh-media-status").textContent.includes("2 מיט אומבאשטעטיגטע נעטפרי לינקס")'));
    await evaluate('document.querySelector("[data-media=media]").click()');
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2', 'p5', 'p6']);
    assert.equal(await evaluate('document.querySelector("#p2 .content a").getAttribute("href")'), modified);
    assert.equal(await evaluate('__messages.length'), 0, 'NetFree links must not trigger metadata requests');
    await page.load(html, setup, '/forum/viewtopic.php?t=48&start=25');
    assert.equal(await evaluate('document.querySelector(".ivh-media-netfree input").checked'), true);
    assert.deepEqual(await evaluate(visibleIds), ['p1', 'p2', 'p5', 'p6']);
    await evaluate('document.querySelector("[data-media=all]").click()');
    assert.equal(await evaluate('document.querySelector(".ivh-media-netfree").hidden'), true);
    await evaluate('document.querySelector("[data-media=video]").click(); document.querySelector(".ivh-media-netfree input").click()');
    assert.deepEqual(await evaluate(visibleIds), ['p1']);
    await page.load(html, setup, '/forum/viewtopic.php?t=48&start=50');
    assert.equal(await evaluate('document.querySelector(".ivh-media-netfree input").checked'), false);
    assert.deepEqual(await evaluate(visibleIds), ['p1']);
    assert.equal(await evaluate('__messages.length'), 0);
    assert.deepEqual(page.exceptions, []);
});

test('browser: empty state and mobile/theme layout; skip other forum pages', { skip: !chromePath, timeout: 30000 }, async t => {
    const page = await browser(t), evaluate = page.evaluate;
    await page.viewport(390, 844);
    await page.load(topic(post(1, 'A discussion')), 'document.documentElement.style.cssText = "--t-row2:#222;--t-text:#eee;--t-border:#555;--t-surface:#333;--t-link:#8bf;--t-accent:#246;--t-on-accent:#fff"; document.body.style.cssText = "background:#111;color:#eee;margin:8px;font-family:Arial";');
    await evaluate('document.querySelector("[data-media=video]").click()');
    assert.equal(await evaluate('document.querySelector(".ivh-media-empty").hidden'), false);
    assert.equal(await evaluate('getComputedStyle(document.getElementById("ivh-media-filter")).backgroundColor'), 'rgb(34, 34, 34)');
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Toolbar fits a narrow screen');
    if (process.env.MEDIA_FILTER_SCREENSHOT) await page.screenshot(process.env.MEDIA_FILTER_SCREENSHOT);
    await evaluate(source('js/topicMediaFilter.js'));
    assert.equal(await evaluate('document.querySelectorAll("#ivh-media-filter").length'), 1, 'Initialization is idempotent');
    await page.load(topic(post(1, 'Not a topic')), '', '/forum/search.php?search_id=active_topics');
    assert.equal(await evaluate('document.querySelector("#ivh-media-filter")'), null);
    assert.deepEqual(page.exceptions, []);
});
