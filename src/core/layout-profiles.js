/**
 * LiveSplit Progress Bar - Layout Profiles & Preset Storage Engine
 *
 * Encapsulates:
 * - Profile registry in localStorage (livesplit_profiles_index, livesplit_active_profile)
 * - Schema v1 layout profiles export and deep-merge import with forward/backward compatibility
 * - Profile dropdown UI synchronization and active preset selection
 * - Automatic game-to-profile detection and switching
 * - JSON file export and file reader import handling
 */
(function () {
  "use strict";

  const PROFILES_INDEX_KEY = "livesplit_profiles_index";
  const ACTIVE_PROFILE_KEY = "livesplit_active_profile";
  const PROFILE_KEY_PREFIX = "livesplit_profile_";

  function createLayoutProfiles(options = {}) {
    let api = null;
    const {
      getDefaultLayout = () => ({}),
      getLayoutState = () => null,
      setLayoutState = () => {},
      getDefaultTrackStyle = () => ({}),
      getCurrentTrackStyle = () => null,
      setCurrentTrackStyle = () => {},
      saveLayout = () => {},
      applyAllLayouts = () => {},
      saveTrackStyle = () => {},
      applyTrackStyle = () => {},
      getTimerAnchor = () => "start",
      setTimerAnchor = () => {},
      setVisibleSplits = () => {},
      syncTrackModalUI = () => {},
      saveGameLogo = () => {},
      removeGameLogo = () => {},
      COMPONENTS = ["title", "timers", "track", "leaderboard"],
      LOGO_STORAGE_KEY = "livesplit_custom_logo"
    } = options;

    function getProfilesList() {
      try {
        const idx = localStorage.getItem(PROFILES_INDEX_KEY);
        if (idx) {
          const parsed = JSON.parse(idx);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch (e) {
        console.warn("Failed to read profiles index", e);
      }
      return ["Default"];
    }

    function saveProfilesList(list) {
      try {
        localStorage.setItem(PROFILES_INDEX_KEY, JSON.stringify(list));
      } catch (e) {
        console.warn("Failed to save profiles index", e);
      }
    }

    function getActiveProfileName() {
      return localStorage.getItem(ACTIVE_PROFILE_KEY) || "Default";
    }

    function setActiveProfileName(name) {
      try {
        localStorage.setItem(ACTIVE_PROFILE_KEY, name);
      } catch (e) {
        console.warn("Failed to set active profile", e);
      }
    }

    function getProfileData(name) {
      try {
        const raw = localStorage.getItem(PROFILE_KEY_PREFIX + name);
        if (raw) return JSON.parse(raw);
      } catch (e) {
        console.warn("Failed to load profile data for: " + name, e);
      }
      return null;
    }

    function saveProfileToStorage(name, data) {
      try {
        localStorage.setItem(PROFILE_KEY_PREFIX + name, JSON.stringify(data));
        const list = getProfilesList();
        if (!list.includes(name)) {
          list.push(name);
          saveProfilesList(list);
        }
      } catch (e) {
        console.warn("Failed to save profile to storage", e);
      }
    }

    function deleteProfileFromStorage(name) {
      if (name === "Default") return false;
      try {
        localStorage.removeItem(PROFILE_KEY_PREFIX + name);
        let list = getProfilesList().filter((p) => p !== name);
        if (list.length === 0) list = ["Default"];
        saveProfilesList(list);
        if (getActiveProfileName() === name) {
          setActiveProfileName("Default");
          if (api && api.loadProfileByName) {
            api.loadProfileByName("Default");
          } else {
            loadProfileByName("Default");
          }
        }
        syncProfileUI();
        return true;
      } catch (e) {
        console.warn("Failed to delete profile", e);
        return false;
      }
    }

    function createProfileExport(profileName) {
      const name = profileName || getActiveProfileName() || "Default";
      const currentState = getLayoutState();
      const currentStyle = getCurrentTrackStyle();
      const defaultLayout = getDefaultLayout();
      const defaultStyle = getDefaultTrackStyle();

      return {
        version: 1,
        name: name,
        exportedAt: new Date().toISOString(),
        generator: "LiveSplit Minimal Overlay " + ((typeof window !== "undefined" && window.APP_VERSION) || "v1.0.0"),
        components: currentState ? JSON.parse(JSON.stringify(currentState)) : defaultLayout,
        style: currentStyle ? Object.assign({}, currentStyle) : Object.assign({}, defaultStyle),
        preferences: {
          timerDisplayMode: ((typeof window !== "undefined" && window.getTimerDisplayMode) ? window.getTimerDisplayMode() : localStorage.getItem("livesplit_timer_display_mode")) || "both",
          timingMethodFocus: ((typeof window !== "undefined" && window.getCurrentTimingMethod) ? window.getCurrentTimingMethod() : localStorage.getItem("livesplit_timing_method")) || "GameTime",
          timerAnchor: getTimerAnchor(),
          ghostComparison: localStorage.getItem("livesplit_ghost_comparison") || "off",
          activeGhosts: ((typeof window !== "undefined" && window.getActiveGhostComparisons) ? window.getActiveGhostComparisons() : (localStorage.getItem("livesplit_active_ghosts") ? JSON.parse(localStorage.getItem("livesplit_active_ghosts")) : [(localStorage.getItem("livesplit_ghost_comparison") || "off")])),
          ghostOpacity: parseInt(localStorage.getItem("livesplit_ghost_opacity"), 10) || 85,
          splitDensity: localStorage.getItem("livesplit_visible_splits") || "auto",
          splitAngle: localStorage.getItem("livesplit_split_angle") || "auto",
          showLastSplit: (localStorage.getItem("livesplit_always_show_last_split") !== "false"),
          discardGoldsOnReset: (localStorage.getItem("livesplit_discard_golds_on_reset") !== "false"),
          syncHotkeys: (localStorage.getItem("livesplit_sync_hotkeys") !== "false")
        },
        customLogo: localStorage.getItem(LOGO_STORAGE_KEY) || null
      };
    }

    function applyProfileData(data, saveAsName) {
      if (!data || typeof data !== "object") {
        throw new Error("Invalid layout profile: expected JSON object");
      }

      // 1. Components (deep merge with defaults to support older versions missing newer components or properties)
      const defLayout = getDefaultLayout();
      const newLayoutState = Object.assign({}, defLayout);
      if (data.components && typeof data.components === "object") {
        for (const compId of COMPONENTS) {
          if (data.components[compId] && typeof data.components[compId] === "object") {
            newLayoutState[compId] = Object.assign({}, defLayout[compId], data.components[compId]);
          }
        }
      }
      if (!data.components || !data.components.leaderboard) {
        try {
          const dedicated = localStorage.getItem("livesplit_leaderboard_layout");
          if (dedicated) {
            newLayoutState.leaderboard = Object.assign({}, defLayout.leaderboard, JSON.parse(dedicated));
          }
        } catch (_) {}
      }
      setLayoutState(newLayoutState);
      saveLayout();
      applyAllLayouts();

      // 2. Track Style (deep merge with default track style so older layouts missing newer style properties gracefully use defaults)
      const newTrackStyle = Object.assign({}, getDefaultTrackStyle(), data.style || {});
      setCurrentTrackStyle(newTrackStyle);
      saveTrackStyle();
      applyTrackStyle();

      // 3. Preferences (apply with fallback)
      const prefs = data.preferences || {};
      if (prefs.timerDisplayMode && typeof window !== "undefined" && window.setTimerDisplayMode) {
        window.setTimerDisplayMode(prefs.timerDisplayMode);
      }
      if (prefs.timingMethodFocus && typeof window !== "undefined" && window.setTimingMethodFocus) {
        window.setTimingMethodFocus(prefs.timingMethodFocus);
      }
      if (prefs.timerAnchor != null) {
        setTimerAnchor(prefs.timerAnchor);
      }
      if (Array.isArray(prefs.activeGhosts)) {
        localStorage.setItem("livesplit_active_ghosts", JSON.stringify(prefs.activeGhosts));
        if (prefs.activeGhosts.length > 0) {
          localStorage.setItem("livesplit_ghost_comparison", prefs.activeGhosts[0]);
        }
        if (typeof window !== "undefined" && window.updateGhostBadge) window.updateGhostBadge();
      } else if (prefs.ghostComparison != null && typeof window !== "undefined" && window.setGhostComparison) {
        window.setGhostComparison(prefs.ghostComparison);
      }
      if (prefs.ghostOpacity != null && typeof window !== "undefined" && window.setGhostOpacity) {
        window.setGhostOpacity(prefs.ghostOpacity);
      }
      if (prefs.splitDensity != null) {
        setVisibleSplits(prefs.splitDensity);
      }
      if (prefs.splitAngle != null) {
        localStorage.setItem("livesplit_split_angle", prefs.splitAngle);
        if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
      }
      if (prefs.showLastSplit != null) {
        localStorage.setItem("livesplit_always_show_last_split", prefs.showLastSplit ? "true" : "false");
        const cbLast = document.getElementById("cb-always-show-last-split");
        if (cbLast) cbLast.checked = Boolean(prefs.showLastSplit);
        if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
        if (typeof window !== "undefined" && window.updateTrackStatus) {
          window.updateTrackStatus(window.getCurrentIndex ? window.getCurrentIndex() : -1);
        }
      }
      if (prefs.discardGoldsOnReset != null) {
        localStorage.setItem("livesplit_discard_golds_on_reset", prefs.discardGoldsOnReset ? "true" : "false");
      }
      if (prefs.syncHotkeys != null) {
        localStorage.setItem("livesplit_sync_hotkeys", prefs.syncHotkeys ? "true" : "false");
      }

      // 4. Custom Game Logo
      if ("customLogo" in data) {
        if (data.customLogo) {
          saveGameLogo(data.customLogo);
        } else {
          removeGameLogo();
        }
      }

      // 5. Update UI controls
      syncTrackModalUI();
      if (typeof window !== "undefined" && window.updateGhostBadge) window.updateGhostBadge();

      // 6. Optionally save into named profiles
      if (saveAsName) {
        const profName = saveAsName.trim();
        if (profName) {
          saveProfileToStorage(profName, data);
          setActiveProfileName(profName);
        }
      }

      syncProfileUI();
    }

    function loadProfileByName(name) {
      if (!name) return false;
      const data = getProfileData(name);
      if (data) {
        applyProfileData(data, name);
        return true;
      } else if (name === "Default") {
        const def = createProfileExport("Default");
        saveProfileToStorage("Default", def);
        setActiveProfileName("Default");
        applyProfileData(def, "Default");
        return true;
      }
      return false;
    }

    function openExportModal(filename, jsonStr) {
      const modal = document.getElementById("layout-export-modal");
      const ta = document.getElementById("export-json-textarea");
      const label = document.getElementById("export-filename-label");
      const banner = document.getElementById("export-status-banner");
      const btnCopy = document.getElementById("btn-copy-export-json");
      const btnDownload = document.getElementById("btn-redownload-export-json");
      if (!modal) return;
      if (ta) ta.value = jsonStr;
      if (label) label.textContent = filename;
      if (banner) banner.textContent = `Export ready for ${filename}`;
      if (btnCopy) btnCopy.textContent = "📋 Copy JSON";
      if (btnDownload) btnDownload.textContent = "💾 Download .json";
      modal.style.display = "flex";
      modal.classList.add("is-open");
    }

    function closeExportModal() {
      const modal = document.getElementById("layout-export-modal");
      if (modal) {
        modal.style.display = "none";
        modal.classList.remove("is-open");
      }
    }

    function triggerFileDownload(filename, jsonStr) {
      let downloadAttempted = false;
      try {
        const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        downloadAttempted = true;
        setTimeout(() => {
          if (a.parentNode) a.parentNode.removeChild(a);
          URL.revokeObjectURL(url);
        }, 60000);
      } catch (_) {
        try {
          const a = document.createElement("a");
          a.href = "data:application/json;charset=utf-8," + encodeURIComponent(jsonStr);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          downloadAttempted = true;
          setTimeout(() => {
            if (a.parentNode) a.parentNode.removeChild(a);
          }, 60000);
        } catch (err) {
          console.warn("Direct file download unsupported in this environment:", err);
        }
      }
      return downloadAttempted;
    }

    function exportProfileToFile(profileName) {
      const name = profileName || getActiveProfileName() || "Default";
      const data = createProfileExport(name);
      const jsonStr = JSON.stringify(data, null, 2);
      const safeName = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
      const filename = `livesplit-layout-${safeName}.json`;

      openExportModal(filename, jsonStr);
    }

    function importProfileFromFile(file) {
      return new Promise((resolve, reject) => {
        if (!file) return reject(new Error("No file selected"));
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed || typeof parsed !== "object") {
              throw new Error("File does not contain a valid JSON layout object");
            }
            const profileName = parsed.name || file.name.replace(/\.[^.]+$/, "") || "Imported Layout";
            applyProfileData(parsed, profileName);
            resolve(profileName);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
      });
    }

    function openImportModal() {
      const modal = document.getElementById("layout-import-modal");
      const ta = document.getElementById("import-json-textarea");
      const err = document.getElementById("import-error-msg");
      const lbl = document.getElementById("import-file-name-label");
      if (ta) ta.value = "";
      if (err) { err.style.display = "none"; err.textContent = ""; }
      if (lbl) lbl.textContent = "";
      if (modal) {
        modal.style.display = "flex";
        modal.classList.add("is-open");
      }
    }

    function closeImportModal() {
      const modal = document.getElementById("layout-import-modal");
      if (modal) {
        modal.style.display = "none";
        modal.classList.remove("is-open");
      }
    }

    function toggleProfileDropdown(forceState) {
      const list = document.getElementById("profile-dropdown-list");
      const btn = document.getElementById("btn-profile-dropdown");
      if (!list) return;
      const isHidden = (list.style.display === "none");
      const shouldOpen = (forceState != null) ? forceState : isHidden;
      list.style.display = shouldOpen ? "flex" : "none";
      if (btn) btn.classList.toggle("is-active", shouldOpen);
    }

    function syncProfileUI() {
      const select = document.getElementById("select-layout-profile");
      const dropdownLabel = document.getElementById("profile-dropdown-label");
      const dropdownList = document.getElementById("profile-dropdown-list");
      const btnDel = document.getElementById("btn-delete-profile");

      const list = getProfilesList();
      const active = getActiveProfileName();

      if (dropdownLabel) {
        dropdownLabel.textContent = `Profile: ${active}`;
      }

      if (dropdownList) {
        dropdownList.innerHTML = "";
        list.forEach((p) => {
          const item = document.createElement("button");
          item.type = "button";
          item.className = "profile-dropdown-item" + (p === active ? " is-selected" : "");
          item.setAttribute("data-profile", p);
          item.innerHTML = `<span>Profile: ${p}</span>${p === active ? '<span style="color:#38bdf8;">✓</span>' : ''}`;
          item.addEventListener("click", () => {
            loadProfileByName(p);
            toggleProfileDropdown(false);
          });
          dropdownList.appendChild(item);
        });
      }

      if (select) {
        select.innerHTML = "";
        list.forEach((p) => {
          const opt = document.createElement("option");
          opt.value = p;
          opt.textContent = `Profile: ${p}`;
          if (p === active) opt.selected = true;
          select.appendChild(opt);
        });
      }

      if (btnDel) {
        btnDel.style.display = (active === "Default") ? "none" : "inline-block";
      }

      const barDef = document.getElementById("profile-bar-default");
      const barNew = document.getElementById("profile-bar-new");
      const barDelRow = document.getElementById("profile-bar-delete");
      if (barDef) barDef.style.display = "flex";
      if (barNew) barNew.style.display = "none";
      if (barDelRow) barDelRow.style.display = "none";
    }

    function autoLoadProfileForGame(gameName) {
      if (!gameName || typeof gameName !== "string") return false;
      const cleanGame = gameName.trim().toLowerCase();
      const list = (api && api.getProfilesList) ? api.getProfilesList() : getProfilesList();
      const match = list.find((p) => p.trim().toLowerCase() === cleanGame);
      const activeName = (api && api.getActiveProfileName) ? api.getActiveProfileName() : getActiveProfileName();
      if (match && match !== activeName) {
        console.log(`Auto-switching layout profile to match game: "${match}"`);
        if (api && api.loadProfileByName) {
          api.loadProfileByName(match);
        } else {
          loadProfileByName(match);
        }
        return true;
      }
      return false;
    }

    api = {
      PROFILES_INDEX_KEY,
      ACTIVE_PROFILE_KEY,
      PROFILE_KEY_PREFIX,
      getProfilesList,
      saveProfilesList,
      getActiveProfileName,
      setActiveProfileName,
      getProfileData,
      saveProfileToStorage,
      deleteProfileFromStorage,
      createProfileExport,
      applyProfileData,
      loadProfileByName,
      openExportModal,
      closeExportModal,
      triggerFileDownload,
      exportProfileToFile,
      importProfileFromFile,
      openImportModal,
      closeImportModal,
      toggleProfileDropdown,
      syncProfileUI,
      autoLoadProfileForGame
    };

    return api;
  }

  // Export to namespace
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutProfiles = {
    PROFILES_INDEX_KEY,
    ACTIVE_PROFILE_KEY,
    PROFILE_KEY_PREFIX,
    createLayoutProfiles
  };
})();
