/**
 * src/ui/settings-dialog-rows.js - Registry Setting Rows in the Overlay's Dialogs
 *
 * Fills each `[data-settings="id id ..."]` element in the settings dialogs with
 * rows for those registry settings, built by the shared settings renderer (the
 * same controls as the OBS dock) and wired to the overlay's settings controller
 * (window.LiveSplit.Overlay.settings). Rows are rebuilt on build() (a dialog
 * opening: options such as the comparisons may have changed) and show every
 * change made through the controller, wherever it came from (dock, hotkeys).
 */

(function () {
  "use strict";

  /**
   * @param {Object} [options]
   * @param {Function} [options.getSettings] - The settings controller (app.settings)
   * @param {ParentNode} [options.root] - Where to look for [data-settings] containers
   */
  function createDialogRows({ getSettings = () => window.LiveSplit.Overlay.settings, root = document } = {}) {
    const renderer = window.LiveSplit.SettingsRenderer.createSettingsRenderer({
      set: (id, value) => getSettings()?.set(id, value),
      run: (id, value) => getSettings()?.run(id, value),
      getValue: (id) => getSettings()?.get(id)
    });
    let subscribed = false;

    function update() {
      const settings = getSettings();
      if (settings) renderer.update(settings.snapshot());
    }

    function build() {
      const settings = getSettings();
      if (!settings) return;
      renderer.reset();
      const schema = new Map(window.LiveSplit.SettingsRegistry.describeSettings().map((def) => [def.id, def]));
      root.querySelectorAll("[data-settings]").forEach((box) => {
        const rows = box.dataset.settings.split(/\s+/)
          .filter((id) => schema.has(id))
          .map((id) => renderer.row(schema.get(id), settings.options(id)))
          .filter(Boolean);
        box.replaceChildren(...rows);
      });
      update();
      if (!subscribed) {
        settings.subscribe(update);
        subscribed = true;
      }
    }

    return { build, update };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsDialogRows = {
    createDialogRows
  };
})();
