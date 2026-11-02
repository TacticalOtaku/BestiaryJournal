import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: Base => Base } },
  utils: { randomID: () => "tile", mergeObject: (base, extra) => ({ ...base, ...extra }) }
};
const { BestiaryTileEditor } = await import("../scripts/ui/tile-editor.js");

test("selecting then clearing a first image updates the clear control without rerendering", () => {
  const app = new BestiaryTileEditor();
  const empty = new Set(["is-empty"]);
  const preview = { classList: { toggle: (name, value) => value ? empty.add(name) : empty.delete(name) } };
  const img = { ...preview, src: "" };
  const input = { value: "" };
  const clear = { hidden: true };
  app.element = { querySelector: selector => ({
    ".tile-editor-preview img": img,
    ".tile-editor-preview": preview,
    'input[name="image"]': input,
    '[data-action="clearImage"]': clear
  })[selector] };
  app._applyImage("forest.webp");
  assert.equal(clear.hidden, false);
  assert.equal(input.value, "forest.webp");
  assert.equal(img.src, "forest.webp");
  assert.equal(empty.has("is-empty"), false);
  app._onClearImage();
  assert.equal(clear.hidden, true);
  assert.equal(input.value, "");
  assert.equal(img.src, "");
  assert.equal(empty.has("is-empty"), true);
});
