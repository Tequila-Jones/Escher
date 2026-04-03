/**
 * Escher Print Gallery Transformation Engine
 *
 * Implements the De Smit & Lenstra approach:
 *   1. Complex logarithm (circles -> lines, creates doubly periodic pattern)
 *   2. Multiply by complex constant c (rotate/scale in log space)
 *   3. Complex exponential (lines -> circles, with twist)
 *
 * For rendering we use the INVERSE mapping: for each output pixel,
 * find where it came from in the source image.
 */

const EscherTransform = (() => {
  /**
   * Compute the complex constant c for a given scale factor s.
   * c = 2*pi*i / (ln(s) - 2*pi*i)
   *
   * Returns {re, im} components.
   */
  function computeC(scaleFactor) {
    const lnS = Math.log(scaleFactor);
    const twoPi = 2 * Math.PI;
    // c = 2*pi*i / (lnS - 2*pi*i)
    // Multiply numerator and denominator by conjugate of denominator:
    // = 2*pi*i * (lnS + 2*pi*i) / (lnS^2 + 4*pi^2)
    // = (2*pi*lnS*i + 2*pi*2*pi*i^2) / denom
    // = (-4*pi^2 + 2*pi*lnS*i) / denom
    const denom = lnS * lnS + twoPi * twoPi;
    return {
      re: -(twoPi * twoPi) / denom,
      im: (twoPi * lnS) / denom
    };
  }

  /**
   * Render the Escher spiral transformation.
   *
   * @param {ImageData} srcData - Source image pixel data
   * @param {number} srcW - Source image width
   * @param {number} srcH - Source image height
   * @param {ImageData} outData - Output image pixel data to write into
   * @param {number} outW - Output canvas width
   * @param {number} outH - Output canvas height
   * @param {object} params - Transformation parameters
   * @param {number} params.scaleFactor - Droste scale factor (e.g. 64)
   * @param {number} params.morph - Morph amount 0..1 (0 = Droste, 1 = full Escher spiral)
   * @param {number} params.zoom - Zoom level (1.0 = default)
   * @param {number} params.extraRotation - Additional rotation in radians
   */
  function render(srcData, srcW, srcH, outData, outW, outH, params) {
    const { scaleFactor, morph, zoom, extraRotation } = params;

    const src = srcData.data;
    const out = outData.data;

    const lnS = Math.log(scaleFactor);
    const twoPi = 2 * Math.PI;

    // Compute the complex constant c
    const c = computeC(scaleFactor);

    // For morph interpolation: lerp between identity-like mapping and full c
    // At morph=0, we show the Droste image in polar/log form
    // At morph=1, we show the full Escher spiral
    // We interpolate c from a "neutral" value to the real value
    // Neutral = pure imaginary (no spiral, just circular Droste)
    const cNeutral = { re: 0, im: lnS / twoPi };
    const cUsed = {
      re: cNeutral.re + morph * (c.re - cNeutral.re),
      im: cNeutral.im + morph * (c.im - cNeutral.im)
    };

    // Apply extra rotation: multiply c by e^(i*extraRotation)
    // But we only want extra rotation on the final result, so we
    // add it as a phase shift after the main transform.

    // Precompute inverse of cUsed for the inverse mapping
    // 1/c = conj(c) / |c|^2
    const cMag2 = cUsed.re * cUsed.re + cUsed.im * cUsed.im;
    if (cMag2 < 1e-12) return; // degenerate
    const cInvRe = cUsed.re / cMag2;
    const cInvIm = -cUsed.im / cMag2;

    // Center of output
    const cx = outW / 2;
    const cy = outH / 2;

    // Scale: map canvas to complex plane
    const baseScale = Math.min(outW, outH) / 2;
    const scale = baseScale * zoom;

    for (let py = 0; py < outH; py++) {
      for (let px = 0; px < outW; px++) {
        // Map pixel to complex number z
        let x = (px - cx) / scale;
        let y = (cy - py) / scale; // flip y for math convention

        // Apply extra rotation to the sampling point (inverse = negative rotation)
        if (extraRotation !== 0) {
          const cosR = Math.cos(-extraRotation);
          const sinR = Math.sin(-extraRotation);
          const xr = x * cosR - y * sinR;
          const yr = x * sinR + y * cosR;
          x = xr;
          y = yr;
        }

        // Distance from origin
        const r = Math.sqrt(x * x + y * y);

        const outIdx = (py * outW + px) * 4;

        if (r < 1e-8) {
          // At the origin singularity, draw black
          out[outIdx] = 0;
          out[outIdx + 1] = 0;
          out[outIdx + 2] = 0;
          out[outIdx + 3] = 255;
          continue;
        }

        // Step 1: Complex log
        // log(z) = ln(r) + i*theta
        const lnR = Math.log(r);
        const theta = Math.atan2(y, x);

        // Step 2: Divide by c (inverse of multiply by c)
        // (lnR + i*theta) * (cInvRe + i*cInvIm)
        const u = lnR * cInvRe - theta * cInvIm;
        const v = lnR * cInvIm + theta * cInvRe;

        // Step 3: Map (u, v) to source image coordinates
        // u is periodic with period ln(s) (horizontal Droste repetition)
        // v is periodic with period 2*pi (vertical/angular repetition)

        // Normalize to [0, 1) within one tile
        let imgX = ((u % lnS) + lnS) % lnS / lnS;
        let imgY = ((v % twoPi) + twoPi) % twoPi / twoPi;

        // Map to source pixel coordinates
        let sx = imgX * srcW;
        let sy = (1 - imgY) * srcH; // flip to match image convention

        // Bilinear interpolation
        const sx0 = Math.floor(sx);
        const sy0 = Math.floor(sy);
        const sx1 = (sx0 + 1) % srcW;
        const sy1 = Math.min(sy0 + 1, srcH - 1);
        const fx = sx - sx0;
        const fy = sy - sy0;

        const srcIdx00 = (sy0 * srcW + sx0) * 4;
        const srcIdx10 = (sy0 * srcW + sx1) * 4;
        const srcIdx01 = (sy1 * srcW + sx0) * 4;
        const srcIdx11 = (sy1 * srcW + sx1) * 4;

        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        for (let ch = 0; ch < 3; ch++) {
          out[outIdx + ch] = Math.round(
            src[srcIdx00 + ch] * w00 +
            src[srcIdx10 + ch] * w10 +
            src[srcIdx01 + ch] * w01 +
            src[srcIdx11 + ch] * w11
          );
        }
        out[outIdx + 3] = 255;
      }
    }
  }

  /**
   * Render in chunks using requestAnimationFrame for responsiveness.
   * Calls onProgress(fraction) and onComplete(outData) callbacks.
   */
  function renderAsync(srcData, srcW, srcH, outData, outW, outH, params, onProgress, onComplete) {
    const ROWS_PER_CHUNK = 8;
    let currentRow = 0;

    const src = srcData.data;
    const out = outData.data;

    const { scaleFactor, morph, zoom, extraRotation } = params;
    const lnS = Math.log(scaleFactor);
    const twoPi = 2 * Math.PI;

    const c = computeC(scaleFactor);
    const cNeutral = { re: 0, im: lnS / twoPi };
    const cUsed = {
      re: cNeutral.re + morph * (c.re - cNeutral.re),
      im: cNeutral.im + morph * (c.im - cNeutral.im)
    };

    const cMag2 = cUsed.re * cUsed.re + cUsed.im * cUsed.im;
    if (cMag2 < 1e-12) { onComplete(outData); return; }
    const cInvRe = cUsed.re / cMag2;
    const cInvIm = -cUsed.im / cMag2;

    const cx = outW / 2;
    const cy = outH / 2;
    const baseScale = Math.min(outW, outH) / 2;
    const scale = baseScale * zoom;

    function processChunk() {
      const endRow = Math.min(currentRow + ROWS_PER_CHUNK, outH);

      for (let py = currentRow; py < endRow; py++) {
        for (let px = 0; px < outW; px++) {
          let x = (px - cx) / scale;
          let y = (cy - py) / scale;

          if (extraRotation !== 0) {
            const cosR = Math.cos(-extraRotation);
            const sinR = Math.sin(-extraRotation);
            const xr = x * cosR - y * sinR;
            const yr = x * sinR + y * cosR;
            x = xr;
            y = yr;
          }

          const r = Math.sqrt(x * x + y * y);
          const outIdx = (py * outW + px) * 4;

          if (r < 1e-8) {
            out[outIdx] = 0;
            out[outIdx + 1] = 0;
            out[outIdx + 2] = 0;
            out[outIdx + 3] = 255;
            continue;
          }

          const lnR = Math.log(r);
          const theta = Math.atan2(y, x);

          const u = lnR * cInvRe - theta * cInvIm;
          const v = lnR * cInvIm + theta * cInvRe;

          let imgX = ((u % lnS) + lnS) % lnS / lnS;
          let imgY = ((v % twoPi) + twoPi) % twoPi / twoPi;

          let sx = imgX * srcW;
          let sy = (1 - imgY) * srcH;

          const sx0 = Math.floor(sx);
          const sy0 = Math.floor(sy);
          const sx1 = (sx0 + 1) % srcW;
          const sy1 = Math.min(sy0 + 1, srcH - 1);
          const fx = sx - sx0;
          const fy = sy - sy0;

          const srcIdx00 = (sy0 * srcW + sx0) * 4;
          const srcIdx10 = (sy0 * srcW + sx1) * 4;
          const srcIdx01 = (sy1 * srcW + sx0) * 4;
          const srcIdx11 = (sy1 * srcW + sx1) * 4;

          const w00 = (1 - fx) * (1 - fy);
          const w10 = fx * (1 - fy);
          const w01 = (1 - fx) * fy;
          const w11 = fx * fy;

          for (let ch = 0; ch < 3; ch++) {
            out[outIdx + ch] = Math.round(
              src[srcIdx00 + ch] * w00 +
              src[srcIdx10 + ch] * w10 +
              src[srcIdx01 + ch] * w01 +
              src[srcIdx11 + ch] * w11
            );
          }
          out[outIdx + 3] = 255;
        }
      }

      currentRow = endRow;
      if (onProgress) onProgress(currentRow / outH);

      if (currentRow < outH) {
        requestAnimationFrame(processChunk);
      } else {
        if (onComplete) onComplete(outData);
      }
    }

    requestAnimationFrame(processChunk);
  }

  return { render, renderAsync, computeC };
})();
