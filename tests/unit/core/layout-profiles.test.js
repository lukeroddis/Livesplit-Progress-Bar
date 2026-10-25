/**
 * LiveSplit Progress Bar - Layout Profiles & Presets Spec
 */
(function () {
  "use strict";

  describe("LiveSplit.LayoutProfiles", () => {
    function withMockStorage(fn) {
      const mockStorage = {};
      const origGetItem = localStorage.getItem;
      const origSetItem = localStorage.setItem;
      const origRemoveItem = localStorage.removeItem;

      localStorage.getItem = function (key) {
        return Object.prototype.hasOwnProperty.call(mockStorage, key) ? mockStorage[key] : null;
      };
      localStorage.setItem = function (key, val) {
        mockStorage[key] = String(val);
      };
      localStorage.removeItem = function (key) {
        delete mockStorage[key];
      };

      try {
        fn();
      } finally {
        localStorage.getItem = origGetItem;
        localStorage.setItem = origSetItem;
        localStorage.removeItem = origRemoveItem;
      }
    }

    it("exports LayoutProfiles namespace and createLayoutProfiles factory", () => {
      assert(window.LiveSplit.LayoutProfiles !== null, "LiveSplit.LayoutProfiles exists");
      assertEqual(typeof window.LiveSplit.LayoutProfiles.createLayoutProfiles, "function", "createLayoutProfiles is a function");
      assertEqual(window.LiveSplit.LayoutProfiles.PROFILES_INDEX_KEY, "livesplit_profiles_index", "PROFILES_INDEX_KEY constant matches");
      assertEqual(window.LiveSplit.LayoutProfiles.ACTIVE_PROFILE_KEY, "livesplit_active_profile", "ACTIVE_PROFILE_KEY constant matches");
    });

    it("returns Default as fallback profiles list and active profile name", () => {
      withMockStorage(() => {
        const engine = window.LiveSplit.LayoutProfiles.createLayoutProfiles();
        assertEqual(engine.getProfilesList(), ["Default"], "Default is the only initial profile");
        assertEqual(engine.getActiveProfileName(), "Default", "Default is initial active profile");
      });
    });

    it("saves and retrieves custom layout profile data", () => {
      withMockStorage(() => {
        const engine = window.LiveSplit.LayoutProfiles.createLayoutProfiles();
        const testData = { version: 1, name: "SpeedrunPreset", components: { title: { x: 50, y: 100 } } };

        engine.saveProfileToStorage("SpeedrunPreset", testData);
        assertEqual(engine.getProfilesList().includes("SpeedrunPreset"), true, "Profiles list includes SpeedrunPreset");

        const loaded = engine.getProfileData("SpeedrunPreset");
        assert(loaded !== null, "Profile data loaded from storage");
        assertEqual(loaded.name, "SpeedrunPreset", "Profile data matches stored JSON");
        assertEqual(loaded.components.title.x, 50, "Component coordinates match");
      });
    });

    it("protects Default profile from deletion and switches to Default when active profile is deleted", () => {
      withMockStorage(() => {
        const engine = window.LiveSplit.LayoutProfiles.createLayoutProfiles();
        assertEqual(engine.deleteProfileFromStorage("Default"), false, "Cannot delete Default profile");

        engine.saveProfileToStorage("TempProfile", { version: 1 });
        engine.setActiveProfileName("TempProfile");
        assertEqual(engine.getActiveProfileName(), "TempProfile", "Active profile is TempProfile");

        const deleted = engine.deleteProfileFromStorage("TempProfile");
        assertEqual(deleted, true, "TempProfile was deleted");
        assertEqual(engine.getActiveProfileName(), "Default", "Active profile reverted to Default");
        assertEqual(engine.getProfilesList().includes("TempProfile"), false, "TempProfile is removed from list");
      });
    });

    it("constructs Schema v1 compliant export payload", () => {
      withMockStorage(() => {
        const dummyLayout = {
          title: { x: 10, y: 20, scale: 1 },
          timers: { x: 30, y: 40, scale: 1 },
          track: { x: 50, y: 60, scale: 1 },
          leaderboard: { x: 70, y: 80, scale: 1 }
        };
        const dummyStyle = { orientation: "horizontal", pinSize: 14 };

        const engine = window.LiveSplit.LayoutProfiles.createLayoutProfiles({
          getDefaultLayout: () => dummyLayout,
          getLayoutState: () => dummyLayout,
          getDefaultTrackStyle: () => dummyStyle,
          getCurrentTrackStyle: () => dummyStyle,
          getTimerAnchor: () => "center"
        });

        const exp = engine.createProfileExport("MyRun");
        assertEqual(exp.version, 1, "Export has version 1");
        assertEqual(exp.name, "MyRun", "Export has requested profile name");
        assertEqual(exp.preferences.timerAnchor, "center", "Preferences contain timerAnchor");
        assertEqual(exp.components.track.x, 50, "Components contain track.x");
        assertEqual(exp.style.pinSize, 14, "Style contains pinSize");
      });
    });

    it("auto-detects and loads matching layout profile by game name", () => {
      withMockStorage(() => {
        let loadedProfile = null;
        const engine = window.LiveSplit.LayoutProfiles.createLayoutProfiles();
        engine.saveProfileToStorage("Super Mario 64", { version: 1, name: "Super Mario 64" });

        // Mock loadProfileByName
        const origLoad = engine.loadProfileByName;
        engine.loadProfileByName = function (name) {
          loadedProfile = name;
          return origLoad(name);
        };

        const matched = engine.autoLoadProfileForGame("super mario 64");
        assertEqual(matched, true, "Case-insensitive game name matches profile");
        assertEqual(loadedProfile, "Super Mario 64", "Switched to Super Mario 64 profile");

        const unmatched = engine.autoLoadProfileForGame("Unknown Game 123");
        assertEqual(unmatched, false, "Unknown game returns false without switching");
      });
    });
  });
})();
