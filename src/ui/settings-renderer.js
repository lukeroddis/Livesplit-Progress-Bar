/**
 * src/ui/settings-renderer.js - Settings Registry Controls (shared by the dock and the overlay)
 *
 * Builds the controls for settings described by the registry's schema
 * (SettingsRegistry.describeSettings), so the OBS dock and the overlay's settings
 * dialogs render a setting the same way:
 * - bool: On / Off button; enum: segmented buttons (a few short options) or a
 *   dropdown; splits: - / number / + / Auto / All; ghosts: multi-select buttons;
 *   range: slider (rate-limited while dragging); action: one button per option
 * - The mouse wheel steps a slider, or runs a back / forward action
 * - A schema entry's `showIf` { setting, equals } hides its row while that setting differs
 *
 * The host supplies what a change does (`set`, `run`) and the current values
 * (`update`), so it works over the dock's commands or the overlay's app.settings.
 * Plain DOM only: dock.html loads it as is, and the build inlines it into
 * dist/dock.html. Class names are prefixed `sr-` for each page to style.
 */

(function () {
  "use strict";

  const SLIDER_SEND_MS = 60;
  const WHEEL_STEP_PX = 100;
  const SHORT_LABEL = 10;

  const optionLabel = (def, value) => (def.optionLabels && def.optionLabels[String(value)]) || String(value);

  function el(tag, props, children) {
    const node = Object.assign(document.createElement(tag), props || {});
    (children || []).forEach((c) => node.appendChild(c));
    return node;
  }

  /**
   * @param {Object} options
   * @param {Function} options.set - (id, value) change a setting
   * @param {Function} [options.run] - (id, value) run an action setting
   * @param {Function} [options.getValue] - (id) the current value (ghost buttons toggle one id in the list)
   */
  function createSettingsRenderer({ set, run = () => {}, getValue = () => undefined } = {}) {
    const updaters = [];

    // One control per type; each returns its element and registers an updater(values)
    const CONTROLS = {
      bool(def) {
        const btn = el("button", { type: "button", className: "sr-toggle", onclick: () => set(def.id, !btn.classList.contains("sr-on")) });
        updaters.push((values) => {
          const on = values[def.id] === true;
          btn.classList.toggle("sr-on", on);
          btn.textContent = on ? "On" : "Off";
        });
        return el("div", { className: "sr-control" }, [btn]);
      },
      enum(def, options) {
        // A few short options as buttons; more, or long names (profiles), as a dropdown
        const short = options.every((opt) => optionLabel(def, opt).length <= SHORT_LABEL);
        if (options.length <= 3 && short) {
          const btns = options.map((opt) => el("button", { type: "button", textContent: optionLabel(def, opt), onclick: () => set(def.id, opt) }));
          updaters.push((values) => btns.forEach((b, i) => b.classList.toggle("sr-on", values[def.id] === options[i])));
          return el("div", { className: "sr-control sr-seg" }, btns);
        }
        const select = el("select", { className: "sr-select", onchange: () => set(def.id, select.value) },
          options.map((opt) => el("option", { value: opt, textContent: optionLabel(def, opt) })));
        updaters.push((values) => { if (document.activeElement !== select) select.value = values[def.id]; });
        return el("div", { className: "sr-control" }, [select]);
      },
      ghosts(def, options) {
        const btns = options.map((opt) => el("button", {
          type: "button", textContent: optionLabel(def, opt), title: opt,
          onclick: () => {
            const current = (getValue(def.id) || []).slice();
            const at = current.indexOf(opt);
            if (at === -1) current.push(opt); else current.splice(at, 1);
            set(def.id, current);
          }
        }));
        updaters.push((values) => btns.forEach((b, i) => b.classList.toggle("sr-on", (values[def.id] || []).includes(options[i]))));
        return el("div", { className: "sr-control sr-wrap" }, btns);
      },
      splits(def) {
        const num = el("input", { type: "number", className: "sr-num", min: def.min, max: def.max });
        const step = (d) => set(def.id, Math.max(def.min, Math.min(def.max, (parseInt(num.value, 10) || 8) + d)));
        num.addEventListener("change", () => set(def.id, num.value));
        const auto = el("button", { type: "button", textContent: "Auto", onclick: () => set(def.id, "auto") });
        const all = el("button", { type: "button", textContent: "All", onclick: () => set(def.id, "all") });
        updaters.push((values) => {
          const v = values[def.id];
          auto.classList.toggle("sr-on", v === "auto");
          all.classList.toggle("sr-on", v === "all");
          if (document.activeElement !== num) num.value = /^\d+$/.test(v) ? v : "";
          num.placeholder = v === "all" ? "all" : "auto";
        });
        return el("div", { className: "sr-control" }, [
          el("button", { type: "button", textContent: "−", onclick: () => step(-1) }), num,
          el("button", { type: "button", textContent: "+", onclick: () => step(1) }), auto, all
        ]);
      },
      // A slider; dragging or the mouse wheel sends at most one change per SLIDER_SEND_MS
      range(def, options) {
        const max = options.length > 0 ? options[options.length - 1] : 0;
        const slider = el("input", { type: "range", className: "sr-slider", min: options[0] || 0, max, step: 1 });
        const label = el("span", { className: "sr-slider-val" });
        let dragging = false;
        let lastSent = 0;
        let timer = null;
        const showValue = () => { label.textContent = slider.value + " / " + max; };
        const sendSoon = () => {
          showValue();
          clearTimeout(timer);
          const wait = SLIDER_SEND_MS - (Date.now() - lastSent);
          const sendNow = () => { lastSent = Date.now(); set(def.id, Number(slider.value)); };
          if (wait <= 0) sendNow(); else timer = setTimeout(sendNow, wait);
        };
        slider.addEventListener("pointerdown", () => { dragging = true; });
        // A range input captures the pointer, so its own pointerup / change end the drag
        ["pointerup", "pointercancel", "change"].forEach((type) => slider.addEventListener(type, () => { dragging = false; }));
        slider.addEventListener("input", sendSoon);
        slider.wheelStep = (steps) => {
          slider.value = String(Number(slider.value) + steps);
          sendSoon();
        };
        updaters.push((values) => {
          if (dragging || Date.now() - lastSent < 500) return;
          slider.value = values[def.id];
          showValue();
        });
        return el("div", { className: "sr-control" }, [slider, label]);
      },
      action(def, options) {
        return el("div", { className: "sr-control sr-seg" }, options.map((opt) => el("button", {
          type: "button", textContent: optionLabel(def, opt), onclick: () => run(def.id, opt)
        })));
      }
    };

    // Mouse wheel over a slider steps it; over a back / forward action row it runs the action
    function bindWheel(row, def, options) {
      const slider = row.querySelector(".sr-slider");
      const canStep = slider || (def.type === "action" && options.includes(-1) && options.includes(1));
      if (!canStep) return;
      // At least one step per mouse wheel notch (its size varies with OS / display scaling);
      // trackpads' small deltas add up, one step per WHEEL_STEP_PX
      let pending = 0;
      row.addEventListener("wheel", (e) => {
        let delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (delta === 0 || (slider && slider.disabled)) return;
        e.preventDefault();
        if (e.deltaMode === 1) delta *= WHEEL_STEP_PX / 3; // lines: 3 per notch
        let steps;
        if (Math.abs(delta) >= WHEEL_STEP_PX / 2) {
          steps = Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / WHEEL_STEP_PX));
          pending = 0;
        } else {
          pending += delta;
          steps = Math.trunc(pending / WHEEL_STEP_PX);
          pending -= steps * WHEEL_STEP_PX;
        }
        if (steps === 0) return;
        if (slider) {
          slider.wheelStep(steps);
        } else {
          for (let i = 0; i < Math.abs(steps); i++) run(def.id, Math.sign(steps));
        }
      }, { passive: false });
    }

    /** A labelled row for a setting (null for an unknown type). */
    function row(def, options) {
      const make = CONTROLS[def.type];
      if (!make) return null;
      const node = el("div", { className: "sr-row" }, [el("label", { className: "sr-label", textContent: def.label }), make(def, options || [])]);
      node.dataset.setting = def.id;
      if (def.showIf) updaters.push((values) => { node.hidden = values[def.showIf.setting] !== def.showIf.equals; });
      bindWheel(node, def, options || []);
      return node;
    }

    return {
      row,
      /** Shows the current values on every control built so far. */
      update: (values) => updaters.forEach((fn) => fn(values || {})),
      /** Forgets the controls built so far (before rebuilding them). */
      reset: () => { updaters.length = 0; }
    };
  }

  window.LiveSplit = window.LiveSplit || {};
  window.LiveSplit.SettingsRenderer = {
    optionLabel,
    createSettingsRenderer
  };
})();
