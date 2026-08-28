import { createSignal, onCleanup, onMount } from "solid-js";
import {
  encodeClientMessage,
  parseServerMessage,
  type ConnectionState,
} from "@kanjiwrittr/protocol";

const stateLabel: Record<ConnectionState, string> = {
  connecting: "Connecting",
  connected: "Server ready",
  disconnected: "Offline",
};

function websocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function App() {
  const [text, setText] = createSignal("");
  const [connection, setConnection] = createSignal<ConnectionState>("connecting");
  const [feedback, setFeedback] = createSignal("Waiting for the deployment server…");
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let heartbeatTimer: number | undefined;
  let disposed = false;

  const connect = () => {
    setConnection("connecting");
    socket = new WebSocket(websocketUrl());
    socket.addEventListener("open", () => {
      setConnection("connected");
      setFeedback("Preview server connected. Mac pairing comes next.");
      heartbeatTimer = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(encodeClientMessage({ type: "ping" }));
        }
      }, 25_000);
    });
    socket.addEventListener("message", (event) => {
      const message = parseServerMessage(event.data);
      if (!message) return;
      if (message.type === "connection.ready") setConnection("connected");
      if (message.type === "text.received") {
        setFeedback("Preview received by the server. Mac delivery is not enabled yet.");
      }
    });
    socket.addEventListener("close", () => {
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      if (disposed) return;
      setConnection("disconnected");
      setFeedback("Server unavailable. Reconnecting…");
      reconnectTimer = window.setTimeout(connect, 2_500);
    });
  };

  const sendPreview = () => {
    const value = text().trim();
    if (!value || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(encodeClientMessage({
      type: "text.preview",
      messageId: crypto.randomUUID(),
      text: value,
    }));
    setFeedback("Sending preview…");
  };

  onMount(connect);
  onCleanup(() => {
    disposed = true;
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
    socket?.close();
  });

  return (
    <main class="app-shell">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Kanjiwrittr home">
          <span class="brand-mark" aria-hidden="true">書</span>
          <span>Kanjiwrittr</span>
        </a>
        <div class={`connection connection--${connection()}`} role="status">
          <span class="connection-dot" aria-hidden="true" />
          {stateLabel[connection()]}
        </div>
      </header>

      <section class="workspace" aria-labelledby="page-title">
        <div class="intro">
          <p class="eyebrow">iPad writing desk</p>
          <h1 id="page-title">Write here.<br /><em>Continue on your Mac.</em></h1>
          <p class="lede">
            Use the Japanese handwriting keyboard for this first preview. Your custom ink canvas
            and Mac pairing will arrive in the next milestone.
          </p>
        </div>

        <div class="writing-card">
          <div class="card-heading">
            <div>
              <span class="step-number">01</span>
              <h2>Your Japanese text</h2>
            </div>
            <span class="character-count">{[...text()].length} characters</span>
          </div>

          <label class="writing-field">
            <span class="sr-only">Japanese text</span>
            <textarea
              value={text()}
              onInput={(event) => setText(event.currentTarget.value)}
              placeholder="ここに日本語を書いてください…"
              lang="ja"
              autocomplete="off"
              spellcheck={false}
            />
            <span class="baseline baseline-one" aria-hidden="true" />
            <span class="baseline baseline-two" aria-hidden="true" />
          </label>

          <div class="card-footer">
            <p aria-live="polite">{feedback()}</p>
            <button
              class="send-button"
              type="button"
              disabled={!text().trim() || connection() !== "connected"}
              onClick={sendPreview}
            >
              Send preview
              <span aria-hidden="true">↗</span>
            </button>
          </div>
        </div>

        <aside class="setup-note">
          <span class="setup-icon" aria-hidden="true">あ</span>
          <div>
            <strong>Japanese handwriting keyboard</strong>
            <p>On iPad, add it from Settings → General → Keyboard, then tap this writing area.</p>
          </div>
        </aside>
      </section>

      <footer class="page-footer">
        <span>Private by design</span>
        <span class="footer-line" aria-hidden="true" />
        <span>Recognition stays on iPad</span>
      </footer>
    </main>
  );
}
