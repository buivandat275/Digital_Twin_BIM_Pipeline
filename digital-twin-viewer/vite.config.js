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
const OM_FIELD_NAMES = [
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

function missingOmFields(asset) {
  const values = asset?.normalizedProperties || {};
  return OM_FIELD_NAMES.filter((field) => !String(values[field] ?? "").trim());
}

function buildOmValidationIssues(asset) {
  if (asset?.operationalScope === "context") return [];
  return missingOmFields(asset).map((field) => ({
    global_id: asset.ifcGuid || "",
    object_name: asset.name || "",
    ifc_class: asset.sourceReference?.ifc_class || "",
    field,
    error_type: `Thiếu ${field}`,
    severity: "Medium",
    suggested_fix: `Nhập ${field} trực tiếp trên màn hình hoặc qua correction template.`,
    profile: "vsf_om_10",
  }));
}

function recalculateSnapshotSummary(snapshot) {
  const assets = Array.isArray(snapshot.assets) ? snapshot.assets : [];
  const missingByField = Object.fromEntries(OM_FIELD_NAMES.map((field) => [field, 0]));
  let missingFieldCount = 0;
  let complete = 0;
  let incomplete = 0;
  let operationalAssetCount = 0;
  let scopeReviewCount = 0;
  let contextCount = 0;

  for (const asset of assets) {
    const scope = asset.operationalScope || "context";
    const missing = scope === "context" ? [] : missingOmFields(asset);
    asset.validationIssues = buildOmValidationIssues(asset);
    if (scope === "context") {
      asset.readinessStatus = "Excluded";
      contextCount += 1;
    } else if (scope === "scope_review") {
      asset.readinessStatus = "Scope Review";
      scopeReviewCount += 1;
    } else {
      operationalAssetCount += 1;
      asset.readinessStatus = missing.length ? "Incomplete" : "Complete";
      if (missing.length) incomplete += 1;
      else complete += 1;
    }
    missingFieldCount += missing.length;
    for (const field of missing) missingByField[field] += 1;
  }

  snapshot.summary = {
    ...(snapshot.summary || {}),
    assetCount: assets.length,
    operationalAssetCount,
    scopeReviewCount,
    contextCount,
    complete,
    incomplete,
    missingFieldCount,
    missingByField,
    validation: {
      total_errors: missingFieldCount,
      High: 0,
      Medium: missingFieldCount,
      Low: 0,
      total_objects: assets.length,
      checked_objects: operationalAssetCount + scopeReviewCount,
      context_objects: contextCount,
      scope_review_objects: scopeReviewCount,
      complete_objects: complete,
      incomplete_objects: incomplete + scopeReviewCount,
      missing_by_field: missingByField,
    },
  };
  snapshot.updatedAt = new Date().toISOString();
  return snapshot;
}

function updateValidatedSnapshot(fileName, ifcGuid, values) {
  const filePath = safeFilePath(outputDir, fileName);
  if (!filePath || path.extname(filePath).toLowerCase() !== ".json" || !fs.existsSync(filePath)) {
    throw new Error("Không tìm thấy snapshot validation.");
  }
  const snapshot = readJson(filePath, null);
  if (!snapshot || snapshot.kind !== "validated-digital-twin-snapshot") {
    throw new Error("File không phải validated Digital Twin snapshot.");
  }
  const asset = (snapshot.assets || []).find(
    (item) => String(item.ifcGuid || "").trim().toLowerCase() === String(ifcGuid || "").trim().toLowerCase(),
  );
  if (!asset) throw new Error("Không tìm thấy IFC GlobalId trong snapshot.");

  const existingValues = asset.normalizedProperties || {};
  asset.normalizedProperties = Object.fromEntries(
    OM_FIELD_NAMES.map((field) => [field, existingValues[field] || ""]),
  );
  asset.fieldSources = { ...(asset.fieldSources || {}) };
  for (const field of OM_FIELD_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(values || {}, field)) continue;
    asset.normalizedProperties[field] = String(values[field] ?? "").trim();
    asset.fieldSources[field] = "manual_viewer";
  }

  recalculateSnapshotSummary(snapshot);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return { asset, summary: snapshot.summary, updatedAt: snapshot.updatedAt };
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[đð]/g, "d")
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
  if (
    /(offline|mat ket noi|mat tin hieu|khong gui|khong co tin hieu|khong thay hinh|khong co hinh|man hinh den|mat hinh|mat video|khong co video|no image|black screen|no video|no stream)/.test(
      normalizedQuery,
    )
  ) {
    return "Offline";
  }
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

function extractIntegrationIntentFromText(value = "", compactCatalog = {}) {
  const text = String(value || "");
  const normalized = normalizeIntentText(text);
  const parsed = {
    action: "showResults",
    assetCode: "",
    type: "",
    status: detectStatus(normalized),
    buildingCode: "",
    area: "",
    near: /(gan|quanh|xung quanh|around|near|ban kinh|trong vong)/.test(normalized),
    radiusMeters: 120,
    mappingIntent: "",
    qualityIssue: "",
    explanation: "Parsed from non-JSON Qwen response.",
  };
  const asset = (compactCatalog.assets || []).find((item) => normalized.includes(normalizeIntentText(item.assetCode)));
  if (asset) parsed.assetCode = asset.assetCode;
  const type = (compactCatalog.types || []).find((item) => normalized.includes(normalizeIntentText(item)));
  if (type) parsed.type = type;
  const building = (compactCatalog.buildings || []).find((item) =>
    [item.code, item.name].some((entry) => normalized.includes(normalizeIntentText(entry))),
  );
  if (building) parsed.buildingCode = building.code;
  if (/(main gate|gatehouse|entry gate|cong chinh|cong vao|bao ve|gate)/.test(normalized)) parsed.area = "Main Gate";
  if (!parsed.assetCode && !parsed.type && !parsed.status && !parsed.buildingCode && !parsed.area) {
    throw new Error("LLM did not return JSON");
  }
  return parsed;
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

function cleanObject(value = {}) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  );
}

function coerceIntegrationIntent(intent = {}, fallback = {}) {
  const fallbackFilters = fallback.filters || {};
  const nextFilters = {
    ...fallbackFilters,
    ...cleanObject(intent.filters || {}),
  };
  if (typeof intent.filters?.mappingIssue === "boolean") nextFilters.mappingIssue = intent.filters.mappingIssue;
  if (typeof intent.filters?.mappingResolved === "boolean") nextFilters.mappingResolved = intent.filters.mappingResolved;
  if (typeof intent.filters?.problemOnly === "boolean") nextFilters.problemOnly = intent.filters.problemOnly;
  if (intent.filters?.near && typeof intent.filters.near === "object") nextFilters.near = intent.filters.near;
  return {
    ...fallback,
    source: intent.source || "ollama",
    action: intent.action || fallback.action || "showResults",
    query: intent.query || fallback.query || "",
    targetAssetId: intent.targetAssetId || fallback.targetAssetId || "",
    targetBuildingId: intent.targetBuildingId || fallback.targetBuildingId || "",
    filters: nextFilters,
    explanation: intent.explanation || fallback.explanation || "Parsed by local Qwen.",
  };
}

function normalizeIntentText(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[đð]/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveIntegrationIntentFromLlm(parsed = {}, catalog = {}, fallback = {}) {
  const filters = { ...(fallback.filters || {}) };
  const buildings = (catalog.buildings || []).filter(Boolean);
  const assets = (catalog.assets || []).filter(Boolean);
  const typeOptions = (catalog.typeOptions || []).filter(Boolean);
  const findBuilding = (value) => {
    const needle = normalizeIntentText(value);
    if (!needle) return null;
    if (/(main gate|gatehouse|entry gate|cong chinh|cong vao|bao ve|gate)/.test(needle)) {
      const gate = buildings.find((building) =>
        [building.id, building.code, building.name].some((entry) => /(gate|cong)/.test(normalizeIntentText(entry))),
      );
      if (gate) return gate;
    }
    return buildings.find((building) =>
      [building.id, building.code, building.name].some((entry) => normalizeIntentText(entry) === needle || normalizeIntentText(entry).includes(needle)),
    );
  };
  const findAsset = (value) => {
    const needle = normalizeIntentText(value);
    if (!needle) return null;
    return assets.find((asset) =>
      [asset.id, asset.assetCode, asset.name].some((entry) => normalizeIntentText(entry) === needle || normalizeIntentText(entry).includes(needle)),
    );
  };
  const findType = (value) => {
    const needle = normalizeIntentText(value);
    if (!needle) return "";
    return typeOptions.find((type) => normalizeIntentText(type) === needle || normalizeIntentText(type).includes(needle)) || "";
  };
  const inferAsset = ({ building, type }) => {
    if (!type) return null;
    const candidates = assets.filter((asset) => {
      const sameBuilding = building ? asset.buildingId === building.id : true;
      return sameBuilding && asset.type === type;
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  const building = findBuilding(parsed.buildingId || parsed.buildingCode || parsed.building || parsed.area);
  let asset = findAsset(parsed.assetId || parsed.assetCode || parsed.asset);
  const type = findType(parsed.type || parsed.assetType);
  if (!asset) asset = inferAsset({ building, type });

  if (type) filters.type = type;
  if (parsed.status && !filters.status) filters.status = parsed.status;
  if (parsed.qualityIssue) filters.qualityIssue = parsed.qualityIssue;
  if (parsed.mappingIntent === "unmapped") {
    filters.mappingIssue = true;
    filters.mappingResolved = false;
  }
  if (parsed.mappingIntent === "mapped") {
    filters.mappingIssue = false;
    filters.mappingResolved = true;
  }
  if (building) {
    if (parsed.near) {
      filters.buildingId = "";
      filters.near = {
        buildingId: building.id,
        latitude: building.latitude,
        longitude: building.longitude,
        radiusMeters: Number(parsed.radiusMeters || fallback.filters?.near?.radiusMeters || 120),
      };
    } else {
      filters.buildingId = building.id;
    }
  }

  const isSpatialFallback = Boolean(fallback.filters?.near);
  const query = isSpatialFallback ? fallback.query || "" : asset?.assetCode || parsed.query || fallback.query || "";
  return {
    ...fallback,
    action: parsed.action || fallback.action || "showResults",
    query,
    targetAssetId: isSpatialFallback ? fallback.targetAssetId || "" : asset?.id || fallback.targetAssetId || "",
    targetBuildingId: building?.id || fallback.targetBuildingId || "",
    filters,
    explanation: parsed.explanation || fallback.explanation || "Parsed by local Qwen.",
  };
}

async function parseIntegrationWithOllama(query, catalog, fallback) {
  const env = { ...process.env, ...readEnv(path.join(projectRoot, ".env")) };
  const model = env.OPERATIONS_LLM_MODEL || "qwen2.5:1.5b";
  const endpoint = env.OPERATIONS_LLM_URL || "http://127.0.0.1:11434/api/generate";
  const timeoutMs = Number(env.OPERATIONS_LLM_TIMEOUT_MS || 20000);
  const buildingById = new Map((catalog.buildings || []).filter(Boolean).map((building) => [building.id, building]));
  const fallbackFilters = fallback.filters || {};
  const narrowedAssets = (catalog.assets || []).filter(Boolean).filter((asset) => {
    if (fallback.targetAssetId && asset.id !== fallback.targetAssetId) return false;
    if (fallback.query && ![asset.assetCode, asset.name].some((value) => normalizeIntentText(value).includes(normalizeIntentText(fallback.query)))) {
      return false;
    }
    if (!fallback.targetAssetId && !fallback.query && fallbackFilters.type && asset.type !== fallbackFilters.type) return false;
    if (!fallback.targetAssetId && !fallback.query && fallbackFilters.buildingId && asset.buildingId !== fallbackFilters.buildingId) return false;
    return true;
  });
  const candidateAssets = narrowedAssets.length ? narrowedAssets : (catalog.assets || []).filter(Boolean);
  const compactCatalog = {
    buildings: (catalog.buildings || []).filter(Boolean).map((building) => ({
      code: building.code,
      name: building.name,
    })),
    types: catalog.typeOptions || [],
    assets: candidateAssets.map((asset) => ({
      assetCode: asset.assetCode,
      name: asset.name,
      type: asset.type,
      building: buildingById.get(asset.buildingId)?.code || buildingById.get(asset.buildingId)?.name || asset.buildingId,
      room: asset.room,
      status: asset.status,
    })),
  };
  const prompt = `Return only one minified JSON object. No markdown. No prose.
Schema {"action":"showResults","assetCode":"","type":"","status":"","buildingCode":"","area":"","near":false,"radiusMeters":120,"mappingIntent":"","qualityIssue":"","explanation":""}
Rules khong thay hinh/man hinh den/no video/black screen/mat tin hieu/offline=>Offline; cong vao/bao ve/gatehouse=>Main Gate; choose assetCode if clear.
Catalog ${JSON.stringify(compactCatalog)}
User ${query}
JSON:`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0, num_predict: 120 },
      }),
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const payload = await response.json();
    let parsed;
    try {
      parsed = extractJsonObject(payload.response || "");
    } catch {
      parsed = extractIntegrationIntentFromText(payload.response || "", compactCatalog);
    }
    const intent = {
      ...resolveIntegrationIntentFromLlm(parsed, catalog, fallback),
      source: `ollama:${model}`,
    };
    return {
      ...intent,
      llmEvidence: {
        requestedAt: new Date().toISOString(),
        model,
        endpoint,
        source: `ollama:${model}`,
        parsedIntent: parsed,
        rawResponse: payload.response || "",
      },
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

        if (url.pathname === "/api/integration/buildings") {
          sendJson(res, readJson(path.join(mockDbDir, "integration-buildings.json"), []));
          return;
        }

        if (url.pathname === "/api/integration/assets") {
          sendJson(res, readJson(path.join(mockDbDir, "integration-assets.json"), []));
          return;
        }

        if (url.pathname === "/api/integration/ifc-objects") {
          sendJson(res, readJson(path.join(mockDbDir, "integration-ifc-objects.json"), []));
          return;
        }

        if (url.pathname === "/api/integration/llm-status") {
          checkOllamaStatus()
            .then((status) => sendJson(res, status))
            .catch((error) => sendError(res, 500, error.message));
          return;
        }

        if (url.pathname === "/api/integration/nl-search" && req.method === "POST") {
          readRequestJson(req)
            .then(async ({ query, catalog, fallback }) => {
              try {
                return await parseIntegrationWithOllama(query || "", catalog || {}, fallback || {});
              } catch (error) {
                return {
                  ...(fallback || {}),
                  source: "rules",
                  llmError: error.message,
                  explanation: `${fallback?.explanation || "Parsed by rules."} Qwen unavailable; used rule fallback.`,
                };
              }
            })
            .then((intent) => sendJson(res, intent))
            .catch((error) => sendError(res, 400, error.message));
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

        const snapshotAssetMatch = url.pathname.match(
          /^\/api\/validated-snapshots\/([^/]+)\/assets\/([^/]+)$/,
        );
        if (snapshotAssetMatch && req.method === "PATCH") {
          const dataset = decodeURIComponent(snapshotAssetMatch[1]);
          const ifcGuid = decodeURIComponent(snapshotAssetMatch[2]);
          readRequestJson(req)
            .then(({ values }) => updateValidatedSnapshot(dataset, ifcGuid, values || {}))
            .then((result) => sendJson(res, result))
            .catch((error) => sendError(res, 400, error.message));
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

export { updateValidatedSnapshot };

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
