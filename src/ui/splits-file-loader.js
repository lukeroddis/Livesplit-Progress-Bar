/**
 * src/ui/splits-file-loader.js - .lss / Layout Profile File Loaders
 *
 * Wires the #file-input picker, the #file-trigger dropzone highlight, and
 * window-wide drag-and-drop:
 * - .lss / .xml files are read as text and handed to onSplitsText
 * - .json / .lshud files are imported as layout profiles via window.hudLayout
 */

(function () {
  "use strict";

  /**
   * @param {Object} options
   * @param {Function} options.onSplitsText - Receives the raw XML text of a dropped/picked splits file
   */
  function bindSplitsFileLoaders(options = {}) {
    const { onSplitsText = () => {} } = options;

    const readSplitsFile = (file) => {
      const reader = new FileReader();
      reader.onload = (evt) => onSplitsText(evt.target.result);
      reader.readAsText(file);
    };

    const fileInput = document.getElementById("file-input");
    if (fileInput) {
      fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) readSplitsFile(file);
      });
    }

    const fileDropzone = document.getElementById("file-trigger");
    if (fileDropzone) {
      ["dragenter", "dragover"].forEach((evt) => {
        fileDropzone.addEventListener(evt, (e) => {
          e.preventDefault();
          fileDropzone.classList.add("drag-over");
        });
      });
      ["dragleave", "drop"].forEach((evt) => {
        fileDropzone.addEventListener(evt, () => {
          fileDropzone.classList.remove("drag-over");
        });
      });
    }

    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".lss") || file.name.endsWith(".xml"))) {
        readSplitsFile(file);
      } else if (file && (file.name.endsWith(".json") || file.name.endsWith(".lshud"))) {
        if (window.hudLayout && typeof window.hudLayout.importProfileFromFile === "function") {
          window.hudLayout.importProfileFromFile(file).then((name) => {
            console.log(`Imported layout profile: ${name}`);
          }).catch((err) => {
            console.error("Layout profile import failed:", err);
          });
        }
      }
    });
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SplitsFileLoader = {
    bindSplitsFileLoaders
  };
})();
