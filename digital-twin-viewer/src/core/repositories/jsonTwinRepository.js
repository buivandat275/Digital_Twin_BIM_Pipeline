async function readJson(url, fallback) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
  return response.json().catch(() => fallback);
}

export function createJsonTwinRepository() {
  return {
    getBuildings: () => readJson("/api/integration/buildings", []),
    getAssets: () => readJson("/api/integration/assets", []),
    getIfcObjects: () => readJson("/api/integration/ifc-objects", []),
    getFiles: () => readJson("/api/files", { ifcFiles: [] }),
  };
}
