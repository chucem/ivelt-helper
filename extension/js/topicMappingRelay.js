// the page scripts can't reach Google Sheets (the forum's CSP), so js/addTopicButtons.js asks here and the background fetches it
// not the forum (e.g. Cloudflare's check page): nothing to relay there
if (document.getElementById("page-body")) window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.type !== "ivelt-helper-topic-mapping") return;

  chrome.runtime.sendMessage({ type: "topicMappingCsv" }, (response) => {
    if (chrome.runtime.lastError) response = { error: chrome.runtime.lastError.message };
    window.postMessage({ type: "ivelt-helper-topic-mapping-result", text: response.text, error: response.error }, location.origin);
  });
});
