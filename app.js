/**
 * Escher Image Art Morph — Main Application
 * Manages tabs, controls, rendering, animation, and image I/O.
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
  const dragPad = document.getElementById('drag-pad');
  const btnAnimate = document.getElementById('btn-animate');
  const btnDownload = document.getElementById('btn-download');
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
      // Show/hide controls via class toggle
      document.querySelectorAll('.mode-controls').forEach(c => c.classList.remove('active'));
      const ctrl = document.getElementById('controls-' + activeMode);
      if (ctrl) ctrl.classList.add('active');
      // Show drag pad only for conformal power mode
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

  // ---- Controls: read values ----
  function val(id) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return el.tagName === 'SELECT' ? el.value : parseFloat(el.value);
  }

  function getParams() {
    switch (activeMode) {
      case 'escher':
        return {
          scaleFactor: val('escher-scale'), morph: val('escher-morph') / 100,
          zoom: val('escher-zoom') / 100, extraRotation: val('escher-rotation') * Math.PI / 180
        };
      case 'kaleidoscope':
        return {
          segments: val('kal-segments'), rotation: val('kal-rotation'),
          zoom: val('kal-zoom') / 100, offsetX: val('kal-offx'), offsetY: val('kal-offy')
        };
      case 'conformal':
        return {
          func: val('conf-func'), powerRe: confPowerRe, powerIm: confPowerIm,
          zoom: val('conf-zoom') / 100
        };
      case 'hyperbolic':
        return {
          p: val('hyp-p'), q: val('hyp-q'),
          rotation: val('hyp-rotation'), layers: val('hyp-layers')
        };
      case 'logspace':
        return {
          scaleFactor: val('log-scale'), zoom: val('log-zoom') / 100,
          panX: val('log-panx'), panY: val('log-pany')
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

  // ---- Bind all sliders ----
  function bindSlider(id, displayId, fmt) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const d = document.getElementById(displayId);
      if (d) d.innerHTML = fmt(el.value);
      if (id === 'conf-func') updateDragPadVisibility();
      scheduleRender();
    });
  }

  // Escher
  bindSlider('escher-morph', 'escher-morph-v', v => v + '%');
  bindSlider('escher-scale', 'escher-scale-v', v => v);
  bindSlider('escher-zoom', 'escher-zoom-v', v => (v / 100).toFixed(1) + 'x');
  bindSlider('escher-rotation', 'escher-rotation-v', v => v + '&deg;');
  // Kaleidoscope
  bindSlider('kal-segments', 'kal-segments-v', v => v);
  bindSlider('kal-rotation', 'kal-rotation-v', v => v + '&deg;');
  bindSlider('kal-zoom', 'kal-zoom-v', v => (v / 100).toFixed(1) + 'x');
  bindSlider('kal-offx', 'kal-offx-v', v => v);
  bindSlider('kal-offy', 'kal-offy-v', v => v);
  // Conformal
  bindSlider('conf-zoom', 'conf-zoom-v', v => (v / 100).toFixed(1) + 'x');
  const confFunc = document.getElementById('conf-func');
  if (confFunc) confFunc.addEventListener('change', () => { updateDragPadVisibility(); scheduleRender(); });
  // Hyperbolic
  bindSlider('hyp-p', 'hyp-p-v', v => v);
  bindSlider('hyp-q', 'hyp-q-v', v => v);
  bindSlider('hyp-rotation', 'hyp-rotation-v', v => v + '&deg;');
  bindSlider('hyp-layers', 'hyp-layers-v', v => v);
  // Log space
  bindSlider('log-scale', 'log-scale-v', v => v);
  bindSlider('log-zoom', 'log-zoom-v', v => (v / 100).toFixed(1) + 'x');
  bindSlider('log-panx', 'log-panx-v', v => v);
  bindSlider('log-pany', 'log-pany-v', v => v);

  // ---- Conformal drag pad (interactive complex exponent) ----
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
    // Map canvas position to complex exponent
    // Center = 2+0i, range: real 0..4, imag -2..2
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

    // Use rAF to let the overlay show before blocking
    requestAnimationFrame(() => {
      const ctx = outputCanvas.getContext('2d');
      const outData = ctx.createImageData(SIZE, SIZE);
      const renderer = getRenderer();
      const params = getParams();

      try {
        renderer(srcImageData, srcW, srcH, outData, SIZE, SIZE, params);
      } catch (e) {
        console.error('Render error:', e);
      }

      ctx.putImageData(outData, 0, 0);

      // Draw Poincare disk border for hyperbolic mode
      if (activeMode === 'hyperbolic') {
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, 2 * Math.PI);
        ctx.strokeStyle = '#7c5cfc';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      overlay.hidden = true;
      rendering = false;
      if (renderQueued) { renderQueued = false; doRender(); }
    });
  }

  // ---- Animation ----
  btnAnimate.addEventListener('click', () => {
    if (animating) { cancelAnim(); return; }
    startAnim();
  });

  function startAnim() {
    animating = true;
    btnAnimate.textContent = 'Stop';
    const start = performance.now();
    const duration = 3000;

    // Determine what to animate based on mode
    const animSlider = getAnimSlider();
    if (!animSlider) { cancelAnim(); return; }
    const { el, displayEl, min, max, format } = animSlider;
    const origVal = parseFloat(el.value);

    function step(ts) {
      const t = Math.min((ts - start) / duration, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const v = min + eased * (max - min);
      el.value = v;
      if (displayEl) displayEl.innerHTML = format(Math.round(v));

      const ctx = outputCanvas.getContext('2d');
      const outData = ctx.createImageData(SIZE, SIZE);
      const renderer = getRenderer();
      try {
        renderer(srcImageData, srcW, srcH, outData, SIZE, SIZE, getParams());
      } catch (e) { /* skip frame */ }
      ctx.putImageData(outData, 0, 0);

      if (activeMode === 'hyperbolic') {
        ctx.beginPath();
        ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 2, 0, 2 * Math.PI);
        ctx.strokeStyle = '#7c5cfc'; ctx.lineWidth = 2; ctx.stroke();
      }

      if (t < 1) {
        animationId = requestAnimationFrame(step);
      } else {
        animating = false;
        btnAnimate.textContent = 'Animate';
      }
    }
    animationId = requestAnimationFrame(step);
  }

  function getAnimSlider() {
    switch (activeMode) {
      case 'escher': return {
        el: document.getElementById('escher-morph'),
        displayEl: document.getElementById('escher-morph-v'),
        min: 0, max: 100, format: v => v + '%'
      };
      case 'kaleidoscope': return {
        el: document.getElementById('kal-rotation'),
        displayEl: document.getElementById('kal-rotation-v'),
        min: 0, max: 360, format: v => v + '&deg;'
      };
      case 'conformal': return {
        el: document.getElementById('conf-zoom'),
        displayEl: document.getElementById('conf-zoom-v'),
        min: 20, max: 300, format: v => (v / 100).toFixed(1) + 'x'
      };
      case 'hyperbolic': return {
        el: document.getElementById('hyp-rotation'),
        displayEl: document.getElementById('hyp-rotation-v'),
        min: 0, max: 360, format: v => v + '&deg;'
      };
      case 'logspace': return {
        el: document.getElementById('log-panx'),
        displayEl: document.getElementById('log-panx-v'),
        min: -200, max: 200, format: v => v
      };
      default: return null;
    }
  }

  function cancelAnim() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null; animating = false;
    btnAnimate.textContent = 'Animate';
  }

  // ---- Download ----
  btnDownload.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'escher-' + activeMode + '.png';
    link.href = outputCanvas.toDataURL('image/png');
    link.click();
  });
})();
