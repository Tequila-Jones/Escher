/**
 * Minimal GIF encoder for browser use.
 * Encodes a sequence of ImageData frames into an animated GIF blob.
 *
 * Uses the NeuQuant algorithm for color quantization (256 colors)
 * and LZW compression per the GIF89a spec.
 */
const GIFEncoder = (() => {

  // ---- NeuQuant color quantizer (simplified) ----
  // Reduces 24-bit RGB to 256-color palette

  function quantize(pixels, sampleFactor) {
    const ncycles = 100;
    const netsize = 256;
    const maxnetpos = netsize - 1;
    const initrad = netsize >> 3;
    const radiusdec = 30;
    const alphadec = 30;
    const initBiasShift = 16;
    const initBias = 1 << initBiasShift;

    const network = [];
    const bias = new Int32Array(netsize);
    const freq = new Int32Array(netsize);

    for (let i = 0; i < netsize; i++) {
      const v = (i << 12) / netsize;
      network[i] = [v, v, v, 0];
      freq[i] = (initBias / netsize) | 0;
    }

    const lengthcount = pixels.length / 4;
    const samplePixels = (lengthcount / sampleFactor) | 0;
    let alphaVal = 30;
    let radius = initrad;
    let rad = radius >> 6;
    if (rad < 1) rad = 1;

    const step = Math.max(1, (lengthcount / samplePixels) | 0) * 4;

    let pos = 0;
    for (let i = 0; i < samplePixels; ) {
      const r = pixels[pos], g = pixels[pos + 1], b = pixels[pos + 2];
      // Find best matching neuron
      let bestd = 1e20, bestIdx = 0;
      for (let j = 0; j < netsize; j++) {
        const n = network[j];
        const dist = Math.abs(n[0] - r) + Math.abs(n[1] - g) + Math.abs(n[2] - b);
        if (dist < bestd) { bestd = dist; bestIdx = j; }
      }
      // Update neurons in neighborhood
      const lo = Math.max(0, bestIdx - rad);
      const hi = Math.min(netsize - 1, bestIdx + rad);
      const a = alphaVal / 30;
      for (let j = lo; j <= hi; j++) {
        const n = network[j];
        const influence = a * (1 - Math.abs(j - bestIdx) / (rad + 1));
        n[0] += influence * (r - n[0]);
        n[1] += influence * (g - n[1]);
        n[2] += influence * (b - n[2]);
      }

      pos += step;
      if (pos >= pixels.length) pos -= pixels.length;
      i++;

      if (i % (samplePixels / ncycles | 1) === 0) {
        alphaVal -= (alphaVal / alphadec) | 0;
        radius -= (radius / radiusdec) | 0;
        rad = radius >> 6;
        if (rad < 1) rad = 1;
      }
    }

    // Build palette
    const palette = new Uint8Array(netsize * 3);
    for (let i = 0; i < netsize; i++) {
      palette[i * 3] = Math.max(0, Math.min(255, Math.round(network[i][0])));
      palette[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(network[i][1])));
      palette[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(network[i][2])));
    }

    // Map function: find nearest palette entry
    function map(r, g, b) {
      let bestd = 1e20, bestIdx = 0;
      for (let i = 0; i < netsize; i++) {
        const dr = palette[i * 3] - r, dg = palette[i * 3 + 1] - g, db = palette[i * 3 + 2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestd) { bestd = d; bestIdx = i; }
      }
      return bestIdx;
    }

    return { palette, map };
  }

  // ---- LZW Encoder ----
  function lzwEncode(indexStream, minCodeSize) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;
    const maxCode = 4096;

    const output = [];
    let curByte = 0;
    let curBit = 0;

    function writeBits(code, size) {
      curByte |= (code << curBit);
      curBit += size;
      while (curBit >= 8) {
        output.push(curByte & 0xff);
        curByte >>= 8;
        curBit -= 8;
      }
    }

    // Use a simple object-based dictionary
    let table = {};
    function resetTable() {
      table = {};
      for (let i = 0; i < clearCode; i++) table[i] = i;
      nextCode = eoiCode + 1;
      codeSize = minCodeSize + 1;
    }

    resetTable();
    writeBits(clearCode, codeSize);

    let prefix = indexStream[0].toString();
    for (let i = 1; i < indexStream.length; i++) {
      const k = indexStream[i];
      const key = prefix + ',' + k;
      if (table[key] !== undefined) {
        prefix = key;
      } else {
        writeBits(table[prefix] !== undefined ? table[prefix] : parseInt(prefix), codeSize);
        if (nextCode < maxCode) {
          table[key] = nextCode++;
          if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
        } else {
          writeBits(clearCode, codeSize);
          resetTable();
        }
        prefix = k.toString();
      }
    }
    writeBits(table[prefix] !== undefined ? table[prefix] : parseInt(prefix), codeSize);
    writeBits(eoiCode, codeSize);
    if (curBit > 0) output.push(curByte & 0xff);

    return output;
  }

  // ---- GIF file builder ----
  function encode(frames, width, height, delay) {
    const buf = [];
    function writeStr(s) { for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i)); }
    function writeByte(b) { buf.push(b & 0xff); }
    function writeShort(v) { buf.push(v & 0xff); buf.push((v >> 8) & 0xff); }

    // Use first frame for global palette
    const firstPixels = frames[0].data;
    const q = quantize(firstPixels, 10);
    const palette = q.palette;

    // Header
    writeStr('GIF89a');
    writeShort(width);
    writeShort(height);
    writeByte(0xf7); // GCT flag, 256 colors (2^(7+1))
    writeByte(0);     // bg color
    writeByte(0);     // pixel aspect ratio

    // Global color table
    for (let i = 0; i < 256 * 3; i++) writeByte(palette[i]);

    // Netscape looping extension
    writeByte(0x21); // extension
    writeByte(0xff); // app extension
    writeByte(11);   // block size
    writeStr('NETSCAPE2.0');
    writeByte(3); writeByte(1);
    writeShort(0); // loop forever
    writeByte(0);

    // Frames
    for (let f = 0; f < frames.length; f++) {
      const pixels = frames[f].data;

      // Graphic control extension
      writeByte(0x21);
      writeByte(0xf9);
      writeByte(4);
      writeByte(0); // no transparency
      writeShort(delay); // delay in centiseconds
      writeByte(0); // transparent color
      writeByte(0);

      // Image descriptor
      writeByte(0x2c);
      writeShort(0); writeShort(0);
      writeShort(width); writeShort(height);
      writeByte(0); // no local color table

      // Index pixels
      const indexStream = new Uint8Array(width * height);
      for (let i = 0; i < width * height; i++) {
        const off = i * 4;
        indexStream[i] = q.map(pixels[off], pixels[off + 1], pixels[off + 2]);
      }

      // LZW encode
      const minCodeSize = 8;
      writeByte(minCodeSize);
      const lzwData = lzwEncode(indexStream, minCodeSize);

      // Write sub-blocks (max 255 bytes each)
      let pos = 0;
      while (pos < lzwData.length) {
        const chunkSize = Math.min(255, lzwData.length - pos);
        writeByte(chunkSize);
        for (let i = 0; i < chunkSize; i++) writeByte(lzwData[pos++]);
      }
      writeByte(0); // block terminator
    }

    writeByte(0x3b); // GIF trailer
    return new Blob([new Uint8Array(buf)], { type: 'image/gif' });
  }

  return { encode };
})();
