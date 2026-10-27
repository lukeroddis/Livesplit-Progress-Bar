/**
 * tests/unit/ui/splits-file-loader.test.js
 * LiveSplit.SplitsFileLoader: file picker, dropzone highlight and window drag-and-drop routing.
 * Window listeners are captured (TestUtils.captureWindowListeners) so the app's own drop
 * handler, bound at startup, never parses the test files.
 */

(function () {
  "use strict";

  const { mountHtml, captureWindowListeners, waitFor } = window.TestUtils;

  function bind(onSplitsText) {
    return captureWindowListeners(() => window.LiveSplit.SplitsFileLoader.bindSplitsFileLoaders({ onSplitsText }));
  }

  function dropEvent(file) {
    let prevented = false;
    return {
      event: { preventDefault: () => { prevented = true; }, dataTransfer: { files: file ? [file] : [] } },
      wasPrevented: () => prevented
    };
  }

  describe("Splits File Loader (LiveSplit.SplitsFileLoader)", () => {
    it("reads a dropped .lss file as text and hands it to onSplitsText", async () => {
      const received = [];
      const win = bind((text) => received.push(text));
      const drop = dropEvent(new File(["<Run>lss</Run>"], "run.lss"));
      win.fire("drop", drop.event);
      await waitFor(() => received.length === 1, "splits text received");
      assertEqual(received[0], "<Run>lss</Run>");
      assert(drop.wasPrevented(), "browser navigation to the file is prevented");
    });

    it("also accepts .xml splits files", async () => {
      const received = [];
      bind((text) => received.push(text)).fire("drop", dropEvent(new File(["<x/>"], "splits.xml")).event);
      await waitFor(() => received.length === 1, ".xml read");
    });

    it("routes .json / .lshud drops to the layout profile importer", async () => {
      const realLayout = window.hudLayout;
      const imported = [];
      window.hudLayout = { importProfileFromFile: (f) => { imported.push(f.name); return Promise.resolve(f.name); } };
      try {
        const win = bind(() => { throw new Error("profiles must not reach onSplitsText"); });
        win.fire("drop", dropEvent(new File(["{}"], "layout.json")).event);
        win.fire("drop", dropEvent(new File(["{}"], "layout.lshud")).event);
        assertEqual(imported, ["layout.json", "layout.lshud"]);
      } finally {
        window.hudLayout = realLayout;
      }
    });

    it("logs a failed profile import instead of throwing", async () => {
      const realLayout = window.hudLayout;
      const realError = console.error;
      const errors = [];
      console.error = (...args) => errors.push(args.join(" "));
      window.hudLayout = { importProfileFromFile: () => Promise.reject(new Error("bad file")) };
      try {
        bind(() => {}).fire("drop", dropEvent(new File(["{"], "broken.json")).event);
        await waitFor(() => errors.length === 1, "import error logged");
        assert(errors[0].includes("bad file"), "error message logged");
      } finally {
        window.hudLayout = realLayout;
        console.error = realError;
      }
    });

    it("ignores other file types and empty drops", () => {
      const win = bind(() => { throw new Error("unexpected read"); });
      win.fire("drop", dropEvent(new File(["x"], "image.png")).event);
      win.fire("drop", dropEvent(null).event);
      let prevented = false;
      win.fire("dragover", { preventDefault: () => { prevented = true; } });
      assert(prevented, "window dragover is prevented so drops are allowed");
    });

    it("reads a file chosen with the #file-input picker", async () => {
      const dom = mountHtml('<input type="file" id="file-input">');
      try {
        const received = [];
        bind((text) => received.push(text));
        const dt = new DataTransfer();
        dt.items.add(new File(["<Run>picked</Run>"], "picked.lss"));
        const input = dom.el("file-input");
        input.files = dt.files;
        input.dispatchEvent(new Event("change"));
        await waitFor(() => received.length === 1, "picked file read");
        assertEqual(received[0], "<Run>picked</Run>");
      } finally {
        dom.remove();
      }
    });

    it("highlights the #file-trigger dropzone while a file is dragged over it", () => {
      const dom = mountHtml('<div id="file-trigger"></div>');
      try {
        bind(() => {});
        const zone = dom.el("file-trigger");
        zone.dispatchEvent(new Event("dragenter", { cancelable: true }));
        assert(zone.classList.contains("drag-over"), "highlighted on dragenter");
        zone.dispatchEvent(new Event("dragleave"));
        assert(!zone.classList.contains("drag-over"), "cleared on dragleave");
        zone.dispatchEvent(new Event("dragover", { cancelable: true }));
        zone.dispatchEvent(new Event("drop"));
        assert(!zone.classList.contains("drag-over"), "cleared on drop");
      } finally {
        dom.remove();
      }
    });
  });
})();
