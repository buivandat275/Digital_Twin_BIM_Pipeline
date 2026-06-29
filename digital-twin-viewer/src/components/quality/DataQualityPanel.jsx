import React from "react";
import { AlertTriangle, CheckCircle2, Database, FileQuestion, Link2Off, MapPin } from "lucide-react";

function Metric({ label, value }) {
  return (
    <div className="integration-quality-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function IssueGroup({ actionLabel, icon, items, label, onApplyFilter, onSelectAsset, renderItem }) {
  return (
    <div className="integration-quality-group">
      <div className="integration-quality-group-head">
        <span>
          {icon}
          {label}
        </span>
        {onApplyFilter ? (
          <button disabled={!items.length} onClick={onApplyFilter} type="button">
            {actionLabel}
          </button>
        ) : null}
      </div>
      <div className="integration-quality-list">
        {items.slice(0, 3).map((item) => (
          <button
            disabled={!onSelectAsset}
            key={item.id || item.ifcGuid || item.assetCode}
            onClick={() => onSelectAsset?.(item)}
            type="button"
          >
            {renderItem(item)}
          </button>
        ))}
        {!items.length ? <span className="integration-quality-empty">None</span> : null}
      </div>
    </div>
  );
}

export function DataQualityPanel({ report, onApplyQualityFilter, onSelectAsset }) {
  const groups = report.groups;
  return (
    <section className="integration-quality-panel" aria-label="Data quality">
      <div className="integration-section-head">
        <div>
          <span className="integration-eyebrow">Data quality</span>
          <h2>Readiness</h2>
        </div>
        {report.score >= 80 ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}
      </div>

      <div className="integration-quality-score">
        <strong>{report.score}</strong>
        <span>readiness score</span>
      </div>

      <div className="integration-quality-metrics">
        <Metric label="mapped assets" value={report.summary.mappedAssets} />
        <Metric label="issues" value={report.summary.issueCount} />
        <Metric label="IFC refs" value={report.summary.totalIfcObjects} />
      </div>

      <IssueGroup
        actionLabel="Filter"
        icon={<Link2Off size={14} />}
        items={groups.unmappedAssets}
        label="Assets not mapped to IFC"
        onApplyFilter={() => onApplyQualityFilter("unmappedAsset")}
        onSelectAsset={onSelectAsset}
        renderItem={(asset) => (
          <>
            <strong>{asset.assetCode}</strong>
            <span>{asset.mappingStatus}</span>
          </>
        )}
      />

      <IssueGroup
        actionLabel="Filter"
        icon={<FileQuestion size={14} />}
        items={groups.unmatchedIfcObjects}
        label="IFC objects without asset"
        onApplyFilter={null}
        renderItem={(ifcObject) => (
          <>
            <strong>{ifcObject.assetCode || ifcObject.ifcGuid}</strong>
            <span>{ifcObject.objectName || ifcObject.objectType}</span>
          </>
        )}
      />

      <IssueGroup
        actionLabel="Filter"
        icon={<MapPin size={14} />}
        items={groups.missingLocationAssets}
        label="Assets missing location"
        onApplyFilter={() => onApplyQualityFilter("missingLocation")}
        onSelectAsset={onSelectAsset}
        renderItem={(asset) => (
          <>
            <strong>{asset.assetCode}</strong>
            <span>{asset.buildingName || "No building"}</span>
          </>
        )}
      />

      <IssueGroup
        actionLabel="Filter"
        icon={<Database size={14} />}
        items={groups.missingMetadataAssets}
        label="Assets missing metadata"
        onApplyFilter={() => onApplyQualityFilter("missingMetadata")}
        onSelectAsset={onSelectAsset}
        renderItem={(asset) => (
          <>
            <strong>{asset.assetCode}</strong>
            <span>{asset.type || "No type"}</span>
          </>
        )}
      />
    </section>
  );
}
