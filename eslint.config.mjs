// ESLint (dev-only): catches undefined names (a ReferenceError at runtime) and dead code.
// Run with `npm run lint`; tests/test_project_rules.py runs it as part of the suite.
import globals from "globals";

const sharedRules = {
  "no-undef": "error",
  // Unused parameters are allowed (event handlers, documented signatures); unused variables
  // and functions are not. Prefix a deliberately unused binding with "_".
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }]
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "tests/test_runner.html"]
  },
  {
    // App source: classic browser scripts, shared through window.LiveSplit.*
    files: ["src/**/*.js", "layout.js", "overlay.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: { ...globals.browser }
    },
    rules: sharedRules
  },
  {
    // In-browser specs and harness (mini-test.js globals, fake LiveSplit server)
    files: ["tests/unit/**/*.js", "tests/harness/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        describe: "readonly",
        suite: "readonly",
        it: "readonly",
        test: "readonly",
        assert: "readonly",
        assertEqual: "readonly"
      }
    },
    rules: sharedRules
  },
  {
    // Build tooling
    files: ["*.mjs", "scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    },
    rules: sharedRules
  }
];
