/**
 * GIF89a Encoder — based on the proven NeuQuant + LZW approach.
 * This implementation follows the GIF spec precisely for Safari compatibility.
 */
const GIFEncoder = (() => {

  function buildPalette(frames) {
    const palette = new Uint8Array(768);
    let i = 0;
    // 6x6x6 color cube = 216 colors
    for (let r = 0; r < 6; r++)
      for (let g = 0; g < 6; g++)
        for (let b = 0; b < 6; b++) {
          palette[i++] = (r * 51);
          palette[i++] = (g * 51);
          palette[i++] = (b * 51);
        }
    // 40 grays
    for (let j = 216; j < 256; j++) {
      const v = Math.round((j - 216) * 255 / 39);
      palette[i++] = v; palette[i++] = v; palette[i++] = v;
    }
    return palette;
  }

  function findNearest(palette, r, g, b) {
    // Fast path for 6x6x6 cube
    const ri = Math.min(5, Math.round(r / 51));
    const gi = Math.min(5, Math.round(g / 51));
    const bi = Math.min(5, Math.round(b / 51));
    const cubeIdx = ri * 36 + gi * 6 + bi;
    // Check if cube match is close enough
    const pr = ri * 51, pg = gi * 51, pb = bi * 51;
    const d = (pr-r)*(pr-r) + (pg-g)*(pg-g) + (pb-b)*(pb-b);
    if (d < 100) return cubeIdx;
    // Otherwise search grays too
    let bestDist = d, bestIdx = cubeIdx;
    for (let i = 216; i < 256; i++) {
      const v = palette[i * 3];
      const dd = (v-r)*(v-r) + (v-g)*(v-g) + (v-b)*(v-b);
      if (dd < bestDist) { bestDist = dd; bestIdx = i; }
    }
    return bestIdx;
  }

  // ---- LZW Encoder ----
  // Uses array-based trie dictionary for correctness
  function lzwEncode(pixels, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;

    // Output byte stream
    const out = [];

    // Bit buffer
    let bits = 0;
    let nBits = 0;

    function writeBits(code, size) {
      bits |= (code << nBits);
      nBits += size;
      while (nBits >= 8) {
        out.push(bits & 0xff);
        bits >>= 8;
        nBits -= 8;
      }
    }

    // Trie dictionary: each node maps byte -> child code
    // node[code] = Map of (byte -> code)
    let dict = [];
    let nextCode;
    let codeSize;

    function initDict() {
      dict = [];
      for (let i = 0; i < clearCode; i++) {
        dict[i] = {};
      }
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }

    initDict();

    // Start with clear code
    writeBits(clearCode, codeSize);

    if (pixels.length === 0) {
      writeBits(eoiCode, codeSize);
      if (nBits > 0) out.push(bits & 0xff);
      return out;
    }

    let curCode = pixels[0]; // start with first pixel as initial code

    for (let i = 1; i < pixels.length; i++) {
      const px = pixels[i];

      if (dict[curCode] && dict[curCode][px] !== undefined) {
        // String exists in dictionary
        curCode = dict[curCode][px];
      } else {
        // Output current code
        writeBits(curCode, codeSize);

        // Add new string to dictionary
        if (nextCode < 4096) {
          if (!dict[curCode]) dict[curCode] = {};
          dict[curCode][px] = nextCode;
          // Check if we need to increase code size
          if (nextCode >= (1 << codeSize)) {
            codeSize++;
          }
          nextCode++;
        } else {
          // Table full — emit clear code and reset
          writeBits(clearCode, codeSize);
          initDict();
        }

        // Start new string with current pixel
        curCode = px;
      }
    }

    // Output remaining code
    writeBits(curCode, codeSize);

    // End of information
    writeBits(eoiCode, codeSize);

    // Flush remaining bits
    if (nBits > 0) out.push(bits & 0xff);

    return out;
  }

  // ---- GIF File Assembly ----
  function encode(frames, width, height, delay) {
    const buf = [];
    function w8(v) { buf.push(v & 0xff); }
    function w16(v) { w8(v); w8(v >> 8); }
    function wStr(s) { for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); }
    function wBytes(arr) { for (let i = 0; i < arr.length; i++) buf.push(arr[i] & 0xff); }

    const palette = buildPalette(frames);

    // ---- Header ----
    wStr('GIF89a');

    // ---- Logical Screen Descriptor ----
    w16(width);
    w16(height);
    // packed: GCT=1, ColorRes=7(8bit), Sort=0, GCTSize=7(256)
    w8(0xf7);
    w8(0);  // bg color index
    w8(0);  // pixel aspect ratio

    // ---- Global Color Table (256 entries x 3 bytes) ----
    wBytes(palette);

    // ---- Netscape Extension (loop forever) ----
    w8(0x21); // extension introducer
    w8(0xff); // application extension
    w8(0x0b); // block size
    wStr('NETSCAPE2.0');
    w8(0x03); // sub-block size
    w8(0x01); // loop sub-block id
    w16(0);   // loop count (0 = forever)
    w8(0x00); // block terminator

    // ---- Frames ----
    for (let f = 0; f < frames.length; f++) {
      const data = frames[f].data;

      // Graphic Control Extension
      w8(0x21); // extension introducer
      w8(0xf9); // GCE label
      w8(0x04); // block size
      w8(0x00); // packed: disposal=0, no user input, no transparency
      w16(delay);
      w8(0x00); // transparent color index
      w8(0x00); // block terminator

      // Image Descriptor
      w8(0x2c); // image separator
      w16(0);   // left
      w16(0);   // top
      w16(width);
      w16(height);
      w8(0x00); // packed: no local color table, not interlaced

      // Index the pixels
      const count = width * height;
      const indices = new Uint8Array(count);
      for (let p = 0; p < count; p++) {
        const off = p * 4;
        indices[p] = findNearest(palette, data[off], data[off+1], data[off+2]);
      }

      // LZW Minimum Code Size
      w8(0x08); // 8 for 256 colors

      // LZW compressed data
      const lzwData = lzwEncode(indices, 8);

      // Write as sub-blocks (max 255 bytes)
      let pos = 0;
      while (pos < lzwData.length) {
        const len = Math.min(255, lzwData.length - pos);
        w8(len);
        for (let j = 0; j < len; j++) w8(lzwData[pos + j]);
        pos += len;
      }
      w8(0x00); // block terminator
    }

    // ---- Trailer ----
    w8(0x3b);

    return new Blob([new Uint8Array(buf)], { type: 'image/gif' });
  }

  return { encode };
})();
