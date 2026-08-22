import { useCallback, useRef } from "react";
import type { LocalAnnotation } from "./canvasGeometry";

const MAX_DEPTH = 100;

/**
 * Per-image undo/redo stacks of immutable annotation-array snapshots.
 * `commit(before)` is called with the state as it was BEFORE each committed
 * mutation (add / move / resize / delete / class-change / classification
 * toggle); undo/redo exchange the current state with the stacks. `reset()`
 * on every image navigation keeps the stacks strictly per-image.
 */
export function useAnnotationHistory() {
  const undoRef = useRef<LocalAnnotation[][]>([]);
  const redoRef = useRef<LocalAnnotation[][]>([]);

  const reset = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
  }, []);

  const commit = useCallback((before: LocalAnnotation[]) => {
    undoRef.current.push(before);
    if (undoRef.current.length > MAX_DEPTH) undoRef.current.shift();
    redoRef.current = [];
  }, []);

  const undo = useCallback((current: LocalAnnotation[]): LocalAnnotation[] | null => {
    const prev = undoRef.current.pop();
    if (!prev) return null;
    redoRef.current.push(current);
    return prev;
  }, []);

  const redo = useCallback((current: LocalAnnotation[]): LocalAnnotation[] | null => {
    const next = redoRef.current.pop();
    if (!next) return null;
    undoRef.current.push(current);
    return next;
  }, []);

  return { reset, commit, undo, redo };
}
