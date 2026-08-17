// Opens the Homepage new tab page when the toolbar action is clicked.
// No background service worker is required.
chrome.tabs.create({ url: chrome.runtime.getURL('src/newtab/index.html') });
window.close();
