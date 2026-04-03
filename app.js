/**
 * Escher Image Art Morph — Main Application
 * Manages tabs, controls, rendering, animation, GIF export, and image I/O.
 */
(function () {
  // ---- DOM ----
  const uploadSection = document.getElementById('upload-section');
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const workspace = document.getElementById('workspace');
  const outputCanvas = document.getElementById('output-canvas');
  const srcCanvas = document.getElementById('src-canvas');
  const overlay = document.getElementById('canvas-overlay');
  const overlayText = document.getElementById('overlay-text');
  const dragPad = document.getElementById('drag-pad');
  const btnAnimate = document.getElementById('btn-animate');
  const btnDownload = document.getElementById('btn-download');
  const btnGif = document.getElementById('btn-gif');
  const btnChange = document.getElementById('btn-change');
  const tabs = document.querySelectorAll('.tab');

  // ---- State ----
  const SIZE = 600;
  let srcImageData = null, srcW = 0, srcH = 0;
  let activeMode = 'escher';
  let animating = false, animationId = null;
  let renderQueued = false, rendering = false;

  // Conformal drag state
  let confPowerRe = 2.0, confPowerIm = 0.0;
  let dragging = false;

  // ---- Upload ----
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault(); uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files.length) loadImage(fileInput.files[0]); });

  btnChange.addEventListener('click', () => {
    cancelAnim();
    uploadSection.hidden = false;
    workspace.hidden = true;
    fileInput.value = '';
  });

  function loadImage(file) {
    const img = new Image();
    img.onload = () => {
      const max = 512;
      let w = img.width, h = img.height;
      if (w > max || h > max) { const r = Math.min(max / w, max / h); w = Math.round(w * r); h = Math.round(h * r); }
      srcCanvas.width = w; srcCanvas.height = h;
      const ctx = srcCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      srcImageData = ctx.getImageData(0, 0, w, h);
      srcW = w; srcH = h;
      outputCanvas.width = SIZE; outputCanvas.height = SIZE;
      uploadSection.hidden = true; workspace.hidden = false;
      scheduleRender();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  // ---- Tabs ----
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      cancelAnim();
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeMode = tab.dataset.mode;
      document.querySelectorAll('.mode-controls').forEach(c => c.classList.remove('active'));
      const ctrl = document.getElementById('controls-' + activeMode);
      if (ctrl) ctrl.classList.add('active');
      updateDragPadVisibility();
      scheduleRender();
    });
  });

  function updateDragPadVisibility() {
    const show = activeMode === 'conformal' && val('conf-func') === 'power';
    dragPad.hidden = !show;
    const hint = document.getElementById('conf-hint');
    if (hint) hint.hidden = !show;
    const pg = document.getElementById('conf-power-group');
    if (pg) pg.hidden = val('conf-func') !== 'power';
  }

  // ---- Controls ----
  function val(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
  }

  function getParams() {
    switch (activeMode) {
      case 'escher':
        return {
          scaleFactor: val('escher-scale-v'), morph: val('escher-morph-v') / 100,
          zoom: val('escher-zoom-v') / 100, extraRotation: val('escher-rotation-v') * Math.PI / 180
        };
      case 'kaleidoscope':
        return {
          segments: val('kal-segments-v'), rotation: val('kal-rotation-v'),
          zoom: val('kal-zoom-v') / 100, offsetX: val('kal-offx-v'), offsetY: val('kal-offy-v')
        };
      case 'conformal':
        return {
          func: val('conf-func'), powerRe: confPowerRe, powerIm: confPowerIm,
          zoom: val('conf-zoom-v') / 100
        };
      case 'hyperbolic':
        return {
          p: val('hyp-p-v'), q: val('hyp-q-v'),
          rotation: val('hyp-rotation-v'), layers: val('hyp-layers-v')
        };
      case 'logspace':
        return {
          scaleFactor: val('log-scale-v'), zoom: val('log-zoom-v') / 100,
          panX: val('log-panx-v'), panY: val('log-pany-v')
        };
      default: return {};
    }
  }

  function getRenderer() {
    switch (activeMode) {
      case 'escher': return Transforms.escher.render;
      case 'kaleidoscope': return Transforms.kaleidoscope.render;
      case 'conformal': return Transforms.conformal.render;
      case 'hyperbolic': return Transforms.hyperbolic.render;
      case 'logspace': return Transforms.logspace.render;
    }
  }

  // ---- Bidirectional slider <-> number input binding ----
  // Each pair: slider ID and number input ID (with -v suffix)
  const sliderPairs = [
    'escher-morph', 'escher-scale', 'escher-zoom', 'escher-rotation',
    'kal-segments', 'kal-rotation', 'kal-zoom', 'kal-offx', 'kal-offy',
    'conf-zoom',
    'hyp-p', 'hyp-q', 'hyp-rotation', 'hyp-layers',
    'log-scale', 'log-zoom', 'log-panx', 'log-pany'
  ];

  sliderPairs.forEach(id => {
    const slider = document.getElementById(id);
    const numInput = document.getElementById(id + '-v');
    if (!slider || !numInput) return;

    // Slider -> number input
    slider.addEventListener('input', () => {
      numInput.value = slider.value;
      if (id === 'conf-func') updateDragPadVisibility();
      scheduleRender();
    });

    // Number input -> slider
    numInput.addEventListener('input', () => {
      // Clamp to slider range
      let v = parseFloat(numInput.value);
      if (isNaN(v)) return;
      v = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), v));
      slider.value = v;
      scheduleRender();
    });
  });

  // Conformal function dropdown
  const confFunc = document.getElementById('conf-func');
  if (confFunc) confFunc.addEventListener('change', () => { updateDragPadVisibility(); scheduleRender(); });

  // ---- Conformal drag pad ----
  function onDragStart(e) {
    if (activeMode !== 'conformal' || val('conf-func') !== 'power') return;
    dragging = true;
    onDragMove(e);
  }
  function onDragMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const rect = dragPad.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    confPowerRe = ((clientX - rect.left) / rect.width) * 4;
    confPowerIm = (0.5 - (clientY - rect.top) / rect.height) * 4;
    const d = document.getElementById('conf-power-v');
    if (d) d.textContent = confPowerRe.toFixed(1) + (confPowerIm >= 0 ? ' + ' : ' - ') + Math.abs(confPowerIm).toFixed(1) + 'i';
    scheduleRender();
  }
  function onDragEnd() { dragging = false; }

  dragPad.addEventListener('mousedown', onDragStart);
  dragPad.addEventListener('mousemove', onDragMove);
  dragPad.addEventListener('mouseup', onDragEnd);
  dragPad.addEventListener('mouseleave', onDragEnd);
  dragPad.addEventListener('touchstart', onDragStart, { passive: false });
  dragPad.addEventListener('touchmove', onDragMove, { passive: false });
  dragPad.addEventListener('touchend', onDragEnd);

  // ---- Rendering ----
  function scheduleRender() {
    if (rendering) { renderQueued = true; return; }
    doRender();
  }

  function doRender() {
    if (!srcImageData) return;
    rendering = true;
    overlay.hidden = false;
    overlayText.textContent = 'Rendering...';

    requestAnimationFrame(() => {
      const ctx = outputCanvas.getContext('2d');
      const outData = ctx.createImageData(SIZE, SIZE);
      const renderer = getRenderer();
      try {
        renderer(srcImageData, srcW, srcH, outData, SIZE, SIZE, getParams());
      } catch (e) { console.error('Render error:', e); }
      ctx.putImageData(outData, 0, 0);
      drawOverlays(ctx);
      overlay.hidden = true;
      rendering = false;
      if (renderQueued) { renderQueued = false; doRender(); }
    });
  }

  function drawOverlays(ctx) {
    if (activeMode === 'hyperbolic') {
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, 2 * Math.PI);
      ctx.strokeStyle = '#7c5cfc'; ctx.lineWidth = 2; ctx.stroke();
    }
  }

  // ---- Animation ----
  btnAnimate.addEventListener('click', () => {
    if (animating) { cancelAnim(); return; }
    startAnim();
  });

  function getAnimSlider() {
    switch (activeMode) {
      case 'escher': return { slider: 'escher-morph', num: 'escher-morph-v', min: 0, max: 100 };
      case 'kaleidoscope': return { slider: 'kal-rotation', num: 'kal-rotation-v', min: 0, max: 360 };
      case 'conformal': return { slider: 'conf-zoom', num: 'conf-zoom-v', min: 20, max: 300 };
      case 'hyperbolic': return { slider: 'hyp-rotation', num: 'hyp-rotation-v', min: 0, max: 360 };
      case 'logspace': return { slider: 'log-panx', num: 'log-panx-v', min: -200, max: 200 };
      default: return null;
    }
  }

  function startAnim() {
    animating = true;
    btnAnimate.textContent = 'Stop';
    const start = performance.now();
    const duration = 3000;
    const anim = getAnimSlider();
    if (!anim) { cancelAnim(); return; }
    const sliderEl = document.getElementById(anim.slider);
    const numEl = document.getElementById(anim.num);

    function step(ts) {
      const t = Math.min((ts - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const v = Math.round(anim.min + eased * (anim.max - anim.min));
      sliderEl.value = v;
      numEl.value = v;

      const ctx = outputCanvas.getContext('2d');
      const outData = ctx.createImageData(SIZE, SIZE);
      try {
        getRenderer()(srcImageData, srcW, srcH, outData, SIZE, SIZE, getParams());
      } catch (e) { /* skip */ }
      ctx.putImageData(outData, 0, 0);
      drawOverlays(ctx);

      if (t < 1) { animationId = requestAnimationFrame(step); }
      else { animating = false; btnAnimate.textContent = 'Animate'; }
    }
    animationId = requestAnimationFrame(step);
  }

  function cancelAnim() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null; animating = false;
    btnAnimate.textContent = 'Animate';
  }

  // ---- Save modal (iOS-friendly) ----
  const saveModal = document.getElementById('save-modal');
  const saveModalImg = document.getElementById('save-modal-img');
  const saveModalClose = document.getElementById('save-modal-close');

  let currentBlobUrl = null;

  saveModalClose.addEventListener('click', () => {
    saveModal.hidden = true;
    if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
  });
  saveModal.addEventListener('click', (e) => {
    if (e.target === saveModal) {
      saveModal.hidden = true;
      if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
    }
  });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function showSaveModal(blob) {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);
    saveModalImg.src = currentBlobUrl;
    saveModal.hidden = false;
  }

  function triggerDownload(blob, filename) {
    if (isIOS) {
      // iOS: show modal with image — long-press to save
      showSaveModal(blob);
    } else {
      // Desktop: programmatic download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  // ---- Download PNG ----
  btnDownload.addEventListener('click', () => {
    outputCanvas.toBlob(blob => {
      if (blob) triggerDownload(blob, 'escher-' + activeMode + '.png');
    }, 'image/png');
  });

  // ---- Export GIF ----
  btnGif.addEventListener('click', () => {
    if (!srcImageData || animating) return;
    exportGif();
  });

  function exportGif() {
    const FRAMES = 30;
    const GIF_SIZE = 300; // smaller for performance
    const DELAY = 6; // centiseconds per frame (60ms)

    overlay.hidden = false;
    overlayText.textContent = 'Generating GIF: 0/' + FRAMES + ' frames...';

    const anim = getAnimSlider();
    if (!anim) { overlay.hidden = true; return; }

    const sliderEl = document.getElementById(anim.slider);
    const numEl = document.getElementById(anim.num);
    const origSliderVal = sliderEl.value;
    const origNumVal = numEl.value;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = GIF_SIZE;
    tempCanvas.height = GIF_SIZE;
    const tempCtx = tempCanvas.getContext('2d');

    const frames = [];
    let frameIdx = 0;

    function renderNextFrame() {
      if (frameIdx >= FRAMES) {
        // Restore original values
        sliderEl.value = origSliderVal;
        numEl.value = origNumVal;

        overlayText.textContent = 'Encoding GIF...';
        requestAnimationFrame(() => {
          try {
            const blob = GIFEncoder.encode(frames, GIF_SIZE, GIF_SIZE, DELAY);
            overlay.hidden = true;
            triggerDownload(blob, 'escher-' + activeMode + '.gif');
            scheduleRender();
          } catch (e) {
            console.error('GIF encode error:', e);
            overlayText.textContent = 'GIF export failed — ' + e.message;
            setTimeout(() => { overlay.hidden = true; }, 2000);
          }
        });
        return;
      }

      const t = frameIdx / (FRAMES - 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const v = Math.round(anim.min + eased * (anim.max - anim.min));
      sliderEl.value = v;
      numEl.value = v;

      overlayText.textContent = 'Generating GIF: ' + (frameIdx + 1) + '/' + FRAMES + ' frames...';

      const outData = tempCtx.createImageData(GIF_SIZE, GIF_SIZE);
      try {
        getRenderer()(srcImageData, srcW, srcH, outData, GIF_SIZE, GIF_SIZE, getParams());
      } catch (e) { /* skip */ }
      frames.push(outData);
      frameIdx++;

      // Yield to UI
      requestAnimationFrame(renderNextFrame);
    }

    requestAnimationFrame(renderNextFrame);
  }
})();
