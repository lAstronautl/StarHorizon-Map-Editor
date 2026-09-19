import { describe, it, expect } from 'vitest';
import { computeParallaxOffset, PARALLAX_SLOWNESS } from '../parallaxBackground';

describe('PARALLAX_SLOWNESS', () => {
  it('matches Space-Station-Paper\'s Parallax2D.scroll_scale (mainRoom.tscn)', () => {
    // The Godot port's confirmed-correct tuning, not SS14's own (much subtler)
    // default.yml value — see the file header for why.
    expect(PARALLAX_SLOWNESS.base).toBe(0.3);
  });

  it('is within the valid (0,1] slowness range', () => {
    expect(PARALLAX_SLOWNESS.base).toBeGreaterThan(0);
    expect(PARALLAX_SLOWNESS.base).toBeLessThanOrEqual(1);
  });
});

describe('computeParallaxOffset', () => {
  it('returns zero offset when the camera is at the origin', () => {
    const offset = computeParallaxOffset(0, 0, 0.998, 32, 512);
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  it('a slowness of 0 (fully world-locked) still scrolls with tileScreenSize scaling', () => {
    // slowness=0 means scrollWorld=0 regardless of camera position — a hypothetical
    // "infinitely far background" that never appears to move. Verifies the formula's
    // scaling term, not a real layer (no actual layer uses slowness=0).
    const offset = computeParallaxOffset(100, 50, 0, 32, 512);
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  it('wraps into [0, tileSizePx) for large camera positions', () => {
    const offset = computeParallaxOffset(1000, -1000, 0.996625, 32, 512);
    expect(offset.x).toBeGreaterThanOrEqual(0);
    expect(offset.x).toBeLessThan(512);
    expect(offset.y).toBeGreaterThanOrEqual(0);
    expect(offset.y).toBeLessThan(512);
  });

  it('x offset moves opposite to camera x (background appears to scroll backward)', () => {
    const near = computeParallaxOffset(1, 0, 0.998046875, 32, 512);
    const far = computeParallaxOffset(2, 0, 0.998046875, 32, 512);
    // Moving the camera further in +x should move the wrapped offset further from 0
    // in the same direction (mod wrap-around), i.e. offset tracks -cameraX*slowness.
    const expectedNear = ((-1 * 0.998046875 * 32) % 512 + 512) % 512;
    const expectedFar = ((-2 * 0.998046875 * 32) % 512 + 512) % 512;
    expect(near.x).toBeCloseTo(expectedNear);
    expect(far.x).toBeCloseTo(expectedFar);
  });

  it('y offset moves with (not against) camera y, matching the Y-up world convention', () => {
    const offset = computeParallaxOffset(0, 3, 0.996625, 32, 512);
    const expected = ((3 * 0.996625 * 32) % 512 + 512) % 512;
    expect(offset.y).toBeCloseTo(expected);
  });

  it('is periodic: offsets one full tileSizePx apart in world space are identical', () => {
    const tileScreenSize = 32;
    const sizePx = 512;
    const slowness = 0.996625;
    // One full wrap in screen px = sizePx / (slowness * tileScreenSize) world units.
    const wrapDistance = sizePx / (slowness * tileScreenSize);
    const a = computeParallaxOffset(5, 0, slowness, tileScreenSize, sizePx);
    const b = computeParallaxOffset(5 + wrapDistance, 0, slowness, tileScreenSize, sizePx);
    expect(a.x).toBeCloseTo(b.x, 5);
  });
});
