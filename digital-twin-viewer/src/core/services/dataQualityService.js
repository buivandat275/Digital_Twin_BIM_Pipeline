import { CompletenessStatus, MappingStatus } from "../domain/models.js";
import { normalizeIfcObject } from "./mappingService.js";

function text(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return text(value).toLowerCase();
}

function hasMetadata(asset) {
  return asset.metadata && typeof asset.metadata === "object" && Object.keys(asset.metadata).length > 0;
}

function isMapped(asset) {
  return [MappingStatus.MAPPED, MappingStatus.MAPPED_BY_CODE].includes(asset.mappingStatus);
}

export function getAssetQualityIssue(asset) {
  if (asset.completenessStatus === CompletenessStatus.MISSING_BUILDING) return "missingBuilding";
  if (asset.completenessStatus === CompletenessStatus.MISSING_LOCATION) return "missingLocation";
  if (asset.mappingStatus === MappingStatus.IFC_OBJECT_MISSING) return "ifcObjectMissing";
  if ([MappingStatus.UNMAPPED, MappingStatus.MISSING_IFC_FILE].includes(asset.mappingStatus)) return "unmappedAsset";
  if (!hasMetadata(asset)) return "missingMetadata";
  return "";
}

export function assessDataQuality(assets = [], ifcObjects = [], buildings = []) {
  const buildingIds = new Set(buildings.map((building) => building.id));
  const assetCodes = new Set(assets.map((asset) => key(asset.assetCode)).filter(Boolean));
  const assetGuids = new Set(assets.map((asset) => key(asset.ifcGuid)).filter(Boolean));
  const normalizedIfcObjects = ifcObjects.map(normalizeIfcObject);

  const unmappedAssets = assets.filter((asset) =>
    [MappingStatus.UNMAPPED, MappingStatus.MISSING_IFC_FILE, MappingStatus.IFC_OBJECT_MISSING].includes(asset.mappingStatus),
  );
  const missingLocationAssets = assets.filter((asset) => asset.completenessStatus === CompletenessStatus.MISSING_LOCATION);
  const missingBuildingAssets = assets.filter(
    (asset) => asset.completenessStatus === CompletenessStatus.MISSING_BUILDING || !buildingIds.has(asset.buildingId),
  );
  const missingMetadataAssets = assets.filter((asset) => !hasMetadata(asset));
  const unmatchedIfcObjects = normalizedIfcObjects.filter((ifcObject) => {
    const guidMatched = ifcObject.ifcGuid && assetGuids.has(key(ifcObject.ifcGuid));
    const codeMatched = ifcObject.assetCode && assetCodes.has(key(ifcObject.assetCode));
    return !guidMatched && !codeMatched;
  });

  const issueAssetIds = new Set(
    [...unmappedAssets, ...missingLocationAssets, ...missingBuildingAssets, ...missingMetadataAssets].map((asset) => asset.id),
  );
  const issueCount = issueAssetIds.size + unmatchedIfcObjects.length;
  const score = assets.length + normalizedIfcObjects.length
    ? Math.max(0, Math.round(100 - (issueCount / (assets.length + normalizedIfcObjects.length)) * 100))
    : 100;

  return {
    score,
    summary: {
      totalAssets: assets.length,
      totalIfcObjects: normalizedIfcObjects.length,
      mappedAssets: assets.filter(isMapped).length,
      issueCount,
    },
    groups: {
      unmappedAssets,
      unmatchedIfcObjects,
      missingMetadataAssets,
      missingLocationAssets,
      missingBuildingAssets,
    },
  };
}
