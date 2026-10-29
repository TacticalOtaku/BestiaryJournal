import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// WCAG AA for text: every colour used as text reaches 4.5:1 on every surface, in both themes (as AIM checks its own).
const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

function block(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} is missing`);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(([, key, value]) => [key, value]));
}

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["suite-bg", "suite-surface", "suite-raised", "suite-sunken"];
const TEXT = [
  "suite-text", "suite-muted", "suite-subtle", "suite-danger", "suite-positive", "suite-warning",
  "tier-unknown", "tier-rumors", "tier-studied", "tier-mastered", "tier-never"
];
const ACCENTS = ["acc-brass", "acc-embers", "acc-arcane", "acc-forest", "acc-frost", "acc-rose"];

const night = block(".bestiary-app");
const themes = { night, parchment: { ...night, ...block('.bestiary-app[data-theme="parchment"]') } };

for (const [name, tokens] of Object.entries(themes)) {
  test(`«${name}»: text, tier and accent colours reach 4.5:1 on every surface`, () => {
    for (const token of [...TEXT, ...ACCENTS]) {
      assert.ok(tokens[token], `${name}: --${token} is not a hex colour`);
      const worst = Math.min(...SURFACES.map(surface => contrast(tokens[token], tokens[surface])));
      assert.ok(worst >= 4.5, `${name}: --${token} ${tokens[token]} is ${worst.toFixed(2)}:1`);
    }
  });

  test(`«${name}»: the label on an accent button reads on every accent`, () => {
    for (const accent of ACCENTS) {
      const ratio = contrast(tokens["suite-on-accent"], tokens[accent]);
      assert.ok(ratio >= 4.5, `${name}: --suite-on-accent on --${accent} is ${ratio.toFixed(2)}:1`);
    }
  });
}
