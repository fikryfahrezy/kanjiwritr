chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ connectionState: "not-paired" });
});
