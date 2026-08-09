// Background service worker for Discord Server Leaver

chrome.runtime.onInstalled.addListener(() => {
  console.log('Discord Server Leaver installed');
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getToken') {
    // Token extraction happens in content script, not here
    sendResponse({ success: true });
  }
  return true;
});
