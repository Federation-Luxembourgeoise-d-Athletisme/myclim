import test from "node:test";
import assert from "node:assert/strict";

import { computeLogoSize } from "../src/site/sponsor-media-utils.js";
import { findLogoContentBounds } from "../src/app/logo-trim.js";

const homeBox = { boxWidth: 180, boxHeight: 58 };

test("computeLogoSize gives square and wide logos a similar visual area", () => {
  // Website box and a two-column links-page cell on a phone.
  for (const box of [homeBox, { boxWidth: 134, boxHeight: 48 }]) {
    const square = computeLogoSize({ ...box, ratio: 1 });
    const wide = computeLogoSize({ ...box, ratio: 3.5 });
    const squareArea = square.width * square.height;
    const wideArea = wide.width * wide.height;

    // Wide logos get slightly more area, never less, and never much more.
    assert.ok(wideArea >= squareArea * 0.95 && wideArea <= squareArea * 1.4, `${squareArea} vs ${wideArea}`);
    assert.ok(wide.width > square.width);
    assert.ok(wide.height < square.height);
  }
});

test("computeLogoSize keeps very wide and very tall logos inside the box", () => {
  for (const ratio of [0.3, 1, 8.3]) {
    const size = computeLogoSize({ ...homeBox, ratio, scale: 200 });
    assert.ok(size.width <= 180 * 0.95 + 1, `width ${size.width} for ratio ${ratio}`);
    assert.ok(size.height <= 58 * 0.9 + 1, `height ${size.height} for ratio ${ratio}`);
  }
});

test("computeLogoSize applies the manual zoom as a fine adjustment", () => {
  const normal = computeLogoSize({ ...homeBox, ratio: 3 });
  const smaller = computeLogoSize({ ...homeBox, ratio: 3, scale: 80 });
  assert.ok(smaller.width < normal.width);
  assert.equal(computeLogoSize({ boxWidth: 0, boxHeight: 58, ratio: 3 }), null);
  assert.equal(computeLogoSize({ ...homeBox, ratio: 0 }), null);
});

function makeImage(width, height, background, content) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= content.x && x < content.x + content.width && y >= content.y && y < content.y + content.height;
      data.set(inside ? [20, 40, 200, 255] : background, (y * width + x) * 4);
    }
  }
  return data;
}

test("findLogoContentBounds trims a transparent border", () => {
  const content = { x: 10, y: 4, width: 30, height: 12 };
  const data = makeImage(50, 20, [0, 0, 0, 0], content);
  assert.deepEqual(findLogoContentBounds(data, 50, 20), content);
});

test("findLogoContentBounds trims a white border", () => {
  const content = { x: 5, y: 5, width: 10, height: 6 };
  const data = makeImage(30, 20, [255, 255, 255, 255], content);
  assert.deepEqual(findLogoContentBounds(data, 30, 20), content);
});

test("findLogoContentBounds leaves logos on a coloured background alone", () => {
  const data = makeImage(30, 20, [0, 90, 170, 255], { x: 5, y: 5, width: 10, height: 6 });
  assert.equal(findLogoContentBounds(data, 30, 20), null);
});
