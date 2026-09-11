import { memo } from "react";

/**
 * First-run guide: the four things you must do, in order, ticking themselves
 * off as you do them.
 *
 * WHY A SELF-TICKING CHECKLIST AND NOT A TOUR
 * A modal tour interrupts before the user has a reason to care, has to be
 * clicked through, and is gone forever after one dismissal — so it teaches
 * nothing the second time. This sits in the sidebar, derives every tick from
 * real state rather than from "has the user seen step 3", and DELETES ITSELF
 * once all four are done. A user who already knows the tool sees it for
 * roughly as long as it takes them to draw one box.
 *
 * Deriving from state also means it cannot lie: the box is ticked because the
 * dataset actually has a class, not because a counter was incremented.
 *
 * Memoised because it renders inside the editor, which re-renders at pointer
 * frequency while drawing; its four booleans change a handful of times ever.
 */

export interface GuideState {
  hasClass: boolean;
  hasAnnotation: boolean;
  hasSaved: boolean;
  hasApproved: boolean;
}

interface Props extends GuideState {
  onDismiss: () => void;
  onShowShortcuts: () => void;
}

const STEPS: {
  key: keyof GuideState;
  title: string;
  hint: string;
}[] = [
  { key: "hasClass", title: "Add a class", hint: "The label you'll draw — e.g. \"crack\". Field is just below." },
  { key: "hasAnnotation", title: "Draw on the image", hint: "Press B for a box, or G to paint with the brush." },
  { key: "hasSaved", title: "Save it", hint: "Ctrl+S, or just move to the next image with →." },
  { key: "hasApproved", title: "Approve one", hint: "Press A. Only approved images end up in an export." },
];

function LaunchGuide({
  hasClass, hasAnnotation, hasSaved, hasApproved, onDismiss, onShowShortcuts,
}: Props) {
  const state: GuideState = { hasClass, hasAnnotation, hasSaved, hasApproved };
  const done = STEPS.filter((s) => state[s.key]).length;

  // Nothing left to teach — stop taking up the sidebar.
  if (done === STEPS.length) return null;

  // The first unfinished step is the only one shown expanded. Four hints at
  // once is a wall of text; one is an instruction.
  const currentIndex = STEPS.findIndex((s) => !state[s.key]);

  return (
    <div className="ann-side__section ann-guide">
      <div className="ann-side__titlerow">
        <div className="ann-side__title">Getting started</div>
        <button
          className="ann-guide__skip"
          onClick={onDismiss}
          title="Hide this. It comes back for a new dataset."
        >
          Skip
        </button>
      </div>

      <ol className="ann-guide__steps">
        {STEPS.map((s, i) => {
          const complete = state[s.key];
          const current = i === currentIndex;
          return (
            <li
              key={s.key}
              className={`ann-guide__step ${complete ? "ann-guide__step--done" : ""} ${
                current ? "ann-guide__step--current" : ""
              }`}
            >
              <span className="ann-guide__mark" aria-hidden="true">
                {complete ? "✓" : i + 1}
              </span>
              <span className="ann-guide__text">
                <b>{s.title}</b>
                {current && <em>{s.hint}</em>}
              </span>
            </li>
          );
        })}
      </ol>

      <button className="ann-guide__keys" onClick={onShowShortcuts}>
        See all shortcuts <kbd className="ann-kbd">?</kbd>
      </button>
    </div>
  );
}

export default memo(LaunchGuide);
