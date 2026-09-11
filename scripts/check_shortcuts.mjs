/**
 * Keyboard-shortcut parity check.
 *
 * The help sheet is rendered from `shortcuts.ts`. The bindings are implemented
 * in a `switch` inside AnnotateEditor.tsx. Nothing at runtime forces the two to
 * agree, and the failure is quiet in the worst way: the sheet promises a key,
 * the user presses it, nothing happens, and they stop trusting the whole list.
 *
 * So the agreement is enforced here instead. Every shortcut that declares a
 * `code` must have each of those literals present in the handler's source. A
 * binding deleted or renamed without updating the sheet fails the build.
 *
 * This is a source-text check, not a behavioural one — it proves the handler
 * still mentions the key, not that the key still does the right thing. That is
 * the correct trade: the realistic regression is deletion, not a subtly wrong
 * action, and a behavioural test would need a DOM and a canvas to be worth
 * anything.
 *
 * Run: node --experimental-strip-types scripts/check_shortcuts.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const annotateDir = join(root, "frontend", "Frontend", "src", "app", "pages", "annotate");

const handler = readFileSync(join(annotateDir, "AnnotateEditor.tsx"), "utf8");
const table = readFileSync(join(annotateDir, "shortcuts.ts"), "utf8");

// shortcuts.ts is plain data with no imports, so it is parsed by regex rather
// than imported — this script must run with no build step and no node_modules.
const entries = [...table.matchAll(
  /\{\s*keys:\s*\[([^\]]*)\][^}]*?label:\s*"([^"]*)"(?:[^}]*?code:\s*\[([^\]]*)\])?[^}]*?\}/g
)];

if (entries.length < 20) {
  console.error(
    `Parsed only ${entries.length} shortcuts from shortcuts.ts — the regex has ` +
    "probably drifted from the file's shape. Fix this script rather than " +
    "letting it silently check nothing."
  );
  process.exit(1);
}

/**
 * Pull the string literals out of a `code: [...]` array.
 *
 * Written as a scanner rather than a regex because the entries mix quote
 * styles — `'case "v"'` wraps a double-quoted fragment in single quotes. A
 * regex for double-quoted strings matches the INNER `"v"` and the check then
 * asserts only that the file contains the letter v, which every file does.
 * That bug shipped once; the self-check below exists so it cannot again.
 */
function stringLiterals(source) {
  const out = [];
  for (let i = 0; i < source.length; i++) {
    const quote = source[i];
    if (quote !== '"' && quote !== "'" && quote !== "`") continue;
    let value = "";
    i++;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") {
        value += source[i + 1];
        i += 2;
      } else {
        value += source[i++];
      }
    }
    out.push(value);
  }
  return out;
}

let failures = 0;
let checked = 0;
let shortest = Infinity;

for (const [, keysRaw, label, codeRaw] of entries) {
  if (!codeRaw) continue;                 // browser-owned binding, nothing to check
  const keys = stringLiterals(keysRaw).join(" ");
  for (const needle of stringLiterals(codeRaw)) {
    checked++;
    shortest = Math.min(shortest, needle.length);
    if (!handler.includes(needle)) {
      failures++;
      console.error(
        `  MISSING  ${keys} — "${label}"\n` +
        `           expected \`${needle}\` in AnnotateEditor.tsx, not found`
      );
    }
  }
}

// Self-check. Every real needle is a handler fragment ("case \"v\"", 8 chars).
// A one- or two-character needle means the extraction has collapsed to
// matching bare letters — which passes against any file and proves nothing.
if (checked === 0 || shortest < 5) {
  console.error(
    `Extraction looks broken: ${checked} needle(s), shortest ${shortest} chars.\n` +
    "Real needles are handler fragments, not single characters. Fix this " +
    "script — as written it would pass against an empty handler."
  );
  process.exit(1);
}

if (failures) {
  console.error(
    `\n${failures} shortcut(s) listed in the help sheet are not implemented in ` +
    "the handler.\nEither restore the binding or remove it from shortcuts.ts."
  );
  process.exit(1);
}

console.log(
  `All ${entries.length} documented shortcuts check out ` +
  `(${checked} handler literals verified).`
);
