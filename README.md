[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/ahidenbhdkloaingggdcijofobjboopi?label=Chrome%20Web%20Store%20Version&style=flat-square&color=66bb6a)](https://chromewebstore.google.com/detail/ivelt-helper-v2/ahidenbhdkloaingggdcijofobjboopi)
[![Edge Add-ons](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fmicrosoftedge.microsoft.com%2Faddons%2Fgetproductdetailsbycrxid%2Fhnklcnfpeamfiflmpnmjphigmbjoeknc&query=%24.version&prefix=v&label=Edge%20Add-ons%20Version&style=flat-square&color=0078d4)](https://microsoftedge.microsoft.com/addons/detail/ivelt-helper-v2/hnklcnfpeamfiflmpnmjphigmbjoeknc)
[![GitHub release (latest by date)](https://img.shields.io/github/v/release/chucem/ivelt-helper?label=GitHub%20Release%20Version&style=flat-square&color=42a5f5)](https://github.com/chucem/ivelt-helper/releases/latest/)
![Chrome Web Store](https://img.shields.io/chrome-web-store/users/ahidenbhdkloaingggdcijofobjboopi?label=Users&style=flat-square&color=9575cd)

**English** | [אידיש](README.yi.md)

# iVelt Helper v2
A Chrome extension that adds shortcuts, notifications and other usability improvements to the [אייוועלט](https://www.ivelt.com/forum/) forum.

Most features can be turned on or off on the extension's settings page (right-click the toolbar icon → **Options**).

## Features

### Keyboard shortcuts
| Keys | Action |
| --- | --- |
| <kbd>→</kbd> / <kbd>←</kbd> | Previous / next page in a topic |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Jump to the top / bottom of the page (can be turned off) |
| <kbd>Ctrl</kbd>+<kbd>Enter</kbd> | Submit the post |
| <kbd>Alt</kbd>+<kbd>v</kbd> | Preview the post (quick reply and full editor) |
| <kbd>Alt</kbd>+<kbd>a</kbd> | Go to אקטיווע אשכולות (active topics) |
| <kbd>Alt</kbd>+<kbd>n</kbd> | Open the notifications list |
| <kbd>Alt</kbd>+<kbd>m</kbd> | Open the next unread notification |

### Post buttons
Extra buttons next to the regular quote button on every post:
* **Quote last only** – for posts with nested quotes, quote just the last reply.
* **Quote a selection** – select some words in a post and that post's ציטיר button turns into "ציטיר אנגעצייכנט" (with another icon); clicking it adds just those words as a quote, where your cursor is in the reply. Optionally it then jumps down to the reply box, ready to type after the quote.
* **Mention** (דערמאן) – insert an empty quote so the poster gets a notification (optionally copies it to the clipboard instead).
* **Quote in another topic** – copy the post as a quote (with a source link and, optionally, its images) to paste in a different topic.
* **Who liked** – a small arrow on the like button opens the list of who liked the post, each name a link to their profile.
* **Quote in the comments topic** – for topics that have a linked קאמענטארן topic, open a reply there with the post already quoted.
* **Copy post link** – a plain click on the small post icon next to the author's name copies the post's link instead of opening it. Right-click and long-press work as before.
* **Profile card** – resting the mouse on a username (an author, a name in a quote, a mention) opens a card with everything their profile shows: avatar, online, rank, profile fields, contact links, statistics and signature. The mouse can move into the card to use its links.
* **Double-click to like** – double-clicking a post (not on its words) likes it, with a small 👍 where you clicked. It never takes a like away. Off by default; turn it on in the settings.
* Option to keep the post buttons visible while scrolling through a long post.

### Notifications
* Toolbar badge with your unread notification count, and optional browser notifications, even when אייוועלט isn't open.
* Alert when new replies arrive in the topic you're reading, with a reload button.
* Separate notification bells for quotes, thanks and mentions (ציטירט / באדאנקט / דערמאנט), grouped together, with a grey "+N" for older unread notifications that aren't in the bells.
* Button to hide read notifications on the notifications page.
* Confirmation before "mark all as read", so it isn't clicked by accident.
* A mention (@name) in a post links to that user's profile.

### Writing posts
* Warning before leaving a page with an unsent post.
* **Drafts**: what you type in the reply box (quick reply or full editor) is kept as you type, so a crash or a closed tab doesn't lose it; the next time the same reply box opens, a bar shows when it was kept and its first lines, and offers to bring it back. Only sending the post drops the draft.
* **Image Resizer** on the post editor: images that are too big for an attachment are shrunk automatically, whether they are picked, dropped or pasted.
* **Paste images** straight into a post (like in Gmail): the image is attached and placed inline where you pasted it. This is a separate setting, so pasting can be on with the resizer off.
* Pack a whole folder into a single ZIP attachment (drop it on the editor, or use the **Folder → ZIP** button).
* **Google Drive / Dropbox upload**: shows which account it will use, then uploads files to a folder in your own Google Drive (or `Apps/iVelt Helper` in your Dropbox), makes them viewable by anyone with the link, and inserts the link into the post. It works in private messages too. Files can be dragged straight onto the Google Drive / Dropbox button, and optionally a video dragged into the post goes there too (in a private message, pictures as well). Dropbox is a separate setting.
* **Undo and redo** while writing (<kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd>), also after the BBCode buttons, with two buttons at the top of the editor (can be turned off).
* The editor opens on the **Attachments** tab instead of **Options**, so adding a file is one click (can be turned off).

### Reading posts
* **Spoiler polish**: the spoiled words are covered with moving dust right where they are (so a couple of spoiled words stay in the middle of their line), and pictures are blurred with sparkling dots over them. A long spoiler shows only its first three lines. One click reveals it and opens it to its full height. Printed spoilers come out open. Off by default; turn it on in the settings.

### Color themes
* 16 light and dark color themes for the forum, which the toolbar popup and the settings page follow too. Pick one in the **Colors** tab of the settings.
* Make your own theme from any of them, and share it: copy its colors, or paste colors someone else shared.

### Settings
* Keep the settings and colors the same on all your computers, through the browser's sync (Google Drive / Dropbox accounts stay on each computer).
* The settings page shows the extension's version, where it was installed from (Chrome Web Store, Edge Add-ons or GitHub), and whether a newer version is out.
* A button to reset all the settings.

### Other
* Google search within the current topic, or across the whole site.
* **Titles open the first unread post**: in a list of topics, clicking the title of a topic with unread posts opens it at the first unread post instead of the first page (can be turned off).
* Print several pages, or a whole topic, at once (forked from [bookmarkify.it/47839](https://bookmarkify.it/47839)). Optionally with who liked each post, or only how many.
* Toolbar popup with quick links (home page, inbox, active topics), quick sign-in, and emergency sign-out. Optionally, the quick links open in the current tab when it's already on the forum.

## Install from the Chrome Web Store
1. Open the **[Chrome Web Store](https://chromewebstore.google.com/detail/ivelt-helper-v2/ahidenbhdkloaingggdcijofobjboopi)** page.
   <sub>Using Microsoft Edge? Install from **[Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ivelt-helper-v2/hnklcnfpeamfiflmpnmjphigmbjoeknc)** instead.</sub>
2. Click **Add to Chrome** and confirm **Add extension**.
3. Pin **iVelt Helper** to the toolbar so you can see the notification badge.

## Install from GitHub (manual install)
1. Download **ivelt-helper-x.x.x.zip** from the _Assets_ of the latest release on the **[Releases page](https://github.com/chucem/ivelt-helper/releases/latest/)**.
2. Extract it to an **ivelt-helper-x.x.x** folder and move it somewhere permanent. Chrome runs the extension from this folder, so it has to stay in the same place.
3. Open `chrome://extensions/`.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked**, select the **ivelt-helper-x.x.x** folder, and click **Select Folder**.

## Building
`build.bat` zips the `extension` folder into `dist/ivelt-helper-<version>.zip` (requires [7-Zip](https://www.7-zip.org/) on the `PATH`).

## Releasing
1. Bump `version` in `extension/manifest.json` and merge it to `master`. The [Release workflow](.github/workflows/release.yml) then tags the merge as `v<version>`, builds the zip and creates the GitHub release with it attached.
2. To publish to the stores, go to **Actions → Store upload → Run workflow**, pick the release (blank = latest) and the store. The [Store upload workflow](.github/workflows/store-upload.yml) uploads that release's zip and, unless you uncheck it, submits it for review.

The store upload needs these repository secrets: `CWS_SERVICE_ACCOUNT_KEY` (a Google Cloud service account JSON key) and `CWS_PUBLISHER_ID` for the Chrome Web Store, and `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, `EDGE_API_KEY` for Edge Add-ons.

## Website and privacy policy
The extension's [website](https://ivelthelper.com/) and [privacy policy](https://ivelthelper.com/privacy.html) live in the [chucem.github.io](https://github.com/chucem/chucem.github.io) repo.

## Credits
Made by members of אייוועלט; the full list is on the extension's settings page.
