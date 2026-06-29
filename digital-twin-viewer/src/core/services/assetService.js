import { CompletenessStatus } from "../domain/models.js";
import { buildIfcObjectIndex, getAssetIfcGuid, getIfcMapping } from "./mappingService.js";

function text(value) {
  return String(value ?? "").trim();
}

function hasTrustedLatLon(asset) {
  return (
    Number.isFinite(Number(asset.latitude)) &&
    Number.isFinite(Number(asset.longitude)) &&
    Boolean(text(asset.coordinateSource))
  );
}

export function normalizeBuilding(raw = {}) {
  return {
    id: text(raw.id || raw.building_id),
    code: text(raw.code || raw.building_id),
    name: text(raw.name),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    address: text(raw.address),
    ifcFile: text(raw.ifcFile || raw.ifc_file),
    sourceSystem: text(raw.sourceSystem || raw.source_system || "mock-json"),
    geometry: raw.geometry || null,
  };
}

export function normalizeAsset(raw = {}, buildingIndex = new Map(), files = [], ifcIndex = buildIfcObjectIndex()) {
  const buildingId = text(raw.buildingId || raw.building_id);
  const building = buildingIndex.get(buildingId) || null;
  const asset = {
    id: text(raw.id || raw.asset_id || raw.assetCode),
    assetCode: text(raw.assetCode || raw.asset_id),
    name: text(raw.name || raw.asset_name),
    type: text(raw.type || raw.asset_type),
    buildingId,
    buildingName: building?.name || "",
    floor: text(raw.floor),
    room: text(raw.room || raw.room_zone || raw.zone),
    latitude: raw.latitude === undefined || raw.latitude === "" ? null : Number(raw.latitude),
    longitude: raw.longitude === undefined || raw.longitude === "" ? null : Number(raw.longitude),
    coordinateSource: text(raw.coordinateSource || raw.coordinate_source),
    ifcGuid: text(raw.ifcGuid || raw.ifc_guid || raw.source_global_id),
    status: text(raw.status || raw.healthStatus || raw.health_status || "Unknown"),
    statusReason: text(raw.statusReason || raw.status_reason),
    lastSignalAt: text(raw.lastSignalAt || raw.last_signal_at),
    sourceSystem: text(raw.sourceSystem || raw.source_system || "mock-json"),
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
  };
  const trustedLatLon = hasTrustedLatLon(asset);
  const enrichedAsset = {
    ...asset,
    hasTrustedLatLon: trustedLatLon,
    ifcAvailable: Boolean(building?.ifcFile && files.some((file) => file.name === building.ifcFile)),
  };
  const mappingInfo = getIfcMapping(enrichedAsset, building, ifcIndex);
  return {
    ...enrichedAsset,
    ifcGuid: mappingInfo.ifcGuid || getAssetIfcGuid(asset),
    ifcObject: mappingInfo.ifcObject || null,
    mappingInfo,
    mappingStatus: mappingInfo.status,
    completenessStatus: getCompletenessStatus(enrichedAsset, building),
  };
}

export function buildBuildingIndex(buildings) {
  return new Map(buildings.map((building) => [building.id, building]));
}

export function getCompletenessStatus(asset, building) {
  const missingCore = [asset.assetCode, asset.name, asset.type].some((value) => !text(value));
  if (!building) return CompletenessStatus.MISSING_BUILDING;
  if (!asset.floor && !asset.room && !asset.hasTrustedLatLon) return CompletenessStatus.MISSING_LOCATION;
  if (missingCore) return CompletenessStatus.INCOMPLETE;
  return CompletenessStatus.READY;
}

export function buildAssetViewModel(rawAssets, buildings, files = [], ifcObjects = []) {
  const buildingIndex = buildBuildingIndex(buildings);
  const ifcIndex = buildIfcObjectIndex(ifcObjects);
  return rawAssets.map((asset) => normalizeAsset(asset, buildingIndex, files, ifcIndex));
}
