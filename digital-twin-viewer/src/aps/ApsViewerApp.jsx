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
    modelId: params.get("modelId") || "",
  };
}

function updateViewerQuery(model, modelId) {
  const params = new URLSearchParams();
  if (model?.urn) params.set("urn", model.urn);
  if (model?.sourceFile) params.set("name", model.sourceFile);
  if (modelId) params.set("modelId", modelId);
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

function EditableOmProperties({ twinAsset, onApprove, onReject, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [pendingChange, setPendingChange] = useState(null);
  const [saveState, setSaveState] = useState({ status: "idle", message: "" });

  useEffect(() => {
    setDraft(Object.fromEntries(OM_FIELD_NAMES.map((field) => [field, twinAsset?.normalizedProperties?.[field] || ""])));
    setEditing(false);
    setPendingChange(null);
    setSaveState({ status: "idle", message: "" });
  }, [twinAsset?.ifcGuid, twinAsset?.rowVersion]);

  async function saveChanges() {
    setSaveState({ status: "saving", message: "Đang lưu..." });
    try {
      const change = await onSave(twinAsset, draft);
      setPendingChange(change);
      setSaveState({ status: "saved", message: "Đã lưu bản nháp. Hãy xác nhận trước khi áp dụng." });
    } catch (error) {
      setSaveState({ status: "error", message: error.message });
    }
  }

  async function decide(action) {
    setSaveState({ status: "saving", message: action === "approve" ? "Đang áp dụng..." : "Đang từ chối..." });
    try {
      if (action === "approve") await onApprove(pendingChange.id);
      else await onReject(pendingChange.id);
      setPendingChange(null);
      setEditing(false);
      setSaveState({
        status: "saved",
        message: action === "approve" ? "Đã xác nhận áp dụng và chạy lại validation." : "Đã từ chối bản nháp.",
      });
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
        {pendingChange ? (
          <>
            <button disabled={saveState.status === "saving"} onClick={() => decide("approve")} type="button">
              <Save size={14} /> Xác nhận áp dụng
            </button>
            <button disabled={saveState.status === "saving"} onClick={() => decide("reject")} type="button">
              <X size={14} /> Từ chối
            </button>
          </>
        ) : (
          <>
            <button disabled={saveState.status === "saving"} onClick={saveChanges} type="button">
              <Save size={14} /> Lưu bản nháp
            </button>
            <button onClick={() => setEditing(false)} type="button">
              <X size={14} /> Hủy
            </button>
          </>
        )}
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
  onApproveChange,
  onConfirmScope,
  onFocusAsset,
  onRejectChange,
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
          <EditableOmProperties
            onApprove={onApproveChange}
            onReject={onRejectChange}
            onSave={onSaveAsset}
            twinAsset={twinAsset}
          />
        ) : (
          <p className="aps-property-empty">Object này chưa khớp với database theo IFC GlobalId.</p>
        )
      ) : null}

      {activeTab === "validation" ? (
        twinAsset ? (
          <div>
            {twinAsset.operationalScope === "context" ? (
              <p className="aps-property-empty">
                Object được giữ làm bối cảnh 3D và không bị kiểm tra 10 trường vận hành.
              </p>
            ) : twinAsset.operationalScope === "scope_review" ? (
              <p className="aps-property-empty">
                Hãy xác nhận object có thuộc vận hành trước khi đánh giá đủ/thiếu 10 trường O&amp;M.
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
            {["maintainable", "realtime"].includes(twinAsset.operationalScope) ? (
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
          <p className="aps-property-empty">Object IFC này không có trong database validation.</p>
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
  const [actorName, setActorName] = useState(() => window.localStorage.getItem("digitalTwinActorName") || "");
  const [showIncompleteList, setShowIncompleteList] = useState(false);
  const [incompleteListMode, setIncompleteListMode] = useState("operational");
  const [incompleteSearch, setIncompleteSearch] = useState("");
  const [snapshotState, setSnapshotState] = useState({
    status: initialQuery.modelId ? "loading" : "none",
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
  const selectedIfcGuid = useMemo(
    () =>
      selectionIfcIds(selection)
        .map((candidate) => twinAssetIndex.get(normalizeId(candidate))?.ifcGuid)
        .find(Boolean) || "",
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
    if (!initialQuery.modelId) return undefined;
    let cancelled = false;
    setSnapshotState({ status: "loading", data: null, error: "" });
    Promise.all([
      fetch(`/api/v1/models/${encodeURIComponent(initialQuery.modelId)}/viewer-summary`),
      fetch(`/api/v1/models/${encodeURIComponent(initialQuery.modelId)}/assets?limit=50000`),
    ])
      .then(async ([summaryResponse, assetsResponse]) => {
        if (!summaryResponse.ok) throw new Error(`Không tải được tổng hợp database: HTTP ${summaryResponse.status}`);
        if (!assetsResponse.ok) throw new Error(`Không tải được asset database: HTTP ${assetsResponse.status}`);
        return [await summaryResponse.json(), await assetsResponse.json()];
      })
      .then(([summaryPayload, assetsPayload]) => {
        if (!cancelled) {
          setSnapshotState({
            status: "ready",
            data: { summary: summaryPayload.summary, model: summaryPayload.model, assets: assetsPayload.items || [] },
            error: "",
          });
        }
      })
      .catch((error) => {
        if (!cancelled) setSnapshotState({ status: "error", data: null, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [initialQuery.modelId]);

  useEffect(() => {
    if (!initialQuery.modelId || !selectedIfcGuid) return undefined;
    let cancelled = false;
    fetch(
      `/api/v1/models/${encodeURIComponent(initialQuery.modelId)}/assets/by-ifc-guid/${encodeURIComponent(selectedIfcGuid)}`,
    )
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`);
        return payload;
      })
      .then((asset) => {
        if (cancelled) return;
        setSnapshotState((current) => ({
          ...current,
          data: {
            ...current.data,
            assets: (current.data?.assets || []).map((item) => (item.ifcGuid === asset.ifcGuid ? asset : item)),
          },
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialQuery.modelId, selectedIfcGuid]);

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
          updateViewerQuery(nextModels[0], initialQuery.modelId);
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
  }, [initialQuery.modelId, initialQuery.urn]);

  function selectModel(urn) {
    const model = models.find((item) => item.urn === urn);
    setSelection(null);
    setSelectedUrn(urn);
    setModelName(model?.sourceFile || "APS model");
    setStatus({ status: "Loading", message: "Preparing APS model...", progress: 0 });
    updateViewerQuery(model || { urn, sourceFile: "APS model" }, initialQuery.modelId);
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

  function mutationHeaders() {
    const actor = actorName.trim();
    if (!actor) throw new Error("Hãy nhập tên người thao tác trước khi lưu để ghi audit.");
    window.localStorage.setItem("digitalTwinActorName", actor);
    return {
      "Content-Type": "application/json",
      "X-Actor-Name": encodeURIComponent(actor),
      "X-Request-ID": `aps-viewer-${crypto.randomUUID()}`,
    };
  }

  async function refreshSummary() {
    const response = await fetch(`/api/v1/models/${encodeURIComponent(initialQuery.modelId)}/viewer-summary`);
    if (!response.ok) return;
    const payload = await response.json();
    setSnapshotState((current) => ({
      ...current,
      data: { ...current.data, summary: payload.summary },
    }));
  }

  function replaceTwinAsset(asset) {
    setSnapshotState((current) => ({
      ...current,
      data: {
        ...current.data,
        assets: (current.data?.assets || []).map((item) => (item.ifcGuid === asset.ifcGuid ? asset : item)),
      },
    }));
  }

  async function saveTwinAsset(twinAsset, values, operationalScope = "") {
    if (!initialQuery.modelId) throw new Error("URL chưa có modelId để lưu chỉnh sửa.");
    const response = await fetch(
      `/api/v1/assets/${encodeURIComponent(twinAsset.id)}/changes`,
      {
        method: "POST",
        headers: mutationHeaders(),
        body: JSON.stringify({
          base_version: twinAsset.rowVersion,
          patch: { values, ...(operationalScope ? { operationalScope } : {}) },
          source: "aps_viewer",
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Không thể lưu bản nháp: HTTP ${response.status}`);
    return payload;
  }

  async function decideChange(changeId, action) {
    const response = await fetch(`/api/v1/change-requests/${encodeURIComponent(changeId)}/${action}`, {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ source: "aps_viewer" }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || `Không thể ${action}: HTTP ${response.status}`);
    if (payload.asset) {
      replaceTwinAsset(payload.asset);
      await refreshSummary();
    }
    return payload;
  }

  async function confirmTwinAssetScope(ifcGuid, operationalScope) {
    const asset = twinAssetIndex.get(normalizeId(ifcGuid));
    if (!asset) throw new Error("Không tìm thấy asset trong database.");
    const change = await saveTwinAsset(asset, {}, operationalScope);
    return decideChange(change.id, "approve");
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
          <input
            aria-label="Tên người thao tác"
            onBlur={() => window.localStorage.setItem("digitalTwinActorName", actorName.trim())}
            onChange={(event) => setActorName(event.target.value)}
            placeholder="Tên người thao tác"
            title="Tên được ghi vào audit"
            value={actorName}
          />
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
        {initialQuery.modelId ? (
          <div className={`aps-twin-summary ${snapshotState.status}`}>
            <Database size={16} />
            <div>
              <strong>
                {snapshotState.status === "ready"
                  ? "Digital Twin đã kết nối PostgreSQL"
                  : snapshotState.status === "error"
                    ? "Database unavailable"
                    : "Đang tải dữ liệu validation..."}
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
                      {asset.operationalScope === "scope_review" ? "" : ` · thiếu ${missing.length}/10 trường`}
                    </span>
                    <small>
                      {asset.operationalScope === "scope_review"
                        ? asset.scopeReason || "Chưa có quyết định phạm vi"
                        : missing.join(", ")}
                    </small>
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
          onApproveChange={(changeId) => decideChange(changeId, "approve")}
          onConfirmScope={confirmTwinAssetScope}
          onFocusAsset={focusTwinAsset}
          onRejectChange={(changeId) => decideChange(changeId, "reject")}
          onSaveAsset={saveTwinAsset}
          selection={selection}
          similarAssets={similarAssets}
          twinAsset={selectedTwinAsset}
        />
      </div>
    </main>
  );
}
