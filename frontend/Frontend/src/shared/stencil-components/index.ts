/**
 * Data Handler Stencil Web Component Wrappers
 *
 * These are vanilla Custom Element implementations that mirror the Stencil
 * components defined in ../../../stencil-ui/. They work directly in the
 * React app without needing a Stencil build step during development.
 *
 * For production, replace these with the built Stencil dist output.
 */

class OrcSpinnerElement extends HTMLElement {
  connectedCallback() {
    const size = this.getAttribute("size") || "md";
    const dim = size === "sm" ? 20 : size === "lg" ? 48 : 32;
    // Render the Data Handler logo as the spinning element. Replaces the old
    // circle-with-arc spinner so every loading state across the app shows
    // the brand mark spinning instead of a generic wheel.
    this.innerHTML = `<img
      src="/datahandler-icon.svg"
      alt="Loading"
      width="${dim}"
      height="${dim}"
      style="
        width:${dim}px;height:${dim}px;
        display:inline-block;
        animation:orc-spin 1.2s linear infinite;
        transform-origin:50% 50%;
        will-change:transform;
      "
    />`;
  }
}

class OrcBadgeElement extends HTMLElement {
  connectedCallback() {
    const variant = this.getAttribute("variant") || "neutral";
    const dot = this.hasAttribute("dot");
    const colors: Record<string, { bg: string; fg: string }> = {
      success: { bg: "rgba(5,150,105,0.08)", fg: "var(--dash-success,#1AA34A)" },
      warning: { bg: "rgba(217,119,6,0.08)", fg: "var(--dash-warning,#d97706)" },
      danger: { bg: "rgba(220,38,38,0.08)", fg: "var(--dash-danger,#dc2626)" },
      info: { bg: "var(--dash-primary-dim,rgba(29, 185, 84,0.08))", fg: "var(--dash-primary,#1DB954)" },
      neutral: { bg: "var(--dash-surface-hover,#f3f4f6)", fg: "var(--dash-text-secondary,#6b7280)" },
    };
    const c = colors[variant] || colors.neutral;
    const dotHtml = dot ? `<span style="width:6px;height:6px;border-radius:50%;background:${c.fg};display:inline-block"></span>` : "";
    const content = this.textContent || "";
    this.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:9999px;
      font-size:11.5px;font-weight:600;background:${c.bg};color:${c.fg}">${dotHtml}${content}</span>`;
  }
}

class OrcStatCardElement extends HTMLElement {
  connectedCallback() {
    const label = this.getAttribute("label") || "";
    const value = this.getAttribute("value") || "";
    const color = this.getAttribute("color") || "var(--dash-primary)";
    const subtitle = this.getAttribute("subtitle") || "";
    this.innerHTML = `<div style="background:var(--dash-surface);border:1px solid var(--dash-border);border-radius:16px;padding:22px 24px">
      <div style="font-size:12px;color:var(--dash-text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">${label}</div>
      <div style="font-size:30px;font-weight:800;margin-top:6px;color:${color}">${value}</div>
      ${subtitle ? `<div style="font-size:12px;color:var(--dash-text-secondary);margin-top:4px">${subtitle}</div>` : ""}
    </div>`;
  }
}

class OrcProgressBarElement extends HTMLElement {
  connectedCallback() {
    const value = parseFloat(this.getAttribute("value") || "0");
    const max = parseFloat(this.getAttribute("max") || "100");
    const label = this.getAttribute("label") || "";
    const pct = Math.min((value / max) * 100, 100);
    this.innerHTML = `<div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;height:6px;background:var(--dash-surface-hover);border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${pct}%;border-radius:6px;background:linear-gradient(90deg,var(--dash-primary),var(--dash-accent));transition:width 0.3s"></div>
      </div>
      ${label ? `<span style="font-size:12px;color:var(--dash-text-muted)">${label}</span>` : ""}
    </div>`;
  }
}

// Register only if not already defined
const defs: Array<[string, CustomElementConstructor]> = [
  ["orc-spinner", OrcSpinnerElement],
  ["orc-badge", OrcBadgeElement],
  ["orc-stat-card", OrcStatCardElement],
  ["orc-progress-bar", OrcProgressBarElement],
];

defs.forEach(([name, cls]) => {
  if (!customElements.get(name)) customElements.define(name, cls);
});

// Inject keyframes
if (!document.getElementById("orc-keyframes")) {
  const style = document.createElement("style");
  style.id = "orc-keyframes";
  style.textContent = "@keyframes orc-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}

export {};
