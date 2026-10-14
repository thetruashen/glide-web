/* Runs in the authenticated stream document, not across the iframe boundary. */
(() => {
  'use strict';
  const params=new URLSearchParams(location.search);
  const width=Math.max(640,Math.min(Number(params.get('manual_width')) || 1280,1920));
  const height=Math.max(360,Math.min(Number(params.get('manual_height')) || 720,1080));
  document.documentElement.style.setProperty('--pigmc-fit-width',`${100*width/height}dvh`);
  document.documentElement.style.setProperty('--pigmc-fit-height',`${100*height/width}vw`);
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
