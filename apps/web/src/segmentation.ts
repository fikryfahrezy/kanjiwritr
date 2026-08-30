import type {
  CharacterGroup,
  InkBounds,
  InkStroke,
  RecognizedGroup,
  SentenceSuggestion,
} from "./ink-types";

export const WRITING_CELL_SIZE = 112;

export function segmentStrokes(
  strokes: InkStroke[],
  width: number,
  height: number,
): CharacterGroup[] {
  const columns = Math.max(1, Math.floor(width / WRITING_CELL_SIZE));
  const rows = Math.max(1, Math.ceil(height / WRITING_CELL_SIZE));
  const grouped = new Map<string, CharacterGroup>();

  for (const stroke of strokes) {
    const centerX = (stroke.bounds.minX + stroke.bounds.maxX) / 2;
    const centerY = (stroke.bounds.minY + stroke.bounds.maxY) / 2;
    const column = Math.min(
      columns - 1,
      Math.max(0, Math.floor(centerX * columns)),
    );
    const row = Math.min(rows - 1, Math.max(0, Math.floor(centerY * rows)));
    const key = `${row}:${column}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.strokes.push(stroke);
      existing.bounds = unionBounds(existing.bounds, stroke.bounds);
    } else {
      grouped.set(key, {
        key,
        row,
        column,
        bounds: { ...stroke.bounds },
        strokes: [stroke],
      });
    }
  }

  return [...grouped.values()].sort(
    (left, right) => left.row - right.row || left.column - right.column,
  );
}

export function sentenceSuggestions(
  groups: RecognizedGroup[],
  maximum = 5,
): SentenceSuggestion[] {
  let beams: SentenceSuggestion[] = [{ text: "", confidence: 1 }];
  for (const group of groups) {
    const choices = group.candidates.slice(0, 3);
    if (choices.length === 0) continue;
    beams = beams
      .flatMap((beam) =>
        choices.map((candidate) => ({
          text: beam.text + candidate.character,
          confidence:
            beam.confidence * Math.max(candidate.confidence, 0.000_001),
        })),
      )
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, maximum);
  }
  const characterCount = Math.max(1, groups.length);
  return beams.map((beam) => ({
    ...beam,
    confidence: beam.confidence ** (1 / characterCount),
  }));
}

function unionBounds(left: InkBounds, right: InkBounds): InkBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}
