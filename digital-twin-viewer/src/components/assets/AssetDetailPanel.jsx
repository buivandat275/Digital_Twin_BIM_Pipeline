import React from "react";
import { Box, ExternalLink, PackageCheck } from "lucide-react";
import { canOpenIfc } from "../../core/services/mappingService.js";

function Badge({ value }) {
  const slug = String(value || "unknown").toLowerCase().replace(/\s+/g, "-");
  return <span className={`integration-badge ${slug}`}>{value || "Unknown"}</span>;
}

function Field({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value || "Not provided"}</dd>
    </>
  );
}

export function AssetDetailPanel({ asset, building, files, onOpenIfc }) {
  if (!asset) {
    return (
      <section className="integration-detail-panel">
        <p className="integration-empty">Select an asset to inspect metadata and mapping status.</p>
      </section>
    );
  }

  const canOpen = canOpenIfc(asset, building, files);
  const canOpenBuildingIfc = Boolean(building?.ifcFile && files.some((file) => file.name === building.ifcFile));
  const canOpenViewer = canOpen || canOpenBuildingIfc;
  const mappingInfo = asset.mappingInfo || {};
  const ifcObject = asset.ifcObject || mappingInfo.ifcObject;
  const locationText = asset.hasTrustedLatLon
    ? `${asset.latitude}, ${asset.longitude}`
    : [asset.buildingName, asset.floor, asset.room].filter(Boolean).join(" / ");

  return (
    <section className="integration-detail-panel" aria-label="Asset detail">
      <div className="integration-section-head">
        <div>
          <span className="integration-eyebrow">Asset detail</span>
          <h2>{asset.assetCode}</h2>
        </div>
        <Box size={22} />
      </div>

      <div className="integration-status-stack">
        <Badge value={asset.mappingStatus} />
        <Badge value={asset.completenessStatus} />
      </div>

      <div className="integration-callout">
        <PackageCheck size={18} />
        <div>
          <strong>{asset.name}</strong>
          <span>{asset.type}</span>
        </div>
      </div>

      <dl className="integration-detail-grid">
        <Field label="Building" value={asset.buildingName} />
        <Field label="Floor" value={asset.floor} />
        <Field label="Room / zone" value={asset.room} />
        <Field label="Location" value={locationText} />
        <Field label="Health status" value={asset.status} />
        <Field label="Status reason" value={asset.statusReason} />
        <Field label="Last signal" value={asset.lastSignalAt} />
        <Field label="Coordinate source" value={asset.coordinateSource || (asset.hasTrustedLatLon ? "Provided" : "Inherited from building")} />
        <Field label="IFC GUID" value={asset.ifcGuid} />
        <Field label="Mapping method" value={mappingInfo.method || "Not mapped"} />
        <Field label="Confidence" value={mappingInfo.confidence ? `${Math.round(mappingInfo.confidence * 100)}%` : ""} />
        <Field label="IFC object" value={ifcObject ? `${ifcObject.objectName} (${ifcObject.objectType})` : ""} />
        <Field label="IFC file" value={building?.ifcFile} />
        <Field label="Source data" value={asset.sourceSystem} />
      </dl>

      {ifcObject ? (
        <div className="integration-metadata">
          <h3>IFC reference</h3>
          <pre>{JSON.stringify({
            ifcGuid: ifcObject.ifcGuid,
            objectName: ifcObject.objectName,
            objectType: ifcObject.objectType,
            assetCode: ifcObject.assetCode,
            sourceSystem: ifcObject.sourceSystem,
            properties: ifcObject.properties,
          }, null, 2)}</pre>
        </div>
      ) : null}

      <div className="integration-metadata">
        <h3>Metadata</h3>
        <pre>{JSON.stringify(asset.metadata || {}, null, 2)}</pre>
      </div>

      <button className="integration-primary-action" disabled={!canOpenViewer} onClick={() => onOpenIfc(asset)} type="button">
        <ExternalLink size={17} />
        <span>{canOpen ? "Open IFC viewer" : "Open building IFC"}</span>
      </button>

      {!canOpen && canOpenBuildingIfc ? (
        <p className="integration-note">
          This opens the building IFC only. The asset is not focused because no IFC object mapping is available yet.
        </p>
      ) : null}

    </section>
  );
}
