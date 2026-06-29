import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { updateValidatedSnapshot } from "../vite.config.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(dirname, "..", "..", "output");
const fileName = "__snapshot_update_test.json";
const filePath = path.join(outputDir, fileName);
const fields = [
  "EMSD.Common.Asset Code",
  "EMSD.Common.Asset Tag No.",
  "EMSD.Common.Manufacturer",
  "VSF.Common.Asset Code",
  "VSF.Common.Asset Tag No.",
  "VSF.Common.Manufacturer",
  "VSF.Location",
  "VSF.Link",
  "VSF.Status",
  "VSF.Document",
];

test("viewer edit persists ten fields and recalculates validation", () => {
  const blankValues = Object.fromEntries(fields.map((field) => [field, ""]));
  fs.writeFileSync(
    filePath,
    JSON.stringify({
      kind: "validated-digital-twin-snapshot",
      summary: {},
      assets: [
        { ifcGuid: "GUID-1", name: "FCU:1", operationalScope: "maintainable", normalizedProperties: blankValues },
        { ifcGuid: "GUID-2", name: "FCU:2", operationalScope: "maintainable", normalizedProperties: blankValues },
      ],
    }),
    "utf8",
  );

  try {
    const values = Object.fromEntries(fields.map((field) => [field, `value:${field}`]));
    const result = updateValidatedSnapshot(fileName, "GUID-1", values);
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));

    assert.equal(result.asset.readinessStatus, "Complete");
    assert.equal(result.summary.complete, 1);
    assert.equal(result.summary.incomplete, 1);
    assert.deepEqual(Object.keys(result.asset.normalizedProperties), fields);
    assert.equal(persisted.assets[0].fieldSources["VSF.Document"], "manual_viewer");
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});
