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

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function safeFilePath(baseDir, requestedName) {
  const resolved = path.resolve(baseDir, requestedName);
  if (!resolved.startsWith(path.resolve(baseDir))) return null;
  return resolved;
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function findAssetByQuery(assets, normalizedQuery) {
  return assets.find((asset) => {
    const candidates = [asset.asset_id, asset.device_id, asset.asset_name].map(normalizeText);
    return candidates.some((value) => value && normalizedQuery.includes(value));
  });
}

function detectAssetType(normalizedQuery) {
  const aliases = [
    ["Camera", ["camera", "cam", "cctv", "mat camera", "mat cam"]],
    ["Sensor", ["sensor", "cam bien", "dau bao", "bao khoi", "smoke"]],
    ["AHU", ["ahu", "air handling", "xu ly khong khi"]],
    ["Extract Fan", ["quat hut", "extract fan", "fan", "quat"]],
    ["Electric Meter", ["dong ho dien", "cong to", "meter", "dien nang"]],
    ["Pump", ["bom", "pump"]],
    ["Light", ["den", "light", "chieu sang"]],
  ];
  for (const [type, words] of aliases) {
    if (words.some((word) => normalizedQuery.includes(word))) return type;
  }
  return "";
}

function detectStatus(normalizedQuery) {
  if (/(offline|mat ket noi|mat tin hieu|khong gui|khong co tin hieu)/.test(normalizedQuery)) return "Offline";
  if (/(fault|loi|hong|bi hong|gap su co|su co)/.test(normalizedQuery)) return "Fault";
  if (/(warning|canh bao|bat thuong|qua nguong)/.test(normalizedQuery)) return "Warning";
  if (/(normal|binh thuong|on dinh)/.test(normalizedQuery)) return "Normal";
  return "";
}

function detectZone(normalizedQuery) {
  if (/(mechanical|co dien|ky thuat|phong may)/.test(normalizedQuery)) return "Mechanical Area";
  if (/(electrical riser|riser|tu dien|khu dien|phong dien)/.test(normalizedQuery)) return "Electrical Riser";
  if (/(corridor|hanh lang|north)/.test(normalizedQuery)) return "North Corridor";
  if (/(level 10 corridor|hanh lang tang 10)/.test(normalizedQuery)) return "Level 10 Corridor";
  return "";
}

function buildRuleBasedIntent(query, assets) {
  const normalizedQuery = normalizeText(query);
  const asset = findAssetByQuery(assets, normalizedQuery);
  const type = detectAssetType(normalizedQuery);
  const status = detectStatus(normalizedQuery);
  const zone = detectZone(normalizedQuery);
  const floorMatch = normalizedQuery.match(/(?:tang|level|floor)\s*(\d+)/);
  const radiusMatch = normalizedQuery.match(/(\d+(?:[.,]\d+)?)\s*(?:m|met|meter)/);
  const isSpatial = /(gan|quanh|xung quanh|around|near|ban kinh|trong vong)/.test(normalizedQuery);
  const isRelationship = /(lien quan|cung he|cung system|relationship|phu thuoc|cap cho|quan sat|lien ket)/.test(normalizedQuery);
  const isDispatch = /(ky thuat vien|technician|dispatch|phan cong|xu ly|bao tri)/.test(normalizedQuery);
  const problemOnly = /(bat thuong|co van de|dang loi|canh bao|su co|hong|mat ket noi)/.test(normalizedQuery) && !status;
  const specialty = /(hvac|co khi|mechanical|dien|electrical|security|bao chay|fire)/.test(normalizedQuery)
    ? normalizedQuery.includes("hvac")
      ? "HVAC"
      : normalizedQuery.includes("co khi") || normalizedQuery.includes("mechanical")
        ? "Mechanical"
        : normalizedQuery.includes("security")
          ? "Security"
          : normalizedQuery.includes("bao chay") || normalizedQuery.includes("fire")
            ? "Fire Safety"
            : "Electrical"
    : "";

  let nearAsset = asset;
  let nearAssetType = "";
  if (isSpatial && !nearAsset) {
    if (normalizedQuery.includes("ahu")) nearAssetType = "AHU";
    else if (/(bom|pump)/.test(normalizedQuery)) nearAssetType = "Pump";
    else if (/(dong ho dien|meter|cong to)/.test(normalizedQuery)) nearAssetType = "Electric Meter";
    else if (/(quat|fan)/.test(normalizedQuery)) nearAssetType = "Extract Fan";
    else if (/(sensor|bao khoi)/.test(normalizedQuery)) nearAssetType = "Sensor";
  }

  return {
    source: "rules",
    intent: isRelationship ? "relationship" : isDispatch ? "dispatch" : isSpatial ? "spatial_search" : asset ? "locate" : "asset_search",
    filters: {
      search: "",
      type: isSpatial ? "" : type,
      floor: floorMatch ? `Level ${floorMatch[1]}` : "",
      zone,
      status,
      specialty,
      problemOnly,
    },
    spatial: {
      target_type: isSpatial ? type || "Any" : "",
      near_asset_id: nearAsset?.asset_id || "",
      near_asset_type: nearAssetType,
      near_status: status,
      radius_m: radiusMatch ? Number(radiusMatch[1].replace(",", ".")) : 6,
    },
    action: asset || isRelationship || isDispatch ? "locate_first" : "show_results",
    explanation: "Parsed by built-in rule fallback.",
  };
}

function extractJsonObject(value = "") {
  const text = String(value).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const probe = fenced ? fenced[1] : text;
  const start = probe.indexOf("{");
  const end = probe.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("LLM did not return JSON");
  return JSON.parse(probe.slice(start, end + 1));
}

function coerceIntent(intent, fallback) {
  const cleanObject = (value = {}) =>
    Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
    );
  const output = {
    source: intent.source || "llm",
    intent: intent.intent || fallback.intent,
    filters: { ...fallback.filters, ...cleanObject(intent.filters || {}) },
    spatial: { ...fallback.spatial, ...cleanObject(intent.spatial || {}) },
    action: intent.action || fallback.action,
    explanation: intent.explanation || "Parsed by local LLM.",
  };
  if (Array.isArray(output.filters.status)) output.filters.status = output.filters.status[0] || "";
  if (output.spatial.radius_m) output.spatial.radius_m = Number(output.spatial.radius_m) || fallback.spatial.radius_m;
  return output;
}

async function parseWithOllama(query, assets, fallback) {
  const env = { ...process.env, ...readEnv(path.join(projectRoot, ".env")) };
  const model = env.OPERATIONS_LLM_MODEL || "qwen2.5:1.5b";
  const endpoint = env.OPERATIONS_LLM_URL || "http://127.0.0.1:11434/api/generate";
  const assetCatalog = assets.map((asset) => ({
    asset_id: asset.asset_id,
    asset_name: asset.asset_name,
    asset_type: asset.asset_type,
    floor: asset.floor,
    zone: asset.zone,
    status: asset.status,
    specialty: asset.specialty,
  }));
  const prompt = `You translate Vietnamese or English facility operations queries into JSON only.
Allowed asset types: Camera, Extract Fan, AHU, Sensor, Electric Meter, Light, Pump.
Allowed statuses: Normal, Warning, Fault, Offline.
Allowed floors/zones/specialties must come from the asset catalog.
Return exactly this JSON shape:
{
  "intent": "asset_search|spatial_search|locate|dispatch|relationship|unknown",
  "filters": {"search":"","type":"","floor":"","zone":"","status":"","specialty":"","problemOnly":false},
  "spatial": {"target_type":"","near_asset_id":"","near_asset_type":"","near_status":"","radius_m":6},
  "action": "show_results|locate_first",
  "explanation": "short Vietnamese explanation"
}
Asset catalog:
${JSON.stringify(assetCatalog)}
User query: ${query}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0, num_predict: 256 },
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = await response.json();
    return coerceIntent({ ...extractJsonObject(payload.response || ""), source: `ollama:${model}` }, fallback);
  } finally {
    clearTimeout(timeout);
  }
}

async function parseNaturalLanguageQuery(query, assets) {
  const fallback = buildRuleBasedIntent(query, assets);
  if (!query || !String(query).trim()) return fallback;
  try {
    return await parseWithOllama(query, assets, fallback);
  } catch (error) {
    return {
      ...fallback,
      explanation: `LLM unavailable, used rule fallback. ${error.message}`,
    };
  }
}

async function checkOllamaStatus() {
  const env = { ...process.env, ...readEnv(path.join(projectRoot, ".env")) };
  const model = env.OPERATIONS_LLM_MODEL || "qwen2.5:1.5b";
  const endpoint = env.OPERATIONS_LLM_URL || "http://127.0.0.1:11434/api/generate";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt: "Return JSON only: {\"ok\":true}",
        stream: false,
        options: { temperature: 0, num_predict: 16 },
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = await response.json();
    return {
      status: "online",
      source: `ollama:${model}`,
      model,
      endpoint,
      message: payload.response ? "Ollama responded." : "Ollama reachable.",
    };
  } catch (error) {
    return {
      status: "offline",
      source: "rules",
      model,
      endpoint,
      message: `LLM unavailable: ${error.message}. Rule fallback is active.`,
    };
  } finally {
    clearTimeout(timeout);
  }
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

        if (url.pathname === "/api/operations/assets") {
          sendJson(res, readJson(path.join(mockDbDir, "operations-assets.json"), []));
          return;
        }

        if (url.pathname === "/api/operations/technicians") {
          sendJson(res, readJson(path.join(mockDbDir, "operations-technicians.json"), []));
          return;
        }

        if (url.pathname === "/api/operations/incidents") {
          sendJson(res, readJson(path.join(mockDbDir, "operations-incidents.json"), []));
          return;
        }

        if (url.pathname === "/api/operations/site-layout") {
          sendJson(res, readJson(path.join(mockDbDir, "site-layout.json"), null));
          return;
        }

        if (url.pathname === "/api/operations/floorplan") {
          const floor = url.searchParams.get("floor") || "Level 9";
          const floorplanFile =
            floor === "Level 10" ? "operations-floorplan-level-10.json" : "operations-floorplan-level-9.json";
          sendJson(res, readJson(path.join(mockDbDir, floorplanFile), null));
          return;
        }

        if (url.pathname === "/api/operations/llm-status") {
          checkOllamaStatus()
            .then((status) => sendJson(res, status))
            .catch((error) => sendError(res, 500, error.message));
          return;
        }

        if (url.pathname === "/api/operations/nl-search" && req.method === "POST") {
          readRequestJson(req)
            .then(({ query }) =>
              parseNaturalLanguageQuery(query || "", readJson(path.join(mockDbDir, "operations-assets.json"), [])),
            )
            .then((intent) => sendJson(res, intent))
            .catch((error) => sendError(res, 400, error.message));
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
