import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Box,
  Building2,
  CheckCircle2,
  Cloud,
  Database,
  Eye,
  FileCode2,
  Layers3,
  Loader2,
  Maximize2,
  MousePointer2,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import "./styles.css";

const FIELD_ORDER = [
  "asset_id",
  "asset_name",
  "asset_type",
  "ifc_class",
  "system",
  "location",
  "floor",
  "room_zone",
  "manufacturer",
  "model",
  "serial_number",
  "status",
  "source_global_id",
  "source_file",
];

const PICKED_COLOR = new THREE.Color(0xf59e0b);

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}

function valueOf(input) {
  if (input && typeof input === "object" && "value" in input) return input.value;
  return input ?? "";
}

function normalizeIfcValue(value, depth = 0) {
  if (depth > 4) return "[Nested data]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => normalizeIfcValue(item, depth + 1));
  if (typeof value !== "object") return value;
  if ("value" in value && Object.keys(value).length <= 3) return normalizeIfcValue(value.value, depth + 1);

  const normalized = {};
  Object.entries(value).slice(0, 120).forEach(([key, nestedValue]) => {
    if (typeof nestedValue !== "function") normalized[key] = normalizeIfcValue(nestedValue, depth + 1);
  });
  return normalized;
}

function buildAssetIndex(assets) {
  const index = new Map();
  assets.forEach((asset) => {
    const globalId = asset.source_global_id || asset.GlobalId || asset.global_id;
    if (globalId) index.set(globalId, asset);
  });
  return index;
}

function normalizeOdaProperties(properties = []) {
  if (!Array.isArray(properties)) return properties && typeof properties === "object" ? properties : {};
  const normalized = {}
  for (let index = 0; index < properties.length; index += 2) {
    const groupName = properties[index];
    const groupValue = properties[index + 1];
    if (typeof groupName === "string" && groupValue && typeof groupValue === "object") {
      normalized[groupName] = groupValue;
    }
  }
  return normalized;
}

function apsPropertiesToObject(properties = []) {
  const normalized = {};
  (properties || []).forEach((property) => {
    const category = property.displayCategory || property.category || "Properties";
    if (!normalized[category]) normalized[category] = {};
    normalized[category][property.displayName || property.attributeName || property.name] = property.displayValue ?? property.value ?? "";
  });
  return normalized;
}

function getGlobalIdFromApsProperties(properties = [], externalId = "") {
  const candidates = [
    "GlobalId",
    "Global ID",
    "IfcGUID",
    "IfcGuid",
    "IFC GUID",
    "IFCParameters.IfcGUID",
    "Identity Data.GlobalId",
  ];
  for (const property of properties || []) {
    const names = [property.displayName, property.attributeName, property.name].filter(Boolean);
    if (names.some((name) => candidates.includes(name))) {
      const value = property.displayValue ?? property.value;
      if (value) return String(value);
    }
  }
  return externalId || "";
}

function buildSourcePropertyIndex(payload) {
  const index = new Map();

  function walk(node) {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;

    const properties = normalizeOdaProperties(node.properties);
    const ifcGuid = properties["IFC Parameters"]?.IfcGUID || properties["IFC Parameters"]?.["IfcGUID"];
    const globalId = ifcGuid || node.GlobalId || node.globalId;
    if (globalId && Object.keys(properties).length) {
      index.set(globalId, {
        name: node.name || properties["Identity Data"]?.Name || globalId,
        externalId: node.externalId || "",
        objectId: node.object || node.objectId || "",
        properties,
      });
    }

    Object.entries(node).forEach(([key, value]) => {
      if (key !== "properties") walk(value);
    });
  }

  walk(payload);
  return index;
}

function propertyRows(object, asset) {
  const rows = [];
  if (object) {
    rows.push(["Local ID", object.localId]);
    rows.push(["GlobalId", object.globalId || ""]);
    rows.push(["IFC Type", object.ifcType || ""]);
    rows.push(["Name", object.name || ""]);
  }
  if (asset) {
    FIELD_ORDER.forEach((key) => {
      if (asset[key] !== undefined && asset[key] !== null && asset[key] !== "") {
        rows.push([key.replaceAll("_", " "), String(asset[key])]);
      }
    });
  }
  return rows;
}

function App() {
  const [files, setFiles] = useState({ ifcFiles: [], metadataFiles: [] });
  const [apsModels, setApsModels] = useState([]);
  const [uploadedIfcFiles, setUploadedIfcFiles] = useState([]);
  const [assets, setAssets] = useState([]);
  const [viewerMode, setViewerMode] = useState("ifc");
  const [selectedFileKey, setSelectedFileKey] = useState("");
  const [selectedApsKey, setSelectedApsKey] = useState("");
  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [sourcePropertyIndex, setSourcePropertyIndex] = useState(new Map());
  const [selectedSourceProperties, setSelectedSourceProperties] = useState(null);
  const [viewerState, setViewerState] = useState({
    status: "Idle",
    message: "Choose an IFC model to start.",
    progress: 0,
  });
  const [search, setSearch] = useState("");
  const viewerRef = useRef(null);

  const allIfcFiles = useMemo(
    () => [
      ...(files.ifcFiles || []).map((file) => ({ ...file, key: `output:${file.name}`, source: "output" })),
      ...uploadedIfcFiles.map((file) => ({ ...file, key: `upload:${file.name}`, source: "upload" })),
    ],
    [files.ifcFiles, uploadedIfcFiles],
  );
  const selectedModel = useMemo(
    () => allIfcFiles.find((file) => file.key === selectedFileKey) || null,
    [allIfcFiles, selectedFileKey],
  );
  const selectedApsModel = useMemo(
    () => apsModels.find((file) => file.key === selectedApsKey) || null,
    [apsModels, selectedApsKey],
  );
  const assetIndex = useMemo(() => buildAssetIndex(assets), [assets]);
  const mappedAssets = useMemo(() => assets.filter((item) => item.source_global_id), [assets]);
  const filteredAssets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return mappedAssets.slice(0, 80);
    return mappedAssets
      .filter((asset) =>
        [asset.asset_id, asset.asset_name, asset.ifc_class, asset.system, asset.location, asset.source_global_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 80);
  }, [mappedAssets, search]);

  useEffect(() => {
    async function bootstrap() {
      const [fileRes, assetRes, apsRes] = await Promise.all([
        fetch("/api/files"),
        fetch("/api/assets"),
        fetch("/api/aps/models"),
      ]);
      const fileData = await fileRes.json();
      const assetData = await assetRes.json();
      const apsData = await apsRes.json();
      setFiles(fileData);
      setAssets(assetData);
      setApsModels(apsData);
      if (fileData.ifcFiles?.length) setSelectedFileKey(`output:${fileData.ifcFiles[0].name}`);
      if (apsData?.length) {
        setSelectedApsKey(apsData[0].key);
        setViewerMode("aps");
      }
    }
    bootstrap().catch((error) => {
      setViewerState({ status: "Error", message: error.message, progress: 0 });
    });
  }, []);

  useEffect(() => {
    setSelectedObject(null);
    setSelectedAsset(null);
    setSelectedSourceProperties(null);
    if (viewerMode !== "ifc" || !selectedModel || selectedModel.source !== "output") {
      setSourcePropertyIndex(new Map());
      return;
    }

    async function loadSourceProperties() {
      const jsonName = selectedModel.name.replace(/\.ifc$/i, ".json");
      const response = await fetch(`/bim-output/${encodeURIComponent(jsonName)}`);
      if (!response.ok) {
        setSourcePropertyIndex(new Map());
        return;
      }
      const payload = await response.json();
      setSourcePropertyIndex(buildSourcePropertyIndex(payload));
    }

    loadSourceProperties().catch(() => setSourcePropertyIndex(new Map()));
  }, [selectedModel, viewerMode]);

  function handleIfcUpload(event) {
    const nextFiles = Array.from(event.target.files || [])
      .filter((file) => file.name.toLowerCase().endsWith(".ifc"))
      .map((file) => ({
        key: `upload:${file.name}`,
        source: "upload",
        name: file.name,
        size: file.size,
        updatedAt: new Date(file.lastModified || Date.now()).toISOString(),
        file,
      }));
    if (!nextFiles.length) return;
    setUploadedIfcFiles((current) => {
      const byName = new Map(current.map((file) => [file.name, file]));
      nextFiles.forEach((file) => byName.set(file.name, file));
      return Array.from(byName.values()).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    });
    setSelectedFileKey(nextFiles[0].key);
    event.target.value = "";
  }

  const handleObjectPicked = useCallback((object) => {
    setSelectedObject(object);
    const globalId = object?.globalId;
    setSelectedAsset(globalId ? assetIndex.get(globalId) || null : null);
    setSelectedSourceProperties(globalId ? sourcePropertyIndex.get(globalId) || null : null);
  }, [assetIndex, sourcePropertyIndex]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Building2 size={22} />
          </div>
          <div>
            <h1>Digital Twin Viewer</h1>
            <p>IFC model, clean metadata, and object-level inspection</p>
          </div>
        </div>

        <div className="model-picker">
          <select className="mode-select" value={viewerMode} onChange={(event) => setViewerMode(event.target.value)}>
            <option value="ifc">Local IFC</option>
            <option value="aps">APS Cloud</option>
          </select>
          {viewerMode === "aps" && (
            <>
              <Cloud size={18} />
              <select value={selectedApsKey} onChange={(event) => setSelectedApsKey(event.target.value)}>
                {apsModels.map((file) => (
                  <option value={file.key} key={file.key}>
                    {file.sourceFile} - {file.format || "derivative"} - {file.status || "unknown"}
                  </option>
                ))}
              </select>
            </>
          )}
          {viewerMode === "ifc" && (
            <>
          <FileCode2 size={18} />
          <select value={selectedFileKey} onChange={(event) => setSelectedFileKey(event.target.value)}>
            {allIfcFiles.map((file) => (
              <option value={file.key} key={file.key}>
                {file.source === "upload" ? "[Upload] " : ""}
                {file.name} · {formatBytes(file.size)}
              </option>
            ))}
          </select>
          <label className="icon-button upload-button" title="Import IFC file">
            <Upload size={18} />
            <input type="file" accept=".ifc" multiple onChange={handleIfcUpload} />
          </label>
            </>
          )}
        </div>
      </header>

      <main className="workspace">
        <aside className="asset-rail">
          <section className="summary-band">
            <Metric icon={<Box size={18} />} label="IFC files" value={allIfcFiles.length} />
            <Metric icon={<Database size={18} />} label="Assets" value={assets.length} />
            <Metric icon={<Cloud size={18} />} label="APS models" value={apsModels.length} />
          </section>

          <div className="search-box">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search asset, class, GlobalId"
            />
          </div>

          <div className="asset-list">
            {filteredAssets.map((asset) => (
              <button
                className={`asset-row ${asset.source_global_id === selectedAsset?.source_global_id ? "active" : ""}`}
                key={`${asset.asset_id}-${asset.source_global_id}`}
                onClick={() => {
                  setSelectedAsset(asset);
                  setSelectedSourceProperties(
                    asset.source_global_id ? sourcePropertyIndex.get(asset.source_global_id) || null : null,
                  );
                  setSelectedObject(null);
                }}
              >
                <span className="asset-type">{asset.ifc_class || asset.asset_type || "Asset"}</span>
                <strong>{asset.asset_name || asset.asset_id}</strong>
                <span>{asset.location || asset.floor || "No location"}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="viewer-stage">
          <div className="viewer-toolbar">
            <StatusPill state={viewerState} />
            <button className="icon-button" title="Reset camera" onClick={() => viewerRef.current?.resetCamera()}>
              <RotateCcw size={18} />
            </button>
            <button className="icon-button" title="Fit model" onClick={() => viewerRef.current?.fitModel()}>
              <Maximize2 size={18} />
            </button>
          </div>

          {viewerMode === "aps" ? (
            <ApsViewerCanvas
              ref={viewerRef}
              apsModel={selectedApsModel}
              onPicked={handleObjectPicked}
              onStateChange={setViewerState}
            />
          ) : (
            <ThatOpenCanvas
              ref={viewerRef}
              modelFile={selectedModel}
              onPicked={handleObjectPicked}
              onStateChange={setViewerState}
            />
          )}

          <div className="viewer-hint">
            <MousePointer2 size={16} />
            <span>
              {viewerMode === "aps"
                ? "Click an APS object to read cloud properties and match clean Digital Twin metadata."
                : "Click an element to read IFC properties and match clean Digital Twin metadata."}
            </span>
          </div>
        </section>

        <aside className="property-panel">
          <section className="panel-head">
            <div>
              <span className="eyebrow">Selected Object</span>
              <h2>
                {selectedAsset?.asset_name ||
                  selectedSourceProperties?.name ||
                  selectedObject?.name ||
                  "No object selected"}
              </h2>
            </div>
            {selectedObject || selectedAsset || selectedSourceProperties ? (
              <CheckCircle2 className="ok" size={22} />
            ) : (
              <AlertTriangle className="warn" size={22} />
            )}
          </section>

          <section className="link-state">
            <Layers3 size={18} />
            <div>
              <strong>{selectedAsset ? "New DB metadata linked" : "Waiting for DB GlobalId match"}</strong>
              <span>
                {selectedAsset
                  ? "Clean asset data is available from mock Digital Twin store."
                  : "Click an IFC object. Old IFC properties can still be shown even when DB metadata is missing."}
              </span>
            </div>
          </section>

          <dl className="property-grid">
            {propertyRows(selectedObject, selectedAsset).map(([label, value]) => (
              <React.Fragment key={`${label}-${value}`}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>

          {selectedObject?.ifcProperties && (
            <JsonBlock
              title={viewerMode === "aps" ? "Old APS Cloud Properties" : "Old IFC Properties"}
              value={selectedObject.ifcProperties}
            />
          )}
          {selectedSourceProperties?.properties && (
            <JsonBlock title="Old Source Properties From ODA JSON" value={selectedSourceProperties.properties} />
          )}
          {selectedAsset && (
            <JsonBlock
              title="New DB Metadata"
              value={{
                ...selectedAsset,
                technical_properties: undefined,
                raw_metadata: undefined,
                quantity_properties: undefined,
                source_reference: undefined,
              }}
            />
          )}
          {selectedAsset?.technical_properties && (
            <JsonBlock title="New Technical Properties" value={selectedAsset.technical_properties} />
          )}
          {selectedAsset?.raw_metadata && <JsonBlock title="Raw Metadata" value={selectedAsset.raw_metadata} />}
        </aside>
      </main>
    </div>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusPill({ state }) {
  const loading = state.status === "Loading";
  return (
    <div className={`status-pill ${state.status.toLowerCase()}`}>
      {loading ? <Loader2 className="spin" size={17} /> : <Eye size={17} />}
      <span>{state.message}</span>
    </div>
  );
}

function JsonBlock({ title, value }) {
  const keys = Object.keys(value || {});
  if (!keys.length) return null;
  return (
    <section className="json-block">
      <h3>{title}</h3>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

const ApsViewerCanvas = React.forwardRef(function ApsViewerCanvas({ apsModel, onPicked, onStateChange }, ref) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const onPickedRef = useRef(onPicked);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onPickedRef.current = onPicked;
  }, [onPicked]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  React.useImperativeHandle(ref, () => ({
    fitModel: () => viewerRef.current?.fitToView(),
    resetCamera: () => viewerRef.current?.fitToView(),
  }));

  useEffect(() => {
    let cancelled = false;
    let viewer = null;

    async function loadApsModel() {
      if (!apsModel?.urn) {
        onStateChangeRef.current({ status: "Idle", message: "Choose an APS result to start.", progress: 0 });
        return;
      }
      if (!window.Autodesk?.Viewing) {
        onStateChangeRef.current({
          status: "Error",
          message: "Autodesk Viewer SDK was not loaded. Check internet/CDN access.",
          progress: 0,
        });
        return;
      }
      const container = containerRef.current;
      if (!container) return;

      onStateChangeRef.current({ status: "Loading", message: `Loading APS model ${apsModel.sourceFile}`, progress: 10 });
      const options = {
        env: "AutodeskProduction",
        api: "derivativeV2",
        getAccessToken: async (callback) => {
          const response = await fetch("/api/aps/token");
          const token = await response.json();
          if (!response.ok) throw new Error(token.error || "APS token request failed");
          callback(token.access_token, token.expires_in);
        },
      };

      await new Promise((resolve, reject) => {
        window.Autodesk.Viewing.Initializer(options, resolve, reject);
      });
      if (cancelled) return;

      viewer = new window.Autodesk.Viewing.GuiViewer3D(container, {
        extensions: ["Autodesk.DocumentBrowser"],
      });
      const started = viewer.start();
      if (started > 0) throw new Error(`Autodesk Viewer failed to start: ${started}`);
      viewerRef.current = viewer;

      viewer.addEventListener(window.Autodesk.Viewing.SELECTION_CHANGED_EVENT, (event) => {
        const dbId = event.dbIdArray?.[0];
        if (!dbId) return;
        viewer.getProperties(
          dbId,
          (props) => {
            const apsProperties = apsPropertiesToObject(props.properties || []);
            const globalId = getGlobalIdFromApsProperties(props.properties || [], props.externalId || "");
            onPickedRef.current({
              localId: dbId,
              globalId,
              ifcType: props.name || "APS object",
              name: props.name || `APS object ${dbId}`,
              ifcProperties: {
                externalId: props.externalId || "",
                dbId,
                properties: apsProperties,
              },
            });
            onStateChangeRef.current({
              status: "Ready",
              message: `Picked APS object ${globalId || props.externalId || dbId}`,
              progress: 100,
            });
          },
          (error) => {
            onStateChangeRef.current({ status: "Error", message: `APS property read failed: ${error}`, progress: 0 });
          },
        );
      });

      await new Promise((resolve, reject) => {
        window.Autodesk.Viewing.Document.load(
          `urn:${apsModel.urn}`,
          (doc) => {
            const viewable = doc.getRoot().getDefaultGeometry();
            viewer
              .loadDocumentNode(doc, viewable)
              .then(resolve)
              .catch(reject);
          },
          (code, message) => reject(new Error(`APS document load failed: ${message || code}`)),
        );
      });
      if (cancelled) return;
      viewer.fitToView();
      onStateChangeRef.current({ status: "Ready", message: `Loaded APS ${apsModel.sourceFile}`, progress: 100 });
    }

    loadApsModel().catch((error) => {
      if (!cancelled) onStateChangeRef.current({ status: "Error", message: error.message, progress: 0 });
    });

    return () => {
      cancelled = true;
      if (viewer) {
        viewer.finish();
        viewer = null;
      }
      viewerRef.current = null;
    };
  }, [apsModel]);

  return <div className="aps-viewer" ref={containerRef} />;
});

const ThatOpenCanvas = React.forwardRef(function ThatOpenCanvas({ modelFile, onPicked, onStateChange }, ref) {
  const containerRef = useRef(null);
  const componentsRef = useRef(null);
  const worldRef = useRef(null);
  const fragmentsRef = useRef(null);
  const fragmentsReadyRef = useRef(null);
  const modelRef = useRef(null);
  const loadedObjectRef = useRef(null);
  const pickedRef = useRef(null);
  const onPickedRef = useRef(onPicked);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onPickedRef.current = onPicked;
  }, [onPicked]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  React.useImperativeHandle(ref, () => ({
    fitModel: () => fitModel(),
    resetCamera: () => {
      const world = worldRef.current;
      if (!world?.camera) return;
      fitModel();
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    let disposed = false;
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container);
    world.camera = new OBC.SimpleCamera(components);
    components.init();
    world.scene.setup();
    world.scene.three.background = new THREE.Color(0xe8eef1);
    world.camera.controls.setLookAt(30, -30, 24, 0, 0, 0);

    // Keep the stage clean; dense MEP models are easier to read without a heavy ground grid.

    const fragments = components.get(OBC.FragmentsManager);
    componentsRef.current = components;
    worldRef.current = world;
    fragmentsRef.current = fragments;

    async function initFragments() {
      fragments.init("/fragments-worker/worker.mjs");
      world.camera.controls.addEventListener("update", () => fragments.core.update());
      world.camera.controls.addEventListener("rest", () => fragments.core.update(true));
      world.onCameraChanged.add((camera) => {
        for (const [, model] of fragments.list) model.useCamera(camera.three);
        fragments.core.update(true);
      });
      fragments.list.onItemSet.add(({ value: model }) => {
        model.useCamera(world.camera.three);
        world.scene.three.add(model.object);
        fragments.core.update(true);
      });
    }

    fragmentsReadyRef.current = initFragments();
    fragmentsReadyRef.current.catch((error) => {
      if (!disposed) onStateChangeRef.current({ status: "Error", message: error.message, progress: 0 });
    });

    async function pick(event) {
      const fragmentsManager = fragmentsRef.current;
      const worldState = worldRef.current;
      if (!fragmentsManager || !worldState?.renderer || !worldState?.camera) return;
      const canvas = worldState.renderer.three.domElement;
      const rect = canvas.getBoundingClientRect();
      let result = await pickWithAperture(event, rect, canvas, worldState.camera.three, fragmentsManager);
      if (!result) {
        onStateChangeRef.current({
          status: "Ready",
          message: "No object hit. Try clicking closer to a visible pipe/edge.",
          progress: 100,
        });
        return;
      }
      const model = result.fragments;
      const [globalId] = await model.getGuidsByLocalIds([result.localId]);
      try {
        if (pickedRef.current?.model && pickedRef.current.localId !== result.localId) {
          await pickedRef.current.model.resetColor([pickedRef.current.localId]);
        }
        await model.setColor([result.localId], PICKED_COLOR);
        pickedRef.current = { model, localId: result.localId };
        fragmentsManager.core.update(true);
      } catch {
        // Selection metadata still works even if a fragment version can't recolor one item.
      }
      let name = "";
      let ifcType = "";
      let ifcProperties = {};
      try {
        const data = await model.getItems([result.localId]);
        const item = data.get(result.localId);
        name = valueOf(item?.attrs?.Name) || "";
        ifcType = item?.category || "";
      } catch {
        // Some fragment data can be lazily unavailable; localId and guid are enough for matching.
      }
      try {
        const [itemData] = await model.getItemsData([result.localId], {
          attributesDefault: true,
          relations: {
            IsDefinedBy: { attributes: true, relations: true },
            DefinesOccurrence: { attributes: true, relations: true },
            HasAssociations: { attributes: true, relations: true },
          },
        });
        ifcProperties = normalizeIfcValue(itemData || {});
        name = name || valueOf(itemData?.Name) || valueOf(itemData?.Name?.value) || "";
        ifcType = ifcType || valueOf(itemData?._category) || "";
      } catch {
        // Old IFC properties are best-effort; DB matching still uses GlobalId.
      }
      onPickedRef.current({
        localId: result.localId,
        globalId: globalId || "",
        ifcType,
        name: name || `IFC object ${result.localId}`,
        ifcProperties,
      });
      onStateChangeRef.current({
        status: "Ready",
        message: `Picked ${globalId || `local ${result.localId}`}`,
        progress: 100,
      });
    }

    const canvas = world.renderer.three.domElement;
    canvas.addEventListener("click", pick);

    return () => {
      disposed = true;
      canvas.removeEventListener("click", pick);
      components.dispose();
      componentsRef.current = null;
      worldRef.current = null;
      fragmentsRef.current = null;
      fragmentsReadyRef.current = null;
      modelRef.current = null;
      loadedObjectRef.current = null;
    };
  }, []);

  async function pickWithAperture(event, rect, canvas, camera, fragmentsManager) {
    const model = modelRef.current;
    const radius = 14;
    const offsets = [
      [0, 0],
      [-4, 0],
      [4, 0],
      [0, -4],
      [0, 4],
      [-8, -8],
      [8, -8],
      [-8, 8],
      [8, 8],
      [-14, 0],
      [14, 0],
      [0, -14],
      [0, 14],
    ];

    const fastPicker = componentsRef.current?.get(OBC.FastModelPickers)?.get(worldRef.current);
    if (fastPicker) {
      let bestFastPick = null;
      for (const [offsetX, offsetY] of offsets) {
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left + offsetX) / rect.width) * 2 - 1,
          -((event.clientY - rect.top + offsetY) / rect.height) * 2 + 1,
        );
        const pick = await fastPicker.getFullPick(mouse);
        if (!pick) continue;
        if (!bestFastPick || pick.distance < bestFastPick.distance) bestFastPick = pick;
      }
      if (bestFastPick) {
        const pickedModel = fragmentsManager.list.get(bestFastPick.modelId) || model;
        if (pickedModel) {
          return {
            fragments: pickedModel,
            localId: bestFastPick.localId,
            itemId: bestFastPick.itemId,
            point: bestFastPick.point,
            distance: bestFastPick.distance,
          };
        }
      }
    }

    let best = null;
    for (const [offsetX, offsetY] of offsets) {
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left + offsetX) / rect.width) * 2 - 1,
        -((event.clientY - rect.top + offsetY) / rect.height) * 2 + 1,
      );
      const raycastData = { camera, mouse, dom: canvas };
      const managerHit = await fragmentsManager.raycast(raycastData);
      const modelHit = !managerHit && model?.raycast ? await model.raycast(raycastData) : null;
      const hit = managerHit || modelHit;
      if (!hit) continue;
      if (!best || (hit.rayDistance ?? hit.distance ?? Infinity) < (best.rayDistance ?? best.distance ?? Infinity)) {
        best = hit;
      }
    }
    if (best) return best;

    if (model?.rectangleRaycast) {
      const left = ((event.clientX - rect.left - radius) / rect.width) * 2 - 1;
      const right = ((event.clientX - rect.left + radius) / rect.width) * 2 - 1;
      const top = -((event.clientY - rect.top - radius) / rect.height) * 2 + 1;
      const bottom = -((event.clientY - rect.top + radius) / rect.height) * 2 + 1;
      const rectangleHit = await model.rectangleRaycast({
        camera,
        dom: canvas,
        topLeft: new THREE.Vector2(left, top),
        bottomRight: new THREE.Vector2(right, bottom),
        fullyIncluded: false,
      });
      if (rectangleHit?.localIds?.length) {
        return { fragments: rectangleHit.fragments || model, localId: rectangleHit.localIds[0] };
      }
    }

    return null;
  }

  useEffect(() => {
    if (!modelFile || !componentsRef.current || !worldRef.current || !fragmentsRef.current) return undefined;
    let cancelled = false;

    async function loadIfc() {
      try {
        onStateChangeRef.current({ status: "Loading", message: "Loading IFC with That Open", progress: 0 });
        const components = componentsRef.current;
        const world = worldRef.current;
        const fragments = fragmentsRef.current;
        await fragmentsReadyRef.current;

        if (loadedObjectRef.current) {
          world.scene.three.remove(loadedObjectRef.current);
          loadedObjectRef.current = null;
        }
        for (const [, model] of fragments.list) {
          await model.dispose();
        }
        pickedRef.current = null;

        const loader = components.get(OBC.IfcLoader);
        await loader.setup({
          autoSetWasm: false,
          wasm: { path: "/wasm/", absolute: true },
        });

        const buffer =
          modelFile.source === "upload"
            ? await modelFile.file.arrayBuffer()
            : await fetch(`/bim-output/${encodeURIComponent(modelFile.name)}`).then((response) => {
                if (!response.ok) throw new Error(`IFC file not found: ${modelFile.name}`);
                return response.arrayBuffer();
              });
        const data = new Uint8Array(buffer);
        const model = await loader.load(data, true, modelFile.name, {
          instanceCallback: (importer) => {
            importer.addAllAttributes();
            importer.addAllRelations();
          },
        });
        if (cancelled) {
          await model.dispose();
          return;
        }

        modelRef.current = model;
        loadedObjectRef.current = model.object;
        model.object.traverse((child) => {
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material) => {
              material.side = THREE.DoubleSide;
              material.needsUpdate = true;
            });
          }
        });

        await fitModel();
        fragments.core.update(true);
        window.__dtModelInfo = {
          modelId: model.modelId,
          box: model.box ? model.box.getSize(new THREE.Vector3()).toArray() : [],
        };
        onStateChangeRef.current({ status: "Ready", message: `Loaded ${modelFile.name}`, progress: 100 });
      } catch (error) {
        onStateChangeRef.current({ status: "Error", message: error.message || "IFC load failed", progress: 0 });
      }
    }

    const id = window.setTimeout(loadIfc, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [modelFile]);

  async function fitModel() {
    const world = worldRef.current;
    const model = modelRef.current;
    if (!world?.camera || !model?.box) return;
    const box = model.box;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(size.x, size.y, size.z, 10);
    const distance = Math.max(maxSize * 0.95, 12);
    const camera = world.camera.three;
    camera.near = 0.01;
    camera.far = Math.max(maxSize * 120, 1000);
    camera.updateProjectionMatrix();
    world.camera.controls.setLookAt(
      center.x + distance * 0.8,
      center.y - distance * 0.75,
      center.z + distance * 0.55,
      center.x,
      center.y,
      center.z,
      false,
    );
    await world.camera.controls.fitToSphere(new THREE.Sphere(center, Math.max(maxSize * 0.55, 7)), true);
    fragmentsRef.current?.core.update(true);
  }

  return <div className="ifc-canvas" ref={containerRef} />;
});

createRoot(document.getElementById("root")).render(<App />);
