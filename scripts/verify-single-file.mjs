/**
 * verify-single-file.mjs - Enforce the single-file distribution contract.
 *
 * Runs automatically after `npm run build` (via the npm `postbuild` hook).
 * Fails if dist/ contains anything other than index.html and the optional
 * OBS dock page dock.html, or if either page references external/local
 * scripts, stylesheets, or other assets.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(rootDir, "dist");
const EXPECTED_FILES = ["dock.html", "index.html"];

const failures = [];

let files = [];
try {
  files = readdirSync(distDir, { recursive: true })
    .map((entry) => relative(distDir, join(distDir, entry)))
    .filter((entry) => statSync(join(distDir, entry)).isFile());
} catch {
  failures.push("dist/ does not exist; run `npm run build` first.");
}

if (files.slice().sort().join() !== EXPECTED_FILES.join()) {
  failures.push(
    `dist/ must contain only ${EXPECTED_FILES.join(" and ")}, found: ${files.length ? files.join(", ") : "(empty)"}`
  );
}

function readPage(name) {
  try {
    return readFileSync(join(distDir, name), "utf8");
  } catch {
    failures.push(`dist/${name} is missing.`);
    return "";
  }
}

/** Reports any script, stylesheet or asset the page would load from outside itself. */
function checkSelfContained(html, name) {
  // Character ranges of inline <script> bodies. Markup built by inlined JS
  // (e.g. avatar `<img src="${escapeHtml(url)}">` template literals) appears
  // there as text; its interpolated values are runtime data, not assets.
  const scriptBodies = [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)]
    .map((match) => {
      const start = match.index + match[1].length;
      return [start, start + match[2].length];
    });
  const inScriptBody = (index) =>
    scriptBodies.some(([start, end]) => index >= start && index < end);

  const tagMatches = [...html.matchAll(/<(?:script|link|img|source|audio|video|iframe)\b[^>]*>/gi)];
  const tags = tagMatches.map((match) => match[0]);

  const externalScripts = tags.filter(
    (tag) => /^<script\b/i.test(tag) && /\bsrc\s*=/i.test(tag)
  );
  const stylesheetLinks = tags.filter(
    (tag) => /^<link\b/i.test(tag) && /\brel\s*=\s*["']?stylesheet/i.test(tag)
  );

  const localAssetRefs = [];
  for (const tagMatch of tagMatches) {
    const fromScript = inScriptBody(tagMatch.index);
    for (const match of tagMatch[0].matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
      const value = match[1].trim();
      if (!value) continue;
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue;
      if (fromScript && value.includes("${")) continue;
      localAssetRefs.push(value);
    }
  }

  if (externalScripts.length) {
    failures.push(`${name}: external <script src> found: ${externalScripts.join(", ")}`);
  }
  if (stylesheetLinks.length) {
    failures.push(`${name}: external stylesheet <link> found: ${stylesheetLinks.join(", ")}`);
  }
  if (localAssetRefs.length) {
    failures.push(`${name}: local asset reference(s) found: ${[...new Set(localAssetRefs)].join(", ")}`);
  }
  if (/@import\s+/i.test(html)) {
    failures.push(`${name}: CSS @import found; all styles must be inlined.`);
  }
}

const html = readPage("index.html");
if (html) {
  checkSelfContained(html, "index.html");
  if (!/<style\b[^>]*>/i.test(html)) {
    failures.push("index.html: no inline <style> block found.");
  }
  if (!/<script\b[^>]*type=["']module["'][^>]*>/i.test(html)) {
    failures.push("index.html: no inline module <script> found.");
  }
}

const dockHtml = readPage("dock.html");
if (dockHtml) checkSelfContained(dockHtml, "dock.html");

if (failures.length) {
  console.error("✗ Single-file build verification failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ dist/ holds only index.html (${Buffer.byteLength(html)} bytes) and dock.html (${Buffer.byteLength(dockHtml)} bytes).`);
console.log("✓ Both pages are fully self-contained; no external asset references found.");
