import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";

const preventZoom = (event: Event) => event.preventDefault();

// iPadOS Safari ignores the viewport's zoom limits for accessibility. Keep
// one-finger scrolling intact while blocking page-level pinch gestures.
document.addEventListener(
  "touchmove",
  (event) => {
    if (event.touches.length > 1) preventZoom(event);
  },
  { passive: false },
);

for (const eventName of ["gesturestart", "gesturechange", "gestureend"])
  document.addEventListener(eventName, preventZoom, { passive: false });

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found.");

render(() => <App />, root);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .register("/model-cache-worker.js")
    .catch(() => undefined);
}
