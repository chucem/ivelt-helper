# Tests switching between accounts (extension/background.accounts.js) in a browser with the real
# extension, against the demo forum pages of store-assets/source/render.py. Nothing reaches the real
# site: a made-up forum here keeps sessions and "remember me" keys the way phpBB does
# (phpbb/session.php), with made-up cookies:
# - a session (sid) is good until it's ended here, with the user's number (u) it belongs to
# - a key (k) signs in again when the session is gone, and is replaced by a new one right away
# - anything else is a guest: u=1, a new session, no key
#
# Usage: python tests/accounts.py   (RENDER_CHANNEL=msedge for Edge, as for render.py; needs openssl)
import http.server, os, re, secrets, shutil, ssl, subprocess, sys, tempfile, threading, time, urllib.parse
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'store-assets', 'source'))
import render  # noqa: E402

PREFIX = 'phpbb3_sw7kk_'
USERS = {'2': 'ראובן', '3': 'שמעון', '4': 'לוי'}
sessions = {}  # sid -> user
keys = {}  # k -> user


def cookie_header(value_by_name):
    expires = time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime(time.time() + 365 * 86400))
    return '\n'.join(f'{PREFIX}{n}={v}; expires={expires}; path=/; domain=.ivelt.com; secure; HttpOnly'
                     for n, v in value_by_name.items())


def new_session(user, remember):
    sid = secrets.token_hex(16)
    sessions[sid] = user
    k = ''
    if remember:
        k = secrets.token_hex(8)
        keys[k] = user
    return {'u': user, 'k': k, 'sid': sid}


def who(cookies):
    """Like phpBB's session_begin and session_create: the user, and the cookies to set (or None)."""
    u, k, sid = (cookies.get(PREFIX + n, '') for n in ('u', 'k', 'sid'))
    if sid in sessions and sessions[sid] == u:
        return u, None
    if k and keys.get(k) == u:
        del keys[k]  # the key is used up, a new one goes in its place
        return u, new_session(u, True)
    return '1', new_session('1', False)


def page_for(user, html):
    s = BeautifulSoup(html, 'html.parser')
    header = s.select_one('#username_logged_in')
    if user == '1':
        header.decompose()
    else:
        for el in header.select('.my_other_name, .username'):
            el.string = USERS[user]
        for a in header.select('a[href*="mode=viewprofile"]'):
            a['href'] = re.sub(r'u=\d+', 'u=' + user, a['href'])
    return str(s)


class Forum(http.server.BaseHTTPRequestHandler):
    """The forum's pages and files, on a server here: the browser reaches it for www.ivelt.com
    (--host-resolver-rules). Not through Playwright's routing, which drops the cookies of requests
    from the extension's background."""

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.endswith('.php') or path == '/forum/':
            cookies = dict(c.split('=', 1) for c in (self.headers.get('Cookie') or '').split('; ') if '=' in c)
            user, set_cookies = who(cookies)
            if os.environ.get('ACCOUNTS_DEBUG'):
                print('   ', self.path[7:47], cookies.get(PREFIX + 'u'), cookies.get(PREFIX + 'k'), '->', user, set_cookies)
            body = page_for(user, render.PAGES[path]()) if path in render.PAGES else                 '<html><body><div id="page-body"></div></body></html>'
            return self.answer(body.encode(), 'text/html; charset=utf-8', set_cookies)
        file = os.path.normpath(os.path.join(render.SITE, urllib.parse.unquote(path).lstrip('/')))
        if file.startswith(render.SITE) and os.path.isfile(file):
            return self.answer(open(file, 'rb').read(), render.TYPES.get(os.path.splitext(file)[1], 'application/octet-stream'))
        self.answer(b'', 'text/plain', status=404)

    def answer(self, body, content_type, set_cookies=None, status=200):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        if set_cookies:
            for line in cookie_header(set_cookies).split('\n'):
                self.send_header('Set-Cookie', line)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def start_forum():
    """The server, with a self-signed certificate for www.ivelt.com (the browser is told to take it)."""
    folder = tempfile.mkdtemp(prefix='ivh-accounts-')
    cert, key = os.path.join(folder, 'cert.pem'), os.path.join(folder, 'key.pem')
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
                    '-days', '1', '-subj', '/CN=www.ivelt.com'], check=True, capture_output=True)
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Forum)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, folder


class Test:
    def __init__(self, pw):
        self.server, self.folder = start_forum()
        self.profile = tempfile.mkdtemp(prefix='ivh-accounts-profile-')
        self.ctx = pw.chromium.launch_persistent_context(
            self.profile, channel=os.environ.get('RENDER_CHANNEL', 'chromium'), headless=True, locale='he-IL',
            args=[f'--disable-extensions-except={render.EXT}', f'--load-extension={render.EXT}',
                  f'--host-resolver-rules=MAP www.ivelt.com 127.0.0.1:{self.server.server_address[1]}',
                  '--ignore-certificate-errors'])
        # everything else as for the store images: nothing reaches the real internet
        self.ctx.route(re.compile(r'^(?!https://www\.ivelt\.com/)'), render.serve)
        self.sw = self.ctx.service_workers[0] if self.ctx.service_workers else self.ctx.wait_for_event('serviceworker')
        self.ext_id = self.sw.url.split('/')[2]
        self.sw.evaluate('''() => new Promise(r => { const t = () => chrome.storage.local.get(null, i =>
            Object.keys(i).length > 5 ? r() : setTimeout(t, 100)); t(); })''')
        self.sw.evaluate('() => chrome.storage.local.set({ multiAccounts: true })')
        self.topic = None

    def close(self):
        self.ctx.close()
        self.server.shutdown()
        shutil.rmtree(self.profile, ignore_errors=True)
        shutil.rmtree(self.folder, ignore_errors=True)

    def sign_in(self, user, remember=True):
        """What the forum's sign-in page does: a new session, and its cookies in the browser."""
        c = new_session(user, remember)
        self.ctx.add_cookies([{'name': PREFIX + n, 'value': v, 'domain': '.ivelt.com', 'path': '/',
                               'secure': True, 'httpOnly': True, 'expires': time.time() + 365 * 86400}
                              for n, v in c.items()])
        return c

    def cookies(self):
        return {c['name'][len(PREFIX):]: c['value'] for c in self.ctx.cookies('https://www.ivelt.com')
                if c['name'].startswith(PREFIX)}

    def saved(self):
        return self.sw.evaluate('async () => (await chrome.storage.local.get("savedAccounts")).savedAccounts')

    def saved_cookies(self, user):
        account = next(a for a in self.saved() if a['userId'] == user)
        return {c['name'][len(PREFIX):]: c['value'] for c in account['cookies']}

    def open_topic(self):
        """A forum tab, kept open: switching reloads it."""
        if not self.topic:
            self.topic = self.ctx.new_page()
            self.topic.goto(render.FORUM + 'viewtopic.php?t=1')
        else:
            self.topic.reload()
        self.topic.wait_for_timeout(800)
        return self.topic

    def topic_user(self):
        el = self.topic.query_selector('#username_logged_in .my_other_name')
        return el.text_content().strip() if el else None

    def popup(self):
        page = self.ctx.new_page()
        page.set_viewport_size({'width': 420, 'height': 600})
        page.on('dialog', lambda d: d.accept())
        page.goto(f'chrome-extension://{self.ext_id}/popup.html')
        page.wait_for_selector('#accountsSection:not([hidden])')
        page.wait_for_timeout(300)
        return page

    def switch(self, name):
        page = self.popup()
        page.click(f'.account_row:has-text("{name}")')
        # switched: the popup closes itself; otherwise it says why
        try:
            page.wait_for_event('close', timeout=3000)
            # and the forum's tabs reload, one after the other
            self.ctx.pages[0].wait_for_timeout(1500)
            return None
        except Exception:
            message = page.text_content('#accountsMessage')
            page.close()
            return message


def check(what, ok):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        check.failed = True


check.failed = False


def main():
    with sync_playwright() as pw:
        t = Test(pw)
        try:
            run(t)
        finally:
            t.close()
    sys.exit(1 if check.failed else 0)


def run(t):
    # signed in as ראובן, the popup offers to save the account
    a = t.sign_in('2')
    t.open_topic()
    check('the forum page shows ראובן signed in', t.topic_user() == 'ראובן')
    page = t.popup()
    check('the popup offers to save the account', page.is_visible('#save_account'))

    # adding an account: ראובן is saved and signed out here only, the sign-in page opens
    with t.ctx.expect_page() as login:
        page.click('#add_account')
    login.value.wait_for_load_state()
    check('the sign-in page opens', 'mode=login' in login.value.url)
    saved = t.saved()
    check('ראובן is saved with his cookies', len(saved) == 1 and t.saved_cookies('2') == a)
    check('ראובן is still signed in on the server', a['sid'] in sessions and a['k'] in keys)
    check('the browser is a guest now', t.cookies().get('u') in (None, '1'))

    # שמעון signs in there, and is saved by himself
    b = t.sign_in('3')
    t.ctx.pages[-1].wait_for_timeout(1200)
    t.open_topic()
    check('שמעון is saved too', [x['userId'] for x in t.saved()] == ['2', '3'])
    check('the names come from the forum page', [x['name'] for x in t.saved()] == ['ראובן', 'שמעון'])

    page = t.popup()
    rows = page.query_selector_all('.account_row')
    check('the popup lists both accounts', len(rows) == 2)
    check('שמעון is marked signed in', 'current' in (page.get_attribute('.account_row:has-text("שמעון")', 'class') or ''))
    check('no save button for an account already saved', not page.is_visible('#save_account'))
    page.close()

    # switching to ראובן: his saved session still works, the tab reloads as him
    t.switch('ראובן')
    check('the cookies are ראובן\'s', t.cookies() == a)
    t.topic.wait_for_timeout(800)
    check('the open forum tab reloaded as ראובן', t.topic_user() == 'ראובן')

    # ראובן's session ends on the server: switching back signs in with his key, which the forum
    # then replaces, the new one is saved
    for sid in [s for s, u in sessions.items() if u == '2']:
        del sessions[sid]
    t.switch('שמעון')
    check('the cookies are שמעון\'s', t.cookies()['u'] == '3' and t.cookies()['k'] == b['k'])
    t.switch('ראובן')
    now = t.cookies()
    check('ראובן is signed in again with his key', now['u'] == '2')
    check('the forum replaced his key', now['k'] != a['k'] and a['k'] not in keys and now['k'] in keys)
    check('the new key is saved', t.saved_cookies('2') == now)

    # and it keeps working: the session ends again, the saved (new) key signs in again
    for sid in [s for s, u in sessions.items() if u == '2']:
        del sessions[sid]
    t.switch('שמעון')
    t.switch('ראובן')
    check('the replaced key works next time too', t.cookies()['u'] == '2')

    # לוי is added without "remember me", then his session ends: he's marked expired, and
    # ראובן stays signed in
    page = t.popup()
    with t.ctx.expect_page() as login:
        page.click('#add_account')
    login.value.wait_for_load_state()
    c = t.sign_in('4', remember=False)
    t.ctx.pages[-1].wait_for_timeout(1200)
    check('לוי is saved, without a key', '4' in [x['userId'] for x in t.saved()] and t.saved_cookies('4')['k'] == '')
    t.switch('ראובן')
    del sessions[c['sid']]
    message = t.switch('4')  # no name yet, he never opened a forum page: "באנוצער 4"
    check('switching to the expired לוי says so', bool(message) and 'נישט אריינגעלאגט' in message)
    check('ראובן is still signed in', t.cookies()['u'] == '2')
    check('לוי is marked expired', next(x for x in t.saved() if x['userId'] == '4').get('expired') is True)
    page = t.popup()
    check('the popup offers to sign in again', 'לאג אריין נאכאמאל' in page.text_content('.account_row.expired'))
    if os.environ.get('ACCOUNTS_SHOT'):
        page.screenshot(path=os.environ['ACCOUNTS_SHOT'])

    # forgetting an account takes it out of the list only
    page.hover('.account_row.expired')
    page.click('.account_row.expired .account_forget')
    page.wait_for_timeout(500)
    check('לוי is gone from the list', [x['userId'] for x in t.saved()] == ['2', '3'])
    check('the popup shows two accounts', len(page.query_selector_all('.account_row')) == 2)
    page.close()

    # a forum page can't ask to switch (only the extension's pages can)
    answer = t.topic.evaluate('() => typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.sendMessage)')
    check('the forum page itself has no way to message the extension', answer is False)
    check('no saved cookies on the forum page', 'savedAccounts' not in t.topic.content() and a['sid'] not in t.topic.content())

    # turning it off deletes the saved cookies
    t.sw.evaluate('() => chrome.storage.local.set({ multiAccounts: false })')
    time.sleep(0.5)
    check('turning it off deletes the saved accounts', t.saved() is None)


if __name__ == '__main__':
    main()
