/* Runs in the authenticated stream document, not across the iframe boundary. */
(() => {
  'use strict';
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || document.pointerLockElement) return;
    const input = window.webrtcInput;
    const target = event.target;
    if (!input?.inputAttached || !(target instanceof Element)) return;
    if (target !== input.element && !target.closest('#overlayInput,#videoCanvas,#videoWorkerCanvas,#videoStream,#stream')) return;
    const surface = input.element;
    surface.focus({preventScroll:true});
    // Keep the browser's user activation: request directly in the click handler.
    // Selkies' pointerlockchange listener forwards relative motion to Minecraft.
    try {
      const pending = surface.requestPointerLock();
      pending?.catch(() => {}); // Escape/permission denial leaves the stream usable.
    } catch { /* Unsupported browsers retain normal absolute mouse input. */ }
  }, true);
})();
