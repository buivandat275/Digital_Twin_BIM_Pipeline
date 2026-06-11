import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "output");
const mockDbDir = path.join(projectRoot, "mock-db");
const webIfcDir = path.join(__dirname, "node_modules", "web-ifc");
const fragmentsWorkerPath = path.join(
  __dirname,
  "node_modules",
  "@thatopen",
  "fragments",
  "dist",
  "Worker",
  "worker.min.mjs",
);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    env[key.trim().replace(/^\uFEFF/, "")] = valueParts.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function readApsEnv() {
  const candidates = [
    path.join(projectRoot, ".env"),
    path.join(path.dirname(projectRoot), ".env"),
    path.join(process.cwd(), ".env"),
  ];
  const merged = { ...process.env };
  for (const envPath of candidates) {
    const env = readEnv(envPath);
    for (const [key, value] of Object.entries(env)) {
      if (value) merged[key] = value;
    }
  }
  return { env: merged, candidates };
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

function sendError(res, statusCode, message) {
  res.statusCode = statusCode;
  sendJson(res, { error: message });
}

function safeFilePath(baseDir, requestedName) {
  const resolved = path.resolve(baseDir, requestedName);
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

function listApsModels() {
  if (!fs.existsSync(outputDir)) return [];
  return fs
    .readdirSync(outputDir)
    .filter((name) => name.toLowerCase().endsWith("_aps_result.json"))
    .map((name) => {
      const fullPath = path.join(outputDir, name);
      const stat = fs.statSync(fullPath);
      const payload = readJson(fullPath, {});
      const format = payload?.job?.acceptedJobs?.output?.formats?.[0]?.type || "";
      return {
        key: `aps:${name}`,
        name,
        sourceFile: payload.source_file || name.replace(/_aps_result\.json$/i, ""),
        urn: payload.urn || "",
        format,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        status: payload?.manifest?.status || "",
        progress: payload?.manifest?.progress || "",
      };
    })
    .filter((item) => item.urn && item.format === "svf2")
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function getApsViewerToken() {
  const { env, candidates } = readApsEnv();
  const clientId = env.APS_CLIENT_ID || "";
  const clientSecret = env.APS_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error(
      `APS_CLIENT_ID and APS_CLIENT_SECRET are required in .env. Checked: ${candidates.join(", ")}`,
    );
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "viewables:read data:read",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`APS token failed: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
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

        if (url.pathname === "/api/aps/models") {
          sendJson(res, listApsModels());
          return;
        }

        if (url.pathname === "/api/aps/token") {
          getApsViewerToken()
            .then((token) => sendJson(res, token))
            .catch((error) => sendError(res, 500, error.message));
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

        if (url.pathname === "/fragments-worker/worker.mjs") {
          if (!fs.existsSync(fragmentsWorkerPath)) {
            res.statusCode = 404;
            res.end("Fragments worker not found");
            return;
          }
          res.setHeader("Content-Type", "text/javascript");
          fs.createReadStream(fragmentsWorkerPath).pipe(res);
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
