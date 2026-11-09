# Turns pages saved from the live forum into the skeletons in site/forum/, which render.py fills
# with the demo users and posts from demo.json. Only needed again when the forum's own markup
# changes. See README.md for how to save the pages.
#
# Usage: python snapshot.py <folder with viewtopic.html and posting.html>
#
# Everything personal goes: the signed-in user, every other user's name and avatar, the posts,
# the notifications, the session id and the form tokens. What's left is the forum's structure.
import os, re, sys
from bs4 import BeautifulSoup, Comment

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'site', 'forum')

REMOVE = [
    # ads, the poll, who's online, the moderators' names under the title
    '[class*="advs"]', '#post_advs', '#footer_advs', '.adsm_block', 'form.topic_poll',
    '.online-list', '#page-body > h2.topic-title + div + p', '.signature',
    # the extra copy of the user menu the forum keeps hidden
    '.hide_me',
]


def strip_secrets(html):
    html = re.sub(r'([?&](?:amp;)?)sid=[0-9a-f]{32}', r'\1', html)
    html = re.sub(r'\b(sid|form_token|creation_time)(["\']?\s*[:=,]\s*["\']?)[0-9a-f]{8,}', r'\1\g<2>0', html)
    html = re.sub(r'avatar=\d+_\d+\.\w+', 'avatar=0', html)
    html = re.sub(r'([?&](?:amp;)?u(?:id)?=)\d+', r'\g<1>1', html)
    html = re.sub(r'(author_id=)\d+', r'\g<1>1', html)
    html = re.sub(r'([?&](?:amp;)?hash=)[0-9a-f]+', r'\g<1>0', html)
    return html


def clean(path, keep_one):
    s = BeautifulSoup(open(path, encoding='utf-8').read(), 'html.parser')
    for c in s.find_all(string=lambda t: isinstance(t, Comment)):
        c.extract()
    for sel in REMOVE:
        for el in s.select(sel):
            el.decompose()
    # analytics, ads, web fonts, Cloudflare's challenge, and the CDN files served from vendor/
    for el in s.select('script'):
        src, text = el.get('src', ''), el.string or ''
        if ('googletagmanager' in src or 'cloudflare' in src or
                any(k in text for k in ('gtag(', 'dataLayer', '__CF$', 'countAdClick', 'WebFontConfig'))):
            el.decompose()
        elif 'jquery' in src:
            el['src'] = '/vendor/jquery.min.js'
    for el in s.select('link[href*="font-awesome"]'):
        el['href'] = '/vendor/font-awesome/css/font-awesome.min.css'
    for el in s.select('input[type=hidden]'):
        if el.get('name') in ('form_token', 'creation_time', 'topic_cur_post_id', 'sid'):
            el['value'] = '0'

    # one of each repeated thing, as the pattern render.py copies for each demo item
    for sel in keep_one:
        items = s.select(sel)
        for el in items[1:]:
            el.decompose()
        if items:
            items[0]['data-demo'] = sel
            # no real names, avatars or text in the pattern either
            for el in items[0].select('.username, .username-coloured, cite a'):
                el.string = 'DEMO_NAME'
            for el in items[0].select('img'):
                el['src'] = './styles/prosilver/theme/images/no_avatar.gif'
            for el in items[0].select('.content, .notification-reference, .profile-custom-field, a[title^="פארבינד"]'):
                el.clear()
    # the signed-in user, filled in from demo.json
    for el in s.select('.header-avatar .username, .header-avatar .my_other_name'):
        el.string = 'DEMO_ME'
    for el in s.select('.header-avatar img'):
        el['src'] = './styles/prosilver/theme/images/no_avatar.gif'

    html = strip_secrets(str(s))
    name = os.path.basename(path)
    with open(os.path.join(OUT, name), 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    return html


def leaks(html):
    # names and numbers that are left, to look over before committing
    s = BeautifulSoup(html, 'html.parser')
    names = sorted({el.get_text(strip=True) for el in s.select('.username, .username-coloured, cite a')})
    hexes = sorted(set(re.findall(r'\b[0-9a-f]{32,}\b', html)))
    return names, hexes


if __name__ == '__main__':
    src = sys.argv[1]
    os.makedirs(OUT, exist_ok=True)
    for name, keep in (('viewtopic.html', ['#page-body > div.post.has-profile', '#notification_list ul > li']),
                       ('posting.html', ['#topicreview > div.post', '#notification_list ul > li'])):
        html = clean(os.path.join(src, name), keep)
        print(name, len(html), 'bytes; left to check:', *leaks(html))
