/**
 * src/ui/settings-ghost-panel.js - Ghost Runner Settings Panel
 *
 * Ghost selection pills and dropdown (presets, custom comparisons from the
 * loaded splits, and a "Custom" entry for other combinations), pin length /
 * pinhead size sliders, and ghost opacity.
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;
  const C = window.LiveSplit.SettingsControls;

  const GHOST_PRESET_OPTIONS = [
    { val: "off", label: "Off (Disabled)" },
    { val: "wr", label: "World Record (🏆)" },
    { val: "pb", label: "Personal Best (🥈)" },
    { val: "wr,pb", label: "Dual: WR (🏆) + PB (🥈)" },
    { val: "best", label: "Best Segments (⭐)" },
    { val: "wr,best", label: "Dual: WR (🏆) + Best (⭐)" },
    { val: "average", label: "Average Segments (📊)" },
    { val: "worst", label: "Worst Segments (🐢)" }
  ];
  const BUILT_IN_COMPARISONS = ["personal best", "best segments", "average segments", "worst segments"];

  function getActiveGhostList() {
    const getGhosts = window.LiveSplit.Overlay.getActiveGhostComparisons;
    const activeGhosts = getGhosts
      ? getGhosts()
      : (localStorage.getItem(STORAGE_KEYS.ACTIVE_GHOSTS)
        ? JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVE_GHOSTS))
        : [(localStorage.getItem(STORAGE_KEYS.GHOST_COMPARISON) || "off")]);
    return Array.isArray(activeGhosts) ? activeGhosts.filter(g => g && g !== "off") : [];
  }

  function addOption(select, value, label, selected) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.innerText = label;
    if (selected) opt.selected = true;
    select.appendChild(opt);
  }

  function syncGhostDropdown(activeList) {
    const selGhost = document.getElementById("select-ghost-comparison");
    if (!selGhost) return;
    selGhost.innerHTML = "";

    let optionMatched = false;
    GHOST_PRESET_OPTIONS.forEach((o) => {
      const optList = o.val === "off" ? [] : o.val.split(",");
      const isMatch = (o.val === "off" && activeList.length === 0) ||
        (optList.length === activeList.length && optList.every(id => activeList.includes(id)));
      if (isMatch) optionMatched = true;
      addOption(selGhost, o.val, o.label, isMatch);
    });

    // Custom comparisons from the loaded splits
    const getComparisons = window.LiveSplit.Overlay.getComparisonsList;
    if (getComparisons) {
      getComparisons().forEach((c) => {
        const low = c.toLowerCase();
        if (BUILT_IN_COMPARISONS.includes(low) || low.includes("world record") || low === "wr") return;
        const isMatch = activeList.length === 1 && activeList[0] === c;
        if (isMatch) optionMatched = true;
        addOption(selGhost, c, `👤 ${c}`, isMatch);
      });
    }

    if (!optionMatched && activeList.length > 0) {
      addOption(selGhost, activeList.join(","), `Custom: ${activeList.join(" + ")}`, true);
    }
  }

  /**
   * @param {Object} deps - { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle }
   */
  function createGhostPanel(deps) {
    const { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle } = deps;

    function sync(style) {
      const activeList = getActiveGhostList();

      document.querySelectorAll("#ghost-pill-row .preset-pill-btn").forEach((btn) => {
        const pillVal = btn.getAttribute("data-ghost-pill");
        btn.classList.toggle("active", pillVal === "off" ? activeList.length === 0 : activeList.includes(pillVal));
      });

      syncGhostDropdown(activeList);

      C.syncSlider("slider-ghost-pin-length", "val-ghost-pin-length", (style.ghostPinLength != null ? style.ghostPinLength : 16), C.formats.pinLength);
      C.syncSlider("slider-ghost-pin-size", "val-ghost-pin-size", (style.ghostPinSize != null ? style.ghostPinSize : 26), C.formats.px);
      C.syncSlider("slider-ghost-opacity", "val-ghost-opacity", parseInt(localStorage.getItem(STORAGE_KEYS.GHOST_OPACITY) || "85", 10), C.formats.percent);
      C.syncSegmented("#ctrl-pin-pos", style.pinPos || "auto");
      const cbLane = document.getElementById("cb-pin-lane");
      if (cbLane) cbLane.checked = style.pinLane !== false;
    }

    function updateStyle(mutate) {
      const style = getCurrentTrackStyle();
      if (!style) return;
      mutate(style);
      applyTrackStyle();
      saveTrackStyle();
    }

    function bind() {
      document.querySelectorAll("#ghost-pill-row .preset-pill-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pillVal = btn.getAttribute("data-ghost-pill");
          if (pillVal) window.LiveSplit.Overlay.toggleGhostComparison?.(pillVal);
        });
      });

      document.getElementById("select-ghost-comparison")?.addEventListener("change", (e) => {
        const setGhost = window.LiveSplit.Overlay.setGhostComparison;
        if (setGhost) {
          setGhost(e.target.value);
        } else {
          localStorage.setItem(STORAGE_KEYS.GHOST_COMPARISON, e.target.value);
        }
      });

      const sliderDeps = { getStyle: getCurrentTrackStyle, applyStyle: applyTrackStyle, saveStyle: saveTrackStyle };
      C.bindStyleSlider(Object.assign({ sliderId: "slider-ghost-pin-length", badgeId: "val-ghost-pin-length", prop: "ghostPinLength", format: C.formats.pinLength }, sliderDeps));
      C.bindStyleSlider(Object.assign({ sliderId: "slider-ghost-pin-size", badgeId: "val-ghost-pin-size", prop: "ghostPinSize", format: C.formats.px }, sliderDeps));

      C.bindSegmented("#ctrl-pin-pos", (val) => updateStyle((style) => { style.pinPos = val; }));
      document.getElementById("cb-pin-lane")?.addEventListener("change", (e) => {
        updateStyle((style) => { style.pinLane = e.target.checked; });
      });

      // Opacity is a ghost-runner preference (not track style): live preview on input, persisted on change
      const sliderGhostOp = document.getElementById("slider-ghost-opacity");
      if (sliderGhostOp) {
        sliderGhostOp.addEventListener("input", () => {
          const valBadge = document.getElementById("val-ghost-opacity");
          if (valBadge) valBadge.innerText = C.formats.percent(sliderGhostOp.value);
          window.LiveSplit.Overlay.setGhostOpacity?.(sliderGhostOp.value);
        });
        sliderGhostOp.addEventListener("change", () => {
          localStorage.setItem(STORAGE_KEYS.GHOST_OPACITY, sliderGhostOp.value);
        });
      }
    }

    return { sync, bind };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsGhostPanel = {
    GHOST_PRESET_OPTIONS,
    createGhostPanel
  };
})();
