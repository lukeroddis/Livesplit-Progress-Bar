/**
 * tests/unit/core/storage.test.js
 * LiveSplit.Storage: safeStorage in-memory fallback when localStorage throws
 * (sandboxed OBS sources, quota), and in-run state save / load guards / clear.
 */

(function () {
  "use strict";

  const S = () => window.LiveSplit.Storage;
  const KEYS = window.LiveSplit.Storage.KEYS;
  const { mountHtml } = window.TestUtils;

  // Makes every localStorage call throw for the duration of fn (like a sandboxed CEF source)
  function withBrokenLocalStorage(fn) {
    const proto = Storage.prototype;
    const real = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
    const realWarn = console.warn;
    const fail = () => { throw new DOMException("denied", "SecurityError"); };
    proto.getItem = fail;
    proto.setItem = fail;
    proto.removeItem = fail;
    console.warn = () => {};
    try {
      return fn();
    } finally {
      Object.assign(proto, real);
      console.warn = realWarn;
    }
  }

  // Snapshot and restore the keys these tests touch
  function withSavedKeys(keys, fn) {
    const saved = keys.map((k) => [k, localStorage.getItem(k)]);
    try {
      return fn();
    } finally {
      saved.forEach(([k, v]) => (v === null ? S().safeStorage.removeItem(k) : S().safeStorage.setItem(k, v)));
    }
  }

  describe("Storage: safeStorage", () => {
    it("reads and writes through localStorage", () => {
      const store = S().safeStorage;
      store.setItem("livesplit_test_key", 42);
      assertEqual(localStorage.getItem("livesplit_test_key"), "42", "values are stored as strings");
      assertEqual(store.getItem("livesplit_test_key"), "42");
      store.removeItem("livesplit_test_key");
      assertEqual(store.getItem("livesplit_test_key"), null);
    });

    it("falls back to memory when localStorage throws", () => {
      const store = S().safeStorage;
      withBrokenLocalStorage(() => {
        store.setItem("livesplit_test_mem", "kept");
        assertEqual(store.getItem("livesplit_test_mem"), "kept", "read back from memory");
        store.removeItem("livesplit_test_mem");
        assertEqual(store.getItem("livesplit_test_mem"), null, "removed from memory");
        assertEqual(store.getItem("livesplit_never_set"), null);
      });
    });

    it("serves the in-memory copy when localStorage lost the value", () => {
      const store = S().safeStorage;
      store.setItem("livesplit_test_lost", "memory");
      localStorage.removeItem("livesplit_test_lost");
      assertEqual(store.getItem("livesplit_test_lost"), "memory");
      store.removeItem("livesplit_test_lost");
    });
  });

  describe("Storage: in-run state", () => {
    const RUN_KEYS = [KEYS.IN_RUN_STATE, KEYS.GAME_NAME, KEYS.CATEGORY_NAME];

    it("saves and loads a run snapshot for the same splits, game and category", () => withSavedKeys(RUN_KEYS, () => {
      S().safeStorage.setItem(KEYS.GAME_NAME, "Spyro 2");
      S().safeStorage.setItem(KEYS.CATEGORY_NAME, "14 Talismans");
      const snap = { splitsCount: 3, game: "Spyro 2", category: "14 Talismans", currentIndex: 1 };
      S().saveInRunState(snap);
      assertEqual(S().loadInRunState(["a", "b", "c"]), snap);
      S().saveInRunState(null);
      assertEqual(S().loadInRunState(["a", "b", "c"]), snap, "null snapshots are ignored");
    }));

    it("discards a snapshot from a different splits file, game or category", () => withSavedKeys(RUN_KEYS, () => {
      S().safeStorage.setItem(KEYS.GAME_NAME, "Spyro 2");
      S().safeStorage.setItem(KEYS.CATEGORY_NAME, "14 Talismans");

      S().saveInRunState({ splitsCount: 5 });
      assertEqual(S().loadInRunState(["a", "b", "c"]), null, "split count changed");
      assertEqual(localStorage.getItem(KEYS.IN_RUN_STATE), null, "stale snapshot cleared");

      S().saveInRunState({ splitsCount: 3, game: "Spyro 3" });
      assertEqual(S().loadInRunState(["a", "b", "c"]), null, "game changed");

      S().saveInRunState({ splitsCount: 3, category: "120%" });
      assertEqual(S().loadInRunState(["a", "b", "c"]), null, "category changed");
    }));

    it("ignores missing or corrupt snapshots", () => withSavedKeys(RUN_KEYS, () => {
      S().safeStorage.removeItem(KEYS.IN_RUN_STATE);
      assertEqual(S().loadInRunState([]), null, "nothing saved");
      S().safeStorage.setItem(KEYS.IN_RUN_STATE, "{not json");
      const realWarn = console.warn;
      console.warn = () => {};
      try {
        assertEqual(S().loadInRunState([]), null, "corrupt JSON");
      } finally {
        console.warn = realWarn;
      }
      S().safeStorage.setItem(KEYS.IN_RUN_STATE, "42");
      assertEqual(S().loadInRunState([]), null, "not an object");
    }));

    it("clearing resets the HUD timers", () => withSavedKeys(RUN_KEYS, () => {
      const dom = mountHtml('<div id="timer-rta">12.34</div><div id="timer-igt">11.00</div>');
      try {
        S().saveInRunState({ splitsCount: 1 });
        S().clearInRunState();
        assertEqual(localStorage.getItem(KEYS.IN_RUN_STATE), null);
        assertEqual(dom.el("timer-rta").innerText, "0.00");
        assertEqual(dom.el("timer-igt").innerText, "0.00");
      } finally {
        dom.remove();
      }
    }));

    it("never throws when storage is unavailable", () => withSavedKeys(RUN_KEYS, () => {
      withBrokenLocalStorage(() => {
        S().saveInRunState({ splitsCount: 2 });
        assertEqual(S().loadInRunState(["a", "b"]).splitsCount, 2, "served from the memory fallback");
        S().clearInRunState();
        assertEqual(S().loadInRunState(["a", "b"]), null);
      });
    }));
  });
})();
