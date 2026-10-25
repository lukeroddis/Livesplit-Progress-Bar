import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const ENTRY_URL = "/@livesplit-entry.js";
const ENTRY_ID = "\0livesplit-entry";
const SCRIPT_TAG_RE = /\s*<script\b[^>]*\bsrc="([^"]*)"[^>]*>\s*<\/script>/gi;

/**
 * Build-only HTML transform.
 *
 * The application source is intentionally kept as classic, dependency-free
 * scripts so index.html and the generated test runner work from file://.
 * During a Vite build we replace those tags with one virtual module entry that
 * imports the same scripts in the same order (read from index.html itself, so
 * there is no second list to keep in sync) and lets Rollup emit a single JS
 * chunk. vite-plugin-singlefile then inlines that chunk and style.css into
 * dist/index.html.
 */
function singleFileEntryPlugin() {
  let scripts = [];
  return {
    name: "livesplit-single-file-entry",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        scripts = [...html.matchAll(SCRIPT_TAG_RE)].map((m) => m[1]);
        return html
          .replace(SCRIPT_TAG_RE, "")
          .replace("</body>", `    <script type="module" src="${ENTRY_URL}"></script>\n  </body>`);
      }
    },
    resolveId(id) {
      return id === ENTRY_URL ? ENTRY_ID : null;
    },
    load(id) {
      if (id !== ENTRY_ID) return null;
      return ['import "/style.css";', ...scripts.map((src) => `import "/${src}";`)].join("\n");
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [singleFileEntryPlugin(), viteSingleFile()],
  build: {
    target: "es2020",
    cssCodeSplit: false,
    reportCompressedSize: false
  }
});
