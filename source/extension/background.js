// Ouvre le convertisseur dans un onglet au clic sur l'icône, et à l'installation.
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }));
chrome.runtime.onInstalled.addListener(d => { if (d.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }); });
