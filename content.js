// Injected on demand into the top frame. Renders the answer popup inside a Shadow DOM.
(() => {
  if (window.__askGemini) return;
  window.__askGemini = true;

  const CSS = `
    :host { all: initial; }
    .card {
      /* Fully transparent popup: dark text with a white halo stays readable on any page. */
      --fg: #111111; --muted: #3c4043; --accent: #174ea6; --err: #b3261e;
      --halo: 0 0 2px #fff, 0 0 3px #fff, 0 0 5px #fff;
      position: fixed; z-index: 2147483647;
      width: 380px; max-width: calc(100vw - 16px); max-height: 60vh;
      display: flex; flex-direction: row; align-items: flex-start;
      cursor: move;
      background: transparent; color: var(--fg);
      border: none; box-shadow: none;
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      text-shadow: var(--halo);
      overflow: hidden;
      opacity: 0.4; /* whole popup slightly see-through, text included */
    }
    /* Answer on the left, buttons on the right; both start on the same line. */
    .head { flex: none; display: flex; gap: 2px; padding: 10px 8px 0 0; user-select: none; }
    button {
      all: unset; cursor: pointer; color: var(--muted);
      padding: 0 6px; border-radius: 6px; font-size: 13px; line-height: 20px;
    }
    button:hover { color: var(--fg); }
    .body { flex: 1; min-width: 0; max-height: 60vh; box-sizing: border-box; padding: 10px 4px 10px 12px; overflow-y: auto; line-height: 20px; }
    .opt { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
    .label {
      flex: none; min-width: 22px; text-align: center; font-weight: 700;
      color: var(--accent);
    }
    .answer { font-weight: 600; white-space: pre-wrap; }
    .error { color: var(--err); white-space: pre-wrap; }
    .link { color: var(--accent); text-decoration: underline; padding: 0; margin-top: 8px; display: inline-block; }
    .spinner {
      width: 18px; height: 18px; border-radius: 50%;
      border: 2px solid rgba(0,0,0,.15); border-top-color: var(--accent);
      animation: spin 2.5s linear infinite; opacity: .5; display: inline-block; vertical-align: middle; margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  let host = null;
  let currentRequest = null;
  let closedRequest = null;
  let dragged = false;
  let copyText = "";

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function close() {
    host?.remove();
    host = null;
    closedRequest = currentRequest;
    currentRequest = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onOutside, true);
  }

  // While hidden, Esc and outside clicks are ignored so the answer can be shown again.
  function onKey(e) {
    if (e.key === "Escape" && !host?.hidden) close();
  }

  function onOutside(e) {
    if (host && !host.hidden && !e.composedPath().includes(host)) close();
  }

  // Called by the "toggle-popup" hotkey from background.js.
  window.__askGeminiToggle = () => {
    if (!host) return;
    host.hidden = !host.hidden;
    // Inline !important so page CSS like "div { display: block !important }" can't undo it.
    host.style.setProperty("display", host.hidden ? "none" : "block", "important");
  };

  // Region picker for screenshots: dims the page, lets the user drag a box and resolves with
  // { rect, viewportWidth } in CSS pixels, or null when cancelled. The overlay is gone
  // (and repainted) before it resolves, so it never ends up in the screenshot.
  window.__askGeminiSelectRegion = () =>
    new Promise((resolve) => {
      close();
      const overlay = document.createElement("div");
      overlay.style.cssText =
        "all: initial; position: fixed; inset: 0; z-index: 2147483647; cursor: crosshair; background: rgba(0,0,0,.18);";
      document.documentElement.append(overlay);

      let start = null;
      let rect = null;
      const finish = (result) => {
        overlay.remove();
        document.removeEventListener("keydown", onKeyDown, true);
        // Wait for two frames so the overlay is really gone from the screen.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      };
      overlay.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        overlay.setPointerCapture(e.pointerId);
      });
      overlay.addEventListener("pointermove", (e) => {
        if (!start) return;
        rect = {
          left: Math.min(start.x, e.clientX),
          top: Math.min(start.y, e.clientY),
          right: Math.max(start.x, e.clientX),
          bottom: Math.max(start.y, e.clientY),
        };
      });
      overlay.addEventListener("pointerup", () => {
        const big = rect && rect.right - rect.left > 8 && rect.bottom - rect.top > 8;
        finish(big ? { rect, viewportWidth: window.innerWidth } : null);
      });
      document.addEventListener("keydown", onKeyDown, true);
    });

  function build(rect) {
    close();
    dragged = false;
    host = document.createElement("div");
    host.id = "ask-gemini-root";
    const shadow = host.attachShadow({ mode: "open" });
    const style = el("style");
    style.textContent = CSS;
    const card = el("div", "card");

    const head = el("div", "head");
    const copyBtn = el("button", null, "Copy");
    copyBtn.title = "Copy answer";
    copyBtn.hidden = true;
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(copyText);
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
      } catch {
        copyBtn.textContent = "Failed";
      }
    });
    const closeBtn = el("button", null, "✕");
    closeBtn.title = "Close (Esc)";
    closeBtn.addEventListener("click", close);
    head.append(copyBtn, closeBtn);

    const body = el("div", "body");
    card.append(body, head);
    shadow.append(style, card);
    document.documentElement.append(host);

    position(card, rect);
    makeDraggable(card, card);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onOutside, true);

    return { card, body, copyBtn };
  }

  function position(card, rect) {
    const margin = 8;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top, left;
    if (rect) {
      left = rect.left;
      top = rect.bottom + margin;
      // Not enough room below: place above the selection instead.
      if (top + Math.max(h, 160) > vh && rect.top - margin - h > 0) top = rect.top - margin - h;
    } else {
      left = vw - w - 16;
      top = 16;
    }
    card.style.left = `${Math.max(margin, Math.min(left, vw - w - margin))}px`;
    card.style.top = `${Math.max(margin, Math.min(top, vh - Math.min(h, 120) - margin))}px`;
  }

  function makeDraggable(card, handle) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const startX = e.clientX - card.offsetLeft;
      const startY = e.clientY - card.offsetTop;
      dragged = true;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        card.style.left = `${ev.clientX - startX}px`;
        card.style.top = `${ev.clientY - startY}px`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // Loading shows only a small, slow spinner; status text goes to the tooltip.
  function renderLoading(ui, message) {
    ui.card.title = message || "Asking Gemini…";
    ui.body.replaceChildren(el("span", "spinner"));
  }

  function renderError(ui, message, needsSettings) {
    ui.card.title = "";
    const msg = el("div", "error", message);
    ui.body.replaceChildren(msg);
    if (needsSettings) {
      const link = el("button", "link", "Open settings");
      link.addEventListener("click", () => chrome.runtime.sendMessage({ action: "openOptions" }));
      ui.body.append(link);
    }
  }

  function renderAnswer(ui, data) {
    ui.card.title = data.model ? `Answered by ${data.model}` : "";
    const isMC = data.type === "multiple_choice" && data.correct_options.length > 0;
    ui.copyBtn.hidden = false;

    const nodes = [];
    if (isMC) {
      for (const opt of data.correct_options) {
        const row = el("div", "opt");
        row.append(el("span", "label", opt.label), el("span", "answer", opt.text));
        nodes.push(row);
      }
      copyText = data.correct_options.map((o) => `${o.label}: ${o.text}`).join("\n");
    } else {
      nodes.push(el("div", "answer", data.answer));
      copyText = data.answer;
    }
    ui.body.replaceChildren(...nodes);
  }

  let ui = null;

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg?.requestId || msg.requestId === closedRequest) return;
    // A new request replaces the popup; stale answers from older requests are ignored.
    if (msg.requestId !== currentRequest) {
      if (msg.state !== "loading" && msg.state !== "error") return;
      ui = build(msg.rect);
      currentRequest = msg.requestId;
    }
    if (!host) return;
    if (msg.state === "loading") renderLoading(ui, msg.message);
    else if (msg.state === "error") renderError(ui, msg.message, msg.needsSettings);
    else if (msg.state === "answer") renderAnswer(ui, msg.data);
    // Content size changed; keep the card inside the viewport.
    if (!dragged) position(ui.card, msg.rect);
  });
})();
