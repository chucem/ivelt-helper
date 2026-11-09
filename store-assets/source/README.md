# Store images, made from the code

The screenshots and the promo tiles in `store-assets/` are rendered, not edited by hand. A
GitHub Action (`.github/workflows/store-assets.yml`) renders them again on every push to `dev`
that changes `extension/` or this folder, and commits the ones that changed.

## How it works

`render.py` starts Chromium with the real extension from `extension/` and opens demo forum pages
on `www.ivelt.com`. Nothing reaches the real site: every request is answered from here.

- `site/forum/viewtopic.html`, `site/forum/posting.html`: the forum's own pages with everything
  personal taken out (see `snapshot.py`), plus its stylesheets, scripts and images. `site/vendor/`
  has jQuery and Font Awesome, which the forum loads from a CDN.
- `demo.json`: the made-up users, posts, likes and notifications that go into those pages.
- `shots.json`: one entry per image: the title and feature list in the blue frame, the page to
  open and what to click there (`stage`), what to frame in orange (`outline`), and close-ups of
  parts of the page (`callouts`, found by CSS selector, so they follow the layout).
- `frame/frame.html`: the blue frame itself, with the Rubik font.

So a change in the extension's look shows up in the images by itself. To change what an image
says or shows, edit `shots.json` or `demo.json`.

## Running it

```bash
pip install -r store-assets/source/requirements.txt
python -m playwright install chromium
python store-assets/source/render.py                  # every image
python store-assets/source/render.py themes --stages  # one image, and its raw page in out/
```

An image is only written when it really changed, so running it again doesn't touch the others.
If Playwright's Chromium won't start (on Windows it can fail with "side-by-side configuration is
incorrect"), use Edge: `RENDER_CHANNEL=msedge python store-assets/source/render.py`. The
Action's images (Linux fonts) are the ones that count; a local run is for checking.

Chrome Web Store: up to 5 screenshots, 1280×800; Edge Add-ons: up to 10. The promo tiles,
440×280 and the 1400×560 marquee, are saved without alpha, as the Chrome Web Store requires.

## When the forum's own look changes

Save the forum's pages again and run `snapshot.py`:

1. On the forum, signed in, open the testing topic and run in the console (or with Claude in
   Chrome) a script that saves the raw HTML of the topic page and of its reply page
   (`posting.php?mode=reply&t=…`) as `viewtopic.html` and `posting.html`, and the stylesheets,
   scripts and the images they use, under the same paths, into `site/`.
2. `python store-assets/source/snapshot.py <folder with the two pages>`
3. It prints the user names and long hex strings still in the pages: there should be none but
   `DEMO_NAME`. Look over the diff before committing: no real names, posts, tokens or session ids.
