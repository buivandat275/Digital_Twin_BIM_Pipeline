import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Box, Crosshair, Database, Eraser, ListFilter, Maximize2, Pencil, Save, Search, X } from "lucide-react";
import { ApsViewerCanvas } from "./ApsViewerCanvas.jsx";

const OM_FIELD_NAMES = [
  "EMSD.Common.Asset Code",
  "EMSD.Common.Asset Tag No.",
  "EMSD.Common.Manufacturer",
  "VSF.Common.Asset Code",
  "VSF.Common.Asset Tag No.",
  "VSF.Common.Manufacturer",
  "VSF.Location",
  "VSF.Link",
  "VSF.Status",
  "VSF.Document",
];

function readViewerQuery() {
  const params = new URLSearchParams(window.location.search);
  return {
    name: params.get("name") || "",
    urn: params.get("urn") || "",
    dataset: params.get("dataset") || "",
  };
}

function updateViewerQuery(model, dataset) {
  const params = new URLSearchParams();
  if (model?.urn) params.set("urn", model.urn);
  if (model?.sourceFile) params.set("name", model.sourceFile);
  if (dataset) params.set("dataset", dataset);
  window.history.replaceState({}, "", `/aps-viewer?${params.toString()}`);
}

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function readinessLabel(value) {
  const labels = {
    Complete: "Đủ thông tin",
    Incomplete: "Thiếu thông tin",
    Excluded: "Không thuộc vận hành",
    "Scope Review": "Cần xác nhận vận hành",
    "Not linked": "Chưa liên kết",
  };
  return labels[value] || value;
}

function missingOmFields(asset) {
  const values = asset?.normalizedProperties || {};
  return OM_FIELD_NAMES.filter((field) => !String(values[field] ?? "").trim());
}

function familyKey(name) {
  return String(name || "")
    .replace(/:\d+\s*$/, "")
    .trim()
    .toLowerCase();
}

function selectionIfcIds(selection) {
  const propertyIds = (selection?.properties || [])
    .filter((property) =>
      ["globalid", "global id", "guid", "ifcguid", "ifc guid"].includes(
        String(property.displayName || "").replace(/[_-]/g, " ").trim().toLowerCase(),
      ),
    )
    .map((property) => property.displayValue)
    .filter(Boolean);
  return [...propertyIds, selection?.externalId].filter(Boolean);
}

function PropertyRows({ values }) {
  const entries = Object.entries(values || {});
  if (!entries.length) return <p className="aps-property-empty">No values available.</p>;
  return (
    <dl>
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt>{key.replace(/_/g, " ")}</dt>
          <dd className={String(value ?? "").trim() ? "" : "is-missing"}>
            {String(value ?? "").trim()
              ? typeof value === "object"
                ? JSON.stringify(value)
                : String(value)
              : "Thiếu thông tin"}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function EditableOmProperties({ twinAsset, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });

  useEffect(() => {
    setDraft(Object.fromEntries(OM_FIELD_NAMES.map((field) => [field, twinAsset?.normalizedProperties?.[field] || ""])));
    setEditing(false);
    setSaveState({ status: "idle", message: "" });
  }, [twinAsset?.ifcGuid]);

  async function saveChanges() {
    setSaveState({ status: "saving", message: "Đang lưu..." });
    try {
      await onSave(twinAsset.ifcGuid, draft);
      setEditing(false);
      setSaveState({ status: "saved", message: "Đã lưu và tính lại validation." });
    } catch (error) {
      setSaveState({ status: "error", message: error.message });
    }
  }

  if (!editing) {
    return (
      <div className="aps-normalized-properties">
        <div className="aps-om-toolbar">
          <span>
            {twinAsset.operationalScope === "context"
              ? "Object này không thuộc phạm vi vận hành"
              : `${missingOmFields(twinAsset).length} / 10 trường còn thiếu`}
          </span>
          {twinAsset.operationalScope !== "context" ? (
            <button onClick={() => setEditing(true)} type="button">
              <Pencil size={14} /> Sửa
            </button>
          ) : null}
        </div>
        <PropertyRows values={Object.fromEntries(OM_FIELD_NAMES.map((field) => [field, twinAsset.normalizedProperties?.[field] || ""]))} />
        {twinAsset.bmsDevice?.device_id ? (
          <>
            <h3>Thông tin BMS Device</h3>
            <PropertyRows values={twinAsset.bmsDevice} />
          </>
        ) : null}
        {saveState.message ? <p className={`aps-save-message ${saveState.status}`}>{saveState.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="aps-om-editor">
      {OM_FIELD_NAMES.map((field) => (
        <label key={field}>
          <span>{field}</span>
          <input
            onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
            placeholder="Nhập thông tin còn thiếu"
            value={draft[field] || ""}
          />
        </label>
      ))}
      <div className="aps-om-editor-actions">
        <button disabled={saveState.status === "saving"} onClick={saveChanges} type="button">
          <Save size={14} /> Lưu
        </button>
        <button onClick={() => setEditing(false)} type="button">
          <X size={14} /> Hủy
        </button>
      </div>
      {saveState.message ? <p className={`aps-save-message ${saveState.status}`}>{saveState.message}</p> : null}
    </div>
  );
}

function ScopeConfirmation({ twinAsset, onConfirm }) {
  const [state, setState] = useState({ status: "idle", message: "" });

  async function confirm(scope) {
    setState({ status: "saving", message: "Đang lưu quyết định..." });
    try {
      await onConfirm(twinAsset.ifcGuid, scope);
      setState({ status: "saved", message: "Đã cập nhật phạm vi vận hành." });
    } catch (error) {
      setState({ status: "error", message: error.message });
    }
  }

  return (
    <section className="aps-scope-confirmation">
      <strong>Xác nhận object này có thuộc giai đoạn vận hành không?</strong>
      <p>Chọn đúng phạm vi sau khi kiểm tra loại thiết bị và hồ sơ dự án.</p>
      <div>
        <button disabled={state.status === "saving"} onClick={() => confirm("maintainable")} type="button">
          Asset bảo trì
        </button>
        <button disabled={state.status === "saving"} onClick={() => confirm("realtime")} type="button">
          Asset realtime/BMS
        </button>
        <button disabled={state.status === "saving"} onClick={() => confirm("context")} type="button">
          Không thuộc vận hành
        </button>
      </div>
      {state.message ? <small className={state.status}>{state.message}</small> : null}
    </section>
  );
}

function PropertyInspector({
  selection,
  twinAsset,
  similarAssets,
  onConfirmScope,
  onFocusAsset,
  onSaveAsset,
}) {
  const [activeTab, setActiveTab] = useState("source");
  const [showSimilar, setShowSimilar] = useState(false);
  useEffect(() => {
    setActiveTab(twinAsset ? "normalized" : "source");
    setShowSimilar(false);
  }, [selection?.dbId, twinAsset]);

  if (!selection) return null;
  const properties = (selection.properties || []).slice(0, 80);
  const readiness = twinAsset?.readinessStatus || "Not linked";

  return (
    <aside className="aps-property-inspector" aria-label="Selected object properties">
      <div>
        <span>Object đang chọn</span>
        <strong>{selection.name || `Object ${selection.dbId}`}</strong>
        <small className={`aps-readiness-badge ${readiness.toLowerCase().replace(/\s+/g, "-")}`}>
          {readinessLabel(readiness)}
        </small>
      </div>
      <nav className="aps-property-tabs" aria-label="Property source">
        <button className={activeTab === "source" ? "is-active" : ""} onClick={() => setActiveTab("source")} type="button">
          IFC gốc
        </button>
        <button
          className={activeTab === "normalized" ? "is-active" : ""}
          onClick={() => setActiveTab("normalized")}
          type="button"
        >
          Dữ liệu O&amp;M
        </button>
        <button
          className={activeTab === "validation" ? "is-active" : ""}
          onClick={() => setActiveTab("validation")}
          type="button"
        >
          Lỗi cần xử lý
        </button>
      </nav>

      {twinAsset?.operationalScope === "scope_review" ? (
        <ScopeConfirmation onConfirm={onConfirmScope} twinAsset={twinAsset} />
      ) : null}

      {activeTab === "source" ? (
        <dl>
          <dt>dbId</dt>
          <dd>{selection.dbId}</dd>
          {selection.externalId ? (
            <>
              <dt>External ID</dt>
              <dd>{selection.externalId}</dd>
            </>
          ) : null}
          {properties.map((property, index) => (
            <React.Fragment key={`${property.displayCategory}-${property.displayName}-${index}`}>
              <dt>{property.displayName}</dt>
              <dd>{String(property.displayValue ?? "")}</dd>
            </React.Fragment>
          ))}
        </dl>
      ) : null}

      {activeTab === "normalized" ? (
        twinAsset ? (
          <EditableOmProperties onSave={onSaveAsset} twinAsset={twinAsset} />
        ) : (
          <p className="aps-property-empty">Object này chưa khớp với snapshot theo IFC GlobalId.</p>
        )
      ) : null}

      {activeTab === "validation" ? (
        twinAsset ? (
          <div>
            {twinAsset.operationalScope === "context" ? (
              <p className="aps-property-empty">
                Object được giữ làm bối cảnh 3D và không bị kiểm tra 10 trường vận hành.
              </p>
            ) : twinAsset.validationIssues?.length ? (
              <div className="aps-validation-issues">
                {twinAsset.validationIssues.map((issue, index) => (
                  <article key={`${issue.field}-${issue.error_type}-${index}`}>
                    <span className={String(issue.severity || "").toLowerCase()}>{issue.severity}</span>
                    <strong>{issue.error_type || issue.field}</strong>
                    <p>{issue.suggested_fix}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="aps-property-empty success">Object này đã đủ 10 trường EMSD/VSF.</p>
            )}
            {twinAsset.operationalScope !== "context" ? (
              <div className="aps-similar-assets">
                <button onClick={() => setShowSimilar((value) => !value)} type="button">
                  {showSimilar ? "Ẩn danh sách" : `Xem ${similarAssets.length} object cùng loại đang thiếu`}
                </button>
                {showSimilar ? (
                  <div>
                    {similarAssets.map((asset) => (
                      <button key={asset.ifcGuid} onClick={() => onFocusAsset(asset.ifcGuid)} type="button">
                        <strong>{asset.name || asset.ifcGuid}</strong>
                        <span>Thiếu {missingOmFields(asset).length}/10 trường</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="aps-property-empty">Object IFC này không có trong snapshot validation.</p>
        )
      ) : null}
    </aside>
  );
}

export function ApsViewerApp() {
  const initialQuery = useMemo(readViewerQuery, []);
  const viewerRef = useRef(null);
  const [models, setModels] = useState([]);
  const [selectedUrn, setSelectedUrn] = useState(initialQuery.urn);
  const [modelName, setModelName] = useState(initialQuery.name || "APS model");
  const [externalId, setExternalId] = useState("");
  const [selection, setSelection] = useState(null);
  const [showIncompleteList, setShowIncompleteList] = useState(false);
  const [incompleteListMode, setIncompleteListMode] = useState("operational");
  const [incompleteSearch, setIncompleteSearch] = useState("");
  const [snapshotState, setSnapshotState] = useState({
    status: initialQuery.dataset ? "loading" : "none",
    data: null,
    error: "",
  });
  const [status, setStatus] = useState({
    status: initialQuery.urn ? "Loading" : "Waiting",
    message: initialQuery.urn ? "Preparing APS model..." : "Select a translated model.",
    progress: 0,
  });

  const handleStatusChange = useCallback((nextStatus) => setStatus(nextStatus), []);
  const handleSelectionChange = useCallback((nextSelection) => setSelection(nextSelection), []);
  const twinAssetIndex = useMemo(
    () =>
      new Map(
        (snapshotState.data?.assets || [])
          .filter((asset) => asset.ifcGuid)
          .map((asset) => [normalizeId(asset.ifcGuid), asset]),
      ),
    [snapshotState.data],
  );
  const selectedTwinAsset = useMemo(
    () =>
      selectionIfcIds(selection)
        .map((candidate) => twinAssetIndex.get(normalizeId(candidate)))
        .find(Boolean) || null,
    [selection, twinAssetIndex],
  );
  const similarAssets = useMemo(() => {
    if (!selectedTwinAsset) return [];
    const selectedFamily = familyKey(selectedTwinAsset.name);
    return (snapshotState.data?.assets || []).filter(
      (asset) =>
        asset.ifcGuid !== selectedTwinAsset.ifcGuid &&
        asset.operationalScope !== "context" &&
        familyKey(asset.name) === selectedFamily &&
        missingOmFields(asset).length > 0,
    );
  }, [selectedTwinAsset, snapshotState.data]);
  const incompleteOperationalAssets = useMemo(
    () =>
      (snapshotState.data?.assets || []).filter(
        (asset) =>
          ["maintainable", "realtime"].includes(asset.operationalScope) &&
          (asset.validationIssues || []).length > 0,
      ),
    [snapshotState.data],
  );
  const scopeReviewAssets = useMemo(
    () =>
      (snapshotState.data?.assets || []).filter(
        (asset) => asset.operationalScope === "scope_review",
      ),
    [snapshotState.data],
  );
  const activeIncompleteList =
    incompleteListMode === "scope_review" ? scopeReviewAssets : incompleteOperationalAssets;
  const visibleIncompleteAssets = useMemo(() => {
    const query = incompleteSearch.trim().toLowerCase();
    if (!query) return activeIncompleteList;
    return activeIncompleteList.filter((asset) =>
      [asset.name, asset.ifcGuid, asset.type, asset.operationalScope]
        .some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [activeIncompleteList, incompleteSearch]);

  useEffect(() => {
    if (!initialQuery.dataset) return undefined;
    let cancelled = false;
    setSnapshotState({ status: "loading", data: null, error: "" });
    fetch(`/bim-output/${encodeURIComponent(initialQuery.dataset)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Validated snapshot not found: HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setSnapshotState({ status: "ready", data, error: "" });
      })
      .catch((error) => {
        if (!cancelled) setSnapshotState({ status: "error", data: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [initialQuery.dataset]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/aps/models")
      .then((response) => {
        if (!response.ok) throw new Error(`Cannot list APS models: HTTP ${response.status}`);
        return response.json();
      })
      .then((items) => {
        if (cancelled) return;
        const nextModels = Array.isArray(items) ? items : [];
        setModels(nextModels);
        if (!initialQuery.urn && nextModels[0]) {
          setSelectedUrn(nextModels[0].urn);
          setModelName(nextModels[0].sourceFile);
          updateViewerQuery(nextModels[0], initialQuery.dataset);
        }
      })
      .catch((error) => {
        if (!cancelled && !initialQuery.urn) {
          setStatus({ status: "Error", message: error.message, progress: 0 });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialQuery.dataset, initialQuery.urn]);

  function selectModel(urn) {
    const model = models.find((item) => item.urn === urn);
    setSelection(null);
    setSelectedUrn(urn);
    setModelName(model?.sourceFile || "APS model");
    setStatus({ status: "Loading", message: "Preparing APS model...", progress: 0 });
    updateViewerQuery(model || { urn, sourceFile: "APS model" }, initialQuery.dataset);
  }

  async function focusExternalId(event) {
    event.preventDefault();
    const found = await viewerRef.current?.focusExternalId(externalId.trim());
    if (found) setStatus({ status: "Ready", message: `Focused ${externalId.trim()}`, progress: 100 });
  }

  function clearSelection() {
    viewerRef.current?.clearSelection();
    setSelection(null);
  }

  async function saveTwinAsset(ifcGuid, values, operationalScope = "") {
    if (!initialQuery.dataset) throw new Error("URL chưa có dataset để lưu chỉnh sửa.");
    const response = await fetch(
      `/api/validated-snapshots/${encodeURIComponent(initialQuery.dataset)}/assets/${encodeURIComponent(ifcGuid)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, operationalScope }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Không thể lưu: HTTP ${response.status}`);
    setSnapshotState((current) => ({
      ...current,
      data: {
        ...current.data,
        summary: payload.summary,
        assets: (current.data?.assets || []).map((asset) => (asset.ifcGuid === ifcGuid ? payload.asset : asset)),
      },
    }));
  }

  async function confirmTwinAssetScope(ifcGuid, operationalScope) {
    return saveTwinAsset(ifcGuid, {}, operationalScope);
  }

  async function focusTwinAsset(ifcGuid) {
    const found = await viewerRef.current?.focusExternalId(ifcGuid);
    if (found) setStatus({ status: "Ready", message: `Đã chọn ${ifcGuid}`, progress: 100 });
  }

  async function openIncompleteAsset(asset) {
    setShowIncompleteList(false);
    const found = await viewerRef.current?.focusExternalId(asset.ifcGuid);
    setStatus({
      status: "Ready",
      message: found
        ? `Đang xem ${asset.name || asset.ifcGuid}.`
        : `Không tìm thấy ${asset.ifcGuid} trong mô hình APS.`,
      progress: 100,
    });
  }

  return (
    <main className="aps-viewer-shell">
      <header className="aps-viewer-header">
        <a className="aps-icon-button" href="/" title="Back to Asset Integration map">
          <ArrowLeft size={19} />
        </a>
        <div className="aps-viewer-title">
          <Box size={21} />
          <div>
            <strong>{modelName}</strong>
            <span>Autodesk Platform Services Viewer</span>
          </div>
        </div>

        <label className="aps-model-select">
          <span>Model</span>
          <select onChange={(event) => selectModel(event.target.value)} value={selectedUrn}>
            {!models.some((model) => model.urn === selectedUrn) && selectedUrn ? (
              <option value={selectedUrn}>{modelName}</option>
            ) : null}
            {models.map((model) => (
              <option key={model.urn} value={model.urn}>
                {model.sourceFile}
              </option>
            ))}
          </select>
        </label>

        <form className="aps-external-id-search" onSubmit={focusExternalId}>
          <Search size={16} />
          <input
            aria-label="IFC GUID or external ID"
            onChange={(event) => setExternalId(event.target.value)}
            placeholder="IFC GUID / external ID"
            value={externalId}
          />
          <button disabled={!externalId.trim() || status.status !== "Ready"} title="Focus object" type="submit">
            <Crosshair size={17} />
          </button>
        </form>

        <div className="aps-viewer-actions">
          <button onClick={() => viewerRef.current?.fitModel()} title="Fit model" type="button">
            <Maximize2 size={18} />
          </button>
          <button onClick={clearSelection} title="Clear selection" type="button">
            <Eraser size={18} />
          </button>
        </div>
      </header>

      <div className="aps-viewer-stage">
        {selectedUrn ? (
          <ApsViewerCanvas
            key={selectedUrn}
            onSelectionChange={handleSelectionChange}
            onStatusChange={handleStatusChange}
            ref={viewerRef}
            urn={selectedUrn}
          />
        ) : (
          <div className="aps-viewer-empty">No translated APS model is available.</div>
        )}
        <div className={`aps-viewer-status ${status.status.toLowerCase()}`}>
          <span>{status.status}</span>
          <strong>{status.message}</strong>
          {status.status === "Loading" ? <progress max="100" value={status.progress} /> : null}
        </div>
        {initialQuery.dataset ? (
          <div className={`aps-twin-summary ${snapshotState.status}`}>
            <Database size={16} />
            <div>
              <strong>
                {snapshotState.status === "ready"
                  ? "Digital Twin đã nạp validation"
                  : snapshotState.status === "error"
                    ? "Snapshot unavailable"
                    : "Loading validated data..."}
              </strong>
              <span>
                {snapshotState.status === "ready"
                  ? `${snapshotState.data.summary?.operationalAssetCount || 0} vận hành · ${snapshotState.data.summary?.complete || 0} đủ · ${incompleteOperationalAssets.length} thiếu · ${scopeReviewAssets.length} chờ xác nhận`
                  : snapshotState.error}
              </span>
            </div>
          </div>
        ) : null}
        {snapshotState.status === "ready" ? (
          <div className="aps-incomplete-actions">
            <button
              disabled={!incompleteOperationalAssets.length}
              onClick={() => {
                setIncompleteListMode("operational");
                setIncompleteSearch("");
                setShowIncompleteList(true);
              }}
              type="button"
            >
              <ListFilter size={15} />
              Xem {incompleteOperationalAssets.length} asset vận hành thiếu
            </button>
            <button
              disabled={!scopeReviewAssets.length}
              onClick={() => {
                setIncompleteListMode("scope_review");
                setIncompleteSearch("");
                setShowIncompleteList(true);
              }}
              type="button"
            >
              <ListFilter size={15} />
              Xem {scopeReviewAssets.length} object cần xác nhận
            </button>
          </div>
        ) : null}
        {showIncompleteList ? (
          <aside className="aps-incomplete-list" aria-label="Danh sách kiểm tra dữ liệu vận hành">
            <header>
              <div>
                <strong>
                  {incompleteListMode === "scope_review"
                    ? "Object cần xác nhận phạm vi vận hành"
                    : "Asset vận hành chưa đủ thông tin"}
                </strong>
                <span>
                  Hiển thị {visibleIncompleteAssets.length}/{activeIncompleteList.length} object
                </span>
              </div>
              <button onClick={() => setShowIncompleteList(false)} title="Đóng danh sách" type="button">
                <X size={17} />
              </button>
            </header>
            <label className="aps-incomplete-search">
              <Search size={15} />
              <input
                onChange={(event) => setIncompleteSearch(event.target.value)}
                placeholder="Tìm theo tên, IFC GUID hoặc loại..."
                value={incompleteSearch}
              />
            </label>
            <div className="aps-incomplete-list-body">
              {visibleIncompleteAssets.map((asset) => {
                const missing = missingOmFields(asset);
                return (
                  <button key={asset.ifcGuid} onClick={() => openIncompleteAsset(asset)} type="button">
                    <strong>{asset.name || asset.ifcGuid}</strong>
                    <span>
                      {asset.operationalScope === "scope_review"
                        ? "Cần xác nhận vận hành"
                        : asset.operationalScope === "realtime"
                          ? "Realtime"
                          : "Maintainable"}
                      {" · "}
                      thiếu {missing.length}/10 trường
                    </span>
                    <small>{missing.join(", ")}</small>
                  </button>
                );
              })}
              {!visibleIncompleteAssets.length ? (
                <p>Không tìm thấy object phù hợp với từ khóa.</p>
              ) : null}
            </div>
          </aside>
        ) : null}
        <PropertyInspector
          onConfirmScope={confirmTwinAssetScope}
          onFocusAsset={focusTwinAsset}
          onSaveAsset={saveTwinAsset}
          selection={selection}
          similarAssets={similarAssets}
          twinAsset={selectedTwinAsset}
        />
      </div>
    </main>
  );
}
