/**
 * Escher Image Art Morph - Main Application
 */
(function () {
  // --- DOM refs ---
  const uploadSection = document.getElementById('upload-section');
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const canvasSection = document.getElementById('canvas-section');
  const outputCanvas = document.getElementById('output-canvas');
  const srcCanvas = document.getElementById('src-canvas');
  const overlay = document.getElementById('canvas-overlay');

  const morphSlider = document.getElementById('morph-slider');
  const scaleSlider = document.getElementById('scale-slider');
  const zoomSlider = document.getElementById('zoom-slider');
  const rotationSlider = document.getElementById('rotation-slider');

  const morphValue = document.getElementById('morph-value');
  const scaleValue = document.getElementById('scale-value');
  const zoomValue = document.getElementById('zoom-value');
  const rotationValue = document.getElementById('rotation-value');

  const btnAnimate = document.getElementById('btn-animate');
  const btnDownload = document.getElementById('btn-download');
  const btnChange = document.getElementById('btn-change');

  // --- State ---
  const OUTPUT_SIZE = 600; // square output canvas
  let srcImageData = null;
  let srcW = 0;
  let srcH = 0;
  let rendering = false;
  let animating = false;
  let animationId = null;
  let pendingRender = false;

  // --- Upload handling ---
  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      loadImage(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      loadImage(fileInput.files[0]);
    }
  });

  btnChange.addEventListener('click', () => {
    cancelAnimation();
    uploadSection.hidden = false;
    canvasSection.hidden = true;
    fileInput.value = '';
  });

  function loadImage(file) {
    const img = new Image();
    img.onload = () => {
      // Resize to reasonable dimensions for performance
      const maxDim = 512;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      srcCanvas.width = w;
      srcCanvas.height = h;
      const ctx = srcCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      srcImageData = ctx.getImageData(0, 0, w, h);
      srcW = w;
      srcH = h;

      outputCanvas.width = OUTPUT_SIZE;
      outputCanvas.height = OUTPUT_SIZE;

      uploadSection.hidden = true;
      canvasSection.hidden = false;

      scheduleRender();
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  // --- Controls ---
  morphSlider.addEventListener('input', () => {
    morphValue.textContent = morphSlider.value + '%';
    scheduleRender();
  });

  scaleSlider.addEventListener('input', () => {
    scaleValue.textContent = scaleSlider.value;
    scheduleRender();
  });

  zoomSlider.addEventListener('input', () => {
    const z = zoomSlider.value / 100;
    zoomValue.textContent = z.toFixed(1) + 'x';
    scheduleRender();
  });

  rotationSlider.addEventListener('input', () => {
    rotationValue.innerHTML = rotationSlider.value + '&deg;';
    scheduleRender();
  });

  // --- Rendering ---
  function getParams() {
    return {
      scaleFactor: parseFloat(scaleSlider.value),
      morph: parseFloat(morphSlider.value) / 100,
      zoom: parseFloat(zoomSlider.value) / 100,
      extraRotation: parseFloat(rotationSlider.value) * Math.PI / 180
    };
  }

  function scheduleRender() {
    if (rendering) {
      pendingRender = true;
      return;
    }
    doRender();
  }

  function doRender() {
    if (!srcImageData) return;

    rendering = true;
    overlay.hidden = false;

    const ctx = outputCanvas.getContext('2d');
    const outData = ctx.createImageData(OUTPUT_SIZE, OUTPUT_SIZE);
    const params = getParams();

    EscherTransform.renderAsync(
      srcImageData, srcW, srcH,
      outData, OUTPUT_SIZE, OUTPUT_SIZE,
      params,
      null, // onProgress
      (result) => {
        ctx.putImageData(result, 0, 0);
        overlay.hidden = true;
        rendering = false;

        if (pendingRender) {
          pendingRender = false;
          doRender();
        }
      }
    );
  }

  // --- Animation ---
  btnAnimate.addEventListener('click', () => {
    if (animating) {
      cancelAnimation();
      return;
    }
    startAnimation();
  });

  function startAnimation() {
    animating = true;
    btnAnimate.textContent = 'Stop';

    let morphVal = 0;
    morphSlider.value = 0;
    morphValue.textContent = '0%';

    const startTime = performance.now();
    const duration = 3000; // 3 seconds for full morph

    function step(timestamp) {
      const elapsed = timestamp - startTime;
      const t = Math.min(elapsed / duration, 1);

      // Smooth easing (ease-in-out)
      const eased = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;

      morphVal = Math.round(eased * 100);
      morphSlider.value = morphVal;
      morphValue.textContent = morphVal + '%';

      // Synchronous render for smooth animation
      if (srcImageData) {
        const ctx = outputCanvas.getContext('2d');
        const outData = ctx.createImageData(OUTPUT_SIZE, OUTPUT_SIZE);
        const params = getParams();
        EscherTransform.render(srcImageData, srcW, srcH, outData, OUTPUT_SIZE, OUTPUT_SIZE, params);
        ctx.putImageData(outData, 0, 0);
      }

      if (t < 1) {
        animationId = requestAnimationFrame(step);
      } else {
        animating = false;
        btnAnimate.textContent = 'Animate Morph';
        overlay.hidden = true;
      }
    }

    animationId = requestAnimationFrame(step);
  }

  function cancelAnimation() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    animating = false;
    btnAnimate.textContent = 'Animate Morph';
  }

  // --- Download ---
  btnDownload.addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = 'escher-morph.png';
    link.href = outputCanvas.toDataURL('image/png');
    link.click();
  });
})();
