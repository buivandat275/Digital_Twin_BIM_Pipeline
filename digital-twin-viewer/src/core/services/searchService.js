import { getAssetQualityIssue } from "./dataQualityService.js";
import { querySpatialIndex } from "./spatialIndexService.js";
import { MappingStatus } from "../domain/models.js";

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[đð]/g, "d")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNearMatchSet(filters, spatialIndex) {
  const near = filters.near;
  if (!near) return true;
  const radiusMeters = Number(near.radiusMeters || 120);
  if (spatialIndex && Number.isFinite(Number(near.latitude)) && Number.isFinite(Number(near.longitude))) {
    return new Map(
      querySpatialIndex(spatialIndex, near, radiusMeters, {
        anchorAssetId: near.anchorAssetId,
        includeAnchor: Boolean(near.includeAnchor),
      }).map((result) => [result.asset.id, result.distanceMeters]),
    );
  }
  return null;
}

export function searchAssets(assets, query, filters = {}, options = {}) {
  const needle = normalize(query);
  const mappingIssues = new Set([MappingStatus.UNMAPPED, MappingStatus.MISSING_IFC_FILE, MappingStatus.IFC_OBJECT_MISSING]);
  const mappingResolved = new Set([MappingStatus.MAPPED, MappingStatus.MAPPED_BY_CODE]);
  const problemStatuses = new Set(["Warning", "Fault", "Offline"]);
  const nearMatchSet = buildNearMatchSet(filters, options.spatialIndex);
  const results = assets.filter((asset) => {
    const haystack = normalize(
      [
        asset.assetCode,
        asset.name,
        asset.type,
        asset.buildingName,
        asset.floor,
        asset.room,
        asset.ifcGuid,
        asset.ifcObject?.objectName,
        asset.ifcObject?.objectType,
        asset.status,
        asset.statusReason,
        asset.mappingStatus,
        asset.completenessStatus,
      ].join(" "),
    );
    return (
      (!needle || haystack.includes(needle)) &&
      (!filters.buildingId || asset.buildingId === filters.buildingId) &&
      (!filters.type || asset.type === filters.type) &&
      (!filters.mappingStatus || asset.mappingStatus === filters.mappingStatus) &&
      (!filters.mappingIssue || mappingIssues.has(asset.mappingStatus)) &&
      (!filters.mappingResolved || mappingResolved.has(asset.mappingStatus)) &&
      (!filters.status || asset.status === filters.status) &&
      (!filters.problemOnly || problemStatuses.has(asset.status)) &&
      (!filters.near ||
        (nearMatchSet
          ? nearMatchSet.has(asset.id)
          : filters.near.buildingId
            ? asset.buildingId === filters.near.buildingId
            : true)) &&
      (!filters.completenessStatus || asset.completenessStatus === filters.completenessStatus) &&
      (!filters.qualityIssue || getAssetQualityIssue(asset) === filters.qualityIssue)
    );
  });
  if (filters.near && nearMatchSet instanceof Map) {
    return results.sort((a, b) => (nearMatchSet.get(a.id) || Infinity) - (nearMatchSet.get(b.id) || Infinity));
  }
  return results;
}
