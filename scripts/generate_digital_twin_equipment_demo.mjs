import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(scriptDir, "..", "sample-data", "digital-twin-equipment-demo.ifc");

const entities = [];

function add(expression) {
  entities.push(`#${entities.length + 1}=${expression};`);
  return entities.length;
}

function ref(id) {
  return `#${id}`;
}

function text(value) {
  if (value === null || value === undefined || value === "") return "$";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function real(value) {
  return Number(value).toFixed(3);
}

function guid(code) {
  return `0DTDemo${code}`.padEnd(22, "0").slice(0, 22);
}

const person = add("IFCPERSON($,$,'Codex',$,$,$,$,$)");
const organization = add("IFCORGANIZATION($,'BIM Pipeline Digital Twin Demo',$,$,$)");
const personOrganization = add(`IFCPERSONANDORGANIZATION(${ref(person)},${ref(organization)},$)`);
const application = add(
  `IFCAPPLICATION(${ref(organization)},'1.0','BIM Pipeline Digital Twin Demo','BIMPIPE')`,
);
const ownerHistory = add(
  `IFCOWNERHISTORY(${ref(personOrganization)},${ref(application)},$,.ADDED.,$,$,$,1781478000)`,
);

const lengthUnit = add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)");
const areaUnit = add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)");
const volumeUnit = add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)");
const timeUnit = add("IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.)");
const units = add(
  `IFCUNITASSIGNMENT((${ref(lengthUnit)},${ref(areaUnit)},${ref(volumeUnit)},${ref(timeUnit)}))`,
);

const origin3d = add("IFCCARTESIANPOINT((0.,0.,0.))");
const worldAxis = add(`IFCAXIS2PLACEMENT3D(${ref(origin3d)},$,$)`);
const modelContext = add(
  `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ref(worldAxis)},$)`,
);
const zDirection = add("IFCDIRECTION((0.,0.,1.))");

const project = add(
  `IFCPROJECT('${guid("project01")}',${ref(ownerHistory)},'Digital Twin Equipment Demo',$,$,$,$,(${ref(modelContext)}),${ref(units)})`,
);

function placement(parentPlacement, x, y, z) {
  const point = add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
  const axis = add(`IFCAXIS2PLACEMENT3D(${ref(point)},$,$)`);
  return add(`IFCLOCALPLACEMENT(${parentPlacement ? ref(parentPlacement) : "$"},${ref(axis)})`);
}

function boxShape(width, depth, height) {
  const profilePoint = add("IFCCARTESIANPOINT((0.,0.))");
  const profileAxis = add(`IFCAXIS2PLACEMENT2D(${ref(profilePoint)},$)`);
  const profile = add(
    `IFCRECTANGLEPROFILEDEF(.AREA.,$,${ref(profileAxis)},${real(width)},${real(depth)})`,
  );
  const solid = add(
    `IFCEXTRUDEDAREASOLID(${ref(profile)},${ref(worldAxis)},${ref(zDirection)},${real(height)})`,
  );
  const representation = add(
    `IFCSHAPEREPRESENTATION(${ref(modelContext)},'Body','SweptSolid',(${ref(solid)}))`,
  );
  return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${ref(representation)}))`);
}

function relationAggregate(code, parent, children) {
  return add(
    `IFCRELAGGREGATES('${guid(code)}',${ref(ownerHistory)},$,$,${ref(parent)},(${children
      .map(ref)
      .join(",")}))`,
  );
}

function relationContains(code, container, products) {
  return add(
    `IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(code)}',${ref(ownerHistory)},$,$,(${products
      .map(ref)
      .join(",")}),${ref(container)})`,
  );
}

const sitePlacement = placement(null, 0, 0, 0);
const site = add(
  `IFCSITE('${guid("site01")}',${ref(ownerHistory)},'Demo Site',$,$,${ref(sitePlacement)},$,$,.ELEMENT.,$,$,$,$,$)`,
);
const buildingPlacement = placement(sitePlacement, 0, 0, 0);
const building = add(
  `IFCBUILDING('${guid("building01")}',${ref(ownerHistory)},'Digital Twin Demo Building',$,$,${ref(buildingPlacement)},$,$,.ELEMENT.,0.,0.,$)`,
);
const storeyPlacement = placement(buildingPlacement, 0, 0, 0);
const storey = add(
  `IFCBUILDINGSTOREY('${guid("storey01")}',${ref(ownerHistory)},'Level 1',$,$,${ref(storeyPlacement)},$,$,.ELEMENT.,0.)`,
);

relationAggregate("relprojectsite", project, [site]);
relationAggregate("relsitebuilding", site, [building]);
relationAggregate("relbuildinglvl1", building, [storey]);

function createSpace({ code, name, x, y }) {
  const objectPlacement = placement(storeyPlacement, x, y, 0);
  return add(
    `IFCSPACE('${guid(code)}',${ref(ownerHistory)},${text(name)},$,$,${ref(objectPlacement)},$,${text(
      name,
    )},.ELEMENT.,.INTERNAL.,0.)`,
  );
}

const operationsRoom = createSpace({
  code: "spaceoperations",
  name: "Operations Room",
  x: 0,
  y: 0,
});
const plantRoom = createSpace({
  code: "spaceplant",
  name: "Plant Room",
  x: 7,
  y: 0,
});
relationAggregate("relstoreyspaces", storey, [operationsRoom, plantRoom]);

function createElement({
  code,
  ifcClass,
  name,
  objectType,
  tag,
  predefinedType,
  x,
  y,
  z,
  width,
  depth,
  height,
}) {
  const objectPlacement = placement(storeyPlacement, x, y, z);
  const shape = boxShape(width, depth, height);
  return add(
    `${ifcClass}('${guid(code)}',${ref(ownerHistory)},${text(name)},$,${text(objectType)},${ref(
      objectPlacement,
    )},${ref(shape)},${text(tag)},.${predefinedType}.)`,
  );
}

const architecture = [
  createElement({
    code: "floor01",
    ifcClass: "IFCSLAB",
    name: "Level 1 Floor",
    objectType: "Floor slab",
    tag: "SLAB-F01",
    predefinedType: "FLOOR",
    x: 6,
    y: 4,
    z: -0.2,
    width: 12,
    depth: 8,
    height: 0.2,
  }),
  createElement({
    code: "wallnorth",
    ifcClass: "IFCWALL",
    name: "North Wall",
    objectType: "Exterior wall",
    tag: "WALL-N",
    predefinedType: "STANDARD",
    x: 6,
    y: 7.9,
    z: 0,
    width: 12,
    depth: 0.2,
    height: 3.2,
  }),
  createElement({
    code: "wallsouth",
    ifcClass: "IFCWALL",
    name: "South Wall",
    objectType: "Exterior wall",
    tag: "WALL-S",
    predefinedType: "STANDARD",
    x: 6,
    y: 0.1,
    z: 0,
    width: 12,
    depth: 0.2,
    height: 3.2,
  }),
  createElement({
    code: "wallwest",
    ifcClass: "IFCWALL",
    name: "West Wall",
    objectType: "Exterior wall",
    tag: "WALL-W",
    predefinedType: "STANDARD",
    x: 0.1,
    y: 4,
    z: 0,
    width: 0.2,
    depth: 8,
    height: 3.2,
  }),
  createElement({
    code: "walleast",
    ifcClass: "IFCWALL",
    name: "East Wall",
    objectType: "Exterior wall",
    tag: "WALL-E",
    predefinedType: "STANDARD",
    x: 11.9,
    y: 4,
    z: 0,
    width: 0.2,
    depth: 8,
    height: 3.2,
  }),
  createElement({
    code: "wallpartition",
    ifcClass: "IFCWALL",
    name: "Plant Room Partition",
    objectType: "Interior wall",
    tag: "WALL-PART",
    predefinedType: "STANDARD",
    x: 6.5,
    y: 4,
    z: 0,
    width: 0.15,
    depth: 8,
    height: 3.2,
  }),
];
relationContains("relarchitecture", storey, architecture);

const deviceSpecs = [
  {
    code: "camera01",
    ifcClass: "IFCAUDIOVISUALAPPLIANCE",
    name: "IP Camera 01",
    objectType: "CCTV IP Camera",
    tag: "CAM-F01-001",
    predefinedType: "CAMERA",
    room: operationsRoom,
    assetCode: "CAM-F01-001",
    deviceId: "camera-f01-001",
    mqttTopic: "demo/building/F01/camera/CAM-F01-001/status",
    status: "Online",
    manufacturer: "DemoVision",
    model: "DV-CAM-4K",
    pointTemplate: "camera_status",
    x: 1,
    y: 1,
    z: 2.6,
    width: 0.35,
    depth: 0.2,
    height: 0.2,
    system: "cctv",
  },
  {
    code: "light01",
    ifcClass: "IFCLIGHTFIXTURE",
    name: "Ceiling Light 01",
    objectType: "LED Panel",
    tag: "LGT-F01-001",
    predefinedType: "POINTSOURCE",
    room: operationsRoom,
    assetCode: "LGT-F01-001",
    deviceId: "light-f01-001",
    mqttTopic: "demo/building/F01/light/LGT-F01-001/status",
    status: "Online",
    manufacturer: "DemoLight",
    model: "DL-LED-600",
    pointTemplate: "light_status_power",
    x: 2,
    y: 2,
    z: 2.9,
    width: 0.6,
    depth: 0.6,
    height: 0.08,
    system: "lighting",
  },
  {
    code: "light02",
    ifcClass: "IFCLIGHTFIXTURE",
    name: "Ceiling Light 02",
    objectType: "LED Panel",
    tag: "LGT-F01-002",
    predefinedType: "POINTSOURCE",
    room: operationsRoom,
    assetCode: "LGT-F01-002",
    deviceId: "light-f01-002",
    mqttTopic: "demo/building/F01/light/LGT-F01-002/status",
    status: "Fault",
    manufacturer: "DemoLight",
    model: "DL-LED-600",
    pointTemplate: "light_status_power",
    x: 5,
    y: 5,
    z: 2.9,
    width: 0.6,
    depth: 0.6,
    height: 0.08,
    system: "lighting",
  },
  {
    code: "tempsensor01",
    ifcClass: "IFCSENSOR",
    name: "Room Temperature Sensor 01",
    objectType: "Temperature Sensor",
    tag: "SNS-TEMP-F01-001",
    predefinedType: "TEMPERATURESENSOR",
    room: operationsRoom,
    assetCode: "SNS-TEMP-F01-001",
    deviceId: "temp-sensor-f01-001",
    mqttTopic: "demo/building/F01/sensor/SNS-TEMP-F01-001/telemetry",
    status: "Warning",
    manufacturer: "DemoSense",
    model: "DS-TEMP-01",
    pointTemplate: "temperature_celsius_status",
    x: 3,
    y: 0.25,
    z: 1.5,
    width: 0.12,
    depth: 0.08,
    height: 0.12,
    system: "bms",
  },
  {
    code: "firealarm01",
    ifcClass: "IFCALARM",
    name: "Fire Alarm Sounder 01",
    objectType: "Fire Alarm Sounder",
    tag: "ALM-FIRE-F01-001",
    predefinedType: "SIREN",
    room: operationsRoom,
    assetCode: "ALM-FIRE-F01-001",
    deviceId: "fire-alarm-f01-001",
    mqttTopic: "demo/building/F01/fire/ALM-FIRE-F01-001/status",
    status: "Online",
    manufacturer: "DemoSafe",
    model: "DS-SOUNDER-01",
    pointTemplate: "alarm_status",
    x: 6.2,
    y: 2,
    z: 2.4,
    width: 0.2,
    depth: 0.12,
    height: 0.2,
    system: "fire",
  },
  {
    code: "controller01",
    ifcClass: "IFCCONTROLLER",
    name: "BMS Room Controller 01",
    objectType: "Programmable Room Controller",
    tag: "CTRL-BMS-F01-001",
    predefinedType: "PROGRAMMABLE",
    room: operationsRoom,
    assetCode: "CTRL-BMS-F01-001",
    deviceId: "bms-controller-f01-001",
    mqttTopic: "demo/building/F01/controller/CTRL-BMS-F01-001/status",
    status: "Online",
    manufacturer: "DemoControls",
    model: "DC-BMS-100",
    pointTemplate: "controller_status",
    x: 5.8,
    y: 0.25,
    z: 1.2,
    width: 0.35,
    depth: 0.15,
    height: 0.5,
    system: "bms",
  },
  {
    code: "ahu01",
    ifcClass: "IFCUNITARYEQUIPMENT",
    name: "Air Handling Unit 01",
    objectType: "Air Handling Unit",
    tag: "AHU-F01-001",
    predefinedType: "AIRHANDLER",
    room: plantRoom,
    assetCode: "AHU-F01-001",
    deviceId: "ahu-f01-001",
    mqttTopic: "demo/building/F01/hvac/AHU-F01-001/telemetry",
    status: "Online",
    manufacturer: "DemoAir",
    model: "DA-AHU-5000",
    pointTemplate: "ahu_supply_temp_fan_status_filter_dp",
    x: 8,
    y: 2,
    z: 0,
    width: 2.2,
    depth: 1.2,
    height: 1.6,
    system: "hvac",
  },
  {
    code: "fan01",
    ifcClass: "IFCFAN",
    name: "Extract Fan 01",
    objectType: "Extract Fan",
    tag: "FAN-F01-001",
    predefinedType: "NOTDEFINED",
    room: plantRoom,
    assetCode: "FAN-F01-001",
    deviceId: "fan-f01-001",
    mqttTopic: "demo/building/F01/hvac/FAN-F01-001/telemetry",
    status: "Offline",
    manufacturer: "DemoAir",
    model: "DA-FAN-800",
    pointTemplate: "fan_run_status_speed_vibration",
    x: 10.3,
    y: 2,
    z: 0.5,
    width: 0.8,
    depth: 0.8,
    height: 0.8,
    system: "hvac",
  },
  {
    code: "pump01",
    ifcClass: "IFCPUMP",
    name: "Chilled Water Pump 01",
    objectType: "Circulation Pump",
    tag: "PMP-F01-001",
    predefinedType: "CIRCULATOR",
    room: plantRoom,
    assetCode: "PMP-F01-001",
    deviceId: "pump-f01-001",
    mqttTopic: "demo/building/F01/hydronic/PMP-F01-001/telemetry",
    status: "Warning",
    manufacturer: "DemoFlow",
    model: "DF-PUMP-250",
    pointTemplate: "pump_run_status_flow_pressure_vibration",
    x: 8,
    y: 5.3,
    z: 0.2,
    width: 1,
    depth: 0.6,
    height: 0.7,
    system: "hydronic",
  },
];

function propertyValue(name, value, type = "IFCLABEL") {
  if (type === "IFCBOOLEAN") {
    return add(`IFCPROPERTYSINGLEVALUE(${text(name)},$,IFCBOOLEAN(${value ? ".T." : ".F."}),$)`);
  }
  if (type === "IFCREAL") {
    return add(`IFCPROPERTYSINGLEVALUE(${text(name)},$,IFCREAL(${real(value)}),$)`);
  }
  return add(`IFCPROPERTYSINGLEVALUE(${text(name)},$,${type}(${text(value)}),$)`);
}

function attachDigitalTwinProperties(spec, element) {
  const properties = [
    propertyValue("Asset Code", spec.assetCode),
    propertyValue("Functional Location", `DT-DEMO/F01/${spec.room === plantRoom ? "PLANT" : "OPS"}`),
    propertyValue("Asset Tag No.", spec.tag),
    propertyValue("Manufacturer", spec.manufacturer),
    propertyValue("Model No.", spec.model),
    propertyValue("Device ID", spec.deviceId),
    propertyValue("Gateway ID", "MQTT-DEMO-BROKER-01"),
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
  const pset = add(
    `IFCPROPERTYSET('${guid(`pset${spec.code}`)}',${ref(ownerHistory)},'DT.Common',$,(${properties
      .map(ref)
      .join(",")}))`,
  );
  add(
    `IFCRELDEFINESBYPROPERTIES('${guid(`relps${spec.code}`)}',${ref(
      ownerHistory,
    )},$,$,(${ref(element)}),${ref(pset)})`,
  );
}

const devices = deviceSpecs.map((spec) => {
  const element = createElement(spec);
  attachDigitalTwinProperties(spec, element);
  return { ...spec, element };
});

relationContains(
  "relopsdevices",
  operationsRoom,
  devices.filter((device) => device.room === operationsRoom).map((device) => device.element),
);
relationContains(
  "relplantdevices",
  plantRoom,
  devices.filter((device) => device.room === plantRoom).map((device) => device.element),
);

function createSystem(code, name, predefinedType, deviceSystem) {
  const system = add(
    `IFCDISTRIBUTIONSYSTEM('${guid(code)}',${ref(ownerHistory)},${text(
      name,
    )},$,$,$,.${predefinedType}.)`,
  );
  const systemDevices = devices
    .filter((device) => device.system === deviceSystem)
    .map((device) => device.element);
  add(
    `IFCRELASSIGNSTOGROUP('${guid(`assign${code}`)}',${ref(ownerHistory)},$,$,(${systemDevices
      .map(ref)
      .join(",")}),$,${ref(system)})`,
  );
  add(
    `IFCRELSERVICESBUILDINGS('${guid(`service${code}`)}',${ref(
      ownerHistory,
    )},$,$,${ref(system)},(${ref(building)}))`,
  );
}

createSystem("systemcctv", "CCTV System", "COMMUNICATION", "cctv");
createSystem("systemlight", "Lighting System", "ELECTRICAL", "lighting");
createSystem("systembms", "Building Management System", "CONTROL", "bms");
createSystem("systemfire", "Fire Alarm System", "FIREPROTECTION", "fire");
createSystem("systemhvac", "HVAC System", "VENTILATION", "hvac");
createSystem("systemhydronic", "Hydronic System", "HEATING", "hydronic");

const ifc = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('digital-twin-equipment-demo.ifc','2026-06-15T17:00:00+07:00',('Codex'),('BIM Pipeline Digital Twin Demo'),'BIM Pipeline Demo Generator','BIM Pipeline Demo Generator','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${entities.join("\n")}
ENDSEC;
END-ISO-10303-21;
`;

fs.writeFileSync(outputPath, ifc, "utf8");
console.log(`Generated ${outputPath}`);
console.log(`Entities: ${entities.length}, devices: ${devices.length}`);
