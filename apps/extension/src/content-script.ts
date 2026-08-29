type InsertMessage = { type: "insert-text"; text: string };

let lastEditable: HTMLElement | null = null;

document.addEventListener("focusin", (event) => {
  if (event.target instanceof HTMLElement && isEditable(event.target)) {
    lastEditable = event.target;
    void chrome.runtime.sendMessage({ type: "editable.focused" }).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
  if (!isInsertMessage(message)) return;
  const active = document.activeElement;
  const target = active instanceof HTMLElement && isEditable(active) ? active : lastEditable;
  respond({ inserted: target ? insertText(target, message.text) : false });
});

function isEditable(element: HTMLElement): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  if (element instanceof HTMLInputElement) {
    return !element.disabled && !element.readOnly && ["text", "search", "email", "url", "tel", "password"].includes(element.type);
  }
  return element.isContentEditable;
}

function isInsertMessage(value: unknown): value is InsertMessage {
  return value !== null
    && typeof value === "object"
    && "type" in value
    && value.type === "insert-text"
    && "text" in value
    && typeof value.text === "string";
}

function insertText(target: HTMLElement, text: string): boolean {
  target.focus();
  const beforeInput = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: text,
  });
  if (!target.dispatchEvent(beforeInput)) return false;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    target.setRangeText(text, start, end, "end");
    dispatchEditEvents(target, text);
    return true;
  }

  if (target.isContentEditable) {
    const selection = window.getSelection();
    if (!selection) return false;
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : document.createRange();
    if (!target.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(target);
      range.collapse(false);
    }
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    dispatchEditEvents(target, text);
    return true;
  }

  return false;
}

function dispatchEditEvents(target: HTMLElement, text: string): void {
  target.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: text,
  }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}
