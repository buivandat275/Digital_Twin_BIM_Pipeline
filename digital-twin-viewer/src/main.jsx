import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  Bell,
  Box,
  Building2,
  Crosshair,
  Database,
  Eye,
  FileCode2,
  Loader2,
  Maximize2,
  MousePointer2,
  Play,
  Radar,
  RotateCcw,
  Search,
  Square,
  Upload,
  UserRound,
} from "lucide-react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import "./styles.css";

const PREFERRED_IFC = "20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc";
const PICKED_COLOR = new THREE.Color(0xf59e0b);
const STATUS_COLORS = {
  Normal: "#16a34a",
  Warning: "#f59e0b",
  Fault: "#dc2626",
  Offline: "#64748b",
};
const STATUS_SEQUENCE = ["Normal", "Normal", "Warning", "Normal", "Fault", "Normal", "Offline", "Normal"];
const USER_POSITION = { x: 4400, y: 3300, z: 0, unit: "mm" };
const PICK_DRAG_THRESHOLD_PX = 6;
const SCENARIOS = [
  {
    id: "baseline",
    name: "Baseline Operations",
    description: "Use the status defined in the asset registry.",
    statuses: {},
  },
  {
    id: "normal-day",
    name: "Normal Day",
    description: "All simulated assets report normal telemetry.",
    all: "Normal",
  },
  {
    id: "hvac-warning",
    name: "HVAC Warning",
    description: "Fan and AHU report warning conditions.",
    statuses: { "FAN-L09-001": "Warning", "FAN-L10-001": "Warning", "AHU-L09-001": "Warning" },
  },
  {
    id: "camera-offline",
    name: "Camera Offline",
    description: "Camera devices lose telemetry.",
    byType: { Camera: "Offline" },
  },
  {
    id: "electrical-fault",
    name: "Electrical Fault",
    description: "Electrical meters and lighting move to fault.",
    statuses: { "EM-L09-001": "Fault", "EM-L10-001": "Fault", "LGT-L09-001": "Fault" },
  },
  {
    id: "fire-watch",
    name: "Fire Watch",
    description: "Sensors report warning while nearby cameras remain normal.",
    byType: { Sensor: "Warning", Camera: "Normal" },
  },
];

const ASSET_TYPE_CONFIG = {
  Camera: {
    ifc_class: "IfcAudioVisualAppliance",
    system: "CCTV System",
    specialty: "Security",
    telemetry_template: "camera_online_recording_temperature",
    mqttPath: "camera",
  },
  Sensor: {
    ifc_class: "IfcSensor",
    system: "Fire Detection System",
    specialty: "Fire Safety",
    telemetry_template: "temperature_humidity_battery_status",
    mqttPath: "sensor",
  },
  "Extract Fan": {
    ifc_class: "IfcFan",
    system: "HVAC System",
    specialty: "HVAC",
    telemetry_template: "fan_run_status_speed_vibration",
    mqttPath: "hvac",
  },
  AHU: {
    ifc_class: "IfcUnitaryEquipment",
    system: "HVAC System",
    specialty: "HVAC",
    telemetry_template: "ahu_supply_temp_return_temp_filter_dp_fan_status",
    mqttPath: "hvac",
  },
  "Electric Meter": {
    ifc_class: "IfcFlowMeter",
    system: "Electrical Metering System",
    specialty: "Electrical",
    telemetry_template: "electric_meter_kw_kwh_voltage_status",
    mqttPath: "electrical",
  },
  Light: {
    ifc_class: "IfcLightFixture",
    system: "Lighting System",
    specialty: "Electrical",
    telemetry_template: "light_status_dimming_power",
    mqttPath: "light",
  },
  Pump: {
    ifc_class: "IfcPump",
    system: "Hydronic System",
    specialty: "Mechanical",
    telemetry_template: "pump_run_status_flow_pressure_vibration",
    mqttPath: "hydronic",
  },
};

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
  Object.entries(value)
    .slice(0, 120)
    .forEach(([key, nestedValue]) => {
      if (typeof nestedValue !== "function") normalized[key] = normalizeIfcValue(nestedValue, depth + 1);
    });
  return normalized;
}

function buildAssetIndex(assets) {
  const index = new Map();
  assets.forEach((asset) => {
    if (asset.source_global_id) index.set(asset.source_global_id, asset);
  });
  return index;
}

function preferredIfcFile(files) {
  return files.find((file) => file.name === PREFERRED_IFC) || files[0] || null;
}

function meters(value = 0) {
  return `${(value / 1000).toFixed(1)} m`;
}

function distanceMeters(a, b, includeZ = false) {
  if (!a?.position || !b?.position) return Infinity;
  const dx = (a.position.x || 0) - (b.position.x || 0);
  const dy = (a.position.y || 0) - (b.position.y || 0);
  const dz = includeZ ? (a.position.z || 0) - (b.position.z || 0) : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) / 1000;
}

function distanceFromPointMeters(point, asset) {
  if (!point || !asset?.position) return Infinity;
  const dx = (point.x || 0) - (asset.position.x || 0);
  const dy = (point.y || 0) - (asset.position.y || 0);
  return Math.sqrt(dx * dx + dy * dy) / 1000;
}

function statusTone(status) {
  return (status || "Normal").toLowerCase();
}

function makeTelemetry(asset, status, tick) {
  const base = {
    device_id: asset.device_id,
    status,
    updated_at: new Date().toISOString(),
  };
  if (asset.asset_type === "Camera") {
    return { ...base, online: status !== "Offline", recording: status !== "Fault", temperature_c: 41 + (tick % 5) * 2 };
  }
  if (asset.asset_type === "Extract Fan") {
    return { ...base, running: status !== "Offline", speed_rpm: status === "Fault" ? 0 : 820 + tick * 13, vibration_mm_s: status === "Warning" ? 7.4 : 2.1 };
  }
  if (asset.asset_type === "AHU") {
    return { ...base, supply_temp_c: 16.5 + (tick % 4) * 0.6, filter_dp_pa: status === "Warning" ? 420 : 180, fan_status: status === "Offline" ? "stopped" : "running" };
  }
  if (asset.telemetry_template?.includes("temperature")) {
    return { ...base, temperature_c: 24 + (tick % 5) * 0.4, humidity_pct: 56 + (tick % 4), battery_pct: status === "Warning" ? 24 : 91 };
  }
  if (asset.asset_type === "Sensor") {
    return { ...base, smoke_alarm: status === "Fault", battery_pct: status === "Warning" ? 18 : 86 };
  }
  if (asset.asset_type === "Electric Meter") {
    return { ...base, power_kw: 38 + (tick % 7) * 2.5, energy_kwh: 12080 + tick * 3, voltage_v: status === "Warning" ? 205 : 229 };
  }
  if (asset.asset_type === "Light") {
    return { ...base, on: status !== "Fault" && status !== "Offline", dimming_pct: status === "Normal" ? 80 : 0, power_w: status === "Normal" ? 42 : 0 };
  }
  return { ...base, running: status !== "Offline" };
}

function initialTelemetry(assets) {
  return Object.fromEntries(
    assets.map((asset, index) => [
      asset.device_id,
      makeTelemetry(asset, asset.status || STATUS_SEQUENCE[index % STATUS_SEQUENCE.length], index),
    ]),
  );
}

function simulateTelemetry(assets, previousByDevice, tick) {
  return Object.fromEntries(
    assets.map((asset, index) => {
      const previousStatus = previousByDevice[asset.device_id]?.status;
      const status = previousStatus || asset.status || STATUS_SEQUENCE[index % STATUS_SEQUENCE.length];
      return [asset.device_id, makeTelemetry(asset, status, tick + index)];
    }),
  );
}

function statusForScenario(asset, scenario) {
  if (!scenario || scenario.id === "baseline") return asset.status || "Normal";
  if (scenario.all) return scenario.all;
  if (scenario.statuses?.[asset.asset_id]) return scenario.statuses[asset.asset_id];
  if (scenario.byType?.[asset.asset_type]) return scenario.byType[asset.asset_type];
  return asset.status || "Normal";
}

function telemetryForScenario(assets, scenario, tick = 0) {
  return Object.fromEntries(
    assets.map((asset, index) => [asset.device_id, makeTelemetry(asset, statusForScenario(asset, scenario), tick + index)]),
  );
}

function enrichAssets(assets, telemetryByDevice) {
  return assets.map((asset) => {
    const telemetry = telemetryByDevice[asset.device_id] || makeTelemetry(asset, asset.status || "Normal", 0);
    return {
      ...asset,
      status: telemetry.status || asset.status || "Normal",
      telemetry,
    };
  });
}

function levelElevation(floor = "Level 9") {
  const match = String(floor).match(/(\d+)/);
  if (!match) return 36;
  return 36 + (Number(match[1]) - 9) * 3.4;
}

function floorCode(floor = "Level 9") {
  const match = String(floor).match(/(\d+)/);
  return `level-${match ? match[1].padStart(2, "0") : "09"}`;
}

function slug(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function createMockAsset(form, selectedAsset, existingAssets) {
  const type = form.asset_type || "Sensor";
  const config = ASSET_TYPE_CONFIG[type] || ASSET_TYPE_CONFIG.Sensor;
  const floor = form.floor || selectedAsset?.floor || "Level 9";
  const zone = form.zone || selectedAsset?.zone || "Demo Zone";
  const count = existingAssets.filter((asset) => asset.asset_type === type).length + 1;
  const prefix = {
    Camera: "CAM",
    Sensor: "SNS",
    "Extract Fan": "FAN",
    AHU: "AHU",
    "Electric Meter": "EM",
    Light: "LGT",
    Pump: "PMP",
  }[type] || "AST";
  const level = String(floor.match(/(\d+)/)?.[1] || "9").padStart(2, "0");
  const assetId = form.asset_id || `${prefix}-L${level}-MOCK-${String(count).padStart(2, "0")}`;
  const position = {
    x: Number(form.x || selectedAsset?.position?.x || 9000),
    y: Number(form.y || selectedAsset?.position?.y || 6000),
    z: Number(form.z || (["Camera", "Light", "Extract Fan"].includes(type) ? 3100 : 1500)),
    unit: "mm",
  };
  const deviceId = form.device_id || slug(assetId);
  return {
    asset_id: assetId,
    asset_name: form.asset_name || `${floor} ${type} Mock ${count}`,
    asset_type: type,
    ifc_class: config.ifc_class,
    source_global_id: "",
    device_id: deviceId,
    system: config.system,
    floor,
    floor_elevation_m: levelElevation(floor),
    zone,
    location: `${floor} / ${zone}`,
    manufacturer: "MockOps",
    model: "Runtime Asset",
    status: form.status || "Normal",
    criticality: form.criticality || "Medium",
    specialty: config.specialty,
    position,
    mqtt_topic: `marriott/${floorCode(floor)}/${config.mqttPath}/${assetId}/telemetry`,
    telemetry_template: config.telemetry_template,
    runtime_only: true,
  };
}

function buildAssetRelationships(asset, assets) {
  if (!asset) return { sameSystem: [], sameLocation: [], nearbyCameras: [], nearbySensors: [], dependencies: [] };
  const sortByDistance = (items) =>
    items
      .map((item) => ({ ...item, distance: distanceMeters(item, asset) }))
      .sort((a, b) => a.distance - b.distance);
  const sameSystem = assets
    .filter((item) => item.asset_id !== asset.asset_id && item.system === asset.system)
    .slice(0, 6);
  const sameLocation = assets
    .filter((item) => item.asset_id !== asset.asset_id && item.floor === asset.floor && item.zone === asset.zone)
    .slice(0, 6);
  const nearbyCameras = sortByDistance(
    assets.filter((item) => item.asset_id !== asset.asset_id && item.asset_type === "Camera" && item.floor === asset.floor),
  ).slice(0, 3);
  const nearbySensors = sortByDistance(
    assets.filter((item) => item.asset_id !== asset.asset_id && item.asset_type === "Sensor" && item.floor === asset.floor),
  ).slice(0, 3);
  const dependencies = assets.filter((item) => {
    if (asset.asset_type === "AHU") return item.asset_type === "Extract Fan" && item.floor === asset.floor;
    if (asset.asset_type === "Electric Meter") return item.specialty === "Electrical" && item.asset_id !== asset.asset_id;
    if (asset.asset_type === "Camera") return item.asset_type === "Sensor" && item.floor === asset.floor;
    return item.system === asset.system && item.zone === asset.zone && item.asset_id !== asset.asset_id;
  }).slice(0, 5);
  return { sameSystem, sameLocation, nearbyCameras, nearbySensors, dependencies };
}

function buildAlerts(assets) {
  return assets
    .filter((asset) => ["Warning", "Fault", "Offline"].includes(asset.status))
    .map((asset) => ({
      alert_id: `ALERT-${asset.asset_id}`,
      asset_id: asset.asset_id,
      device_id: asset.device_id,
      severity: asset.status === "Fault" ? "High" : asset.status === "Offline" ? "Medium" : "Low",
      status: asset.status,
      message:
        asset.status === "Offline"
          ? `${asset.asset_name} is not sending telemetry`
          : `${asset.asset_name} reports ${asset.status.toLowerCase()} condition`,
      asset,
    }));
}

function routeForAsset(asset) {
  if (!asset?.position) return [];
  const target = asset.position;
  const floorElevationM = asset.floor_elevation_m ?? 36;
  const start = { ...USER_POSITION, floorElevationM };
  return [
    start,
    { x: USER_POSITION.x, y: target.y, z: 0, unit: "mm", floorElevationM },
    { x: target.x, y: target.y, z: 0, unit: "mm", floorElevationM },
    { ...target, floorElevationM },
  ];
}

function scoreTechnicians(technicians, asset) {
  if (!asset) return [];
  return technicians
    .map((tech) => {
      const skillMatch = tech.specialties?.includes(asset.specialty) ? 1 : 0;
      const distance = distanceFromPointMeters(tech.position, asset);
      const availabilityPenalty = tech.availability === "Available" ? 0 : 20;
      const score = skillMatch * 100 - distance - availabilityPenalty;
      return { ...tech, skillMatch, distance, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
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
    [
      "asset_id",
      "asset_name",
      "asset_type",
      "ifc_class",
      "system",
      "location",
      "status",
      "device_id",
      "mqtt_topic",
      "source_global_id",
    ].forEach((key) => {
      if (asset[key] !== undefined && asset[key] !== null && asset[key] !== "") {
        rows.push([key.replaceAll("_", " "), String(asset[key])]);
      }
    });
  }
  return rows;
}

function App() {
  const [files, setFiles] = useState({ ifcFiles: [] });
  const [uploadedIfcFiles, setUploadedIfcFiles] = useState([]);
  const [operationAssets, setOperationAssets] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [floorplan, setFloorplan] = useState(null);
  const [selectedFileKey, setSelectedFileKey] = useState("");
  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [telemetryByDevice, setTelemetryByDevice] = useState({});
  const [simulatorRunning, setSimulatorRunning] = useState(true);
  const [activeScenarioId, setActiveScenarioId] = useState("baseline");
  const [llmStatus, setLlmStatus] = useState({ status: "unknown", message: "Not checked" });
  const [addAssetOpen, setAddAssetOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [viewerState, setViewerState] = useState({
    status: "Idle",
    message: "Choose the Marriott operations IFC to start.",
    progress: 0,
  });
  const [filters, setFilters] = useState({
    search: "",
    type: "",
    floor: "",
    zone: "",
    status: "",
    specialty: "",
    problemOnly: false,
  });
  const [naturalQuery, setNaturalQuery] = useState("");
  const [naturalResult, setNaturalResult] = useState(null);
  const [naturalLoading, setNaturalLoading] = useState(false);
  const [radius, setRadius] = useState(5);
  const [spatialKind, setSpatialKind] = useState("Any");
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
  const assets = useMemo(() => enrichAssets(operationAssets, telemetryByDevice), [operationAssets, telemetryByDevice]);
  const assetIndex = useMemo(() => buildAssetIndex(assets), [assets]);
  const selectedRuntimeAsset = useMemo(
    () => assets.find((asset) => asset.asset_id === selectedAsset?.asset_id) || selectedAsset,
    [assets, selectedAsset],
  );
  const alerts = useMemo(() => buildAlerts(assets), [assets]);
  const types = useMemo(() => Array.from(new Set(assets.map((asset) => asset.asset_type))).sort(), [assets]);
  const floors = useMemo(() => Array.from(new Set(assets.map((asset) => asset.floor))).sort(), [assets]);
  const zones = useMemo(() => Array.from(new Set(assets.map((asset) => asset.zone))).sort(), [assets]);
  const activeScenario = useMemo(
    () => SCENARIOS.find((scenario) => scenario.id === activeScenarioId) || SCENARIOS[0],
    [activeScenarioId],
  );
  const filteredAssets = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return assets.filter((asset) => {
      const text = [asset.asset_id, asset.asset_name, asset.asset_type, asset.system, asset.location, asset.status]
        .join(" ")
        .toLowerCase();
      return (
        (!needle || text.includes(needle)) &&
        (!filters.type || asset.asset_type === filters.type) &&
        (!filters.floor || asset.floor === filters.floor) &&
        (!filters.zone || asset.zone === filters.zone) &&
        (!filters.status || asset.status === filters.status) &&
        (!filters.specialty || asset.specialty === filters.specialty) &&
        (!filters.problemOnly || ["Warning", "Fault", "Offline"].includes(asset.status))
      );
    });
  }, [assets, filters]);
  const spatialResults = useMemo(() => {
    if (!selectedRuntimeAsset) return [];
    return assets
      .filter((asset) => asset.asset_id !== selectedRuntimeAsset.asset_id)
      .map((asset) => ({ ...asset, distance: distanceMeters(asset, selectedRuntimeAsset) }))
      .filter((asset) => {
        if (asset.distance > Number(radius || 0)) return false;
        if (spatialKind === "Camera") return asset.asset_type === "Camera";
        if (spatialKind === "Sensor") return asset.asset_type === "Sensor";
        return true;
      })
      .sort((a, b) => a.distance - b.distance);
  }, [assets, radius, selectedRuntimeAsset, spatialKind]);
  const route = useMemo(() => routeForAsset(selectedRuntimeAsset), [selectedRuntimeAsset]);
  const dispatchCandidates = useMemo(
    () => scoreTechnicians(technicians, selectedRuntimeAsset),
    [technicians, selectedRuntimeAsset],
  );
  const relationships = useMemo(
    () => buildAssetRelationships(selectedRuntimeAsset, assets),
    [assets, selectedRuntimeAsset],
  );

  useEffect(() => {
    async function bootstrap() {
      const [fileRes, assetRes, techRes, floorplanRes] = await Promise.all([
        fetch("/api/files"),
        fetch("/api/operations/assets"),
        fetch("/api/operations/technicians"),
        fetch("/api/operations/floorplan"),
      ]);
      const fileData = await fileRes.json();
      const assetData = await assetRes.json();
      const techData = await techRes.json();
      const floorplanData = await floorplanRes.json();
      setFiles(fileData);
      setOperationAssets(assetData);
      setTechnicians(techData);
      setFloorplan(floorplanData);
      setTelemetryByDevice(initialTelemetry(assetData));

      const preferred = preferredIfcFile(fileData.ifcFiles || []);
      if (preferred) setSelectedFileKey(`output:${preferred.name}`);
      if (assetData[0]) setSelectedAsset(assetData[0]);
      checkLlmStatus();
    }
    bootstrap().catch((error) => {
      setViewerState({ status: "Error", message: error.message, progress: 0 });
    });
  }, []);

  useEffect(() => {
    if (!operationAssets.length) return;
    setTelemetryByDevice(telemetryForScenario(operationAssets, activeScenario, tick));
  }, [activeScenario, operationAssets]);

  useEffect(() => {
    const floor = selectedRuntimeAsset?.floor || "Level 9";
    let cancelled = false;
    fetch(`/api/operations/floorplan?floor=${encodeURIComponent(floor)}`)
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setFloorplan(data);
      })
      .catch((error) => {
        if (!cancelled) setViewerState((current) => ({ ...current, message: error.message }));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRuntimeAsset?.floor]);

  useEffect(() => {
    if (!simulatorRunning || !operationAssets.length) return undefined;
    const id = window.setInterval(() => {
      setTick((current) => {
        const next = current + 1;
        setTelemetryByDevice((previous) => simulateTelemetry(operationAssets, previous, next));
        return next;
      });
    }, 2600);
    return () => window.clearInterval(id);
  }, [operationAssets, simulatorRunning]);

  useEffect(() => {
    if (viewerState.status !== "Ready") return;
    let cancelled = false;
    async function syncColors() {
      await viewerRef.current?.colorAssets(assets);
      if (!cancelled && selectedRuntimeAsset) {
        await viewerRef.current?.locateAsset(selectedRuntimeAsset, { zoom: false });
      }
    }
    syncColors();
    return () => {
      cancelled = true;
    };
  }, [assets, selectedRuntimeAsset, viewerState.status]);

  useEffect(() => {
    if (viewerState.status !== "Ready") return;
    viewerRef.current?.showRoute(route);
  }, [route, viewerState.status]);

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

  async function checkLlmStatus() {
    setLlmStatus({ status: "checking", message: "Checking local LLM..." });
    try {
      const response = await fetch("/api/operations/llm-status");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "LLM status check failed");
      setLlmStatus(payload);
    } catch (error) {
      setLlmStatus({ status: "offline", source: "rules", message: error.message });
    }
  }

  function handleScenarioChange(scenarioId) {
    setActiveScenarioId(scenarioId);
    const scenario = SCENARIOS.find((item) => item.id === scenarioId) || SCENARIOS[0];
    setTelemetryByDevice(telemetryForScenario(operationAssets, scenario, tick));
  }

  function handleAddAsset(form) {
    const asset = createMockAsset(form, selectedRuntimeAsset, operationAssets);
    setOperationAssets((current) => [...current, asset]);
    setTelemetryByDevice((current) => ({
      ...current,
      [asset.device_id]: makeTelemetry(asset, asset.status || "Normal", tick),
    }));
    setSelectedAsset(asset);
    setSelectedObject(null);
    setAddAssetOpen(false);
  }

  const selectAsset = useCallback((asset, zoom = true) => {
    if (!asset) return;
    setSelectedAsset(asset);
    setSelectedObject(null);
    viewerRef.current?.locateAsset(asset, { zoom });
  }, []);

  const handleObjectPicked = useCallback(
    (object) => {
      setSelectedObject(object);
      const asset = object?.globalId ? assetIndex.get(object.globalId) : null;
      if (asset) setSelectedAsset(asset);
    },
    [assetIndex],
  );

  function assetsMatchingIntent(intent) {
    const parsedFilters = intent?.filters || {};
    return assets.filter((asset) => {
      const problemOnly = Boolean(parsedFilters.problemOnly);
      return (
        (!parsedFilters.type || asset.asset_type === parsedFilters.type) &&
        (!parsedFilters.floor || asset.floor === parsedFilters.floor) &&
        (!parsedFilters.zone || asset.zone === parsedFilters.zone) &&
        (!parsedFilters.status || asset.status === parsedFilters.status) &&
        (!parsedFilters.specialty || asset.specialty === parsedFilters.specialty) &&
        (!problemOnly || ["Warning", "Fault", "Offline"].includes(asset.status))
      );
    });
  }

  function findNearAsset(spatial = {}) {
    if (spatial.near_asset_id) {
      const direct = assets.find((asset) => asset.asset_id === spatial.near_asset_id);
      if (direct) return direct;
    }
    if (spatial.near_asset_type) {
      const candidates = assets.filter(
        (asset) =>
          asset.asset_type === spatial.near_asset_type &&
          (!spatial.near_status || asset.status === spatial.near_status),
      );
      if (candidates.length) return candidates[0];
    }
    return selectedRuntimeAsset || assets[0] || null;
  }

  function applyNaturalIntent(intent) {
    const parsedFilters = intent?.filters || {};
    const spatial = intent?.spatial || {};
    setFilters({
      search: parsedFilters.search || "",
      type: parsedFilters.type || "",
      floor: parsedFilters.floor || "",
      zone: parsedFilters.zone || "",
      status: parsedFilters.status || "",
      specialty: parsedFilters.specialty || "",
      problemOnly: Boolean(parsedFilters.problemOnly),
    });

    if (intent?.intent === "spatial_search") {
      setRadius(spatial.radius_m || 6);
      setSpatialKind(spatial.target_type && spatial.target_type !== "Any" ? spatial.target_type : "Any");
      const nearAsset = findNearAsset(spatial);
      if (nearAsset) selectAsset(nearAsset);
      return;
    }

    if (intent?.intent === "relationship" || intent?.intent === "dispatch") {
      const nearAsset = findNearAsset(spatial);
      const matches = assetsMatchingIntent(intent);
      selectAsset(nearAsset || matches[0] || selectedRuntimeAsset, intent?.intent === "relationship");
      return;
    }

    const matches = assetsMatchingIntent(intent);
    if (intent?.action === "locate_first" && matches[0]) {
      selectAsset(matches[0]);
    } else if (matches[0]) {
      selectAsset(matches[0], false);
    }
  }

  async function runNaturalSearch(query = naturalQuery) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setNaturalLoading(true);
    try {
      const response = await fetch("/api/operations/nl-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Natural language search failed");
      setNaturalResult(payload);
      applyNaturalIntent(payload);
    } catch (error) {
      setNaturalResult({ source: "error", explanation: error.message });
    } finally {
      setNaturalLoading(false);
    }
  }

  return (
    <div className="app-shell operations-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Building2 size={22} />
          </div>
          <div>
            <h1>Digital Twin Operations</h1>
            <p>IFC + asset registry + simulated telemetry + response workflow</p>
          </div>
        </div>

        <div className="model-picker ops-picker">
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
          <button
            className={`sim-toggle ${simulatorRunning ? "running" : ""}`}
            onClick={() => setSimulatorRunning((current) => !current)}
          >
            {simulatorRunning ? <Square size={15} /> : <Play size={15} />}
            {simulatorRunning ? "Simulator running" : "Start simulator"}
          </button>
        </div>
      </header>

      <main className="workspace operations-workspace">
        <aside className="asset-rail operations-rail">
          <section className="summary-band">
            <Metric icon={<Box size={18} />} label="Assets" value={assets.length} />
            <Metric icon={<Bell size={18} />} label="Alerts" value={alerts.length} />
            <Metric icon={<Database size={18} />} label="Systems" value={new Set(assets.map((a) => a.system)).size} />
            <Metric icon={<UserRound size={18} />} label="Technicians" value={technicians.length} />
          </section>

          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            types={types}
            floors={floors}
            zones={zones}
            naturalQuery={naturalQuery}
            setNaturalQuery={setNaturalQuery}
            naturalResult={naturalResult}
            naturalLoading={naturalLoading}
            llmStatus={llmStatus}
            onCheckLlm={checkLlmStatus}
            onNaturalSearch={runNaturalSearch}
          />

          <ScenarioPanel
            scenarios={SCENARIOS}
            activeScenarioId={activeScenarioId}
            onChange={handleScenarioChange}
          />

          <AddAssetPanel
            open={addAssetOpen}
            setOpen={setAddAssetOpen}
            floors={floors}
            zones={zones}
            selectedAsset={selectedRuntimeAsset}
            onAdd={handleAddAsset}
          />

          <div className="asset-list">
            {filteredAssets.map((asset) => (
              <AssetRow
                asset={asset}
                key={asset.asset_id}
                active={asset.asset_id === selectedRuntimeAsset?.asset_id}
                onClick={() => selectAsset(asset)}
              />
            ))}
          </div>
        </aside>

        <section className="viewer-stage operations-stage">
          <div className="viewer-toolbar">
            <StatusPill state={viewerState} />
            <button className="icon-button" title="Locate selected asset" onClick={() => selectAsset(selectedRuntimeAsset)}>
              <Crosshair size={18} />
            </button>
            <button className="icon-button" title="Reset camera" onClick={() => viewerRef.current?.resetCamera()}>
              <RotateCcw size={18} />
            </button>
            <button className="icon-button" title="Fit model" onClick={() => viewerRef.current?.fitModel()}>
              <Maximize2 size={18} />
            </button>
          </div>

          <ThatOpenCanvas
            ref={viewerRef}
            modelFile={selectedModel}
            onPicked={handleObjectPicked}
            onStateChange={setViewerState}
          />

          <div className="viewer-hint">
            <MousePointer2 size={16} />
            <span>Click the 3D model to inspect metadata. Use asset list, search, alerts, or Locate to draw the orange frame.</span>
          </div>
        </section>

        <aside className="property-panel operations-panel">
          <section className="panel-head">
            <div>
              <span className="eyebrow">Selected Asset</span>
              <h2>{selectedRuntimeAsset?.asset_name || selectedObject?.name || "No asset selected"}</h2>
            </div>
            {selectedRuntimeAsset ? (
              <StatusBadge status={selectedRuntimeAsset.status} />
            ) : (
              <AlertTriangle className="warn" size={22} />
            )}
          </section>

          {selectedRuntimeAsset && (
            <>
              <section className="link-state">
                <Radar size={18} />
                <div>
                  <strong>{selectedRuntimeAsset.device_id}</strong>
                  <span>{selectedRuntimeAsset.mqtt_topic}</span>
                </div>
              </section>

              <TelemetryCard asset={selectedRuntimeAsset} />
              <AssetMap
                assets={assets}
                floorplan={floorplan}
                selectedAsset={selectedRuntimeAsset}
                route={route}
                onSelect={selectAsset}
              />
              <SpatialPanel
                selectedAsset={selectedRuntimeAsset}
                results={spatialResults}
                radius={radius}
                setRadius={setRadius}
                spatialKind={spatialKind}
                setSpatialKind={setSpatialKind}
                onSelect={selectAsset}
              />
              <SystemRelationshipPanel relationships={relationships} onSelect={selectAsset} />
              <DispatchPanel asset={selectedRuntimeAsset} candidates={dispatchCandidates} />
            </>
          )}

          <AlertPanel alerts={alerts} onSelect={(asset) => selectAsset(asset)} />

          <dl className="property-grid">
            {propertyRows(selectedObject, selectedRuntimeAsset).map(([label, value]) => (
              <React.Fragment key={`${label}-${value}`}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            ))}
          </dl>

          {selectedObject?.ifcProperties && <JsonBlock title="IFC Properties" value={selectedObject.ifcProperties} />}
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

function FilterPanel({
  filters,
  setFilters,
  types,
  floors,
  zones,
  naturalQuery,
  setNaturalQuery,
  naturalResult,
  naturalLoading,
  llmStatus,
  onCheckLlm,
  onNaturalSearch,
}) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  return (
    <section className="filter-panel">
      <div className="natural-search">
        <label>
          <span>Natural language search</span>
          <textarea
            value={naturalQuery}
            onChange={(event) => setNaturalQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) onNaturalSearch();
            }}
            placeholder="VD: tìm camera quanh AHU trong bán kính 8m"
          />
        </label>
        <div className="natural-actions">
          <button onClick={() => onNaturalSearch()} disabled={naturalLoading || !naturalQuery.trim()}>
            {naturalLoading ? "Parsing..." : "Ask"}
          </button>
          <button
            onClick={() => {
              setNaturalQuery("");
              setFilters({ search: "", type: "", floor: "", zone: "", status: "", specialty: "", problemOnly: false });
            }}
          >
            Reset
          </button>
        </div>
        {naturalResult?.explanation && (
          <p className="nl-result">
            <strong>{naturalResult.source || "parser"}</strong>: {naturalResult.explanation}
          </p>
        )}
        <div className={`llm-status ${llmStatus?.status || "unknown"}`}>
          <span>
            LLM: <strong>{llmStatus?.source || llmStatus?.status || "unknown"}</strong>
          </span>
          <button type="button" onClick={onCheckLlm}>
            {llmStatus?.status === "checking" ? "Checking..." : "Check"}
          </button>
        </div>
        {llmStatus?.message && <p className="nl-result">{llmStatus.message}</p>}
      </div>
      <div className="search-box">
        <Search size={17} />
        <input
          value={filters.search}
          onChange={(event) => update("search", event.target.value)}
          placeholder="Keyword fallback: name, type, zone, status"
        />
      </div>
      <div className="filter-grid">
        <SelectFilter label="Type" value={filters.type} values={types} onChange={(value) => update("type", value)} />
        <SelectFilter label="Floor" value={filters.floor} values={floors} onChange={(value) => update("floor", value)} />
        <SelectFilter label="Zone" value={filters.zone} values={zones} onChange={(value) => update("zone", value)} />
        <SelectFilter
          label="Status"
          value={filters.status}
          values={["Normal", "Warning", "Fault", "Offline"]}
          onChange={(value) => update("status", value)}
        />
      </div>
      {filters.problemOnly && <span className="active-chip">Showing abnormal assets</span>}
    </section>
  );
}

function ScenarioPanel({ scenarios, activeScenarioId, onChange }) {
  const active = scenarios.find((scenario) => scenario.id === activeScenarioId) || scenarios[0];
  return (
    <section className="ops-card scenario-panel">
      <h3>Telemetry Scenario</h3>
      <select value={activeScenarioId} onChange={(event) => onChange(event.target.value)}>
        {scenarios.map((scenario) => (
          <option value={scenario.id} key={scenario.id}>
            {scenario.name}
          </option>
        ))}
      </select>
      <p className="hint-text">{active.description}</p>
    </section>
  );
}

function AddAssetPanel({ open, setOpen, floors, zones, selectedAsset, onAdd }) {
  const defaultFloor = selectedAsset?.floor || floors[0] || "Level 9";
  const defaultZone = selectedAsset?.zone || zones[0] || "Demo Zone";
  const [form, setForm] = useState({
    asset_type: "Sensor",
    asset_name: "",
    asset_id: "",
    device_id: "",
    floor: defaultFloor,
    zone: defaultZone,
    status: "Normal",
    x: selectedAsset?.position?.x || 9000,
    y: selectedAsset?.position?.y || 6000,
    z: 1500,
    criticality: "Medium",
  });

  useEffect(() => {
    setForm((current) => ({
      ...current,
      floor: selectedAsset?.floor || current.floor || defaultFloor,
      zone: selectedAsset?.zone || current.zone || defaultZone,
      x: selectedAsset?.position?.x || current.x,
      y: selectedAsset?.position?.y || current.y,
    }));
  }, [
    defaultFloor,
    defaultZone,
    selectedAsset?.asset_id,
    selectedAsset?.floor,
    selectedAsset?.zone,
    selectedAsset?.position?.x,
    selectedAsset?.position?.y,
  ]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <section className="ops-card add-asset-panel">
      <div className="card-title-row">
        <h3>Add Runtime Asset</h3>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add"}
        </button>
      </div>
      {!open && <p className="hint-text">Create a mock operations asset without editing the IFC file.</p>}
      {open && (
        <div className="add-asset-form">
          <label>
            Type
            <select value={form.asset_type} onChange={(event) => update("asset_type", event.target.value)}>
              {Object.keys(ASSET_TYPE_CONFIG).map((type) => (
                <option value={type} key={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input value={form.asset_name} onChange={(event) => update("asset_name", event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Floor
            <select value={form.floor} onChange={(event) => update("floor", event.target.value)}>
              {floors.map((floor) => (
                <option value={floor} key={floor}>
                  {floor}
                </option>
              ))}
            </select>
          </label>
          <label>
            Zone
            <input value={form.zone} onChange={(event) => update("zone", event.target.value)} />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(event) => update("status", event.target.value)}>
              {["Normal", "Warning", "Fault", "Offline"].map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label>
            X/Y/Z mm
            <div className="coordinate-grid">
              <input type="number" value={form.x} onChange={(event) => update("x", event.target.value)} />
              <input type="number" value={form.y} onChange={(event) => update("y", event.target.value)} />
              <input type="number" value={form.z} onChange={(event) => update("z", event.target.value)} />
            </div>
          </label>
          <button type="button" className="primary-action" onClick={() => onAdd(form)}>
            Add mock asset
          </button>
        </div>
      )}
    </section>
  );
}

function SelectFilter({ label, value, values, onChange }) {
  return (
    <label className="select-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All</option>
        {values.map((item) => (
          <option value={item} key={item}>
            {item}
          </option>
        ))}
      </select>
    </label>
  );
}

function AssetRow({ asset, active, onClick }) {
  return (
    <button className={`asset-row ${active ? "active" : ""}`} onClick={onClick}>
      <span className="asset-row-head">
        <span className="asset-type">{asset.asset_type}</span>
        <StatusDot status={asset.status} />
      </span>
      <strong>{asset.asset_name}</strong>
      <span>{asset.location}</span>
      <span className="muted-line">
        {asset.asset_id} · {asset.device_id}
      </span>
    </button>
  );
}

function StatusDot({ status }) {
  return (
    <span className={`status-dot ${statusTone(status)}`} style={{ "--status-color": STATUS_COLORS[status] || "#64748b" }}>
      {status}
    </span>
  );
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${statusTone(status)}`}>{status}</span>;
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

function TelemetryCard({ asset }) {
  const telemetry = asset.telemetry || {};
  const entries = Object.entries(telemetry).filter(([key]) => !["device_id", "status", "updated_at"].includes(key));
  return (
    <section className="ops-card">
      <h3>Telemetry Simulator</h3>
      <div className="telemetry-grid">
        {entries.map(([key, value]) => (
          <React.Fragment key={key}>
            <span>{key.replaceAll("_", " ")}</span>
            <strong>{String(value)}</strong>
          </React.Fragment>
        ))}
      </div>
      <small>Updated {telemetry.updated_at ? new Date(telemetry.updated_at).toLocaleTimeString() : "n/a"}</small>
    </section>
  );
}

function AlertPanel({ alerts, onSelect }) {
  return (
    <section className="ops-card">
      <h3>Alert Panel</h3>
      {!alerts.length && <p className="empty-state">No active alerts from simulator.</p>}
      <div className="alert-list">
        {alerts.map((alert) => (
          <button className={`alert-row ${alert.severity.toLowerCase()}`} key={alert.alert_id} onClick={() => onSelect(alert.asset)}>
            <strong>{alert.severity}</strong>
            <span>{alert.message}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SpatialPanel({ selectedAsset, results, radius, setRadius, spatialKind, setSpatialKind, onSelect }) {
  return (
    <section className="ops-card">
      <h3>Spatial Search</h3>
      <div className="inline-controls">
        <label>
          Radius
          <input type="number" min="1" max="30" value={radius} onChange={(event) => setRadius(event.target.value)} />
        </label>
        <label>
          Find
          <select value={spatialKind} onChange={(event) => setSpatialKind(event.target.value)}>
            <option>Any</option>
            <option>Camera</option>
            <option>Sensor</option>
          </select>
        </label>
      </div>
      <p className="hint-text">Around {selectedAsset?.asset_name}</p>
      <div className="nearby-list">
        {results.map((asset) => (
          <button key={asset.asset_id} onClick={() => onSelect(asset)}>
            <span>{asset.asset_type}</span>
            <strong>{asset.asset_name}</strong>
            <em>{asset.distance.toFixed(1)} m</em>
          </button>
        ))}
        {!results.length && <p className="empty-state">No nearby assets in this radius.</p>}
      </div>
    </section>
  );
}

function RelationshipGroup({ title, assets, onSelect, showDistance = false }) {
  return (
    <div className="relationship-group">
      <strong>{title}</strong>
      {!assets.length && <span className="empty-state">No related assets.</span>}
      {assets.map((asset) => (
        <button type="button" key={`${title}-${asset.asset_id}`} onClick={() => onSelect(asset)}>
          <span>{asset.asset_type}</span>
          <em>{asset.asset_id}</em>
          {showDistance && asset.distance !== undefined && <small>{asset.distance.toFixed(1)} m</small>}
        </button>
      ))}
    </div>
  );
}

function SystemRelationshipPanel({ relationships, onSelect }) {
  return (
    <section className="ops-card relationship-panel">
      <h3>System Relationships</h3>
      <RelationshipGroup title="Same system" assets={relationships.sameSystem} onSelect={onSelect} />
      <RelationshipGroup title="Same floor / zone" assets={relationships.sameLocation} onSelect={onSelect} />
      <RelationshipGroup title="Nearby cameras" assets={relationships.nearbyCameras} onSelect={onSelect} showDistance />
      <RelationshipGroup title="Nearby sensors" assets={relationships.nearbySensors} onSelect={onSelect} showDistance />
      <RelationshipGroup title="Operational dependencies" assets={relationships.dependencies} onSelect={onSelect} />
    </section>
  );
}

function DispatchPanel({ asset, candidates }) {
  return (
    <section className="ops-card">
      <h3>Technician Dispatch</h3>
      <p className="hint-text">Required specialty: {asset.specialty}</p>
      <div className="tech-list">
        {candidates.map((tech, index) => (
          <div className="tech-row" key={tech.technician_id}>
            <span className="rank">#{index + 1}</span>
            <div>
              <strong>{tech.name}</strong>
              <span>
                {tech.specialties.join(", ")} · {tech.distance.toFixed(1)} m · {tech.availability}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssetMap({ assets, floorplan, selectedAsset, route, onSelect }) {
  const visibleAssets = useMemo(() => {
    if (!floorplan?.floor) return assets;
    return assets.filter((asset) => asset.floor === floorplan.floor);
  }, [assets, floorplan]);
  const bounds = useMemo(() => {
    if (floorplan?.bounds) return floorplan.bounds;
    const points = [...visibleAssets.map((asset) => asset.position), USER_POSITION].filter(Boolean);
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      minX: Math.min(...xs) - 800,
      maxX: Math.max(...xs) + 800,
      minY: Math.min(...ys) - 800,
      maxY: Math.max(...ys) + 800,
    };
  }, [visibleAssets, floorplan]);
  const width = 360;
  const height = 230;
  const project = (point) => {
    const x = ((point.x - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * width;
    const y = height - ((point.y - bounds.minY) / (bounds.maxY - bounds.minY || 1)) * height;
    return { x, y };
  };
  const routePoints = route.map(project);
  const polygonPoints = (polygon = []) => polygon.map((point) => {
    const projected = project(point);
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
  }).join(" ");
  const layers = floorplan?.layers || {};

  return (
    <section className="ops-card">
      <h3>2D Floor Plan & Route</h3>
      <svg className="asset-map" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x="1" y="1" width={width - 2} height={height - 2} rx="10" />
        <text x="12" y="22">{floorplan?.floor || "Level 9"} IFC-derived floor plan</text>
        <g className="floorplan-layer slabs">
          {(layers.slabs || []).map((shape) => (
            <polygon key={`slab-${shape.id}`} points={polygonPoints(shape.polygon)} />
          ))}
        </g>
        <g className="floorplan-layer walls">
          {(layers.walls || []).map((shape) => (
            <polygon key={`wall-${shape.id}`} points={polygonPoints(shape.polygon)} />
          ))}
        </g>
        <g className="floorplan-layer doors">
          {(layers.doors || []).map((shape) => (
            <polygon key={`door-${shape.id}`} points={polygonPoints(shape.polygon)} />
          ))}
        </g>
        <g className="floorplan-layer equipment-footprints">
          {(layers.equipment || []).map((shape) => (
            <polygon key={`equipment-${shape.id}`} points={polygonPoints(shape.polygon)}>
              <title>{shape.name}</title>
            </polygon>
          ))}
        </g>
        {routePoints.length > 1 && (
          <polyline points={routePoints.map((point) => `${point.x},${point.y}`).join(" ")} />
        )}
        {(() => {
          const point = project(USER_POSITION);
          return <circle className="user-point" cx={point.x} cy={point.y} r="6" />;
        })()}
        {visibleAssets.map((asset) => {
          const point = project(asset.position);
          return (
            <g
              className={`map-asset ${asset.asset_id === selectedAsset?.asset_id ? "active" : ""}`}
              key={asset.asset_id}
              onClick={() => onSelect(asset)}
            >
              <circle cx={point.x} cy={point.y} r={asset.asset_id === selectedAsset?.asset_id ? 7 : 5} />
              <title>{asset.asset_name}</title>
            </g>
          );
        })}
      </svg>
      <p className="hint-text">
        Footprint extracted from IFC mesh. Route to {selectedAsset?.asset_id}; target height {meters(selectedAsset?.position?.z || 0)}.
      </p>
    </section>
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

const ThatOpenCanvas = React.forwardRef(function ThatOpenCanvas({ modelFile, onPicked, onStateChange }, ref) {
  const containerRef = useRef(null);
  const componentsRef = useRef(null);
  const worldRef = useRef(null);
  const fragmentsRef = useRef(null);
  const fragmentsReadyRef = useRef(null);
  const modelRef = useRef(null);
  const loadedObjectRef = useRef(null);
  const pickedRef = useRef(null);
  const focusHelperRef = useRef(null);
  const routeLineRef = useRef(null);
  const coloredIdsRef = useRef(new Set());
  const pointerDownRef = useRef(null);
  const pointerMovedRef = useRef(false);
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
    resetCamera: () => fitModel(),
    locateAsset: (asset, options) => locateAsset(asset, options),
    colorAssets: (assets) => colorAssets(assets),
    showRoute: (points) => showRoute(points),
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

    function rememberPointerDown(event) {
      if (event.button !== 0) {
        pointerDownRef.current = null;
        pointerMovedRef.current = false;
        return;
      }
      pointerDownRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
      };
      pointerMovedRef.current = false;
    }

    function trackPointerMove(event) {
      const start = pointerDownRef.current;
      if (!start || start.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (distance > PICK_DRAG_THRESHOLD_PX) pointerMovedRef.current = true;
    }

    function isRealCanvasClick(event) {
      const start = pointerDownRef.current;
      const moved =
        pointerMovedRef.current ||
        (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > PICK_DRAG_THRESHOLD_PX);
      pointerDownRef.current = null;
      pointerMovedRef.current = false;
      return Boolean(start) && event.button === 0 && !moved;
    }

    async function pick(event) {
      if (!isRealCanvasClick(event)) return;
      const fragmentsManager = fragmentsRef.current;
      const worldState = worldRef.current;
      if (!fragmentsManager || !worldState?.renderer || !worldState?.camera) return;
      const canvas = worldState.renderer.three.domElement;
      const rect = canvas.getBoundingClientRect();
      const result = await pickWithAperture(event, rect, canvas, worldState.camera.three, fragmentsManager);
      if (!result) {
        onStateChangeRef.current({
          status: "Ready",
          message: "No object hit. Try clicking closer to a visible device.",
          progress: 100,
        });
        return;
      }

      const model = result.fragments;
      const [globalId] = await model.getGuidsByLocalIds([result.localId]);
      clearFocusMode();
      await markPicked(model, result.localId);

      let name = "";
      let ifcType = "";
      let ifcProperties = {};
      try {
        const data = await model.getItems([result.localId]);
        const item = data.get(result.localId);
        name = valueOf(item?.attrs?.Name) || "";
        ifcType = item?.category || "";
      } catch {
        // LocalId and GlobalId are enough for registry matching.
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
        // Best effort: IFC metadata can be lazily unavailable.
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
    canvas.addEventListener("pointerdown", rememberPointerDown);
    canvas.addEventListener("pointermove", trackPointerMove);
    canvas.addEventListener("click", pick);

    return () => {
      disposed = true;
      canvas.removeEventListener("pointerdown", rememberPointerDown);
      canvas.removeEventListener("pointermove", trackPointerMove);
      canvas.removeEventListener("click", pick);
      clearFocusMode();
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
    const offsets = [
      [0, 0],
      [-4, 0],
      [4, 0],
      [0, -4],
      [0, 4],
      [-10, 0],
      [10, 0],
      [0, -10],
      [0, 10],
    ];
    const fastPicker = componentsRef.current?.get(OBC.FastModelPickers)?.get(worldRef.current);
    if (fastPicker) {
      for (const [offsetX, offsetY] of offsets) {
        const mouse = new THREE.Vector2(
          ((event.clientX - rect.left + offsetX) / rect.width) * 2 - 1,
          -((event.clientY - rect.top + offsetY) / rect.height) * 2 + 1,
        );
        const pick = await fastPicker.getFullPick(mouse);
        if (!pick) continue;
        const pickedModel = fragmentsManager.list.get(pick.modelId) || model;
        if (pickedModel) return { fragments: pickedModel, localId: pick.localId };
      }
    }

    for (const [offsetX, offsetY] of offsets) {
      const mouse = new THREE.Vector2(
        ((event.clientX - rect.left + offsetX) / rect.width) * 2 - 1,
        -((event.clientY - rect.top + offsetY) / rect.height) * 2 + 1,
      );
      const raycastData = { camera, mouse, dom: canvas };
      const hit = (await fragmentsManager.raycast(raycastData)) || (model?.raycast ? await model.raycast(raycastData) : null);
      if (hit) return hit;
    }
    return null;
  }

  useEffect(() => {
    if (!modelFile || !componentsRef.current || !worldRef.current || !fragmentsRef.current) return undefined;
    let cancelled = false;

    async function loadIfc() {
      try {
        onStateChangeRef.current({ status: "Loading", message: "Loading IFC model", progress: 0 });
        const components = componentsRef.current;
        const world = worldRef.current;
        const fragments = fragmentsRef.current;
        await fragmentsReadyRef.current;

        if (routeLineRef.current) {
          world.scene.three.remove(routeLineRef.current);
          routeLineRef.current = null;
        }
        clearFocusMode();
        if (loadedObjectRef.current) {
          world.scene.three.remove(loadedObjectRef.current);
          loadedObjectRef.current = null;
        }
        for (const [, model] of fragments.list) {
          await model.dispose();
        }
        pickedRef.current = null;
        coloredIdsRef.current = new Set();

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
        const model = await loader.load(new Uint8Array(buffer), true, modelFile.name, {
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

  async function markPicked(model, localId) {
    try {
      if (pickedRef.current?.model && pickedRef.current.localId !== localId) {
        await pickedRef.current.model.resetColor([pickedRef.current.localId]);
      }
      await model.setColor([localId], PICKED_COLOR);
      pickedRef.current = { model, localId };
      fragmentsRef.current?.core.update(true);
    } catch {
      // Picking metadata still works if a fragment cannot recolor.
    }
  }

  function clearFocusMode() {
    const world = worldRef.current;
    const helper = focusHelperRef.current;
    if (helper && world?.scene) {
      world.scene.three.remove(helper);
      helper.traverse((child) => {
        child.geometry?.dispose?.();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
        else child.material?.dispose?.();
      });
    }
    focusHelperRef.current = null;
    fragmentsRef.current?.core.update(true);
  }

  function applyFocusMode(box) {
    const world = worldRef.current;
    if (!world?.scene) return;
    clearFocusMode();

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const helperGroup = new THREE.Group();
    helperGroup.name = "Selected asset visual frame";

    const itemBox = box.clone().expandByScalar(0.18);
    const boxHelper = new THREE.Box3Helper(itemBox, 0xf59e0b);
    if (boxHelper.material) {
      boxHelper.material.depthTest = false;
      boxHelper.material.transparent = true;
      boxHelper.material.opacity = 0.95;
    }
    boxHelper.renderOrder = 999;
    helperGroup.add(boxHelper);

    const haloRadius = Math.max(size.length() * 0.75, 0.45);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(haloRadius, 32, 16),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        depthTest: false,
        depthWrite: false,
      }),
    );
    halo.position.copy(center);
    halo.renderOrder = 1000;
    helperGroup.add(halo);

    focusHelperRef.current = helperGroup;
    world.scene.three.add(helperGroup);
    fragmentsRef.current?.core.update(true);
  }

  async function colorAssets(assets) {
    const model = modelRef.current;
    if (!model || !assets?.length) return;
    try {
      if (coloredIdsRef.current.size) await model.resetColor(Array.from(coloredIdsRef.current));
      const nextIds = new Set();
      for (const asset of assets) {
        if (!asset.source_global_id) continue;
        const [localId] = await model.getLocalIdsByGuids([asset.source_global_id]);
        if (!localId) continue;
        nextIds.add(localId);
        await model.setColor([localId], new THREE.Color(STATUS_COLORS[asset.status] || STATUS_COLORS.Normal));
      }
      coloredIdsRef.current = nextIds;
      fragmentsRef.current?.core.update(true);
    } catch {
      // Status coloring is a visual helper; keep the model usable if it fails.
    }
  }

  async function locateAsset(asset, options = {}) {
    const model = modelRef.current;
    if (!model || !asset?.source_global_id) return;
    try {
      const [localId] = await model.getLocalIdsByGuids([asset.source_global_id]);
      if (!localId) {
        onStateChangeRef.current({ status: "Ready", message: `No IFC object for ${asset.asset_id}`, progress: 100 });
        return;
      }
      await markPicked(model, localId);
      if (options.zoom !== false) await zoomToLocalId(localId, { focus: true });
      onStateChangeRef.current({ status: "Ready", message: `Located ${asset.asset_id}`, progress: 100 });
    } catch (error) {
      onStateChangeRef.current({ status: "Error", message: error.message || "Locate failed", progress: 0 });
    }
  }

  async function zoomToLocalId(localId, options = {}) {
    const model = modelRef.current;
    const world = worldRef.current;
    if (!model || !world?.camera) return;
    const boxes = await model.getBoxes([localId]);
    if (!boxes?.length) return;
    const box = boxes.reduce((acc, item) => acc.union(item), boxes[0].clone());
    if (options.focus) applyFocusMode(box);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * (options.focus ? 2.4 : 1.6), options.focus ? 2.8 : 1.5);
    const camera = world.camera.three;
    camera.near = 0.01;
    camera.far = Math.max(radius * 300, 1000);
    camera.updateProjectionMatrix();
    const eye = options.focus
      ? {
          x: center.x + radius * 1.15,
          y: center.y + radius * 0.85,
          z: center.z + radius * 1.05,
        }
      : {
          x: center.x + radius * 1.1,
          y: center.y - radius * 1.2,
          z: center.z + radius * 0.9,
        };
    await world.camera.controls.setLookAt(
      eye.x,
      eye.y,
      eye.z,
      center.x,
      center.y,
      center.z,
      true,
    );
    if (!options.focus) await world.camera.controls.fitToSphere(new THREE.Sphere(center, radius), true);
    fragmentsRef.current?.core.update(true);
  }

  function modelPoint(point) {
    return new THREE.Vector3(
      (point.x || 0) / 1000,
      (point.floorElevationM ?? 36) + (point.z || 0) / 1000 + 0.18,
      -(point.y || 0) / 1000,
    );
  }

  function showRoute(points) {
    const world = worldRef.current;
    if (!world?.scene) return;
    if (routeLineRef.current) {
      world.scene.three.remove(routeLineRef.current);
      routeLineRef.current.geometry.dispose();
      routeLineRef.current.material.dispose();
      routeLineRef.current = null;
    }
    if (!points || points.length < 2) return;
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(modelPoint));
    const material = new THREE.LineBasicMaterial({ color: 0x2563eb, linewidth: 4 });
    const line = new THREE.Line(geometry, material);
    line.name = "Mock technician route";
    routeLineRef.current = line;
    world.scene.three.add(line);
    fragmentsRef.current?.core.update(true);
  }

  async function fitModel() {
    const world = worldRef.current;
    const model = modelRef.current;
    if (!world?.camera || !model?.box) return;
    clearFocusMode();
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
