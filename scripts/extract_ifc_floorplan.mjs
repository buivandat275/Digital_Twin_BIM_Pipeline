import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IfcAPI,
  IFCAUDIOVISUALAPPLIANCE,
  IFCCURTAINWALL,
  IFCDOOR,
  IFCFAN,
  IFCFLOWMETER,
  IFCLIGHTFIXTURE,
  IFCMEMBER,
  IFCPLATE,
  IFCPUMP,
  IFCSENSOR,
  IFCSLAB,
  IFCUNITARYEQUIPMENT,
  IFCWALL,
} from "../digital-twin-viewer/node_modules/web-ifc/web-ifc-api-node.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const ifcPath = path.join(rootDir, "output", "20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc");
const assetPath = path.join(rootDir, "mock-db", "operations-assets.json");

const MODEL_TO_ASSET_SCALE = 1000;
const MAX_SHAPES_PER_LAYER = 180;
const KEEP_TYPES = new Set([
  IFCWALL,
  IFCCURTAINWALL,
  IFCDOOR,
  IFCSLAB,
  IFCMEMBER,
  IFCPLATE,
  IFCAUDIOVISUALAPPLIANCE,
  IFCLIGHTFIXTURE,
  IFCSENSOR,
  IFCFAN,
  IFCUNITARYEQUIPMENT,
  IFCPUMP,
  IFCFLOWMETER,
]);
const EQUIPMENT_TYPES = new Set([
  IFCAUDIOVISUALAPPLIANCE,
  IFCLIGHTFIXTURE,
  IFCSENSOR,
  IFCFAN,
  IFCUNITARYEQUIPMENT,
  IFCPUMP,
  IFCFLOWMETER,
]);

function layerForType(type) {
  if (type === IFCSLAB) return "slabs";
  if (type === IFCWALL || type === IFCCURTAINWALL || type === IFCMEMBER || type === IFCPLATE) return "walls";
  if (type === IFCDOOR) return "doors";
  if (EQUIPMENT_TYPES.has(type)) return "equipment";
  return "other";
}

function modelToAssetPlane(x, z) {
  return {
    x: Math.round(x * MODEL_TO_ASSET_SCALE),
    y: Math.round(-z * MODEL_TO_ASSET_SCALE),
  };
}

function bboxToPolygon(bbox) {
  const a = modelToAssetPlane(bbox.min[0], bbox.min[2]);
  const b = modelToAssetPlane(bbox.max[0], bbox.min[2]);
  const c = modelToAssetPlane(bbox.max[0], bbox.max[2]);
  const d = modelToAssetPlane(bbox.min[0], bbox.max[2]);
  return [a, b, c, d];
}

function bboxArea(bbox) {
  return Math.abs((bbox.max[0] - bbox.min[0]) * (bbox.max[2] - bbox.min[2]));
}

function overlapsAssetDemoZone(bbox, assetBounds) {
  const polygon = bboxToPolygon(bbox);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return maxX >= assetBounds.minX && minX <= assetBounds.maxX && maxY >= assetBounds.minY && minY <= assetBounds.maxY;
}

function meshBbox(api, modelId, mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let geometryIndex = 0; geometryIndex < mesh.geometries.size(); geometryIndex++) {
    const placedGeometry = mesh.geometries.get(geometryIndex);
    const matrix = placedGeometry.flatTransformation;
    const geometry = api.GetGeometry(modelId, placedGeometry.geometryExpressID);
    const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());

    for (let index = 0; index < vertices.length; index += 6) {
      const x = vertices[index];
      const y = vertices[index + 1];
      const z = vertices[index + 2];
      const point = [
        matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
        matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
        matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
      ];
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  return { min, max };
}

function simplifyLayer(shapes, maxShapes) {
  return shapes
    .sort((a, b) => b.area - a.area)
    .slice(0, maxShapes)
    .map(({ area, ...shape }) => shape);
}

const assets = JSON.parse(fs.readFileSync(assetPath, "utf8"));
const floorConfigs = [
  {
    floor: "Level 9",
    targetModelY: 39.4,
    outputPath: path.join(rootDir, "mock-db", "operations-floorplan-level-9.json"),
  },
  {
    floor: "Level 10",
    targetModelY: 42.8,
    outputPath: path.join(rootDir, "mock-db", "operations-floorplan-level-10.json"),
  },
];

function assetBoundsFor(floorAssets) {
  const assetXs = floorAssets.map((asset) => asset.position.x);
  const assetYs = floorAssets.map((asset) => asset.position.y);
  return {
    minX: Math.min(...assetXs) - 9000,
    maxX: Math.max(...assetXs) + 9000,
    minY: Math.min(...assetYs) - 5000,
    maxY: Math.max(...assetYs) + 14000,
  };
}

async function generateFloorplan(config) {
  const floorAssets = assets.filter((asset) => asset.floor === config.floor);
  if (!floorAssets.length) {
    console.log(`Skipped ${config.floor}: no assets in operations-assets.json`);
    return;
  }

  const api = new IfcAPI();
  await api.Init();
  const modelId = api.OpenModel(new Uint8Array(fs.readFileSync(ifcPath)));
  const layers = { slabs: [], walls: [], doors: [], equipment: [], other: [] };
  const seen = new Set();
  const assetBounds = assetBoundsFor(floorAssets);
  const floorAssetGlobalIds = new Set(floorAssets.map((asset) => asset.source_global_id).filter(Boolean));

  api.StreamAllMeshes(modelId, (mesh) => {
    if (seen.has(mesh.expressID)) return;
    seen.add(mesh.expressID);

    const line = api.GetLine(modelId, mesh.expressID);
    const type = line.type;
    if (!KEEP_TYPES.has(type)) return;

    const globalId = line.GlobalId?.value || "";
    const isFloorEquipment = EQUIPMENT_TYPES.has(type) && floorAssetGlobalIds.has(globalId);
    const bbox = meshBbox(api, modelId, mesh);
    const centerY = (bbox.min[1] + bbox.max[1]) / 2;
    const nearFloor = Math.abs(centerY - config.targetModelY) < 2.1;
    if (!nearFloor && !isFloorEquipment) return;

    if (!overlapsAssetDemoZone(bbox, assetBounds) && !isFloorEquipment) return;

    const area = bboxArea(bbox);
    if (area < 0.005) return;

    const layer = layerForType(type);
    layers[layer].push({
      id: mesh.expressID,
      name: line.Name?.value || "",
      ifc_class: line.constructor.name,
      global_id: globalId,
      polygon: bboxToPolygon(bbox),
      area,
    });
  });

  api.CloseModel(modelId);

  const allPoints = Object.values(layers)
    .flat()
    .flatMap((shape) => shape.polygon)
    .concat(floorAssets.map((asset) => ({ x: asset.position.x, y: asset.position.y })));

  const bounds = {
    minX: Math.min(...allPoints.map((point) => point.x)) - 600,
    maxX: Math.max(...allPoints.map((point) => point.x)) + 600,
    minY: Math.min(...allPoints.map((point) => point.y)) - 600,
    maxY: Math.max(...allPoints.map((point) => point.y)) + 600,
  };

  const floorplan = {
    source_ifc: path.basename(ifcPath),
    floor: config.floor,
    generated_at: new Date().toISOString(),
    coordinate_system: {
      unit: "mm",
      note: "2D floorplan is derived from IFC mesh bounding boxes projected top-down into the same x/y plane used by operations-assets.json.",
      model_to_asset_mapping: "asset.x = model.x * 1000; asset.y = -model.z * 1000",
    },
    bounds,
    layers: {
      slabs: simplifyLayer(layers.slabs, 12),
      walls: simplifyLayer(layers.walls, MAX_SHAPES_PER_LAYER),
      doors: simplifyLayer(layers.doors, 80),
      equipment: simplifyLayer(layers.equipment, 30),
      other: simplifyLayer(layers.other, 80),
    },
    stats: Object.fromEntries(Object.entries(layers).map(([key, value]) => [key, value.length])),
  };

  fs.writeFileSync(config.outputPath, JSON.stringify(floorplan, null, 2), "utf8");
  console.log(`Generated ${config.outputPath}`);
  console.log(floorplan.stats);
}

for (const config of floorConfigs) {
  await generateFloorplan(config);
}
