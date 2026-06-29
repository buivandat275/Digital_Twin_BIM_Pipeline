import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Database, Layers, Loader2 } from "lucide-react";
import { AssetDetailPanel } from "../components/assets/AssetDetailPanel.jsx";
import { AssetList } from "../components/assets/AssetList.jsx";
import { BuildingDetailPanel } from "../components/buildings/BuildingDetailPanel.jsx";
import { OsmMap } from "../components/map/OsmMap.jsx";
import { DataQualityPanel } from "../components/quality/DataQualityPanel.jsx";
import { IfcViewerPanel } from "../components/viewer/IfcViewerPanel.jsx";
import { createJsonTwinRepository } from "../core/repositories/jsonTwinRepository.js";
import { mergeAssetRegisters } from "../core/services/assetRegisterImportService.js";
import { buildAssetViewModel, normalizeBuilding } from "../core/services/assetService.js";
import { assessDataQuality } from "../core/services/dataQualityService.js";
import { buildMapData, getMapConfig } from "../core/services/mapDataService.js";
import { parseNaturalLanguageSearch } from "../core/services/naturalLanguageSearchService.js";
import { searchAssets } from "../core/services/searchService.js";
import { createSpatialIndex } from "../core/services/spatialIndexService.js";

const repository = createJsonTwinRepository();

function asIfcFiles(filePayload) {
  return (filePayload?.ifcFiles || []).map((file) => ({
    ...file,
    source: "output",
  }));
}

function findFirstAssetForBuilding(assets, buildingId) {
  return assets.find((asset) => asset.buildingId === buildingId) || assets[0] || null;
}

function zoomForRadius(radiusMeters, currentZoom) {
  const radius = Number(radiusMeters || 0);
  if (radius >= 5000) return 12;
  if (radius >= 2000) return 14;
  if (radius >= 800) return 15;
  if (radius >= 250) return 16;
  if (radius > 0) return 17;
  return currentZoom;
}

async function refineIntentWithQwen(query, fallback, assets, buildings, typeOptions) {
  const catalog = {
    buildings: buildings.map((building) => ({
      id: building.id,
      code: building.code,
      name: building.name,
      latitude: building.latitude,
      longitude: building.longitude,
    })),
    assets: assets.map((asset) => ({
      id: asset.id,
      assetCode: asset.assetCode,
      name: asset.name,
      type: asset.type,
      buildingId: asset.buildingId,
      buildingName: asset.buildingName,
      floor: asset.floor,
      room: asset.room,
      status: asset.status,
      mappingStatus: asset.mappingStatus,
      latitude: asset.latitude,
      longitude: asset.longitude,
      hasTrustedLatLon: asset.hasTrustedLatLon,
    })),
    typeOptions,
  };
  const response = await fetch("/api/integration/nl-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, catalog, fallback }),
  });
  if (!response.ok) throw new Error(`NL search failed: HTTP ${response.status}`);
  return response.json();
}

export function IntegrationApp() {
  const mapConfig = useMemo(() => getMapConfig(), []);
  const [buildings, setBuildings] = useState([]);
  const [rawAssets, setRawAssets] = useState([]);
  const [ifcObjects, setIfcObjects] = useState([]);
  const [files, setFiles] = useState([]);
  const [filters, setFilters] = useState({
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
  });
  const [lastImportJob, setLastImportJob] = useState(null);
  const [query, setQuery] = useState("");
  const [naturalLanguageQuery, setNaturalLanguageQuery] = useState("");
  const [naturalLanguageResult, setNaturalLanguageResult] = useState("");
  const [naturalLanguageEvidence, setNaturalLanguageEvidence] = useState(null);
  const [qwenEnabled, setQwenEnabled] = useState(true);
  const [qwenStatus, setQwenStatus] = useState({
    status: "unknown",
    source: "rules",
    model: "qwen2.5:1.5b",
    endpoint: "http://127.0.0.1:11434/api/generate",
    message: "Qwen status has not been checked.",
  });
  const [selectedBuildingId, setSelectedBuildingId] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [mapCenter, setMapCenter] = useState(mapConfig.center);
  const [mapZoom, setMapZoom] = useState(mapConfig.zoom);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");
        const [rawBuildings, rawAssets, rawIfcObjects, rawFiles] = await Promise.all([
          repository.getBuildings(),
          repository.getAssets(),
          repository.getIfcObjects(),
          repository.getFiles(),
        ]);
        if (cancelled) return;
        const ifcFiles = asIfcFiles(rawFiles);
        const normalizedBuildings = rawBuildings.map(normalizeBuilding);
        const normalizedAssets = buildAssetViewModel(rawAssets, normalizedBuildings, ifcFiles, rawIfcObjects);
        const firstBuilding = normalizedBuildings[0] || null;
        const firstAsset = findFirstAssetForBuilding(normalizedAssets, firstBuilding?.id);

        setBuildings(normalizedBuildings);
        setRawAssets(rawAssets);
        setIfcObjects(rawIfcObjects);
        setFiles(ifcFiles);
        setSelectedBuildingId(firstBuilding?.id || "");
        setSelectedAssetId(firstAsset?.id || "");
        if (firstBuilding) {
          setMapCenter({ latitude: firstBuilding.latitude, longitude: firstBuilding.longitude });
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Cannot load integration data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    checkQwenStatus();
  }, []);

  const assets = useMemo(
    () => buildAssetViewModel(rawAssets, buildings, files, ifcObjects),
    [buildings, files, ifcObjects, rawAssets],
  );

  const spatialIndex = useMemo(
    () => createSpatialIndex(assets, buildings, { cellSizeMeters: 250 }),
    [assets, buildings],
  );

  const selectedBuilding = useMemo(
    () => buildings.find((building) => building.id === selectedBuildingId) || buildings[0] || null,
    [buildings, selectedBuildingId],
  );

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) || findFirstAssetForBuilding(assets, selectedBuilding?.id),
    [assets, selectedAssetId, selectedBuilding?.id],
  );

  const visibleAssets = useMemo(
    () => searchAssets(assets, query, filters, { spatialIndex }),
    [assets, filters, query, spatialIndex],
  );

  const buildingAssets = useMemo(
    () => assets.filter((asset) => asset.buildingId === selectedBuilding?.id),
    [assets, selectedBuilding?.id],
  );

  const mapData = useMemo(() => buildMapData(buildings, assets), [assets, buildings]);
  const highlightedAssetIds = useMemo(
    () => new Set(filters.near ? visibleAssets.map((asset) => asset.id) : []),
    [filters.near, visibleAssets],
  );
  const spatialSummary = useMemo(() => {
    if (!filters.near) return "";
    const radius = Number(filters.near.radiusMeters || 0);
    const radiusLabel = radius >= 1000 ? `${Number((radius / 1000).toFixed(2))} km` : `${Math.round(radius)} m`;
    const anchor = filters.near.anchorAssetCode || "selected location";
    return `${visibleAssets.length} asset(s) within ${radiusLabel} around ${anchor}.`;
  }, [filters.near, visibleAssets.length]);
  const dataQualityReport = useMemo(
    () => assessDataQuality(assets, ifcObjects, buildings),
    [assets, buildings, ifcObjects],
  );

  const selectedModelFile = useMemo(() => {
    if (!selectedBuilding?.ifcFile) return null;
    return files.find((file) => file.name === selectedBuilding.ifcFile) || null;
  }, [files, selectedBuilding?.ifcFile]);

  const typeOptions = useMemo(
    () => Array.from(new Set(assets.map((asset) => asset.type).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [assets],
  );

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "mappingStatus" ? { mappingIssue: false, mappingResolved: false } : {}),
    }));
  }

  function clearFilters() {
    setFilters({
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
    });
    setQuery("");
    setNaturalLanguageResult("");
    setNaturalLanguageEvidence(null);
  }

  function focusSpatialView(near) {
    if (!near || !Number.isFinite(Number(near.latitude)) || !Number.isFinite(Number(near.longitude))) return;
    setMapCenter({ latitude: Number(near.latitude), longitude: Number(near.longitude) });
    setMapZoom((current) => zoomForRadius(near.radiusMeters, current));
  }

  function applyQualityFilter(qualityIssue) {
    setFilters({
      buildingId: "",
      type: "",
      mappingStatus: "",
      completenessStatus: "",
      qualityIssue,
      mappingIssue: false,
      mappingResolved: false,
      status: "",
      problemOnly: false,
      near: null,
    });
    setQuery("");
  }

  function importAssets(importedAssets, job) {
    setRawAssets((current) => mergeAssetRegisters(current, importedAssets));
    setLastImportJob(job);
    const firstImported = importedAssets[0];
    if (firstImported?.assetCode) {
      setSelectedAssetId(firstImported.id || firstImported.assetCode);
    }
  }

  async function checkQwenStatus() {
    try {
      const response = await fetch("/api/integration/llm-status");
      if (!response.ok) throw new Error(`LLM status failed: HTTP ${response.status}`);
      setQwenStatus(await response.json());
    } catch (statusError) {
      setQwenStatus((current) => ({
        ...current,
        status: "offline",
        source: "rules",
        message: statusError.message,
      }));
    }
  }

  async function runNaturalLanguageSearch() {
    const fallbackIntent = parseNaturalLanguageSearch(naturalLanguageQuery, {
      assets,
      buildings,
      typeOptions,
    });
    let intent = fallbackIntent;
    if (qwenEnabled) try {
      intent = await refineIntentWithQwen(naturalLanguageQuery, fallbackIntent, assets, buildings, typeOptions);
    } catch (intentError) {
      intent = {
        ...fallbackIntent,
        source: "rules",
        llmError: intentError.message,
        explanation: `${fallbackIntent.explanation} Qwen unavailable; used rule fallback.`,
      };
    }
    else {
      intent = {
        ...fallbackIntent,
        source: "rules",
        explanation: `${fallbackIntent.explanation} Qwen disabled; used rule parser.`,
      };
    }
    setFilters(intent.filters);
    setQuery(intent.query);
    setNaturalLanguageEvidence({
      source: intent.source || "rules",
      qwenEnabled,
      qwenStatus,
      llmError: intent.llmError || "",
      fallbackIntent,
      llmEvidence: intent.llmEvidence || null,
      finalIntent: {
        action: intent.action,
        query: intent.query,
        targetAssetId: intent.targetAssetId,
        targetBuildingId: intent.targetBuildingId,
        filters: intent.filters,
      },
    });

    const results = searchAssets(assets, intent.query, intent.filters, { spatialIndex });
    const targetAsset = results.find((asset) => asset.id === intent.targetAssetId) || results[0] || null;
    const targetBuilding = buildings.find((building) => building.id === intent.targetBuildingId) || null;

    if (targetAsset) {
      focusAsset(targetAsset);
      if (intent.filters?.near) focusSpatialView(intent.filters.near);
      if (intent.action === "openIfc") setViewerOpen(true);
      setNaturalLanguageResult(`${intent.explanation} Source: ${intent.source || "rules"}. ${results.length} asset result(s).`);
      return;
    }

    if (targetBuilding) {
      setSelectedBuildingId(targetBuilding.id);
      if (intent.filters?.near) focusSpatialView(intent.filters.near);
      else setMapCenter({ latitude: targetBuilding.latitude, longitude: targetBuilding.longitude });
      setNaturalLanguageResult(`${intent.explanation} Source: ${intent.source || "rules"}. No asset matched; focused building.`);
      return;
    }

    if (intent.filters?.near) focusSpatialView(intent.filters.near);

    setNaturalLanguageResult(`${intent.explanation} Source: ${intent.source || "rules"}. ${results.length} asset result(s).`);
  }

  function focusBuilding(building) {
    setSelectedBuildingId(building.id);
    setFilters((current) => ({
      ...current,
      buildingId: building.id,
      mappingIssue: false,
      mappingResolved: false,
      near: null,
    }));
    const firstAsset = findFirstAssetForBuilding(assets, building.id);
    setSelectedAssetId(firstAsset?.id || "");
    setViewerOpen(false);
    setMapCenter({ latitude: building.latitude, longitude: building.longitude });
  }

  function focusAsset(asset) {
    const building = buildings.find((item) => item.id === asset.buildingId) || null;
    setSelectedAssetId(asset.id);
    if (building) setSelectedBuildingId(building.id);
    setMapCenter(
      asset.hasTrustedLatLon
        ? { latitude: asset.latitude, longitude: asset.longitude }
        : { latitude: building?.latitude || mapConfig.center.latitude, longitude: building?.longitude || mapConfig.center.longitude },
    );
  }

  function openIfc(asset) {
    focusAsset(asset);
    setViewerOpen(true);
  }

  return (
    <main className="integration-shell">
      <header className="integration-header">
        <div className="integration-brand">
          <span className="integration-brand-mark">
            <Layers size={22} />
          </span>
          <div>
            <h1>Asset Integration Core</h1>
            <p>IFC + asset register + location data, exposed through map and detail workflows.</p>
          </div>
        </div>
        <div className="integration-header-stats">
          <span>
            <Database size={15} />
            {buildings.length} buildings
          </span>
          <span>{assets.length} assets</span>
          <span>{ifcObjects.length} IFC refs</span>
          <span>{files.length} IFC files</span>
        </div>
      </header>

      {loading ? (
        <div className="integration-loading">
          <Loader2 className="spin" size={22} />
          <span>Loading integration data...</span>
        </div>
      ) : error ? (
        <div className="integration-loading error">
          <AlertTriangle size={22} />
          <span>{error}</span>
        </div>
      ) : (
        <div className="integration-workspace">
          <AssetList
            assets={visibleAssets}
            buildings={buildings}
            filters={filters}
            importJob={lastImportJob}
            naturalLanguageQuery={naturalLanguageQuery}
            naturalLanguageEvidence={naturalLanguageEvidence}
            naturalLanguageResult={naturalLanguageResult}
            qwenEnabled={qwenEnabled}
            qwenStatus={qwenStatus}
            spatialSummary={spatialSummary}
            onClearFilters={clearFilters}
            onCheckQwen={checkQwenStatus}
            onFilterChange={updateFilter}
            onImportAssets={importAssets}
            onNaturalLanguageChange={setNaturalLanguageQuery}
            onNaturalLanguageSubmit={runNaturalLanguageSearch}
            onQueryChange={setQuery}
            onSelectAsset={focusAsset}
            onToggleQwen={() => setQwenEnabled((current) => !current)}
            query={query}
            selectedAssetId={selectedAsset?.id}
            typeOptions={typeOptions}
          />

          <section className="integration-stage">
            <OsmMap
              assetMarkers={mapData.assetMarkers}
              buildingMarkers={mapData.buildingMarkers}
              center={mapCenter}
              config={mapConfig}
              highlightedAssetIds={highlightedAssetIds}
              onCenterChange={setMapCenter}
              onSelectAsset={focusAsset}
              onSelectBuilding={focusBuilding}
              onZoomChange={setMapZoom}
              selectedAssetId={selectedAsset?.id}
              selectedBuildingId={selectedBuilding?.id}
              searchCircle={filters.near}
              zoom={mapZoom}
            />
            <div className="integration-stage-bottom">
              <BuildingDetailPanel assetCount={buildingAssets.length} building={selectedBuilding} />
              <AssetDetailPanel asset={selectedAsset} building={selectedBuilding} files={files} onOpenIfc={openIfc} />
              <DataQualityPanel
                onApplyQualityFilter={applyQualityFilter}
                onSelectAsset={focusAsset}
                report={dataQualityReport}
              />
            </div>
          </section>

          <IfcViewerPanel
            asset={selectedAsset}
            building={selectedBuilding}
            modelFile={selectedModelFile}
            onClose={() => setViewerOpen(false)}
            open={viewerOpen}
          />
        </div>
      )}
    </main>
  );
}
