import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const ENTRY_URL = "/@livesplit-entry.js";
const ENTRY_ID = "\0livesplit-entry";
const SCRIPT_TAG_RE = /\s*<script\b[^>]*\bsrc="([^"]*)"[^>]*>\s*<\/script>/gi;
const STYLESHEET_TAG_RE = /\s*<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]*)"[^>]*>/gi;

/**
 * Build-only HTML transform.
 *
 * The application source is intentionally kept as classic, dependency-free
 * scripts and plain stylesheets so index.html and the generated test runner
 * work from file://. During a Vite build we replace those <script> and
 * stylesheet <link> tags with one virtual module entry that imports the same
 * files in the same order (read from index.html itself, so there is no second
 * list to keep in sync) and lets Rollup emit a single JS chunk and a single
 * CSS chunk. vite-plugin-singlefile then inlines both into dist/index.html.
 */
function singleFileEntryPlugin() {
  let scripts = [];
  let stylesheets = [];
  return {
    name: "livesplit-single-file-entry",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        scripts = [...html.matchAll(SCRIPT_TAG_RE)].map((m) => m[1]);
        stylesheets = [...html.matchAll(STYLESHEET_TAG_RE)].map((m) => m[1]);
        return html
          .replace(SCRIPT_TAG_RE, "")
          .replace(STYLESHEET_TAG_RE, "")
          .replace("</body>", `    <script type="module" src="${ENTRY_URL}"></script>\n  </body>`);
      }
    },
    resolveId(id) {
      return id === ENTRY_URL ? ENTRY_ID : null;
    },
    load(id) {
      if (id !== ENTRY_ID) return null;
      return [...stylesheets, ...scripts].map((src) => `import "/${src}";`).join("\n");
    }
  };
}

/**
 * Pure: inlines a page's local classic scripts (<script src="..."></script>) as
 * <script> blocks, reading each file with readFile(src).
 */
export function inlineLocalScripts(html, readFile) {
  // A "</script" inside the code would end the block early: escape it as "<\/script"
  return html.replace(/<script src="([^":]+)"><\/script>/g, (_, src) =>
    `<script>\n${readFile(src).replace(/<\/script/gi, "<\\/script")}\n</script>`);
}

/**
 * Emits dock.html (the optional OBS Custom Browser Dock) into dist/ next to
 * index.html as one self-contained page: the shared scripts it loads from src/
 * (the settings renderer) are inlined.
 */
function dockPagePlugin() {
  return {
    name: "livesplit-dock-page",
    apply: "build",
    generateBundle() {
      const html = readFileSync(new URL("./dock.html", import.meta.url), "utf8");
      const source = inlineLocalScripts(html, (src) => readFileSync(new URL(`./${src}`, import.meta.url), "utf8"));
      this.emitFile({ type: "asset", fileName: "dock.html", source });
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [singleFileEntryPlugin(), viteSingleFile(), dockPagePlugin()],
  build: {
    target: "es2020",
    cssCodeSplit: false,
    reportCompressedSize: false
  }
});
