/**
 * LiveSplit Progress Bar - Layout Modal & Settings Toolbar Controller
 * 
 * Encapsulates:
 * - Track customizer / Settings modal transitions (openTrackModal, closeTrackModal)
 * - Comprehensive settings synchronization (syncTrackModalUI)
 *   - Range sliders (fonts, bar height, dot size, pin length/size, opacity, blur)
 *   - Segmented buttons (orientation, name/delta positions, split angle, timer display, timing focus)
 *   - Checkboxes (backgrounds, discard golds, always show last split, sync hotkeys)
 *   - Active comparison dropdown & Ghost runner preset pills
 * - Toolbar interaction & controls lifecycle (setupToolbarAndControls)
 *   - Lock layout, reset layout, edit toggle
 *   - Split count spinbox & presets (Fit All, Auto)
 *   - Export & Import modal controls (JSON textarea, clipboard copy, file download/reader)
 *   - Global hotkeys ('E' / 'F2' edit mode toggle, 'Escape' modal dismissal)
 *   - Responsive window resize clamping
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  function createLayoutModal(options = {}) {
    const {
      getCurrentTrackStyle = () => null,
      saveTrackStyle = () => {},
      applyTrackStyle = () => {},
      resetTrackStyle = () => {},
      setTrackOrientation = () => {},
      setVisibleSplits = () => {},
      getLayoutState = () => ({}),
      saveLayout = () => {},
      resetLayout = () => {},
      setEditMode = () => {},
      toggleEditMode = () => {},
      isEditMode = () => false,
      applyComponentLayout = () => {},
      getTimerAnchor = () => "auto",
      syncTimerAnchorUI = () => {},
      getGameLogoController = () => null,
      getProfilesEngine = () => null,
      COMPONENTS = window.LiveSplit.LayoutEngine.COMPONENTS
    } = options;

    function openTrackModal() {
      const modal = document.getElementById("track-modal");
      if (modal) {
        modal.style.display = "flex";
        setTimeout(() => modal.classList.add("is-open"), 10);
        syncUI();
      }
    }

    function closeTrackModal() {
      const modal = document.getElementById("track-modal");
      if (modal) {
        modal.classList.remove("is-open");
        setTimeout(() => {
          modal.style.display = "none";
        }, 200);
        saveTrackStyle();
      }
    }

    function syncUI() {
      const currentTrackStyle = getCurrentTrackStyle();
      if (!currentTrackStyle) return;

      const isVert = (currentTrackStyle.orientation === "vertical");
      const anglePref = localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
      const track = document.getElementById("track");
      const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));

      // Track Orientation segmented control sync
      document.querySelectorAll("#ctrl-track-orient .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === (isVert ? "vertical" : "horizontal"));
      });

      // Track Orient footer badge sync
      const orientBadge = document.getElementById("track-orient-badge");
      if (orientBadge) {
        orientBadge.innerText = isVert ? "Orient: Vert" : "Orient: Horiz";
        orientBadge.style.color = isVert ? "#a78bfa" : "#38bdf8";
      }

      // Opposing hint visibility
      const hint = document.getElementById("opposing-hint");
      if (hint) {
        if (isVert) {
          hint.style.display = "block";
          hint.innerText = "💡 Position split names and deltas on either side of the vertical timeline node.";
        } else {
          hint.innerText = "💡 When 40° angle is active, timers stay horizontal on the opposite side to eliminate overlap.";
          hint.style.display = isAngled ? "block" : "none";
        }
      }

      // Background Opacity & Blur sync
      const opacityVal = (currentTrackStyle.bgOpacity != null ? currentTrackStyle.bgOpacity : 55);
      const sBgOpacity = document.getElementById("slider-bg-opacity");
      const vBgOpacity = document.getElementById("val-bg-opacity");
      if (sBgOpacity && vBgOpacity) {
        sBgOpacity.value = opacityVal;
        vBgOpacity.innerText = (opacityVal === 0) ? "0% (Off)" : `${opacityVal}%`;
      }

      const blurPx = (currentTrackStyle.bgBlur != null ? currentTrackStyle.bgBlur : 8);
      const sBgBlur = document.getElementById("slider-bg-blur");
      const vBgBlur = document.getElementById("val-bg-blur");
      if (sBgBlur && vBgBlur) {
        sBgBlur.value = blurPx;
        vBgBlur.innerText = `${blurPx}px`;
      }

      // Preset buttons highlight
      document.querySelectorAll(".preset-pill-btn[data-preset-bg]").forEach((btn) => {
        const pVal = parseInt(btn.getAttribute("data-preset-bg"), 10);
        btn.classList.toggle("active", pVal === opacityVal);
      });

      // Checkboxes for individual component background
      const cbTitle = document.getElementById("cb-bg-title");
      if (cbTitle) cbTitle.checked = currentTrackStyle.bgTitle !== false;
      const cbTimers = document.getElementById("cb-bg-timers");
      if (cbTimers) cbTimers.checked = currentTrackStyle.bgTimers !== false;
      const cbTrack = document.getElementById("cb-bg-track");
      if (cbTrack) cbTrack.checked = currentTrackStyle.bgTrack !== false;

      // Footer badge sync
      const bgBadge = document.getElementById("bg-opacity-badge");
      if (bgBadge) {
        bgBadge.innerText = (opacityVal === 0) ? "BG: Off" : `BG: ${opacityVal}%`;
        bgBadge.style.color = (opacityVal > 0) ? "#38bdf8" : "rgba(148, 163, 184, 0.7)";
      }

      // Toggle button visibility between horizontal (Top/Bottom) and vertical (Left/Right)
      document.querySelectorAll(".seg-btn-horiz").forEach((btn) => {
        btn.style.display = isVert ? "none" : "";
      });
      document.querySelectorAll(".seg-btn-vert").forEach((btn) => {
        btn.style.display = isVert ? "" : "none";
      });

      // Segmented buttons for Name and Delta
      document.querySelectorAll("#ctrl-name-pos .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === currentTrackStyle.namePos);
      });
      document.querySelectorAll("#ctrl-delta-pos .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === currentTrackStyle.deltaPos);
      });

      // Angle buttons in modal and toolbar select
      document.querySelectorAll("#ctrl-modal-angle .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === anglePref);
      });
      const angleSelect = document.getElementById("select-split-angle");
      if (angleSelect) angleSelect.value = anglePref;

      // Visible splits sync across toolbar and modal
      const splitPref = localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS) || "auto";
      const spinInput = document.getElementById("input-visible-splits");
      const modalSpinInput = document.getElementById("modal-input-visible-splits");
      const valBadge = document.getElementById("val-visible-splits");
      const btnAll = document.getElementById("btn-splits-fit-all");
      const btnAuto = document.getElementById("btn-splits-auto");
      const modalBtnAll = document.getElementById("modal-btn-splits-all");
      const modalBtnAuto = document.getElementById("modal-btn-splits-auto");

      const isAll = (splitPref === "all");
      const isAuto = (splitPref === "auto");
      const intVal = parseInt(splitPref, 10);
      const isNum = !isNaN(intVal) && intVal > 0;

      if (btnAll) btnAll.classList.toggle("active", isAll);
      if (modalBtnAll) modalBtnAll.classList.toggle("active", isAll);
      if (btnAuto) btnAuto.classList.toggle("active", isAuto);
      if (modalBtnAuto) modalBtnAuto.classList.toggle("active", isAuto);

      if (isNum) {
        if (spinInput) spinInput.value = intVal;
        if (modalSpinInput) modalSpinInput.value = intVal;
        if (valBadge) valBadge.innerText = `${intVal} splits`;
      } else if (isAll) {
        if (valBadge) valBadge.innerText = "Fit All";
      } else {
        if (valBadge) valBadge.innerText = "Auto";
      }

      // Range sliders & badges
      const sNameFont = document.getElementById("slider-name-font");
      const vNameFont = document.getElementById("val-name-font");
      if (sNameFont && vNameFont) {
        sNameFont.value = currentTrackStyle.nameFontSize;
        vNameFont.innerText = `${currentTrackStyle.nameFontSize}px`;
      }

      const sDeltaFont = document.getElementById("slider-delta-font");
      const vDeltaFont = document.getElementById("val-delta-font");
      if (sDeltaFont && vDeltaFont) {
        sDeltaFont.value = currentTrackStyle.deltaFontSize;
        vDeltaFont.innerText = `${currentTrackStyle.deltaFontSize}px`;
      }

      const sBarHeight = document.getElementById("slider-bar-height");
      const vBarHeight = document.getElementById("val-bar-height");
      if (sBarHeight && vBarHeight) {
        sBarHeight.value = currentTrackStyle.barHeight;
        vBarHeight.innerText = `${currentTrackStyle.barHeight}px`;
      }

      const sDotSize = document.getElementById("slider-dot-size");
      const vDotSize = document.getElementById("val-dot-size");
      if (sDotSize && vDotSize) {
        sDotSize.value = currentTrackStyle.dotSize;
        vDotSize.innerText = `${currentTrackStyle.dotSize}px`;
      }

      // Discard in-run golds on reset checkbox
      const cbDiscard = document.getElementById("cb-discard-golds-reset");
      if (cbDiscard) {
        cbDiscard.checked = (localStorage.getItem(STORAGE_KEYS.DISCARD_GOLDS_ON_RESET) !== "false");
      }

      // Always Show Last Split checkbox
      const cbLast = document.getElementById("cb-always-show-last-split");
      if (cbLast) {
        cbLast.checked = (localStorage.getItem(STORAGE_KEYS.ALWAYS_SHOW_LAST) !== "false");
      }

      // Active Comparison dropdown sync
      const selComp = document.getElementById("select-active-comparison");
      if (selComp && typeof window !== "undefined" && window.getComparisonsList) {
        const comps = window.getComparisonsList();
        const curComp = window.getCurrentComparison ? window.getCurrentComparison() : "Personal Best";
        selComp.innerHTML = "";
        comps.forEach(c => {
          const opt = document.createElement("option");
          opt.value = c;
          let label = c;
          if (c === "Personal Best") label = "Personal Best (PB)";
          else if (c === "Best Segments") label = "Best Segments (Sum of Best)";
          opt.innerText = label;
          if (c === curComp) opt.selected = true;
          selComp.appendChild(opt);
        });
      }

      // Auto-sync with LiveSplit hotkeys checkbox
      const cbSync = document.getElementById("cb-sync-livesplit-hotkeys");
      if (cbSync) {
        cbSync.checked = (localStorage.getItem(STORAGE_KEYS.SYNC_HOTKEYS) !== "false");
      }

      // Ghost Runner pills & dropdown sync
      const activeGhosts = (typeof window !== "undefined" && window.getActiveGhostComparisons)
        ? window.getActiveGhostComparisons()
        : (localStorage.getItem(STORAGE_KEYS.ACTIVE_GHOSTS)
          ? JSON.parse(localStorage.getItem(STORAGE_KEYS.ACTIVE_GHOSTS))
          : [(localStorage.getItem(STORAGE_KEYS.GHOST_COMPARISON) || "off")]);
      const activeList = Array.isArray(activeGhosts) ? activeGhosts.filter(g => g && g !== "off") : [];
      const activeKey = activeList.length === 0 ? "off" : activeList.join(",");

      // Sync modal pills
      const pillRow = document.getElementById("ghost-pill-row");
      if (pillRow) {
        const pillBtns = pillRow.querySelectorAll(".preset-pill-btn");
        pillBtns.forEach((btn) => {
          const pillVal = btn.getAttribute("data-ghost-pill");
          if (pillVal === "off") {
            btn.classList.toggle("active", activeList.length === 0);
          } else {
            btn.classList.toggle("active", activeList.includes(pillVal));
          }
        });
      }

      // Ghost Runner dropdown sync
      const selGhost = document.getElementById("select-ghost-comparison");
      if (selGhost) {
        selGhost.innerHTML = "";

        const defaultGhostOpts = [
          { val: "off", label: "Off (Disabled)" },
          { val: "wr", label: "World Record (🏆)" },
          { val: "pb", label: "Personal Best (🥈)" },
          { val: "wr,pb", label: "Dual: WR (🏆) + PB (🥈)" },
          { val: "best", label: "Best Segments (⭐)" },
          { val: "wr,best", label: "Dual: WR (🏆) + Best (⭐)" },
          { val: "average", label: "Average Segments (📊)" },
          { val: "worst", label: "Worst Segments (🐢)" }
        ];

        let optionMatched = false;
        defaultGhostOpts.forEach(o => {
          const opt = document.createElement("option");
          opt.value = o.val;
          opt.innerText = o.label;
          const optList = o.val === "off" ? [] : o.val.split(",");
          const isMatch = (o.val === "off" && activeList.length === 0) ||
            (optList.length === activeList.length && optList.every(id => activeList.includes(id)));
          if (isMatch) {
            opt.selected = true;
            optionMatched = true;
          }
          selGhost.appendChild(opt);
        });

        // Add custom comparisons if present
        if (typeof window !== "undefined" && window.getComparisonsList) {
          const comps = window.getComparisonsList();
          comps.forEach(c => {
            const low = c.toLowerCase();
            if (
              !["personal best", "best segments", "average segments", "worst segments"].includes(low) &&
              !low.includes("world record") && low !== "wr"
            ) {
              const opt = document.createElement("option");
              opt.value = c;
              opt.innerText = `👤 ${c}`;
              if (activeList.length === 1 && activeList[0] === c) {
                opt.selected = true;
                optionMatched = true;
              }
              selGhost.appendChild(opt);
            }
          });
        }

        if (!optionMatched && activeList.length > 0) {
          const customOpt = document.createElement("option");
          customOpt.value = activeKey;
          customOpt.innerText = `Custom: ${activeList.join(" + ")}`;
          customOpt.selected = true;
          selGhost.appendChild(customOpt);
        }
      }

      // Ghost Runner pin length slider
      const sGhostLen = document.getElementById("slider-ghost-pin-length");
      const vGhostLen = document.getElementById("val-ghost-pin-length");
      const pinLenVal = currentTrackStyle.ghostPinLength != null ? currentTrackStyle.ghostPinLength : 16;
      if (sGhostLen && vGhostLen) {
        sGhostLen.value = pinLenVal;
        vGhostLen.innerText = (pinLenVal === 0 ? "0px (On Track)" : `${pinLenVal}px`);
      }

      // Ghost Runner pinhead size slider
      const sGhostSize = document.getElementById("slider-ghost-pin-size");
      const vGhostSize = document.getElementById("val-ghost-pin-size");
      const pinSizeVal = currentTrackStyle.ghostPinSize != null ? currentTrackStyle.ghostPinSize : 26;
      if (sGhostSize && vGhostSize) {
        sGhostSize.value = pinSizeVal;
        vGhostSize.innerText = `${pinSizeVal}px`;
      }

      // Ghost Runner opacity slider
      const sGhostOp = document.getElementById("slider-ghost-opacity");
      const vGhostOp = document.getElementById("val-ghost-opacity");
      const ghostOpVal = parseInt(localStorage.getItem(STORAGE_KEYS.GHOST_OPACITY) || "85", 10);
      if (sGhostOp && vGhostOp) {
        sGhostOp.value = ghostOpVal;
        vGhostOp.innerText = `${ghostOpVal}%`;
      }

      // Visible Timers segmented control sync
      const curTimerMode = (typeof window !== "undefined" && window.getTimerDisplayMode)
        ? window.getTimerDisplayMode()
        : (localStorage.getItem(STORAGE_KEYS.TIMER_DISPLAY_MODE) || "both");
      document.querySelectorAll("#ctrl-timer-display .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === curTimerMode);
      });

      // Primary Timer & Splits Target segmented control sync
      const curFocus = (typeof window !== "undefined" && window.getCurrentTimingMethod)
        ? window.getCurrentTimingMethod()
        : (localStorage.getItem(STORAGE_KEYS.TIMING_METHOD) || "GameTime");
      document.querySelectorAll("#ctrl-timer-focus .seg-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-val") === curFocus);
      });

      const rowTimerFocus = document.getElementById("row-timer-focus");
      if (rowTimerFocus) {
        rowTimerFocus.style.display = (curTimerMode === "both") ? "flex" : "none";
      }

      // Custom Game Logo sync
      const logoCtrl = getGameLogoController();
      if (logoCtrl) {
        logoCtrl.syncModalUI((currentTrackStyle && currentTrackStyle.logoHeight) || 60);
      }

      // Timer Expansion segmented control sync
      syncTimerAnchorUI();
    }

    function bindToolbarAndControls() {
      // Toolbar buttons
      document.getElementById("btn-lock-layout")?.addEventListener("click", () => setEditMode(false));
      document.getElementById("btn-reset-layout")?.addEventListener("click", resetLayout);
      document.getElementById("layout-edit-btn")?.addEventListener("click", toggleEditMode);

      // Toolbar checkboxes
      const layoutState = getLayoutState();
      COMPONENTS.forEach((id) => {
        const cb = document.getElementById(`cb-toggle-${id}`);
        if (cb) {
          cb.addEventListener("change", () => {
            if (layoutState[id]) {
              layoutState[id].visible = cb.checked;
              applyComponentLayout(id);
              saveLayout();
            }
          });
        }
      });

      // Toolbar Spin Box & Pills for Visible Splits
      document.getElementById("btn-splits-dec")?.addEventListener("click", () => {
        const cur = parseInt(localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS), 10) || 8;
        setVisibleSplits(Math.max(2, cur - 1));
      });
      document.getElementById("btn-splits-inc")?.addEventListener("click", () => {
        const cur = parseInt(localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS), 10) || 8;
        setVisibleSplits(Math.min(60, cur + 1));
      });

      const spinInput = document.getElementById("input-visible-splits");
      if (spinInput) {
        spinInput.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val) && val >= 2 && val <= 60) setVisibleSplits(val);
        });
        spinInput.addEventListener("change", (e) => {
          let val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 2) val = 2;
          if (val > 60) val = 60;
          e.target.value = val;
          setVisibleSplits(val);
        });
      }

      document.getElementById("btn-splits-fit-all")?.addEventListener("click", () => setVisibleSplits("all"));
      document.getElementById("btn-splits-auto")?.addEventListener("click", () => setVisibleSplits("auto"));

      // Modal Spin Box & Pills
      document.getElementById("modal-splits-dec")?.addEventListener("click", () => {
        const cur = parseInt(localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS), 10) || 8;
        setVisibleSplits(Math.max(2, cur - 1));
      });
      document.getElementById("modal-splits-inc")?.addEventListener("click", () => {
        const cur = parseInt(localStorage.getItem(STORAGE_KEYS.VISIBLE_SPLITS), 10) || 8;
        setVisibleSplits(Math.min(60, cur + 1));
      });

      const modalSpinInput = document.getElementById("modal-input-visible-splits");
      if (modalSpinInput) {
        modalSpinInput.addEventListener("input", (e) => {
          const val = parseInt(e.target.value, 10);
          if (!isNaN(val) && val >= 2 && val <= 60) setVisibleSplits(val);
        });
        modalSpinInput.addEventListener("change", (e) => {
          let val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 2) val = 2;
          if (val > 60) val = 60;
          e.target.value = val;
          setVisibleSplits(val);
        });
      }

      document.getElementById("modal-btn-splits-all")?.addEventListener("click", () => setVisibleSplits("all"));
      document.getElementById("modal-btn-splits-auto")?.addEventListener("click", () => setVisibleSplits("auto"));

      // Toolbar Angle Select
      const angleSelect = document.getElementById("select-split-angle");
      if (angleSelect) {
        angleSelect.addEventListener("change", () => {
          const val = angleSelect.value;
          localStorage.setItem(STORAGE_KEYS.SPLIT_ANGLE, val);
          const currentTrackStyle = getCurrentTrackStyle();
          if (val === "angled" && currentTrackStyle) {
            currentTrackStyle.deltaPos = (currentTrackStyle.namePos === "top") ? "bottom" : "top";
            saveTrackStyle();
          }
          applyTrackStyle();
          if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
        });
      }

      // Modal Angle Segmented Control
      document.querySelectorAll("#ctrl-modal-angle .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-val");
          localStorage.setItem(STORAGE_KEYS.SPLIT_ANGLE, val);
          const currentTrackStyle = getCurrentTrackStyle();
          if (val === "angled" && currentTrackStyle) {
            currentTrackStyle.deltaPos = (currentTrackStyle.namePos === "top") ? "bottom" : "top";
            saveTrackStyle();
          }
          applyTrackStyle();
          if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
        });
      });

      // Track Orientation controls
      document.querySelectorAll("#ctrl-track-orient .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          setTrackOrientation(btn.getAttribute("data-val"));
        });
      });
      document.getElementById("track-orient-badge")?.addEventListener("click", () => {
        const currentTrackStyle = getCurrentTrackStyle();
        const cur = (currentTrackStyle && currentTrackStyle.orientation) || "horizontal";
        setTrackOrientation(cur === "vertical" ? "horizontal" : "vertical");
      });

      // Track Styler modal triggers
      document.getElementById("btn-open-track-modal")?.addEventListener("click", openTrackModal);
      document.getElementById("track-style-badge")?.addEventListener("click", openTrackModal);
      document.getElementById("btn-close-track-modal")?.addEventListener("click", closeTrackModal);
      document.getElementById("btn-save-track-style")?.addEventListener("click", closeTrackModal);
      document.getElementById("btn-reset-track-style")?.addEventListener("click", resetTrackStyle);

      // Modal backdrop click to close
      document.getElementById("track-modal")?.addEventListener("click", (e) => {
        if (e.target.id === "track-modal") {
          closeTrackModal();
        }
      });

      // Segmented controls for Name and Delta positions
      document.querySelectorAll("#ctrl-name-pos .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.namePos = btn.getAttribute("data-val");
          const anglePref = localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
          const track = document.getElementById("track");
          const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));
          if (isAngled) {
            currentTrackStyle.deltaPos = (currentTrackStyle.namePos === "top") ? "bottom" : "top";
          }
          applyTrackStyle();
          saveTrackStyle();
        });
      });

      document.querySelectorAll("#ctrl-delta-pos .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          const anglePref = localStorage.getItem(STORAGE_KEYS.SPLIT_ANGLE) || "auto";
          const track = document.getElementById("track");
          const isAngled = (anglePref === "angled" || (track && track.classList.contains("angled-text")));
          if (isAngled) {
            currentTrackStyle.deltaPos = btn.getAttribute("data-val");
            currentTrackStyle.namePos = (currentTrackStyle.deltaPos === "top") ? "bottom" : "top";
          } else {
            currentTrackStyle.deltaPos = btn.getAttribute("data-val");
          }
          applyTrackStyle();
          saveTrackStyle();
        });
      });

      // Background Opacity slider
      const sliderBgOpacity = document.getElementById("slider-bg-opacity");
      if (sliderBgOpacity) {
        sliderBgOpacity.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.bgOpacity = parseInt(sliderBgOpacity.value, 10);
          const vBg = document.getElementById("val-bg-opacity");
          if (vBg) vBg.innerText = (currentTrackStyle.bgOpacity === 0) ? "0% (Off)" : `${currentTrackStyle.bgOpacity}%`;
          applyTrackStyle();
        });
        sliderBgOpacity.addEventListener("change", saveTrackStyle);
      }

      // Background Blur slider
      const sliderBgBlur = document.getElementById("slider-bg-blur");
      if (sliderBgBlur) {
        sliderBgBlur.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.bgBlur = parseInt(sliderBgBlur.value, 10);
          const vBlur = document.getElementById("val-bg-blur");
          if (vBlur) vBlur.innerText = `${currentTrackStyle.bgBlur}px`;
          applyTrackStyle();
        });
        sliderBgBlur.addEventListener("change", saveTrackStyle);
      }

      // Background Preset buttons
      document.querySelectorAll(".preset-pill-btn[data-preset-bg]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          const val = parseInt(btn.getAttribute("data-preset-bg"), 10);
          if (!isNaN(val)) {
            currentTrackStyle.bgOpacity = val;
            applyTrackStyle();
            saveTrackStyle();
          }
        });
      });

      // Ghost Runner Pill Buttons
      document.querySelectorAll("#ghost-pill-row .preset-pill-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pillVal = btn.getAttribute("data-ghost-pill");
          if (pillVal && typeof window !== "undefined" && window.toggleGhostComparison) {
            window.toggleGhostComparison(pillVal);
          }
        });
      });

      // Component background checkboxes
      document.getElementById("cb-bg-title")?.addEventListener("change", (e) => {
        const currentTrackStyle = getCurrentTrackStyle();
        if (currentTrackStyle) {
          currentTrackStyle.bgTitle = e.target.checked;
          applyTrackStyle();
          saveTrackStyle();
        }
      });
      document.getElementById("cb-bg-timers")?.addEventListener("change", (e) => {
        const currentTrackStyle = getCurrentTrackStyle();
        if (currentTrackStyle) {
          currentTrackStyle.bgTimers = e.target.checked;
          applyTrackStyle();
          saveTrackStyle();
        }
      });
      document.getElementById("cb-bg-track")?.addEventListener("change", (e) => {
        const currentTrackStyle = getCurrentTrackStyle();
        if (currentTrackStyle) {
          currentTrackStyle.bgTrack = e.target.checked;
          applyTrackStyle();
          saveTrackStyle();
        }
      });

      // Footer BG badge click to cycle presets
      document.getElementById("bg-opacity-badge")?.addEventListener("click", () => {
        const currentTrackStyle = getCurrentTrackStyle();
        if (!currentTrackStyle) return;
        const presets = [55, 80, 0, 35];
        const cur = currentTrackStyle.bgOpacity != null ? currentTrackStyle.bgOpacity : 55;
        const idx = presets.indexOf(cur);
        const nextVal = (idx !== -1) ? presets[(idx + 1) % presets.length] : 55;
        currentTrackStyle.bgOpacity = nextVal;
        applyTrackStyle();
        saveTrackStyle();
      });

      // Discard in-run golds on reset checkbox listener
      document.getElementById("cb-discard-golds-reset")?.addEventListener("change", (e) => {
        localStorage.setItem(STORAGE_KEYS.DISCARD_GOLDS_ON_RESET, e.target.checked ? "true" : "false");
      });

      // Active comparison dropdown listener
      document.getElementById("select-active-comparison")?.addEventListener("change", (e) => {
        if (typeof window !== "undefined" && window.applyActiveComparison) {
          window.applyActiveComparison(e.target.value, true);
        }
      });

      // Auto-sync with LiveSplit hotkeys listener
      document.getElementById("cb-sync-livesplit-hotkeys")?.addEventListener("change", (e) => {
        localStorage.setItem(STORAGE_KEYS.SYNC_HOTKEYS, e.target.checked ? "true" : "false");
      });

      // Always Show Last Split checkbox listener
      document.getElementById("cb-always-show-last-split")?.addEventListener("change", (e) => {
        localStorage.setItem(STORAGE_KEYS.ALWAYS_SHOW_LAST, e.target.checked ? "true" : "false");
        if (typeof window !== "undefined" && window.updateTrackDensityAndAngle) window.updateTrackDensityAndAngle();
        if (typeof window !== "undefined" && window.updateTrackStatus) window.updateTrackStatus(window.getCurrentIndex ? window.getCurrentIndex() : -1);
      });

      // Visible Timers segmented control listener
      document.querySelectorAll("#ctrl-timer-display .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-val");
          if (typeof window !== "undefined" && window.setTimerDisplayMode) {
            window.setTimerDisplayMode(val);
          }
        });
      });

      // Primary Timer & Splits Target segmented control listener
      document.querySelectorAll("#ctrl-timer-focus .seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-val");
          if (typeof window !== "undefined") {
            if (window.setTimingMethodFocus) {
              window.setTimingMethodFocus(val);
            } else if (window.applyActiveTimingMethod) {
              window.applyActiveTimingMethod(val);
            }
          }
        });
      });

      // Timer Expansion & Alignment controller listeners
      syncTimerAnchorUI();

      // Ghost Runner dropdown listener
      document.getElementById("select-ghost-comparison")?.addEventListener("change", (e) => {
        if (typeof window !== "undefined" && window.setGhostComparison) {
          window.setGhostComparison(e.target.value);
        } else {
          localStorage.setItem(STORAGE_KEYS.GHOST_COMPARISON, e.target.value);
        }
      });

      // Ghost Runner pin length slider listener
      const sliderGhostLen = document.getElementById("slider-ghost-pin-length");
      if (sliderGhostLen) {
        sliderGhostLen.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          const val = parseInt(sliderGhostLen.value, 10);
          currentTrackStyle.ghostPinLength = val;
          const valBadge = document.getElementById("val-ghost-pin-length");
          if (valBadge) valBadge.innerText = (val === 0 ? "0px (On Track)" : `${val}px`);
          applyTrackStyle();
        });
        sliderGhostLen.addEventListener("change", saveTrackStyle);
      }

      // Ghost Runner pinhead size slider listener
      const sliderGhostSize = document.getElementById("slider-ghost-pin-size");
      if (sliderGhostSize) {
        sliderGhostSize.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          const val = parseInt(sliderGhostSize.value, 10);
          currentTrackStyle.ghostPinSize = val;
          const valBadge = document.getElementById("val-ghost-pin-size");
          if (valBadge) valBadge.innerText = `${val}px`;
          applyTrackStyle();
        });
        sliderGhostSize.addEventListener("change", saveTrackStyle);
      }

      // Ghost Runner opacity slider listener
      const sliderGhostOp = document.getElementById("slider-ghost-opacity");
      if (sliderGhostOp) {
        sliderGhostOp.addEventListener("input", () => {
          const valBadge = document.getElementById("val-ghost-opacity");
          if (valBadge) valBadge.innerText = `${sliderGhostOp.value}%`;
          if (typeof window !== "undefined" && window.setGhostOpacity) {
            window.setGhostOpacity(sliderGhostOp.value);
          }
        });
        sliderGhostOp.addEventListener("change", () => {
          localStorage.setItem(STORAGE_KEYS.GHOST_OPACITY, sliderGhostOp.value);
        });
      }

      // Live slider input listeners
      const sliderNameFont = document.getElementById("slider-name-font");
      if (sliderNameFont) {
        sliderNameFont.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.nameFontSize = parseInt(sliderNameFont.value, 10);
          const v = document.getElementById("val-name-font");
          if (v) v.innerText = `${sliderNameFont.value}px`;
          applyTrackStyle();
        });
        sliderNameFont.addEventListener("change", saveTrackStyle);
      }

      const sliderDeltaFont = document.getElementById("slider-delta-font");
      if (sliderDeltaFont) {
        sliderDeltaFont.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.deltaFontSize = parseInt(sliderDeltaFont.value, 10);
          const v = document.getElementById("val-delta-font");
          if (v) v.innerText = `${sliderDeltaFont.value}px`;
          applyTrackStyle();
        });
        sliderDeltaFont.addEventListener("change", saveTrackStyle);
      }

      const sliderBarHeight = document.getElementById("slider-bar-height");
      if (sliderBarHeight) {
        sliderBarHeight.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.barHeight = parseInt(sliderBarHeight.value, 10);
          const v = document.getElementById("val-bar-height");
          if (v) v.innerText = `${sliderBarHeight.value}px`;
          applyTrackStyle();
        });
        sliderBarHeight.addEventListener("change", saveTrackStyle);
      }

      const sliderDotSize = document.getElementById("slider-dot-size");
      if (sliderDotSize) {
        sliderDotSize.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.dotSize = parseInt(sliderDotSize.value, 10);
          const v = document.getElementById("val-dot-size");
          if (v) v.innerText = `${sliderDotSize.value}px`;
          applyTrackStyle();
        });
        sliderDotSize.addEventListener("change", saveTrackStyle);
      }

      // Custom Game Logo Controls
      const sliderLogoHeight = document.getElementById("slider-logo-height");
      if (sliderLogoHeight) {
        sliderLogoHeight.addEventListener("input", () => {
          const currentTrackStyle = getCurrentTrackStyle();
          if (!currentTrackStyle) return;
          currentTrackStyle.logoHeight = parseInt(sliderLogoHeight.value, 10);
          const v = document.getElementById("val-logo-height");
          if (v) v.innerText = `${sliderLogoHeight.value}px`;
          applyTrackStyle();
        });
        sliderLogoHeight.addEventListener("change", saveTrackStyle);
      }

      const logoCtrl = getGameLogoController();
      if (logoCtrl) {
        logoCtrl.bindEvents();
      }

      // Profiles Engine Delegation for Presets & Dropdown
      const pe = getProfilesEngine();
      if (pe) {
        const btnProfileDropdown = document.getElementById("btn-profile-dropdown");
        if (btnProfileDropdown) {
          btnProfileDropdown.addEventListener("click", (e) => {
            e.stopPropagation();
            pe.toggleProfileDropdown();
          });
        }

        document.addEventListener("click", (e) => {
          const wrap = document.getElementById("profile-dropdown-wrap");
          if (wrap && !wrap.contains(e.target)) {
            pe.toggleProfileDropdown(false);
          }
        });

        const selectProfile = document.getElementById("select-layout-profile");
        if (selectProfile) {
          selectProfile.addEventListener("change", (e) => {
            pe.loadProfileByName(e.target.value);
          });
        }

        const btnSaveProfile = document.getElementById("btn-save-profile");
        if (btnSaveProfile) {
          btnSaveProfile.addEventListener("click", () => {
            const active = pe.getActiveProfileName();
            const exportData = pe.createProfileExport(active);
            pe.saveProfileToStorage(active, exportData);
            const origText = btnSaveProfile.innerText;
            btnSaveProfile.innerText = "✓ Saved!";
            setTimeout(() => {
              btnSaveProfile.innerText = origText;
            }, 1200);
          });
        }

        const barDefault = document.getElementById("profile-bar-default");
        const barNew = document.getElementById("profile-bar-new");
        const barDelete = document.getElementById("profile-bar-delete");
        const inputNew = document.getElementById("input-new-profile-name");

        const showProfileBar = (mode) => {
          if (barDefault) barDefault.style.display = (mode === "default") ? "flex" : "none";
          if (barNew) barNew.style.display = (mode === "new") ? "flex" : "none";
          if (barDelete) barDelete.style.display = (mode === "delete") ? "flex" : "none";
        };

        const btnSaveAsProfile = document.getElementById("btn-save-as-profile");
        if (btnSaveAsProfile) {
          btnSaveAsProfile.addEventListener("click", () => {
            showProfileBar("new");
            if (inputNew) {
              inputNew.value = "";
              setTimeout(() => inputNew.focus(), 50);
            }
          });
        }

        const handleCreateProfile = () => {
          if (!inputNew) return;
          const name = inputNew.value.trim();
          if (name) {
            const exportData = pe.createProfileExport(name);
            pe.saveProfileToStorage(name, exportData);
            pe.setActiveProfileName(name);
            pe.syncProfileUI();
            showProfileBar("default");
          }
        };

        const btnConfirmNew = document.getElementById("btn-confirm-new-profile");
        if (btnConfirmNew) {
          btnConfirmNew.addEventListener("click", handleCreateProfile);
        }

        const btnCancelNew = document.getElementById("btn-cancel-new-profile");
        if (btnCancelNew) {
          btnCancelNew.addEventListener("click", () => {
            showProfileBar("default");
          });
        }

        if (inputNew) {
          inputNew.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreateProfile();
            } else if (e.key === "Escape") {
              e.preventDefault();
              showProfileBar("default");
            }
          });
        }

        const btnDeleteProfile = document.getElementById("btn-delete-profile");
        if (btnDeleteProfile) {
          btnDeleteProfile.addEventListener("click", () => {
            const active = pe.getActiveProfileName();
            if (active && active !== "Default") {
              showProfileBar("delete");
            }
          });
        }

        const btnConfirmDelete = document.getElementById("btn-confirm-delete-profile");
        if (btnConfirmDelete) {
          btnConfirmDelete.addEventListener("click", () => {
            const active = pe.getActiveProfileName();
            if (active && active !== "Default") {
              pe.deleteProfileFromStorage(active);
            }
            showProfileBar("default");
          });
        }

        const btnCancelDelete = document.getElementById("btn-cancel-delete-profile");
        if (btnCancelDelete) {
          btnCancelDelete.addEventListener("click", () => {
            showProfileBar("default");
          });
        }

        const btnExportProfile = document.getElementById("btn-export-profile");
        if (btnExportProfile) {
          btnExportProfile.addEventListener("click", () => {
            pe.exportProfileToFile();
          });
        }

        const btnCloseExportModal = document.getElementById("btn-close-export-modal");
        if (btnCloseExportModal) {
          btnCloseExportModal.addEventListener("click", pe.closeExportModal);
        }

        document.getElementById("layout-export-modal")?.addEventListener("click", (e) => {
          if (e.target.id === "layout-export-modal") {
            pe.closeExportModal();
          }
        });

        const btnCopyExportJson = document.getElementById("btn-copy-export-json");
        if (btnCopyExportJson) {
          btnCopyExportJson.addEventListener("click", () => {
            const ta = document.getElementById("export-json-textarea");
            const banner = document.getElementById("export-status-banner");
            if (ta) {
              ta.select();
              const copySuccess = () => {
                btnCopyExportJson.innerText = "✓ Copied!";
                if (banner) banner.textContent = "✓ Copied to clipboard!";
                setTimeout(() => { btnCopyExportJson.innerText = "📋 Copy JSON"; }, 1500);
              };
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(ta.value).then(copySuccess).catch(() => {
                  try { document.execCommand("copy"); copySuccess(); } catch (_) {}
                });
              } else {
                try { document.execCommand("copy"); copySuccess(); } catch (_) {}
              }
            }
          });
        }

        const btnRedownloadExportJson = document.getElementById("btn-redownload-export-json");
        if (btnRedownloadExportJson) {
          btnRedownloadExportJson.addEventListener("click", () => {
            const ta = document.getElementById("export-json-textarea");
            const banner = document.getElementById("export-status-banner");
            const active = pe.getActiveProfileName() || "Default";
            const safeName = active.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
            const filename = `livesplit-layout-${safeName}.json`;
            if (ta && ta.value) {
              pe.triggerFileDownload(filename, ta.value);
              btnRedownloadExportJson.textContent = "✓ Downloaded!";
              if (banner) {
                banner.textContent = `✓ Download initiated for ${filename}`;
              }
              setTimeout(() => {
                btnRedownloadExportJson.textContent = "💾 Download .json";
              }, 2500);
            }
          });
        }

        // Import Modal Controls
        const btnOpenImportModal = document.getElementById("btn-open-import-modal");
        if (btnOpenImportModal) {
          btnOpenImportModal.addEventListener("click", pe.openImportModal);
        }

        const btnCloseImportModal = document.getElementById("btn-close-import-modal");
        if (btnCloseImportModal) {
          btnCloseImportModal.addEventListener("click", pe.closeImportModal);
        }

        const btnCancelImport = document.getElementById("btn-cancel-import");
        if (btnCancelImport) {
          btnCancelImport.addEventListener("click", pe.closeImportModal);
        }

        document.getElementById("layout-import-modal")?.addEventListener("click", (e) => {
          if (e.target.id === "layout-import-modal") {
            pe.closeImportModal();
          }
        });

        const btnApplyImportJson = document.getElementById("btn-apply-import-json");
        if (btnApplyImportJson) {
          btnApplyImportJson.addEventListener("click", () => {
            const ta = document.getElementById("import-json-textarea");
            const err = document.getElementById("import-error-msg");
            if (!ta || !ta.value.trim()) {
              if (err) {
                err.textContent = "Please paste layout JSON or select a file";
                err.style.display = "block";
              }
              return;
            }
            try {
              const parsed = JSON.parse(ta.value.trim());
              if (!parsed || typeof parsed !== "object") {
                throw new Error("Invalid JSON: expected a layout configuration object");
              }
              const profName = parsed.name || "Imported Layout";
              pe.applyProfileData(parsed, profName);
              pe.closeImportModal();
            } catch (e) {
              if (err) {
                err.textContent = `Import error: ${e.message}`;
                err.style.display = "block";
              }
            }
          });
        }

        const inputImportProfile = document.getElementById("input-import-profile");
        if (inputImportProfile) {
          inputImportProfile.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
              pe.importProfileFromFile(file).then((profName) => {
                console.log(`Successfully imported layout profile: ${profName}`);
                pe.closeImportModal();
              }).catch((err) => {
                console.error("Failed to import layout profile:", err);
                const errMsg = document.getElementById("import-error-msg");
                if (errMsg) {
                  errMsg.textContent = `Import error: ${err.message}`;
                  errMsg.style.display = "block";
                }
              });
              e.target.value = "";
            }
          });
        }
      }

      // Keyboard Hotkeys: 'E' / 'F2' toggles edit mode, 'Escape' exits modal or edit mode
      window.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

        if (e.key === "e" || e.key === "E" || e.key === "F2") {
          e.preventDefault();
          toggleEditMode();
        } else if (e.key === "Escape") {
          const importModal = document.getElementById("layout-import-modal");
          if (importModal && importModal.classList.contains("is-open")) {
            e.preventDefault();
            const pe = getProfilesEngine();
            if (pe) pe.closeImportModal();
            return;
          }
          const exportModal = document.getElementById("layout-export-modal");
          if (exportModal && exportModal.classList.contains("is-open")) {
            e.preventDefault();
            const pe = getProfilesEngine();
            if (pe) pe.closeExportModal();
            return;
          }
          const modal = document.getElementById("track-modal");
          if (modal && modal.classList.contains("is-open")) {
            e.preventDefault();
            closeTrackModal();
          } else if (isEditMode()) {
            e.preventDefault();
            setEditMode(false);
          }
        }
      });

      // Responsive window resize clamping
      window.addEventListener("resize", () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const layoutState = getLayoutState();

        for (const id of COMPONENTS) {
          const state = layoutState[id];
          if (!state) continue;
          if (state.docked === "bottom" && id === "track") {
            state.y = Math.max(0, h - 90);
          } else if (id === "timers") {
            const compWidth = document.getElementById("hud-comp-timers")?.offsetWidth || 300;
            const anchorPref = getTimerAnchor();
            let isRight = false;
            if (anchorPref === "right") {
              isRight = true;
            } else if (anchorPref === "left") {
              isRight = false;
            } else {
              const midPoint = state.x + (compWidth / 2);
              isRight = (midPoint > w / 2);
            }
            if (isRight) {
              if (typeof state.right === "number") {
                state.right = Math.max(0, Math.min(w - 80, state.right));
                state.x = Math.max(0, w - (state.right + compWidth));
              } else {
                state.x = Math.max(0, Math.min(w - 80, state.x));
                state.right = Math.max(0, w - (state.x + compWidth));
              }
            } else {
              state.x = Math.max(0, Math.min(w - 80, state.x));
              state.right = Math.max(0, w - (state.x + compWidth));
            }
            state.y = Math.max(0, Math.min(h - 50, state.y));
          } else {
            state.x = Math.max(0, Math.min(w - 80, state.x));
            state.y = Math.max(0, Math.min(h - 50, state.y));
          }
          applyComponentLayout(id);
        }

        syncTimerAnchorUI();

        if (window.updateTrackDensityAndAngle) {
          window.updateTrackDensityAndAngle();
        }
        if (window.updateTrackStatus) {
          window.updateTrackStatus(window.getCurrentIndex ? window.getCurrentIndex() : -1);
        }
      });
    }

    return {
      openTrackModal,
      closeTrackModal,
      syncUI,
      bindToolbarAndControls
    };
  }

  // Global namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutModal = {
    createLayoutModal
  };
})();
