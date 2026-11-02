const bindings = new WeakMap();

/**
 * Frozen, uncropped artwork until hover or keyboard focus. drawImage uses an
 * animated image's default/first frame. No pixel readback is needed, so even
 * cross-origin artwork can have a poster without requesting CORS permission.
 */
export function bindArtwork(root) {
  bindings.get(root)?.();
  const doc = root.ownerDocument;
  const view = doc.defaultView;
  const motionRoot = root.closest("[data-motion]") ?? root;
  const reduced = view?.matchMedia?.("(prefers-reduced-motion: reduce)");
  const disposers = [];
  const states = [];
  let disposed = false;
  function listen(target, type, handler) {
    target?.addEventListener(type, handler);
    disposers.push(() => target?.removeEventListener(type, handler));
  }
  function releasePlayback(state) {
    if (state.objectUrl) view.URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
  function preparePlayback(state) {
    if (state.loading || state.blob || state.nativePlayback) return;
    if (!view?.fetch || !view.URL?.createObjectURL || /\.svg(?:[?#]|$)|^data:image\/svg\+xml/i.test(state.src)
      || state.src.includes("#")) {
      state.nativePlayback = true;
      return;
    }
    state.request = new AbortController();
    state.loading = true;
    view.fetch(state.src, { cache: "force-cache", signal: state.request.signal })
      .then(response => {
        if (!response.ok) throw new Error("Artwork unavailable");
        return response.blob();
      })
      .then(blob => {
        if (disposed) return;
        state.blob = blob;
        state.loading = false;
        update(state);
      })
      .catch(() => {
        if (disposed) return;
        // External servers may allow an img but not a CORS-readable response.
        // Keep their native image behavior rather than dropping working art.
        state.nativePlayback = true;
        state.loading = false;
        update(state);
      });
  }
  function update(state) {
    const playing = !disposed && state.ready && state.visible
      && !doc.hidden && !reduced?.matches && motionRoot.dataset.motion === "full"
      && (state.hovered || state.focused);
    // A fresh object URL owns its animation decoder. Simply restoring the
    // original URL can reuse a finite animation already finished elsewhere.
    if (state.ready) {
      if (playing && !state.image.getAttribute("src")) {
        preparePlayback(state);
        if (state.blob) {
          state.objectUrl = view.URL.createObjectURL(state.blob);
          state.image.setAttribute("src", state.objectUrl);
        } else if (state.nativePlayback) state.image.setAttribute("src", state.src);
      } else if (!playing) {
        state.image.removeAttribute("src");
        releasePlayback(state);
      }
    }
    state.frame.classList.toggle("is-art-active", playing && !!state.image.getAttribute("src")
      && state.image.complete && state.image.naturalWidth > 0);
  }
  const updateAll = () => states.forEach(update);

  for (const frame of root.querySelectorAll(".bestiary-art")) {
    if (frame.classList.contains("is-silhouette")) continue;
    const image = frame.querySelector("img");
    if (!image) continue;
    const owner = frame.closest("[data-art-interaction]") ?? frame;
    const state = { frame, image, src: image.getAttribute("src"), ready: false, visible: true, hovered: owner.matches(":hover"),
      focused: owner.contains(doc.activeElement), canvases: [] };
    states.push(state);
    frame.classList.add("is-art-bound");
    image.classList.add("bestiary-art-source");
    const failed = () => {
      if (state.objectUrl && state.ready) {
        releasePlayback(state);
        state.blob = null;
        state.nativePlayback = true;
        image.removeAttribute("src");
        update(state);
        return;
      }
      state.ready = false;
      for (const canvas of state.canvases) { canvas.width = canvas.height = 0; canvas.remove(); }
      state.canvases = [];
      frame.classList.remove("is-art-ready", "is-art-active");
      frame.classList.add("is-art-unavailable");
      if (!state.fallback) {
        state.fallback = doc.createElement("span");
        state.fallback.classList.add("bestiary-art-fallback");
        state.fallback.setAttribute("aria-hidden", "true");
        state.fallback.textContent = image.alt;
        frame.append(state.fallback);
      }
    };
    const loaded = () => {
      if (disposed) return;
      if (state.ready) return update(state);
      if (!image.naturalWidth || !image.naturalHeight) return failed();
      const canvases = [];
      try {
        for (const name of ["bestiary-art-poster", "bestiary-art-backdrop"]) {
          const limit = name === "bestiary-art-backdrop" ? 256 : 1024;
          const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = doc.createElement("canvas");
          canvases.push(canvas);
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.classList.add(name);
          canvas.setAttribute("aria-hidden", "true");
          canvas.style.objectFit = name === "bestiary-art-backdrop" ? "cover" : image.style.objectFit || "contain";
          canvas.style.objectPosition = image.style.objectPosition || "50% 50%";
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas unavailable");
          context.drawImage(canvases.length === 1 ? image : canvases[0], 0, 0, canvas.width, canvas.height);
        }
        state.canvases = canvases;
        state.fallback?.remove();
        state.fallback = null;
        frame.append(...canvases);
        state.ready = true;
        frame.classList.remove("is-art-unavailable");
        frame.classList.add("is-art-ready");
        image.removeAttribute("src");
        update(state);
      } catch {
        for (const canvas of canvases) { canvas.width = canvas.height = 0; canvas.remove(); }
        failed();
      }
    };
    listen(image, "load", loaded);
    listen(image, "error", failed);
    listen(owner, "pointerenter", () => { state.hovered = true; update(state); });
    listen(owner, "pointerleave", () => { state.hovered = false; update(state); });
    listen(owner, "focusin", () => { state.focused = true; update(state); });
    listen(owner, "focusout", event => { state.focused = owner.contains(event.relatedTarget); update(state); });
    if (image.complete) loaded();
  }

  listen(doc, "visibilitychange", updateAll);
  listen(reduced, "change", updateAll);
  const observer = view?.MutationObserver ? new view.MutationObserver(updateAll) : null;
  observer?.observe(motionRoot, { attributes: true, attributeFilter: ["data-motion"] });
  const intersection = view?.IntersectionObserver ? new view.IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = states.find(item => item.frame === entry.target);
      if (state) { state.visible = entry.isIntersecting; update(state); }
    }
  }) : null;
  states.forEach(state => intersection?.observe(state.frame));

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    disposers.forEach(dispose => dispose());
    observer?.disconnect();
    intersection?.disconnect();
    for (const state of states) {
      state.request?.abort();
      releasePlayback(state);
      state.blob = null;
      state.frame.classList.remove("is-art-bound", "is-art-ready", "is-art-active", "is-art-unavailable");
      for (const canvas of state.canvases) { canvas.width = canvas.height = 0; canvas.remove(); }
      state.fallback?.remove();
      if (state.src && state.image.getAttribute("src") !== state.src) state.image.setAttribute("src", state.src);
    }
    states.length = disposers.length = 0;
    if (bindings.get(root) === cleanup) bindings.delete(root);
  };
  bindings.set(root, cleanup);
  return cleanup;
}
