/**
 * tests/unit/ui/layout-profiles-panel.test.js
 * LiveSplit.LayoutProfilesPanel: profile bar (save, save-as, delete), export modal
 * (copy / re-download) and import modal (paste JSON, pick a file) against a recording
 * stand-in for the LayoutProfiles engine.
 */

(function () {
  "use strict";

  const { mountHtml, waitFor } = window.TestUtils;

  const PANEL_HTML = `
    <div id="profile-dropdown-wrap"><button id="btn-profile-dropdown"></button></div>
    <select id="select-layout-profile"><option value="Default">Default</option><option value="Speedy">Speedy</option></select>
    <div id="profile-bar-default" style="display: flex;">
      <button id="btn-save-profile">Save</button>
      <button id="btn-save-as-profile"></button>
      <button id="btn-delete-profile"></button>
    </div>
    <div id="profile-bar-new" style="display: none;">
      <input id="input-new-profile-name">
      <button id="btn-confirm-new-profile"></button>
      <button id="btn-cancel-new-profile"></button>
    </div>
    <div id="profile-bar-delete" style="display: none;">
      <button id="btn-confirm-delete-profile"></button>
      <button id="btn-cancel-delete-profile"></button>
    </div>
    <button id="btn-export-profile"></button>
    <div id="layout-export-modal"><div class="dialog">
      <textarea id="export-json-textarea"></textarea>
      <div id="export-status-banner"></div>
      <button id="btn-copy-export-json"></button>
      <button id="btn-redownload-export-json"></button>
      <button id="btn-close-export-modal"></button>
    </div></div>
    <button id="btn-open-import-modal"></button>
    <div id="layout-import-modal"><div class="dialog">
      <textarea id="import-json-textarea"></textarea>
      <div id="import-error-msg" style="display: none;"></div>
      <input type="file" id="input-import-profile">
      <button id="btn-apply-import-json"></button>
      <button id="btn-cancel-import"></button>
      <button id="btn-close-import-modal"></button>
    </div></div>`;

  function makeEngine(active = "Speedy") {
    const calls = [];
    const rec = (name, ret) => (...args) => { calls.push({ name, args }); return typeof ret === "function" ? ret(...args) : ret; };
    const pe = {
      calls,
      called: (name) => calls.filter((c) => c.name === name),
      active,
      getActiveProfileName: () => pe.active,
      toggleProfileDropdown: rec("toggleProfileDropdown"),
      loadProfileByName: rec("loadProfileByName"),
      saveProfileToStorage: rec("saveProfileToStorage"),
      createProfileExport: rec("createProfileExport", (name) => ({ name })),
      setActiveProfileName: rec("setActiveProfileName", (name) => { pe.active = name; }),
      syncProfileUI: rec("syncProfileUI"),
      deleteProfileFromStorage: rec("deleteProfileFromStorage"),
      exportProfileToFile: rec("exportProfileToFile"),
      closeExportModal: rec("closeExportModal"),
      openImportModal: rec("openImportModal"),
      closeImportModal: rec("closeImportModal"),
      triggerFileDownload: rec("triggerFileDownload"),
      applyProfileData: rec("applyProfileData"),
      importProfileFromFile: rec("importProfileFromFile", () => Promise.resolve("FromFile"))
    };
    return pe;
  }

  function withPanel(fn, active) {
    const dom = mountHtml(PANEL_HTML);
    const pe = makeEngine(active);
    window.LiveSplit.LayoutProfilesPanel.bindLayoutProfilesPanel(pe);
    const click = (id) => dom.el(id).click();
    const shown = (id) => dom.el(id).style.display;
    let result;
    try {
      result = fn({ dom, pe, click, shown });
    } catch (e) {
      dom.remove();
      throw e;
    }
    if (result && typeof result.then === "function") return result.finally(() => dom.remove());
    dom.remove();
    return result;
  }

  describe("Layout Profiles Panel (LiveSplit.LayoutProfilesPanel)", () => {
    it("ignores a missing engine", () => {
      window.LiveSplit.LayoutProfilesPanel.bindLayoutProfilesPanel(null);
    });

    it("toggles the dropdown, closes it on outside clicks, and loads the selected profile", () => withPanel(({ dom, pe, click }) => {
      click("btn-profile-dropdown");
      assertEqual(pe.called("toggleProfileDropdown")[0].args, [], "button toggles");
      document.body.click();
      assertEqual(pe.called("toggleProfileDropdown")[1].args, [false], "outside click closes");

      const select = dom.el("select-layout-profile");
      select.value = "Speedy";
      select.dispatchEvent(new Event("change"));
      assertEqual(pe.called("loadProfileByName")[0].args, ["Speedy"]);
    }));

    it("saves the active profile and confirms on the button", () => withPanel(({ dom, pe, click }) => {
      click("btn-save-profile");
      assertEqual(pe.called("saveProfileToStorage")[0].args, ["Speedy", { name: "Speedy" }]);
      assertEqual(dom.el("btn-save-profile").innerText, "✓ Saved!");
    }));

    it("save-as shows the name bar and creates a profile on confirm or Enter", () => withPanel(({ dom, pe, click, shown }) => {
      click("btn-save-as-profile");
      assertEqual(shown("profile-bar-new"), "flex", "name bar shown");
      assertEqual(shown("profile-bar-default"), "none");

      const input = dom.el("input-new-profile-name");
      click("btn-confirm-new-profile");
      assertEqual(pe.called("saveProfileToStorage").length, 0, "blank names are ignored");

      input.value = "  Marathon  ";
      click("btn-confirm-new-profile");
      assertEqual(pe.called("saveProfileToStorage")[0].args[0], "Marathon", "name trimmed");
      assertEqual(pe.active, "Marathon", "new profile made active");
      assertEqual(pe.called("syncProfileUI").length, 1);
      assertEqual(shown("profile-bar-default"), "flex", "back to the default bar");

      click("btn-save-as-profile");
      input.value = "Relay";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      assertEqual(pe.active, "Relay", "Enter confirms");

      click("btn-save-as-profile");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
      assertEqual(shown("profile-bar-new"), "none", "Escape cancels");

      click("btn-save-as-profile");
      click("btn-cancel-new-profile");
      assertEqual(shown("profile-bar-default"), "flex", "cancel button returns to default");
    }));

    it("deletes a profile after confirmation", () => withPanel(({ pe, click, shown }) => {
      click("btn-delete-profile");
      assertEqual(shown("profile-bar-delete"), "flex", "confirm bar shown");
      click("btn-cancel-delete-profile");
      assertEqual(shown("profile-bar-default"), "flex", "cancel keeps the profile");
      assertEqual(pe.called("deleteProfileFromStorage").length, 0);

      click("btn-delete-profile");
      click("btn-confirm-delete-profile");
      assertEqual(pe.called("deleteProfileFromStorage")[0].args, ["Speedy"]);
      assertEqual(shown("profile-bar-default"), "flex");
    }));

    it("never offers to delete the Default profile", () => withPanel(({ pe, click, shown }) => {
      click("btn-delete-profile");
      assertEqual(shown("profile-bar-delete"), "none");
      click("btn-confirm-delete-profile");
      assertEqual(pe.called("deleteProfileFromStorage").length, 0);
    }, "Default"));

    it("export modal: opens, closes on the backdrop only, and re-downloads with a safe file name", () => withPanel(({ dom, pe, click }) => {
      click("btn-export-profile");
      assertEqual(pe.called("exportProfileToFile").length, 1);

      dom.el("layout-export-modal").querySelector(".dialog").click();
      assertEqual(pe.called("closeExportModal").length, 0, "clicks inside the dialog keep it open");
      dom.el("layout-export-modal").click();
      click("btn-close-export-modal");
      assertEqual(pe.called("closeExportModal").length, 2, "backdrop and close button close it");

      click("btn-redownload-export-json");
      assertEqual(pe.called("triggerFileDownload").length, 0, "nothing to download while empty");
      dom.el("export-json-textarea").value = '{"name":"Speedy"}';
      pe.active = "My Run: 100%";
      click("btn-redownload-export-json");
      assertEqual(pe.called("triggerFileDownload")[0].args, ["livesplit-layout-my-run-100-.json", '{"name":"Speedy"}']);
      assert(dom.el("export-status-banner").textContent.includes("livesplit-layout-my-run-100-.json"), "banner names the file");
    }));

    it("export modal: copies the JSON with the clipboard API", () => withPanel(async ({ dom, click }) => {
      const copied = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (text) => { copied.push(text); return Promise.resolve(); } }
      });
      try {
        dom.el("export-json-textarea").value = "{}";
        click("btn-copy-export-json");
        await waitFor(() => dom.el("export-status-banner").textContent === "✓ Copied to clipboard!", "copy confirmed");
        assertEqual(copied, ["{}"]);
        assertEqual(dom.el("btn-copy-export-json").innerText, "✓ Copied!");
      } finally {
        delete navigator.clipboard;
      }
    }));

    it("export modal: falls back to execCommand when the clipboard API rejects", () => withPanel(async ({ dom, click }) => {
      const realExec = document.execCommand;
      const commands = [];
      document.execCommand = (cmd) => { commands.push(cmd); return true; };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("denied")) }
      });
      try {
        dom.el("export-json-textarea").value = "{}";
        click("btn-copy-export-json");
        await waitFor(() => commands.length === 1, "legacy copy used");
        assertEqual(commands, ["copy"]);
      } finally {
        delete navigator.clipboard;
        document.execCommand = realExec;
      }
    }));

    it("import modal: applies pasted JSON and reports empty or invalid input", () => withPanel(({ dom, pe, click }) => {
      const err = dom.el("import-error-msg");
      const ta = dom.el("import-json-textarea");

      click("btn-open-import-modal");
      assertEqual(pe.called("openImportModal").length, 1);

      click("btn-apply-import-json");
      assertEqual(err.textContent, "Please paste layout JSON or select a file");
      assertEqual(err.style.display, "block");

      ta.value = "{oops";
      click("btn-apply-import-json");
      assert(err.textContent.startsWith("Import error:"), "parse error shown");

      ta.value = "42";
      click("btn-apply-import-json");
      assert(err.textContent.includes("expected a layout configuration object"), "non-object rejected");
      assertEqual(pe.called("applyProfileData").length, 0);

      ta.value = '{"version":1}';
      click("btn-apply-import-json");
      assertEqual(pe.called("applyProfileData")[0].args, [{ version: 1 }, "Imported Layout"], "unnamed layouts get a default name");
      assertEqual(pe.called("closeImportModal").length, 1, "modal closed after import");

      click("btn-cancel-import");
      click("btn-close-import-modal");
      dom.el("layout-import-modal").click();
      assertEqual(pe.called("closeImportModal").length, 4, "cancel, close and backdrop all close");
    }));

    it("import modal: imports a picked file and shows a failure", () => withPanel(async ({ dom, pe }) => {
      const input = dom.el("input-import-profile");
      const pick = (name) => {
        const dt = new DataTransfer();
        dt.items.add(new File(["{}"], name));
        input.files = dt.files;
        input.dispatchEvent(new Event("change"));
      };

      const realLog = console.log;
      const realError = console.error;
      console.log = () => {};
      console.error = () => {};
      try {
        pick("layout.json");
        await waitFor(() => pe.called("closeImportModal").length === 1, "closed after a successful import");
        assertEqual(pe.called("importProfileFromFile")[0].args[0].name, "layout.json");

        pe.importProfileFromFile = () => Promise.reject(new Error("unsupported version"));
        pick("broken.json");
        await waitFor(() => dom.el("import-error-msg").textContent === "Import error: unsupported version", "error shown");
      } finally {
        console.log = realLog;
        console.error = realError;
      }
    }));
  });
})();
