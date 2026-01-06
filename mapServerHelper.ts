/**
 * MapServer Helper Utilities
 * Functions for adding and querying ESRI MapServer layers
 */

import MapboxGL from 'mapbox-gl';

/**
 * Convert lat/lng to Web Mercator (EPSG:3857 / 102100)
 */
export function latLngToWebMercator(lng: number, lat: number): { x: number; y: number } {
  const x = lng * 20037508.34 / 180;
  let y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  y = y * 20037508.34 / 180;
  return { x, y };
}

/**
 * Create an envelope (bounding box) around a point in Web Mercator
 */
export function createEnvelopeAroundPoint(x: number, y: number, tolerance: number = 100) {
  return {
    xmin: x - tolerance,
    ymin: y - tolerance,
    xmax: x + tolerance,
    ymax: y + tolerance
  };
}

/**
 * Add an ESRI MapServer as a raster tile layer
 */
export function addMapServerRaster(
  cMap: MapboxGL.Map,
  msUrl: string,
  layerId: string,
  token: string | null = null
): void {
  // Check if already exists
  if (cMap.getLayer(layerId) && cMap.getSource(layerId)) {
    return; // Already added, skip
  }

  const rawUrl = String(msUrl).replace(/\/+$/, '');
  // Detect if a specific layer is referenced (/MapServer/27)
  const layerMatch = rawUrl.match(/\/MapServer\/(\d+)$/i);
  const baseUrl = layerMatch ? rawUrl.replace(/\/\d+$/, '') : rawUrl;
  const layerParam = layerMatch ? `&layers=show:${layerMatch[1]}` : '';
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const tileTemplate =
    `${baseUrl}/export` +
    '?bbox={bbox-epsg-3857}' +
    '&bboxSR=3857&imageSR=3857' +
    '&size=256,256&format=png&transparent=true&f=image' +
    layerParam +
    tokenParam;

  // Remove existing if same id (clean up any partial state)
  if (cMap.getLayer(layerId)) {
    try { cMap.removeLayer(layerId); } catch {}
  }
  if (cMap.getSource(layerId)) {
    try { cMap.removeSource(layerId); } catch {}
  }

  // Wait for map to be ready
  if (!cMap.isStyleLoaded()) {
    cMap.once('styledata', () => {
      addMapServerRaster(cMap, msUrl, layerId, token);
    });
    return;
  }

  try {
    cMap.addSource(layerId, {
      type: 'raster',
      tiles: [tileTemplate],
      tileSize: 256
    });

    cMap.addLayer({
      id: layerId,
      type: 'raster',
      source: layerId,
      paint: {}
    });
  } catch (error) {
    console.error(`Failed to add MapServer layer ${layerId}:`, error);
  }
}

/**
 * Query a MapServer layer at a specific point
 */
export async function queryMapServer(
  msUrl: string,
  lng: number,
  lat: number,
  token: string | null = null
): Promise<{ features: any[]; error?: any }> {
  // Convert lat/lng to Web Mercator
  const { x, y } = latLngToWebMercator(lng, lat);
  
  // Create envelope around click point
  const envelope = createEnvelopeAroundPoint(x, y, 100);
  
  // Get MapServer layer ID if specified in URL
  const layerMatch = msUrl.match(/\/MapServer\/(\d+)$/i);
  const msLayerId = layerMatch ? layerMatch[1] : null;
  const baseUrl = layerMatch 
    ? msUrl.replace(/\/\d+$/, '') 
    : msUrl.replace(/\/+$/, '');
  
  // Build query URL
  const queryUrl = msLayerId !== null 
    ? `${baseUrl}/${msLayerId}/query`
    : `${baseUrl}/query`;
  
  const params = new URLSearchParams({
    f: 'json',
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: '102100',
    outSR: '102100',
    outFields: '*'
  });
  
  if (token && typeof token === 'string' && token.trim() !== '') {
    params.append('token', token);
  }
  
  const response = await fetch(`${queryUrl}?${params.toString()}`);
  const data = await response.json();
  
  if (data.error) {
    return { features: [], error: data.error };
  }
  
  return { features: data.features || [] };
}

/**
 * Check if an error is an authentication error
 */
export function isAuthError(error: any): boolean {
  if (!error) return false;
  
  const errorCode = error.code;
  const errorMsg = (error.message || '').toLowerCase();
  
  return (
    errorCode === 498 || // Invalid Token
    errorCode === 499 || // Token Required
    (errorCode === 400 && (
      /token/i.test(errorMsg) ||
      /authentication/i.test(errorMsg) ||
      /login/i.test(errorMsg) ||
      /credential/i.test(errorMsg)
    ))
  );
}

