/**
 * tests/harness/test-utils.js - Shared helpers for the in-browser specs (window.TestUtils)
 *
 * - mountHtml(html): inserts markup at the start of <body>, so its ids and classes win over the
 *   runner page's own elements in getElementById / querySelector; returns { root, el(id), remove() }
 * - captureWindowListeners(fn): runs fn while window.addEventListener records instead of
 *   registering, so specs can call handlers directly without firing the app's own listeners
 * - withFakeTimers(fn): runs fn(clock) with setTimeout/clearTimeout on a manual clock;
 *   clock.tick(ms) fires due timers in order (including ones scheduled while ticking)
 * - waitFor(condition, label, timeoutMs): polls until condition() is truthy (async specs)
 */

(function () {
  "use strict";

  function mountHtml(html) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.prepend(root);
    return {
      root,
      el: (id) => document.getElementById(id),
      remove: () => root.remove()
    };
  }

  function captureWindowListeners(fn) {
    const listeners = {};
    const real = window.addEventListener;
    window.addEventListener = (type, handler) => { (listeners[type] = listeners[type] || []).push(handler); };
    try {
      fn();
    } finally {
      window.addEventListener = real;
    }
    return {
      listeners,
      fire: (type, event) => (listeners[type] || []).forEach((h) => h(event))
    };
  }

  function withFakeTimers(fn) {
    const realSet = window.setTimeout;
    const realClear = window.clearTimeout;
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    const clock = {
      get now() { return now; },
      get pending() { return timers.size; },
      tick(ms) {
        const end = now + ms;
        for (;;) {
          let due = null;
          timers.forEach((t, id) => {
            if (t.at <= end && (!due || t.at < due.at || (t.at === due.at && id < due.id))) due = { ...t, id };
          });
          if (!due) break;
          timers.delete(due.id);
          now = due.at;
          due.fn();
        }
        now = end;
      }
    };
    window.setTimeout = (cb, delay = 0) => {
      const id = nextId++;
      timers.set(id, { fn: cb, at: now + Math.max(0, delay) });
      return id;
    };
    window.clearTimeout = (id) => { timers.delete(id); };
    try {
      return fn(clock);
    } finally {
      window.setTimeout = realSet;
      window.clearTimeout = realClear;
    }
  }

  async function waitFor(condition, label, timeoutMs = 2000) {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  window.TestUtils = { mountHtml, captureWindowListeners, withFakeTimers, waitFor };
})();
