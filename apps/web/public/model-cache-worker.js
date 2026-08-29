const CACHE_NAME = "kanjiwrittr-model-v1";
const ASSETS = [
  "/models/dakanji/char_classifier.onnx",
  "/models/dakanji/char_classifier_labels.txt",
  "/models/dakanji/LICENSE.txt",
  "/ort/ort-wasm-simd-threaded.mjs",
  "/ort/ort-wasm-simd-threaded.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("kanjiwrittr-model-") && key !== CACHE_NAME).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const path = new URL(event.request.url).pathname;
  if (!ASSETS.includes(path)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  }));
});
