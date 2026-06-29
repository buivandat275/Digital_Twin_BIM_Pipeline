import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const APS_VIEWER_SCRIPT = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js";
const APS_VIEWER_STYLE = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css";

let sdkPromise;

function loadApsViewerSdk() {
  if (window.Autodesk?.Viewing) return Promise.resolve(window.Autodesk);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${APS_VIEWER_STYLE}"]`)) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = APS_VIEWER_STYLE;
      document.head.appendChild(style);
    }

    const existingScript = document.querySelector(`script[src="${APS_VIEWER_SCRIPT}"]`);
    const script = existingScript || document.createElement("script");
    const onLoad = () => {
      if (window.Autodesk?.Viewing) resolve(window.Autodesk);
      else reject(new Error("APS Viewer SDK loaded without Autodesk.Viewing."));
    };
    const onError = () => reject(new Error("Cannot download the APS Viewer SDK."));

    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existingScript) {
      script.src = APS_VIEWER_SCRIPT;
      document.head.appendChild(script);
    }
  });

  return sdkPromise;
}

async function requestViewerToken(onTokenReady) {
  const response = await fetch("/api/aps/token");
  if (!response.ok) throw new Error(`APS token request failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("APS token response is missing access_token.");
  onTokenReady(payload.access_token, Number(payload.expires_in || 3599));
}

function loadDocument(Autodesk, urn) {
  return new Promise((resolve, reject) => {
    Autodesk.Viewing.Document.load(
      `urn:${urn}`,
      resolve,
      (code, message, errors) => reject(new Error(`APS document load failed (${code}): ${message || errors || "Unknown error"}`)),
    );
  });
}

export const ApsViewerCanvas = forwardRef(function ApsViewerCanvas(
  { onSelectionChange, onStatusChange, urn },
  ref,
) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const modelRef = useRef(null);

  useImperativeHandle(ref, () => ({
    clearSelection() {
      viewerRef.current?.clearSelection();
      onSelectionChange?.(null);
    },
    fitModel() {
      viewerRef.current?.fitToView();
    },
    focusExternalId(externalId) {
      const model = modelRef.current;
      const viewer = viewerRef.current;
      if (!model || !viewer || !externalId) return Promise.resolve(false);

      return new Promise((resolve) => {
        model.getExternalIdMapping((mapping) => {
          const normalizedTarget = String(externalId).trim().toLowerCase();
          const directEntry = Object.entries(mapping || {}).find(
            ([candidate]) => String(candidate).trim().toLowerCase() === normalizedTarget,
          );
          if (directEntry) {
            focusDbId(viewer, model, directEntry[1]);
            resolve(true);
            return;
          }

          searchIfcGuid(viewer, externalId)
            .then((dbIds) => {
              const dbId = dbIds[0];
              if (dbId === undefined) {
                onStatusChange?.({
                  status: "Ready",
                  message: `Không tìm thấy IFC GlobalId ${externalId} trong APS properties.`,
                  progress: 100,
                });
                resolve(false);
                return;
              }
              focusDbId(viewer, model, dbId);
              resolve(true);
            })
            .catch(() => resolve(false));
        });
      });
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !urn) return undefined;

    let disposed = false;
    let viewer;
    let geometryHandler;
    let modelReady = false;
    let progressHandler;
    let selectionHandler;

    async function startViewer() {
      try {
        onStatusChange?.({ status: "Loading", message: "Loading APS Viewer SDK...", progress: 5 });
        const Autodesk = await loadApsViewerSdk();
        if (disposed) return;

        await new Promise((resolve) => {
          Autodesk.Viewing.Initializer(
            {
              env: "AutodeskProduction2",
              api: "streamingV2",
              getAccessToken: (onTokenReady) => {
                requestViewerToken(onTokenReady).catch((error) => {
                  onStatusChange?.({ status: "Error", message: error.message, progress: 0 });
                });
              },
            },
            resolve,
          );
        });
        if (disposed) return;

        viewer = new Autodesk.Viewing.GuiViewer3D(container, {
          extensions: ["Autodesk.DocumentBrowser"],
        });
        const startCode = viewer.start();
        if (startCode > 0) throw new Error(`APS Viewer failed to start (code ${startCode}).`);
        viewer.setTheme("light-theme");
        viewerRef.current = viewer;

        progressHandler = (event) => {
          if (modelReady) return;
          onStatusChange?.({
            status: "Loading",
            message: "Streaming translated model...",
            progress: Math.round(event.percent || 0),
          });
        };
        viewer.addEventListener(Autodesk.Viewing.PROGRESS_UPDATE_EVENT, progressHandler);

        geometryHandler = () => {
          modelReady = true;
          viewer.fitToView();
          onStatusChange?.({ status: "Ready", message: "APS model loaded.", progress: 100 });
        };
        viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, geometryHandler);

        selectionHandler = (event) => {
          const dbId = event.dbIdArray?.[0];
          if (dbId === undefined) {
            onSelectionChange?.(null);
            return;
          }
          viewer.getProperties(
            dbId,
            (properties) => onSelectionChange?.(properties),
            () => onSelectionChange?.({ dbId, name: `Object ${dbId}`, properties: [] }),
          );
        };
        viewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, selectionHandler);

        const document = await loadDocument(Autodesk, urn);
        if (disposed) return;
        const viewable = document.getRoot().getDefaultGeometry();
        if (!viewable) throw new Error("The APS document has no 3D viewable.");
        modelRef.current = await viewer.loadDocumentNode(document, viewable);
        if (disposed) return;
        if (viewer.model?.isLoadDone?.()) geometryHandler();
      } catch (error) {
        if (!disposed) {
          onStatusChange?.({ status: "Error", message: error.message || "APS model load failed.", progress: 0 });
        }
      }
    }

    startViewer();

    return () => {
      disposed = true;
      modelRef.current = null;
      viewerRef.current = null;
      if (viewer && window.Autodesk?.Viewing) {
        if (progressHandler) viewer.removeEventListener(window.Autodesk.Viewing.PROGRESS_UPDATE_EVENT, progressHandler);
        if (geometryHandler) viewer.removeEventListener(window.Autodesk.Viewing.GEOMETRY_LOADED_EVENT, geometryHandler);
        if (selectionHandler) viewer.removeEventListener(window.Autodesk.Viewing.SELECTION_CHANGED_EVENT, selectionHandler);
        viewer.finish();
      }
    };
  }, [onSelectionChange, onStatusChange, urn]);

  return <div className="aps-viewer-canvas" ref={containerRef} />;
});

function focusDbId(viewer, model, dbId) {
  viewer.select([dbId], model);
  viewer.fitToView([dbId], model);
}

function searchViewer(viewer, text, attributeNames) {
  return new Promise((resolve) => {
    viewer.search(
      text,
      (dbIds) => resolve(Array.isArray(dbIds) ? dbIds : []),
      () => resolve([]),
      attributeNames,
    );
  });
}

async function searchIfcGuid(viewer, ifcGuid) {
  const propertyNames = [
    "GlobalId",
    "Global ID",
    "IFC GlobalId",
    "IfcGUID",
    "IFC GUID",
    "GUID",
  ];
  const propertyMatches = await searchViewer(viewer, ifcGuid, propertyNames);
  if (propertyMatches.length) return propertyMatches;
  return searchViewer(viewer, ifcGuid);
}
