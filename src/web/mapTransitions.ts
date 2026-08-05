export interface MapAnchor {
  x: number;
  y: number;
}

export interface MapLayerEntry {
  id: number;
  mode: "zoom" | "double" | "breadcrumb";
  anchor: MapAnchor;
}

export type MapEntryRequest = Omit<MapLayerEntry, "id">;

export interface DetailCamera {
  centerX: number;
  centerY: number;
  zoom: number;
}

export const DETAIL_MAP_WIDTH = 900;
// Keep the same 10:7 projection as the galaxy map so cross-layer anchors
// occupy the same screen position even when the SVG is letterboxed.
export const DETAIL_MAP_HEIGHT = 630;
export const CENTER_ANCHOR: MapAnchor = { x: 0.5, y: 0.5 };
export const LAYER_ZOOM_THRESHOLD = 4;
export const LAYER_EXIT_THRESHOLD = 0.66;
export const MAP_TRANSITION_DURATION_MS = 560;
export const MAP_CONTENT_REVEAL_DELAY_MS = 180;

export function clampAnchor(anchor: MapAnchor): MapAnchor {
  return {
    x: Math.max(0.08, Math.min(0.92, anchor.x)),
    y: Math.max(0.08, Math.min(0.92, anchor.y)),
  };
}

export function cameraForAnchor(
  worldX: number,
  worldY: number,
  anchor: MapAnchor,
  zoom = 1,
): DetailCamera {
  const width = DETAIL_MAP_WIDTH / zoom;
  const height = DETAIL_MAP_HEIGHT / zoom;
  return {
    centerX: worldX + (0.5 - anchor.x) * width,
    centerY: worldY + (0.5 - anchor.y) * height,
    zoom,
  };
}

export function anchorForWorld(
  worldX: number,
  worldY: number,
  camera: DetailCamera,
): MapAnchor {
  const width = DETAIL_MAP_WIDTH / camera.zoom;
  const height = DETAIL_MAP_HEIGHT / camera.zoom;
  return clampAnchor({
    x: (worldX - (camera.centerX - width / 2)) / width,
    y: (worldY - (camera.centerY - height / 2)) / height,
  });
}

export function zoomAround(
  worldX: number,
  worldY: number,
  camera: DetailCamera,
  nextZoom: number,
): DetailCamera {
  const ratio = camera.zoom / nextZoom;
  return {
    centerX: worldX + (camera.centerX - worldX) * ratio,
    centerY: worldY + (camera.centerY - worldY) * ratio,
    zoom: nextZoom,
  };
}

export function detailViewBox(camera: DetailCamera): string {
  const width = DETAIL_MAP_WIDTH / camera.zoom;
  const height = DETAIL_MAP_HEIGHT / camera.zoom;
  return `${camera.centerX - width / 2} ${camera.centerY - height / 2} ${width} ${height}`;
}
