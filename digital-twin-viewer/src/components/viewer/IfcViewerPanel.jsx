import React, { useEffect, useRef, useState } from "react";
import { Maximize2, RotateCcw, X } from "lucide-react";
import { ThatOpenCanvas } from "./ThatOpenCanvas.jsx";

export function IfcViewerPanel({ asset, building, modelFile, open, onClose }) {
  const viewerRef = useRef(null);
  const [viewerState, setViewerState] = useState({
    status: "Idle",
    message: "Select a mapped asset to open the IFC viewer.",
    progress: 0,
  });

  useEffect(() => {
    if (open && asset?.ifcGuid && viewerRef.current) {
      viewerRef.current.locateAsset(asset);
    }
  }, [asset, open]);

  if (!open) return null;

  return (
    <section className="integration-viewer-panel" aria-label="IFC viewer">
      <div className="integration-viewer-toolbar">
        <div>
          <span className={`integration-viewer-state ${viewerState.status.toLowerCase()}`}>
            {viewerState.status}
          </span>
          <strong>{asset?.assetCode || building?.name || "IFC viewer"}</strong>
          <span>{viewerState.message}</span>
        </div>
        <div className="integration-viewer-actions">
          <button aria-label="Fit IFC model" onClick={() => viewerRef.current?.fitModel()} type="button">
            <Maximize2 size={17} />
          </button>
          <button aria-label="Focus selected asset" onClick={() => viewerRef.current?.locateAsset(asset)} type="button">
            <RotateCcw size={17} />
          </button>
          <button aria-label="Close IFC viewer" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
      </div>
      <ThatOpenCanvas asset={asset} modelFile={modelFile} onStateChange={setViewerState} ref={viewerRef} />
    </section>
  );
}
