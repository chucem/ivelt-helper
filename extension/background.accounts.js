// More than one account: keeps each saved account signed in and switches between them from the popup.
//
// The forum (phpBB) knows who is signed in from three cookies on ivelt.com: _u (the user's number,
// 1 for a guest), _sid (the session) and _k (the "remember me" key). Switching writes the other
// account's saved cookies back into the browser, the forum's server never hears of a switch.
//
// Things the forum does that this is built around (phpbb/session.php):
// - Signing in doesn't end the account's other sessions, but signing out (or the forum's sign-out
//   link) deletes that session and its key on the server. So adding an account only removes the
//   cookies here, it never signs out, and the saved account stays signed in.
// - A session ends after a while unused, then the forum signs in again with the key, and gives it
//   a new value right away, the old one stops working. So whenever the signed-in account's cookies
//   change they're saved again (the cookies listener below), and before switching away.
// - An account signed in without "remember me" has no key, it lasts only as long as its session.
//   One the forum doesn't take any more is marked expired, and the popup offers to sign in again.
//
// The saved accounts, with their cookies, are kept in the extension's own IndexedDB database, not in
// chrome.storage: the extension's scripts on the forum's pages can read chrome.storage, and every
// change there is sent to all of them. The database only the background and the popup's messages
// reach. It stays on this computer (never synced) and turning the setting off deletes it.

const ACCOUNT_COOKIE_PREFIX = 'phpbb3_sw7kk_';
const ACCOUNT_COOKIES = ['u', 'k', 'sid'].map(name => ACCOUNT_COOKIE_PREFIX + name);
const ACCOUNTS_DB = 'accounts'; // the database, with one store and one entry in it: the list
const ACCOUNTS_KEY = 'savedAccounts'; // where they were kept before, in chrome.storage.local
const ACCOUNT_ADD_KEY = 'accountAddUntil'; // session storage: the next account to sign in gets saved, until then
const ACCOUNT_ADD_TIME = 30 * 60 * 1000;
const SIGN_IN_NAME_KEY = 'accountSignInName'; // session storage: the name to fill in on the sign-in page, once
const SEEN_NAMES_KEY = 'seenAccountNames'; // session storage: the names forum pages showed, for accounts not saved yet
const PROFILE_CHECK_TIME = 24 * 60 * 60 * 1000; // the name and avatar are looked up again after a day
const AVATAR_MAX_BYTES = 200 * 1024;
const FORUM_URL = 'https://www.ivelt.com';
const ACCOUNT_CHECK_URL = 'https://www.ivelt.com/forum/ucp.php?i=ucp_notifications';

let accountSwitching = false; // the cookies change on purpose then, so they aren't saved midway
let accountCookiesTimeout;

async function isMultiAccountsOn(){
  const { multiAccounts } = await chrome.storage.local.get('multiAccounts');
  return multiAccounts === true;
}

// One step on the database's store, in a transaction of its own: what the step's request gave
function accountsStore(mode, step){
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(ACCOUNTS_DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(ACCOUNTS_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(ACCOUNTS_DB, mode);
      const request = step(transaction.objectStore(ACCOUNTS_DB));
      transaction.oncomplete = () => { db.close(); resolve(request.result); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

// Accounts saved by an earlier test build were in chrome.storage.local, they move over once
let accountsMoved;
function moveAccountsFromStorage(){
  accountsMoved = accountsMoved || (async () => {
    const { [ACCOUNTS_KEY]: old } = await chrome.storage.local.get(ACCOUNTS_KEY);
    if(old === undefined)
      return;
    if(old.length && !(await accountsStore('readonly', store => store.get('list'))))
      await accountsStore('readwrite', store => store.put(old, 'list'));
    await chrome.storage.local.remove(ACCOUNTS_KEY);
  })();
  return accountsMoved;
}

async function getSavedAccounts(){
  await moveAccountsFromStorage();
  return (await accountsStore('readonly', store => store.get('list'))) || [];
}

// Changes the list in one step of the database (read and written in the same transaction), so a
// change made meanwhile elsewhere (a forum page's name, a removal in the popup) isn't written over.
// change gets the list to change in place, and its answer is given back
async function updateSavedAccounts(change){
  await moveAccountsFromStorage();
  let answer;
  await accountsStore('readwrite', store => {
    const request = store.get('list');
    request.onsuccess = () => {
      const accounts = request.result || [];
      answer = change(accounts);
      store.put(accounts, 'list');
    };
    return request;
  });
  return answer;
}

function deleteSavedAccounts(){
  return accountsStore('readwrite', store => store.delete('list'));
}

// Whether the account was signed in with "remember me": only then is there a key in the _k cookie
function hasRememberKey(cookies){
  return (cookies || []).some(c => c.name === ACCOUNT_COOKIE_PREFIX + 'k' && c.value);
}

// For the popup's list: everything but the cookies, and whether they have the "remember me" key
async function listAccounts(){
  return { accounts: (await getSavedAccounts()).map(({ cookies, ...account }) => ({ ...account, remembered: hasRememberKey(cookies) })) };
}

// The signed-in account's number, '' for a guest or no cookie
async function signedInUserId(){
  const cookie = await chrome.cookies.get({ url: FORUM_URL, name: ACCOUNT_COOKIE_PREFIX + 'u' });
  return cookie && cookie.value !== '1' ? cookie.value : '';
}

// The forum's session cookies as they are now, with everything needed to write them back
async function readAccountCookies(){
  const cookies = await chrome.cookies.getAll({ domain: 'ivelt.com' });
  return cookies.filter(c => ACCOUNT_COOKIES.includes(c.name)).map(c => ({
    name: c.name, value: c.value, domain: c.domain, hostOnly: c.hostOnly, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate
  }));
}

function cookieUrl(cookie){
  return (cookie.secure ? 'https://' : 'http://') + cookie.domain.replace(/^\./, '') + cookie.path;
}

async function clearAccountCookies(){
  const current = await readAccountCookies();
  await Promise.all(current.map(c => chrome.cookies.remove({ url: cookieUrl(c), name: c.name })));
}

// Puts these cookies in place of the forum's session cookies now
async function writeAccountCookies(cookies){
  await clearAccountCookies();
  await Promise.all(cookies.map(c => chrome.cookies.set({
    url: cookieUrl(c), name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly,
    sameSite: c.sameSite, expirationDate: c.expirationDate,
    // a host-only cookie is set without a domain, or it would become one for every subdomain
    ...(c.hostOnly ? {} : { domain: c.domain })
  })));
}

// Asks the forum who's signed in with the cookies there are now: the user's number ('' for a guest),
// or null when the forum couldn't be reached (offline, Cloudflare's check). The answer can
// change the cookies, a new session or a new key
async function askForumWhoIsSignedIn(){
  try {
    const response = await fetch(ACCOUNT_CHECK_URL, { credentials: 'include', headers: { 'X-Requested-With': chrome.runtime.id } });
    if(!response.ok)
      return null;
    await response.text();
  } catch(e) {
    return null;
  }
  return signedInUserId();
}

function forumTabs(){
  return chrome.tabs.query({ url: '*://*.ivelt.com/*' });
}

// The forum's tabs a switch reloads, and the ones it leaves as they are (they get a bar saying so,
// js/accounts.js): one with a post being written (js/accounts.js tells) keeps its text, and with
// the setting "only the tab it's switched in" (switchReloadsOneTab) all but that one. kept: how many
// were left for a post being written. A tab that doesn't answer (opened before the extension was
// reloaded) is reloaded
async function tabsToReload(currentTabId){
  const tabs = await forumTabs();
  const unsent = await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id, { type: 'unsentPost' })
    .then(answer => !!(answer && answer.unsent), () => false)));
  const { switchReloadsOneTab } = await chrome.storage.local.get('switchReloadsOneTab');
  const reload = tabs.filter((tab, i) => !unsent[i] && (switchReloadsOneTab !== true || tab.id === currentTabId));
  return { reload, left: tabs.filter(tab => !reload.includes(tab)), kept: unsent.filter(Boolean).length };
}

// Tells the tabs that weren't reloaded that they still show the account that was signed in
function tellTabsLeft(tabs){
  tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'accountSwitched' }).catch(() => {}));
}

// The tab's address is opened again rather than reloaded: a page that came from a form (the page
// after signing in) would send it again, and the browser asks first. Opening the same address with
// a #part only scrolls, those get the browser's reload; a page from a form doesn't have one
function startReload(tab){
  if(!tab.url || tab.url.includes('#'))
    return chrome.tabs.reload(tab.id);
  return chrome.tabs.update(tab.id, { url: tab.url });
}

// Reloads a tab and waits till it's loaded (15 seconds at most)
function reloadTab(tab){
  return new Promise(resolve => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(loaded);
      clearTimeout(timeout);
      resolve();
    };
    const loaded = (tabId, change) => {
      if(tabId === tab.id && change.status === 'complete')
        done();
    };
    const timeout = setTimeout(done, 15000);
    chrome.tabs.onUpdated.addListener(loaded);
    startReload(tab).catch(done);
  });
}

// One tab first, the others once it's loaded: if the session is gone after all, tabs loading together
// would all sign in with the same key, the first one gets the new key and the rest become guests.
// The first one may be loaded already (the check after a switch)
async function reloadForumTabs(tabs, firstLoaded){
  const [first, ...rest] = tabs;
  if(!first)
    return;
  if(!firstLoaded)
    await reloadTab(first);
  rest.forEach(tab => startReload(tab).catch(() => {}));
}

// Saves the signed-in account's cookies, as a new account only when asked to (add)
async function saveSignedInAccount(add){
  const userId = await signedInUserId();
  if(!userId)
    return null;

  const cookies = await readAccountCookies();
  // the name a forum page showed before it was saved, the picture comes with the next page
  const { [SEEN_NAMES_KEY]: seenNames } = await chrome.storage.session.get(SEEN_NAMES_KEY);

  return updateSavedAccounts(accounts => {
    let account = accounts.find(a => a.userId === userId);
    if(!account){
      if(!add)
        return null;
      account = { userId, name: (seenNames || {})[userId] || '', avatar: '' };
      accounts.push(account);
    }
    Object.assign(account, { cookies, expired: false, savedAt: Date.now() });
    return account;
  });
}

// Signed out here only (the account stays signed in on the server), and the forum's sign-in page
// opens: the account that signs in there is saved too. With userId (a saved account that has to sign
// in again) its name waits in session storage for the sign-in page to ask (signInName), so only the
// password is left to type. Not in the address, which would keep it in the browser's history
async function startAddingAccount(userId){
  const again = userId && (await getSavedAccounts()).find(a => a.userId === userId);
  await chrome.storage.session.set({ [SIGN_IN_NAME_KEY]: again && again.name ? again.name : '' });
  if(await signedInUserId())
    await saveSignedInAccount(true);

  accountSwitching = true;
  try {
    await clearAccountCookies();
  } finally {
    accountSwitching = false;
  }
  await chrome.storage.session.set({ [ACCOUNT_ADD_KEY]: Date.now() + ACCOUNT_ADD_TIME });
  // the #part tells js/accounts.js to tick "remember me" there, without it the account lasts only as long as its session
  chrome.tabs.create({ url: 'https://www.ivelt.com/forum/ucp.php?mode=login#ih-add-account' });
}

// Gives { switched: true }, { expired: true } when the forum doesn't take the account's cookies
// any more (then the account that was signed in stays), or { unchecked: true } when the forum
// couldn't be asked, then it's switched anyway and the next page shows. With kept: the number of
// tabs left as they were, with a post being written.
// Who the forum takes it for is asked by the background first; Cloudflare answers that with its
// check page on the live forum, then the first forum tab is reloaded and the forum's cookie read
async function switchAccount(userId, currentTabId){
  const saved = (await getSavedAccounts()).find(a => a.userId === userId);
  if(!saved)
    return { error: 'unknown account' };

  accountSwitching = true;
  let before, firstTab;
  try {
    const beforeId = await signedInUserId();
    if(beforeId === userId)
      return { switched: true };

    // the one signed in now is saved with its newest key, also one that wasn't saved yet, so
    // switching away doesn't lose it
    before = await readAccountCookies();
    if(beforeId)
      await saveSignedInAccount(true);

    const { reload, left, kept } = await tabsToReload(currentTabId);
    await writeAccountCookies(saved.cookies || []);
    let nowId = await askForumWhoIsSignedIn();
    if(nowId === null){
      [firstTab] = reload;
      if(firstTab){
        await reloadTab(firstTab);
        nowId = await signedInUserId();
      }
    }

    if(nowId === null){
      reloadForumTabs(reload);
      tellTabsLeft(left);
      return { unchecked: true, kept };
    }

    if(nowId !== userId){
      await writeAccountCookies(before);
      await updateSavedAccounts(accounts => {
        const target = accounts.find(a => a.userId === userId);
        if(target)
          target.expired = true;
      });
      // the tab it was checked in shows the account that stays
      if(firstTab)
        reloadTab(firstTab);
      return { expired: true };
    }

    // the forum may have started a new session, with a new key
    const cookies = await readAccountCookies();
    await updateSavedAccounts(accounts => {
      const target = accounts.find(a => a.userId === userId);
      if(target)
        Object.assign(target, { cookies, expired: false, savedAt: Date.now() });
    });
    reloadForumTabs(reload, !!firstTab);
    tellTabsLeft(left);
    return { switched: true, kept };
  } catch(e) {
    // whatever went wrong, the account that was signed in is put back
    if(before)
      await writeAccountCookies(before).catch(() => {});
    throw e;
  } finally {
    accountSwitching = false;
  }
}

function forgetAccount(userId){
  return updateSavedAccounts(accounts => {
    const index = accounts.findIndex(a => a.userId === userId);
    if(index >= 0)
      accounts.splice(index, 1);
  });
}

// A forum page is signed in (js/accounts.js): when the saved account's name and avatar are due to be
// looked up (never yet, or a day ago), the page is asked to, with the account's number. Only the
// forum's pages can: the background's own requests get Cloudflare's check page (403)
async function accountSeen(request){
  const userId = await signedInUserId();
  const account = userId && (await getSavedAccounts()).find(a => a.userId === userId);
  if(userId && !account && request.name){
    const { [SEEN_NAMES_KEY]: seenNames } = await chrome.storage.session.get(SEEN_NAMES_KEY);
    await chrome.storage.session.set({ [SEEN_NAMES_KEY]: { ...seenNames, [userId]: String(request.name).trim().slice(0, 100) } });
  }
  if(!account)
    return {};
  // the account's own profile page has them right there, the popup links to it when the name is missing
  const ownProfile = request.profileOf === userId;
  if(!ownProfile && (account.profileCheckedAt > Date.now() - PROFILE_CHECK_TIME || lookUpAsked.get(userId) > Date.now() - 10 * 60 * 1000))
    return {};
  // one page at a time: if its lookup fails, the next page after a while tries again
  lookUpAsked.set(userId, Date.now());
  return { lookUp: userId };
}

const lookUpAsked = new Map();

// The forum's sign-in page that "add an account" opened asks for the name to fill in: given once, to
// a page that's signed out, while an account is being added
async function signInName(){
  const items = await chrome.storage.session.get([SIGN_IN_NAME_KEY, ACCOUNT_ADD_KEY]);
  const name = items[SIGN_IN_NAME_KEY];
  if(!name || !(items[ACCOUNT_ADD_KEY] > Date.now()) || await signedInUserId())
    return {};
  await chrome.storage.session.remove(SIGN_IN_NAME_KEY);
  return { name };
}

// What the page found on the profile page: kept only for the account that is signed in, and only
// a picture as data (not an address the popup would load)
async function accountProfile(request){
  const userId = await signedInUserId();
  if(!userId || request.userId !== userId)
    return;
  const avatar = typeof request.avatar === 'string' && request.avatar.length <= AVATAR_MAX_BYTES * 1.4 &&
    /^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(request.avatar) ? request.avatar : '';
  const avatarUrl = /^https:\/\/([\w-]+\.)*ivelt\.com\//.test(request.avatarUrl) ? request.avatarUrl : '';

  await updateSavedAccounts(accounts => {
    const account = accounts.find(a => a.userId === userId);
    if(!account)
      return;
    // a picture that has an address but couldn't be downloaded keeps the one there is, and without
    // one it's tried again on a later page
    const pictureMissing = avatarUrl && !avatar;
    Object.assign(account, {
      name: String(request.name || '').trim().slice(0, 100) || account.name,
      avatarUrl,
      avatar: pictureMissing ? account.avatar || '' : avatar,
      ...(pictureMissing && !account.avatar ? {} : { profileCheckedAt: Date.now() })
    });
  });
}

// The signed-in account's cookies changed: a new session or key is saved again, and while adding,
// the account that just signed in is saved
async function accountCookiesChanged(){
  if(accountSwitching || !(await isMultiAccountsOn()))
    return;

  const items = await chrome.storage.session.get(ACCOUNT_ADD_KEY);
  const adding = items[ACCOUNT_ADD_KEY] > Date.now();
  const saved = await saveSignedInAccount(adding);
  if(saved && adding)
    await chrome.storage.session.remove(ACCOUNT_ADD_KEY);
}

chrome.cookies.onChanged.addListener(({ cookie }) => {
  if(!ACCOUNT_COOKIES.includes(cookie.name) || !/(^|\.)ivelt\.com$/.test(cookie.domain))
    return;
  // the three cookies come together
  clearTimeout(accountCookiesTimeout);
  accountCookiesTimeout = setTimeout(accountCookiesChanged, 500);
});

chrome.storage.onChanged.addListener((changes, area) => {
  // turned off: the saved cookies go
  if(area === 'local' && changes.multiAccounts && changes.multiAccounts.newValue !== true){
    deleteSavedAccounts();
    chrome.storage.local.remove(ACCOUNTS_KEY);
    chrome.storage.session.remove([ACCOUNT_ADD_KEY, SEEN_NAMES_KEY, SIGN_IN_NAME_KEY]);
  }
});

// The forum's pages only tell what they see (js/accounts.js); only the extension's own pages (the
// popup) may ask for the rest
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  const fromForumPage = sender.id === chrome.runtime.id && /^https:\/\/([\w-]+\.)*ivelt\.com\//.test(sender.url || '');
  const forumActions = { accountSeen, accountProfile, signInName };
  if(fromForumPage && forumActions[request.type]){
    isMultiAccountsOn()
      .then(on => on || request.type !== 'signInName' ? forumActions[request.type](request) : {})
      .then(answer => sendResponse(answer || {}), () => sendResponse({}));
    return true;
  }

  const fromExtensionPage = sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));
  const actions = {
    listAccounts: () => listAccounts(),
    addAccount: () => startAddingAccount(request.userId ? String(request.userId) : ''),
    saveAccount: () => saveSignedInAccount(true),
    switchAccount: () => switchAccount(String(request.userId), request.tabId),
    forgetAccount: () => forgetAccount(String(request.userId))
  };
  if(!fromExtensionPage || !actions[request.type])
    return;

  isMultiAccountsOn()
    .then(on => on ? actions[request.type]() : { error: 'off' })
    .then(result => sendResponse(result || {}))
    .catch(e => sendResponse({ error: e.message }));
  return true;
});
