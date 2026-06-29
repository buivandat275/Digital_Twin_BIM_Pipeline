import { MappingStatus } from "../domain/models.js";

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[đð]/g, "d")
    .replace(/[đð]/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(normalize(word)));
}

function findBuilding(normalizedQuery, buildings = []) {
  return buildings.find((building) =>
    [building.id, building.code, building.name].some((value) => {
      const normalized = normalize(value);
      return normalized && normalizedQuery.includes(normalized);
    }),
  );
}

function findAsset(normalizedQuery, assets = []) {
  return assets.find((asset) =>
    [asset.assetCode, asset.name, asset.ifcGuid].some((value) => {
      const normalized = normalize(value);
      return normalized && normalizedQuery.includes(normalized);
    }),
  );
}

function findType(normalizedQuery, typeOptions = []) {
  const aliases = new Map([
    ["Camera", ["camera", "cam", "cctv"]],
    ["Pump", ["pump", "bom"]],
    ["AHU", ["ahu", "air handling", "xu ly khong khi"]],
    ["Light", ["light", "den"]],
    ["Electric Meter", ["electric meter", "meter", "cong to", "dong ho dien"]],
    ["Electrical Panel", ["electrical panel", "panel", "tu dien"]],
    ["UPS", ["ups"]],
    ["Access Reader", ["access reader", "reader", "quet the"]],
    ["Water Tank", ["water tank", "tank", "bon nuoc"]],
    ["Weather Station", ["weather", "tram thoi tiet"]],
  ]);

  for (const type of typeOptions) {
    const normalizedType = normalize(type);
    if (normalizedType && normalizedQuery.includes(normalizedType)) return type;
    if (includesAny(normalizedQuery, aliases.get(type) || [])) return type;
  }
  return "";
}

function detectFloor(normalizedQuery) {
  const match = normalizedQuery.match(/\b(?:tang|level|floor|lau)\s*([0-9]{1,2})\b/);
  return match ? `Level ${match[1]}` : "";
}

function detectRoomOrZone(normalizedQuery) {
  const aliases = [
    ["Mechanical Area", ["mechanical", "khu co dien", "phong may"]],
    ["Electrical Room", ["electrical room", "phong dien", "tu dien"]],
    ["North Corridor", ["north corridor", "hanh lang bac", "hanh lang"]],
    ["IT Room", ["it room", "phong it"]],
    ["Main Gate", ["main gate", "gate", "gatehouse", "entry gate", "cong chinh", "cong vao", "bao ve"]],
    ["Roof", ["roof", "mai"]],
  ];
  const match = aliases.find(([, words]) => includesAny(normalizedQuery, words));
  return match?.[0] || "";
}

function inferAssetFromContext({ assets = [], building, type, room }) {
  if (!type) return null;
  const candidates = assets.filter((asset) => {
    const sameBuilding = building ? asset.buildingId === building.id : true;
    const sameType = asset.type === type;
    const sameRoom = room ? normalize(asset.room).includes(normalize(room)) : true;
    return sameBuilding && sameType && sameRoom;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function parseRadiusMeters(normalizedQuery) {
  const match = normalizedQuery.match(/\b([0-9]+(?:[.,][0-9]+)?)\s*(km|kilometer|kilometers|m|met|meter|meters)\b/);
  if (!match) return 120;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return 120;
  return match[2].startsWith("km") || match[2].startsWith("kilo") ? value * 1000 : value;
}

function getAssetSearchPoint(asset, buildings = []) {
  if (asset?.hasTrustedLatLon && Number.isFinite(Number(asset.latitude)) && Number.isFinite(Number(asset.longitude))) {
    return {
      latitude: Number(asset.latitude),
      longitude: Number(asset.longitude),
      coordinateSource: asset.coordinateSource || "trusted-asset",
    };
  }
  const building = buildings.find((item) => item.id === asset?.buildingId);
  if (building && Number.isFinite(Number(building.latitude)) && Number.isFinite(Number(building.longitude))) {
    return {
      latitude: Number(building.latitude),
      longitude: Number(building.longitude),
      coordinateSource: "building-inherited",
    };
  }
  return null;
}

function buildExplanation(parts) {
  const values = parts.filter(Boolean);
  return values.length ? `Parsed: ${values.join(", ")}.` : "Parsed as a broad asset search.";
}

export function parseNaturalLanguageSearch(input, context = {}) {
  const normalizedQuery = normalize(input);
  const buildings = context.buildings || [];
  const assets = context.assets || [];
  const typeOptions = context.typeOptions || [];
  const filters = {
    buildingId: "",
    type: "",
    mappingStatus: "",
    completenessStatus: "",
    qualityIssue: "",
    mappingIssue: false,
    mappingResolved: false,
    status: "",
    problemOnly: false,
    near: null,
  };
  let query = "";
  let action = "showResults";

  let building = findBuilding(normalizedQuery, buildings);
  if (building) filters.buildingId = building.id;

  let asset = findAsset(normalizedQuery, assets);
  if (asset) query = asset.assetCode;

  const type = findType(normalizedQuery, typeOptions);
  if (type) filters.type = type;

  const floor = detectFloor(normalizedQuery);
  const room = detectRoomOrZone(normalizedQuery);
  if (!building && room === "Main Gate") {
    building = buildings.find((item) => normalize(item.code) === "gate" || normalize(item.name).includes("gate"));
    if (building) filters.buildingId = building.id;
  }
  if (!asset) {
    asset = inferAssetFromContext({ assets, building, type, room });
    if (asset) query = asset.assetCode;
  }
  if (!query && (floor || room)) query = [floor, room].filter(Boolean).join(" ");

  const radiusMeters = parseRadiusMeters(normalizedQuery);
  const isNearQuery = includesAny(normalizedQuery, [
    "gan",
    "quanh",
    "xung quanh",
    "near",
    "around",
    "khu vuc",
    "ban kinh",
    "pham vi",
    "trong vong",
  ]);
  if (asset && isNearQuery) {
    const anchorTerms = [asset.assetCode, asset.name, asset.ifcGuid].map(normalize).filter(Boolean);
    const queryWithoutAnchor = anchorTerms.reduce((text, term) => text.replace(term, " "), normalizedQuery);
    filters.type = findType(queryWithoutAnchor, typeOptions);
    filters.buildingId = "";
    const anchorPoint = getAssetSearchPoint(asset, buildings);
    if (anchorPoint) {
      filters.near = {
        anchorAssetId: asset.id,
        anchorAssetCode: asset.assetCode,
        latitude: anchorPoint.latitude,
        longitude: anchorPoint.longitude,
        coordinateSource: anchorPoint.coordinateSource,
        radiusMeters,
      };
      query = "";
    }
  } else if (building && isNearQuery) {
    filters.near = {
      buildingId: building.id,
      latitude: building.latitude,
      longitude: building.longitude,
      radiusMeters,
    };
    filters.buildingId = "";
  }

  if (
    includesAny(normalizedQuery, [
      "offline",
      "mat tin hieu",
      "mat ket noi",
      "khong gui tin hieu",
      "khong co tin hieu",
      "khong thay hinh",
      "khong co hinh",
      "man hinh den",
      "mat hinh",
      "mat video",
      "khong co video",
      "no image",
      "black screen",
      "no video",
      "no stream",
    ])
  ) {
    filters.status = "Offline";
  } else if (includesAny(normalizedQuery, ["warning", "canh bao", "bat thuong", "qua nguong"])) {
    filters.status = "Warning";
  } else if (includesAny(normalizedQuery, ["fault", "loi", "hong", "khong chay", "trip", "su co"])) {
    filters.status = "Fault";
  } else if (includesAny(normalizedQuery, ["normal", "binh thuong", "on dinh"])) {
    filters.status = "Normal";
  } else if (includesAny(normalizedQuery, ["co van de", "dang loi", "thiet bi loi", "bi loi"])) {
    filters.problemOnly = true;
  }

  if (includesAny(normalizedQuery, ["chua map", "chua lien ket", "unmapped", "not mapped", "without ifc"])) {
    filters.mappingIssue = true;
  } else if (includesAny(normalizedQuery, ["da map", "da lien ket", "mapped", "linked"])) {
    filters.mappingResolved = true;
  }

  if (includesAny(normalizedQuery, ["map bang asset code", "mapped by asset code", "asset code"])) {
    filters.mappingStatus = MappingStatus.MAPPED_BY_CODE;
    filters.mappingIssue = false;
    filters.mappingResolved = false;
  }

  if (includesAny(normalizedQuery, ["ifc guid khong thay", "ifc object missing", "guid khong ton tai"])) {
    filters.mappingStatus = MappingStatus.IFC_OBJECT_MISSING;
    filters.mappingIssue = false;
  }

  if (includesAny(normalizedQuery, ["thieu location", "thieu vi tri", "missing location", "no location"])) {
    filters.qualityIssue = "missingLocation";
  }
  if (includesAny(normalizedQuery, ["thieu metadata", "missing metadata", "no metadata"])) {
    filters.qualityIssue = "missingMetadata";
  }
  if (includesAny(normalizedQuery, ["thieu building", "missing building", "no building"])) {
    filters.qualityIssue = "missingBuilding";
  }

  if (includesAny(normalizedQuery, ["ready", "du du lieu", "hoan chinh"])) {
    filters.completenessStatus = "Ready";
  }

  if (includesAny(normalizedQuery, ["mo ifc", "mo 3d", "open ifc", "open 3d", "xem 3d", "viewer"])) {
    action = "openIfc";
  } else if (includesAny(normalizedQuery, ["zoom", "toi toa", "den toa", "show building", "tim toa"])) {
    action = building ? "focusBuilding" : "showResults";
  }

  return {
    action,
    filters,
    query,
    targetAssetId: filters.near?.anchorAssetId ? "" : asset?.id || "",
    targetBuildingId: building?.id || "",
    explanation: buildExplanation([
      building ? `building=${building.code || building.name}` : "",
      filters.type ? `type=${filters.type}` : "",
      floor,
      room,
      filters.mappingIssue ? "mapping=issue" : "",
      filters.mappingResolved ? "mapping=mapped" : "",
      filters.mappingStatus ? `mappingStatus=${filters.mappingStatus}` : "",
      filters.status ? `status=${filters.status}` : "",
      filters.problemOnly ? "status=problem" : "",
      filters.near
        ? `within=${Math.round(filters.near.radiusMeters)}m around ${filters.near.anchorAssetCode || building?.code || building?.name}`
        : "",
      filters.qualityIssue ? `quality=${filters.qualityIssue}` : "",
      action !== "showResults" ? `action=${action}` : "",
    ]),
  };
}
