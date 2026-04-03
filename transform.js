/**
 * Escher Transform Engine — all rendering modes.
 *
 * Each mode implements: render(srcData, srcW, srcH, outData, outW, outH, params)
 * Uses inverse mapping: for each output pixel, find source pixel.
 * Bilinear interpolation is shared via sampleBilinear().
 */

const Transforms = (() => {
  // ---- Shared helpers ----

  function sampleBilinear(src, srcW, srcH, fx, fy, out, outIdx) {
    // Wrap fx to [0, srcW), fy to [0, srcH)
    fx = ((fx % srcW) + srcW) % srcW;
    fy = ((fy % srcH) + srcH) % srcH;

    const sx0 = Math.floor(fx);
    const sy0 = Math.floor(fy);
    const sx1 = (sx0 + 1) % srcW;
    const sy1 = (sy0 + 1) % srcH;
    const dx = fx - sx0;
    const dy = fy - sy0;

    const i00 = (sy0 * srcW + sx0) * 4;
    const i10 = (sy0 * srcW + sx1) * 4;
    const i01 = (sy1 * srcW + sx0) * 4;
    const i11 = (sy1 * srcW + sx1) * 4;

    const w00 = (1 - dx) * (1 - dy);
    const w10 = dx * (1 - dy);
    const w01 = (1 - dx) * dy;
    const w11 = dx * dy;

    for (let ch = 0; ch < 3; ch++) {
      out[outIdx + ch] = Math.round(
        src[i00 + ch] * w00 + src[i10 + ch] * w10 +
        src[i01 + ch] * w01 + src[i11 + ch] * w11
      );
    }
    out[outIdx + 3] = 255;
  }

  function setBlack(out, idx) {
    out[idx] = 0; out[idx+1] = 0; out[idx+2] = 0; out[idx+3] = 255;
  }

  // ---- 1. ESCHER SPIRAL ----

  function computeEscherC(scaleFactor) {
    const lnS = Math.log(scaleFactor);
    const twoPi = 2 * Math.PI;
    const denom = lnS * lnS + twoPi * twoPi;
    return { re: -(twoPi * twoPi) / denom, im: (twoPi * lnS) / denom };
  }

  function renderEscher(srcData, srcW, srcH, outData, outW, outH, params) {
    const { scaleFactor, morph, zoom, extraRotation } = params;
    const src = srcData.data, out = outData.data;
    const lnS = Math.log(scaleFactor);
    const twoPi = 2 * Math.PI;

    const c = computeEscherC(scaleFactor);
    const cN = { re: 0, im: lnS / twoPi };
    const cU = { re: cN.re + morph * (c.re - cN.re), im: cN.im + morph * (c.im - cN.im) };
    const mag2 = cU.re * cU.re + cU.im * cU.im;
    if (mag2 < 1e-12) return;
    const ciR = cU.re / mag2, ciI = -cU.im / mag2;

    const cx = outW / 2, cy = outH / 2;
    const scale = Math.min(outW, outH) / 2 * zoom;
    const cosR = Math.cos(-extraRotation), sinR = Math.sin(-extraRotation);

    for (let py = 0; py < outH; py++) {
      for (let px = 0; px < outW; px++) {
        let x = (px - cx) / scale, y = (cy - py) / scale;
        if (extraRotation !== 0) {
          const xr = x * cosR - y * sinR, yr = x * sinR + y * cosR;
          x = xr; y = yr;
        }
        const r = Math.sqrt(x * x + y * y);
        const oi = (py * outW + px) * 4;
        if (r < 1e-8) { setBlack(out, oi); continue; }

        const lnR = Math.log(r), theta = Math.atan2(y, x);
        const u = lnR * ciR - theta * ciI;
        const v = lnR * ciI + theta * ciR;

        const imgX = ((u % lnS) + lnS) % lnS / lnS * srcW;
        const imgY = (1 - ((v % twoPi) + twoPi) % twoPi / twoPi) * srcH;
        sampleBilinear(src, srcW, srcH, imgX, imgY, out, oi);
      }
    }
  }

  // ---- 2. KALEIDOSCOPE ----

  function renderKaleidoscope(srcData, srcW, srcH, outData, outW, outH, params) {
    const { segments, rotation, zoom, offsetX, offsetY } = params;
    const src = srcData.data, out = outData.data;
    const cx = outW / 2, cy = outH / 2;
    const scale = Math.min(outW, outH) / 2 * zoom;
    const sliceAngle = 2 * Math.PI / segments;
    const rot = rotation * Math.PI / 180;

    for (let py = 0; py < outH; py++) {
      for (let px = 0; px < outW; px++) {
        let x = (px - cx) / scale;
        let y = (cy - py) / scale;

        // To polar
        let angle = Math.atan2(y, x) - rot;
        const r = Math.sqrt(x * x + y * y);

        // Fold into one slice
        angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let slice = angle / sliceAngle;
        let sliceIdx = Math.floor(slice);
        let localAngle = (slice - sliceIdx) * sliceAngle;

        // Mirror alternate slices
        if (sliceIdx % 2 === 1) {
          localAngle = sliceAngle - localAngle;
        }

        // Back to cartesian
        const sx = r * Math.cos(localAngle) + offsetX / 100;
        const sy = r * Math.sin(localAngle) + offsetY / 100;

        // Map to image coords
        const imgX = (sx * 0.5 + 0.5) * srcW;
        const imgY = (0.5 - sy * 0.5) * srcH;

        const oi = (py * outW + px) * 4;
        sampleBilinear(src, srcW, srcH, imgX, imgY, out, oi);
      }
    }
  }

  // ---- 3. CONFORMAL MAPS ----

  function renderConformal(srcData, srcW, srcH, outData, outW, outH, params) {
    const { func, powerRe, powerIm, zoom } = params;
    const src = srcData.data, out = outData.data;
    const cx = outW / 2, cy = outH / 2;
    const scale = Math.min(outW, outH) / 2 * zoom;

    for (let py = 0; py < outH; py++) {
      for (let px = 0; px < outW; px++) {
        const zx = (px - cx) / scale;
        const zy = (cy - py) / scale;
        const oi = (py * outW + px) * 4;

        let wx, wy;

        switch (func) {
          case 'power': {
            // z^c = exp(c * log(z))
            const r = Math.sqrt(zx * zx + zy * zy);
            if (r < 1e-8) { setBlack(out, oi); continue; }
            const lnR = Math.log(r), th = Math.atan2(zy, zx);
            // c * log(z) = (powerRe + i*powerIm) * (lnR + i*th)
            const resPart = powerRe * lnR - powerIm * th;
            const imPart = powerIm * lnR + powerRe * th;
            const eR = Math.exp(resPart);
            wx = eR * Math.cos(imPart);
            wy = eR * Math.sin(imPart);
            break;
          }
          case 'mobius': {
            // (z + 0.5) / (z - 0.5) — a standard Mobius transform
            const dx = zx - 0.5, dy = zy;
            const dMag2 = dx * dx + dy * dy;
            if (dMag2 < 1e-8) { setBlack(out, oi); continue; }
            const nx = zx + 0.5, ny = zy;
            wx = (nx * dx + ny * dy) / dMag2;
            wy = (ny * dx - nx * dy) / dMag2;
            break;
          }
          case 'inversion': {
            // 1/z = conj(z) / |z|^2
            const mag2 = zx * zx + zy * zy;
            if (mag2 < 1e-8) { setBlack(out, oi); continue; }
            wx = zx / mag2;
            wy = -zy / mag2;
            break;
          }
          case 'joukowski': {
            // z + 1/z
            const mag2 = zx * zx + zy * zy;
            if (mag2 < 1e-8) { setBlack(out, oi); continue; }
            wx = zx + zx / mag2;
            wy = zy - zy / mag2;
            break;
          }
          case 'sin': {
            // sin(z) = sin(x)cosh(y) + i*cos(x)sinh(y)
            wx = Math.sin(zx) * Math.cosh(zy);
            wy = Math.cos(zx) * Math.sinh(zy);
            break;
          }
          case 'exp': {
            // e^z = e^x * (cos(y) + i*sin(y))
            const eX = Math.exp(zx);
            wx = eX * Math.cos(zy);
            wy = eX * Math.sin(zy);
            break;
          }
          default:
            wx = zx; wy = zy;
        }

        // Map result to image coordinates
        const imgX = (wx * 0.25 + 0.5) * srcW;
        const imgY = (0.5 - wy * 0.25) * srcH;
        sampleBilinear(src, srcW, srcH, imgX, imgY, out, oi);
      }
    }
  }

  // ---- 4. HYPERBOLIC TILING (Poincare Disk) ----

  function renderHyperbolic(srcData, srcW, srcH, outData, outW, outH, params) {
    const { p, q, rotation, layers } = params;
    const src = srcData.data, out = outData.data;
    const cx = outW / 2, cy = outH / 2;
    const radius = Math.min(outW, outH) / 2 - 2;
    const rot = rotation * Math.PI / 180;

    // Precompute fundamental domain angle
    const angleP = Math.PI / p;
    const angleQ = Math.PI / q;
    const sliceAngle = 2 * Math.PI / p;

    // Max reflections for tiling depth
    const maxReflections = layers * p * 2;

    for (let py = 0; py < outH; py++) {
      for (let px = 0; px < outW; px++) {
        const oi = (py * outW + px) * 4;

        let x = (px - cx) / radius;
        let y = (cy - py) / radius;

        // Apply rotation
        if (rot !== 0) {
          const c = Math.cos(-rot), s = Math.sin(-rot);
          const xr = x * c - y * s, yr = x * s + y * c;
          x = xr; y = yr;
        }

        const distSq = x * x + y * y;
        if (distSq >= 1.0) {
          // Outside the disk — black
          setBlack(out, oi);
          continue;
        }

        // Reflect point into fundamental domain
        let reflections = 0;
        let inDomain = false;

        for (let iter = 0; iter < maxReflections; iter++) {
          let angle = Math.atan2(y, x);
          angle = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

          // Fold into first sector (angle 0..sliceAngle)
          let sector = Math.floor(angle / sliceAngle);
          let localAngle = angle - sector * sliceAngle;

          if (sector % 2 === 0 && sector > 0) {
            // Rotate back
            const a = -sector * sliceAngle;
            const c = Math.cos(a), s = Math.sin(a);
            const xr = x * c - y * s, yr = x * s + y * c;
            x = xr; y = yr;
            reflections++;
            continue;
          }

          // Mirror if in second half of slice
          if (localAngle > sliceAngle / 2) {
            const mirAngle = sector * sliceAngle + sliceAngle / 2;
            const nx = Math.cos(mirAngle), ny = Math.sin(mirAngle);
            const dot = x * nx + y * ny;
            x = x - 2 * dot * nx;
            y = y - 2 * dot * ny;
            reflections++;
            continue;
          }

          // Hyperbolic reflection across geodesic
          // Use a circle inversion for the inner edge of the fundamental domain
          const geodesicR = 1 / Math.cos(angleP);
          const geodesicCx = geodesicR;
          const geodesicCy = 0;

          const dx = x - geodesicCx;
          const dy = y - geodesicCy;
          const d2 = dx * dx + dy * dy;
          const invR2 = (geodesicR * geodesicR - 1);

          if (d2 < invR2 && d2 > 1e-10) {
            // Invert through the geodesic circle
            const ratio = invR2 / d2;
            x = geodesicCx + dx * ratio;
            y = geodesicCy + dy * ratio;
            reflections++;
            continue;
          }

          inDomain = true;
          break;
        }

        // Map the fundamental domain point to image coords
        const rr = Math.sqrt(x * x + y * y);
        const th = Math.atan2(y, x);

        // Use reflection count for color variation
        const tileShade = (reflections % 2 === 0) ? 1.0 : 0.85;

        const imgX = ((th / angleP) * 0.5 + 0.5) * srcW;
        const imgY = (1 - rr) * srcH;
        sampleBilinear(src, srcW, srcH, imgX, imgY, out, oi);

        // Apply tiling shade
        if (tileShade < 1.0) {
          out[oi] = Math.round(out[oi] * tileShade);
          out[oi+1] = Math.round(out[oi+1] * tileShade);
          out[oi+2] = Math.round(out[oi+2] * tileShade);
        }
      }
    }
  }

  // ---- 5. LOG SPACE (doubly periodic visualization) ----

  function renderLogSpace(srcData, srcW, srcH, outData, outW, outH, params) {
    const { scaleFactor, zoom, panX, panY } = params;
    const src = srcData.data, out = outData.data;
    const lnS = Math.log(scaleFactor);
    const twoPi = 2 * Math.PI;
    const cx = outW / 2, cy = outH / 2;
    const scale = Math.min(outW, outH) / (2 * Math.PI) * zoom;

    for (let py = 0; py < outH; py++) {
      for (let px = 0; px < outW; px++) {
        // Map pixel to log-space coordinates
        const u = (px - cx) / scale + panX / 50;
        const v = (cy - py) / scale + panY / 50;

        // Periodic tiling: u mod ln(s), v mod 2*pi
        const imgX = ((u % lnS) + lnS) % lnS / lnS * srcW;
        const imgY = (1 - ((v % twoPi) + twoPi) % twoPi / twoPi) * srcH;

        const oi = (py * outW + px) * 4;
        sampleBilinear(src, srcW, srcH, imgX, imgY, out, oi);
      }
    }
  }

  // ---- Async wrapper (chunks for UI responsiveness) ----

  function renderAsync(renderFn, srcData, srcW, srcH, outData, outW, outH, params, onComplete) {
    const ROWS = 16;
    let row = 0;

    // Create a temp full-size output, render in chunks
    const src = srcData.data;

    function chunk() {
      const end = Math.min(row + ROWS, outH);
      // Create a sub-view by rendering rows
      // For simplicity, just render synchronously in small chunks
      const tmpSrc = srcData;
      const tmpOut = outData;

      // We render the full thing but in row batches
      // To do this efficiently, we pass row range via params
      const p = Object.assign({}, params, { _rowStart: row, _rowEnd: end });

      // Just call the sync render for now — it's fast enough at 600px
      if (row === 0) {
        renderFn(srcData, srcW, srcH, outData, outW, outH, params);
        if (onComplete) onComplete(outData);
        return;
      }
    }

    chunk();
  }

  // ---- Public API ----

  return {
    escher: { render: renderEscher },
    kaleidoscope: { render: renderKaleidoscope },
    conformal: { render: renderConformal },
    hyperbolic: { render: renderHyperbolic },
    logspace: { render: renderLogSpace },
    renderAsync
  };
})();
