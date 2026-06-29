const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE_LAT = 111320;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function hasCoordinate(item) {
  return toNumber(item?.latitude) !== null && toNumber(item?.longitude) !== null;
}

export function distanceMeters(a, b) {
  if (!hasCoordinate(a) || !hasCoordinate(b)) return Infinity;
  const lat1 = (Number(a.latitude) * Math.PI) / 180;
  const lat2 = (Number(b.latitude) * Math.PI) / 180;
  const dLat = ((Number(b.latitude) - Number(a.latitude)) * Math.PI) / 180;
  const dLon = ((Number(b.longitude) - Number(a.longitude)) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function longitudeCellSize(latitude, cellSizeMeters) {
  const latRad = (Number(latitude || 0) * Math.PI) / 180;
  const metersPerDegreeLon = Math.max(1, METERS_PER_DEGREE_LAT * Math.cos(latRad));
  return cellSizeMeters / metersPerDegreeLon;
}

function getCell(point, cellSizeMeters) {
  const latSize = cellSizeMeters / METERS_PER_DEGREE_LAT;
  const lonSize = longitudeCellSize(point.latitude, cellSizeMeters);
  return {
    x: Math.floor(Number(point.longitude) / lonSize),
    y: Math.floor(Number(point.latitude) / latSize),
    latSize,
    lonSize,
  };
}

function assetPoint(asset, buildingIndex = new Map()) {
  if (asset.hasTrustedLatLon && hasCoordinate(asset)) {
    return {
      latitude: Number(asset.latitude),
      longitude: Number(asset.longitude),
      coordinateSource: asset.coordinateSource || "trusted-asset",
    };
  }
  const building = buildingIndex.get(asset.buildingId);
  if (hasCoordinate(building)) {
    return {
      latitude: Number(building.latitude),
      longitude: Number(building.longitude),
      coordinateSource: "building-inherited",
    };
  }
  return null;
}

export function getAssetSpatialPoint(asset, buildings = []) {
  const buildingIndex = Array.isArray(buildings)
    ? new Map(buildings.map((building) => [building.id, building]))
    : buildings;
  return assetPoint(asset, buildingIndex);
}

export function createSpatialIndex(assets = [], buildings = [], options = {}) {
  const cellSizeMeters = Number(options.cellSizeMeters || 250);
  const buildingIndex = new Map(buildings.map((building) => [building.id, building]));
  const cells = new Map();
  const points = new Map();

  assets.forEach((asset) => {
    const point = assetPoint(asset, buildingIndex);
    if (!point) return;
    const cell = getCell(point, cellSizeMeters);
    const key = `${cell.x}:${cell.y}`;
    const entry = { asset, point };
    points.set(asset.id, entry);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(entry);
  });

  return {
    cellSizeMeters,
    cells,
    points,
    size: points.size,
  };
}

export function querySpatialIndex(index, center, radiusMeters, options = {}) {
  if (!index || !hasCoordinate(center)) return [];
  const radius = Number(radiusMeters || 0);
  if (!Number.isFinite(radius) || radius <= 0) return [];

  const centerPoint = {
    latitude: Number(center.latitude),
    longitude: Number(center.longitude),
  };
  const centerCell = getCell(centerPoint, index.cellSizeMeters);
  const searchCells = Math.max(1, Math.ceil(radius / index.cellSizeMeters) + 1);
  const results = [];

  for (let x = centerCell.x - searchCells; x <= centerCell.x + searchCells; x += 1) {
    for (let y = centerCell.y - searchCells; y <= centerCell.y + searchCells; y += 1) {
      const entries = index.cells.get(`${x}:${y}`) || [];
      entries.forEach((entry) => {
        if (!options.includeAnchor && options.anchorAssetId && entry.asset.id === options.anchorAssetId) return;
        const distance = distanceMeters(centerPoint, entry.point);
        if (distance <= radius) {
          results.push({
            asset: entry.asset,
            point: entry.point,
            distanceMeters: distance,
          });
        }
      });
    }
  }

  return results.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
