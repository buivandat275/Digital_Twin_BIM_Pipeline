import * as XLSX from "xlsx";

const REQUIRED_FIELDS = ["assetCode", "name", "type", "buildingId"];

const HEADER_ALIASES = {
  id: ["id", "assetId", "asset_id"],
  assetCode: ["assetCode", "asset_code", "asset_id", "code"],
  name: ["name", "assetName", "asset_name", "description"],
  type: ["type", "assetType", "asset_type", "category"],
  buildingId: ["buildingId", "building_id"],
  buildingCode: ["buildingCode", "building_code", "building"],
  floor: ["floor", "level"],
  room: ["room", "room_zone", "zone"],
  latitude: ["latitude", "lat"],
  longitude: ["longitude", "lon", "lng"],
  coordinateSource: ["coordinateSource", "coordinate_source", "coord_source"],
  ifcGuid: ["ifcGuid", "ifc_guid", "source_global_id", "globalId", "global_id"],
  sourceSystem: ["sourceSystem", "source_system", "source"],
};

function text(value) {
  return String(value ?? "").trim();
}

function normalizeKey(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map(text);
}

function parseCsv(textContent) {
  return textContent
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => text(line))
    .map(splitCsvLine);
}

function buildHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalizeKey);
  return Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([field, aliases]) => {
      const normalizedAliases = aliases.map(normalizeKey);
      const index = normalizedHeaders.findIndex((header) => normalizedAliases.includes(header));
      return [field, index];
    }),
  );
}

function getCell(row, headerMap, field) {
  const index = headerMap[field];
  return index >= 0 ? text(row[index]) : "";
}

function buildBuildingLookup(buildings) {
  const lookup = new Map();
  buildings.forEach((building) => {
    [building.id, building.code, building.name].filter(Boolean).forEach((key) => {
      lookup.set(normalizeKey(key), building.id);
    });
  });
  return lookup;
}

function parseMetadata(row, headers, headerMap) {
  const consumed = new Set(Object.values(headerMap).filter((index) => index >= 0));
  const metadata = {};
  headers.forEach((header, index) => {
    if (!consumed.has(index) && text(row[index])) {
      metadata[header] = text(row[index]);
    }
  });
  return metadata;
}

function resolveBuildingId(row, headerMap, buildingLookup) {
  const directBuildingId = getCell(row, headerMap, "buildingId");
  const buildingCode = getCell(row, headerMap, "buildingCode");
  return buildingLookup.get(normalizeKey(directBuildingId)) || buildingLookup.get(normalizeKey(buildingCode)) || directBuildingId;
}

function rowsToAssetRegister(rows, buildings = [], defaultSourceSystem = "asset-register-csv") {
  if (rows.length < 2) {
    return {
      assets: [],
      errors: [{ row: 1, field: "file", message: "Asset register must contain a header row and at least one asset row." }],
      warnings: [],
      summary: { totalRows: 0, validRows: 0, errorRows: 0 },
    };
  }

  const [headers, ...dataRows] = rows;
  const headerMap = buildHeaderMap(headers);
  const buildingLookup = buildBuildingLookup(buildings);
  const errors = [];
  const warnings = [];
  const assets = dataRows.map((row, index) => {
    const rowNumber = index + 2;
    const buildingId = resolveBuildingId(row, headerMap, buildingLookup);
    const asset = {
      id: getCell(row, headerMap, "id") || getCell(row, headerMap, "assetCode"),
      assetCode: getCell(row, headerMap, "assetCode"),
      name: getCell(row, headerMap, "name"),
      type: getCell(row, headerMap, "type"),
      buildingId,
      floor: getCell(row, headerMap, "floor"),
      room: getCell(row, headerMap, "room"),
      latitude: getCell(row, headerMap, "latitude"),
      longitude: getCell(row, headerMap, "longitude"),
      coordinateSource: getCell(row, headerMap, "coordinateSource"),
      ifcGuid: getCell(row, headerMap, "ifcGuid"),
      sourceSystem: getCell(row, headerMap, "sourceSystem") || defaultSourceSystem,
      metadata: parseMetadata(row, headers, headerMap),
    };

    REQUIRED_FIELDS.forEach((field) => {
      if (!text(asset[field])) {
        errors.push({ row: rowNumber, field, assetCode: asset.assetCode, message: `${field} is required.` });
      }
    });
    if (asset.buildingId && !buildingLookup.has(normalizeKey(asset.buildingId))) {
      errors.push({
        row: rowNumber,
        field: "buildingId",
        assetCode: asset.assetCode,
        message: `Building '${asset.buildingId}' is not in the building repository.`,
      });
    }
    if ((asset.latitude && !asset.longitude) || (!asset.latitude && asset.longitude)) {
      warnings.push({
        row: rowNumber,
        field: "location",
        assetCode: asset.assetCode,
        message: "Latitude and longitude should be provided together.",
      });
    }
    return asset;
  });

  const rowsWithErrors = new Set(errors.map((error) => error.row));
  return {
    assets,
    errors,
    warnings,
    summary: {
      totalRows: dataRows.length,
      validRows: dataRows.length - rowsWithErrors.size,
      errorRows: rowsWithErrors.size,
    },
  };
}

export function parseAssetRegisterCsv(textContent, buildings = []) {
  return rowsToAssetRegister(parseCsv(textContent), buildings, "asset-register-csv");
}

export function parseAssetRegisterWorkbook(arrayBuffer, buildings = []) {
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      assets: [],
      errors: [{ row: 1, field: "file", message: "Workbook does not contain any sheet." }],
      warnings: [],
      summary: { totalRows: 0, validRows: 0, errorRows: 0 },
    };
  }
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils
    .sheet_to_json(worksheet, { header: 1, defval: "", blankrows: false, raw: false })
    .map((row) => row.map(text))
    .filter((row) => row.some((cell) => text(cell)));
  return {
    sheetName,
    ...rowsToAssetRegister(rows, buildings, "asset-register-xlsx"),
  };
}

export async function parseAssetRegisterFile(file, buildings = []) {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    return {
      fileType: "csv",
      ...(parseAssetRegisterCsv(await file.text(), buildings)),
    };
  }
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    return {
      fileType: "xlsx",
      ...(parseAssetRegisterWorkbook(await file.arrayBuffer(), buildings)),
    };
  }
  return {
    fileType: "unsupported",
    assets: [],
    errors: [{ row: 1, field: "file", message: "Supported formats are CSV, XLSX, and XLS." }],
    warnings: [],
    summary: { totalRows: 0, validRows: 0, errorRows: 0 },
  };
}

export function mergeAssetRegisters(existingAssets, importedAssets) {
  const merged = new Map();
  existingAssets.forEach((asset) => {
    const key = normalizeKey(asset.assetCode || asset.asset_id || asset.id);
    if (key) merged.set(key, asset);
  });
  importedAssets.forEach((asset) => {
    const key = normalizeKey(asset.assetCode || asset.id);
    if (!key) return;
    merged.set(key, {
      ...(merged.get(key) || {}),
      ...asset,
      id: asset.id || merged.get(key)?.id || asset.assetCode,
      metadata: {
        ...(merged.get(key)?.metadata || {}),
        ...(asset.metadata || {}),
      },
    });
  });
  return Array.from(merged.values());
}
