export type WritingTool = "pen" | "eraser";
export type PointerKind = "pen" | "touch" | "mouse";

export interface InkPoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

export interface InkBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface InkStroke {
  id: string;
  pointer: PointerKind;
  startedAt: number;
  endedAt?: number;
  bounds: InkBounds;
  points: InkPoint[];
}

export interface CharacterGroup {
  key: string;
  row: number;
  column: number;
  bounds: InkBounds;
  strokes: InkStroke[];
}

export interface CharacterCandidate {
  character: string;
  confidence: number;
}

export interface RecognizedGroup {
  key: string;
  candidates: CharacterCandidate[];
}

export interface SentenceSuggestion {
  text: string;
  confidence: number;
}

export interface RecognitionMetrics {
  modelBytes: number;
  loadMs: number;
  inferenceMs: number;
  estimatedWorkingBytes: number;
}

export interface RecognitionResult {
  groups: RecognizedGroup[];
  suggestions: SentenceSuggestion[];
  metrics: RecognitionMetrics;
}
