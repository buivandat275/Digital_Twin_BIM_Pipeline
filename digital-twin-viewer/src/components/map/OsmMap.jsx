import React, { useEffect, useMemo, useRef, useState } from "react";
import { Building2, LocateFixed, MapPin, Minus, Plus } from "lucide-react";

const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
const EARTH_RADIUS_M = 6371000;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function latLonToWorld(latitude, longitude, zoom) {
  const sinLat = Math.sin((latitude * Math.PI) / 180);
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function normalizeLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function worldToLatLon(point, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = normalizeLongitude((point.x / scale) * 360 - 180);
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const latitude = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return {
    latitude: clamp(latitude, -85.0511, 85.0511),
    longitude,
  };
}

function tileUrl(template, z, x, y) {
  return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 900, height: 520 });

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({
        width: Math.max(rect.width, 320),
        height: Math.max(rect.height, 320),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

export function OsmMap({
  config,
  center,
  zoom,
  buildingMarkers,
  assetMarkers,
  selectedBuildingId,
  selectedAssetId,
  highlightedAssetIds,
  searchCircle,
  onCenterChange,
  onZoomChange,
  onSelectBuilding,
  onSelectAsset,
}) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const size = useElementSize(frameRef);
  const [isDragging, setIsDragging] = useState(false);
  const activeZoom = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
  const activeCenter = center || config.center;

  const projected = useMemo(() => {
    const centerWorld = latLonToWorld(activeCenter.latitude, activeCenter.longitude, activeZoom);
    const topLeft = {
      x: centerWorld.x - size.width / 2,
      y: centerWorld.y - size.height / 2,
    };
    const minTileX = Math.floor(topLeft.x / TILE_SIZE);
    const maxTileX = Math.floor((topLeft.x + size.width) / TILE_SIZE);
    const minTileY = Math.floor(topLeft.y / TILE_SIZE);
    const maxTileY = Math.floor((topLeft.y + size.height) / TILE_SIZE);
    const tileCount = 2 ** activeZoom;
    const tiles = [];

    for (let x = minTileX; x <= maxTileX; x += 1) {
      for (let y = minTileY; y <= maxTileY; y += 1) {
        if (y < 0 || y >= tileCount) continue;
        const wrappedX = ((x % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${activeZoom}-${x}-${y}`,
          url: tileUrl(config.tileUrl, activeZoom, wrappedX, y),
          left: x * TILE_SIZE - topLeft.x,
          top: y * TILE_SIZE - topLeft.y,
        });
      }
    }

    const pointFor = (item) => {
      const world = latLonToWorld(item.latitude, item.longitude, activeZoom);
      return {
        ...item,
        left: world.x - topLeft.x,
        top: world.y - topLeft.y,
      };
    };

    const polygonFor = (geometry) => {
      if (!geometry?.coordinates?.[0]) return "";
      return geometry.coordinates[0]
        .map(([longitude, latitude]) => {
          const world = latLonToWorld(latitude, longitude, activeZoom);
          return `${world.x - topLeft.x},${world.y - topLeft.y}`;
        })
        .join(" ");
    };

    const circleFor = (circle) => {
      if (!circle || !Number.isFinite(Number(circle.latitude)) || !Number.isFinite(Number(circle.longitude))) return null;
      const centerPoint = pointFor({
        latitude: Number(circle.latitude),
        longitude: Number(circle.longitude),
      });
      const latitudeRad = (Number(circle.latitude) * Math.PI) / 180;
      const deltaLongitude = (Number(circle.radiusMeters || 0) / (EARTH_RADIUS_M * Math.max(0.1, Math.cos(latitudeRad)))) * (180 / Math.PI);
      const edgeWorld = latLonToWorld(Number(circle.latitude), Number(circle.longitude) + deltaLongitude, activeZoom);
      return {
        ...circle,
        left: centerPoint.left,
        top: centerPoint.top,
        radius: Math.max(6, Math.abs(edgeWorld.x - (topLeft.x + centerPoint.left))),
      };
    };

    return {
      tiles,
      buildings: buildingMarkers.map((marker) => ({
        ...pointFor(marker),
        polygon: polygonFor(marker.geometry),
      })),
      assets: assetMarkers.map(pointFor),
      searchCircle: circleFor(searchCircle),
    };
  }, [activeCenter.latitude, activeCenter.longitude, activeZoom, assetMarkers, buildingMarkers, config.tileUrl, searchCircle, size]);

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      centerWorld: latLonToWorld(activeCenter.latitude, activeCenter.longitude, activeZoom),
    };
    frame.setPointerCapture?.(event.pointerId);
    setIsDragging(true);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const nextCenter = worldToLatLon(
      {
        x: drag.centerWorld.x - dx,
        y: drag.centerWorld.y - dy,
      },
      activeZoom,
    );
    onCenterChange?.(nextCenter);
  }

  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    frameRef.current?.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setIsDragging(false);
  }

  function handleWheel(event) {
    event.preventDefault();
    const nextZoom = clamp(activeZoom + (event.deltaY < 0 ? 1 : -1), MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === activeZoom) return;

    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) {
      onZoomChange(nextZoom);
      return;
    }

    const cursor = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    const centerWorld = latLonToWorld(activeCenter.latitude, activeCenter.longitude, activeZoom);
    const topLeft = {
      x: centerWorld.x - size.width / 2,
      y: centerWorld.y - size.height / 2,
    };
    const cursorLatLon = worldToLatLon(
      {
        x: topLeft.x + cursor.x,
        y: topLeft.y + cursor.y,
      },
      activeZoom,
    );
    const pinnedWorld = latLonToWorld(cursorLatLon.latitude, cursorLatLon.longitude, nextZoom);
    const nextCenter = worldToLatLon(
      {
        x: pinnedWorld.x - (cursor.x - size.width / 2),
        y: pinnedWorld.y - (cursor.y - size.height / 2),
      },
      nextZoom,
    );
    onZoomChange(nextZoom);
    onCenterChange?.(nextCenter);
  }

  function resetMapView() {
    onZoomChange(config.zoom);
    onCenterChange?.(config.center);
  }

  return (
    <section className="integration-map-panel" aria-label="Asset integration map">
      <div
        className={`integration-map-frame ${isDragging ? "is-dragging" : ""}`}
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onWheel={handleWheel}
        ref={frameRef}
      >
        {projected.tiles.map((tile) => (
          <img
            alt=""
            className="integration-map-tile"
            draggable="false"
            key={tile.key}
            src={tile.url}
            style={{ left: tile.left, top: tile.top }}
          />
        ))}

        <svg className="integration-map-overlay" aria-hidden="true">
          {projected.searchCircle ? (
            <circle
              className="integration-map-search-radius"
              cx={projected.searchCircle.left}
              cy={projected.searchCircle.top}
              r={projected.searchCircle.radius}
            />
          ) : null}
          {projected.buildings
            .filter((marker) => marker.polygon)
            .map((marker) => (
              <polygon
                className={marker.id === selectedBuildingId ? "is-active" : ""}
                key={marker.id}
                points={marker.polygon}
              />
            ))}
        </svg>

        {projected.buildings.map((marker) => (
          <button
            aria-label={`Select building ${marker.label}`}
            className={`integration-map-marker building ${marker.id === selectedBuildingId ? "is-active" : ""}`}
            key={marker.id}
            onClick={() => onSelectBuilding(marker.data)}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left: marker.left, top: marker.top }}
            type="button"
          >
            <Building2 size={17} />
          </button>
        ))}

        {projected.assets.map((marker) => (
          <button
            aria-label={`Select asset ${marker.label}`}
            className={[
              "integration-map-marker asset",
              marker.coordinateSource === "building-inherited" ? "is-inherited-location" : "",
              highlightedAssetIds?.has(marker.id) ? "is-spatial-result" : "",
              marker.id === selectedAssetId ? "is-active" : "",
            ].filter(Boolean).join(" ")}
            key={marker.id}
            onClick={() => onSelectAsset(marker.data)}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ left: marker.left, top: marker.top }}
            title={`${marker.label} · ${marker.coordinateSource === "building-inherited" ? "shown at building location" : "trusted GPS"}`}
            type="button"
          >
            <MapPin size={15} />
          </button>
        ))}

        <div className="integration-map-controls" aria-label="Map controls">
          <button aria-label="Zoom in" onClick={() => onZoomChange(clamp(activeZoom + 1, MIN_ZOOM, MAX_ZOOM))} type="button">
            <Plus size={16} />
          </button>
          <button aria-label="Zoom out" onClick={() => onZoomChange(clamp(activeZoom - 1, MIN_ZOOM, MAX_ZOOM))} type="button">
            <Minus size={16} />
          </button>
          <button aria-label="Reset map view" onClick={resetMapView} type="button">
            <LocateFixed size={16} />
          </button>
        </div>

        <div className="integration-map-legend" aria-label="Map legend">
          <span><i className="building" /> Building / site</span>
          <span><i className="asset" /> Asset GPS</span>
          <span><i className="inherited" /> Asset at building</span>
          <span><i className="spatial" /> Spatial result</span>
          <span><i className="active" /> Selected item</span>
        </div>

        <div className="integration-map-attribution">{config.attribution}</div>
      </div>
    </section>
  );
}
