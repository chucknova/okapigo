/** The trip hub's small map: four tiles around the meeting point, pin in the middle half. */
import { describe, it, expect } from 'vitest';
import { tilesAround, tileUrl, whatsappUrl, TILE } from '../src/lib/map.js';

describe('tilesAround', () => {
  it('Tinubu Square at zoom 16: the tile it is on, and the pin inside the 2 × 2 square', () => {
    const { zoom, tiles, pinLeft, pinTop } = tilesAround(6.4541, 3.3893);
    expect(zoom).toBe(16);
    expect(tiles).toHaveLength(4);
    // The standard slippy-map tile for this point (x from longitude, y from latitude).
    const x = Math.floor(((3.3893 + 180) / 360) * 2 ** 16);
    expect(tiles.some((t) => t.x === x)).toBe(true);
    for (const p of [pinLeft, pinTop]) {
      expect(p).toBeGreaterThanOrEqual(TILE / 2);
      expect(p).toBeLessThanOrEqual(TILE * 1.5);
    }
  });

  it('keeps the pin away from the edges wherever it falls in a tile', () => {
    for (const lat of [6.40001, 6.4541, 6.49999]) {
      for (const lng of [3.30001, 3.3893, 3.39999]) {
        const { pinLeft, pinTop } = tilesAround(lat, lng);
        expect(pinLeft).toBeGreaterThanOrEqual(TILE / 2);
        expect(pinLeft).toBeLessThanOrEqual(TILE * 1.5);
        expect(pinTop).toBeGreaterThanOrEqual(TILE / 2);
        expect(pinTop).toBeLessThanOrEqual(TILE * 1.5);
      }
    }
  });

  it('builds the tile and WhatsApp addresses', () => {
    expect(tileUrl(16, 33384, 31592)).toBe('https://tile.openstreetmap.org/16/33384/31592.png');
    expect(whatsappUrl('+234 809 000 0123')).toBe('https://wa.me/2348090000123');
  });
});
