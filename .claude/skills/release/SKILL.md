---
name: release
description: Release a new version of iVelt Helper - the what's-new entry, store description and screenshots, the Yiddish post for the forum, merging dev into master, and uploading to the Chrome Web Store and Edge Add-ons. Use when the user says to release, deploy or ship a version, or asks for any one of those pieces for a release.
---

# Releasing a new version

The steps for a release, in order. Keep a task list with one item per step. Work on `dev` in
the main checkout, never in a worktree. The remote is `chucem/ivelt-helper`. Steps 1–3 are
yours. In step 4 the user does the store listings, and in step 5 the user posts on the forum.

## How versions work
- **While testing:** `extension/manifest.json` on `dev` has the coming `version` (e.g. `2.8.0`)
  and a `version_name` with a dash (e.g. `2.8.0-beta.3`). Every push to `dev` that changes the
  manifest publishes a test build as a GitHub pre-release
  (`.github/workflows/prerelease.yml`). To publish another test build, bump the
  `-beta.N`.
- **The release:** merging into `master` a manifest with no `version_name` creates the release
  (`.github/workflows/release.yml`). It tags `v<version>`, builds the zip, writes AI
  release notes and creates the GitHub release.
- **The stores:** a separate, manual workflow (`.github/workflows/store-upload.yml`)
  takes the release's zip, uploads it to the Chrome Web Store and Edge Add-ons, and submits it
  for review.

## 1. On `dev`: what the release says about itself
Do all of these before the merge, so they ship with the release. Commit each one separately.

### What's new pop-up
`extension/js/whatsNew.data.js` has an entry for the new `version`, in Yiddish, with
`features` and `fixes`. It's what users see first after the update. Check that it covers
everything since the last release (`git log --oneline v<last>..dev`) and has no line for
something already released. Never remove old entries: the pop-up shows every version since the
one the user had, each in its own section, so someone who skips a version still sees it.

### READMEs
`README.md` and `README.yi.md` list every feature. Add the new ones to both, in the same
section and the same order.

### Store description
`store-assets/store-description.txt` is the listing text for both stores: **Yiddish first, then
a ―――― line, then the same in English**, with `★` section headings and `•` bullets. It's plain
text, because the stores don't render markdown. Keep the two halves matching. Add the new
features and drop anything that was removed. The limit is 16,000 characters.

### Store assets
In `store-assets/`, used by both stores:
- `screenshot-N-<name>.png`: **1280×800**, 24-bit PNG.
- `promo-tile-440x280.png`: **440×280**, 24-bit PNG **with no alpha channel** (the Chrome Web
  Store rejects one with alpha).
- `promo-marquee-1400x560.png`: the Chrome Web Store's marquee promo tile, **1400×560**, also
  with no alpha.

They're rendered from the code by `store-assets/source/render.py` (see the README there): the
real extension on demo forum pages, in the blue frame. The **Store assets** Action re-renders
them on every push to `dev` and commits the ones that changed, so they're normally up to date
already. Check that the last run on `dev` passed (`gh run list --workflow store-assets.yml
--limit 1`) and look at the images.

For a big new feature, add a shot to `store-assets/source/shots.json` (up to 5 on the Chrome
Web Store, 10 on Edge, so pick the best 5 for Chrome), and change a shot's text when its
feature changed. Render locally to check (`python store-assets/source/render.py <name>`).
Never edit the PNGs by hand: the next run would undo it.

Record the video in the forum's **testing topic**:
https://ivelt.com/forum/viewtopic.php?p=6990092. It's there for trying things out, so posting,
liking and quoting there is fine. It can be on the user's own forum account, with real topics
and posts. Writing a **new** private message is fine (to show a feature of the PM editor,
without sending it). **Never show or read an existing private message**: not the inbox, not
the PM list or dropdown, not a PM's text. Don't read the page text on PM pages either: only
query the elements you need.

### A video of what changed
A short video for users that shows what's new, so they don't have to read a list to find it:
- **Length:** 1–3 minutes, one short scene per new feature, the most useful first. Skip
  small fixes.
- **Language:** Yiddish, as narration or captions, in the same wording as the what's-new
  entry.
- **Content:** each scene shows where to find the feature and one real use, e.g. select words
  → the button turns into "ציטיר אנגעצייכנט" → the quote lands in the reply. For a setting
  that's off until turned on, show where to turn it on.
- **Privacy:** the same as the screenshots: the user's own account is fine, but never a private
  message. No browser bookmarks or other tabs in the frame either.
- **Examples:** wherever a scene needs a user, use the maintainer's own forum account: the
  profile card, the @mention link, and so on. Avoid new likes on other people's posts: to show
  double-click like, take the like back from a post that's already liked and like it again.
- **Resolution:** 1280×800 (720p) is enough for the user. Claude in Chrome's screenshots give
  that.
- **The extension's own pages** (settings, toolbar menu) can't be opened or scripted by Claude
  in Chrome. Ask the user to open them, then take the frame with computer use (`zoom` with
  `save_to_disk`, read-only for Chrome) and use the `still` / `popup` kinds in `build.py`, which
  draw the caption and orange frames with ffmpeg. Take a screenshot just before, and look at
  the zoom before using it: if another window (like Outlook) came to the front, delete the file
  right away. A PowerShell screen capture is no good here: it captures whatever is on top,
  including the Claude window.

Your part: write the script in `store-assets/video-script.md`, with each scene's caption or
narration in Yiddish and what's on screen. Show it to the user. Then make the video, the way
2.7.0's was made (`store-assets/ivelt-helper-2.7.0.mp4`, about 75 seconds):
1. In Claude in Chrome, on the user's account, go through the scenes in the testing topic.
   Before each frame, run `video/overlay.js` (next to this file) in the page with
   `javascript_tool`. It adds `__v.cap(text)` for the Yiddish caption bar, `__v.mark(el)` for
   an orange frame around something, `__v.dotAt(x, y, thumb)` for a click mark, and
   `__v.card(title, ...lines)` for a title card. The page draws the right-to-left text, so it
   comes out right. Run it again after every page load.
2. Take each frame with `computer` → `screenshot`, `save_to_disk: true` at full scale (a scaled
   one is saved small). Note each file's id.
3. List the ids and how long each stays on screen in `video/build.py`, and run it. It crops the
   forum's column, scales it to 1280×800 and crossfades into an MP4. Check a few stills.
- Gif_creator isn't right for this: it adds a watermark and English labels.
- Settings that are off by default have to be turned on by the user. Claude in Chrome can't
  open the extension's settings page.
- If something stops working mid-way, check for Cloudflare's "Just a moment..." page. The user
  has to pass it. Never try to pass it yourself.
- Never press Ctrl+Enter or a send button. Clear the test text from the reply boxes at the end.
The user decides where the video is hosted. Link it in the forum post and the GitHub release
notes.

### The post for the forum
Write the announcement for the extension's topic on אייוועלט in `store-assets/forum-post.txt`.
It's a Yiddish post in phpBB BBCode, for the forum's readers rather than developers:
- A title line with the version, e.g. `[b]אייוועלט העלפער 2.8.0 איז ארויס[/b]`.
- What's new, in a `[list]` with `[*]` items, from the what's-new entry. Short, and the most
  useful things first. Name settings the way the settings page does, and say when something is
  off until turned on.
- The link to the video of what changed, right after the list.
- The fixes worth knowing about, briefly.
- How to get it: the store version updates by itself within a day or so, or right away from
  `chrome://extensions` → **Update**. Give the links to the
  [Chrome Web Store](https://chromewebstore.google.com/detail/ivelt-helper-v2/ahidenbhdkloaingggdcijofobjboopi),
  [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ivelt-helper-v2/hnklcnfpeamfiflmpnmjphigmbjoeknc)
  and the [GitHub release](https://github.com/chucem/ivelt-helper/releases/latest).
- Thank the contributors of this release in one block of mentions, using the forum's mention
  BBCode, so each of them gets a notification:
  `[smention u=12345]פארום נאמען[/smention]`. `u=` is the user's number on the forum (the
  `u=` in their profile link `memberlist.php?mode=viewprofile&u=…`), and the text is their
  forum name. A plain `@name` or bold text doesn't notify anyone. Forum names can differ from
  GitHub names. Ask the user for each contributor's name and number, never guess, and leave out
  anyone who doesn't want to be named.
- Where to report problems: the topic itself, or GitHub Issues.

Never post it yourself. The user posts it after the stores approve the update (step 5).

## 2. Drop the beta and merge into `master`
```bash
# on dev: the version is already the final one, so only version_name goes
sed -i '/"version_name":/d' extension/manifest.json
git commit -am "Release version X.Y.Z (drop the beta version_name)"

git checkout master
git merge --no-ff dev -m "Release X.Y.Z" -m "<one line: the main new things>"
git push origin dev master
git checkout dev
```
`master` must not have commits that `dev` doesn't (`git log dev..origin/master` is empty).
Otherwise, merge them into `dev` first and test.

## 3. Watch the release
```bash
gh run list --workflow release.yml --limit 1
gh run watch <id> --exit-status
gh release view vX.Y.Z
```
The release should have `ivelt-helper-X.Y.Z.zip` attached, and notes that start with the
"Like it?" header (`.github/release-header.md`), then the AI summary. If Gemini was busy and the
run failed, re-run the failed job. Or rewrite only the AI part later with
**Actions → Release notes → Run workflow**.

## 4. Update the store listings, then upload to both stores
First the listing, so it goes in with the same review:
- **Chrome Web Store:** the [developer dashboard](https://chrome.google.com/webstore/devconsole)
  → publisher **Ivelt Extension Developers** (a group publisher, not the personal one) →
  **iVelt Helper v2** → **Store listing**. Paste the description and replace the changed
  screenshots, then **Save draft**. Don't submit from there.
- **Edge Add-ons:** Partner Center → the extension → **Store listings**: the same description
  and screenshots.

The user does this by hand. Claude in Chrome can't read or control Chrome Web Store pages, and
the stores' APIs only upload the package. To help, copy the description to the clipboard
(`Get-Content -Raw -Encoding utf8 store-assets\store-description.txt | Set-Clipboard`) and open
the dashboard in the Chrome profile the user works in for this project. If you need to see the page, computer use can
take a screenshot of Chrome (read-only). Wait until the user says the listing is saved.

Then upload and submit to both stores:
```bash
gh workflow run store-upload.yml -f version=vX.Y.Z -f store=both -f submit=true
gh run list --workflow store-upload.yml --limit 1
gh run watch <id> --exit-status
```
In the log, the Chrome Web Store should end in `"state": "PENDING_REVIEW"` and Edge in
`Status: Succeeded` after "Submitting for review". Reviews take from hours to a few days.

## 5. After the stores approve
- The user posts `store-assets/forum-post.txt` on אייוועלט.
- Open PRs that waited for the release go to the next version. Their what's-new lines go under
  a new entry, never under a version that's already out.
- Start the next version on `dev`: set `version` to the next number and
  `version_name` to `<version>-beta.1`. That publishes the first test build.

## Rules
- Commit as `chucem <94487951+chucem@users.noreply.github.com>`, never under a personal name.
- "Release / deploy X.Y.Z" from the user covers steps 2–4 (merge, push, store upload). Show
  the user the what's-new entry, the store description, the video script and the forum post
  before the merge.
- Never post on the forum, and never click **Submit for review** in a store dashboard.
- If something fails, stop and say what failed, with the log lines. Don't work around a
  workflow by doing its steps by hand.
