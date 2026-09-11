/**
 * Sidebar-rail layout check.
 *
 * WHY THIS EXISTS
 * The collapsed sidebar hid its labels with `opacity: 0` and nothing else. An
 * invisible label in a `white-space: nowrap` flex row still reserves its full
 * text width, so inside a 72px rail with `overflow-x: hidden` the ICON was
 * pushed out of view — the rail rendered as a column of empty boxes. The CSS
 * comment claimed the width collapsed; the rule did not. Reviewing prose does
 * not catch that, so it is checked mechanically.
 *
 * Two assertions:
 *
 *  1. Every rule that hides something on the rail with `opacity: 0` must also
 *     remove the space it occupies (max-width/min-width/height/display/gap).
 *     Fading without collapsing is the bug.
 *
 *  2. The widest thing that must fit inside the rail — an icon plus the
 *     container padding it sits in — is actually narrower than the rail.
 *     Arithmetic, not judgement.
 *
 * Run: node scripts/check_sidebar_rail.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = join(root, "frontend", "Frontend", "src", "app", "layouts", "DashboardLayout.css");
const css = readFileSync(cssPath, "utf8");

let failures = 0;
const fail = (msg) => { failures++; console.error("  FAIL  " + msg); };

// ── 1. opacity:0 on the rail must be paired with a size collapse ─────────
const COLLAPSERS = ["max-width", "min-width", "height", "display", "width", "gap"];
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
let checkedHides = 0;

for (const [, selectorRaw, body] of rules) {
  const selector = selectorRaw.trim();
  if (!selector.includes(".dash--rail")) continue;
  if (!selector.includes(":not(:hover)")) continue;
  if (!/opacity:\s*0\s*;/.test(body)) continue;

  checkedHides++;
  const collapses = COLLAPSERS.some((prop) =>
    new RegExp(`(^|;|\\s)${prop}:\\s*0`).test(body) || /display:\s*none/.test(body)
  );
  if (!collapses) {
    fail(
      `\`${selector.split("\n").map((s) => s.trim()).join(" ")}\`\n` +
      "        sets opacity:0 but nothing that removes its layout space.\n" +
      "        An invisible label still pushes the icon out of a 72px rail."
    );
  }
}

if (checkedHides === 0) {
  fail("found no rail-hiding rules at all — this check is not checking anything");
}

// ── 2. the icon has to physically fit ────────────────────────────────────
const px = (re, label) => {
  const m = css.match(re);
  if (!m) { fail(`could not read ${label} from the CSS`); return null; }
  return parseFloat(m[1]);
};

const rail = px(/\.dash\s*\{\s*--rail:\s*(\d+(?:\.\d+)?)px/, "--rail");
const navPadX = px(/\.dash__nav\s*\{[^}]*padding:\s*\d+(?:\.\d+)?px\s+(\d+(?:\.\d+)?)px/, ".dash__nav padding");
const itemPadX = px(/\.dash__nav-item\s*\{[^}]*padding:\s*\d+(?:\.\d+)?px\s+(\d+(?:\.\d+)?)px/, ".dash__nav-item padding");
const stepBorder = px(/\.dash__nav--mode \.dash__nav-item\s*\{\s*border-left:\s*(\d+(?:\.\d+)?)px/, "workflow border-left");

const ICON = 20;   // <svg width="20"> in renderItem

if (rail !== null && navPadX !== null && itemPadX !== null && stepBorder !== null) {
  const available = rail - navPadX * 2 - itemPadX * 2 - stepBorder;
  if (available < ICON) {
    fail(
      `the icon does not fit: rail ${rail}px - nav padding ${navPadX * 2}px - ` +
      `item padding ${itemPadX * 2}px - border ${stepBorder}px = ${available}px ` +
      `for a ${ICON}px icon.`
    );
  } else {
    console.log(
      `  rail fit: ${rail} - ${navPadX * 2} - ${itemPadX * 2} - ${stepBorder} = ` +
      `${available}px available for a ${ICON}px icon (${available - ICON}px spare)`
    );
  }
}

if (failures) {
  console.error(`\n${failures} sidebar-rail problem(s).`);
  process.exit(1);
}
console.log(`Sidebar rail OK (${checkedHides} hide-rules checked).`);
