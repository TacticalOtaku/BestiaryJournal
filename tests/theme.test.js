import test from "node:test";
import assert from "node:assert/strict";

import {
  COVER_SIZES,
  effectiveMotion,
  normalizeAccent,
  normalizeCoverSize,
  resolveTheme,
} from "../scripts/core/theme.js";
import { stampTheme } from "../scripts/foundry/theme-root.js";

test("«Авто» follows Foundry's scheme, anything unknown is night", () => {
  assert.equal(resolveTheme("auto", true), "parchment");
  assert.equal(resolveTheme("auto", false), "night");
  assert.equal(resolveTheme("parchment", false), "parchment");
  assert.equal(resolveTheme("bogus", true), "night");
  assert.equal(normalizeAccent("rose"), "rose");
  assert.equal(normalizeAccent("teal"), "brass");
});

test("the system and Foundry cap motion, the user's choice holds under the cap", () => {
  assert.equal(effectiveMotion("full"), "full");
  assert.equal(effectiveMotion("full", { reducedMotion: true }), "off");
  assert.equal(effectiveMotion("full", { performanceLow: true }), "reduced");
  assert.equal(effectiveMotion("off", { performanceLow: true }), "off");
  assert.equal(effectiveMotion("bogus"), "full");
});

test("cover sizes validate and stamp data-cover-size onto bestiary windows", () => {
  assert.deepEqual(COVER_SIZES, ["small", "medium", "large"]);
  assert.equal(normalizeCoverSize("small"), "small");
  assert.equal(normalizeCoverSize("large"), "large");
  assert.equal(normalizeCoverSize("huge"), "medium");

  const values = {
    uiTheme: "night",
    uiAccent: "brass",
    uiDensity: "comfortable",
    uiCoverSize: "small",
    uiMotion: "full",
  };
  const previousGame = globalThis.game;
  const previousDocument = globalThis.document;
  const element = {
    dataset: {},
    classList: {
      contains: (name) => name === "bestiary-app",
    },
  };
  globalThis.game = { settings: { get: (scope, key) => values[key] } };
  globalThis.document = { body: { classList: { contains: () => false } } };
  try {
    stampTheme(element);
    assert.equal(element.dataset.coverSize, "small");
    values.uiCoverSize = "bogus";
    stampTheme(element);
    assert.equal(element.dataset.coverSize, "medium");
  } finally {
    globalThis.game = previousGame;
    globalThis.document = previousDocument;
  }
});

test("stampTheme applies aim-theme-fade only on live theme transitions when motion is enabled", () => {
  const values = {
    uiTheme: "night",
    uiAccent: "brass",
    uiDensity: "comfortable",
    uiCoverSize: "medium",
    uiMotion: "full",
  };
  const previousGame = globalThis.game;
  const previousDocument = globalThis.document;
  const classes = new Set(["bestiary-app"]);
  const element = {
    dataset: {},
    classList: {
      contains: (name) => classes.has(name),
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  globalThis.game = { settings: { get: (_scope, key) => values[key] } };
  globalThis.document = { body: { classList: { contains: () => false } } };
  try {
    stampTheme(element);
    assert.equal(classes.has("aim-theme-fade"), false);

    values.uiTheme = "parchment";
    stampTheme(element);
    assert.equal(classes.has("aim-theme-fade"), true);

    classes.delete("aim-theme-fade");
    values.uiMotion = "off";
    values.uiTheme = "night";
    stampTheme(element);
    assert.equal(classes.has("aim-theme-fade"), false);
  } finally {
    globalThis.game = previousGame;
    globalThis.document = previousDocument;
  }
});
