# Renders the store screenshots and the promo tiles in store-assets/ from the current code.
#
# Chromium runs the real extension (extension/) on demo forum pages: the forum's own markup and
# styles (site/, from snapshot.py) with the made-up users and posts in demo.json, served for
# www.ivelt.com without reaching the real site. Each shot in shots.json then goes in the blue
# frame (frame/frame.html) with its title, feature list and close-ups.
#
# Usage: python render.py [shot names...] [--stages]
#   no names: every shot. --stages also saves each raw page capture in out/ for checking.
import base64, io, json, os, re, shutil, sys, tempfile, urllib.parse
from bs4 import BeautifulSoup
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
EXT = os.path.join(ROOT, 'extension')
OUT = os.path.dirname(HERE)  # store-assets/
SITE = os.path.join(HERE, 'site')
FORUM = 'https://www.ivelt.com/forum/'
SCALE = 2  # the pages are captured at 2x, so the close-ups stay sharp

DEMO = json.load(open(os.path.join(HERE, 'demo.json'), encoding='utf-8'))
SHOTS = json.load(open(os.path.join(HERE, 'shots.json'), encoding='utf-8'))


# ---------- the demo forum pages ----------

def avatar(name):
    u = DEMO['users'][name]
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" '
           f'rx="6" fill="{u["color"]}"/><text x="45" y="62" font-size="50" font-family="Arial" '
           f'font-weight="bold" fill="#fff" text-anchor="middle">{u["letter"]}</text></svg>')
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def set_html(el, html):
    el.clear()
    el.append(BeautifulSoup(html, 'html.parser'))


def common(s, html_title):
    """What every demo page shares: the signed-in user, the notifications, the topic."""
    t = DEMO['topic']
    if s.title:
        s.title.string = html_title
    for el in s.select('.header-avatar .username, .header-avatar .my_other_name'):
        el.string = DEMO['me']
    for el in s.select('.header-avatar img'):
        el['src'] = avatar(DEMO['me'])

    n = DEMO['notifications']
    pattern = s.select_one('[data-demo="#notification_list ul > li"]')
    if pattern:
        for item in n['items']:
            li = BeautifulSoup(str(pattern), 'html.parser').li
            del li['data-demo']
            li['class'] = ['bg2'] if item['unread'] else []
            verb = {'באדאנקט': 'פאר דיין תגובה:'}.get(item['type'], 'אין:')
            set_html(li.select_one('.notification-title'),
                     f'<strong>{item["type"]}</strong> דורך <span class="username">{item["by"]}</span> {verb}')
            li.select_one('.notification-reference').string = item['ref']
            li.select_one('.notification-time').string = item['time']
            li.select_one('img')['src'] = avatar(item['by'])
            pattern.insert_before(li)
        pattern.decompose()
    bell = s.select_one('#notification_list_button .badge')
    if bell:
        bell.string = str(n['badge'])
        bell['class'] = ['badge']

    html = str(s)
    html = re.sub(r'([?&](?:amp;)?t=)\d+', rf'\g<1>{t["id"]}', html)
    html = re.sub(r'([?&](?:amp;)?f=)\d+', rf'\g<1>{t["forum_id"]}', html)
    return html


def fill_post(pattern, post, i, template_id):
    u = DEMO['users'][post['author']]
    html = str(pattern).replace(template_id, str(post['id']))
    el = BeautifulSoup(html, 'html.parser').div
    del el['data-demo']
    for a in el.select('.username, .username-coloured'):
        a.string = post['author']
        if a.get('href'):
            a['href'] = f'./memberlist.php?mode=viewprofile&u={u["id"]}'
    for a in el.select('a.avatar'):
        a['href'] = f'./memberlist.php?mode=viewprofile&u={u["id"]}'
    for img in el.select('img.avatar'):
        img['src'] = avatar(post['author'])
    for sel, text in (('.profile-rank', u['rank']), ('.profile-posts a', u['posts'])):
        if el.select_one(sel):
            el.select_one(sel).string = text
    joined = el.select_one('.profile-joined')
    if joined:
        set_html(joined, f'<strong>זיך איינגעשריבן אום:</strong> {u["joined"]}')
    for t in el.select('time'):
        t.string = post['time']
    for h in el.select('h3 a'):
        h.string = ('Re: ' if i else '') + DEMO['topic']['title']
    count = el.select_one('.postlove-count')
    if count:
        count.string = str(len(post['likers']))
        # the forum lists who liked it in the count's tooltip, which the who liked arrow reads
        count['title'] = 'תגובה באדאנקט דורך: ' + ', '.join(post['likers'])
    set_html(el.select_one('.content'), post['content'])
    el['class'] = [c for c in el['class'] if c not in ('bg1', 'bg2')] + ['bg2' if i % 2 == 0 else 'bg1']
    return el


def viewtopic():
    s = BeautifulSoup(open(os.path.join(SITE, 'forum', 'viewtopic.html'), encoding='utf-8').read(), 'html.parser')
    t = DEMO['topic']
    s.select_one('h2.topic-title a').string = t['title']
    pattern = s.select_one('[data-demo="#page-body > div.post.has-profile"]')
    template_id = pattern['id'][1:]
    for i, post in enumerate(DEMO['posts']):
        pattern.insert_before(fill_post(pattern, post, i, template_id))
    pattern.decompose()
    for p in s.select('.pagination'):
        for node in p.find_all(string=re.compile(r'\d+ תגובות')):
            node.replace_with(re.sub(r'\d+ תגובות', f'{t["replies"]} תגובות', node))
    subject = s.select_one('#qr_postform #subject')
    if subject:
        subject['value'] = 'Re: ' + t['title']
    return common(s, f'{t["title"]} - בלאט {t["page"]} - אידישע וועלט פארומס')


def posting():
    s = BeautifulSoup(open(os.path.join(SITE, 'forum', 'posting.html'), encoding='utf-8').read(), 'html.parser')
    t = DEMO['topic']
    for a in s.select('h2.posting-title a'):
        a.string = t['title']
    pattern = s.select_one('[data-demo="#topicreview > div.post"]')
    if pattern:
        template_id = re.search(r'\d+', pattern.select_one('.postbody')['id']).group()
        for i, post in enumerate(reversed(DEMO['posts'])):
            el = BeautifulSoup(str(pattern).replace(template_id, str(post['id'])), 'html.parser').div
            del el['data-demo']
            for a in el.select('.username, .username-coloured'):
                a.string = post['author']
            for tm in el.select('time'):
                tm.string = post['time']
            for h in el.select('h3 a'):
                h.string = 'Re: ' + t['title']
            set_html(el.select_one('.content'), post['content'])
            pattern.insert_before(el)
        pattern.decompose()
    subject = s.select_one('#subject')
    if subject:
        subject['value'] = 'Re: ' + t['title']
    return common(s, f'שרייב א תגובה - {t["title"]} - אידישע וועלט פארומס')


PAGES = {'/forum/viewtopic.php': viewtopic, '/forum/posting.php': posting}
TYPES = {'.css': 'text/css', '.js': 'application/javascript', '.gif': 'image/gif', '.png': 'image/png',
         '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg'}


def serve(route):
    url = urllib.parse.urlparse(route.request.url)
    if url.hostname in ('www.ivelt.com', 'ivelt.com'):
        if url.path in PAGES:
            return route.fulfill(status=200, content_type='text/html; charset=utf-8', body=PAGES[url.path]())
        path = os.path.normpath(os.path.join(SITE, urllib.parse.unquote(url.path).lstrip('/')))
        if path.startswith(SITE) and os.path.isfile(path):
            return route.fulfill(status=200, path=path,
                                 content_type=TYPES.get(os.path.splitext(path)[1], 'application/octet-stream'))
        return route.fulfill(status=404, body='')
    if url.hostname == 'api.github.com':
        # the settings page's update check, for a copy not from a store: nothing newer
        return route.fulfill(status=200, content_type='application/json', body='[]')
    if url.scheme in ('chrome-extension', 'data', 'file'):
        return route.continue_()
    return route.abort()


# ---------- the browser ----------

class Browser:
    def __init__(self, pw):
        # a new profile every time, so it starts as a fresh install
        self.profile = tempfile.mkdtemp(prefix='ivh-render-')
        self.ctx = pw.chromium.launch_persistent_context(
            self.profile, channel=os.environ.get('RENDER_CHANNEL', 'chromium'), headless=True,
            locale='he-IL', device_scale_factor=SCALE, viewport={'width': 1200, 'height': 900},
            permissions=['clipboard-read', 'clipboard-write'],
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        self.ctx.route('**/*', serve)
        self.sw = self.ctx.service_workers[0] if self.ctx.service_workers else self.ctx.wait_for_event('serviceworker')
        self.ext_id = self.sw.url.split('/')[2]
        # wait for the defaults the extension sets when it's installed
        self.sw.evaluate('''() => new Promise(r => { const t = () => chrome.storage.local.get(null, i =>
            Object.keys(i).length > 5 ? r() : setTimeout(t, 100)); t(); })''')
        self.defaults = self.sw.evaluate('() => chrome.storage.local.get(null)')

    def settings(self, values):
        # every page starts from the defaults, plus the shot's own settings
        self.sw.evaluate('''async v => { await chrome.storage.local.clear();
            await chrome.storage.local.set(v); }''', {**self.defaults, **values})

    def open(self, spec):
        """Opens a stage's page, with its settings and steps done."""
        self.settings(spec.get('settings', {}))
        page = self.ctx.new_page()
        w, h = spec.get('viewport', [1200, 900])
        page.set_viewport_size({'width': w, 'height': h})
        url = spec['page']
        page.goto(f'chrome-extension://{self.ext_id}/{url[4:]}' if url.startswith('ext:') else FORUM + url)
        page.wait_for_timeout(1200)
        for step in spec.get('steps', []):
            if 'click' in step:
                page.click(step['click'])
            elif 'hover' in step:
                page.hover(step['hover'])
            elif 'scroll' in step:
                page.eval_on_selector(step['scroll'], '''(e, off) => window.scrollTo(0,
                    e.getBoundingClientRect().top + scrollY + off)''', step.get('offset', 0))
            elif 'eval' in step:
                page.evaluate(step['eval'])
            if 'wait' in step:
                page.wait_for_timeout(step['wait'])
        if spec.get('outline'):
            # the orange frames around what the shot points out
            page.add_style_tag(content='.ivh-mark { outline: 3px solid #ff9a1f !important; outline-offset: 2px; '
                                       'border-radius: 6px; box-shadow: 0 0 0 7px rgba(255,154,31,.28) !important; }')
            for sel in spec['outline']:
                page.eval_on_selector_all(sel, "els => els.forEach(e => e.classList.add('ivh-mark'))")
        page.mouse.move(0, 0)
        page.wait_for_timeout(200)
        return page

    def close(self):
        self.ctx.close()
        shutil.rmtree(self.profile, ignore_errors=True)


def data_url(png):
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def rect(page, selectors, pad):
    """The box around everything the selectors match, in CSS pixels of the viewport."""
    boxes = []
    for sel in [selectors] if isinstance(selectors, str) else selectors:
        boxes += [b for b in (e.bounding_box() for e in page.query_selector_all(sel)) if b and b['width']]
    if not boxes:
        raise SystemExit(f'Nothing on the page for {selectors}')
    x1 = min(b['x'] for b in boxes) - pad
    y1 = min(b['y'] for b in boxes) - pad
    x2 = max(b['x'] + b['width'] for b in boxes) + pad
    y2 = max(b['y'] + b['height'] for b in boxes) + pad
    return max(x1, 0), max(y1, 0), x2, y2


def callout(page, c):
    """A close-up of part of the page, scaled by its zoom, for the frame."""
    x1, y1, x2, y2 = rect(page, c['selector'], c.get('pad', 6))
    img = Image.open(io.BytesIO(page.screenshot()))
    # not past the edge of the page
    vw, vh = page.viewport_size['width'], page.viewport_size['height']
    x2, y2 = min(x2, vw), min(y2, vh)
    crop = img.crop(tuple(round(v * SCALE) for v in (x1, y1, x2, y2)))
    buf = io.BytesIO()
    crop.save(buf, 'PNG')
    z = c.get('zoom', 1)
    w, h = round((x2 - x1) * z), round((y2 - y1) * z)
    # placed by its left edge (x), or by its right edge (right) when its width depends on the page
    x = c['right'] - w if 'right' in c else c['x']
    return {'src': data_url(buf.getvalue()), 'x': x, 'y': c['y'], 'w': w, 'h': h, 'plain': c.get('plain', False)}


def same(path, img):
    # anti-aliasing can differ by a shade between runs: only a real change replaces the file
    if not os.path.exists(path):
        return False
    old = Image.open(path).convert('RGB')
    if old.size != img.size:
        return False
    diff = ImageChops.difference(old, img).convert('L').point(lambda v: 255 if v > 24 else 0)
    return diff.histogram()[255] < img.size[0] * img.size[1] * 0.0005


def render(b, shot, stages):
    data = dict(shot, badge=DEMO['notifications']['badge'], calloutImages=[])
    page = b.open(shot['stage']) if 'stage' in shot else None
    if page:
        png = page.screenshot()
        data['stageImage'] = data_url(png)
        if stages:
            open(os.path.join(HERE, 'out', shot['name'] + '-stage.png'), 'wb').write(png)
    for c in shot.get('callouts', []):
        if 'page' in c:
            other = b.open(c)
            data['calloutImages'].append(callout(other, c))
            other.close()
        else:
            data['calloutImages'].append(callout(page, c))
    if page:
        page.close()

    w, h = shot.get('size', [1280, 800])
    frame = b.ctx.new_page()
    frame.set_viewport_size({'width': w, 'height': h})
    frame.goto('file:///' + os.path.join(HERE, 'frame', 'frame.html').replace('\\', '/'))
    frame.evaluate('shot => render(shot)', data)
    # 24-bit, no alpha: the Chrome Web Store refuses a promo tile with alpha
    img = Image.open(io.BytesIO(frame.screenshot(scale='css'))).convert('RGB')
    frame.close()
    path = os.path.join(OUT, shot['file'])
    if same(path, img):
        print(f'{shot["file"]}: no change')
    else:
        img.save(path, 'PNG', optimize=True)
        print(f'{shot["file"]}: rendered')


if __name__ == '__main__':
    names = [a for a in sys.argv[1:] if not a.startswith('--')]
    stages = '--stages' in sys.argv
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    with sync_playwright() as pw:
        b = Browser(pw)
        try:
            for shot in SHOTS:
                if not names or shot['name'] in names:
                    render(b, shot, stages)
        finally:
            b.close()
