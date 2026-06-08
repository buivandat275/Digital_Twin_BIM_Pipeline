import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "output");
const mockDbDir = path.join(projectRoot, "mock-db");
const webIfcDir = path.join(__dirname, "node_modules", "web-ifc");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => extensions.includes(path.extname(name).toLowerCase()))
    .map((name) => {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function sendJson(res, payload) {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function safeFilePath(baseDir, requestedName) {
  const resolved = path.resolve(baseDir, requestedName);
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

function digitalTwinApi() {
  return {
    name: "digital-twin-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, "http://localhost");

        if (url.pathname === "/api/files") {
          sendJson(res, {
            ifcFiles: listFiles(outputDir, [".ifc"]),
            metadataFiles: listFiles(outputDir, [".json", ".csv", ".xlsx"]),
            assetsCount: readJson(path.join(mockDbDir, "assets.json"), []).length,
            propertiesCount: readJson(path.join(mockDbDir, "properties.json"), []).length,
          });
          return;
        }

        if (url.pathname === "/api/assets") {
          sendJson(res, readJson(path.join(mockDbDir, "assets.json"), []));
          return;
        }

        if (url.pathname === "/api/properties") {
          sendJson(res, readJson(path.join(mockDbDir, "properties.json"), []));
          return;
        }

        if (url.pathname.startsWith("/bim-output/")) {
          const fileName = decodeURIComponent(url.pathname.replace("/bim-output/", ""));
          const filePath = safeFilePath(outputDir, fileName);
          if (!filePath || !fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        if (url.pathname.startsWith("/wasm/")) {
          const wasmName = decodeURIComponent(url.pathname.replace("/wasm/", ""));
          const wasmPath = safeFilePath(webIfcDir, wasmName);
          if (!wasmPath || path.extname(wasmPath) !== ".wasm" || !fs.existsSync(wasmPath)) {
            res.statusCode = 404;
            res.end("WASM not found");
            return;
          }
          res.setHeader("Content-Type", "application/wasm");
          fs.createReadStream(wasmPath).pipe(res);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), digitalTwinApi()],
  resolve: {
    alias: {
      "three/examples/jsm/utils/BufferGeometryUtils": path.resolve(
        __dirname,
        "src/three-buffer-geometry-utils.js",
      ),
      "three/examples/jsm/utils/BufferGeometryUtils.js": path.resolve(
        __dirname,
        "src/three-buffer-geometry-utils.js",
      ),
    },
  },
});
