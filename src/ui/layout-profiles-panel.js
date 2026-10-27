/**
 * src/ui/layout-profiles-panel.js - Layout Profiles Bar & Export / Import Modals
 *
 * Binds the settings menu profile controls to the LiveSplit.LayoutProfiles engine:
 * - Profile dropdown, save, save-as (inline name bar), delete (inline confirm bar)
 * - Export modal: copy JSON to clipboard, re-download as .json
 * - Import modal: paste JSON or pick a .json / .lshud file
 */

(function () {
  "use strict";

  function copyTextareaToClipboard(textarea, onSuccess) {
    textarea.select();
    const legacyCopy = () => {
      try { document.execCommand("copy"); onSuccess(); } catch (_) {}
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(textarea.value).then(onSuccess).catch(legacyCopy);
    } else {
      legacyCopy();
    }
  }

  function showImportError(message) {
    const err = document.getElementById("import-error-msg");
    if (err) {
      err.textContent = message;
      err.style.display = "block";
    }
  }

  // Clicking the dimmed backdrop (not the dialog) closes a modal
  function bindBackdropClose(modalId, close) {
    document.getElementById(modalId)?.addEventListener("click", (e) => {
      if (e.target.id === modalId) close();
    });
  }

  function bindProfileBar(pe) {
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

    document.getElementById("select-layout-profile")?.addEventListener("change", (e) => {
      pe.loadProfileByName(e.target.value);
    });

    const btnSaveProfile = document.getElementById("btn-save-profile");
    if (btnSaveProfile) {
      btnSaveProfile.addEventListener("click", () => {
        const active = pe.getActiveProfileName();
        pe.saveProfileToStorage(active, pe.createProfileExport(active));
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

    document.getElementById("btn-save-as-profile")?.addEventListener("click", () => {
      showProfileBar("new");
      if (inputNew) {
        inputNew.value = "";
        setTimeout(() => inputNew.focus(), 50);
      }
    });

    const handleCreateProfile = () => {
      if (!inputNew) return;
      const name = inputNew.value.trim();
      if (name) {
        pe.saveProfileToStorage(name, pe.createProfileExport(name));
        pe.setActiveProfileName(name);
        pe.syncProfileUI();
        showProfileBar("default");
      }
    };

    document.getElementById("btn-confirm-new-profile")?.addEventListener("click", handleCreateProfile);
    document.getElementById("btn-cancel-new-profile")?.addEventListener("click", () => showProfileBar("default"));

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

    // The Default profile can never be deleted
    document.getElementById("btn-delete-profile")?.addEventListener("click", () => {
      const active = pe.getActiveProfileName();
      if (active && active !== "Default") {
        showProfileBar("delete");
      }
    });

    document.getElementById("btn-confirm-delete-profile")?.addEventListener("click", () => {
      const active = pe.getActiveProfileName();
      if (active && active !== "Default") {
        pe.deleteProfileFromStorage(active);
      }
      showProfileBar("default");
    });

    document.getElementById("btn-cancel-delete-profile")?.addEventListener("click", () => showProfileBar("default"));
  }

  function bindExportModal(pe) {
    document.getElementById("btn-export-profile")?.addEventListener("click", () => pe.exportProfileToFile());
    document.getElementById("btn-close-export-modal")?.addEventListener("click", pe.closeExportModal);
    bindBackdropClose("layout-export-modal", pe.closeExportModal);

    const btnCopyExportJson = document.getElementById("btn-copy-export-json");
    if (btnCopyExportJson) {
      btnCopyExportJson.addEventListener("click", () => {
        const ta = document.getElementById("export-json-textarea");
        const banner = document.getElementById("export-status-banner");
        if (!ta) return;
        copyTextareaToClipboard(ta, () => {
          btnCopyExportJson.innerText = "✓ Copied!";
          if (banner) banner.textContent = "✓ Copied to clipboard!";
          setTimeout(() => { btnCopyExportJson.innerText = "📋 Copy JSON"; }, 1500);
        });
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
  }

  function bindImportModal(pe) {
    document.getElementById("btn-open-import-modal")?.addEventListener("click", pe.openImportModal);
    document.getElementById("btn-close-import-modal")?.addEventListener("click", pe.closeImportModal);
    document.getElementById("btn-cancel-import")?.addEventListener("click", pe.closeImportModal);
    bindBackdropClose("layout-import-modal", pe.closeImportModal);

    document.getElementById("btn-apply-import-json")?.addEventListener("click", () => {
      const ta = document.getElementById("import-json-textarea");
      if (!ta || !ta.value.trim()) {
        showImportError("Please paste layout JSON or select a file");
        return;
      }
      try {
        const parsed = JSON.parse(ta.value.trim());
        if (!parsed || typeof parsed !== "object") {
          throw new Error("Invalid JSON: expected a layout configuration object");
        }
        pe.applyProfileData(parsed, parsed.name || "Imported Layout");
        pe.closeImportModal();
      } catch (e) {
        showImportError(`Import error: ${e.message}`);
      }
    });

    document.getElementById("input-import-profile")?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      pe.importProfileFromFile(file).then((profName) => {
        console.log(`Successfully imported layout profile: ${profName}`);
        pe.closeImportModal();
      }).catch((err) => {
        console.error("Failed to import layout profile:", err);
        showImportError(`Import error: ${err.message}`);
      });
      e.target.value = "";
    });
  }

  /**
   * @param {Object} pe - LiveSplit.LayoutProfiles engine instance
   */
  function bindLayoutProfilesPanel(pe) {
    if (!pe) return;
    bindProfileBar(pe);
    bindExportModal(pe);
    bindImportModal(pe);
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.LayoutProfilesPanel = {
    bindLayoutProfilesPanel
  };
})();
