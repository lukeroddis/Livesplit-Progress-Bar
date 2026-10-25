/**
 * src/ui/hud-titles.js - Game & Category Titles
 *
 * - HUD game / category labels and the browser tab title
 * - Pulls game and category names from LiveSplit Server
 * - Auto-loads a saved layout profile matching the game
 *
 * Installed onto the shared overlay `app` registry: reads/writes `app.state`
 * and calls other controllers through `app.<fn>` at call time.
 */

(function () {
  "use strict";

  function installHudTitles(app) {
    const { state } = app;

    function setGameName(name) {
      const el = document.getElementById("game-name");
      if (el && name) {
        el.innerText = name;
        updatePageTitle();
        if (window.hudLayout && typeof window.hudLayout.autoLoadProfileForGame === "function") {
          window.hudLayout.autoLoadProfileForGame(name);
        }
      }
    }

    function setCategoryName(cat) {
      const el = document.getElementById("category-name");
      if (el && cat) {
        el.innerText = cat;
        updatePageTitle();
      }
    }

    function updatePageTitle() {
      const game = document.getElementById("game-name")?.innerText?.trim();
      const cat = document.getElementById("category-name")?.innerText?.trim();
      if (game && game !== "Speedrun Overlay") {
        document.title = (cat && cat !== "Load .lss or connect LiveSplit") ? `${game} - ${cat}` : game;
      } else {
        document.title = "LiveSplit Minimal Overlay";
      }
    }

    async function syncLiveSplitMetadata() {
      const game = await app.sendCommand("getgamename");
      const cat = await app.sendCommand("getcategoryname");
      if (game && game.trim() && game !== "-") {
        setGameName(game.trim());
        localStorage.setItem("livesplit_game", game.trim());
      }
      if (cat && cat.trim() && cat !== "-") {
        setCategoryName(cat.trim());
        localStorage.setItem("livesplit_category", cat.trim());
      }
    }

    return Object.assign(app, {
      setGameName,
      setCategoryName,
      updatePageTitle,
      syncLiveSplitMetadata
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.HudTitles = {
    installHudTitles
  };
})();
