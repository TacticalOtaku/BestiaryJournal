import test from "node:test";
import assert from "node:assert/strict";

import { formatCount } from "../scripts/foundry/foundry-runtime.js";

function useLocale(lang, strings) {
  globalThis.game = {
    i18n: { lang, has: key => key in strings, format: (key, data) => strings[key].replace("{count}", data.count) }
  };
}

test("a count takes the plural form its language asks for", () => {
  useLocale("ru", {
    "X.one": "{count} существо", "X.few": "{count} существа", "X.many": "{count} существ", "X.other": "{count} существа"
  });
  assert.deepEqual([1, 3, 5, 11, 21, 0].map(count => formatCount("X", count)),
    ["1 существо", "3 существа", "5 существ", "11 существ", "21 существо", "0 существ"]);

  useLocale("en", { "X.one": "{count} creature", "X.other": "{count} creatures" });
  assert.deepEqual([1, 2, 0].map(count => formatCount("X", count)), ["1 creature", "2 creatures", "0 creatures"]);
});
