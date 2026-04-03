# Video Transcript: 3Blue1Brown - Escher's Print Gallery

Source: https://youtu.be/ldxFjLJ3rVY

## Summary

This is a 3Blue1Brown video about M.C. Escher's 1956 lithograph "The Print Gallery" (Prentententoonstelling).
It explains how the piece works mathematically, based on a 2003 analysis by mathematicians De Smit and Lenstra.

## Key Concepts

### The Droste Effect
- A self-similar image where the picture is contained inside itself
- Escher's version uses a scaling factor of 256x (the self-similar copy is 256 times smaller)
- Named after a cocoa company that featured it in branding

### Escher's 3-Step Process (Intuitive)
1. **Start with a Droste image** - A straightened-out self-similar image (man looking at picture containing harbor, town, gallery, same man, recursing forever)
2. **Create a warped grid** - A mesh where squares remain approximately square (conformal map) but scale by factor of 4 from corner to corner
3. **Use grid as mesh warp** - Copy each tiny square from original to corresponding warped grid square

### The Mathematical Approach (Complex Functions)
The transformation can be expressed as a complex function pipeline:

1. **Take the logarithm** - Maps circles to vertical lines, creating a doubly periodic tiling pattern
   - Periodic vertically because rotation is periodic (period 2π)
   - Periodic horizontally because Droste image repeats when you zoom (period ln(s))
   
2. **Rotate and scale** (multiply by complex constant c) - Realigns the tiling pattern so it repeats every 2π vertically
   - c = 2πi / (ln(s) - 2πi) where s is the scale factor
   - This rotation uses the diagonal periodicity of the log image
   
3. **Take the exponential** - Wraps everything back, but now with a twist/spiral
   - Walking around a loop in output = zooming in by factor s in the original

### Key Mathematical Properties
- **Conformal maps**: Functions where tiny squares remain approximately square (angles preserved)
- **Complex functions automatically give conformal maps** (as long as they have derivatives)
- The full transformation simplifies to: z → z^c (raising to a complex power)
- The doubly periodic pattern in log space relates to **elliptic functions** in number theory

### The Hole in the Middle
- Escher left a blank circle in the center of his Print Gallery
- The mathematical approach naturally fills this in with an infinitely spiraling self-similar pattern
- There is one "right" completion (the spiral continues inward forever)

### Parameters
- **Scale factor s**: How much the image shrinks in each self-similar copy (Escher used 256)
- **Complex constant c**: Determines the rotation/scaling in log space
  - For scale factor s: c = 2πi / (ln(s) - 2πi)
  - This ensures the rotated tiling repeats every 2π vertically

## Algorithm for Rendering (Inverse Mapping)

For each output pixel at position (x, y):
1. Treat as complex number z = x + iy
2. Compute log(z) = ln|z| + i·arg(z)
3. Divide by complex constant c (inverse of rotation/scaling step)
4. Result gives coordinates (u, v) in the original periodic log space
5. Use modular arithmetic: u mod ln(s) and v mod 2π to find position in fundamental tile
6. Map tile position to original image coordinates
7. Sample the original image at those coordinates

## App Requirements
- Upload an image
- Create Droste effect (nest image within itself at multiple scales)
- Apply the Escher spiral transformation (log → rotate/scale → exp)
- Animate/morph between original and transformed
- Interactive controls for scale factor, rotation, zoom
- Download result
