import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDirectory = join(projectRoot, "scripts");
const scriptFiles = (await readdir(scriptsDirectory))
  .filter(file => file.endsWith(".mjs"))
  .sort();

for (const file of scriptFiles) {
  const result = spawnSync(process.execPath, ["--check", join(scriptsDirectory, file)], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr || `Syntax check failed for ${file}`);
}

const manifest = JSON.parse(await readFile(join(projectRoot, "module.json"), "utf8"));
for (const file of [
  "module.json",
  "languages/en.json",
  "languages/ru.json"
]) {
  JSON.parse(await readFile(join(projectRoot, file), "utf8"));
}

for (const file of [
  ...manifest.esmodules,
  ...manifest.styles,
  ...manifest.languages.map(language => language.path)
]) {
  await readFile(join(projectRoot, file));
}

for (const file of scriptFiles) {
  const source = await readFile(join(scriptsDirectory, file), "utf8");
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const target = resolve(scriptsDirectory, match[1]);
    await readFile(target);
  }
}

const en = JSON.parse(await readFile(join(projectRoot, "languages/en.json"), "utf8"));
const ru = JSON.parse(await readFile(join(projectRoot, "languages/ru.json"), "utf8"));
assert.deepEqual(flattenKeys(en), flattenKeys(ru), "Localization keys differ");

const creatureView = await readFile(join(scriptsDirectory, "creature-view.mjs"), "utf8");
const sectionView = await readFile(join(scriptsDirectory, "section-view.mjs"), "utf8");
assert.match(creatureView, /id:\s*"bestiary-creature-view-\{id\}"/);
assert.match(sectionView, /id:\s*"bestiary-section-view-\{id\}"/);
assert.doesNotMatch(
  `${creatureView}\n${sectionView}`,
  /foundry\.utils\.slugify/,
  "Foundry V14 does not expose foundry.utils.slugify"
);

console.log(`Checked ${scriptFiles.length} ES modules and project JSON files.`);

function flattenKeys(value, prefix = "") {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return child && typeof child === "object" && !Array.isArray(child)
        ? flattenKeys(child, path)
        : [path];
    })
    .sort();
}
