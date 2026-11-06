// Google Drive upload support
//
// Sign-in uses chrome.identity.launchWebAuthFlow with a "Web application" OAuth
// client, so it works without signing in to the browser itself (and in Edge too),
// and the user always picks the Google account explicitly. The chosen account is
// remembered so the post editor can show where files are going before uploading.
//
// The content script (js/driveUpload.js) asks the background for a token and the
// upload folder, then uploads the file itself (a File can't go through messaging).
//
// Uses the drive.file scope: the extension only ever sees files and folders it
// created itself, never the rest of the user's Drive.

// "Web application" OAuth client. Its authorized redirect URIs must include
// https://<extension id>.chromiumapp.org/ for every store the extension ships in.
const DRIVE_CLIENT_ID = '403521975867-14ivsv9bg2pnf0jg07f5p9f1begki6sl.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_DEFAULT_FOLDER = 'iVelt Helper';
const DRIVE_TOKEN_KEY = 'driveToken';     // chrome.storage.session: { token, expiresAt }
const DRIVE_ACCOUNT_KEY = 'driveAccount'; // chrome.storage.local: { email, name, photo }

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

function buildAuthUrl({ selectAccount, silent, email }, state) {
  const params = new URLSearchParams({
    client_id: DRIVE_CLIENT_ID,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: DRIVE_SCOPE,
    state
  });
  if (selectAccount) params.set('prompt', 'select_account');
  else if (silent) params.set('prompt', 'none');
  if (email && !selectAccount) params.set('login_hint', email);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

async function runAuthFlow(options) {
  const interactive = !options.silent;
  // a new random state for each sign-in, which Google sends back: an answer without it isn't to this request
  const state = crypto.randomUUID();
  const flow = { url: buildAuthUrl(options, state), interactive };
  if (!interactive) {
    // Google answers prompt=none through a few redirects, give it time to land
    flow.abortOnLoadForNonInteractive = false;
    flow.timeoutMsForNonInteractive = 8000;
  }

  const redirect = await chrome.identity.launchWebAuthFlow(flow);
  const result = new URLSearchParams(new URL(redirect).hash.slice(1));
  if (result.get('error')) throw new Error('Google sign-in: ' + result.get('error'));
  if (result.get('state') !== state) throw new Error('Google sign-in: the answer is not for this sign-in');

  const token = result.get('access_token');
  if (!token) throw new Error('Google sign-in did not return a token');

  const expiresIn = parseInt(result.get('expires_in'), 10) || 3600;
  const entry = { token, expiresAt: Date.now() + expiresIn * 1000 };
  await chrome.storage.session.set({ [DRIVE_TOKEN_KEY]: entry });
  return token;
}

async function fetchAccount(token) {
  const about = await driveFetch(token, `${DRIVE_API}/about?fields=user(displayName,emailAddress,photoLink)`);
  const user = about.user || {};
  return { email: user.emailAddress || '', name: user.displayName || '', photo: user.photoLink || '' };
}

async function getAccount() {
  const items = await chrome.storage.local.get(DRIVE_ACCOUNT_KEY);
  return items[DRIVE_ACCOUNT_KEY] || null;
}

// Always shows Google's account picker, so the user consciously chooses
async function connectAccount() {
  const token = await runAuthFlow({ selectAccount: true });
  const account = await fetchAccount(token);
  await chrome.storage.local.set({ [DRIVE_ACCOUNT_KEY]: account });
  return account;
}

async function disconnectAccount() {
  const items = await chrome.storage.session.get(DRIVE_TOKEN_KEY);
  const entry = items[DRIVE_TOKEN_KEY];
  if (entry && entry.token) {
    // Best effort - the user can also remove access at myaccount.google.com
    fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(entry.token), { method: 'POST' }).catch(() => {});
  }
  await chrome.storage.session.remove(DRIVE_TOKEN_KEY);
  await chrome.storage.local.remove([DRIVE_ACCOUNT_KEY, 'driveFolder']);
}

// A valid token for the connected account: cached, renewed silently, or
// (as a last resort, since the user just clicked) through the sign-in window.
// With silentOnly it never opens a window and just fails instead.
async function getToken(account, staleToken, silentOnly) {
  const items = await chrome.storage.session.get(DRIVE_TOKEN_KEY);
  const cached = items[DRIVE_TOKEN_KEY];
  if (cached && cached.token !== staleToken && cached.expiresAt - 60000 > Date.now()) return cached.token;

  let token;
  try {
    token = await runAuthFlow({ silent: true, email: account.email });
  } catch (err) {
    if (silentOnly) throw err;
    token = await runAuthFlow({ email: account.email });
  }

  // Google may hand back a different account than the one shown in the editor -
  // never upload there silently
  const actual = await fetchAccount(token);
  if (actual.email.toLowerCase() !== account.email.toLowerCase()) {
    await chrome.storage.session.remove(DRIVE_TOKEN_KEY);
    const error = new Error(`Google signed in as ${actual.email} instead of ${account.email}. Nothing was uploaded.`);
    error.code = 'account_mismatch';
    throw error;
  }
  return token;
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------

async function driveFetch(token, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!response.ok) {
    const error = new Error(`Google Drive error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

// Returns the ID of the upload folder, creating it when it doesn't exist (or was deleted)
async function ensureDriveFolder(token, name, account) {
  const { driveFolder } = await chrome.storage.local.get('driveFolder');

  if (driveFolder && driveFolder.name === name && driveFolder.email === account.email) {
    try {
      const folder = await driveFetch(token, `${DRIVE_API}/files/${driveFolder.id}?fields=id,trashed`);
      if (!folder.trashed) return folder.id;
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  const query = `mimeType='${DRIVE_FOLDER_MIME}' and name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}' and trashed=false`;
  const list = await driveFetch(token, `${DRIVE_API}/files?fields=files(id)&q=${encodeURIComponent(query)}`);
  let id = list.files && list.files.length ? list.files[0].id : null;

  if (!id) {
    const created = await driveFetch(token, `${DRIVE_API}/files?fields=id`, {
      method: 'POST',
      body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME })
    });
    id = created.id;
  }

  await chrome.storage.local.set({ driveFolder: { id, name, email: account.email } });
  return id;
}

// Storage used / total for the connected account. Only ever signs in silently -
// it's informational, so it must never pop up a Google window on its own.
async function getDriveQuota() {
  const account = await getAccount();
  if (!account) return { quota: null };

  const token = await getToken(account, null, true);
  const about = await driveFetch(token, `${DRIVE_API}/about?fields=storageQuota(limit,usage)`);
  const quota = about.storageQuota || {};
  return {
    quota: {
      usage: Number(quota.usage || 0),
      limit: quota.limit ? Number(quota.limit) : null // no limit on some Workspace accounts
    }
  };
}

async function getDriveUploadTarget(staleToken) {
  const account = await getAccount();
  if (!account) {
    const error = new Error('No Google account is connected');
    error.code = 'not_connected';
    throw error;
  }

  const { driveFolderName } = await chrome.storage.local.get('driveFolderName');
  const name = (driveFolderName || '').trim() || DRIVE_DEFAULT_FOLDER;

  let token = await getToken(account, staleToken);
  try {
    return { token, account, folderId: await ensureDriveFolder(token, name, account) };
  } catch (err) {
    if (err.status !== 401) throw err;
    // Token was revoked behind our back - get a fresh one and try once more
    token = await getToken(account, token);
    return { token, account, folderId: await ensureDriveFolder(token, name, account) };
  }
}

// ---------------------------------------------------------------------------
// Messages from the post editor
// ---------------------------------------------------------------------------

const driveHandlers = {
  driveAccount: () => getAccount().then(account => ({ account })),
  driveConnect: () => connectAccount().then(account => ({ account })),
  driveDisconnect: () => disconnectAccount().then(() => ({ account: null })),
  driveQuota: () => getDriveQuota(),
  driveUploadTarget: (request) => getDriveUploadTarget(request.staleToken)
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = driveHandlers[request.type];
  if (!handler) return;

  handler(request)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message, code: err.code }));
  return true; // keep the channel open for the async response
});
