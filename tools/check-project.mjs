#!/usr/bin/env node
/**
 * Project checks that do not need Foundry running:
 *   - every script parses as an ES module
 *   - JSON files are valid
 *   - manifest paths exist
 *   - relative imports resolve
 *   - every localization key used in code or templates exists in every locale
 *   - ApplicationV2 ids are unique
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function fail(message) {
  problems.push(message);
}

/** Files with the extension under the directory, layer folders included. */
function listFiles(directory, extension) {
  const full = join(root, directory);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(path, extension);
    return entry.name.endsWith(extension) ? [path] : [];
  });
}

const scripts = [...listFiles("scripts", ".js"), ...listFiles("tools", ".mjs")];
const templates = listFiles("templates", ".hbs");
const locales = listFiles("lang", ".json");

// ── Syntax ──
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
  } catch (error) {
    fail(`Syntax error in ${file}:\n${error.stderr?.toString() ?? error.message}`);
  }
}

// ── JSON ──
const parsedJson = new Map();
for (const file of [...locales, "module.json", "package.json"]) {
  try {
    parsedJson.set(file, JSON.parse(readFileSync(join(root, file), "utf8")));
  } catch (error) {
    fail(`Invalid JSON in ${file}: ${error.message}`);
  }
}

// ── Manifest paths ──
const manifest = parsedJson.get("module.json");
if (manifest) {
  const declared = [
    ...(manifest.esmodules ?? []),
    ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map(entry => entry.path)
  ];
  for (const path of declared) {
    if (!existsSync(join(root, path))) fail(`module.json references a missing file: ${path}`);
  }
  if (manifest.version && manifest.download && !manifest.download.includes(manifest.version)) {
    fail(`module.json download URL does not match version ${manifest.version}`);
  }
  const pkg = parsedJson.get("package.json");
  if (pkg && manifest.version && pkg.version !== manifest.version) {
    fail(`package.json version ${pkg.version} does not match module.json ${manifest.version}`);
  }
}

// ── Imports ──

/** Named exports of a module: declarations plus `export { ... }` lists. */
function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1].split(",")) {
      const alias = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (alias) names.add(alias);
    }
  }
  return names;
}

for (const file of scripts) {
  const source = readFileSync(join(root, file), "utf8");
  for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(join(root, file)), match[1]);
    if (!existsSync(target)) fail(`${file} imports a missing module: ${match[1]}`);
  }
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = resolve(dirname(join(root, file)), match[2]);
    if (!existsSync(target)) continue;
    const available = exportedNames(readFileSync(target, "utf8"));
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (!name || available.has(name)) continue;
      fail(`${file} imports "${name}" which ${match[2]} does not export`);
    }
  }
  for (const match of source.matchAll(/modules\/bestiary-journal\/([^"']+)/g)) {
    if (!existsSync(join(root, match[1]))) fail(`${file} references a missing asset: ${match[1]}`);
  }
}

// ── Handlebars block balance ──
for (const file of templates) {
  const source = readFileSync(join(root, file), "utf8");
  const open = [];
  for (const match of source.matchAll(/\{\{([#/])([a-zA-Z0-9_.]+)/g)) {
    if (match[1] === "#") {
      open.push(match[2]);
      continue;
    }
    const expected = open.pop();
    if (expected !== match[2]) {
      fail(`${file} closes {{/${match[2]}}} but {{#${expected ?? "nothing"}}} was open`);
      break;
    }
  }
  if (open.length) fail(`${file} leaves blocks unclosed: ${open.join(", ")}`);
}

// ── Localization ──
function flatten(value, prefix = "", into = new Set()) {
  for (const [key, entry] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) flatten(entry, path, into);
    else into.add(path);
  }
  return into;
}

const localeKeys = new Map();
for (const file of locales) {
  const data = parsedJson.get(file);
  if (data) localeKeys.set(file, flatten(data));
}

const usedKeys = new Set();
const KEY_PATTERN = /BESTIARY\.[A-Za-z0-9_.]+/g;
const DYNAMIC_PREFIXES = ["BESTIARY.Data.", "BESTIARY.Speed", "BESTIARY.Block.", "BESTIARY.Tier."];

for (const file of [...scripts, ...templates]) {
  const source = readFileSync(join(root, file), "utf8");
  for (const match of source.matchAll(KEY_PATTERN)) {
    // Keys assembled at runtime (`BESTIARY.Speed${key}`) cannot be checked.
    const rest = source.slice(match.index + match[0].length);
    if (match[0].endsWith(".") || rest.startsWith("$")) continue;
    usedKeys.add(match[0]);
  }
}

for (const [file, keys] of localeKeys) {
  for (const key of usedKeys) {
    if (keys.has(key)) continue;
    if (DYNAMIC_PREFIXES.some(prefix => key.startsWith(prefix) && !keys.has(key) && isDynamic(key, keys))) continue;
    fail(`${file} is missing the localization key ${key}`);
  }
}

function isDynamic(key, keys) {
  // A parent branch existing is good enough for runtime-assembled leaves.
  const parent = key.slice(0, key.lastIndexOf("."));
  return [...keys].some(candidate => candidate.startsWith(`${parent}.`));
}

// ── Unique application ids ──
const seenIds = new Map();
for (const file of scripts) {
  const source = readFileSync(join(root, file), "utf8");
  for (const match of source.matchAll(/id:\s*"([a-z0-9-]+(?:-\{id\})?)"/g)) {
    const id = match[1];
    if (seenIds.has(id) && seenIds.get(id) !== file) {
      fail(`Duplicate application id "${id}" in ${file} and ${seenIds.get(id)}`);
    }
    seenIds.set(id, file);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) found:\n`);
  for (const problem of problems) console.error(` - ${problem}`);
  process.exit(1);
}

console.log(`Checked ${scripts.length} scripts, ${templates.length} templates, ${locales.length} locales — all good.`);
