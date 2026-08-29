import * as ort from "onnxruntime-web/wasm";
import type { CharacterCandidate, CharacterGroup, RecognitionMetrics, RecognizedGroup } from "./ink-types";
import { sentenceSuggestions } from "./segmentation";

interface RecognizeRequest {
  type: "recognize";
  requestId: string;
  groups: CharacterGroup[];
  width: number;
  height: number;
}

const worker = self as unknown as {
  location: Location;
  addEventListener: (type: "message", listener: (event: MessageEvent<RecognizeRequest>) => void) => void;
  postMessage: (message: unknown) => void;
};
const INPUT_SIZE = 96;
const MODEL_PATH = "/models/dakanji/char_classifier.onnx";
const LABELS_PATH = "/models/dakanji/char_classifier_labels.txt";
const ORT_WASM_BYTES = 11_210_254;
let sessionPromise: Promise<ort.InferenceSession> | undefined;
let labelsPromise: Promise<string[]> | undefined;
let modelBytes = 0;
let loadMs = 0;

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  mjs: new URL("/ort/ort-wasm-simd-threaded.mjs", worker.location.href).href,
  wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", worker.location.href).href,
};

worker.addEventListener("message", (event: MessageEvent<RecognizeRequest>) => {
  if (event.data.type !== "recognize") return;
  void recognize(event.data).then(
    (result) => worker.postMessage({ type: "result", requestId: event.data.requestId, result }),
    (cause: unknown) => worker.postMessage({
      type: "error",
      requestId: event.data.requestId,
      error: cause instanceof Error ? cause.message : "Local recognition failed.",
    }),
  );
});

async function recognize(request: RecognizeRequest) {
  const started = performance.now();
  const [session, labels] = await Promise.all([loadSession(), loadLabels()]);
  const groups: RecognizedGroup[] = [];
  for (const group of request.groups) {
    const tensor = renderTensor(group, request.width, request.height);
    const output = await session.run({ image: tensor });
    const probabilities = output.probs?.data;
    if (!(probabilities instanceof Float32Array) || probabilities.length !== labels.length) {
      throw new Error("The handwriting model returned an unexpected result.");
    }
    groups.push({ key: group.key, candidates: topCandidates(probabilities, labels) });
  }
  const inferenceMs = performance.now() - started;
  const metrics: RecognitionMetrics = {
    modelBytes,
    loadMs,
    inferenceMs,
    estimatedWorkingBytes: modelBytes + ORT_WASM_BYTES + request.groups.length * INPUT_SIZE * INPUT_SIZE * 4,
  };
  return { groups, suggestions: sentenceSuggestions(groups), metrics };
}

function loadSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const started = performance.now();
      const response = await cachedFetch(MODEL_PATH);
      const model = await response.arrayBuffer();
      modelBytes = model.byteLength;
      const session = await ort.InferenceSession.create(model, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      loadMs = performance.now() - started;
      return session;
    })().catch((cause) => {
      sessionPromise = undefined;
      throw cause;
    });
  }
  return sessionPromise;
}

function loadLabels(): Promise<string[]> {
  if (!labelsPromise) {
    labelsPromise = cachedFetch(LABELS_PATH).then((response) => response.text()).then((value) => [...value.trim()]);
  }
  return labelsPromise;
}

async function cachedFetch(path: string): Promise<Response> {
  const cache = await caches.open("kanjiwritr-model-v1");
  const cached = await cache.match(path);
  if (cached) return cached;
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Recognition asset unavailable (${response.status}).`);
  await cache.put(path, response.clone());
  return response;
}

function renderTensor(group: CharacterGroup, canvasWidth: number, canvasHeight: number): ort.Tensor {
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Offscreen canvas is unavailable in this browser.");
  context.fillStyle = "#000";
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  context.strokeStyle = "#fff";
  context.fillStyle = "#fff";
  context.lineCap = "round";
  context.lineJoin = "round";

  const left = group.bounds.minX * canvasWidth;
  const right = group.bounds.maxX * canvasWidth;
  const top = group.bounds.minY * canvasHeight;
  const bottom = group.bounds.maxY * canvasHeight;
  const side = Math.max(12, Math.max(right - left, bottom - top) * 1.25);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const project = (x: number, y: number) => ({
    x: ((x * canvasWidth - centerX) / side) * (INPUT_SIZE * 0.82) + INPUT_SIZE / 2,
    y: ((y * canvasHeight - centerY) / side) * (INPUT_SIZE * 0.82) + INPUT_SIZE / 2,
  });

  for (const stroke of group.strokes) {
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      if (!point) continue;
      const projected = project(point.x, point.y);
      context.beginPath();
      context.arc(projected.x, projected.y, 2.6, 0, Math.PI * 2);
      context.fill();
      continue;
    }
    for (let index = 1; index < stroke.points.length; index += 1) {
      const from = stroke.points[index - 1];
      const to = stroke.points[index];
      if (!from || !to) continue;
      const a = project(from.x, from.y);
      const b = project(to.x, to.y);
      context.lineWidth = Math.max(2, 2 + ((from.pressure + to.pressure) / 2) * 4);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }

  const pixels = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const input = new Float32Array(INPUT_SIZE * INPUT_SIZE);
  for (let index = 0; index < input.length; index += 1) input[index] = pixels[index * 4] ?? 0;
  return new ort.Tensor("float32", input, [1, 1, INPUT_SIZE, INPUT_SIZE]);
}

function topCandidates(probabilities: Float32Array, labels: string[]): CharacterCandidate[] {
  const candidates: CharacterCandidate[] = [];
  for (let index = 0; index < probabilities.length; index += 1) {
    const character = labels[index];
    if (!character || !isKanji(character)) continue;
    const confidence = Number(probabilities[index]);
    if (candidates.length < 5 || confidence > (candidates[4]?.confidence ?? 0)) {
      candidates.push({ character, confidence });
      candidates.sort((left, right) => right.confidence - left.confidence);
      if (candidates.length > 5) candidates.pop();
    }
  }
  return candidates;
}

function isKanji(value: string): boolean {
  const scalar = value.codePointAt(0);
  return scalar !== undefined && (
    (scalar >= 0x3400 && scalar <= 0x4dbf)
    || (scalar >= 0x4e00 && scalar <= 0x9fff)
    || (scalar >= 0xf900 && scalar <= 0xfaff)
  );
}
