import { MappingStatus } from "../domain/models.js";

function text(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return text(value).toLowerCase();
}

export function getAssetIfcGuid(asset) {
  return asset?.ifcGuid || asset?.source_global_id || "";
}

export function normalizeIfcObject(raw = {}) {
  return {
    ifcGuid: text(raw.ifcGuid || raw.ifc_guid || raw.globalId || raw.global_id),
    ifcFileId: text(raw.ifcFileId || raw.ifc_file_id || raw.ifcFile || raw.ifc_file),
    objectName: text(raw.objectName || raw.object_name || raw.name),
    objectType: text(raw.objectType || raw.object_type || raw.ifcClass || raw.ifc_class),
    assetCode: text(raw.assetCode || raw.asset_code || raw.asset_id),
    sourceSystem: text(raw.sourceSystem || raw.source_system || "ifc-parser"),
    properties: raw.properties && typeof raw.properties === "object" ? raw.properties : {},
  };
}

export function buildIfcObjectIndex(ifcObjects = []) {
  const byGuid = new Map();
  const byAssetCode = new Map();
  ifcObjects.map(normalizeIfcObject).forEach((ifcObject) => {
    if (ifcObject.ifcGuid) byGuid.set(normalizeKey(ifcObject.ifcGuid), ifcObject);
    if (ifcObject.assetCode) byAssetCode.set(normalizeKey(ifcObject.assetCode), ifcObject);
  });
  return { byGuid, byAssetCode };
}

export function getIfcMapping(asset, building, ifcIndex = buildIfcObjectIndex()) {
  const ifcGuid = text(getAssetIfcGuid(asset));
  if (!building?.ifcFile) {
    return {
      status: MappingStatus.MISSING_IFC_FILE,
      method: "",
      confidence: 0,
      ifcGuid,
      ifcObject: null,
    };
  }

  if (ifcGuid) {
    const ifcObject = ifcIndex.byGuid.get(normalizeKey(ifcGuid));
    if (ifcObject) {
      return {
        status: MappingStatus.MAPPED,
        method: "ifcGuid",
        confidence: 1,
        ifcGuid: ifcObject.ifcGuid,
        ifcObject,
      };
    }
    return {
      status: MappingStatus.IFC_OBJECT_MISSING,
      method: "ifcGuid",
      confidence: 0,
      ifcGuid,
      ifcObject: null,
    };
  }

  const ifcObject = ifcIndex.byAssetCode.get(normalizeKey(asset?.assetCode));
  if (ifcObject && (!ifcObject.ifcFileId || ifcObject.ifcFileId === building.ifcFile)) {
    return {
      status: MappingStatus.MAPPED_BY_CODE,
      method: "assetCode",
      confidence: 0.82,
      ifcGuid: ifcObject.ifcGuid,
      ifcObject,
    };
  }

  return {
    status: MappingStatus.UNMAPPED,
    method: "",
    confidence: 0,
    ifcGuid: "",
    ifcObject: null,
  };
}

export function getMappingStatus(asset, building, ifcIndex) {
  const mapping = getIfcMapping(asset, building, ifcIndex);
  return typeof mapping === "string" ? mapping : mapping.status;
}

export function canOpenIfc(asset, building, files = []) {
  const openableStatuses = new Set([MappingStatus.MAPPED, MappingStatus.MAPPED_BY_CODE]);
  if (!openableStatuses.has(asset?.mappingStatus || getMappingStatus(asset, building))) return false;
  if (!asset?.ifcGuid && !asset?.mappingInfo?.ifcGuid) return false;
  return files.some((file) => file.name === building.ifcFile);
}
