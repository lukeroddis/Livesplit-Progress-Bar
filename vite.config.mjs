import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Build-only HTML transform.
 *
 * The application source is intentionally kept as classic, dependency-free
 * scripts so the existing test runner and direct file:// usage keep working.
 * During a Vite build we replace those tags with one module entry
 * (src/build-entry.js), which imports the scripts in their original order and
 * lets Rollup emit a single JS chunk. vite-plugin-singlefile then inlines that
 * chunk and style.css into dist/index.html.
 */
function singleFileEntryPlugin() {
  return {
    name: "livesplit-single-file-entry",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace(
            /\s*<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/gi,
            ""
          )
          .replace(
            "</body>",
            '    <script type="module" src="/src/build-entry.js"></script>\n  </body>'
          );
      }
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
