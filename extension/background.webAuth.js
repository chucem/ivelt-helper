// Sign-in window for Google Drive and Dropbox
//
// chrome.identity.launchWebAuthFlow shows the service's sign-in page and hands
// back the address it redirects to at the end (https://<id>.chromiumapp.org/...).
// Edge on Android can't open that window ("Couldn't create a browser window to
// display an authorization page"), while other Chromium browsers on Android open
// a tab for it. So when the window can't be made, the sign-in page opens in an
// ordinary tab, and the redirect is caught from the tab's address. Reading that
// address needs access to <id>.chromiumapp.org, an optional permission: only
// browsers that need the tab ever ask for it, on signin.html, since a permission
// can only be asked for from an extension page after a click.

const AUTH_TAB_PERMISSION = { origins: [`https://${chrome.runtime.id}.chromiumapp.org/*`] };

// A tab sign-in that's still waiting, so a second click doesn't open another tab
let authTabFlow = null;

// The same as chrome.identity.launchWebAuthFlow, with the tab as a fallback.
// returnTabId: the tab that asked (the forum page), brought back to the front after.
async function launchAuthFlow(details, returnTabId) {
  try {
    return await chrome.identity.launchWebAuthFlow(details);
  } catch (err) {
    if (!details.interactive || !/browser window/i.test((err && err.message) || '')) throw err;
    return authFlowInTab(details.url, returnTabId);
  }
}

async function authFlowInTab(url, returnTabId) {
  if (authTabFlow) {
    authTabFlow.cancel();
    authTabFlow = null;
  }

  const redirectPrefix = chrome.identity.getRedirectURL();
  const granted = await chrome.permissions.contains(AUTH_TAB_PERMISSION).catch(() => false);
  // Without the permission the tab starts on signin.html, which asks for it and then goes on to the sign-in page
  const start = granted ? url : chrome.runtime.getURL('signin.html') + '#' + encodeURIComponent(url);
  const createProps = { url: start, active: true };
  if (returnTabId != null) createProps.openerTabId = returnTabId;
  const tab = await chrome.tabs.create(createProps).catch(() => chrome.tabs.create({ url: start, active: true }));

  return new Promise((resolve, reject) => {
    // The service worker stops after 30 seconds without extension events, and
    // typing a password can take longer; an API call now and then keeps it up
    const keepAlive = setInterval(() => { chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);

    const finish = () => {
      clearInterval(keepAlive);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      if (authTabFlow === flow) authTabFlow = null;
    };
    const closeTab = () => {
      chrome.tabs.remove(tab.id).catch(() => {});
      if (returnTabId != null) chrome.tabs.update(returnTabId, { active: true }).catch(() => {});
    };

    const onUpdated = (tabId, changeInfo, updated) => {
      if (tabId !== tab.id) return;
      const address = changeInfo.url || (updated && updated.url) || '';
      if (!address.startsWith(redirectPrefix)) return;
      finish();
      closeTab();
      resolve(address);
    };
    const onRemoved = (tabId) => {
      if (tabId !== tab.id) return;
      finish();
      // the same words launchWebAuthFlow uses when its window is closed
      reject(new Error('The user did not approve access.'));
    };

    const flow = {
      cancel: () => {
        finish();
        chrome.tabs.remove(tab.id).catch(() => {});
        reject(new Error('Another sign-in was started.'));
      }
    };
    authTabFlow = flow;
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}
