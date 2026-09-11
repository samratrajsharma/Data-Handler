/**
 * The keyboard shortcut table — the one place they are written down.
 *
 * WHY THIS IS A SEPARATE MODULE
 * A help sheet that lists a key the handler does not implement is worse than
 * no sheet: the user tries it, nothing happens, and they stop trusting the
 * rest of the list. The handler in AnnotateEditor lives inside a `switch` on
 * `e.key` and cannot cleanly be driven by data (several cases carry
 * `preventDefault`, modifier checks, and functional state updates), so instead
 * of coupling them at runtime they are coupled in CI:
 * `scripts/check_shortcuts.mjs` asserts every `code` listed here appears in
 * the handler's source, and fails the build if one does not.
 *
 * That catches the realistic failure — someone removes or renames a binding
 * and forgets the sheet — without contorting the event handler.
 */

export interface Shortcut {
  /** Displayed keycap(s). Split on "+" for chords. */
  keys: string[];
  label: string;
  /**
   * Literal(s) that must appear in the handler source for this binding to be
   * considered implemented. Usually the lower-case key. Omit for bindings the
   * browser or a nested input owns rather than the global handler.
   */
  code?: string[];
}

export interface ShortcutGroup {
  group: string;
  items: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    group: "Tools",
    items: [
      { keys: ["V"], label: "Select / move", code: ['case "v"'] },
      { keys: ["B"], label: "Draw a box", code: ['case "b"'] },
      { keys: ["P"], label: "Draw a polygon", code: ['case "p"'] },
      { keys: ["G"], label: "Brush (paint a mask)", code: ['case "g"'] },
      { keys: ["E"], label: "Eraser", code: ['case "e"'] },
      { keys: ["X"], label: "Crop", code: ['case "x"'] },
      { keys: ["H"], label: "Pan", code: ['case "h"'] },
      { keys: ["Space"], label: "Hold to pan with any tool", code: ['e.code === "Space"'] },
      { keys: ["["], label: "Smaller brush", code: ['case "["'] },
      { keys: ["]"], label: "Bigger brush", code: ['case "]"'] },
    ],
  },
  {
    group: "Labelling",
    items: [
      { keys: ["1", "…", "9"], label: "Pick that class", code: ["Digit([1-9])"] },
      { keys: ["Shift", "1–9"], label: "Toggle it as a whole-image label", code: ["e.shiftKey"] },
      { keys: ["Enter"], label: "Close the polygon you are drawing", code: ['case "Enter"'] },
      { keys: ["Esc"], label: "Cancel the shape / deselect", code: ['case "Escape"'] },
      { keys: ["Del"], label: "Delete what is selected", code: ['case "Delete"'] },
      { keys: ["C"], label: "Copy the previous image's labels", code: ['case "c"'] },
    ],
  },
  {
    group: "Review",
    items: [
      { keys: ["A"], label: "Save and approve", code: ['case "a"'] },
      { keys: ["R"], label: "Save and reject", code: ['case "r"'] },
      { keys: ["Ctrl", "S"], label: "Save", code: ['k === "s"'] },
      { keys: ["←"], label: "Previous image", code: ['case "ArrowLeft"'] },
      { keys: ["→"], label: "Next image", code: ['case "ArrowRight"'] },
      { keys: ["Ctrl", "Z"], label: "Undo", code: ['k === "z"'] },
      { keys: ["Ctrl", "Shift", "Z"], label: "Redo", code: ["e.shiftKey"] },
    ],
  },
  {
    group: "View",
    items: [
      { keys: ["F"], label: "Fit the image to the window", code: ['case "f"'] },
      { keys: ["0"], label: "Reset zoom to 100%", code: ['case "0"'] },
      { keys: ["+"], label: "Zoom in", code: ['case "+"'] },
      { keys: ["−"], label: "Zoom out", code: ['case "-"'] },
      { keys: ["L"], label: "Lock zoom between images", code: ['case "l"'] },
      { keys: ["T"], label: "Show / hide annotations", code: ['case "t"'] },
      { keys: ["D"], label: "Reset brightness & contrast", code: ['case "d"'] },
      { keys: ["?"], label: "This list" },
    ],
  },
];
