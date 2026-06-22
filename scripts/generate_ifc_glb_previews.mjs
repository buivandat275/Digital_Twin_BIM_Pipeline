import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "../digital-twin-viewer/node_modules/three/build/three.module.js";
import { GLTFExporter } from "../digital-twin-viewer/node_modules/three/examples/jsm/exporters/GLTFExporter.js";
import { IfcAPI } from "../digital-twin-viewer/node_modules/web-ifc/web-ifc-api-node.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const siteLayoutPath = path.join(rootDir, "mock-db", "site-layout.json");
const outputDir = path.join(rootDir, "digital-twin-viewer", "public", "model-previews");

const MATERIAL_ALPHA_THRESHOLD = 0.08;

class NodeFileReader {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }

  readAsDataURL(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        this.result = `data:${blob.type || "application/octet-stream"};base64,${base64}`;
        this.onloadend?.();
      })
      .catch((error) => this.onerror?.(error));
  }
}

globalThis.FileReader = globalThis.FileReader || NodeFileReader;

function slugify(filename) {
  return path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function materialKey(color) {
  const r = Math.round((color?.x ?? 0.72) * 255);
  const g = Math.round((color?.y ?? 0.76) * 255);
  const b = Math.round((color?.z ?? 0.78) * 255);
  const a = Math.max(MATERIAL_ALPHA_THRESHOLD, color?.w ?? 1);
  return `${r},${g},${b},${Math.round(a * 100)}`;
}

function makeMaterial(key) {
  const [r, g, b, alpha] = key.split(",").map(Number);
  const opacity = Math.max(MATERIAL_ALPHA_THRESHOLD, alpha / 100);
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(r / 255, g / 255, b / 255),
    roughness: 0.72,
    metalness: 0.04,
    transparent: opacity < 0.98,
    opacity,
    side: THREE.DoubleSide,
  });
}

function pushGeometry(target, api, modelId, placedGeometry) {
  const geometry = api.GetGeometry(modelId, placedGeometry.geometryExpressID);
  const vertices = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
  const indices = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
  const matrix = new THREE.Matrix4().fromArray(placedGeometry.flatTransformation);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const baseIndex = target.positions.length / 3;

  for (let index = 0; index < vertices.length; index += 6) {
    const position = new THREE.Vector3(vertices[index], vertices[index + 1], vertices[index + 2]).applyMatrix4(matrix);
    const normal = new THREE.Vector3(vertices[index + 3], vertices[index + 4], vertices[index + 5])
      .applyMatrix3(normalMatrix)
      .normalize();
    target.positions.push(position.x, position.y, position.z);
    target.normals.push(normal.x, normal.y, normal.z);
  }

  for (let index = 0; index < indices.length; index++) {
    target.indices.push(baseIndex + indices[index]);
  }

  geometry.delete?.();
}

function createPreviewScene(materialGroups, sourceName) {
  const scene = new THREE.Scene();
  scene.name = `${sourceName} preview`;

  for (const [key, target] of materialGroups.entries()) {
    if (!target.indices.length || !target.positions.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(target.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(target.normals, 3));
    geometry.setIndex(target.indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, makeMaterial(key));
    mesh.name = `${sourceName}_${key}`;
    scene.add(mesh);
  }

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);
  scene.updateMatrixWorld(true);
  return scene;
}

async function exportGlb(scene, outputPath) {
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(scene, {
    binary: true,
    includeCustomExtensions: false,
    trs: false,
  });
  fs.writeFileSync(outputPath, Buffer.from(glb));
}

async function convertIfc(api, building) {
  const inputPath = path.join(rootDir, "output", building.ifc_file);
  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipped ${building.ifc_file}: file not found`);
    return null;
  }

  const outputName = `${slugify(building.ifc_file)}.glb`;
  const outputPath = path.join(outputDir, outputName);
  const modelId = api.OpenModel(new Uint8Array(fs.readFileSync(inputPath)));
  const materialGroups = new Map();
  let meshCount = 0;
  let geometryCount = 0;

  api.StreamAllMeshes(modelId, (mesh) => {
    meshCount += 1;
    for (let index = 0; index < mesh.geometries.size(); index++) {
      const placedGeometry = mesh.geometries.get(index);
      const key = materialKey(placedGeometry.color);
      if (!materialGroups.has(key)) {
        materialGroups.set(key, { positions: [], normals: [], indices: [] });
      }
      pushGeometry(materialGroups.get(key), api, modelId, placedGeometry);
      geometryCount += 1;
    }
  });

  api.CloseModel(modelId);
  const scene = createPreviewScene(materialGroups, building.building_id);
  await exportGlb(scene, outputPath);
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose?.());
    else object.material?.dispose?.();
  });

  const sizeMb = fs.statSync(outputPath).size / 1024 / 1024;
  console.log(`Generated ${path.relative(rootDir, outputPath)} (${sizeMb.toFixed(2)} MB, ${meshCount} meshes, ${geometryCount} geometries)`);
  return `/model-previews/${outputName}`;
}

async function main() {
  const siteLayout = JSON.parse(fs.readFileSync(siteLayoutPath, "utf8"));
  fs.mkdirSync(outputDir, { recursive: true });

  const api = new IfcAPI();
  await api.Init();

  for (const building of siteLayout.buildings || []) {
    const previewGlb = await convertIfc(api, building);
    if (previewGlb) building.preview_glb = previewGlb;
  }

  fs.writeFileSync(siteLayoutPath, `${JSON.stringify(siteLayout, null, 2)}\n`, "utf8");
  console.log(`Updated ${path.relative(rootDir, siteLayoutPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
