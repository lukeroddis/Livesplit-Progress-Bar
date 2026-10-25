/**
 * tests/harness/fake-therun.js - Scriptable fake therun.gg HTTP API for the in-browser suite
 *
 * Wraps window.fetch before the app scripts load so the test runner never calls the real
 * therun.gg / races.therun.gg APIs (both allow file:// origins, so real requests would
 * succeed and mutate race state asynchronously). Requests to those hosts answer from
 * FakeTherun.routes (exact URL -> JSON body) and 404 otherwise; every therun request is
 * recorded in FakeTherun.requests. Tests that assign window.fetch themselves still work.
 */

(function () {
  "use strict";

  const THERUN_URL = /^https:\/\/(races\.)?therun\.gg\//;
  const realFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;

  const FakeTherun = {
    routes: new Map(),
    requests: [],

    reset() {
      this.routes.clear();
      this.requests.length = 0;
    },

    respond(url, body) {
      this.routes.set(url, body);
    },

    // Resolves once every queued fetch / json promise chain has settled
    flush() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (THERUN_URL.test(url)) {
      FakeTherun.requests.push(url);
      const hasRoute = FakeTherun.routes.has(url);
      const body = hasRoute ? FakeTherun.routes.get(url) : null;
      return Promise.resolve({
        ok: hasRoute,
        status: hasRoute ? 200 : 404,
        json: () => Promise.resolve(body)
      });
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error("fetch unavailable"));
  };

  window.FakeTherun = FakeTherun;
})();
