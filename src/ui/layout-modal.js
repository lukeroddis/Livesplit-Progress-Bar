/**
 * src/ui/layout-modal.js - Layout Toolbar & Widget Settings Controller
 *
 * Composes the settings panels shared by the edit-mode toolbar and the widget
 * settings popovers, and owns the controls that belong to the layout itself:
 * - Full settings sync (popover open, entering Layout Mode)
 * - Widget header cogs: toggle the component's settings popover (widget-popover.js); the
 *   leaderboard, which has none yet, opens the settings menu at its race section
 * - Settings panels: track (settings-track-panel.js), backgrounds
 *   (settings-background-panel.js), ghosts (settings-ghost-panel.js), timing
 *   (settings-timing-panel.js), profiles (layout-profiles-panel.js)
 * - Toolbar lock / reset / edit buttons and component visibility checkboxes
 * - Custom logo height slider
 * - Global hotkeys ('E' / 'F2' edit mode, 'Escape' closes modals / the popover) and resize clamping
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

    const popovers = window.LiveSplit.WidgetPopover.createWidgetPopovers({
      onOpen: () => syncUI(),
      onClose: () => saveTrackStyle(),
      // Only widgets with style keys of their own have a reset (never the whole style)
      onReset: (compId) => {
        const keys = window.LiveSplit.TrackStyle.WIDGET_STYLE_KEYS[compId];
        if (!keys) return;
        resetTrackStyle(keys);
        syncUI();
      }
    });

    // Widget cog: the component's popover (toggled); the leaderboard has none yet, so its cog opens
    // the settings menu at the race section, scrolled to and flashing
    function openWidgetSettings(compId) {
      if (popovers.toggle(compId)) return;
      if (compId !== "leaderboard") return;
      window.LiveSplit.Overlay.toggleSettingsMenu?.(true);
      const section = document.querySelector(`[data-widget-settings="${compId}"]`);
      if (!section) return;
      section.scrollIntoView({ block: "start", behavior: "smooth" });
      section.classList.remove("widget-settings-flash");
      section.getBoundingClientRect(); // restart the flash animation
      section.classList.add("widget-settings-flash");
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
      syncRegistryToggles();
    }

    // Checkboxes marked data-setting="<id>" drive a bool setting of the registry (Overlay.settings)
    function syncRegistryToggles() {
      const settings = window.LiveSplit.Overlay.settings;
      if (!settings) return;
      document.querySelectorAll("input[type=checkbox][data-setting]").forEach((cb) => {
        cb.checked = settings.get(cb.dataset.setting) === true;
      });
    }

    function bindRegistryToggles() {
      document.querySelectorAll("input[type=checkbox][data-setting]").forEach((cb) => {
        cb.addEventListener("change", () => window.LiveSplit.Overlay.settings?.set(cb.dataset.setting, cb.checked));
      });
      // Changes from elsewhere (the dock) show up while a popover is open
      window.LiveSplit.Overlay.settings?.subscribe(syncRegistryToggles);
    }

    function bindToolbar() {
      document.getElementById("btn-lock-layout")?.addEventListener("click", () => setEditMode(false));
      document.getElementById("btn-reset-layout")?.addEventListener("click", resetLayout);
      document.getElementById("layout-edit-btn")?.addEventListener("click", toggleEditMode);

      // Component visibility checkboxes (through the settings registry, so listeners hear it)
      COMPONENTS.forEach((id) => {
        document.getElementById(`cb-toggle-${id}`)?.addEventListener("change", (e) => {
          window.LiveSplit.Overlay.settings?.set(`visible.${id}`, e.target.checked);
        });
      });
    }

    function bindModalTriggers() {
      document.querySelectorAll('.hud-component [data-action="open-settings"]').forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openWidgetSettings(btn.closest(".hud-component")?.dataset.componentId);
        });
      });
      // Buttons elsewhere (the settings menu's "Widget Settings") that open a widget's popover
      document.querySelectorAll("[data-open-widget-popover]").forEach((btn) => btn.addEventListener("click", () => {
        window.LiveSplit.Overlay.toggleSettingsMenu?.(false);
        setEditMode(true);
        popovers.open(btn.dataset.openWidgetPopover);
      }));
      popovers.bind();
      bindRegistryToggles();
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
          if (popovers.isOpen()) {
            e.preventDefault();
            popovers.close();
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
          } else if (state.docked === "right" && id === "track") {
            state.x = Math.max(0, w - 340);
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
      openWidgetSettings,
      closeWidgetPopover: popovers.close,
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
