export const MappingStatus = Object.freeze({
  MAPPED: "Mapped",
  MAPPED_BY_CODE: "Mapped by Asset Code",
  IFC_OBJECT_MISSING: "IFC Object Missing",
  UNMAPPED: "Unmapped",
  MISSING_IFC_FILE: "Missing IFC File",
});

export const CompletenessStatus = Object.freeze({
  READY: "Ready",
  MISSING_BUILDING: "Missing Building",
  MISSING_LOCATION: "Missing Location",
  INCOMPLETE: "Incomplete",
});

/**
 * @typedef {Object} Building
 * @property {string} id
 * @property {string} code
 * @property {string} name
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} ifcFile
 * @property {Object|null} geometry
 */

/**
 * @typedef {Object} Asset
 * @property {string} id
 * @property {string} assetCode
 * @property {string} name
 * @property {string} type
 * @property {string} buildingId
 * @property {string} floor
 * @property {string} room
 * @property {number=} latitude
 * @property {number=} longitude
 * @property {string} ifcGuid
 * @property {string} sourceSystem
 * @property {Object} metadata
 */

/**
 * @typedef {Object} IfcObjectReference
 * @property {string} ifcGuid
 * @property {string} ifcFileId
 * @property {string} objectName
 * @property {string} objectType
 * @property {string} assetCode
 * @property {Object} properties
 */
