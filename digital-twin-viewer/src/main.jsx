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
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
const INDOOR_CORRIDOR_Y_BY_FLOOR = {
  "Level 9": 3600,
  "Level 10": 7300,
};
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

function routeFromLocation(location = window.location) {
  const path = location.pathname.replace(/\/+$/, "") || "/campus";
  const buildingMatch = path.match(/^\/building\/([^/]+)$/);
  if (buildingMatch) return { mode: "building", buildingId: decodeURIComponent(buildingMatch[1]) };
  return { mode: "site", buildingId: "" };
}

function routePathForCampus() {
  return "/campus";
}

function routePathForBuilding(building) {
  return `/building/${encodeURIComponent(building.building_id)}`;
}

function replaceRoute(path) {
  if (window.location.pathname !== path) window.history.replaceState({}, "", path);
}

function pushRoute(path) {
  if (window.location.pathname !== path) window.history.pushState({}, "", path);
}

function assetBuildingId(asset) {
  return asset?.building_id || "MARRIOTT_EQUIPMENT";
}

function buildingAssetSourceId(building) {
  return building?.asset_source_building_id || building?.building_id || "";
}

function statusRank(status) {
  return { Fault: 4, Offline: 3, Warning: 2, Normal: 1 }[status] || 0;
}

function aggregateStatus(assets) {
  return assets.reduce((current, asset) => (statusRank(asset.status) > statusRank(current) ? asset.status : current), "Normal");
}

function buildingAssetsFor(building, assets) {
  const sourceId = buildingAssetSourceId(building);
  if (!sourceId) return [];
  return assets.filter((asset) => assetBuildingId(asset) === sourceId);
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

function technicianSitePosition(tech) {
  if (tech?.site_position) return tech.site_position;
  if (tech?.position) return { x: (tech.position.x || 0) / 1000, y: (tech.position.y || 0) / 1000, unit: "m" };
  return null;
}

function distanceSiteMeters(a, b) {
  if (!a || !b) return Infinity;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function closestPointOnSegment(point, start, end) {
  const dx = (end.x || 0) - (start.x || 0);
  const dy = (end.y || 0) - (start.y || 0);
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return { x: start.x || 0, y: start.y || 0 };
  const t = Math.max(0, Math.min(1, (((point.x || 0) - (start.x || 0)) * dx + ((point.y || 0) - (start.y || 0)) * dy) / lengthSq));
  return { x: (start.x || 0) + t * dx, y: (start.y || 0) + t * dy };
}

function closestRoadPoint(siteLayout, point) {
  let best = null;
  (siteLayout?.roads || []).forEach((road) => {
    const centerline = road.centerline || [];
    for (let index = 0; index < centerline.length - 1; index++) {
      const projected = closestPointOnSegment(point, centerline[index], centerline[index + 1]);
      const distance = distanceSiteMeters(point, projected);
      if (!best || distance < best.distance) best = { ...projected, distance, road_id: road.road_id };
    }
  });
  return best;
}

function pointKey(point) {
  return `${Number(point.x || 0).toFixed(3)},${Number(point.y || 0).toFixed(3)}`;
}

function isPointOnSegment(point, start, end) {
  const minX = Math.min(start.x, end.x) - 0.001;
  const maxX = Math.max(start.x, end.x) + 0.001;
  const minY = Math.min(start.y, end.y) - 0.001;
  const maxY = Math.max(start.y, end.y) + 0.001;
  const cross = ((point.y || 0) - (start.y || 0)) * ((end.x || 0) - (start.x || 0)) -
    ((point.x || 0) - (start.x || 0)) * ((end.y || 0) - (start.y || 0));
  return Math.abs(cross) < 0.01 && point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function segmentIntersection(a1, a2, b1, b2) {
  const adx = (a2.x || 0) - (a1.x || 0);
  const ady = (a2.y || 0) - (a1.y || 0);
  const bdx = (b2.x || 0) - (b1.x || 0);
  const bdy = (b2.y || 0) - (b1.y || 0);
  const denominator = adx * bdy - ady * bdx;
  if (Math.abs(denominator) < 0.0001) return null;
  const dx = (b1.x || 0) - (a1.x || 0);
  const dy = (b1.y || 0) - (a1.y || 0);
  const t = (dx * bdy - dy * bdx) / denominator;
  const u = (dx * ady - dy * adx) / denominator;
  if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) return null;
  return { x: (a1.x || 0) + t * adx, y: (a1.y || 0) + t * ady };
}

function roadGraphPath(siteLayout, startPoint, endPoint) {
  const segments = [];
  (siteLayout?.roads || []).forEach((road) => {
    const centerline = road.centerline || [];
    for (let index = 0; index < centerline.length - 1; index++) {
      segments.push({ road_id: road.road_id, start: centerline[index], end: centerline[index + 1], points: [] });
    }
  });
  if (!segments.length) return [];

  segments.forEach((segment) => {
    segment.points.push(segment.start, segment.end);
    if (isPointOnSegment(startPoint, segment.start, segment.end)) segment.points.push(startPoint);
    if (isPointOnSegment(endPoint, segment.start, segment.end)) segment.points.push(endPoint);
  });

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const intersection = segmentIntersection(segments[i].start, segments[i].end, segments[j].start, segments[j].end);
      if (!intersection) continue;
      segments[i].points.push(intersection);
      segments[j].points.push(intersection);
    }
  }

  const nodes = new Map();
  const edges = new Map();
  const addNode = (point) => {
    const key = pointKey(point);
    if (!nodes.has(key)) nodes.set(key, { x: point.x, y: point.y });
    if (!edges.has(key)) edges.set(key, []);
    return key;
  };
  const addEdge = (a, b) => {
    const aKey = addNode(a);
    const bKey = addNode(b);
    const distance = distanceSiteMeters(a, b);
    if (distance < 0.001) return;
    edges.get(aKey).push({ key: bKey, distance });
    edges.get(bKey).push({ key: aKey, distance });
  };

  segments.forEach((segment) => {
    const unique = Array.from(new Map(segment.points.map((point) => [pointKey(point), point])).values());
    unique
      .sort((a, b) => distanceSiteMeters(segment.start, a) - distanceSiteMeters(segment.start, b))
      .forEach((point, index, all) => {
        if (index > 0) addEdge(all[index - 1], point);
      });
  });

  const startKey = addNode(startPoint);
  const endKey = addNode(endPoint);
  const distances = new Map(Array.from(nodes.keys()).map((key) => [key, Infinity]));
  const previous = new Map();
  const pending = new Set(nodes.keys());
  distances.set(startKey, 0);

  while (pending.size) {
    let currentKey = null;
    let currentDistance = Infinity;
    pending.forEach((key) => {
      const distance = distances.get(key);
      if (distance < currentDistance) {
        currentDistance = distance;
        currentKey = key;
      }
    });
    if (!currentKey || currentKey === endKey) break;
    pending.delete(currentKey);
    (edges.get(currentKey) || []).forEach((edge) => {
      if (!pending.has(edge.key)) return;
      const nextDistance = currentDistance + edge.distance;
      if (nextDistance < distances.get(edge.key)) {
        distances.set(edge.key, nextDistance);
        previous.set(edge.key, currentKey);
      }
    });
  }

  if (!previous.has(endKey) && startKey !== endKey) return [];
  const path = [];
  let cursor = endKey;
  while (cursor) {
    path.unshift(nodes.get(cursor));
    if (cursor === startKey) break;
    cursor = previous.get(cursor);
  }
  return path;
}

function compactRoutePoints(points) {
  return points.filter((point, index, all) => {
    if (!point) return false;
    const previous = all[index - 1];
    return !previous || distanceSiteMeters(previous, point) > 0.6;
  });
}

function campusRouteForTechnician(tech, building, siteLayout) {
  const start = technicianSitePosition(tech);
  const entry = building?.entry_position || building?.position;
  const target = building?.position;
  if (!start || !entry || !target) return [];
  const startRoad = closestRoadPoint(siteLayout, start);
  const targetRoad = closestRoadPoint(siteLayout, entry);
  if (!startRoad || !targetRoad) return compactRoutePoints([start, target]);
  const roadPath = roadGraphPath(siteLayout, startRoad, targetRoad);
  return compactRoutePoints([start, ...(roadPath.length ? roadPath : [startRoad, targetRoad]), entry, target]);
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

function incidentKeyForAlert(alert) {
  return `${alert.asset_id}:${alert.status}`;
}

function makeIncidentFromAlert(alert, index = 0) {
  const now = new Date().toISOString();
  return {
    incident_id: `INC-${alert.asset_id}-${alert.status}`.replace(/[^A-Z0-9-]/gi, "-").toUpperCase(),
    incident_key: incidentKeyForAlert(alert),
    alert_id: alert.alert_id,
    asset_id: alert.asset_id,
    building_id: assetBuildingId(alert.asset),
    title: alert.message,
    severity: alert.severity,
    status: "New",
    created_at: now,
    updated_at: now,
    assigned_technician_id: "",
    work_order_id: "",
    sort_index: index,
  };
}

const REPAIR_BASE_MINUTES = {
  Camera: { Warning: 20, Fault: 45, Offline: 35 },
  Light: { Warning: 15, Fault: 40, Offline: 30 },
  Sensor: { Warning: 20, Fault: 35, Offline: 25 },
  "Extract Fan": { Warning: 45, Fault: 90, Offline: 65 },
  AHU: { Warning: 60, Fault: 120, Offline: 80 },
  "Electric Meter": { Warning: 40, Fault: 95, Offline: 70 },
  Pump: { Warning: 45, Fault: 85, Offline: 65 },
};

function roundToNearestFive(value) {
  return Math.max(5, Math.ceil(value / 5) * 5);
}

function formatDuration(minutes = 0) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${mins} min`;
  if (!mins) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function repairStatusFor(incident, asset) {
  const fromKey = String(incident?.incident_key || "").split(":")[1];
  return fromKey || asset?.status || "Fault";
}

function estimateRepairTime({ incident, asset, technician }) {
  if (!incident || !asset) return null;
  const status = repairStatusFor(incident, asset);
  const baseByStatus = REPAIR_BASE_MINUTES[asset.asset_type] || { Warning: 30, Fault: 70, Offline: 50 };
  const fixMinutes = baseByStatus[status] || baseByStatus.Fault || 60;
  const diagnosisMinutes = incident.severity === "High" ? 18 : incident.severity === "Medium" ? 12 : 8;
  const criticalityMinutes = asset.criticality === "High" ? 10 : asset.criticality === "Medium" ? 5 : 0;
  const skillPenalty = technician?.specialties?.includes(asset.specialty) ? 0 : 30;
  const availabilityPenalty = technician?.availability === "Busy" ? 25 : 0;
  const distance = Number.isFinite(technician?.distance)
    ? technician.distance
    : distanceFromPointMeters(technician?.position, asset);
  const travelMinutes = Number.isFinite(distance) ? roundToNearestFive(Math.max(4, distance / 70 + 4)) : 10;
  const totalMinutes = roundToNearestFive(
    travelMinutes + diagnosisMinutes + fixMinutes + criticalityMinutes + skillPenalty + availabilityPenalty,
  );
  const slaMinutes = incident.severity === "High" ? 120 : incident.severity === "Medium" ? 240 : 480;
  const confidence =
    asset.source_global_id && asset.device_id && asset.position && technician
      ? "High"
      : asset.position && technician
        ? "Medium"
        : "Low";
  return {
    status,
    totalMinutes,
    travelMinutes,
    diagnosisMinutes,
    fixMinutes,
    criticalityMinutes,
    skillPenalty,
    availabilityPenalty,
    slaMinutes,
    confidence,
  };
}

function makeWorkOrder({ incident, asset, technician, existingCount = 0 }) {
  const now = new Date();
  const estimate = estimateRepairTime({ incident, asset, technician });
  const due = new Date(now.getTime() + (estimate?.totalMinutes || 120) * 60 * 1000);
  const priority = incident.severity === "High" ? "High" : incident.severity === "Medium" ? "Medium" : "Low";
  return {
    work_order_id: `WO-${String(existingCount + 1).padStart(4, "0")}`,
    incident_id: incident.incident_id,
    asset_id: incident.asset_id,
    building_id: incident.building_id,
    technician_id: technician.technician_id,
    priority,
    status: "Assigned",
    task: `Inspect ${asset?.asset_name || incident.asset_id} and restore normal operation`,
    created_at: now.toISOString(),
    due_at: due.toISOString(),
    estimated_repair_minutes: estimate?.totalMinutes || 120,
    estimated_travel_minutes: estimate?.travelMinutes || 10,
    estimated_fix_minutes: estimate?.fixMinutes || 60,
    repair_confidence: estimate?.confidence || "Low",
    repair_estimate_breakdown: estimate || null,
  };
}

function qualityChecksForAsset(asset) {
  return {
    hasIfcLink: Boolean(asset?.source_global_id),
    ifcObjectFound: Boolean(asset?.source_global_id) && !asset?.runtime_only,
    hasDeviceId: Boolean(asset?.device_id),
    hasMqttTopic: Boolean(asset?.mqtt_topic),
    hasTelemetry: Boolean(asset?.telemetry || asset?.telemetry_template),
    hasPosition: Boolean(asset?.position && Number.isFinite(Number(asset.position.x)) && Number.isFinite(Number(asset.position.y))),
    hasBuildingId: Boolean(asset?.building_id),
    hasTelemetryTemplate: Boolean(asset?.telemetry_template),
  };
}

function qualityIssuesForAsset(asset) {
  const checks = qualityChecksForAsset(asset);
  const issues = [];
  if (!checks.hasIfcLink || !checks.ifcObjectFound) issues.push("Missing IFC Link");
  if (!checks.hasDeviceId || !checks.hasMqttTopic || !checks.hasTelemetry) issues.push("Missing Device Link");
  if (!checks.hasPosition) issues.push("Missing Position");
  if (!checks.hasBuildingId) issues.push("Missing Building");
  return issues;
}

function qualityStatusForAsset(asset) {
  const issues = qualityIssuesForAsset(asset);
  if (!issues.length) return "Ready";
  if (issues.length === 1) return issues[0];
  return "Incomplete";
}

function buildDataQualitySummary(assets) {
  const summary = {
    total: assets.length,
    mappedToIfc: 0,
    missingIfc: 0,
    withDeviceId: 0,
    withMqttTopic: 0,
    withPosition: 0,
    withBuildingId: 0,
    withTelemetryTemplate: 0,
    ready: 0,
    withIssues: 0,
  };
  assets.forEach((asset) => {
    const checks = qualityChecksForAsset(asset);
    if (checks.hasIfcLink && checks.ifcObjectFound) summary.mappedToIfc += 1;
    if (!checks.hasIfcLink) summary.missingIfc += 1;
    if (checks.hasDeviceId) summary.withDeviceId += 1;
    if (checks.hasMqttTopic) summary.withMqttTopic += 1;
    if (checks.hasPosition) summary.withPosition += 1;
    if (checks.hasBuildingId) summary.withBuildingId += 1;
    if (checks.hasTelemetryTemplate) summary.withTelemetryTemplate += 1;
    if (qualityStatusForAsset(asset) === "Ready") summary.ready += 1;
    else summary.withIssues += 1;
  });
  return summary;
}

function routeForAsset(asset) {
  if (!asset?.position) return [];
  const target = asset.position;
  const floorElevationM = asset.floor_elevation_m ?? 36;
  const corridorY = INDOOR_CORRIDOR_Y_BY_FLOOR[asset.floor] || target.y || USER_POSITION.y;
  const start = { ...USER_POSITION, floorElevationM };
  return [
    start,
    { x: USER_POSITION.x, y: corridorY, z: 0, unit: "mm", floorElevationM },
    { x: target.x, y: corridorY, z: 0, unit: "mm", floorElevationM },
    { ...target, floorElevationM },
  ].filter((point, index, all) => {
    const previous = all[index - 1];
    if (!previous) return true;
    return (
      Math.hypot(
        (point.x || 0) - (previous.x || 0),
        (point.y || 0) - (previous.y || 0),
        (point.z || 0) - (previous.z || 0),
      ) > 120
    );
  });
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

function scoreTechniciansForBuilding(technicians, building) {
  if (!building?.position) return [];
  return technicians
    .map((tech) => {
      const sitePosition = technicianSitePosition(tech);
      const distance = distanceSiteMeters(sitePosition, building.position);
      const availabilityPenalty = tech.availability === "Available" ? 0 : 20;
      const score = -distance - availabilityPenalty;
      return { ...tech, sitePosition, skillMatch: 0, distance, score };
    })
    .sort((a, b) => b.score - a.score);
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
  const [siteLayout, setSiteLayout] = useState(null);
  const [viewMode, setViewMode] = useState("site");
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [floorplan, setFloorplan] = useState(null);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState("");
  const [selectedFileKey, setSelectedFileKey] = useState("");
  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [workOrders, setWorkOrders] = useState([]);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState("");
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
    dataIssue: "",
  });
  const [naturalQuery, setNaturalQuery] = useState("");
  const [naturalResult, setNaturalResult] = useState(null);
  const [naturalLoading, setNaturalLoading] = useState(false);
  const [radius, setRadius] = useState(8);
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
  const activeBuildingAssetSourceId = useMemo(() => buildingAssetSourceId(selectedBuilding), [selectedBuilding]);
  const activeAssets = useMemo(() => {
    if (viewMode !== "building" || !activeBuildingAssetSourceId) return assets;
    return assets.filter((asset) => assetBuildingId(asset) === activeBuildingAssetSourceId);
  }, [activeBuildingAssetSourceId, assets, viewMode]);
  const activeAssetIds = useMemo(() => new Set(activeAssets.map((asset) => asset.asset_id)), [activeAssets]);
  const alerts = useMemo(() => buildAlerts(activeAssets), [activeAssets]);
  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.incident_id === selectedIncidentId) || null,
    [incidents, selectedIncidentId],
  );
  const selectedWorkOrder = useMemo(
    () => workOrders.find((workOrder) => workOrder.work_order_id === selectedWorkOrderId) || null,
    [selectedWorkOrderId, workOrders],
  );
  const visibleIncidents = useMemo(
    () => incidents.filter((incident) => activeAssetIds.has(incident.asset_id)),
    [activeAssetIds, incidents],
  );
  const visibleWorkOrders = useMemo(
    () => workOrders.filter((workOrder) => activeAssetIds.has(workOrder.asset_id)),
    [activeAssetIds, workOrders],
  );
  const types = useMemo(() => Array.from(new Set(activeAssets.map((asset) => asset.asset_type))).sort(), [activeAssets]);
  const floors = useMemo(() => Array.from(new Set(activeAssets.map((asset) => asset.floor))).sort(), [activeAssets]);
  const zones = useMemo(() => Array.from(new Set(activeAssets.map((asset) => asset.zone))).sort(), [activeAssets]);
  const dataQualitySummary = useMemo(() => buildDataQualitySummary(activeAssets), [activeAssets]);
  const buildingStats = useMemo(() => {
    const stats = new Map();
    (siteLayout?.buildings || []).forEach((building) => {
      const buildingAssets = buildingAssetsFor(building, assets);
      const buildingAlerts = buildAlerts(buildingAssets);
      stats.set(building.building_id, {
        assetCount: buildingAssets.length,
        alertCount: buildingAlerts.length,
        status: buildingAssets.length ? aggregateStatus(buildingAssets) : "Normal",
      });
    });
    return stats;
  }, [assets, siteLayout]);
  const activeScenario = useMemo(
    () => SCENARIOS.find((scenario) => scenario.id === activeScenarioId) || SCENARIOS[0],
    [activeScenarioId],
  );
  const filteredAssets = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return activeAssets.filter((asset) => {
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
        (!filters.problemOnly || ["Warning", "Fault", "Offline"].includes(asset.status)) &&
        (!filters.dataIssue ||
          (filters.dataIssue === "any" && qualityStatusForAsset(asset) !== "Ready") ||
          qualityIssuesForAsset(asset).includes(filters.dataIssue))
      );
    });
  }, [activeAssets, filters]);
  const spatialResults = useMemo(() => {
    if (!selectedRuntimeAsset) return [];
    return activeAssets
      .filter((asset) => asset.asset_id !== selectedRuntimeAsset.asset_id)
      .map((asset) => ({ ...asset, distance: distanceMeters(asset, selectedRuntimeAsset) }))
      .filter((asset) => {
        if (asset.distance > Number(radius || 0)) return false;
        if (spatialKind === "Camera") return asset.asset_type === "Camera";
        if (spatialKind === "Sensor") return asset.asset_type === "Sensor";
        return true;
      })
      .sort((a, b) => a.distance - b.distance);
  }, [activeAssets, radius, selectedRuntimeAsset, spatialKind]);
  const route = useMemo(() => routeForAsset(selectedRuntimeAsset), [selectedRuntimeAsset]);
  const dispatchCandidates = useMemo(
    () => scoreTechnicians(technicians, selectedRuntimeAsset),
    [technicians, selectedRuntimeAsset],
  );
  const siteDispatchCandidates = useMemo(
    () => scoreTechniciansForBuilding(technicians, selectedBuilding),
    [technicians, selectedBuilding],
  );
  const selectedSiteTechnician = useMemo(
    () =>
      technicians.find((tech) => tech.technician_id === selectedTechnicianId) ||
      siteDispatchCandidates[0] ||
      null,
    [selectedTechnicianId, siteDispatchCandidates, technicians],
  );
  const campusRoute = useMemo(
    () => campusRouteForTechnician(selectedSiteTechnician, selectedBuilding, siteLayout),
    [selectedBuilding, selectedSiteTechnician, siteLayout],
  );
  const relationships = useMemo(
    () => buildAssetRelationships(selectedRuntimeAsset, activeAssets),
    [activeAssets, selectedRuntimeAsset],
  );

  function applyRoute(route, context = {}) {
    const layout = context.siteLayout || siteLayout;
    const ifcFiles = context.allIfcFiles || allIfcFiles;
    const currentAssets = context.assets || assets;
    if (!layout?.buildings?.length) return;

    if (route.mode === "building") {
      const building =
        layout.buildings.find((item) => item.building_id === route.buildingId) ||
        layout.buildings.find((item) => item.building_id === decodeURIComponent(route.buildingId || ""));
      if (!building) {
        setViewMode("site");
        setSelectedBuilding(layout.buildings[0]);
        replaceRoute(routePathForCampus());
        return;
      }

      const file = ifcFiles.find((item) => item.name === building.ifc_file);
      setSelectedBuilding(building);
      setViewMode("building");
      if (file) setSelectedFileKey(file.key);
      setSelectedObject(null);
      const buildingAssets = buildingAssetsFor(building, currentAssets);
      setSelectedAsset(buildingAssets[0] || null);
      setFilters({ search: "", type: "", floor: "", zone: "", status: "", specialty: "", problemOnly: false, dataIssue: "" });
      setViewerState({
        status: "Idle",
        message: file ? `Opening ${building.name}` : `IFC file not found: ${building.ifc_file}`,
        progress: 0,
      });
      return;
    }

    setViewMode("site");
    setSelectedObject(null);
    setViewerState({ status: "Ready", message: "Campus overview", progress: 100 });
  }

  useEffect(() => {
    async function bootstrap() {
      const [fileRes, assetRes, techRes, floorplanRes, siteRes, incidentRes] = await Promise.all([
        fetch("/api/files"),
        fetch("/api/operations/assets"),
        fetch("/api/operations/technicians"),
        fetch("/api/operations/floorplan"),
        fetch("/api/operations/site-layout"),
        fetch("/api/operations/incidents"),
      ]);
      const fileData = await fileRes.json();
      const assetData = (await assetRes.json()).map((asset) => ({
        building_id: "MARRIOTT_EQUIPMENT",
        ...asset,
      }));
      const techData = await techRes.json();
      const floorplanData = await floorplanRes.json();
      const siteData = await siteRes.json();
      const incidentData = await incidentRes.json();
      setFiles(fileData);
      setOperationAssets(assetData);
      setTechnicians(techData);
      setIncidents(incidentData);
      setSiteLayout(siteData);
      setFloorplan(floorplanData);
      setTelemetryByDevice(initialTelemetry(assetData));

      const preferred = preferredIfcFile(fileData.ifcFiles || []);
      const outputIfcFiles = (fileData.ifcFiles || []).map((file) => ({ ...file, key: `output:${file.name}`, source: "output" }));
      if (preferred) setSelectedFileKey(`output:${preferred.name}`);
      if (assetData[0]) setSelectedAsset(assetData[0]);
      const defaultBuilding =
        siteData?.buildings?.find((building) => building.ifc_file === PREFERRED_IFC) || siteData?.buildings?.[0] || null;
      setSelectedBuilding(defaultBuilding);
      const initialRoute = routeFromLocation();
      if (window.location.pathname === "/") replaceRoute(routePathForCampus());
      applyRoute(initialRoute, { siteLayout: siteData, allIfcFiles: outputIfcFiles, assets: assetData });
      checkLlmStatus();
    }
    bootstrap().catch((error) => {
      setViewerState({ status: "Error", message: error.message, progress: 0 });
    });
  }, []);

  useEffect(() => {
    function handlePopState() {
      applyRoute(routeFromLocation());
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [siteLayout, allIfcFiles, assets]);

  useEffect(() => {
    if (!operationAssets.length) return;
    setTelemetryByDevice(telemetryForScenario(operationAssets, activeScenario, tick));
  }, [activeScenario, operationAssets]);

  useEffect(() => {
    if (!alerts.length) return;
    setIncidents((current) => {
      const byKey = new Map(current.map((incident) => [incident.incident_key, incident]));
      let changed = false;
      alerts.forEach((alert, index) => {
        const key = incidentKeyForAlert(alert);
        if (!byKey.has(key)) {
          byKey.set(key, makeIncidentFromAlert(alert, index));
          changed = true;
        }
      });
      return changed ? Array.from(byKey.values()).sort((a, b) => a.sort_index - b.sort_index) : current;
    });
  }, [alerts]);

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
    asset.building_id = activeBuildingAssetSourceId || asset.building_id || "MARRIOTT_EQUIPMENT";
    setOperationAssets((current) => [...current, asset]);
    setTelemetryByDevice((current) => ({
      ...current,
      [asset.device_id]: makeTelemetry(asset, asset.status || "Normal", tick),
    }));
    setSelectedAsset(asset);
    setSelectedObject(null);
    setAddAssetOpen(false);
  }

  function openBuilding(building) {
    if (!building) return;
    pushRoute(routePathForBuilding(building));
    const file = allIfcFiles.find((item) => item.name === building.ifc_file);
    setSelectedBuilding(building);
    setViewMode("building");
    if (file) setSelectedFileKey(file.key);
    setSelectedObject(null);
    const buildingAssets = buildingAssetsFor(building, assets);
    setSelectedAsset(buildingAssets[0] || null);
    setFilters({ search: "", type: "", floor: "", zone: "", status: "", specialty: "", problemOnly: false });
    setViewerState({
      status: "Idle",
      message: file ? `Opening ${building.name}` : `IFC file not found: ${building.ifc_file}`,
      progress: 0,
    });
  }

  function backToSite() {
    pushRoute(routePathForCampus());
    setViewMode("site");
    setSelectedObject(null);
    setViewerState({ status: "Ready", message: "Campus overview", progress: 100 });
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
        dataIssue: "",
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

  function assetForIncident(incident) {
    return assets.find((asset) => asset.asset_id === incident?.asset_id) || null;
  }

  function selectIncident(incident) {
    if (!incident) return;
    setSelectedIncidentId(incident.incident_id);
    const asset = assetForIncident(incident);
    if (asset) selectAsset(asset);
  }

  function updateIncidentStatus(incidentId, status, patch = {}) {
    setIncidents((current) =>
      current.map((incident) =>
        incident.incident_id === incidentId
          ? { ...incident, ...patch, status, updated_at: new Date().toISOString() }
          : incident,
      ),
    );
  }

  function acknowledgeIncident(incident) {
    updateIncidentStatus(incident.incident_id, "Acknowledged");
  }

  function assignIncident(incident, technicianId) {
    updateIncidentStatus(incident.incident_id, "Assigned", { assigned_technician_id: technicianId });
  }

  function selectWorkOrder(workOrder) {
    if (!workOrder) return;
    setSelectedWorkOrderId(workOrder.work_order_id);
    const incident = incidents.find((item) => item.incident_id === workOrder.incident_id);
    if (incident) setSelectedIncidentId(incident.incident_id);
    const asset = assets.find((item) => item.asset_id === workOrder.asset_id);
    if (asset) selectAsset(asset);
  }

  function createWorkOrderForIncident(incident, technicianId) {
    const asset = assetForIncident(incident);
    const technician =
      technicians.find((item) => item.technician_id === technicianId) ||
      scoreTechnicians(technicians, asset)[0];
    if (!incident || !asset || !technician) return;
    const existing = workOrders.find((workOrder) => workOrder.incident_id === incident.incident_id);
    if (existing) {
      selectWorkOrder(existing);
      return;
    }
    const workOrder = makeWorkOrder({ incident, asset, technician, existingCount: workOrders.length });
    setWorkOrders((current) => [...current, workOrder]);
    setSelectedWorkOrderId(workOrder.work_order_id);
    updateIncidentStatus(incident.incident_id, "Assigned", {
      assigned_technician_id: technician.technician_id,
      work_order_id: workOrder.work_order_id,
    });
  }

  function updateWorkOrderStatus(workOrderId, status) {
    const linkedIncidentId = workOrders.find((workOrder) => workOrder.work_order_id === workOrderId)?.incident_id || "";
    setWorkOrders((current) =>
      current.map((workOrder) => (workOrder.work_order_id === workOrderId ? { ...workOrder, status } : workOrder)),
    );
    if (status === "Resolved" && linkedIncidentId) {
      updateIncidentStatus(linkedIncidentId, "Resolved");
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
    <div className={`app-shell operations-shell ${viewMode === "building" ? "building-mode" : "site-mode"}`}>
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
          <button className={`mode-chip ${viewMode === "site" ? "active" : ""}`} onClick={backToSite} type="button">
            Campus
          </button>
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
            <Metric icon={<Building2 size={18} />} label="Buildings" value={siteLayout?.buildings?.length || 0} />
            <Metric icon={<Box size={18} />} label="Assets" value={activeAssets.length} />
            <Metric icon={<Bell size={18} />} label="Alerts" value={alerts.length} />
            <Metric icon={<Database size={18} />} label="Systems" value={new Set(activeAssets.map((a) => a.system)).size} />
          </section>

          <section className="ops-card campus-panel">
            <h3>{viewMode === "site" ? "Campus Overview" : selectedBuilding?.name || "Building Detail"}</h3>
            <p className="hint-text">
              {viewMode === "site"
                ? "Click a building preview to inspect it, then open the detailed IFC viewer."
                : `Detail IFC: ${selectedBuilding?.ifc_file || selectedModel?.name || "n/a"}`}
            </p>
            {viewMode === "building" && (
              <button className="primary-action" type="button" onClick={backToSite}>
                Back to Campus
              </button>
            )}
          </section>

          <FilterPanel
            filters={filters}
            setFilters={setFilters}
            types={types}
            floors={floors}
            zones={zones}
            dataQualitySummary={dataQualitySummary}
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

          <DataQualityPanel summary={dataQualitySummary} />

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
          {viewMode === "site" ? (
            <CampusView
              siteLayout={siteLayout}
              buildingStats={buildingStats}
              technicians={technicians}
              selectedTechnician={selectedSiteTechnician}
              selectedBuilding={selectedBuilding}
              route={campusRoute}
              onSelectBuilding={setSelectedBuilding}
              onSelectTechnician={(tech) => setSelectedTechnicianId(tech.technician_id)}
              onOpenBuilding={openBuilding}
            />
          ) : (
            <>
              <div className="viewer-toolbar">
                <StatusPill state={viewerState} />
                <button className="icon-button" title="Back to campus" onClick={backToSite}>
                  <Building2 size={18} />
                </button>
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
                <span>Building detail: inspect IFC metadata, locate assets, filter telemetry, and return to campus when needed.</span>
              </div>
            </>
          )}
        </section>

        <aside className="property-panel operations-panel">
          <section className="panel-head">
            <div>
              <span className="eyebrow">{viewMode === "site" ? "Selected Building" : "Selected Asset"}</span>
              <h2>
                {viewMode === "site"
                  ? selectedBuilding?.name || "No building selected"
                  : selectedRuntimeAsset?.asset_name || selectedObject?.name || "No asset selected"}
              </h2>
            </div>
            {viewMode === "site" && selectedBuilding ? (
              <StatusBadge status={buildingStats.get(selectedBuilding.building_id)?.status || "Normal"} />
            ) : selectedRuntimeAsset ? (
              <StatusBadge status={selectedRuntimeAsset.status} />
            ) : (
              <AlertTriangle className="warn" size={22} />
            )}
          </section>

          {viewMode === "site" && selectedBuilding && (
            <>
              <CampusBuildingPanel
                building={selectedBuilding}
                stats={buildingStats.get(selectedBuilding.building_id)}
                onOpen={() => openBuilding(selectedBuilding)}
              />
              <CampusSiteMap
                siteLayout={siteLayout}
                technicians={technicians}
                selectedTechnician={selectedSiteTechnician}
                selectedBuilding={selectedBuilding}
                buildingStats={buildingStats}
                route={campusRoute}
                onSelectBuilding={setSelectedBuilding}
                onSelectTechnician={(tech) => setSelectedTechnicianId(tech.technician_id)}
              />
              <DispatchPanel
                asset={{ specialty: "Nearest campus response" }}
                candidates={siteDispatchCandidates}
                targetLabel={`Nearest technicians to ${selectedBuilding.name}`}
                selectedTechnicianId={selectedSiteTechnician?.technician_id}
                onSelectTechnician={(tech) => setSelectedTechnicianId(tech.technician_id)}
              />
            </>
          )}

          {viewMode === "building" && selectedRuntimeAsset && (
            <>
              <section className="link-state">
                <Radar size={18} />
                <div>
                  <strong>{selectedRuntimeAsset.device_id}</strong>
                  <span>{selectedRuntimeAsset.mqtt_topic}</span>
                </div>
              </section>

              <TelemetryCard asset={selectedRuntimeAsset} />
              <MappingDetailPanel asset={selectedRuntimeAsset} />
              <AssetMap
                assets={activeAssets}
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

          {viewMode === "building" && <AlertPanel alerts={alerts} onSelect={(asset) => selectAsset(asset)} />}

          {viewMode === "building" && (
            <IncidentPanel
              incidents={visibleIncidents}
              selectedIncident={visibleIncidents.find((incident) => incident.incident_id === selectedIncident?.incident_id) || null}
              assets={assets}
              technicians={technicians}
              workOrders={visibleWorkOrders}
              onSelect={selectIncident}
              onAcknowledge={acknowledgeIncident}
              onAssign={assignIncident}
              onCreateWorkOrder={createWorkOrderForIncident}
              onStatus={updateIncidentStatus}
            />
          )}

          {viewMode === "building" && (
            <WorkOrderPanel
              workOrders={visibleWorkOrders}
              selectedWorkOrder={visibleWorkOrders.find((workOrder) => workOrder.work_order_id === selectedWorkOrder?.work_order_id) || null}
              incidents={incidents}
              assets={assets}
              technicians={technicians}
              onSelect={selectWorkOrder}
              onStatus={updateWorkOrderStatus}
            />
          )}

          {viewMode === "building" && (
            <dl className="property-grid">
              {propertyRows(selectedObject, selectedRuntimeAsset).map(([label, value]) => (
                <React.Fragment key={`${label}-${value}`}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}

          {viewMode === "building" && selectedObject?.ifcProperties && <JsonBlock title="IFC Properties" value={selectedObject.ifcProperties} />}
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
  dataQualitySummary,
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
              setFilters({ search: "", type: "", floor: "", zone: "", status: "", specialty: "", problemOnly: false, dataIssue: "" });
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
      <div className="quality-filter-row">
        <label>
          Data issue
          <select value={filters.dataIssue} onChange={(event) => update("dataIssue", event.target.value)}>
            <option value="">All quality states</option>
            <option value="any">Show only assets with data issues</option>
            <option value="Missing IFC Link">Show missing IFC mapping</option>
            <option value="Missing Device Link">Show missing telemetry mapping</option>
            <option value="Missing Position">Show missing position</option>
          </select>
        </label>
      </div>
      <div className="active-chip-row">
        {filters.problemOnly && <span className="active-chip">Showing abnormal assets</span>}
        {filters.dataIssue && <span className="active-chip">{filters.dataIssue === "any" ? "Showing data issues" : filters.dataIssue}</span>}
        <span className="active-chip muted">{dataQualitySummary.ready}/{dataQualitySummary.total} ready</span>
      </div>
    </section>
  );
}

function DataQualityPanel({ summary }) {
  const readiness = summary.total ? Math.round((summary.ready / summary.total) * 100) : 0;
  const rows = [
    ["Total assets", summary.total],
    ["Assets mapped to IFC GlobalId", summary.mappedToIfc],
    ["Assets missing source_global_id", summary.missingIfc],
    ["Assets with device_id", summary.withDeviceId],
    ["Assets with mqtt_topic", summary.withMqttTopic],
    ["Assets with position", summary.withPosition],
    ["Assets with building_id", summary.withBuildingId],
    ["Assets with telemetry template", summary.withTelemetryTemplate],
  ];
  return (
    <section className="ops-card data-quality-panel">
      <div className="card-title-row">
        <h3>Data Quality</h3>
        <span className={`quality-score ${readiness >= 80 ? "ready" : readiness >= 50 ? "warning" : "fault"}`}>{readiness}%</span>
      </div>
      <div className="quality-meter">
        <span style={{ width: `${readiness}%` }} />
      </div>
      <div className="quality-grid">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </React.Fragment>
        ))}
      </div>
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
  const qualityStatus = qualityStatusForAsset(asset);
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
      <span className={`quality-badge ${qualityStatus === "Ready" ? "ready" : "issue"}`}>{qualityStatus}</span>
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

function QualityCheckRow({ label, ok }) {
  return (
    <div className={`quality-check-row ${ok ? "ok" : "missing"}`}>
      <span>{label}</span>
      <strong>{ok ? "Yes" : "No"}</strong>
    </div>
  );
}

function MappingDetailPanel({ asset }) {
  const checks = qualityChecksForAsset(asset);
  const status = qualityStatusForAsset(asset);
  return (
    <section className="ops-card mapping-detail-panel">
      <div className="card-title-row">
        <h3>Mapping Detail</h3>
        <span className={`quality-badge ${status === "Ready" ? "ready" : "issue"}`}>{status}</span>
      </div>
      <QualityCheckRow label="source_global_id exists?" ok={checks.hasIfcLink} />
      <QualityCheckRow label="IFC object found?" ok={checks.ifcObjectFound} />
      <QualityCheckRow label="device_id exists?" ok={checks.hasDeviceId} />
      <QualityCheckRow label="telemetry exists?" ok={checks.hasTelemetry} />
      <QualityCheckRow label="position exists?" ok={checks.hasPosition} />
      <QualityCheckRow label="building_id exists?" ok={checks.hasBuildingId} />
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

function IncidentPanel({
  incidents,
  selectedIncident,
  assets,
  technicians,
  workOrders,
  onSelect,
  onAcknowledge,
  onAssign,
  onCreateWorkOrder,
  onStatus,
}) {
  const openIncidents = incidents.filter((incident) => !["Resolved", "Closed"].includes(incident.status));
  const detail = selectedIncident || openIncidents[0] || null;
  const asset = assets.find((item) => item.asset_id === detail?.asset_id);
  const candidates = scoreTechnicians(technicians, asset).slice(0, 3);
  const existingWorkOrder = workOrders.find((workOrder) => workOrder.incident_id === detail?.incident_id);
  const assignedTechnician =
    candidates.find((tech) => tech.technician_id === detail?.assigned_technician_id) ||
    candidates[0] ||
    technicians.find((tech) => tech.technician_id === detail?.assigned_technician_id);
  const estimate =
    existingWorkOrder?.repair_estimate_breakdown ||
    estimateRepairTime({ incident: detail, asset, technician: assignedTechnician });

  return (
    <section className="ops-card incident-panel">
      <div className="card-title-row">
        <h3>Incidents</h3>
        <span className="quality-badge issue">{openIncidents.length} open</span>
      </div>
      {!incidents.length && <p className="empty-state">No incidents created from active alerts.</p>}
      <div className="incident-list">
        {incidents.map((incident) => (
          <button
            className={`incident-row ${incident.incident_id === detail?.incident_id ? "active" : ""}`}
            key={incident.incident_id}
            onClick={() => onSelect(incident)}
            type="button"
          >
            <strong>{incident.severity}</strong>
            <span>{incident.title}</span>
            <em>{incident.status} / {new Date(incident.created_at).toLocaleTimeString()}</em>
          </button>
        ))}
      </div>
      {detail && (
        <div className="incident-detail">
          <strong>{detail.incident_id}</strong>
          <span>{asset?.asset_name || detail.asset_id}</span>
          <span>Building: {detail.building_id}</span>
          <span>Status: {detail.status}</span>
          {estimate && (
            <div className="estimate-card">
              <strong>Estimated repair time: {formatDuration(estimate.totalMinutes)}</strong>
              <span>
                Travel {formatDuration(estimate.travelMinutes)} / Diagnose {formatDuration(estimate.diagnosisMinutes)} / Fix{" "}
                {formatDuration(estimate.fixMinutes)}
              </span>
              <span>
                SLA {formatDuration(estimate.slaMinutes)} / Confidence {estimate.confidence}
              </span>
              {(estimate.skillPenalty > 0 || estimate.availabilityPenalty > 0) && (
                <span>
                  Penalty: skill {formatDuration(estimate.skillPenalty)} / availability{" "}
                  {formatDuration(estimate.availabilityPenalty)}
                </span>
              )}
            </div>
          )}
          <div className="incident-actions">
            <button type="button" onClick={() => onAcknowledge(detail)} disabled={detail.status !== "New"}>
              Acknowledge
            </button>
            <button
              type="button"
              onClick={() => candidates[0] && onAssign(detail, candidates[0].technician_id)}
              disabled={!candidates[0] || ["Assigned", "In Progress", "Resolved", "Closed"].includes(detail.status)}
            >
              Assign Technician
            </button>
            <button
              type="button"
              onClick={() => onCreateWorkOrder(detail, detail.assigned_technician_id || candidates[0]?.technician_id)}
              disabled={!candidates[0] || Boolean(existingWorkOrder)}
            >
              {existingWorkOrder ? existingWorkOrder.work_order_id : "Create Work Order"}
            </button>
            <button type="button" onClick={() => onStatus(detail.incident_id, "In Progress")} disabled={["Resolved", "Closed"].includes(detail.status)}>
              Mark In Progress
            </button>
            <button type="button" onClick={() => onStatus(detail.incident_id, "Resolved")} disabled={["Resolved", "Closed"].includes(detail.status)}>
              Resolve
            </button>
            <button type="button" onClick={() => onStatus(detail.incident_id, "Closed")} disabled={detail.status !== "Resolved"}>
              Close
            </button>
          </div>
          {!!candidates.length && (
            <p className="hint-text">
              Recommended: {assignedTechnician?.name || candidates[0].name} /{" "}
              {(assignedTechnician?.distance ?? candidates[0].distance).toFixed(1)} m /{" "}
              {assignedTechnician?.availability || candidates[0].availability}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function WorkOrderPanel({ workOrders, selectedWorkOrder, incidents, assets, technicians, onSelect, onStatus }) {
  const detail = selectedWorkOrder || workOrders[0] || null;
  const asset = assets.find((item) => item.asset_id === detail?.asset_id);
  const technician = technicians.find((item) => item.technician_id === detail?.technician_id);
  const incident = incidents.find((item) => item.incident_id === detail?.incident_id);

  return (
    <section className="ops-card work-order-panel">
      <div className="card-title-row">
        <h3>Work Orders</h3>
        <span className="quality-badge ready">{workOrders.length} total</span>
      </div>
      {!workOrders.length && <p className="empty-state">No work orders yet. Create one from an incident.</p>}
      <div className="work-order-list">
        {workOrders.map((workOrder) => (
          <button
            type="button"
            className={`work-order-row ${workOrder.work_order_id === detail?.work_order_id ? "active" : ""}`}
            key={workOrder.work_order_id}
            onClick={() => onSelect(workOrder)}
          >
            <strong>{workOrder.work_order_id}</strong>
            <span>
              {workOrder.priority} / {workOrder.status} / ETA {formatDuration(workOrder.estimated_repair_minutes || 120)}
            </span>
            <em>Target completion {new Date(workOrder.due_at).toLocaleTimeString()}</em>
          </button>
        ))}
      </div>
      {detail && (
        <div className="work-order-detail">
          <strong>{detail.task}</strong>
          <span>Incident: {incident?.incident_id || detail.incident_id}</span>
          <span>Asset: {asset?.asset_name || detail.asset_id}</span>
          <span>Technician: {technician?.name || detail.technician_id}</span>
          <span>Building/Floor: {detail.building_id} / {asset?.floor || "n/a"}</span>
          <div className="estimate-card">
            <strong>Estimated repair time: {formatDuration(detail.estimated_repair_minutes || 120)}</strong>
            <span>
              Travel {formatDuration(detail.estimated_travel_minutes || 10)} / Fix{" "}
              {formatDuration(detail.estimated_fix_minutes || 60)}
            </span>
            {detail.repair_estimate_breakdown && (
              <span>
                Diagnose {formatDuration(detail.repair_estimate_breakdown.diagnosisMinutes)} / SLA{" "}
                {formatDuration(detail.repair_estimate_breakdown.slaMinutes)} / Confidence{" "}
                {detail.repair_confidence || detail.repair_estimate_breakdown.confidence}
              </span>
            )}
          </div>
          <div className="incident-actions">
            {["Accepted", "On Site", "In Progress", "Resolved", "Cancelled"].map((status) => (
              <button type="button" key={status} onClick={() => onStatus(detail.work_order_id, status)}>
                {status}
              </button>
            ))}
          </div>
        </div>
      )}
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

function DispatchPanel({ asset, candidates, targetLabel, selectedTechnicianId = "", onSelectTechnician }) {
  return (
    <section className="ops-card">
      <h3>Technician Dispatch</h3>
      <p className="hint-text">{targetLabel || `Required specialty: ${asset.specialty}`}</p>
      <div className="tech-list">
        {candidates.map((tech, index) => (
          <div
            className={`tech-row ${tech.technician_id === selectedTechnicianId ? "active" : ""}`}
            key={tech.technician_id}
            onClick={() => onSelectTechnician?.(tech)}
            role={onSelectTechnician ? "button" : undefined}
            tabIndex={onSelectTechnician ? 0 : undefined}
            onKeyDown={(event) => {
              if (onSelectTechnician && (event.key === "Enter" || event.key === " ")) onSelectTechnician(tech);
            }}
          >
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

function buildingFootprint(building) {
  const size = building?.size || { width: 30, depth: 24 };
  const cx = building?.position?.x || 0;
  const cy = building?.position?.y || 0;
  const halfWidth = (size.width || 30) / 2;
  const halfDepth = (size.depth || 24) / 2;
  const rotation = THREE.MathUtils.degToRad(building?.rotation_deg || 0);
  return [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ].map((point) => ({
    x: cx + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
    y: cy + point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
  }));
}

function CampusSiteMap({
  siteLayout,
  technicians,
  selectedTechnician,
  selectedBuilding,
  buildingStats,
  route,
  onSelectBuilding,
  onSelectTechnician,
}) {
  const width = 360;
  const height = 280;
  const bounds = siteLayout?.bounds || { minX: -120, maxX: 240, minY: -110, maxY: 180 };
  const project = (point) => {
    const x = ((point.x - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * width;
    const y = height - ((point.y - bounds.minY) / (bounds.maxY - bounds.minY || 1)) * height;
    return { x, y };
  };
  const polygonPoints = (polygon = []) =>
    polygon
      .map((point) => {
        const projected = project(point);
        return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
      })
      .join(" ");
  const linePoints = (points = []) =>
    points
      .map((point) => {
        const projected = project(point);
        return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <section className="ops-card">
      <h3>2D Campus Map</h3>
      <svg className="asset-map campus-map-2d" viewBox={`0 0 ${width} ${height}`} role="img">
        <rect x="1" y="1" width={width - 2} height={height - 2} rx="10" />
        <g className="site-parcels">
          {(siteLayout?.land_parcels || []).map((parcel) => (
            <polygon key={parcel.parcel_id} points={polygonPoints(parcel.polygon)} />
          ))}
        </g>
        <g className="site-roads">
          {(siteLayout?.roads || []).map((road) => (
            <polyline key={road.road_id} points={linePoints(road.centerline)} style={{ strokeWidth: road.width_m || 8 }} />
          ))}
        </g>
        {route?.length > 1 && (
          <g className="site-route">
            <polyline points={linePoints(route)} />
          </g>
        )}
        <g className="site-buildings">
          {(siteLayout?.buildings || []).map((building) => {
            const center = project(building.position);
            const selected = building.building_id === selectedBuilding?.building_id;
            const stats = buildingStats.get(building.building_id) || {};
            const hasAlert = (stats.alertCount || 0) > 0;
            return (
              <g
                className={`site-building ${selected ? "selected" : ""} ${hasAlert ? "has-alert" : ""}`}
                key={building.building_id}
                onClick={() => onSelectBuilding(building)}
              >
                <polygon points={polygonPoints(buildingFootprint(building))} />
                <text x={center.x} y={center.y}>{building.name}</text>
                {hasAlert && (
                  <g className="site-alert-badge">
                    <circle cx={center.x + 16} cy={center.y - 16} r="9" />
                    <text x={center.x + 16} y={center.y - 12}>!</text>
                    <title>{stats.alertCount} active alerts</title>
                  </g>
                )}
                <title>{building.name}</title>
              </g>
            );
          })}
        </g>
        <g className="site-technicians">
          {technicians.map((tech) => {
            const sitePosition = technicianSitePosition(tech);
            if (!sitePosition) return null;
            const point = project(sitePosition);
            return (
              <g
                className={`tech-point ${tech.availability === "Available" ? "available" : "busy"} ${
                  tech.technician_id === selectedTechnician?.technician_id ? "selected" : ""
                }`}
                key={tech.technician_id}
                onClick={() => onSelectTechnician?.(tech)}
              >
                <circle cx={point.x} cy={point.y} r="6" />
                <text x={point.x + 8} y={point.y - 6}>{tech.name.split(" ").slice(-1)[0]}</text>
                <title>
                  {tech.name} / {tech.specialties.join(", ")} / {tech.availability}
                </title>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="hint-text">
        {selectedTechnician
          ? `Route from ${selectedTechnician.name} to ${selectedBuilding?.name || "selected building"}.`
          : "Technicians are positioned outside buildings; dispatch ranks them by distance to the selected building."}
      </p>
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
      <h3>2D Floor Plan & Route ({floorplan?.floor || "Level 9"})</h3>
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

function CampusBuildingPanel({ building, stats, onOpen }) {
  return (
    <section className="ops-card campus-detail-card">
      <h3>Building Detail</h3>
      <dl className="campus-detail-grid">
        <dt>Building ID</dt>
        <dd>{building.building_id}</dd>
        <dt>IFC file</dt>
        <dd>{building.ifc_file}</dd>
        <dt>Floors</dt>
        <dd>{building.floors || "n/a"}</dd>
        <dt>Assets</dt>
        <dd>{stats?.assetCount || 0}</dd>
        <dt>Alerts</dt>
        <dd>{stats?.alertCount || 0}</dd>
      </dl>
      <p className="hint-text">{building.description}</p>
      <button className="primary-action" type="button" onClick={onOpen}>
        Open IFC Detail
      </button>
    </section>
  );
}

function CampusView({
  siteLayout,
  buildingStats,
  technicians,
  selectedTechnician,
  selectedBuilding,
  route,
  onSelectBuilding,
  onSelectTechnician,
  onOpenBuilding,
}) {
  const containerRef = useRef(null);
  const selectedBuildingId = selectedBuilding?.building_id || "";
  const onSelectRef = useRef(onSelectBuilding);
  const onSelectTechnicianRef = useRef(onSelectTechnician);
  const onOpenRef = useRef(onOpenBuilding);
  const sceneRef = useRef(null);
  const selectedOutlineRef = useRef(null);
  const routeLineRef = useRef(null);
  const statsKey = useMemo(
    () =>
      JSON.stringify(
        (siteLayout?.buildings || []).map((building) => {
          const stats = buildingStats.get(building.building_id) || {};
          return [building.building_id, stats.status || "Normal", stats.assetCount || 0, stats.alertCount || 0];
        }),
      ),
    [buildingStats, siteLayout],
  );

  useEffect(() => {
    onSelectRef.current = onSelectBuilding;
    onSelectTechnicianRef.current = onSelectTechnician;
    onOpenRef.current = onOpenBuilding;
  }, [onOpenBuilding, onSelectBuilding, onSelectTechnician]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (selectedOutlineRef.current) {
      scene.remove(selectedOutlineRef.current);
      selectedOutlineRef.current.geometry?.dispose?.();
      selectedOutlineRef.current.material?.dispose?.();
      selectedOutlineRef.current = null;
    }
    if (!selectedBuilding) return;
    const footprint = buildingFootprint(selectedBuilding);
    const points = footprint
      .concat(footprint[0])
      .map((point) => new THREE.Vector3(point.x, 0.32, point.y));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const outline = new THREE.Line(geometry, material);
    outline.renderOrder = 20;
    scene.add(outline);
    selectedOutlineRef.current = outline;
  }, [selectedBuilding]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (routeLineRef.current) {
      scene.remove(routeLineRef.current);
      routeLineRef.current.geometry?.dispose?.();
      routeLineRef.current.material?.dispose?.();
      routeLineRef.current = null;
    }
    if (!route || route.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(route.map((point) => new THREE.Vector3(point.x, 1.8, point.y)));
    const geometry = new THREE.TubeGeometry(curve, Math.max(route.length * 8, 24), 0.85, 10, false);
    const material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0e7490,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
    });
    const line = new THREE.Mesh(geometry, material);
    line.name = "Campus technician route";
    line.renderOrder = 45;
    scene.add(line);
    routeLineRef.current = line;
  }, [route]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !siteLayout) return undefined;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0f172a);
    scene.fog = new THREE.Fog(0x0f172a, 220, 520);

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    camera.position.set(105, 180, 220);
    camera.lookAt(40, 0, 25);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(45, 25, 10);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 80;
    controls.maxDistance = 480;

    scene.add(new THREE.HemisphereLight(0xdbeafe, 0x172033, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(90, 180, 80);
    sun.castShadow = true;
    scene.add(sun);

    const bounds = siteLayout.bounds || { minX: -120, maxX: 240, minY: -110, maxY: 180 };
    const siteWidth = bounds.maxX - bounds.minX;
    const siteDepth = bounds.maxY - bounds.minY;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(siteWidth + 80, siteDepth + 80),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.92, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((bounds.minX + bounds.maxX) / 2, -0.05, (bounds.minY + bounds.maxY) / 2);
    ground.receiveShadow = true;
    scene.add(ground);

    const parcelMaterial = new THREE.MeshStandardMaterial({
      color: 0x164e63,
      transparent: true,
      opacity: 0.58,
      roughness: 0.85,
    });
    (siteLayout.land_parcels || []).forEach((parcel) => {
      const shape = new THREE.Shape(parcel.polygon.map((point) => new THREE.Vector2(point.x, point.y)));
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), parcelMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.02;
      scene.add(mesh);
    });

    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.78 });
    (siteLayout.roads || []).forEach((road) => {
      for (let index = 0; index < (road.centerline || []).length - 1; index++) {
        const start = road.centerline[index];
        const end = road.centerline[index + 1];
        const dx = end.x - start.x;
        const dz = end.y - start.y;
        const length = Math.hypot(dx, dz);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, road.width_m || 8), roadMaterial);
        mesh.position.set((start.x + end.x) / 2, 0.08, (start.y + end.y) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx);
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
    });

    const buildingMeshes = [];
    const technicianMeshes = [];
    const loader = new GLTFLoader();
    let disposed = false;

    function makeTextSprite(text, color = "#e2e8f0") {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = 256;
      canvas.height = 64;
      context.font = "700 24px Arial";
      context.fillStyle = "rgba(15, 23, 42, 0.68)";
      context.strokeStyle = "rgba(103, 232, 249, 0.5)";
      context.lineWidth = 2;
      if (context.roundRect) {
        context.beginPath();
        context.roundRect(4, 8, 248, 44, 12);
      } else {
        context.beginPath();
        context.rect(4, 8, 248, 44);
      }
      context.fill();
      context.stroke();
      context.fillStyle = color;
      context.fillText(text, 18, 38);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(28, 7, 1);
      sprite.renderOrder = 30;
      return sprite;
    }

    function makeAlertSprite(stats) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = 128;
      canvas.height = 128;
      const severe = stats.status === "Fault" || stats.status === "Offline";
      context.beginPath();
      context.arc(64, 64, 46, 0, Math.PI * 2);
      context.fillStyle = severe ? "rgba(220, 38, 38, 0.96)" : "rgba(245, 158, 11, 0.96)";
      context.fill();
      context.lineWidth = 8;
      context.strokeStyle = "rgba(255, 255, 255, 0.92)";
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = "900 68px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("!", 64, 68);
      if (stats.alertCount > 1) {
        context.beginPath();
        context.arc(96, 32, 22, 0, Math.PI * 2);
        context.fillStyle = "rgba(15, 23, 42, 0.92)";
        context.fill();
        context.fillStyle = "#ffffff";
        context.font = "800 24px Arial";
        context.fillText(String(stats.alertCount), 96, 33);
      }
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(12, 12, 1);
      sprite.renderOrder = 35;
      return sprite;
    }

    function addBuildingAlertMarker(building, size) {
      const stats = buildingStats.get(building.building_id) || {};
      if (!(stats.alertCount > 0)) return;
      const marker = makeAlertSprite(stats);
      marker.name = `${building.building_id}_alert_marker`;
      marker.position.set(building.position.x, (size.height || 30) + 10, building.position.y);
      marker.userData.building = building;
      scene.add(marker);
    }

    function addTechnicianMarker(tech) {
      const sitePosition = technicianSitePosition(tech);
      if (!sitePosition) return;
      const available = tech.availability === "Available";
      const group = new THREE.Group();
      group.name = `${tech.technician_id}_site_marker`;
      group.position.set(sitePosition.x, 0.35, sitePosition.y);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 20, 12),
        new THREE.MeshStandardMaterial({
          color: available ? 0x22c55e : 0xf97316,
          emissive: available ? 0x064e3b : 0x7c2d12,
          emissiveIntensity: 0.45,
          roughness: 0.42,
        }),
      );
      marker.castShadow = true;
      marker.userData.technician = tech;
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 4.8, 12),
        new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5 }),
      );
      stem.position.y = 2.2;
      marker.position.y = 5;
      const label = makeTextSprite(tech.name.split(" ").slice(-1)[0], available ? "#bbf7d0" : "#fed7aa");
      label.position.set(9, 8, 0);
      group.add(stem, marker, label);
      scene.add(group);
      technicianMeshes.push(marker);
    }

    function addCampusRoute(points) {
      if (!points || points.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(point.x, 1.8, point.y)));
      const geometry = new THREE.TubeGeometry(curve, Math.max(points.length * 8, 24), 0.85, 10, false);
      const material = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0e7490,
        emissiveIntensity: 0.85,
        transparent: true,
        opacity: 0.92,
        depthTest: false,
      });
      const line = new THREE.Mesh(geometry, material);
      line.name = "Campus technician route";
      line.renderOrder = 45;
      scene.add(line);
      routeLineRef.current = line;
    }

    function buildingStatusColor(building) {
      const stats = buildingStats.get(building.building_id) || {};
      return new THREE.Color(STATUS_COLORS[stats.status] || building.color || "#38bdf8");
    }

    function makeBuildingPlaceholder(building, size) {
      const material = new THREE.MeshStandardMaterial({
        color: buildingStatusColor(building),
        roughness: 0.45,
        metalness: 0.06,
        transparent: true,
        opacity: 0.1,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.width, size.height, size.depth), material);
      mesh.position.set(building.position.x, size.height / 2, building.position.y);
      mesh.rotation.y = THREE.MathUtils.degToRad(-(building.rotation_deg || 0));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.building = building;
      mesh.userData.isPlaceholder = true;
      scene.add(mesh);
      buildingMeshes.push(mesh);
      return mesh;
    }

    function fitPreviewToBuilding(preview, building, size) {
      const box = new THREE.Box3().setFromObject(preview);
      const modelSize = box.getSize(new THREE.Vector3());
      const modelCenter = box.getCenter(new THREE.Vector3());
      const scale = Math.min(
        size.width / Math.max(modelSize.x, 0.001),
        size.depth / Math.max(modelSize.z, 0.001),
        size.height / Math.max(modelSize.y, 0.001),
      );
      preview.position.sub(modelCenter);
      preview.scale.setScalar(scale);
      preview.rotation.y = THREE.MathUtils.degToRad(-(building.rotation_deg || 0));
      preview.position.add(new THREE.Vector3(building.position.x, 0, building.position.y));
      preview.updateMatrixWorld(true);

      const fittedBox = new THREE.Box3().setFromObject(preview);
      preview.position.y -= fittedBox.min.y;
      preview.updateMatrixWorld(true);
    }

    function tintPreviewForStatus(preview, building) {
      const color = buildingStatusColor(building);
      preview.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.building = building;
        const originalWasArray = Array.isArray(object.material);
        const materials = originalWasArray ? object.material : [object.material];
        object.material = materials.map((material) => {
          if (!material?.clone) return material;
          const clone = material.clone();
          clone.transparent = true;
          clone.opacity = Math.min(clone.opacity || 1, 0.86);
          clone.color.lerp(color, 0.12);
          return clone;
        });
        if (!originalWasArray) object.material = object.material[0];
      });
    }

    (siteLayout.buildings || []).forEach((building) => {
      const size = building.size || { width: 30, depth: 24, height: 30 };
      addBuildingAlertMarker(building, size);

      if (building.preview_glb) {
        loader.load(
          building.preview_glb,
          (gltf) => {
            if (disposed) return;
            const preview = gltf.scene;
            preview.name = `${building.building_id}_preview`;
            tintPreviewForStatus(preview, building);
            fitPreviewToBuilding(preview, building, size);
            scene.add(preview);
            preview.traverse((object) => {
              if (object.isMesh) buildingMeshes.push(object);
            });
          },
          undefined,
          (error) => {
            console.warn(`Failed to load preview GLB for ${building.building_id}`, error);
            if (!disposed) makeBuildingPlaceholder(building, size);
          },
        );
      } else {
        makeBuildingPlaceholder(building, size);
      }
    });

    (technicians || []).forEach(addTechnicianMarker);
    addCampusRoute(route);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = null;

    function pick(event, open = false) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const technicianHit = raycaster.intersectObjects(technicianMeshes, false)[0];
      if (technicianHit?.object?.userData?.technician) {
        onSelectTechnicianRef.current?.(technicianHit.object.userData.technician);
        return;
      }
      const hit = raycaster.intersectObjects(buildingMeshes, false)[0];
      if (!hit?.object?.userData?.building) return;
      onSelectRef.current(hit.object.userData.building);
      if (open) onOpenRef.current(hit.object.userData.building);
    }

    function onPointerDown(event) {
      pointerDown = { x: event.clientX, y: event.clientY };
    }

    function onClick(event) {
      if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > PICK_DRAG_THRESHOLD_PX) return;
      pick(event, false);
    }

    function onDoubleClick(event) {
      pick(event, true);
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("dblclick", onDoubleClick);

    function animate() {
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }
    animate();

    function resize() {
      const nextWidth = container.clientWidth || width;
      const nextHeight = container.clientHeight || height;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    }
    window.addEventListener("resize", resize);

    return () => {
      disposed = true;
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("dblclick", onDoubleClick);
      controls.dispose();
      scene.traverse((object) => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => {
            material.map?.dispose?.();
            material.dispose?.();
          });
        } else {
          object.material?.map?.dispose?.();
          object.material?.dispose?.();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      if (sceneRef.current === scene) sceneRef.current = null;
      selectedOutlineRef.current = null;
      routeLineRef.current = null;
    };
  }, [siteLayout, statsKey, technicians]);

  return (
    <div className="campus-view">
      <div ref={containerRef} className="campus-canvas" />
      <div className="campus-overlay">
        <span className="eyebrow">Campus View</span>
        <h2>{siteLayout?.name || "Demo Campus"}</h2>
        <p>
          {siteLayout?.buildings?.length || 0} IFC buildings / {siteLayout?.roads?.length || 0} roads / click a building preview to inspect.
        </p>
      </div>
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
