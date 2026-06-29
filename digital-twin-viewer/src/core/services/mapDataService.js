export const DEFAULT_MAP_CONFIG = Object.freeze({
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "OpenStreetMap contributors",
  center: { latitude: 21.0278, longitude: 105.8342 },
  zoom: 17,
});

export function getMapConfig() {
  const [lat, lon] = String(import.meta.env.VITE_DEFAULT_MAP_CENTER || "")
    .split(",")
    .map((value) => Number(value.trim()));
  return {
    tileUrl: import.meta.env.VITE_MAP_TILE_URL || DEFAULT_MAP_CONFIG.tileUrl,
    attribution: import.meta.env.VITE_MAP_ATTRIBUTION || DEFAULT_MAP_CONFIG.attribution,
    center:
      Number.isFinite(lat) && Number.isFinite(lon)
        ? { latitude: lat, longitude: lon }
        : DEFAULT_MAP_CONFIG.center,
    zoom: Number(import.meta.env.VITE_DEFAULT_MAP_ZOOM || DEFAULT_MAP_CONFIG.zoom),
  };
}

function hasLatLon(item) {
  return Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude));
}

export function buildMapData(buildings, assets) {
  const buildingIndex = new Map(buildings.map((building) => [building.id, building]));
  const buildingMarkers = buildings.filter(hasLatLon).map((building) => ({
    id: building.id,
    kind: "building",
    label: building.name,
    latitude: building.latitude,
    longitude: building.longitude,
    geometry: building.geometry,
    data: building,
  }));
  const assetMarkers = assets
    .map((asset) => {
      if (asset.hasTrustedLatLon && hasLatLon(asset)) {
        return {
          id: asset.id,
          kind: "asset",
          label: asset.assetCode,
          latitude: asset.latitude,
          longitude: asset.longitude,
          coordinateSource: asset.coordinateSource || "trusted-asset",
          data: asset,
        };
      }
      const building = buildingIndex.get(asset.buildingId);
      if (!hasLatLon(building)) return null;
      return {
        id: asset.id,
        kind: "asset",
        label: asset.assetCode,
        latitude: building.latitude,
        longitude: building.longitude,
        coordinateSource: "building-inherited",
        data: asset,
      };
    })
    .filter(Boolean);
  return { buildingMarkers, assetMarkers };
}
