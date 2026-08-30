import { describe, expect, test } from "bun:test";
import type { InkStroke, RecognizedGroup } from "../src/ink-types";
import { segmentStrokes, sentenceSuggestions } from "../src/segmentation";

function stroke(id: string, x: number, y: number): InkStroke {
  return {
    id,
    pointer: "pen",
    startedAt: 1,
    endedAt: 2,
    bounds: { minX: x, minY: y, maxX: x + 0.02, maxY: y + 0.02 },
    points: [
      { x, y, pressure: 0.7, time: 1 },
      { x: x + 0.02, y: y + 0.02, pressure: 0.8, time: 2 },
    ],
  };
}

describe("handwriting segmentation", () => {
  test("groups multiple strokes by cell and orders multiple lines", () => {
    const groups = segmentStrokes(
      [
        stroke("line-two", 0.05, 0.6),
        stroke("character-two-a", 0.3, 0.1),
        stroke("character-one", 0.05, 0.1),
        stroke("character-two-b", 0.32, 0.12),
      ],
      448,
      224,
    );

    expect(groups.map((group) => group.strokes.map((item) => item.id))).toEqual(
      [["character-one"], ["character-two-a", "character-two-b"], ["line-two"]],
    );
  });

  test("combines ranked character candidates into sentence beams", () => {
    const groups: RecognizedGroup[] = [
      {
        key: "0:0",
        candidates: [
          { character: "日", confidence: 0.8 },
          { character: "目", confidence: 0.2 },
        ],
      },
      {
        key: "0:1",
        candidates: [
          { character: "本", confidence: 0.7 },
          { character: "木", confidence: 0.3 },
        ],
      },
    ];
    const suggestions = sentenceSuggestions(groups);
    expect(suggestions[0]?.text).toBe("日本");
    expect(suggestions.map((item) => item.text)).toContain("日木");
    expect(suggestions.map((item) => item.text)).toContain("目本");
  });

  test("orders a long four-line manuscript", () => {
    const manuscript = Array.from({ length: 20 }, (_, index) => {
      const row = Math.floor(index / 5);
      const column = index % 5;
      return stroke(`character-${index}`, (column + 0.2) / 5, (row + 0.2) / 4);
    });
    const groups = segmentStrokes(manuscript.reverse(), 560, 448);
    expect(groups).toHaveLength(20);
    expect(groups.map((group) => group.key)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `${Math.floor(index / 5)}:${index % 5}`,
      ),
    );
  });
});
