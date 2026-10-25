/**
 * verify-single-file.mjs - Enforce the single-file distribution contract.
 *
 * Runs automatically after `npm run build` (via the npm `postbuild` hook).
 * Fails if dist/ contains anything other than index.html, or if that file
 * references external/local scripts, stylesheets, or other assets.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(rootDir, "dist");
const indexPath = join(distDir, "index.html");

const failures = [];

let files = [];
try {
  files = readdirSync(distDir, { recursive: true })
    .map((entry) => relative(distDir, join(distDir, entry)))
    .filter((entry) => statSync(join(distDir, entry)).isFile());
} catch {
  failures.push("dist/ does not exist; run `npm run build` first.");
}

if (files.length !== 1 || files[0] !== "index.html") {
  failures.push(
    `dist/ must contain only index.html, found: ${files.length ? files.join(", ") : "(empty)"}`
  );
}

let html = "";
try {
  html = readFileSync(indexPath, "utf8");
} catch {
  failures.push("dist/index.html is missing.");
}

if (html) {
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
    failures.push(`External <script src> found: ${externalScripts.join(", ")}`);
  }
  if (stylesheetLinks.length) {
    failures.push(`External stylesheet <link> found: ${stylesheetLinks.join(", ")}`);
  }
  if (localAssetRefs.length) {
    failures.push(`Local asset reference(s) found: ${[...new Set(localAssetRefs)].join(", ")}`);
  }
  if (/@import\s+/i.test(html)) {
    failures.push("CSS @import found; all styles must be inlined.");
  }
  if (!/<style\b[^>]*>/i.test(html)) {
    failures.push("No inline <style> block found.");
  }
  if (!/<script\b[^>]*type=["']module["'][^>]*>/i.test(html)) {
    failures.push("No inline module <script> found.");
  }
}

if (failures.length) {
  console.error("✗ Single-file build verification failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ dist/index.html is the only build output (${Buffer.byteLength(html)} bytes).`);
console.log("✓ JavaScript and CSS are fully inlined; no external asset references found.");
