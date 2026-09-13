import { useEffect, useRef, useState } from "react";
import { NavLink, Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import api from "../../shared/api/client";
import "./DashboardLayout.css";

type NavItem = {
  to: string;
  icon: string;
  label: string;
  end?: boolean;
  /** Position in the mode's workflow, 1-based.
   *
   *  The nav items were already in pipeline order — Images, then Annotate,
   *  then Review & Export — but nothing said so, and a first-time user has no
   *  way to tell an ordered process from an unordered menu. Numbering them is
   *  the whole feature: no extra screen, no extra concepts, just the order
   *  made visible where the user already looks. */
  step?: number;
};
type Mode = "tabular" | "image" | "text";

// Always-visible entry points (top of the sidebar).
const TOP_ITEMS: NavItem[] = [
  { to: "/",         icon: "grid",     label: "Dashboard", end: true },
  { to: "/datasets", icon: "database", label: "Datasets" },
];

// Three workspaces. Picking one filters the middle of the sidebar down to just
// that data type's tools, so text / tabular / image flows don't clutter. Each
// mode ends in "Review & Export" — the natural last step of that flow.
const REVIEW: NavItem = { to: "/review", icon: "check-circle", label: "Review & Export" };

/** Same destination, numbered as the final step of a mode's pipeline. */
const reviewStep = (step: number): NavItem => ({ ...REVIEW, step });
const MODES: { id: Mode; label: string; icon: string; items: NavItem[] }[] = [
  {
    id: "tabular", label: "Tabular", icon: "table",
    items: [
      { to: "/structuring", icon: "layers",    label: "Structuring", step: 1 },
      { to: "/eda",         icon: "bar-chart", label: "EDA",         step: 2 },
      { to: "/labeling",    icon: "tag",       label: "Labeling",    step: 3 },
      { to: "/ai-labeling", icon: "cpu",       label: "AI Labeling", step: 4 },
      reviewStep(5),
    ],
  },
  {
    id: "image", label: "Image", icon: "image",
    items: [
      { to: "/images",   icon: "image",     label: "Images",   step: 1 },
      { to: "/annotate", icon: "crosshair", label: "Annotate", step: 2 },
      reviewStep(3),
    ],
  },
  {
    id: "text", label: "Text", icon: "file-text",
    items: [
      { to: "/text-labeling", icon: "file-text", label: "Text Labeling", step: 1 },
      reviewStep(2),
    ],
  },
];

// Utility items — settings + background-job monitor. Demoted to the footer so
// they don't sit in the nav as if they were labelling steps.
const FOOTER_ITEMS: NavItem[] = [
  { to: "/settings", icon: "settings",  label: "Settings" },
  { to: "/tasks",    icon: "activity",  label: "Tasks" },
];

const ICONS: Record<string, string> = {
  "grid": "M3 3h7v7H3V3zm11 0h7v7h-7V3zm0 11h7v7h-7v-7zM3 14h7v7H3v-7z",
  "database": "M12 2C6.48 2 2 4 2 6.5v11C2 20 6.48 22 12 22s10-2 10-4.5v-11C22 4 17.52 2 12 2zM2 9.5c0 2.5 4.48 4.5 10 4.5s10-2 10-4.5",
  "table": "M3 3h18v18H3V3zM3 9h18M3 15h18M9 3v18M15 3v18",
  "layers": "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  "bar-chart": "M18 20V10M12 20V4M6 20v-6",
  "tag": "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01",
  "cpu": "M18 4H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2zM9 9h6v6H9V9zM9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3",
  "image": "M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  "crosshair": "M22 12h-4M6 12H2M12 6V2M12 22v-4M12 12m-7 0a7 7 0 1014 0 7 7 0 10-14 0",
  "file-text": "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8",
  "check-circle": "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3",
  "activity": "M22 12h-4l-3 9L9 3l-3 9H2",
  "settings": "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
};

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document !== "undefined") {
    const t = document.documentElement.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
  }
  return "dark";
}

// Review & Export lives in every mode, so it must NOT drive mode selection —
// otherwise opening it would always snap you back to the first mode. Exclude it.
function modeForPath(path: string): Mode | null {
  for (const m of MODES) {
    if (m.items.some((it) => it.to !== "/review" && (path === it.to || path.startsWith(it.to + "/")))) return m.id;
  }
  return null;
}

function initialMode(path: string): Mode {
  const fromPath = modeForPath(path);
  if (fromPath) return fromPath;
  try {
    const saved = localStorage.getItem("dh-mode");
    if (saved === "tabular" || saved === "image" || saved === "text") return saved;
  } catch { /* ignore */ }
  return "tabular";
}

/**
 * Whether the sidebar is pinned open. Persisted, because it is a working
 * preference rather than a per-visit choice: someone who wants the labels
 * always visible wants that tomorrow too.
 */
const PIN_KEY = "dh-sidebar-pinned";

function readPinned(): boolean {
  try {
    return localStorage.getItem(PIN_KEY) === "1";
  } catch {
    return false;   // private mode — default to the rail
  }
}

export default function DashboardLayout() {
  /**
   * The sidebar has two modes, not three states.
   *
   *  unpinned (default) — a 72px icon rail that expands on hover and collapses
   *                       the moment the pointer leaves. It expands as an
   *                       OVERLAY: the main content keeps its rail-width
   *                       margin, so hovering the nav never reflows the page
   *                       underneath. Reflowing on hover is what makes this
   *                       pattern feel broken elsewhere — text reflows, the
   *                       thing you were reading jumps, and on the annotator
   *                       the canvas would resize every time you passed the
   *                       left edge.
   *
   *  pinned             — always expanded, content shifted over to match. The
   *                       button in the header toggles it.
   *
   * Hover is pure CSS (:hover on the aside). React only owns the pin, so
   * moving the mouse across the sidebar causes no re-render at all.
   */
  const [pinned, setPinned] = useState(readPinned);

  // The theme wipe expands from this button, so its position is needed at
  // click time. A ref rather than the click event: the origin then survives
  // the toggle being triggered from anywhere else later.
  const themeBtnRef = useRef<HTMLButtonElement | null>(null);

  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      try { localStorage.setItem(PIN_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Build identity for the sidebar. Uses /api/v1/version rather than /health
  // because only /api/* is reverse-proxied (nginx in prod, Vite in dev) — a
  // fetch of /health would hit the SPA fallback and return index.html.
  // Failure is silent by design: a missing version label must never blank the
  // app shell, and an unreachable backend already surfaces everywhere else.
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    api.get<{ version?: string }>("/version")
      .then((r) => {
        const v = r.data?.version;
        if (v) setVersion(`v${String(v).replace(/^v/, "")}`);
      })
      .catch(() => {});
  }, []);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(() => initialMode(location.pathname));

  // Navigating into a mode's page (link, back button, deep link) selects it.
  useEffect(() => {
    const m = modeForPath(location.pathname);
    if (m && m !== mode) setMode(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const selectMode = (m: Mode) => {
    setMode(m);
    try { localStorage.setItem("dh-mode", m); } catch { /* ignore */ }
    // Jump into the mode's first tool unless we're already inside that mode.
    if (modeForPath(location.pathname) !== m) {
      const first = MODES.find((x) => x.id === m)?.items[0];
      if (first) navigate(first.to);
    }
  };

  /**
   * Theme switch, revealed as a circle expanding out of the button.
   *
   * HOW IT WORKS
   * document.startViewTransition() snapshots the page before and after the DOM
   * change and stacks them as ::view-transition-old(root) and -new(root). We
   * suppress the default cross-fade in CSS and instead animate a clip-path
   * circle on the NEW snapshot, centred on the button, growing to the radius
   * of the farthest viewport corner — so the new theme is wiped over the old
   * one from the point the user clicked. Nothing in the app re-renders for the
   * animation; it is two bitmaps and a clip.
   *
   * WHY NOT A CSS-ONLY OVERLAY
   * The obvious alternative — an expanding coloured div over the page — can
   * only ever be one flat colour. It hides the transition rather than showing
   * it: the sidebar, cards and text all change underneath the disc and you
   * see the result pop when it is removed. A view transition reveals the
   * actual new page through the circle, which is the effect asked for.
   *
   * GRACEFUL EVERYWHERE
   * Firefox has no startViewTransition, and anyone on reduced-motion should
   * not get a 500ms wipe. Both fall through to the plain instant switch, which
   * is exactly what the app did before.
   */
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const apply = () => {
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("dh-theme", next); } catch { /* ignore */ }
    };

    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (typeof doc.startViewTransition !== "function" || reduced) {
      apply();
      return;
    }

    // Origin: the centre of the button that was clicked. Falls back to the
    // viewport centre if the ref is somehow not attached — a wrong origin is
    // survivable, a thrown error during a theme switch is not.
    const rect = themeBtnRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    // Distance to the farthest corner. Using half the viewport instead leaves
    // the far corners un-revealed at the end of the animation.
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const transition = doc.startViewTransition(apply);
    void transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 520,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          }
        );
      })
      // If the transition is skipped (another one starts, or the tab hides),
      // `ready` rejects. The DOM change has still been applied by then, so
      // there is nothing to repair — only an unhandled rejection to avoid.
      .catch(() => {});
  };

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];

  const renderItem = (item: NavItem) => (
    <NavLink key={item.to} to={item.to} end={item.end}
      className={({ isActive }) => `dash__nav-item ${isActive ? "dash__nav-item--active" : ""}`}
      title={item.label}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={ICONS[item.icon]} />
      </svg>
      <span className="dash__label">{item.label}</span>
      {/* Step number, right-aligned so it reads as an index rather than part
          of the label. Fades out with the labels on the icon rail, where
          there is no room and the icons already carry the order. */}
      {item.step !== undefined && (
        <span className="dash__step">{item.step}</span>
      )}
    </NavLink>
  );

  return (
    <div className={`dash ${pinned ? "dash--pinned" : "dash--rail"}`}>
      <aside className="dash__sidebar">
        <div className="dash__sidebar-header">
          <Link to="/" className="dash__logo" title="Home">
            {/* The monogram is the only thing in this header that survives the
                collapse — the wordmark shrinks to zero width and the pin button
                hides, which previously left the top of the rail as an empty
                60px bar above the first icon. It also restores a home target on
                the rail, which otherwise had none. */}
            <span className="dash__mark" aria-hidden="true">DH</span>
            <span className="dash__brand">Data Handler</span>
          </Link>
          {/* Pin, not collapse: unpinned already collapses itself on mouse-out,
              so the only thing left to choose is whether it stays. The icon is
              a pushpin rather than a chevron for that reason — a chevron would
              promise a direction the button no longer controls. */}
          <button
            className={`dash__toggle ${pinned ? "dash__toggle--on" : ""}`}
            onClick={togglePin}
            aria-pressed={pinned}
            title={pinned ? "Unpin — collapse when the mouse leaves" : "Pin the sidebar open"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z" />
            </svg>
          </button>
        </div>

        {/* Entry points */}
        <nav className="dash__nav dash__nav--top">
          {TOP_ITEMS.map(renderItem)}
        </nav>

        {/* Workspace switch */}
        <div className="dash__modes" role="tablist" aria-label="Workspace">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={mode === m.id}
              className={`dash__mode ${mode === m.id ? "dash__mode--active" : ""}`}
              onClick={() => selectMode(m.id)} title={`${m.label} tools`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONS[m.icon]} />
              </svg>
              <span className="dash__label">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Selected mode's tools (grows to push the footer to the bottom) */}
        <nav className="dash__nav dash__nav--mode">
          {activeMode.items.map(renderItem)}
        </nav>

        <div className="dash__sidebar-footer">
          <div className="dash__footer-links">
            {FOOTER_ITEMS.map(renderItem)}
          </div>
          <button className="dash__theme" ref={themeBtnRef} onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
            {theme === "dark" ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"/>
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
              </svg>
            )}
            <span className="dash__label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
          {/* Build identity, straight from /health. The backend reports the git
              tag it was built from, so a screenshot of the sidebar is enough to
              identify the exact build in a bug report. Fades out on the rail. */}
          {version && (
            <div className="dash__version" title={`Data Handler ${version}`}>
              {version}
            </div>
          )}
        </div>
      </aside>

      <main className="dash__main">
        <Outlet />
      </main>
    </div>
  );
}
