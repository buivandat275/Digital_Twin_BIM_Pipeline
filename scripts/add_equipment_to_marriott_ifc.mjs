import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const sourcePath = path.join(rootDir, "output", "20260609_173819_MARRIOTT_DSC_ARC_R24_aps.ifc");
const outputPath = path.join(
  rootDir,
  "output",
  "20260609_173819_MARRIOTT_DSC_ARC_R24_with_equipment.ifc",
);

const OWNER_HISTORY = 18;
const BODY_CONTEXT = 24;
const LEVEL_9_PLACEMENT = 80;
const LEVEL_9 = 81;
const BUILDING = 34;

const source = fs.readFileSync(sourcePath, "utf8");
const sourceIds = [...source.matchAll(/^#(\d+)=/gm)].map((match) => Number(match[1]));
let nextId = Math.max(...sourceIds) + 1;
const entities = [];

function add(expression) {
  const id = nextId++;
  entities.push(`#${id}=${expression};`);
  return id;
}

function ref(id) {
  return `#${id}`;
}

function text(value) {
  if (value === null || value === undefined || value === "") return "$";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function num(value) {
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(rounded).toFixed(3);
}

function guid(code) {
  return `0MQTT${code}`.padEnd(22, "0").slice(0, 22);
}

function point3d([x, y, z]) {
  return `(${num(x)},${num(y)},${num(z)})`;
}

function placement(x, y, z) {
  const point = add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const axis = add(`IFCAXIS2PLACEMENT3D(${ref(point)},$,$)`);
  return add(`IFCLOCALPLACEMENT(${ref(LEVEL_9_PLACEMENT)},${ref(axis)})`);
}

function transformPoint(point, transform = {}) {
  const [x, y, z] = point;
  const angle = transform.rotateZ || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    x * cos - y * sin + (transform.x || 0),
    x * sin + y * cos + (transform.y || 0),
    z + (transform.z || 0),
  ];
}

function box(width, depth, height, transform = {}) {
  const x = width / 2;
  const y = depth / 2;
  const vertices = [
    [-x, -y, 0],
    [x, -y, 0],
    [x, y, 0],
    [-x, y, 0],
    [-x, -y, height],
    [x, -y, height],
    [x, y, height],
    [-x, y, height],
  ].map((point) => transformPoint(point, transform));
  const faces = [
    [1, 4, 3, 2],
    [5, 6, 7, 8],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 4, 8, 7],
    [4, 1, 5, 8],
  ];
  return { vertices, faces };
}

function cylinder(radius, length, axis = "z", transform = {}, segments = 24) {
  const vertices = [];
  const faces = [];
  const convert = ([u, v, w]) => {
    if (axis === "x") return [w, u, v];
    if (axis === "y") return [u, w, v];
    return [u, v, w];
  };

  for (let layer = 0; layer < 2; layer++) {
    for (let index = 0; index < segments; index++) {
      const angle = (index / segments) * Math.PI * 2;
      const local = convert([radius * Math.cos(angle), radius * Math.sin(angle), layer * length]);
      vertices.push(transformPoint(local, transform));
    }
  }

  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    faces.push([index + 1, next + 1, segments + next + 1, segments + index + 1]);
  }
  faces.push(Array.from({ length: segments }, (_, index) => segments - index));
  faces.push(Array.from({ length: segments }, (_, index) => segments + index + 1));
  return { vertices, faces };
}

function frustum(radiusBottom, radiusTop, height, transform = {}, segments = 24) {
  const vertices = [];
  const faces = [];
  for (let layer = 0; layer < 2; layer++) {
    const radius = layer === 0 ? radiusBottom : radiusTop;
    for (let index = 0; index < segments; index++) {
      const angle = (index / segments) * Math.PI * 2;
      vertices.push(
        transformPoint(
          [radius * Math.cos(angle), radius * Math.sin(angle), layer * height],
          transform,
        ),
      );
    }
  }
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    faces.push([index + 1, next + 1, segments + next + 1, segments + index + 1]);
  }
  faces.push(Array.from({ length: segments }, (_, index) => segments - index));
  faces.push(Array.from({ length: segments }, (_, index) => segments + index + 1));
  return { vertices, faces };
}

function hemisphere(radius, transform = {}, rings = 6, segments = 24) {
  const vertices = [];
  const faces = [];

  for (let ring = 0; ring <= rings; ring++) {
    const phi = (ring / rings) * (Math.PI / 2);
    const ringRadius = radius * Math.cos(phi);
    const z = -radius * Math.sin(phi);
    for (let index = 0; index < segments; index++) {
      const angle = (index / segments) * Math.PI * 2;
      vertices.push(
        transformPoint(
          [ringRadius * Math.cos(angle), ringRadius * Math.sin(angle), z],
          transform,
        ),
      );
    }
  }

  for (let ring = 0; ring < rings; ring++) {
    for (let index = 0; index < segments; index++) {
      const next = (index + 1) % segments;
      const a = ring * segments + index + 1;
      const b = ring * segments + next + 1;
      const c = (ring + 1) * segments + next + 1;
      const d = (ring + 1) * segments + index + 1;
      faces.push([a, b, c, d]);
    }
  }
  faces.push(Array.from({ length: segments }, (_, index) => segments - index));
  return { vertices, faces };
}

const styleCache = new Map();

function style(name, red, green, blue, transparency = 0) {
  const key = `${name}:${red}:${green}:${blue}:${transparency}`;
  if (styleCache.has(key)) return styleCache.get(key);
  const color = add(`IFCCOLOURRGB(${text(name)},${num(red)},${num(green)},${num(blue)})`);
  const rendering = add(
    `IFCSURFACESTYLERENDERING(${ref(color)},${num(
      transparency,
    )},$,$,$,$,IFCNORMALISEDRATIOMEASURE(0.35),IFCSPECULAREXPONENT(32.),.NOTDEFINED.)`,
  );
  const surfaceStyle = add(`IFCSURFACESTYLE(${text(name)},.BOTH.,(${ref(rendering)}))`);
  styleCache.set(key, surfaceStyle);
  return surfaceStyle;
}

const STYLES = {
  dark: () => style("Equipment dark", 0.12, 0.14, 0.18),
  metal: () => style("Equipment metal", 0.45, 0.49, 0.54),
  white: () => style("Equipment white", 0.88, 0.9, 0.92),
  light: () => style("Light diffuser", 1.0, 0.86, 0.35, 0.08),
  glass: () => style("Camera dome glass", 0.08, 0.2, 0.32, 0.35),
  red: () => style("Alarm red", 0.78, 0.08, 0.08),
  blue: () => style("Pump blue", 0.08, 0.28, 0.72),
};

function polygonalFaceSet(mesh, styleId) {
  const pointList = add(
    `IFCCARTESIANPOINTLIST3D((${mesh.vertices.map(point3d).join(",")}))`,
  );
  const faceIds = mesh.faces.map((face) =>
    add(`IFCINDEXEDPOLYGONALFACE((${face.join(",")}))`),
  );
  const faceSet = add(
    `IFCPOLYGONALFACESET(${ref(pointList)},$,(${faceIds.map(ref).join(",")}),$)`,
  );
  add(`IFCSTYLEDITEM(${ref(faceSet)},(${ref(styleId)}),$)`);
  return faceSet;
}

function shapeRepresentation(parts) {
  const itemIds = parts.map(({ mesh, styleId }) => polygonalFaceSet(mesh, styleId));
  const representation = add(
    `IFCSHAPEREPRESENTATION(${ref(BODY_CONTEXT)},'Body','Tessellation',(${itemIds
      .map(ref)
      .join(",")}))`,
  );
  return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(representation)}))`);
}

function propertyValue(name, value, type = "IFCLABEL") {
  if (type === "IFCBOOLEAN") {
    return add(`IFCPROPERTYSINGLEVALUE(${text(name)},$,IFCBOOLEAN(${value ? ".T." : ".F."}),$)`);
  }
  if (type === "IFCREAL") {
    return add(`IFCPROPERTYSINGLEVALUE(${text(name)},$,IFCREAL(${num(value)}),$)`);
  }
  return add(`IFCPROPERTYSINGLEVALUE(${text(name)},$,${type}(${text(value)}),$)`);
}

function attachProperties(spec, element) {
  const properties = [
    propertyValue("Asset Code", spec.assetCode),
    propertyValue("Functional Location", "MARRIOTT/LEVEL-09/DEMO-ZONE"),
    propertyValue("Asset Tag No.", spec.assetCode),
    propertyValue("Manufacturer", spec.manufacturer),
    propertyValue("Model No.", spec.model),
    propertyValue("Device ID", spec.deviceId),
    propertyValue("Gateway ID", "MQTT-MARRIOTT-DEMO-01"),
    propertyValue("Protocol", "MQTT 5.0"),
    propertyValue("MQTT Topic", spec.mqttTopic),
    propertyValue("Polling Interval Sec", 5, "IFCREAL"),
    propertyValue("Realtime Enabled", true, "IFCBOOLEAN"),
    propertyValue("History Enabled", true, "IFCBOOLEAN"),
    propertyValue("Maintainable", true, "IFCBOOLEAN"),
    propertyValue("Point Template", spec.pointTemplate),
    propertyValue("Status", spec.status),
    propertyValue("Position X", spec.x, "IFCREAL"),
    propertyValue("Position Y", spec.y, "IFCREAL"),
    propertyValue("Position Z", spec.z, "IFCREAL"),
  ];
  const propertySet = add(
    `IFCPROPERTYSET('${guid(`ps${spec.code}`)}',${ref(
      OWNER_HISTORY,
    )},'DT.Common',$,(${properties.map(ref).join(",")}))`,
  );
  add(
    `IFCRELDEFINESBYPROPERTIES('${guid(`rp${spec.code}`)}',${ref(
      OWNER_HISTORY,
    )},$,$,(${ref(element)}),${ref(propertySet)})`,
  );
}

function createDevice(spec) {
  const objectPlacement = placement(spec.x, spec.y, spec.z);
  const shape = shapeRepresentation(spec.parts());
  const element = add(
    `${spec.ifcClass}('${guid(spec.code)}',${ref(OWNER_HISTORY)},${text(
      spec.name,
    )},${text(spec.description)},${text(spec.objectType)},${ref(objectPlacement)},${ref(
      shape,
    )},${text(spec.assetCode)},.${spec.predefinedType}.)`,
  );
  attachProperties(spec, element);
  return { ...spec, element };
}

const devices = [
  createDevice({
    code: "camdome01",
    ifcClass: "IFCAUDIOVISUALAPPLIANCE",
    name: "Level 9 Dome Camera 01",
    description: "Ceiling-mounted MQTT demo camera with modeled dome housing",
    objectType: "CCTV Dome Camera",
    predefinedType: "CAMERA",
    assetCode: "CAM-L09-001",
    deviceId: "camera-l09-001",
    mqttTopic: "marriott/level-09/camera/CAM-L09-001/status",
    pointTemplate: "camera_online_recording_temperature",
    manufacturer: "DemoVision",
    model: "DV-DOME-4K",
    status: "Online",
    system: "cctv",
    x: 5200,
    y: 3600,
    z: 3100,
    parts: () => [
      { mesh: cylinder(190, 55, "z", { z: -55 }), styleId: STYLES.dark() },
      { mesh: frustum(170, 145, 45, { z: -100 }), styleId: STYLES.metal() },
      { mesh: hemisphere(145, { z: -100 }), styleId: STYLES.glass() },
      { mesh: cylinder(42, 65, "y", { y: -25, z: -165 }), styleId: STYLES.dark() },
    ],
  }),
  createDevice({
    code: "light01",
    ifcClass: "IFCLIGHTFIXTURE",
    name: "Level 9 Circular Light 01",
    description: "Circular ceiling light with rim and diffuser",
    objectType: "Circular LED Ceiling Light",
    predefinedType: "POINTSOURCE",
    assetCode: "LGT-L09-001",
    deviceId: "light-l09-001",
    mqttTopic: "marriott/level-09/light/LGT-L09-001/status",
    pointTemplate: "light_status_dimming_power",
    manufacturer: "DemoLight",
    model: "DL-CIRCLE-500",
    status: "Fault",
    system: "lighting",
    x: 8500,
    y: 3600,
    z: 3100,
    parts: () => [
      { mesh: cylinder(280, 55, "z", { z: -55 }), styleId: STYLES.dark() },
      { mesh: cylinder(235, 62, "z", { z: -64 }), styleId: STYLES.light() },
      { mesh: cylinder(65, 18, "z", { z: -82 }), styleId: STYLES.white() },
    ],
  }),
  createDevice({
    code: "smoke01",
    ifcClass: "IFCSENSOR",
    name: "Level 9 Smoke Detector 01",
    description: "Ceiling smoke detector with modeled vent slots",
    objectType: "Smoke Detector",
    predefinedType: "SMOKESENSOR",
    assetCode: "SNS-SMOKE-L09-001",
    deviceId: "smoke-l09-001",
    mqttTopic: "marriott/level-09/sensor/SNS-SMOKE-L09-001/status",
    pointTemplate: "smoke_alarm_status_battery",
    manufacturer: "DemoSafe",
    model: "DS-SMOKE-01",
    status: "Warning",
    system: "fire",
    x: 11500,
    y: 3600,
    z: 3100,
    parts: () => {
      const parts = [
        { mesh: cylinder(150, 40, "z", { z: -40 }), styleId: STYLES.white() },
        { mesh: frustum(135, 105, 45, { z: -85 }), styleId: STYLES.white() },
        { mesh: cylinder(18, 12, "z", { x: 0, y: -75, z: -97 }), styleId: STYLES.red() },
      ];
      for (let index = 0; index < 8; index++) {
        parts.push({
          mesh: box(65, 18, 18, {
            x: 105 * Math.cos((index / 8) * Math.PI * 2),
            y: 105 * Math.sin((index / 8) * Math.PI * 2),
            z: -82,
            rotateZ: (index / 8) * Math.PI * 2,
          }),
          styleId: STYLES.dark(),
        });
      }
      return parts;
    },
  }),
  createDevice({
    code: "fan01",
    ifcClass: "IFCFAN",
    name: "Level 9 Ceiling Fan 01",
    description: "Four-blade ceiling fan with downrod and motor housing",
    objectType: "Ceiling Fan",
    predefinedType: "PROPELLORAXIAL",
    assetCode: "FAN-L09-001",
    deviceId: "fan-l09-001",
    mqttTopic: "marriott/level-09/hvac/FAN-L09-001/telemetry",
    pointTemplate: "fan_run_status_speed_vibration",
    manufacturer: "DemoAir",
    model: "DA-CEILING-1400",
    status: "Offline",
    system: "hvac",
    x: 14500,
    y: 3600,
    z: 3100,
    parts: () => {
      const parts = [
        { mesh: cylinder(45, 380, "z", { z: -380 }), styleId: STYLES.metal() },
        { mesh: cylinder(170, 160, "z", { z: -530 }), styleId: STYLES.dark() },
        { mesh: cylinder(85, 55, "z", { z: -585 }), styleId: STYLES.metal() },
      ];
      for (let index = 0; index < 4; index++) {
        const angle = (index / 4) * Math.PI * 2;
        parts.push({
          mesh: box(720, 150, 28, {
            x: 430 * Math.cos(angle),
            y: 430 * Math.sin(angle),
            z: -548,
            rotateZ: angle,
          }),
          styleId: STYLES.metal(),
        });
      }
      return parts;
    },
  }),
  createDevice({
    code: "pump01",
    ifcClass: "IFCPUMP",
    name: "Level 9 Circulation Pump 01",
    description: "Modeled pump assembly with base, motor, casing and pipe connections",
    objectType: "Horizontal Circulation Pump",
    predefinedType: "CIRCULATOR",
    assetCode: "PMP-L09-001",
    deviceId: "pump-l09-001",
    mqttTopic: "marriott/level-09/hydronic/PMP-L09-001/telemetry",
    pointTemplate: "pump_run_status_flow_pressure_vibration",
    manufacturer: "DemoFlow",
    model: "DF-ENDSUCTION-250",
    status: "Online",
    system: "hydronic",
    x: 18500,
    y: 4200,
    z: 0,
    parts: () => [
      { mesh: box(1500, 700, 120), styleId: STYLES.dark() },
      { mesh: cylinder(260, 750, "x", { x: -450, z: 450 }), styleId: STYLES.metal() },
      { mesh: cylinder(340, 260, "x", { x: 300, z: 450 }), styleId: STYLES.blue() },
      { mesh: cylinder(150, 420, "y", { x: 430, y: -210, z: 450 }), styleId: STYLES.blue() },
      { mesh: cylinder(135, 420, "z", { x: 430, z: 620 }), styleId: STYLES.blue() },
      { mesh: box(520, 380, 170, { x: -300, z: 120 }), styleId: STYLES.metal() },
    ],
  }),
];

add(
  `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid("containl09")}',${ref(
    OWNER_HISTORY,
  )},'Digital Twin demo equipment on Level 9',$,(${devices
    .map((device) => ref(device.element))
    .join(",")}),${ref(LEVEL_9)})`,
);

function createSystem(code, name, predefinedType, deviceSystem) {
  const system = add(
    `IFCDISTRIBUTIONSYSTEM('${guid(code)}',${ref(OWNER_HISTORY)},${text(
      name,
    )},'Digital Twin demo system',$,$,.${predefinedType}.)`,
  );
  const members = devices
    .filter((device) => device.system === deviceSystem)
    .map((device) => device.element);
  add(
    `IFCRELASSIGNSTOGROUP('${guid(`assign${code}`)}',${ref(
      OWNER_HISTORY,
    )},$,$,(${members.map(ref).join(",")}),$,${ref(system)})`,
  );
  add(
    `IFCRELSERVICESBUILDINGS('${guid(`service${code}`)}',${ref(
      OWNER_HISTORY,
    )},$,$,${ref(system)},(${ref(BUILDING)}))`,
  );
}

createSystem("syscctv", "Demo CCTV System", "COMMUNICATION", "cctv");
createSystem("syslight", "Demo Lighting System", "ELECTRICAL", "lighting");
createSystem("sysfire", "Demo Fire Detection System", "FIREPROTECTION", "fire");
createSystem("syshvac", "Demo HVAC System", "VENTILATION", "hvac");
createSystem("syshyd", "Demo Hydronic System", "HEATING", "hydronic");

const dataEnd = source.lastIndexOf("ENDSEC;");
if (dataEnd < 0) throw new Error("Could not find IFC DATA section terminator.");

const updatedHeader = source.slice(0, dataEnd).replace(
  /FILE_NAME\('[^']*'/,
  `FILE_NAME('${path.basename(outputPath)}'`,
);
const output = `${updatedHeader}${entities.join("\n")}\nENDSEC;\n\nEND-ISO-10303-21;\n`;

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Created ${outputPath}`);
console.log(`Added ${devices.length} devices and ${entities.length} IFC entities`);
