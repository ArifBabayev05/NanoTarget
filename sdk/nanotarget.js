/**
 * NanoTarget browser SDK (v4: pointer trajectories, seal-on-attach). Include in <head>, before app code:
 *
 *   <script src="/sdk/nanotarget.js" data-endpoint="/api/v1/signals" data-zone="[data-nt-zone]"></script>
 *
 * Collects ONLY interaction metadata and known page artifacts:
 *   - navigator.webdriver, known agent DOM markers, model-context globals,
 *     browser-use clipboard bridge globals, time of first interaction
 *   - pointer path length / move count / hold duration / isTrusted per click
 *   - key-interval statistics (never key identities or text), paste flag
 *   - multi-tab focus-emulation conflict probe (BroadcastChannel, opt-in)
 *   - WebMCP tool invocations, if the page registers a tool through the SDK
 *
 * Everything sent is untrusted by design; the server treats missing or
 * malformed telemetry as "unknown", never as human.
 */
(() => {
  const script = document.currentScript;
  // Integration package serves the SDK at <base>/sdk.js and its API next to it; the lab uses /api/v1/*.
  const scriptSrc = (script && script.src) || '';
  const endpoint = (script && script.dataset.endpoint) || (/\/sdk\.js(\?|$)/.test(scriptSrc) ? scriptSrc.replace(/\/sdk\.js(\?.*)?$/, '/signals') : '/api/v1/signals');
  const zoneSelector = (script && script.dataset.zone) || null;
  const focusProbe = !script || script.dataset.focusProbe !== 'off';
  const now = () => Math.round(performance.now());
  // Session id embedded in this page instance by the server (see <meta name="nt-session">).
  const sessionMeta = document.querySelector('meta[name="nt-session"]');
  const sessionId = (sessionMeta && sessionMeta.content) || null;
  const sessionHeaders = () => (sessionId ? { 'X-NT-Session': sessionId } : {});

  // ----------------------------------------------------------------- seal
  // Data already on screen when an agent attaches is the gap the server cannot close: the agent reads the
  // DOM, not the API. So the moment an attach indicator appears *in the browser* — a control marker, a
  // tool-injected global, an evaluated script reading the page, or the server saying "attached" — every
  // element marked data-nt-sensitive="full" is redacted in place, synchronously, and the page is told to
  // re-fetch (the server will now answer with the masked/blocked variant). A verified human reclaim
  // (unseal) suspends this for the reclaim window.
  const sealEnabled = !script || script.dataset.seal !== 'off';
  const SEAL_SELECTOR = '[data-nt-sensitive="full"]';
  let sealed = false;
  let sealSuspendedUntil = 0;
  let sealReason = null;
  function redact(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) { if (n.nodeValue && n.nodeValue.trim()) n.nodeValue = '••••'; }
    for (const i of el.querySelectorAll('input, textarea')) { try { i.value = ''; } catch { /* ignore */ } }
    el.setAttribute('data-nt-sensitive', 'sealed');
  }
  function seal(reason) {
    if (!sealEnabled || Date.now() < sealSuspendedUntil) return false;
    let n = 0;
    try { for (const el of document.querySelectorAll(SEAL_SELECTOR)) { redact(el); n++; } } catch { /* ignore */ }
    const first = !sealed;
    sealed = true; sealReason = sealReason || reason;
    if (first) { early.reading.seal = { atMs: now(), reason, redacted: n }; queueMicrotask(() => { if (typeof flush === 'function') flush().catch(() => {}); }); }
    else if (n && early.reading.seal) early.reading.seal.redacted += n;
    if (first || n) { try { document.dispatchEvent(new CustomEvent('nt:sealed', { detail: { reason, redacted: n, first } })); } catch { /* ignore */ } }
    return true;
  }
  /**
   * After a verified human reclaim: stop sealing so the person can see their own data again. Requires the
   * `reclaim` object from the server's WebAuthn assert response (`{ until }`); a bare call is ignored, so a
   * page button — or an agent clicking it — cannot unseal.
   */
  function unseal(proof) {
    const until = proof && typeof proof === 'object' && typeof proof.until === 'number' ? proof.until : null;
    if (until === null) { try { console.warn('NanoTarget.unseal ignored: pass the reclaim proof returned by /webauthn/assert'); } catch { /* ignore */ } return false; }
    sealSuspendedUntil = Math.min(until, Date.now() + 10 * 60 * 1000); sealed = false; sealReason = null; return true;
  }
  // Names that only agent tooling injects (see server/signals.ts TOOL_INJECTED_GLOBALS); model-context
  // globals of an agent *app* are environment, not control, and do not seal.
  const CONTROL_GLOBAL = /^__(claudeElementMap|claudeElementReverseMap|claudeRefCounter|generateAccessibilityTree|browserUseClipboard|codexPlaywrightInjected)/;
  const CONTROL_MARKER = new Set(['claude-stop', 'claude-cursor', 'claude-glow', 'codex-overlay']);

  // ---------------------------------------------------------------- early
  const PROBES = [
    ['codex-overlay', '#codex-agent-overlay-root'],
    ['codex-badge', 'link[data-codex-favicon-badge]'],
    ['claude-stop', '#claude-agent-stop-container'],
    ['claude-cursor', '#claude-phantom-cursor'],
    ['claude-glow', '#claude-agent-glow-border'],
    ['claude-styles', '#claude-agent-animation-styles'],
  ];
  // Web-accessible resources declared for <all_urls> by known agent extensions (Chrome only).
  // Loading one proves the extension is installed in this profile, not that it is driving the page.
  const EXTENSION_PROBES = [
    ['codex-chrome', 'chrome-extension://hehggadaopoacecdllhhajmbjkdcmajg/images/cursor-chat.png'],
    ['claude-chrome', 'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/assets/agent-visual-indicator.js-CwioqiOd.js'],
    ['claude-chrome', 'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/assets/accessibility-tree.js-B-oUarrX.js'],
    ['claude-chrome', 'chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn/assets/accessibility-tree.js-D39zjmMD.js'],
  ];
  const GLOBAL_PREFIX = /^__(codex|claude|browserUse|anthropic|openai|generateAccessibilityTree)/;
  const early = {
    startedMs: now(),
    observedMs: now(),
    webdriver: navigator.webdriver === true,
    firstInteractionMs: null,
    dataDomMs: null,
    markers: [],
    environment: { codexModelContext: false, modelContextApi: false, clipboardBridge: false, clipboardBridgeAtMs: null, agentGlobals: [], extensionsInstalled: [], focusWhileHiddenMs: null },
    focusConflict: { count: 0, firstAtMs: null, peers: 0 },
    webmcpInvocations: 0,
    // Reading-time signals: what an agent does BEFORE its first click is look at the page.
    reading: {
      loadedHidden: document.visibilityState === 'hidden',
      // burst of DOM text/geometry reads from an evaluated (anonymous) script, not from a script URL
      readBursts: 0, firstReadBurstMs: null, lastReadBurstReads: 0, readBurstAnonymous: false,
      // innerText/textContent of the whole document (body/main/html) read from an evaluated script: text extraction
      textExtracts: 0, firstTextExtractMs: null,
      // document flips visible→hidden within a few ms, with a resize to a capture size: screenshot
      visibilityFlickers: 0, firstFlickerMs: null, flickerResize: null,
      // requestAnimationFrame keeps firing while the document is hidden: rendered without being shown
      renderWhileHiddenMs: null,
      // the very first click, so the server can judge it without waiting for a behavioral window
      firstClick: null,
      // when on-screen data was redacted because an agent indicator appeared (see seal())
      seal: null,
    },
    /**
     * Reading from *outside* the page's JavaScript world. An extension's content script (the ChatGPT or
     * Claude side panel, a browser assistant) has its own copy of the DOM prototypes, so the getters above
     * never fire for it. Two things it cannot hide, both standard APIs:
     *   panel   — opening a side panel takes width from the viewport: innerWidth shrinks while outerWidth,
     *             devicePixelRatio and the screen stay the same. A window resize or a zoom changes those too.
     *   scans   — a content script runs on the page's own main thread, so extracting the text or the
     *             accessibility tree of a document shows up as a long task in this page's timeline. A person
     *             reading the screen produces none: no input, no task.
     * Neither is proof on its own; together, while the page sits idle, they are an attach indicator.
     */
    surface: { panelOpenedMs: null, panelWidthPx: 0, panelClosedMs: null, panelAtLoad: false, scans: 0, firstScanMs: null, longestScanMs: 0, scanAfterPanelMs: null },
  };

  // --- reading-time probes (installed before any other script runs) ---------------------------
  (() => {
    const R = early.reading;
    // 1. DOM read burst. Extension content scripts live in isolated worlds with their own prototypes and
    //    never hit these getters; the page's own scripts show a script URL in the stack. A burst of many
    //    reads within one window whose frames are all <anonymous> is an evaluated script walking the DOM.
    let winStart = 0, winCount = 0, winAnon = 0, winSampled = 0;
    // Frames of an evaluated script carry no URL: "<anonymous>", "eval at", or bare "at <anonymous>:line:col".
    const selfUrl = (script && script.src) || '/sdk/nanotarget.js';
    const anonymousCaller = () => {
      try {
        // Drop the Error line and this SDK's own wrapper frames, then judge the next callers.
        const frames = (new Error().stack || '').split('\n').slice(1).filter((f) => f.trim() && !f.includes(selfUrl)).slice(0, 4);
        return frames.length > 0 && frames.every((f) => !/https?:|chrome-extension:|file:|blob:|data:/.test(f));
      } catch { return false; }
    };
    const report = () => queueMicrotask(() => { if (typeof flush === 'function') flush().catch(() => {}); });
    let sensChecks = 0, sensWin = 0;
    const note = (target) => {
      const t = now();
      // Reading shield: an evaluated (URL-less) script touching a sensitive region seals it *before* the
      // getter returns, so even the first read sees the redacted text. Stack checks are capped per window.
      if (target && target.nodeType === 1 && document.querySelector(SEAL_SELECTOR)) {
        if (t - sensWin > 250) { sensWin = t; sensChecks = 0; }
        if (sensChecks < 20) {
          const touches = target === document.body || target === document.documentElement || target.tagName === 'MAIN' || target.closest(SEAL_SELECTOR) || target.querySelector(SEAL_SELECTOR);
          if (touches) { sensChecks++; if (anonymousCaller()) seal('anonymous_read'); }
        }
      }
      // Whole-document text extraction: body/main/html text read by an evaluated script.
      if (target && (target === document.body || target === document.documentElement || (target.tagName === 'MAIN') || (target.nodeType === 1 && target.childElementCount >= 40)) && anonymousCaller()) {
        R.textExtracts++;
        if (R.firstTextExtractMs === null) { R.firstTextExtractMs = t; report(); }
      }
      if (t - winStart > 250) { winStart = t; winCount = 0; winAnon = 0; winSampled = 0; }
      winCount++;
      if (winSampled < 3 && (winCount === 1 || winCount === 50 || winCount === 150)) {
        winSampled++;
        if (anonymousCaller()) winAnon++;
      }
      if (winCount === 150 && winAnon >= 1) {
        R.readBursts++;
        R.lastReadBurstReads = winCount;
        R.readBurstAnonymous = true;
        if (R.firstReadBurstMs === null) { R.firstReadBurstMs = t; report(); }
      }
    };
    const wrapGetter = (proto, prop) => {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || typeof d.get !== 'function') return;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, set: d.set, get() { note(this); return d.get.call(this); } });
    };
    const wrapMethod = (proto, name) => {
      const orig = proto[name];
      if (typeof orig !== 'function') return;
      Object.defineProperty(proto, name, { configurable: true, writable: true, value: function () { note(); return orig.apply(this, arguments); } });
    };
    try {
      wrapGetter(Node.prototype, 'textContent');
      wrapGetter(HTMLElement.prototype, 'innerText');
      wrapMethod(Element.prototype, 'getBoundingClientRect');
      wrapMethod(Element.prototype, 'getClientRects');
    } catch { /* ignore */ }

    // 1b. A panel opened beside the page, and long main-thread tasks with nobody touching the page.
    (() => {
      const U = early.surface;
      let lastInput = 0;
      const INPUT = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'click', 'touchstart'];
      for (const ev of INPUT) addEventListener(ev, () => { lastInput = now(); }, { capture: true, passive: true });
      let baseOuter = window.outerWidth, baseInner = window.innerWidth, baseDpr = window.devicePixelRatio, baseScreen = (screen && screen.width) || 0;
      // The panel may already be open when the page loads: then no resize fires, but the window is much
      // wider than the viewport. Horizontal chrome is a scrollbar's worth; 150px+ is something docked
      // beside the page. Browser zoom also shrinks the CSS viewport, so this stays environment-only
      // evidence: it never seals on its own, only paired with a scan nobody asked for.
      if (baseOuter - baseInner >= 150) { U.panelOpenedMs = 0; U.panelWidthPx = Math.round(baseOuter - baseInner); U.panelAtLoad = true; }
      addEventListener('resize', () => {
        const t = now(), w = window.innerWidth;
        const outerSame = Math.abs(window.outerWidth - baseOuter) <= 2 && ((screen && screen.width) || 0) === baseScreen;
        const zoomed = Math.abs(window.devicePixelRatio - baseDpr) > 0.01;
        if (!outerSame || zoomed) {                 // the window itself moved or the page was zoomed: re-baseline
          baseOuter = window.outerWidth; baseInner = w; baseDpr = window.devicePixelRatio; baseScreen = (screen && screen.width) || 0;
          return;
        }
        if (w >= baseInner) {                       // the viewport grew inside an unchanged window: that is the new baseline
          baseInner = w;
          if (U.panelOpenedMs !== null && U.panelClosedMs === null) U.panelClosedMs = t;
          return;
        }
        const took = baseInner - w;                 // the viewport lost width while the window stayed put: a panel took it
        if (took >= 150 && U.panelOpenedMs === null) {
          U.panelOpenedMs = t; U.panelWidthPx = Math.round(took);
          if (typeof flush === 'function') flush().catch(() => {});
        }
      }, { passive: true });
      try {
        if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0) {
          new PerformanceObserver((list) => {
            const t = now();
            if (t < 2500) return;                                   // skip this page's own boot work
            if (document.visibilityState !== 'visible') return;      // hidden-tab work is covered elsewhere
            if (t - lastInput < 1500) return;                        // the person is using the page
            for (const e of list.getEntries()) {
              if (e.duration < 120) continue;
              U.scans++;
              U.longestScanMs = Math.max(U.longestScanMs, Math.round(e.duration));
              if (U.firstScanMs === null) {
                U.firstScanMs = t;
                if (U.panelOpenedMs !== null) U.scanAfterPanelMs = Math.max(0, t - U.panelOpenedMs);
                if (typeof flush === 'function') flush().catch(() => {});
              }
              // A panel beside the page plus a scan the person did not cause: something in that panel is
              // reading this document. Redact what is on screen before it is read again.
              if (U.panelOpenedMs !== null && U.panelClosedMs === null) seal('panel_scan');
            }
          }).observe({ entryTypes: ['longtask'] });
        }
      } catch { /* ignore */ }
    })();

    // 2. Visibility flicker: a screenshot of a hidden document makes it visible for a frame, resizes it to the
    //    capture viewport, and hides it again. A person cannot show and hide a page within a few ms.
    let visibleSince = null, lastResize = null;
    window.addEventListener('resize', () => { lastResize = { t: now(), w: innerWidth, h: innerHeight }; });
    document.addEventListener('visibilitychange', () => {
      const t = now();
      if (document.visibilityState === 'visible') { visibleSince = t; return; }
      if (visibleSince !== null && t - visibleSince < 300) {
        R.visibilityFlickers++;
        if (R.firstFlickerMs === null) R.firstFlickerMs = t;
        if (lastResize && Math.abs(lastResize.t - t) < 300) R.flickerResize = `${lastResize.w}x${lastResize.h}`;
        queueMicrotask(() => { if (typeof flush === 'function') flush().catch(() => {}); });
      }
      visibleSince = null;
    });

    // 3. Rendering while hidden: rAF is suspended in a hidden document in ordinary browsers.
    let hiddenFrames = 0, hiddenFrameStart = null;
    const frame = () => {
      if (document.hidden) {
        const t = now();
        if (hiddenFrameStart === null) { hiddenFrameStart = t; hiddenFrames = 0; }
        hiddenFrames++;
        if (hiddenFrames >= 30 && t - hiddenFrameStart <= 2000 && R.renderWhileHiddenMs === null) R.renderWhileHiddenMs = t;
      } else { hiddenFrameStart = null; hiddenFrames = 0; }
      if (now() < 120000) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  })();
  // Extension-installed probes: an <img>/<script> load from chrome-extension:// succeeds only when installed.
  // Requires the host page CSP to allow `chrome-extension:` in img-src / connect-src.
  for (const [id, url] of EXTENSION_PROBES) {
    const mark = () => { if (!early.environment.extensionsInstalled.includes(id)) early.environment.extensionsInstalled.push(id); };
    try {
      if (url.endsWith('.png')) { const img = new Image(); img.onload = mark; img.src = url; }
      else fetch(url, { method: 'GET', cache: 'no-store' }).then((r) => { if (r.ok) mark(); }).catch(() => {});
    } catch { /* ignore */ }
  }
  // Passive focus-gained-while-hidden sampler: focus that ARRIVES while the document is hidden and
  // stays ≥300 ms is emulated (CDP), not a person. A person who focuses a visible page and then hides
  // it keeps focus but never gains it while hidden, so that case does not fire. Sampled every 100 ms.
  let hiddenFocusSince = null;
  let prevFocus = document.hasFocus();
  const focusSampler = setInterval(() => {
    const t = now();
    const focus = document.hasFocus();
    const hidden = document.visibilityState === 'hidden';
    if (hidden && focus && !prevFocus) hiddenFocusSince = t;
    if (!hidden || !focus) hiddenFocusSince = null;
    if (hiddenFocusSince !== null && t - hiddenFocusSince >= 300 && early.environment.focusWhileHiddenMs === null) { early.environment.focusWhileHiddenMs = t; queueMicrotask(() => { if (typeof flush === 'function') flush().catch(() => {}); }); }
    prevFocus = focus;
  }, 100);
  setTimeout(() => clearInterval(focusSampler), 120000);
  let earlyKey = '';
  const firstTouch = () => { if (early.firstInteractionMs === null) early.firstInteractionMs = now(); };
  document.addEventListener('pointerdown', firstTouch, { capture: true, once: true, passive: true });
  document.addEventListener('keydown', firstTouch, { capture: true, once: true, passive: true });

  function scan() {
    early.observedMs = now();
    early.webdriver = navigator.webdriver === true;
    if (!early.environment.codexModelContext && Object.prototype.hasOwnProperty.call(window, '__codexWebMcpModelContext')) early.environment.codexModelContext = true;
    if (!early.environment.modelContextApi && ('modelContext' in navigator || 'modelContext' in document)) early.environment.modelContextApi = true;
    if (!early.environment.clipboardBridge) {
      let bridge = Object.prototype.hasOwnProperty.call(window, '__browserUseClipboardBridge');
      if (!bridge) {
        try { bridge = Object.getOwnPropertyNames(window).some((n) => n.startsWith('__browserUseClipboard')); } catch { /* ignore */ }
      }
      if (bridge) { early.environment.clipboardBridge = true; early.environment.clipboardBridgeAtMs = now(); }
    }
    if (early.environment.agentGlobals.length < 10) {
      try {
        for (const n of Object.getOwnPropertyNames(window)) {
          if (GLOBAL_PREFIX.test(n) && !early.environment.agentGlobals.includes(n) && early.environment.agentGlobals.length < 10) early.environment.agentGlobals.push(n.slice(0, 64));
        }
      } catch { /* ignore */ }
    }
    if (early.dataDomMs === null && document.querySelector('[data-nt-sensitive]')) early.dataDomMs = now();
    let attachedNow = false;
    for (const [name, selector] of PROBES) {
      if (early.markers.some((m) => m.name === name)) continue;
      if (document.querySelector(selector)) { early.markers.push({ name, atMs: now() }); attachedNow = true; }
    }
    // An agent attaching to an open tab is the moment that matters: report it immediately, not on the next tick.
    if (attachedNow && typeof flush === 'function') flush().catch(() => {});
    if (!sealed) {
      if (early.webdriver) seal('webdriver');
      else if (early.markers.some((m) => CONTROL_MARKER.has(m.name))) seal('control_marker');
      else if (early.environment.agentGlobals.some((g) => CONTROL_GLOBAL.test(g))) seal('tool_globals');
    } else if (document.querySelector(SEAL_SELECTOR)) {
      // sealed is a state, not an event: anything rendered as "full" while an agent is attached is redacted too
      // (the mutation observer below watches data-nt-sensitive, so this runs right after the render)
      seal(sealReason || 'resealed');
    }
  }
  scan();
  const scanTimer = setInterval(scan, 250);
  setTimeout(() => clearInterval(scanTimer), 60000);
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['id', 'data-codex-favicon-badge', 'data-nt-sensitive'] });

  // ---------------------------------------------------------- interactions
  const inside = (e) => !zoneSelector || (e.target instanceof Element && !!e.target.closest(zoneSelector));
  let points = [];
  let down = null;
  let latestClick = null;
  let keys = 0;
  let lastKey = 0;
  let intervals = [];
  let inputs = 0;
  let pasted = false;
  const opts = { capture: true, passive: true };
  // The hand's approach survives a reload of this tab: a person who refreshes and clicks without moving still
  // arrived here by hand. Kept 60 s at most, in this tab only (sessionStorage), never across sites.
  try {
    const saved = JSON.parse(sessionStorage.getItem('nt-approach') || 'null');
    if (saved && Array.isArray(saved.p) && Date.now() - saved.at < 60000) {
      const shift = performance.now() - (Date.now() - saved.at) - saved.span; // map absolute ages onto this page's clock
      for (const q of saved.p) points.push({ t: shift + q[0], x: q[1], y: q[2] });
    }
    sessionStorage.removeItem('nt-approach');
  } catch { /* ignore */ }
  window.addEventListener('pagehide', () => {
    try { const p = points.slice(-60); if (p.length) sessionStorage.setItem('nt-approach', JSON.stringify({ at: Date.now(), span: p[p.length - 1].t - p[0].t, p: p.map((q) => [Math.round(q.t - p[0].t), Math.round(q.x), Math.round(q.y)]) })); } catch { /* ignore */ }
  });
  let coalesced = 0;
  document.addEventListener('pointermove', (e) => {
    if (!inside(e)) return;
    const t = performance.now();
    points.push({ t, x: e.clientX, y: e.clientY });
    // Coalesced events: a hardware mouse at 125–1000 Hz delivers several samples per frame; synthetic input delivers one.
    if (typeof e.getCoalescedEvents === 'function') { try { coalesced += e.getCoalescedEvents().length || 1; } catch { coalesced += 1; } } else coalesced += 1;
    // The approach to the target is kept regardless of age (capped by count): a hand that arrived, rested and
    // then tapped — or tapped five times in a row — still shows where it came from. Trackpad tap-to-click gives
    // 1–5 ms holds with no fresh movement (training runs 2026-09-22), which without this looked like a program.
    if (points.length > 240) points = points.slice(-240);
  }, opts);
  document.addEventListener('pointerdown', (e) => {
    if (!inside(e)) return;
    // pressure: spec says 0.5 when a button is pressed on hardware without pressure sensing; CDP-synthesised input reports 0.
    // hidden: a person cannot press on a document whose visibilityState is 'hidden'.
    down = { t: performance.now(), pointer: e.pointerType, pressure: typeof e.pressure === 'number' ? Math.round(e.pressure * 1000) / 1000 : null, hidden: document.visibilityState === 'hidden' };
    // the press position closes the approach: on a fast move the last pointermove can lag the press by a frame
    if (e.pointerType === 'mouse') points.push({ t: performance.now(), x: e.clientX, y: e.clientY });
  }, opts);
  // The element the person aimed at: where the click landed relative to its centre.
  const TARGETS = 'button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], tr.clickable, .target';
  const targetInfo = (e) => {
    const el = e.target instanceof Element ? e.target.closest(TARGETS) : null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return { w: Math.round(r.width), h: Math.round(r.height), dx: Math.round((e.clientX - (r.left + r.width / 2)) * 10) / 10, dy: Math.round((e.clientY - (r.top + r.height / 2)) * 10) / 10 };
  };
  document.addEventListener('click', (e) => {
    if (!inside(e)) return;
    if (!e.isTrusted && !sealed) seal('untrusted_event');
    const t = performance.now();
    const p = points.slice(-240);
    let path = 0;
    for (let i = 1; i < p.length; i++) path += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    latestClick = {
      trusted: e.isTrusted,
      pointer: e.pointerType || (down && down.pointer) || '',
      detail: Math.min(10, e.detail),
      holdMs: down ? Math.round(t - down.t) : null,
      moves: p.length,
      path: Math.round(path),
      travelMs: p.length > 1 ? Math.round(p[p.length - 1].t - p[0].t) : 0,
      pressure: down ? down.pressure : null,
      hidden: down ? down.hidden : (document.visibilityState === 'hidden'),
      // v3: the trajectory itself, so the server can judge the movement, not just count it
      traj: p.map((q) => [Math.round((q.t - t) * 10) / 10, Math.round(q.x), Math.round(q.y)]),
      downMs: down ? Math.round((down.t - t) * 10) / 10 : null,
      target: targetInfo(e),
      coalesced,
      at: [Math.round(e.clientX), Math.round(e.clientY)],
    };
    down = null;
    coalesced = 0;
  }, opts);
  // First click anywhere on the page (zone-independent): judged on its own by the connection classifier.
  {
    let anyDown = null;
    let anyMoves = 0;
    let anyMoveT = 0;
    document.addEventListener('pointermove', () => { const t = performance.now(); if (t - anyMoveT < 1500) anyMoves++; else anyMoves = 1; anyMoveT = t; }, opts);
    document.addEventListener('pointerdown', (e) => { anyDown = { t: performance.now(), pressure: typeof e.pressure === 'number' ? Math.round(e.pressure * 1000) / 1000 : null, hidden: document.visibilityState === 'hidden' }; }, opts);
    document.addEventListener('click', (e) => {
      if (early.reading.firstClick !== null) return;
      const t = performance.now();
      early.reading.firstClick = { atMs: now(), trusted: e.isTrusted, pointer: e.pointerType || 'mouse', holdMs: anyDown ? Math.round(t - anyDown.t) : null, moves: t - anyMoveT < 1500 ? anyMoves : 0, pressure: anyDown ? anyDown.pressure : null, hidden: anyDown ? anyDown.hidden : document.visibilityState === 'hidden' };
      queueMicrotask(() => flush().catch(() => {}));
    }, opts);
  }
  document.addEventListener('keydown', (e) => {
    if (!inside(e)) return;
    const t = performance.now();
    if (lastKey && intervals.length < 80) intervals.push(Math.round(t - lastKey));
    lastKey = t;
    keys = Math.min(500, keys + 1);
  }, opts);
  document.addEventListener('input', (e) => { if (inside(e)) inputs = Math.min(500, inputs + 1); }, opts);
  document.addEventListener('paste', (e) => { if (inside(e)) pasted = true; }, opts);

  function takeInteraction() {
    const sample = { atMs: now(), webdriver: navigator.webdriver === true, click: latestClick, keys, keyIntervals: intervals.slice(), inputEvents: inputs, paste: pasted };
    points = []; down = null; latestClick = null; keys = 0; lastKey = 0; intervals = []; inputs = 0; pasted = false;
    return sample;
  }

  // ------------------------------------------------------------ focus probe
  // Focus emulation (CDP Emulation.setFocusEmulationEnabled) makes several
  // tabs report document.hasFocus()===true at once. Two real tabs never do.
  // Requires: same origin, top-level windows, replies within 200 ms, both
  // sides focused for ≥300 ms, three consecutive hits from the same peer.
  if (focusProbe && 'BroadcastChannel' in window && window === window.top) {
    const id = Math.random().toString(36).slice(2);
    const ch = new BroadcastChannel('nanotarget-focus-probe');
    const peers = new Map();
    let focusedSince = document.hasFocus() ? Date.now() : null;
    window.addEventListener('focus', () => { focusedSince = Date.now(); });
    window.addEventListener('blur', () => { focusedSince = null; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) focusedSince = null; });
    ch.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.id === id) return;
      if (m.type === 'ping') { ch.postMessage({ type: 'pong', id, nonce: m.nonce, focus: document.hasFocus(), focusedSince, t: Date.now() }); return; }
      if (m.type !== 'pong') return;
      const peer = peers.get(m.id) || { streak: 0, nonce: null };
      peers.set(m.id, peer);
      if (m.nonce !== peer.nonce) return;
      const t = Date.now();
      const fresh = t - m.t <= 200;
      const localStable = document.hasFocus() && focusedSince !== null && t - focusedSince >= 300;
      const peerStable = m.focus && typeof m.focusedSince === 'number' && m.t - m.focusedSince >= 300;
      if (fresh && localStable && peerStable) {
        peer.streak++;
        if (peer.streak === 3) {
          early.focusConflict.count++;
          if (early.focusConflict.firstAtMs === null) early.focusConflict.firstAtMs = now();
          peer.streak = 0;
        }
      } else peer.streak = 0;
    };
    setInterval(() => {
      const nonce = Math.random().toString(36).slice(2);
      for (const p of peers.values()) p.nonce = nonce;
      early.focusConflict.peers = peers.size;
      ch.postMessage({ type: 'ping', id, nonce });
    }, 300);
  }

  // ------------------------------------------------------------- transport
  const listeners = new Set();
  let lastAssessment = null;
  let lastConnection = null;
  let flushing = null;
  function snapshot(withInteraction) {
    scan();
    return { early: { ...early, markers: early.markers.map((m) => ({ ...m })), environment: { ...early.environment }, reading: { ...early.reading }, surface: { ...early.surface }, focusConflict: { ...early.focusConflict } }, interaction: withInteraction ? takeInteraction() : null };
  }
  async function post(snap) {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...sessionHeaders() }, body: JSON.stringify(snap), credentials: 'same-origin', cache: 'no-store', keepalive: true });
    if (!r.ok) throw new Error('signals ' + r.status);
    const d = await r.json();
    lastAssessment = d.assessment || null;
    lastConnection = d.connection || null;
    if (lastConnection && (lastConnection.state === 'agent_attached' || lastConnection.state === 'signed_agent') && !sealed) seal('server_attached');
    for (const fn of listeners) { try { fn(lastAssessment, snap, lastConnection); } catch { /* ignore */ } }
    return lastAssessment;
  }
  function flush() {
    if (flushing) return flushing;
    flushing = post(snapshot(false)).finally(() => { flushing = null; });
    return flushing;
  }
  // Push when early state changes (debounced), plus a slow heartbeat.
  setInterval(() => {
    const key = JSON.stringify([early.markers, early.environment, early.reading, early.surface.panelOpenedMs, early.surface.scans, early.focusConflict.count, early.webdriver, early.firstInteractionMs !== null, early.dataDomMs !== null, early.webmcpInvocations, Math.min(6, Math.floor(now() / 500))]);
    if (key !== earlyKey) { earlyKey = key; flush().catch(() => {}); }
  }, 500);
  setInterval(() => flush().catch(() => {}), 15000);

  /** fetch() wrapper: attaches the current snapshot so the server decides with fresh telemetry. */
  function protectedFetch(input, init) {
    const snap = snapshot(true);
    const headers = new Headers((init && init.headers) || {});
    headers.set('X-NT-Sample', JSON.stringify(snap));
    if (sessionId) headers.set('X-NT-Session', sessionId);
    return fetch(input, { ...(init || {}), headers, credentials: 'same-origin', cache: 'no-store' });
  }

  /** Register a read-only WebMCP tool when the browser exposes the API. Calls are counted as strong agent evidence. */
  function registerTool(def) {
    const ctx = navigator.modelContext || document.modelContext;
    if (!ctx || typeof ctx.registerTool !== 'function') return false;
    try {
      ctx.registerTool({
        ...def,
        execute: async (input) => {
          early.webmcpInvocations++;
          await flush().catch(() => {});
          return def.execute(input);
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  window.NanoTarget = {
    version: 'sdk-v4',
    sessionId,
    sessionHeaders,
    snapshot: () => snapshot(false),
    flush,
    fetch: protectedFetch,
    registerTool,
    onAssessment: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    seal,
    unseal,
    get sealed() { return sealed; },
    get sealReason() { return sealReason; },
    get lastAssessment() { return lastAssessment; },
    get lastConnection() { return lastConnection; },
  };
})();
