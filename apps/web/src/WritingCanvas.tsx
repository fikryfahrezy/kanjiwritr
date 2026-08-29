import { createEffect, onCleanup, onMount } from "solid-js";
import type { InkBounds, InkPoint, InkStroke, PointerKind, WritingTool } from "./ink-types";
import { WRITING_CELL_SIZE } from "./segmentation";

interface WritingCanvasProps {
  strokes: InkStroke[];
  tool: WritingTool;
  onCommit: (previous: InkStroke[], next: InkStroke[]) => void;
  onSize: (width: number, height: number) => void;
}

export function WritingCanvas(props: WritingCanvasProps) {
  let canvas!: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null = null;
  let width = 1;
  let height = 1;
  let activePointer: number | undefined;
  let activeStroke: InkStroke | undefined;
  let beforeGesture: InkStroke[] = [];
  let working: InkStroke[] = [];
  let observer: ResizeObserver | undefined;

  createEffect(() => {
    props.strokes;
    if (activePointer === undefined) {
      working = structuredClone(props.strokes);
      redraw();
    }
  });

  onMount(() => {
    context = canvas.getContext("2d");
    observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
  });
  onCleanup(() => observer?.disconnect());

  const pointerDown = (event: PointerEvent) => {
    if (activePointer !== undefined || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activePointer = event.pointerId;
    beforeGesture = structuredClone(working);
    if (props.tool === "eraser") {
      eraseAt(event);
      return;
    }
    const point = eventPoint(event);
    activeStroke = {
      id: crypto.randomUUID(),
      pointer: pointerKind(event.pointerType),
      startedAt: point.time,
      bounds: boundsFor(point),
      points: [point],
    };
    working = [...working, activeStroke];
    redraw();
  };

  const pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    if (props.tool === "eraser") {
      for (const sample of event.getCoalescedEvents?.() ?? [event]) eraseAt(sample);
      return;
    }
    if (!activeStroke) return;
    for (const sample of event.getCoalescedEvents?.() ?? [event]) {
      const point = eventPoint(sample);
      activeStroke.points.push(point);
      activeStroke.bounds = includePoint(activeStroke.bounds, point);
    }
    redraw();
  };

  const pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    if (activeStroke) activeStroke.endedAt = performance.timeOrigin + event.timeStamp;
    activePointer = undefined;
    activeStroke = undefined;
    if (!sameStrokes(beforeGesture, working)) props.onCommit(beforeGesture, structuredClone(working));
  };

  function eraseAt(event: PointerEvent): void {
    const x = clamp((event.clientX - canvas.getBoundingClientRect().left) / width);
    const y = clamp((event.clientY - canvas.getBoundingClientRect().top) / height);
    const radius = 24;
    const next = working.filter((stroke) => !stroke.points.some((point) => (
      Math.hypot((point.x - x) * width, (point.y - y) * height) <= radius
    )));
    if (next.length !== working.length) {
      working = next;
      redraw();
    }
  }

  function eventPoint(event: PointerEvent): InkPoint {
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)),
      pressure: event.pressure > 0 ? event.pressure : event.pointerType === "mouse" ? 0.5 : 0.35,
      time: performance.timeOrigin + event.timeStamp,
    };
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context = canvas.getContext("2d");
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    props.onSize(width, height);
    redraw();
  }

  function redraw(): void {
    if (!context) return;
    context.clearRect(0, 0, width, height);
    drawGrid(context);
    for (const stroke of working) drawStroke(context, stroke);
  }

  function drawGrid(target: CanvasRenderingContext2D): void {
    const columns = Math.max(1, Math.floor(width / WRITING_CELL_SIZE));
    const rows = Math.max(1, Math.ceil(height / WRITING_CELL_SIZE));
    const cellWidth = width / columns;
    const cellHeight = height / rows;
    target.save();
    target.strokeStyle = "rgba(185, 78, 53, 0.13)";
    target.lineWidth = 1;
    for (let column = 1; column < columns; column += 1) {
      target.beginPath();
      target.moveTo(column * cellWidth, 0);
      target.lineTo(column * cellWidth, height);
      target.stroke();
    }
    for (let row = 1; row < rows; row += 1) {
      target.beginPath();
      target.moveTo(0, row * cellHeight);
      target.lineTo(width, row * cellHeight);
      target.stroke();
    }
    target.setLineDash([4, 5]);
    target.strokeStyle = "rgba(64, 95, 80, 0.09)";
    for (let column = 0; column < columns; column += 1) {
      target.beginPath();
      target.moveTo(column * cellWidth + cellWidth / 2, 0);
      target.lineTo(column * cellWidth + cellWidth / 2, height);
      target.stroke();
    }
    target.restore();
  }

  function drawStroke(target: CanvasRenderingContext2D, stroke: InkStroke): void {
    if (stroke.points.length === 0) return;
    target.save();
    target.strokeStyle = "#202b28";
    target.fillStyle = "#202b28";
    target.lineCap = "round";
    target.lineJoin = "round";
    if (stroke.points.length === 1) {
      const point = stroke.points[0];
      if (!point) return;
      target.beginPath();
      target.arc(point.x * width, point.y * height, 2.5 + point.pressure * 3, 0, Math.PI * 2);
      target.fill();
    } else {
      for (let index = 1; index < stroke.points.length; index += 1) {
        const from = stroke.points[index - 1];
        const to = stroke.points[index];
        if (!from || !to) continue;
        target.lineWidth = 2.2 + ((from.pressure + to.pressure) / 2) * 5.5;
        target.beginPath();
        target.moveTo(from.x * width, from.y * height);
        target.lineTo(to.x * width, to.y * height);
        target.stroke();
      }
    }
    target.restore();
  }

  return (
    <canvas
      ref={canvas}
      class={`ink-canvas ink-canvas--${props.tool}`}
      aria-label="Japanese handwriting canvas. Write one character in each square."
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    />
  );
}

function pointerKind(value: string): PointerKind {
  return value === "pen" || value === "touch" ? value : "mouse";
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function boundsFor(point: InkPoint): InkBounds {
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

function includePoint(bounds: InkBounds, point: InkPoint): InkBounds {
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

function sameStrokes(left: InkStroke[], right: InkStroke[]): boolean {
  return left.length === right.length && left.every((stroke, index) => stroke.id === right[index]?.id);
}
