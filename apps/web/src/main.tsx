import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root was not found.");

render(() => <App />, root);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/model-cache-worker.js").catch(() => undefined);
}
