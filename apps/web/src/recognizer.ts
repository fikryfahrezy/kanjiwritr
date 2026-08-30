import type { CharacterGroup, RecognitionResult } from "./ink-types";

interface PendingRecognition {
  resolve: (value: RecognitionResult) => void;
  reject: (reason: Error) => void;
}

export class LocalRecognizer {
  private readonly worker = new Worker(
    new URL("./recognition-worker.ts", import.meta.url),
    { type: "module" },
  );
  private readonly pending = new Map<string, PendingRecognition>();

  constructor() {
    this.worker.addEventListener(
      "message",
      (
        event: MessageEvent<{
          type: "result" | "error";
          requestId: string;
          result?: RecognitionResult;
          error?: string;
        }>,
      ) => {
        const pending = this.pending.get(event.data.requestId);
        if (!pending) return;
        this.pending.delete(event.data.requestId);
        if (event.data.type === "result" && event.data.result)
          pending.resolve(event.data.result);
        else
          pending.reject(
            new Error(event.data.error ?? "Local recognition failed."),
          );
      },
    );
    this.worker.addEventListener("error", () => {
      for (const pending of this.pending.values())
        pending.reject(
          new Error("The recognition worker stopped unexpectedly."),
        );
      this.pending.clear();
    });
  }

  recognize(
    groups: CharacterGroup[],
    width: number,
    height: number,
  ): Promise<RecognitionResult> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({
        type: "recognize",
        requestId,
        groups,
        width,
        height,
      });
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const pending of this.pending.values())
      pending.reject(new Error("Recognition was cancelled."));
    this.pending.clear();
  }
}
