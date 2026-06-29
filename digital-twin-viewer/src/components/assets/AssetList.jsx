import React from "react";
import { Box, MessageSquareText, Search, SlidersHorizontal, X } from "lucide-react";
import { AssetRegisterImportPanel } from "./AssetRegisterImportPanel.jsx";

function Badge({ value }) {
  const slug = String(value || "unknown").toLowerCase().replace(/\s+/g, "-");
  return <span className={`integration-badge ${slug}`}>{value || "Unknown"}</span>;
}

export function AssetList({
  assets,
  buildings,
  filters,
  importJob,
  naturalLanguageEvidence,
  naturalLanguageQuery,
  naturalLanguageResult,
  qwenEnabled,
  qwenStatus,
  query,
  selectedAssetId,
  spatialSummary,
  typeOptions,
  onClearFilters,
  onCheckQwen,
  onFilterChange,
  onImportAssets,
  onNaturalLanguageChange,
  onNaturalLanguageSubmit,
  onQueryChange,
  onSelectAsset,
  onToggleQwen,
}) {
  return (
    <aside className="integration-rail" aria-label="Asset search and list">
      <div className="integration-section-head">
        <div>
          <span className="integration-eyebrow">Registry</span>
          <h2>Assets</h2>
        </div>
        <span className="integration-count">{assets.length}</span>
      </div>

      <label className="integration-search">
        <Search size={17} />
        <input
          aria-label="Search assets"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search code, name, type, building, floor, room"
          value={query}
        />
      </label>

      <form
        className="integration-natural-search"
        onSubmit={(event) => {
          event.preventDefault();
          onNaturalLanguageSubmit();
        }}
      >
        <label>
          <span>Natural language</span>
          <div>
            <MessageSquareText size={16} />
            <input
              aria-label="Natural language asset search"
              onChange={(event) => onNaturalLanguageChange(event.target.value)}
              placeholder="Example: camera tang 9 chua map IFC"
              value={naturalLanguageQuery}
            />
          </div>
        </label>
        <div className="integration-llm-controls">
          <button className={qwenEnabled ? "is-active" : ""} onClick={onToggleQwen} type="button">
            {qwenEnabled ? "Qwen on" : "Rules only"}
          </button>
          <button onClick={onCheckQwen} type="button">Check</button>
          <span className={qwenStatus.status === "online" ? "online" : "offline"}>
            {qwenStatus.status} · {qwenStatus.model || "qwen2.5:1.5b"}
          </span>
        </div>
        <button type="submit">Apply</button>
        {naturalLanguageResult ? <p>{naturalLanguageResult}</p> : null}
        {spatialSummary ? <p className="integration-spatial-summary">{spatialSummary}</p> : null}
        {naturalLanguageEvidence ? (
          <details className="integration-llm-evidence">
            <summary>LLM evidence</summary>
            <pre>{JSON.stringify(naturalLanguageEvidence, null, 2)}</pre>
          </details>
        ) : null}
      </form>

      <div className="integration-filter-grid">
        <label>
          <span>Building</span>
          <select value={filters.buildingId} onChange={(event) => onFilterChange("buildingId", event.target.value)}>
            <option value="">All buildings</option>
            {buildings.map((building) => (
              <option key={building.id} value={building.id}>
                {building.code || building.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Type</span>
          <select value={filters.type} onChange={(event) => onFilterChange("type", event.target.value)}>
            <option value="">All types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Mapping</span>
          <select value={filters.mappingStatus} onChange={(event) => onFilterChange("mappingStatus", event.target.value)}>
            <option value="">Any status</option>
            <option value="Mapped">Mapped</option>
            <option value="Mapped by Asset Code">Mapped by Asset Code</option>
            <option value="IFC Object Missing">IFC Object Missing</option>
            <option value="Unmapped">Unmapped</option>
            <option value="Missing IFC File">Missing IFC File</option>
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={filters.status} onChange={(event) => onFilterChange("status", event.target.value)}>
            <option value="">Any status</option>
            <option value="Normal">Normal</option>
            <option value="Warning">Warning</option>
            <option value="Fault">Fault</option>
            <option value="Offline">Offline</option>
          </select>
        </label>
        <label>
          <span>Completeness</span>
          <select
            value={filters.completenessStatus}
            onChange={(event) => onFilterChange("completenessStatus", event.target.value)}
          >
            <option value="">Any status</option>
            <option value="Ready">Ready</option>
            <option value="Missing Location">Missing Location</option>
            <option value="Missing Building">Missing Building</option>
            <option value="Incomplete">Incomplete</option>
          </select>
        </label>
      </div>

      <button className="integration-clear-filters" onClick={onClearFilters} type="button">
        <X size={15} />
        <span>Clear filters</span>
      </button>

      <AssetRegisterImportPanel buildings={buildings} onImport={onImportAssets} />

      {importJob ? (
        <div className="integration-last-import">
          <SlidersHorizontal size={14} />
          <span>{importJob.summary.validRows} rows merged from {importJob.fileName}</span>
        </div>
      ) : null}

      <div className="integration-asset-list">
        {assets.map((asset) => (
          <button
            className={`integration-asset-row ${asset.id === selectedAssetId ? "is-active" : ""}`}
            key={asset.id}
            onClick={() => onSelectAsset(asset)}
            type="button"
          >
            <div className="integration-asset-row-main">
              <Box size={16} />
              <div>
                <strong>{asset.assetCode}</strong>
                <span>{asset.name}</span>
              </div>
            </div>
            <div className="integration-row-meta">
              <span>{asset.type}</span>
              <span>{[asset.floor, asset.room].filter(Boolean).join(" / ") || asset.buildingName}</span>
            </div>
            <div className="integration-row-badges">
              <Badge value={asset.status} />
              <Badge value={asset.mappingStatus} />
              <Badge value={asset.completenessStatus} />
            </div>
          </button>
        ))}
        {!assets.length ? <p className="integration-empty">No matching assets.</p> : null}
      </div>
    </aside>
  );
}
