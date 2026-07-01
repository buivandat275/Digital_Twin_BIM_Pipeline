import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("APS Viewer uses modelId and PostgreSQL API", () => {
  const source = fs.readFileSync(path.join(root, "src", "aps", "ApsViewerApp.jsx"), "utf8");
  assert.match(source, /params\.get\("modelId"\)/);
  assert.match(source, /\/api\/v1\/models\//);
  assert.match(source, /\/change-requests\//);
  assert.doesNotMatch(source, /validated-snapshots/);
  assert.doesNotMatch(source, /bim-output/);
});

test("Vite proxies API and cannot mutate snapshots", () => {
  const source = fs.readFileSync(path.join(root, "vite.config.js"), "utf8");
  assert.match(source, /"\/api\/v1"/);
  assert.doesNotMatch(source, /writeFileSync/);
  assert.doesNotMatch(source, /updateValidatedSnapshot/);
});
