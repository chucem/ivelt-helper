# Renders the what's-new video from the current code, like the store images (render.py): the real
# extension on the demo forum pages, with the made-up users from demo.json, so no real account,
# post or private message is in it. Each scene is a page (forum, mobile, the extension's menu or
# settings) with a Yiddish caption and orange frames from the release skill's overlay.js, saved
# as a 1280x800 still; ffmpeg then crossfades the stills into an MP4.
#
# The scenes follow store-assets/video-script.md: when it changes, change SCENES here.
# Usage: python video.py [output.mp4]     (default: store-assets/ivelt-helper-<version>.mp4)
#   --stills  only the stills, in out/video/, to look at them before building
import base64, json, os, re, shutil, subprocess, sys

import render  # the demo pages and the browser with the extension

HERE = render.HERE
ROOT = render.ROOT
OVERLAY = open(os.path.join(ROOT, '.claude', 'skills', 'release', 'video', 'overlay.js'), encoding='utf-8').read()
VERSION = json.load(open(os.path.join(render.EXT, 'manifest.json'), encoding='utf-8'))['version']
STILLS = os.path.join(HERE, 'out', 'video')
W, H = 1280, 800
FADE = 0.5
MOBILE = (412, 860)
BLUE = '#163a66'

# the forum's nested quotes, by the demo users, for the quotes-inside-quotes scene
NESTED = ('<blockquote><div><cite>שמערל האט געשריבן:</cite>'
          '<blockquote><div><cite>זלמן האט געשריבן:</cite>'
          '<blockquote><div><cite>בערל האט געשריבן:</cite>'
          'ווייסט איינער ווי מען שטעלט אן די טונקעלע טעמע?</div></blockquote>'
          'אין די אנשטעלונגען, אונטער קאלירן.</div></blockquote>'
          'א שיינעם דאנק, עס ארבעט!</div></blockquote>'
          'געזונטערהייט, הנאה האבן.')


def overlay(page):
    page.evaluate(OVERLAY)


def caption(page, text, marks=(), pad=6):
    overlay(page)
    for sel in marks:
        page.evaluate('([s, p]) => __v.mark(s, p)', [sel, pad])
    page.evaluate('t => __v.cap(t)', text)


def still(page, name):
    path = os.path.join(STILLS, name + '.png')
    page.screenshot(path=path)
    return path


def framed(b, name, shot_png, text, kind):
    """A mobile page (in a phone) or the extension's menu, on the blue background with the caption."""
    page = b.ctx.new_page()
    page.set_viewport_size({'width': W, 'height': H})
    src = 'data:image/png;base64,' + base64.b64encode(shot_png).decode()
    if kind == 'phone':
        box = ('<div style="padding:14px;background:#111;border-radius:34px;box-shadow:0 12px 40px rgba(0,0,0,.45)">'
               f'<img src="{src}" style="display:block;height:556px;border-radius:22px"></div>')
    else:
        box = (f'<img src="{src}" style="display:block;max-height:584px;border-radius:10px;'
               'box-shadow:0 12px 40px rgba(0,0,0,.45)">')
    page.set_content(f'<html><body style="margin:0;width:{W}px;height:{H}px;background:{BLUE};display:flex;'
                     f'justify-content:center;align-items:flex-start;padding-top:22px;box-sizing:border-box">{box}</body></html>')
    page.wait_for_timeout(200)
    caption(page, text)
    path = still(page, name)
    page.close()
    return path


def card(b, name, title, *lines):
    page = b.ctx.new_page()
    page.set_viewport_size({'width': W, 'height': H})
    page.set_content('<html><body style="margin:0"></body></html>')
    overlay(page)
    page.evaluate('([t, l]) => __v.card(t, ...l)', [title, list(lines)])
    path = still(page, name)
    page.close()
    return path


def forum(b, url, settings=None, size=(W, H)):
    page = b.open({'page': url, 'settings': settings or {}, 'viewport': list(size)})
    return page


def accounts(b):
    """The extension's menu with two saved accounts, בערל signed in."""
    users = render.DEMO['users']
    saved = [{'userId': str(users[n]['id']), 'name': n, 'avatar': render.avatar(n), 'expired': False,
              'savedAt': 0, 'profileCheckedAt': 0,
              'cookies': [{'name': 'phpbb3_sw7kk_k', 'value': 'demo', 'domain': '.ivelt.com', 'path': '/'}]}
             for n in ('בערל', 'זלמן')]
    b.settings({'multiAccounts': True})
    b.sw.evaluate('''list => new Promise((ok, fail) => { const o = indexedDB.open('accounts', 1);
        o.onupgradeneeded = () => o.result.createObjectStore('accounts');
        o.onerror = () => fail(o.error);
        o.onsuccess = () => { const t = o.result.transaction('accounts', 'readwrite');
            t.objectStore('accounts').put(list, 'list'); t.oncomplete = () => { o.result.close(); ok(); }; }; })''', saved)
    b.ctx.add_cookies([{'name': 'phpbb3_sw7kk_u', 'value': str(users['בערל']['id']),
                        'domain': '.ivelt.com', 'path': '/', 'secure': True}])
    page = b.ctx.new_page()
    page.set_viewport_size({'width': 460, 'height': 600})
    page.goto(f'chrome-extension://{b.ext_id}/popup.html')
    page.wait_for_selector('#accountsList .account_row', timeout=8000)
    page.wait_for_timeout(600)
    # the version the video is about, not a test build's -beta.N
    page.evaluate("v => { const e = document.getElementById('popup_version'); if (e) e.textContent = 'v' + v; }", VERSION)
    overlay(page)
    page.evaluate("() => __v.mark('#accountsSection', 4)")
    png = page.locator('body').screenshot()
    page.close()
    return png


def settings_scene(b, name, row, text, values=None):
    page = forum(b, 'ext:settings.html', values)
    page.eval_on_selector(row, 'e => e.scrollIntoView({block: "center"})')
    page.wait_for_timeout(300)
    caption(page, text, [row])
    path = still(page, name)
    page.close()
    return path


def mobile_png(page):
    page.wait_for_timeout(300)
    return page.screenshot()


SCENES = []  # (name, seconds), in order


def scene(name, seconds):
    def add(fn):
        SCENES.append((name, seconds, fn))
        return fn
    return add


@scene('01-opening', 4)
def _(b, n):
    return card(b, n, f'אייוועלט העלפער {VERSION}', 'די נייע זאכן')


@scene('02-accounts', 6)
def _(b, n):
    return framed(b, n, accounts(b), 'בלייב אריינגעלאגט אין עטליכע אקאונטס, און טויש צווישן זיי פונעם עקסטענשען מעניו', 'popup')


@scene('03-accounts-setting', 5)
def _(b, n):
    return settings_scene(b, n, '.row:has(#multiAccounts)', 'מען צינדט עס אן אין די אנשטעלונגען',
                          {'multiAccounts': True})


@scene('04-quote-link', 5)
def _(b, n):
    return settings_scene(b, n, '.row:has(#quoteSourceLink)',
                          'ציטירן אין אן אנדער אשכול: קעפל אויבן, מקור אונטן, ביידע, אדער גארנישט')


@scene('05-bells', 6)
def _(b, n):
    page = forum(b, 'ext:settings.html')
    page.eval_on_selector('#splitNotifsKinds', 'e => e.scrollIntoView({block: "center"})')
    page.wait_for_timeout(300)
    caption(page, 'קלייב וועלכע נאטיפיקאציעס באקומען אן אייגן גלעקל',
            ['[role="group"]:has(#splitNotifsKinds)', '.row:has(#olderNotifsPlus)'])
    path = still(page, n)
    page.close()
    return path


@scene('06-alt-h', 4)
def _(b, n):
    page = forum(b, 'viewtopic.php?t=1')
    caption(page, 'Alt+H טראגט צום הויפט בלאט, אפילו מיט אידישע קיבאורד', ['a[accesskey="h"]'])
    path = still(page, n)
    page.close()
    return path


# A new private message quoting זלמן's post, which mentions בערל: the demo site has no PM page, so the
# reply page (the same editor) is served as the PM editor, with the quote already in it, the way the
# forum fills it in. js/pmMentions.js turns the mention into a profile link when the editor opens
PM_QUOTE = ('[quote="זלמן" post_id={post} user_id={zalmen}]\n'
            '[smention u={berel}]בערל[/smention], קוק נאר וואס איך האב געפונען\n[/quote]\n')


def pm_compose():
    users = render.DEMO['users']
    text = PM_QUOTE.format(post=render.DEMO['posts'][1]['id'], zalmen=users['זלמן']['id'], berel=users['בערל']['id'])
    html = render.posting()
    return re.sub(r'(<textarea[^>]*id="message"[^>]*>)(</textarea>)', lambda m: m.group(1) + text + m.group(2), html, count=1)


render.PAGES['/forum/ucp.php'] = pm_compose


@scene('07-pm-mention', 6)
def _(b, n):
    page = forum(b, 'ucp.php?i=pm&mode=compose&action=quotepost&p=1')
    page.wait_for_timeout(300)
    # what the forum's preview shows for the converted text: the quote, with the mention as a blue,
    # bold link to the profile. Above the reply box, so both show; the page labelled as a new PM
    users = render.DEMO['users']
    page.evaluate('''([zalmen, berel, id]) => {
        document.querySelectorAll('#postingbox h3').forEach(h => { h.textContent = 'נייע פריוואטע מעסעדזש'; });
        const box = document.getElementById('postingbox');
        const preview = document.createElement('div');
        preview.id = 'ih-video-preview';
        preview.className = 'post bg2';
        preview.innerHTML = '<div class="inner"><div class="postbody"><h3>פריוויאו</h3><div class="content">'
            + '<blockquote><div><cite>' + zalmen + ' האט געשריבן:</cite>'
            + '<a class="postlink" href="./memberlist.php?mode=viewprofile&u=' + id + '">'
            + '<span style="color:#115098"><strong>@' + berel + '</strong></span></a>'
            + ', קוק נאר וואס איך האב געפונען</div></blockquote></div></div></div>';
        box.parentNode.insertBefore(preview, box);
        preview.scrollIntoView({block: 'start'}); window.scrollBy(0, -12);
    }''', ['זלמן', 'בערל', users['בערל']['id']])
    page.wait_for_timeout(300)
    caption(page, 'א פריוואטע מעסעדזש מיט א ציטאט פון א תגובה וואו עס איז דא אן @ דערמאנונג לאזט זיך שיקן',
            ['#ih-video-preview .content', '#message'])
    path = still(page, n)
    page.close()
    return path


@scene('08-mobile-cover', 3)
def _(b, n):
    return card(b, n, 'אויף מאבייל')


@scene('09-mobile-search', 5)
def _(b, n):
    page = forum(b, 'viewtopic.php?t=1', size=MOBILE)
    page.click('.navbar .responsive-search > a')
    page.wait_for_timeout(300)
    page.evaluate('() => document.activeElement && document.activeElement.blur()')
    overlay(page)
    page.evaluate("() => __v.mark('#ih-mobile-search', 4)")
    png = mobile_png(page)
    page.close()
    return framed(b, n, png, 'אויף מאבייל: דער זוך קנעפל עפנט א זוך קעסטל, מיט גוגל זוך', 'phone')


# the Google Drive / Dropbox button with the toolbar's other buttons (a setting; by default it's next
# to "add files", further down), so it shows in the toolbar scene and its menu can open from there
TOOLBAR_DRIVE = {'driveButtonPlace': 'toolbar'}


def reply_page(b):
    """The reply page on mobile, scrolled to the toolbar. The options and attachments under the reply
    box are hidden: they aren't in these scenes, and the phone's bottom edge cut through them"""
    page = forum(b, 'posting.php?mode=reply&t=1', TOOLBAR_DRIVE, size=MOBILE)
    page.add_style_tag(content='#tabs, #options-panel, #attach-panel { display: none !important; }')
    page.eval_on_selector('#abbc3_buttons', 'e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 140)')
    return page


@scene('10-mobile-toolbar', 5)
def _(b, n):
    page = reply_page(b)
    overlay(page)
    page.evaluate("() => __v.mark('#abbc3_buttons', 4)")
    png = mobile_png(page)
    page.close()
    return framed(b, n, png, 'אויף מאבייל: די קנעפלעך איבערן תגובה קעסטל זענען גרעסער, אין גלייכע שורות', 'phone')


@scene('11-mobile-drive', 5)
def _(b, n):
    page = reply_page(b)
    page.click('#ivd-button')
    page.wait_for_selector('#ivd-wrap .ivd-popup:not([hidden])', timeout=5000)
    page.wait_for_timeout(400)
    overlay(page)
    page.evaluate("() => { __v.mark('#ivd-button', 3); __v.mark('#ivd-wrap .ivd-popup', 4); }")
    png = mobile_png(page)
    page.close()
    return framed(b, n, png, 'אויף מאבייל: דער Google Drive / Dropbox מעניו עפנט זיך אונטן אויפן סקרין', 'phone')


@scene('12-mobile-link', 5)
def _(b, n):
    page = reply_page(b)
    # words in the reply, selected; then the link button as on a touch screen (phpbb.isTouch, which
    # js/mobileLinkButton.js checks): the window opens with the words in it
    page.eval_on_selector('#message', '''e => { e.value = 'קוק דא'; e.focus(); e.setSelectionRange(0, e.value.length);
        window.phpbb.isTouch = true; window.bbspecial('url'); }''')
    page.wait_for_selector('#bbcode_wizard #bbcode_wizard_description', state='visible', timeout=5000)
    page.wait_for_timeout(500)
    overlay(page)
    page.evaluate("() => __v.mark('#bbcode_wizard', 4)")
    png = mobile_png(page)
    page.close()
    return framed(b, n, png, 'אויף מאבייל: דער לינק קנעפל עפנט דאס פענצטערל צו לייגן א לינק', 'phone')


@scene('13-mobile-quote-menu', 6)
def _(b, n):
    post = '#p' + str(render.DEMO['posts'][1]['id'])  # זלמן's post
    page = forum(b, 'viewtopic.php?t=1', size=MOBILE)
    page.eval_on_selector(post, 'e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 40)')
    # a few words in the post's own text (not in its quote)
    page.eval_on_selector(post + ' .postbody .content', '''c => {
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, { acceptNode: t =>
            t.textContent.trim().length > 15 && !t.parentElement.closest('blockquote') ? 1 : 3 });
        const t = w.nextNode(), s = t.textContent.search(/\\S/);
        const r = document.createRange(); r.setStart(t, s);
        r.setEnd(t, Math.min(t.length, t.textContent.indexOf(' ', s + 12) > 0 ? t.textContent.indexOf(' ', s + 12) : s + 14));
        getSelection().removeAllRanges(); getSelection().addRange(r); }''')
    page.wait_for_timeout(400)
    page.click(post + ' .post-buttons .responsive-menu > .dropdown-toggle')
    page.wait_for_timeout(400)
    overlay(page)
    page.evaluate(f"() => __v.mark(document.querySelector('{post} .responsive-menu a.ih-quote-marked'), 4)")
    png = mobile_png(page)
    page.close()
    return framed(b, n, png, 'אויף מאבייל: ציטירן נאר די אנגעצייכנטע ווערטער ארבעט אויך פונעם ⋯ מעניו', 'phone')


@scene('14-mobile-nested', 5)
def _(b, n):
    post = '#p' + str(render.DEMO['posts'][2]['id'])
    page = forum(b, 'viewtopic.php?t=1', size=MOBILE)
    page.eval_on_selector(post + ' .postbody .content', '(c, html) => { c.innerHTML = html; }', NESTED)
    page.eval_on_selector(post, 'e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 40)')
    overlay(page)
    page.evaluate(f"() => __v.mark('{post} .postbody .content > blockquote', 4)")
    png = mobile_png(page)
    page.close()
    return framed(b, n, png, 'אויף מאבייל: ציטאטן אין ציטאטן ווערן נישט מער א שמאלע זייל', 'phone')


@scene('15-closing', 5)
def _(b, n):
    return card(b, n, f'אייוועלט העלפער {VERSION}', 'עס קומט אליין אין א טאג ארום, אדער גלייך פון chrome://extensions',
                'א יישר כח: קנאפער ידען')


def build(stills, out):
    args = ['ffmpeg', '-y', '-loglevel', 'error']
    for path, seconds in stills:
        args += ['-loop', '1', '-t', str(seconds), '-i', path]
    # the stills are at the browser's 2x: each one to 1280x800 first
    parts = [f'[{i}:v]scale={W}:{H}:flags=lanczos,setsar=1[s{i}]' for i in range(len(stills))]
    last, offset = 's0', 0.0
    for i in range(1, len(stills)):
        offset += stills[i - 1][1] - FADE
        label = f'v{i}'
        parts.append(f'[{last}][s{i}]xfade=transition=fade:duration={FADE}:offset={offset:.2f}[{label}]')
        last = label
    filt = ';'.join(parts) + f';[{last}]format=yuv420p,fps=30[out]'
    args += ['-filter_complex', filt, '-map', '[out]', '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', out]
    subprocess.run(args, check=True)


if __name__ == '__main__':
    only_stills = '--stills' in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = names[0] if names else os.path.join(render.OUT, f'ivelt-helper-{VERSION}.mp4')
    shutil.rmtree(STILLS, ignore_errors=True)
    os.makedirs(STILLS)
    with render.sync_playwright() as pw:
        b = render.Browser(pw)
        try:
            # 1280x800 at the browser's 2x, so the stills are crisp; scaled down when built
            stills = [(fn(b, name), seconds) for name, seconds, fn in SCENES]
        finally:
            b.close()
    print(f'{len(stills)} stills in {STILLS}')
    if not only_stills:
        build(stills, out)
        print(f'video: {out}')
