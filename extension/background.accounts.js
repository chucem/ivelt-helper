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
// The saved cookies are kept in chrome.storage.local only (never synced, and never put on the
// forum's page). Turning the setting off deletes them.

const ACCOUNT_COOKIE_PREFIX = 'phpbb3_sw7kk_';
const ACCOUNT_COOKIES = ['u', 'k', 'sid'].map(name => ACCOUNT_COOKIE_PREFIX + name);
const ACCOUNTS_KEY = 'savedAccounts';
const ACCOUNT_ADD_KEY = 'accountAddUntil'; // session storage: the next account to sign in gets saved, until then
const ACCOUNT_ADD_TIME = 30 * 60 * 1000;
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

async function getSavedAccounts(){
  const items = await chrome.storage.local.get(ACCOUNTS_KEY);
  return items[ACCOUNTS_KEY] || [];
}

function setSavedAccounts(accounts){
  return chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
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

// One tab first, the others once it's loaded: if the session is gone after all, tabs loading together
// would all sign in with the same key, the first one gets the new key and the rest become guests
async function reloadForumTabs(){
  const [first, ...rest] = await chrome.tabs.query({ url: '*://*.ivelt.com/*' });
  if(!first)
    return;

  await new Promise(resolve => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(loaded);
      clearTimeout(timeout);
      resolve();
    };
    const loaded = (tabId, change) => {
      if(tabId === first.id && change.status === 'complete')
        done();
    };
    const timeout = setTimeout(done, 15000);
    chrome.tabs.onUpdated.addListener(loaded);
    chrome.tabs.reload(first.id).catch(done);
  });
  rest.forEach(tab => chrome.tabs.reload(tab.id));
}

// Saves the signed-in account's cookies, as a new account only when asked to (add)
async function saveSignedInAccount(add){
  const userId = await signedInUserId();
  if(!userId)
    return null;

  const accounts = await getSavedAccounts();
  let account = accounts.find(a => a.userId === userId);
  if(!account){
    if(!add)
      return null;
    // the name a forum page showed before it was saved, the picture comes with the next page
    const { [SEEN_NAMES_KEY]: seenNames } = await chrome.storage.session.get(SEEN_NAMES_KEY);
    account = { userId, name: (seenNames || {})[userId] || '', avatar: '' };
    accounts.push(account);
  }
  account.cookies = await readAccountCookies();
  account.expired = false;
  account.savedAt = Date.now();
  await setSavedAccounts(accounts);
  return account;
}

// Signed out here only (the account stays signed in on the server), and the forum's sign-in page
// opens: the account that signs in there is saved too
async function startAddingAccount(){
  if(await signedInUserId())
    await saveSignedInAccount(true);

  accountSwitching = true;
  try {
    await clearAccountCookies();
  } finally {
    accountSwitching = false;
  }
  await chrome.storage.session.set({ [ACCOUNT_ADD_KEY]: Date.now() + ACCOUNT_ADD_TIME });
  chrome.tabs.create({ url: 'https://www.ivelt.com/forum/ucp.php?mode=login' });
}

// Gives { switched: true }, { expired: true } when the forum doesn't take the account's cookies
// any more (then the account that was signed in stays), or { unchecked: true } when the forum
// couldn't be asked, then it's switched anyway and the next page shows
async function switchAccount(userId){
  if(!(await getSavedAccounts()).some(a => a.userId === userId))
    return { error: 'unknown account' };

  accountSwitching = true;
  try {
    const beforeId = await signedInUserId();
    if(beforeId === userId)
      return { switched: true };

    // the one signed in now is saved with its newest key, also one that wasn't saved yet, so
    // switching away doesn't lose it
    const before = await readAccountCookies();
    if(beforeId)
      await saveSignedInAccount(true);
    const accounts = await getSavedAccounts();
    const target = accounts.find(a => a.userId === userId);

    await writeAccountCookies(target.cookies || []);
    const nowId = await askForumWhoIsSignedIn();

    if(nowId === null){
      await setSavedAccounts(accounts);
      reloadForumTabs();
      return { unchecked: true };
    }

    if(nowId !== userId){
      target.expired = true;
      await writeAccountCookies(before);
      await setSavedAccounts(accounts);
      return { expired: true };
    }

    // the forum may have started a new session, with a new key
    target.cookies = await readAccountCookies();
    target.expired = false;
    target.savedAt = Date.now();
    await setSavedAccounts(accounts);
    reloadForumTabs();
    return { switched: true };
  } finally {
    accountSwitching = false;
  }
}

async function forgetAccount(userId){
  const accounts = await getSavedAccounts();
  await setSavedAccounts(accounts.filter(a => a.userId !== userId));
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

// What the page found on the profile page: kept only for the account that is signed in, and only
// a picture as data (not an address the popup would load)
async function accountProfile(request){
  const userId = await signedInUserId();
  if(!userId || request.userId !== userId)
    return;
  const avatar = typeof request.avatar === 'string' && request.avatar.length <= AVATAR_MAX_BYTES * 1.4 &&
    /^data:image\/(png|jpeg|gif|webp);base64,[\w+/=]+$/.test(request.avatar) ? request.avatar : '';

  const accounts = await getSavedAccounts();
  const account = accounts.find(a => a.userId === userId);
  if(!account)
    return;
  Object.assign(account, {
    name: String(request.name || '').trim().slice(0, 100) || account.name,
    avatarUrl: /^https:\/\/([\w-]+\.)*ivelt\.com\//.test(request.avatarUrl) ? request.avatarUrl : '',
    avatar,
    profileCheckedAt: Date.now()
  });
  await setSavedAccounts(accounts);
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
    chrome.storage.local.remove(ACCOUNTS_KEY);
    chrome.storage.session.remove([ACCOUNT_ADD_KEY, SEEN_NAMES_KEY]);
  }
});

// The forum's pages only tell what they see (js/accounts.js); only the extension's own pages (the
// popup) may ask for the rest
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  const fromForumPage = sender.id === chrome.runtime.id && /^https:\/\/([\w-]+\.)*ivelt\.com\//.test(sender.url || '');
  if(fromForumPage && (request.type === 'accountSeen' || request.type === 'accountProfile')){
    (request.type === 'accountSeen' ? accountSeen(request) : accountProfile(request))
      .then(answer => sendResponse(answer || {}), () => sendResponse({}));
    return true;
  }

  const fromExtensionPage = sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));
  const actions = {
    addAccount: () => startAddingAccount(),
    saveAccount: () => saveSignedInAccount(true),
    switchAccount: () => switchAccount(String(request.userId)),
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
