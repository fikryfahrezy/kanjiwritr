const text = document.querySelector<HTMLTextAreaElement>("#text");
const button = document.querySelector<HTMLButtonElement>("#insert");
const feedback = document.querySelector<HTMLParagraphElement>("#feedback");

button?.addEventListener("click", async () => {
  const value = text?.value.trim();
  if (!value || !feedback) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    feedback.textContent = "No active browser tab found.";
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "insert-text", text: value });
    feedback.textContent = response?.inserted
      ? "Inserted into the focused field."
      : "Focus an editable field first.";
  } catch {
    feedback.textContent = "This page does not allow extension insertion.";
  }
});
