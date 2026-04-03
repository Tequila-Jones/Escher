/**
 * Minimal but correct GIF89a encoder.
 * Encodes a sequence of ImageData frames into an animated GIF blob.
 * Uses median-cut color quantization and proper LZW compression.
 */
const GIFEncoder = (() => {

  // ---- Simple color quantizer: uniform + nearest match ----
  function buildPalette(frames) {
    // Sample colors from all frames, build a 256-color palette
    // Use a 6x6x6 uniform color cube (216 colors) + fill remaining with frequent colors
    const palette = new Uint8Array(256 * 3);
    let idx = 0;
    for (let r = 0; r < 6; r++) {
      for (let g = 0; g < 6; g++) {
        for (let b = 0; b < 6; b++) {
          palette[idx++] = Math.round(r * 255 / 5);
          palette[idx++] = Math.round(g * 255 / 5);
          palette[idx++] = Math.round(b * 255 / 5);
        }
      }
    }
    // Fill remaining 40 slots with grays
    for (let i = 216; i < 256; i++) {
      const v = Math.round((i - 216) * 255 / 39);
      palette[idx++] = v;
      palette[idx++] = v;
      palette[idx++] = v;
    }
    return palette;
  }

  function findNearest(palette, r, g, b) {
    let bestDist = Infinity, bestIdx = 0;
    for (let i = 0; i < 256; i++) {
      const pr = palette[i * 3], pg = palette[i * 3 + 1], pb = palette[i * 3 + 2];
      const d = (pr - r) * (pr - r) + (pg - g) * (pg - g) + (pb - b) * (pb - b);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return bestIdx;
  }

  function indexFrame(pixels, palette, width, height) {
    const count = width * height;
    const indices = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const off = i * 4;
      indices[i] = findNearest(palette, pixels[off], pixels[off + 1], pixels[off + 2]);
    }
    return indices;
  }

  // ---- LZW Encoder (GIF-spec compliant) ----
  function lzwEncode(indices, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;

    const output = []; // bytes
    let buf = 0;       // bit buffer
    let bufLen = 0;    // bits in buffer

    function emit(code, codeSize) {
      buf |= code << bufLen;
      bufLen += codeSize;
      while (bufLen >= 8) {
        output.push(buf & 0xff);
        buf >>= 8;
        bufLen -= 8;
      }
    }

    function flush() {
      if (bufLen > 0) output.push(buf & 0xff);
      buf = 0;
      bufLen = 0;
    }

    // Initialize dictionary
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    let dictSize = 1 << codeSize;

    // Dictionary: maps (prefix_code, byte) -> code
    // Use a flat array for speed: key = prefix * 256 + byte
    let dict = new Int32Array(4096 * 256);
    function resetDict() {
      dict.fill(-1);
      for (let i = 0; i < clearCode; i++) {
        // Single-byte entries don't need dict, handled by initial code = byte value
      }
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      dictSize = 1 << codeSize;
    }

    // Use a more memory-efficient dictionary with a hash table
    let dictKeys, dictVals, dictCount;
    function resetDict2() {
      dictKeys = new Int32Array(5003).fill(-1);
      dictVals = new Int32Array(5003);
      dictCount = 0;
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
      dictSize = 1 << codeSize;
    }

    function dictLookup(prefix, byte) {
      const key = (prefix << 8) | byte;
      let idx = ((key * 2654435761) >>> 0) % dictKeys.length;
      while (true) {
        if (dictKeys[idx] === -1) return -1;
        if (dictKeys[idx] === key) return dictVals[idx];
        idx = (idx + 1) % dictKeys.length;
      }
    }

    function dictInsert(prefix, byte, code) {
      const key = (prefix << 8) | byte;
      let idx = ((key * 2654435761) >>> 0) % dictKeys.length;
      while (dictKeys[idx] !== -1) idx = (idx + 1) % dictKeys.length;
      dictKeys[idx] = key;
      dictVals[idx] = code;
      dictCount++;
    }

    resetDict2();
    emit(clearCode, codeSize);

    if (indices.length === 0) {
      emit(eoiCode, codeSize);
      flush();
      return output;
    }

    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const byte = indices[i];
      const found = dictLookup(prefix, byte);
      if (found !== -1) {
        prefix = found;
      } else {
        emit(prefix, codeSize);

        if (nextCode < 4096) {
          dictInsert(prefix, byte, nextCode);
          if (nextCode >= dictSize && codeSize < 12) {
            codeSize++;
            dictSize = 1 << codeSize;
          }
          nextCode++;
        } else {
          // Dictionary full, reset
          emit(clearCode, codeSize);
          resetDict2();
        }
        prefix = byte;
      }
    }

    emit(prefix, codeSize);
    emit(eoiCode, codeSize);
    flush();
    return output;
  }

  // ---- GIF file assembly ----
  function encode(frames, width, height, delay) {
    const bytes = [];
    function w8(v) { bytes.push(v & 0xff); }
    function w16(v) { bytes.push(v & 0xff); bytes.push((v >> 8) & 0xff); }
    function wStr(s) { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); }

    const palette = buildPalette(frames);

    // Header
    wStr('GIF89a');

    // Logical Screen Descriptor
    w16(width);
    w16(height);
    w8(0xf7); // GCT flag, 8 bits per channel, 256 colors
    w8(0);     // background color index
    w8(0);     // pixel aspect ratio

    // Global Color Table (256 * 3 bytes)
    for (let i = 0; i < 768; i++) w8(palette[i]);

    // Netscape Application Extension (looping)
    w8(0x21); w8(0xff); w8(11);
    wStr('NETSCAPE2.0');
    w8(3); w8(1); w16(0); // loop forever
    w8(0);

    // Frames
    for (let f = 0; f < frames.length; f++) {
      const indices = indexFrame(frames[f].data, palette, width, height);

      // Graphic Control Extension
      w8(0x21); w8(0xf9); w8(4);
      w8(0x00); // disposal: none, no transparency
      w16(delay);
      w8(0);    // transparent color index (unused)
      w8(0);    // block terminator

      // Image Descriptor
      w8(0x2c);
      w16(0); w16(0);       // left, top
      w16(width); w16(height);
      w8(0);                 // no local color table

      // LZW Minimum Code Size
      const minCodeSize = 8;
      w8(minCodeSize);

      // LZW compressed data
      const lzwData = lzwEncode(indices, minCodeSize);

      // Write as sub-blocks (max 255 bytes each)
      let pos = 0;
      while (pos < lzwData.length) {
        const chunkLen = Math.min(255, lzwData.length - pos);
        w8(chunkLen);
        for (let i = 0; i < chunkLen; i++) w8(lzwData[pos++]);
      }
      w8(0); // block terminator
    }

    // Trailer
    w8(0x3b);

    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  }

  return { encode };
})();
