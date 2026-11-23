// @ts-check
/**
 * testing.js — plain pictures for other packages' tests (stage 19b-1), so they needn't depend
 * on sharp themselves. A different `shade` makes a different picture (a different stored file).
 */
import sharp from 'sharp';

/**
 * @param {{ width?: number, height?: number, format?: 'jpeg' | 'png' | 'webp', shade?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export function testPicture({ width = 900, height = 600, format = 'jpeg', shade = 0 } = {}) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (155 + shade * 17) % 256, g: 209, b: (15 + shade * 29) % 256 },
    },
  })
    .toFormat(format)
    .toBuffer();
}
