// Dropbox upload support
//
// Sign-in uses chrome.identity.launchWebAuthFlow with OAuth 2 + PKCE, so no app
// secret is needed. Dropbox hands out a long-lived refresh token, so after the
// first sign-in short-lived access tokens are renewed without ever showing a
// window again. The connected account is remembered so the post editor can show
// where files are going before uploading.
//
// The app uses Dropbox's "App folder" access: it only sees its own folder
// (Apps/<app folder name>), never the rest of the user's Dropbox.
//
// The content script (js/driveUpload.js) asks the background for a token and then
// uploads the file itself (a File can't go through extension messaging).

// Dropbox App Console: the redirect URIs must include
// https://<extension id>.chromiumapp.org/ for every store the extension ships in.
const DROPBOX_APP_KEY = 'ftcvnf4s6jhnetx';

// Asked for explicitly, so a connection always carries all of them. Each one must
// also be ticked on the app's Permissions tab in the Dropbox App Console.
const DROPBOX_SCOPES = 'account_info.read files.content.write sharing.read sharing.write';

const DROPBOX_API = 'https://api.dropboxapi.com';
const DROPBOX_AUTH_KEY = 'dropboxAuth';       // chrome.storage.local: { refreshToken }
const DROPBOX_TOKEN_KEY = 'dropboxToken';     // chrome.storage.session: { token, expiresAt }
const DROPBOX_ACCOUNT_KEY = 'dropboxAccount'; // chrome.storage.local: { email, name, photo }

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

function base64Url(bytes) {
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePkcePair() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function dropboxTokenRequest(fields) {
  const response = await fetch(`${DROPBOX_API}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: DROPBOX_APP_KEY, ...fields })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    const error = new Error('Dropbox sign-in: ' + (result.error_description || result.error || response.status));
    error.code = result.error;
    throw error;
  }
  return result;
}

async function saveDropboxAccess(result) {
  const entry = { token: result.access_token, expiresAt: Date.now() + (result.expires_in || 14400) * 1000 };
  await chrome.storage.session.set({ [DROPBOX_TOKEN_KEY]: entry });
  return entry.token;
}

// Always shows Dropbox's own page with the account on it; "switch account"
// also forces a fresh login, so the user consciously chooses
async function dropboxConnect(switchAccount, tabId) {
  const { verifier, challenge } = await makePkcePair();
  const redirectUri = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    scope: DROPBOX_SCOPES,
    force_reapprove: 'true'
  });
  if (switchAccount) params.set('force_reauthentication', 'true');

  const redirect = await launchAuthFlow({
    url: 'https://www.dropbox.com/oauth2/authorize?' + params.toString(),
    interactive: true
  }, tabId);
  const answer = new URL(redirect).searchParams;
  if (answer.get('error')) throw new Error('Dropbox sign-in: ' + (answer.get('error_description') || answer.get('error')));
  const code = answer.get('code');
  if (!code) throw new Error('Dropbox sign-in did not return a code');

  const result = await dropboxTokenRequest({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri
  });
  await chrome.storage.local.set({ [DROPBOX_AUTH_KEY]: { refreshToken: result.refresh_token } });
  const token = await saveDropboxAccess(result);

  const account = await fetchDropboxAccount(token);
  await chrome.storage.local.set({ [DROPBOX_ACCOUNT_KEY]: account });
  return account;
}

async function dropboxDisconnect() {
  const items = await chrome.storage.session.get(DROPBOX_TOKEN_KEY);
  const entry = items[DROPBOX_TOKEN_KEY];
  if (entry && entry.token) {
    // Best effort - the user can also remove access in their Dropbox settings
    fetch(`${DROPBOX_API}/2/auth/token/revoke`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + entry.token }
    }).catch(() => {});
  }
  await chrome.storage.session.remove(DROPBOX_TOKEN_KEY);
  await chrome.storage.local.remove([DROPBOX_AUTH_KEY, DROPBOX_ACCOUNT_KEY]);
}

async function getDropboxAccount() {
  const items = await chrome.storage.local.get(DROPBOX_ACCOUNT_KEY);
  return items[DROPBOX_ACCOUNT_KEY] || null;
}

// A valid access token: cached, or renewed with the refresh token (never a window)
async function getDropboxToken(staleToken) {
  const session = await chrome.storage.session.get(DROPBOX_TOKEN_KEY);
  const cached = session[DROPBOX_TOKEN_KEY];
  if (cached && cached.token !== staleToken && cached.expiresAt - 60000 > Date.now()) return cached.token;

  const local = await chrome.storage.local.get([DROPBOX_AUTH_KEY, DROPBOX_ACCOUNT_KEY]);
  const auth = local[DROPBOX_AUTH_KEY];
  if (!auth || !auth.refreshToken || !local[DROPBOX_ACCOUNT_KEY]) {
    const error = new Error('No Dropbox account is connected');
    error.code = 'not_connected';
    throw error;
  }

  try {
    return await saveDropboxAccess(await dropboxTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken
    }));
  } catch (err) {
    if (err.code !== 'invalid_grant') throw err;
    // Access was removed on Dropbox's side - start over
    await chrome.storage.local.remove([DROPBOX_AUTH_KEY, DROPBOX_ACCOUNT_KEY]);
    const error = new Error('The Dropbox connection was removed. Please connect again.');
    error.code = 'not_connected';
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Dropbox API
// ---------------------------------------------------------------------------

async function dropboxRpc(token, endpoint, body) {
  const response = await fetch(`${DROPBOX_API}/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body === undefined ? null : body)
  });
  if (!response.ok) {
    const error = new Error(`Dropbox error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchDropboxAccount(token) {
  const user = await dropboxRpc(token, 'users/get_current_account');
  return {
    email: user.email || '',
    name: (user.name && user.name.display_name) || '',
    photo: user.profile_photo_url || ''
  };
}

async function getDropboxQuota() {
  if (!(await getDropboxAccount())) return { quota: null };
  const usage = await dropboxRpc(await getDropboxToken(), 'users/get_space_usage');
  const allocated = usage.allocation && usage.allocation.allocated;
  return { quota: { usage: Number(usage.used || 0), limit: allocated ? Number(allocated) : null } };
}

async function getDropboxUploadTarget(staleToken) {
  const account = await getDropboxAccount();
  if (!account) {
    const error = new Error('No Dropbox account is connected');
    error.code = 'not_connected';
    throw error;
  }
  return { token: await getDropboxToken(staleToken), account };
}

// ---------------------------------------------------------------------------
// Messages from the post editor
// ---------------------------------------------------------------------------

const dropboxHandlers = {
  dropboxAccount: () => getDropboxAccount().then(account => ({ account })),
  dropboxConnect: (request, tabId) => dropboxConnect(!!request.switchAccount, tabId).then(account => ({ account })),
  dropboxDisconnect: () => dropboxDisconnect().then(() => ({ account: null })),
  dropboxQuota: () => getDropboxQuota(),
  dropboxUploadTarget: (request) => getDropboxUploadTarget(request.staleToken)
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = dropboxHandlers[request.type];
  if (!handler) return;

  handler(request, sender.tab ? sender.tab.id : undefined)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message, code: err.code }));
  return true; // keep the channel open for the async response
});
