import { useEffect } from "react";
import { SHORTCUTS } from "./shortcuts";

/**
 * The keyboard shortcut sheet.
 *
 * Opened with "?" or the toolbar button. Rendered from the shared SHORTCUTS
 * table (see shortcuts.ts) so it cannot list a key the editor does not
 * implement — a CI check enforces that.
 *
 * Escape closes it, and the listener is registered in the CAPTURE phase: the
 * editor's own global keydown handler also acts on Escape (it cancels the
 * shape being drawn), and without capturing, opening the sheet mid-polygon and
 * pressing Escape would throw the draft away as well as closing the sheet.
 */

interface Props {
  onClose: () => void;
}

export default function HelpSheet({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="ann-modal" onClick={onClose}>
      <div
        className="ann-modal__box ann-help"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="ann-help__head">
          <div className="ann-modal__title">Keyboard shortcuts</div>
          <button className="ann-help__close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="ann-help__grid">
          {SHORTCUTS.map((g) => (
            <div className="ann-help__group" key={g.group}>
              <div className="ann-help__gtitle">{g.group}</div>
              {g.items.map((s) => (
                <div className="ann-help__row" key={s.label}>
                  <span className="ann-help__keys">
                    {s.keys.map((k, i) => (
                      <span key={i}>
                        {i > 0 && <span className="ann-help__plus">+</span>}
                        <kbd className="ann-kbd">{k}</kbd>
                      </span>
                    ))}
                  </span>
                  <span className="ann-help__label">{s.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="ann-help__foot">
          Shortcuts are ignored while typing in a text field.
        </div>
      </div>
    </div>
  );
}
