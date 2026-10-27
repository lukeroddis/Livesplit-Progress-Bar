/**
 * src/ui/layout-modal.js - Layout Toolbar & Track Customizer Modal Controller
 *
 * Composes the settings panels shared by the edit-mode toolbar and the track
 * customizer modal, and owns the controls that belong to the layout itself:
 * - Modal open / close (backdrop, buttons, Escape) and full settings sync
 * - Settings panels: track (settings-track-panel.js), backgrounds
 *   (settings-background-panel.js), ghosts (settings-ghost-panel.js), timing
 *   (settings-timing-panel.js), profiles (layout-profiles-panel.js)
 * - Toolbar lock / reset / edit buttons and component visibility checkboxes
 * - Custom logo height slider
 * - Global hotkeys ('E' / 'F2' edit mode, 'Escape' closes modals) and resize clamping
 */

(function () {
  "use strict";

  const C = window.LiveSplit.SettingsControls;

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

    const styleDeps = { getCurrentTrackStyle, saveTrackStyle, applyTrackStyle };
    const panels = [
      window.LiveSplit.SettingsTrackPanel.createTrackPanel(Object.assign({ setTrackOrientation, setVisibleSplits }, styleDeps)),
      window.LiveSplit.SettingsBackgroundPanel.createBackgroundPanel(styleDeps),
      window.LiveSplit.SettingsGhostPanel.createGhostPanel(styleDeps),
      window.LiveSplit.SettingsTimingPanel.createTimingPanel()
    ];

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

      panels.forEach((panel) => panel.sync(currentTrackStyle));

      const logoCtrl = getGameLogoController();
      if (logoCtrl) {
        logoCtrl.syncModalUI(currentTrackStyle.logoHeight || 60);
      }

      syncTimerAnchorUI();
    }

    function bindToolbar() {
      document.getElementById("btn-lock-layout")?.addEventListener("click", () => setEditMode(false));
      document.getElementById("btn-reset-layout")?.addEventListener("click", resetLayout);
      document.getElementById("layout-edit-btn")?.addEventListener("click", toggleEditMode);

      // Component visibility checkboxes
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
    }

    function bindModalTriggers() {
      document.getElementById("btn-open-track-modal")?.addEventListener("click", openTrackModal);
      document.getElementById("track-style-badge")?.addEventListener("click", openTrackModal);
      document.getElementById("btn-close-track-modal")?.addEventListener("click", closeTrackModal);
      document.getElementById("btn-save-track-style")?.addEventListener("click", closeTrackModal);
      document.getElementById("btn-reset-track-style")?.addEventListener("click", resetTrackStyle);

      document.getElementById("track-modal")?.addEventListener("click", (e) => {
        if (e.target.id === "track-modal") {
          closeTrackModal();
        }
      });
    }

    function bindLogoControls() {
      C.bindStyleSlider({
        sliderId: "slider-logo-height",
        badgeId: "val-logo-height",
        prop: "logoHeight",
        format: C.formats.px,
        getStyle: getCurrentTrackStyle,
        applyStyle: applyTrackStyle,
        saveStyle: saveTrackStyle
      });
      const logoCtrl = getGameLogoController();
      if (logoCtrl) {
        logoCtrl.bindEvents();
      }
    }

    // 'E' / 'F2' toggles edit mode; 'Escape' closes the topmost modal, else leaves edit mode
    function bindHotkeys() {
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
    }

    // Keep components on screen when the window shrinks (timers keep their anchored edge)
    function bindResizeClamp() {
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

        window.LiveSplit.Overlay.refreshTrack?.();
      });
    }

    function bindToolbarAndControls() {
      bindToolbar();
      bindModalTriggers();
      panels.forEach((panel) => panel.bind());
      syncTimerAnchorUI();
      bindLogoControls();
      window.LiveSplit.LayoutProfilesPanel.bindLayoutProfilesPanel(getProfilesEngine());
      bindHotkeys();
      bindResizeClamp();
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
