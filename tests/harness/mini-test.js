/**
 * tests/harness/mini-test.js - Lightweight In-Browser Test Framework
 * 
 * Provides standard describe(), it(), assert(), assertEqual() test primitives
 * with synchronous test execution, suite reporting, and DOM card rendering.
 */

(function () {
  "use strict";

  const suites = [];
  let currentSuite = null;
  let totalPassed = 0;
  let totalFailed = 0;

  function describe(name, fn) {
    currentSuite = { name, tests: [] };
    suites.push(currentSuite);
    fn();
  }

  function it(name, testFn) {
    if (!currentSuite) {
      currentSuite = { name: "Default Suite", tests: [] };
      suites.push(currentSuite);
    }
    try {
      testFn();
      currentSuite.tests.push({ name, pass: true });
      totalPassed++;
    } catch (err) {
      currentSuite.tests.push({ name, pass: false, error: err.message });
      totalFailed++;
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || "Assertion failed");
    }
  }

  function assertEqual(actual, expected, message) {
    const aStr = JSON.stringify(actual);
    const eStr = JSON.stringify(expected);
    if (aStr !== eStr) {
      throw new Error(message || `Expected ${eStr}, got ${aStr}`);
    }
  }

  function renderResults() {
    const resultsContainer = document.getElementById("results");
    if (resultsContainer) {
      resultsContainer.innerHTML = "";
      suites.forEach((suite) => {
        const card = document.createElement("div");
        card.className = "suite-card";

        const title = document.createElement("div");
        title.className = "suite-title";
        title.innerText = suite.name;
        card.appendChild(title);

        suite.tests.forEach((t) => {
          const row = document.createElement("div");
          row.className = "test-row";
          row.innerHTML = `
            <div>
              <div class="test-name">${t.name}</div>
              ${t.error ? `<div class="error-msg">⚠️ ${t.error}</div>` : ""}
            </div>
            <span class="status-pill ${t.pass ? "ok" : "error"}">${t.pass ? "PASSED" : "FAILED"}</span>
          `;
          card.appendChild(row);
        });

        resultsContainer.appendChild(card);
      });
    }

    const badge = document.getElementById("total-badge");
    if (badge) {
      if (totalFailed === 0) {
        badge.className = "badge pass";
        badge.innerText = `✓ ALL ${totalPassed} TESTS PASSED`;
      } else {
        badge.className = "badge fail";
        badge.innerText = `❌ ${totalFailed} FAILED / ${totalPassed} PASSED`;
      }
    }
  }

  // Expose global test harness primitives
  window.describe = describe;
  window.suite = describe;
  window.it = it;
  window.test = it;
  window.assert = assert;
  window.assertEqual = assertEqual;

  window.MiniTest = {
    suites,
    get totalPassed() { return totalPassed; },
    get totalFailed() { return totalFailed; },
    renderResults
  };
})();
