import { test } from "node:test";
import assert from "node:assert/strict";

import { captureScreenshots, playwrightAvailable, shouldCapture } from "./screenshots.mjs";
import { cleanup, makeTempRepo } from "./test-helpers.mjs";

test("screenshots are skipped gracefully when Playwright is absent", () => {
  const dir = makeTempRepo({ files: { "package.json": "{}" } });
  try {
    assert.equal(playwrightAvailable(dir), null);
    const result = captureScreenshots(dir, { url: "http://localhost:1", outDir: `${dir}/shots` });
    assert.equal(result.skipped, true);
    assert.deepEqual(result.files, []);
  } finally {
    cleanup(dir);
  }
});

test("capture setting", () => {
  assert.equal(shouldCapture({ preview: {} }), true);
  assert.equal(shouldCapture({ preview: { screenshots: false } }), false);
  assert.equal(shouldCapture({ preview: { screenshots: true } }), true);
});
