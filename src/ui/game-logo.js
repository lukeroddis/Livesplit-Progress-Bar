/**
 * LiveSplit Progress Bar - Custom Game Logo Controller
 * 
 * Encapsulates:
 * - Logo image persistence in localStorage under livesplit_custom_logo
 * - HUD Title component branding injection & .has-logo styling toggle
 * - Dynamic logo height CSS variable (--game-logo-height) and range slider sync
 * - Interactive image file reader (FileReader base64 data URL)
 * - Track settings modal logo preview and removal controls
 */

(function () {
  "use strict";

  const STORAGE_KEYS = window.LiveSplit.Storage.KEYS;

  const DEFAULT_LOGO_STORAGE_KEY = STORAGE_KEYS.CUSTOM_LOGO;

  function createGameLogo(options = {}) {
    const storageKey = options.storageKey || DEFAULT_LOGO_STORAGE_KEY;
    const getLogoHeight = typeof options.getLogoHeight === "function" ? options.getLogoHeight : (() => 60);
    const onLogoChange = typeof options.onLogoChange === "function" ? options.onLogoChange : null;

    function getSavedLogo() {
      try {
        return localStorage.getItem(storageKey);
      } catch (e) {
        console.warn("Failed to get logo from storage", e);
        return null;
      }
    }

    function applyGameLogo(src, height) {
      const titleComp = document.getElementById("hud-comp-title");
      const logoImg = document.getElementById("game-logo");
      const previewWrap = document.getElementById("game-logo-preview-wrap");
      const previewImg = document.getElementById("game-logo-preview");
      const removeBtn = document.getElementById("btn-remove-game-logo");
      const rowHeight = document.getElementById("row-logo-height");
      const sLogoHeight = document.getElementById("slider-logo-height");
      const vLogoHeight = document.getElementById("val-logo-height");

      const effectiveHeight = height || getLogoHeight() || 60;
      if (typeof document !== "undefined" && document.documentElement) {
        document.documentElement.style.setProperty("--game-logo-height", `${effectiveHeight}px`);
      }

      if (src && typeof src === "string" && src.trim()) {
        if (logoImg) {
          logoImg.src = src;
          logoImg.style.display = "block";
        }
        if (titleComp) {
          titleComp.classList.add("has-logo");
        }
        if (previewImg) previewImg.src = src;
        if (previewWrap) previewWrap.style.display = "flex";
        if (removeBtn) removeBtn.style.display = "inline-flex";
        if (rowHeight) rowHeight.style.display = "flex";
      } else {
        if (logoImg) {
          logoImg.src = "";
          logoImg.style.display = "none";
        }
        if (titleComp) {
          titleComp.classList.remove("has-logo");
        }
        if (previewImg) previewImg.src = "";
        if (previewWrap) previewWrap.style.display = "none";
        if (removeBtn) removeBtn.style.display = "none";
        if (rowHeight) rowHeight.style.display = "none";
      }

      if (sLogoHeight) sLogoHeight.value = effectiveHeight;
      if (vLogoHeight) vLogoHeight.innerText = `${effectiveHeight}px`;

      return effectiveHeight;
    }

    function removeGameLogo() {
      try {
        localStorage.removeItem(storageKey);
      } catch (e) {
        console.warn("Failed to clear logo from localStorage", e);
      }
      const fileInput = document.getElementById("input-game-logo");
      if (fileInput) fileInput.value = "";
      applyGameLogo(null);
      if (onLogoChange) onLogoChange(null);
    }

    function saveGameLogo(src) {
      try {
        if (src) {
          localStorage.setItem(storageKey, src);
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch (e) {
        console.warn("Failed to save logo to localStorage", e);
      }
      applyGameLogo(src);
      if (onLogoChange) onLogoChange(src);
    }

    function syncModalUI(height) {
      const savedLogo = getSavedLogo();
      const effLogoH = height || getLogoHeight() || 60;
      const sLogoH = document.getElementById("slider-logo-height");
      const vLogoH = document.getElementById("val-logo-height");
      if (sLogoH) sLogoH.value = effLogoH;
      if (vLogoH) vLogoH.innerText = `${effLogoH}px`;
      const previewWrap = document.getElementById("game-logo-preview-wrap");
      const previewImg = document.getElementById("game-logo-preview");
      const removeLogoBtn = document.getElementById("btn-remove-game-logo");
      const rowLogoH = document.getElementById("row-logo-height");

      if (savedLogo) {
        if (previewImg) previewImg.src = savedLogo;
        if (previewWrap) previewWrap.style.display = "flex";
        if (removeLogoBtn) removeLogoBtn.style.display = "inline-flex";
        if (rowLogoH) rowLogoH.style.display = "flex";
      } else {
        if (previewImg) previewImg.src = "";
        if (previewWrap) previewWrap.style.display = "none";
        if (removeLogoBtn) removeLogoBtn.style.display = "none";
        if (rowLogoH) rowLogoH.style.display = "none";
      }
    }

    function handleFileInput(file) {
      return new Promise((resolve, reject) => {
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = (loadEvt) => {
          const result = loadEvt.target.result;
          saveGameLogo(result);
          resolve(result);
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
      });
    }

    function bindEvents() {
      const inputGameLogo = document.getElementById("input-game-logo");
      if (inputGameLogo) {
        inputGameLogo.addEventListener("change", (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) {
            handleFileInput(file).catch((err) => {
              console.warn("Failed to process game logo image file", err);
            });
          }
        });
      }

      const btnRemoveGameLogo = document.getElementById("btn-remove-game-logo");
      if (btnRemoveGameLogo) {
        btnRemoveGameLogo.addEventListener("click", () => {
          removeGameLogo();
        });
      }
    }

    return {
      STORAGE_KEY: storageKey,
      getSavedLogo,
      applyGameLogo,
      saveGameLogo,
      removeGameLogo,
      syncModalUI,
      handleFileInput,
      bindEvents
    };
  }

  // Global namespace export
  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.GameLogo = {
    DEFAULT_LOGO_STORAGE_KEY,
    createGameLogo
  };
})();
