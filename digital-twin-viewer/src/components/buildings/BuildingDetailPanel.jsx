import React from "react";
import { Building2, MapPinned } from "lucide-react";

function Field({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value || "Not provided"}</dd>
    </>
  );
}

export function BuildingDetailPanel({ building, assetCount }) {
  if (!building) {
    return (
      <section className="integration-building-panel">
        <p className="integration-empty">Select a building or site.</p>
      </section>
    );
  }

  return (
    <section className="integration-building-panel" aria-label="Building detail">
      <div className="integration-section-head">
        <div>
          <span className="integration-eyebrow">Site / building</span>
          <h2>{building.name}</h2>
        </div>
        <Building2 size={22} />
      </div>

      <div className="integration-callout subtle">
        <MapPinned size={18} />
        <div>
          <strong>{building.code}</strong>
          <span>{assetCount} linked assets in sample registry</span>
        </div>
      </div>

      <dl className="integration-detail-grid compact">
        <Field label="Address" value={building.address} />
        <Field label="Latitude" value={building.latitude} />
        <Field label="Longitude" value={building.longitude} />
        <Field label="IFC file" value={building.ifcFile} />
        <Field label="Source data" value={building.sourceSystem} />
        <Field label="Boundary" value={building.geometry ? "Polygon from source data" : "Not provided"} />
      </dl>
    </section>
  );
}
