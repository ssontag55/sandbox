/* 
 * ESRI → Mapbox GL: Style Converter Utilities
 * Converts ESRI renderers to Mapbox GL styles
 */

export interface EsriRenderer {
  type: 'simple' | 'uniqueValue' | 'classBreaks';
  symbol?: any;
  defaultSymbol?: any;
  field1?: string;
  field2?: string;
  field3?: string;
  fieldDelimiter?: string;
  uniqueValueInfos?: Array<{ value: any; symbol: any; label?: string }>;
  field?: string;
  minValue?: number;
  classBreakInfos?: Array<{ minValue?: number; maxValue?: number; classMaxValue?: number; classMinValue?: number; symbol: any; label?: string }>;
}

export interface EsriLayerJson {
  drawingInfo?: {
    renderer?: EsriRenderer;
    visualVariables?: any[];
    labelingInfo?: any[];
  };
  geometryType?: string;
  popupInfo?: any;
}

export function mapboxLayersFromEsriLayer(
  featureLayerJson: EsriLayerJson,
  options: {
    source: string;
    layerIdPrefix?: string;
    addPolygonOutline?: boolean;
  }
) {
  const { drawingInfo = {}, geometryType } = featureLayerJson || {};
  return esriToMbLayers({
    renderer: drawingInfo.renderer,
    visualVariables: drawingInfo.visualVariables,
    labelingInfo: drawingInfo.labelingInfo,
    geometryType,
    ...options,
  });
}

function esriToMbLayers(opts: any) {
  const {
    renderer,
    visualVariables = [],
    geometryType,
    labelingInfo = [],
    source,
    layerIdPrefix = 'esri',
    addPolygonOutline = true,
  } = opts || {};

  if (!renderer) return [];
  if (!geometryType) return [];
  if (!source) return [];

  const common = { source };
  const vv = parseVisualVariables(visualVariables);

  let layers: any[] = [];
  switch (renderer.type) {
    case 'simple':
      layers = buildFromSimpleRenderer({
        renderer,
        geometryType,
        common,
        layerIdPrefix,
        vv,
        addPolygonOutline,
      });
      break;
    case 'uniqueValue':
      layers = buildFromUniqueValue({
        renderer,
        geometryType,
        common,
        layerIdPrefix,
        vv,
        addPolygonOutline,
      });
      break;
    case 'classBreaks':
      layers = buildFromClassBreaks({
        renderer,
        geometryType,
        common,
        layerIdPrefix,
        vv,
        addPolygonOutline,
      });
      break;
    default:
      return [];
  }

  layers.push(
    ...buildLabelLayers({
      labelingInfo,
      geometryType,
      common,
      idBase: `${layerIdPrefix}-labels`,
    })
  );
  return layers;
}

function buildFromSimpleRenderer({ renderer, geometryType, common, layerIdPrefix, vv, addPolygonOutline }: any) {
  const symbol = renderer.symbol;
  const idBase = `${layerIdPrefix}-simple`;
  return buildSymbolLayers({
    idBase,
    geometryType,
    symbol,
    common,
    filter: undefined,
    vv,
    addPolygonOutline,
  });
}

function buildFromUniqueValue({ renderer, geometryType, common, layerIdPrefix, vv, addPolygonOutline }: any) {
  const { field1, field2, field3, fieldDelimiter = ', ', uniqueValueInfos = [] } = renderer;
  const idBase = `${layerIdPrefix}-uv`;
  const layers: any[] = [];

  for (let i = 0; i < uniqueValueInfos.length; i++) {
    const uvi = uniqueValueInfos[i];
    const symbol = uvi.symbol || renderer.defaultSymbol;
    if (!symbol) continue;

    const valParts = (uvi.value ?? '').toString().split(fieldDelimiter);
    const filter = uniqueFilter([field1, field2, field3].filter(Boolean), valParts);

    layers.push(
      ...buildSymbolLayers({
        idBase: `${idBase}-${sanitizeId(uvi.label || `class-${i}`)}`,
        geometryType,
        symbol,
        common,
        filter,
        vv,
        addPolygonOutline,
      })
    );
  }

  if (renderer.defaultSymbol) {
    layers.push(
      ...buildSymbolLayers({
        idBase: `${idBase}-default`,
        geometryType,
        symbol: renderer.defaultSymbol,
        common,
        filter: undefined,
        vv,
        addPolygonOutline,
      })
    );
  }
  return layers;
}

function buildFromClassBreaks({ renderer, geometryType, common, layerIdPrefix, vv, addPolygonOutline }: any) {
  const { field, minValue, classBreakInfos = [] } = renderer;
  const idBase = `${layerIdPrefix}-cb`;
  const layers: any[] = [];

  for (let i = 0; i < classBreakInfos.length; i++) {
    const cbi = classBreakInfos[i];
    const symbol = cbi.symbol || renderer.defaultSymbol;
    if (!symbol) continue;
    
    // ESRI uses classMaxValue, but may also have minValue/maxValue
    // Handle both formats for compatibility
    const classMax = cbi.classMaxValue ?? cbi.maxValue;
    const classMin = cbi.minValue ?? cbi.classMinValue;
    const isLast = i === classBreakInfos.length - 1;
    
    // Determine the min value for this class
    let min: number | undefined;
    if (classMin != null) {
      min = classMin;
    } else if (i === 0) {
      // First class: use renderer minValue or previous classMax
      min = minValue;
    } else {
      // Use the previous class's max value (exclusive)
      const prevClassMax = classBreakInfos[i - 1].classMaxValue ?? classBreakInfos[i - 1].maxValue;
      min = prevClassMax;
    }

    let filter: any;
    if (min != null && classMax != null) {
      // For the first class, use <= for max, for others use > min and <= max
      if (i === 0) {
        filter = ['<=', ['get', field], classMax];
      } else {
        // Use >= to include the boundary value of the previous classMax
        filter = ['all', ['>=', ['get', field], min], [isLast ? '<=' : '<', ['get', field], classMax]];
      }
    } else if (min != null) {
      filter = ['>=', ['get', field], min];
    } else if (classMax != null) {
      filter = [isLast ? '<=' : '<', ['get', field], classMax];
    }

    layers.push(
      ...buildSymbolLayers({
        idBase: `${idBase}-${sanitizeId(cbi.label || `${min ?? 'min'}-${classMax ?? 'max'}`)}`,
        geometryType,
        symbol,
        common,
        filter,
        vv,
        addPolygonOutline,
      })
    );
  }

  if (renderer.defaultSymbol) {
    layers.push(
      ...buildSymbolLayers({
        idBase: `${idBase}-default`,
        geometryType,
        symbol: renderer.defaultSymbol,
        common,
        filter: undefined,
        vv,
        addPolygonOutline,
      })
    );
  }
  return layers;
}

function buildSymbolLayers({ idBase, geometryType, symbol, common, filter, vv, addPolygonOutline }: any) {
  switch (geometryType) {
    case 'esriGeometryPoint':
      return buildPointLayers({ idBase, symbol, common, filter, vv });
    case 'esriGeometryPolyline':
      return [buildLineLayer({ idBase, symbol, common, filter, vv })];
    case 'esriGeometryPolygon':
      return buildPolygonLayers({ idBase, symbol, common, filter, vv, addPolygonOutline });
    default:
      return [];
  }
}

function buildPointLayers({ idBase, symbol, common, filter, vv }: any) {
  if (symbol?.type === 'esriPMS' || symbol?.type === 'picture-marker') {
    const iconName = guessSpriteName(symbol) || 'marker';
    const layout: any = {
      'icon-image': iconName,
      'icon-size': computeIconSize(symbol, vv),
      'icon-allow-overlap': true,
    };
    const paint: any = {};
    const opacity = computeOpacity(symbol, vv);
    if (opacity != null) paint['icon-opacity'] = opacity;
    const layer: any = { id: `${idBase}-symbol`, type: 'symbol', ...common, layout, paint };
    if (filter) layer.filter = filter;
    return [layer];
  }
  const { paint, layout } = simpleMarkerToCirclePaint(symbol || {}, vv);
  const layer: any = { id: `${idBase}-circle`, type: 'circle', ...common, layout, paint };
  if (filter) layer.filter = filter;
  return [layer];
}

function buildLineLayer({ idBase, symbol = {}, common, filter, vv }: any) {
  const paint: any = {};
  const color = pickColor(symbol.color, '#555');
  const width = vv.size?.byValue || symbol.width || 1;
  const opacity = computeOpacity(symbol, vv);
  const dasharray = dashFromSimpleLine(symbol);

  paint['line-color'] = vv.color?.byValue || color;
  paint['line-width'] = width;
  if (dasharray) paint['line-dasharray'] = dasharray;
  if (opacity != null) paint['line-opacity'] = opacity;

  const layout: any = {
    'line-cap': mapLineCap(symbol.cap || symbol.style),
    'line-join': mapLineJoin(symbol.join || 'miter'),
  };
  const layer: any = { id: `${idBase}-line`, type: 'line', ...common, layout, paint };
  if (filter) layer.filter = filter;
  return layer;
}

function buildPolygonLayers({ idBase, symbol = {}, common, filter, vv, addPolygonOutline }: any) {
  const fillColor = pickColor(symbol.color, '#627BC1');
  const outline = symbol.outline || {};
  const strokeColor = pickColor(outline.color, '#4f5e9a');
  const strokeWidth = outline.width ?? 0;
  const fillOpacity = computeOpacity(symbol, vv);

  const fillLayer: any = {
    id: `${idBase}-fill`,
    type: 'fill',
    ...common,
    paint: {
      'fill-color': vv.color?.byValue || fillColor,
      ...(fillOpacity != null ? { 'fill-opacity': fillOpacity } : {}),
    },
  };
  if (filter) fillLayer.filter = filter;

  const layers = [fillLayer];

  if (addPolygonOutline && strokeWidth > 0) {
    const outlineLayer: any = {
      id: `${idBase}-outline`,
      type: 'line',
      ...common,
      paint: { 'line-color': strokeColor, 'line-width': strokeWidth },
    };
    if (filter) outlineLayer.filter = filter;
    layers.push(outlineLayer);
  }

  return layers;
}

function buildLabelLayers({ labelingInfo = [], geometryType, common, idBase = 'labels' }: any) {
  const out: any[] = [];
  if (!Array.isArray(labelingInfo) || labelingInfo.length === 0) return out;

  const lc = labelingInfo.find((c: any) => c && c.visible !== false);
  if (!lc) return out;

  const expr = lc.labelExpressionInfo?.expression || '';
  const field =
    expr.match(/^\s*\[(\w+)\]\s*$/)?.[1] ||
    expr.match(/\$feature\.(\w+)/)?.[1] ||
    'Name';

  const sym = lc.symbol || lc.textSymbol || {};
  const size = sym.size || 12;
  const color = pickColor(sym.color, '#111');
  const haloColor = pickColor(sym.haloColor || sym.outline?.color, 'white');
  const haloWidth = (sym.haloSize || sym.outline?.width || 0) / Math.max(size, 12);
  const isLine = geometryType === 'esriGeometryPolyline';

  out.push({
    id: `${idBase}-0`,
    type: 'symbol',
    ...common,
    layout: {
      'symbol-placement': isLine ? 'line' : 'point',
      'text-field': ['coalesce', ['to-string', ['get', field]], ''],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': size,
      'text-anchor': 'center',
      'text-allow-overlap': false,
      'text-optional': true,
    },
    paint: {
      'text-color': color,
      ...(haloWidth ? { 'text-halo-color': haloColor, 'text-halo-width': haloWidth } : {}),
    },
  });

  return out;
}

// Utility functions
function computeIconSize(symbol: any, vv: any) {
  const width = symbol.width || symbol.size || 24;
  const base = 24;
  const attrScale = vv.size?.byValue || 1;
  return ['coalesce', typeof attrScale === 'number' ? (width / base) * attrScale : attrScale, width / base];
}

function guessSpriteName(symbol: any) {
  const url = symbol.url || symbol.imageData || '';
  const m = (url.match(/([^\/?#]+)(?=\?|#|$)/) || [])[1];
  return m ? m.replace(/\.[a-zA-Z]+$/, '') : 'marker';
}

function simpleMarkerToCirclePaint(symbol: any = {}, vv: any) {
  const fillColor = pickColor(symbol.color, '#3bb2d0');
  const outline = symbol.outline || {};
  const strokeColor = pickColor(outline.color, '#2c8fb8');
  const strokeWidth = outline.width ?? 0;
  const radius = vv.size?.byValue || symbol.size || 6;
  const opacity = computeOpacity(symbol, vv);
  const paint: any = {
    'circle-color': vv.color?.byValue || fillColor,
    'circle-radius': radius,
    'circle-stroke-color': strokeColor,
    'circle-stroke-width': strokeWidth,
  };
  if (opacity != null) paint['circle-opacity'] = opacity;
  return { paint, layout: {} };
}

function dashFromSimpleLine(symbol: any) {
  const style = symbol.style || symbol.type;
  switch (style) {
    case 'esriSLSDash':
    case 'dash':
      return [4, 2];
    case 'esriSLSDot':
    case 'dot':
      return [1, 2];
    case 'esriSLSDashDot':
    case 'dash-dot':
      return [4, 2, 1, 2];
    case 'esriSLSDashDotDot':
    case 'dash-dot-dot':
      return [4, 2, 1, 2, 1, 2];
    default:
      return undefined;
  }
}

function mapLineCap(style: any) {
  const s = (style || '').toLowerCase();
  if (s.includes('round')) return 'round';
  if (s.includes('square')) return 'square';
  return 'butt';
}

function mapLineJoin(style: any) {
  const s = (style || '').toLowerCase();
  if (s.includes('round')) return 'round';
  if (s.includes('bevel')) return 'bevel';
  return 'miter';
}

function pickColor(c: any, fallback = '#000') {
  if (!c) return fallback;
  if (Array.isArray(c)) {
    const [r, g, b, a] = c;
    return a == null || a >= 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }
  if (typeof c === 'string') return c;
  if (typeof c === 'object' && c.r != null) {
    const { r, g, b, a } = c;
    return a == null || a >= 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }
  return fallback;
}

function computeOpacity(symbol: any, vv: any) {
  if (vv.opacity?.byValue != null) return vv.opacity.byValue;
  const c = symbol?.color || symbol?.fillColor || symbol?.outline?.color;
  if (Array.isArray(c) && c.length === 4) return +(c[3] / 255).toFixed(3);
  if (c && typeof c === 'object' && c.a != null) return +(c.a / 255).toFixed(3);
  return undefined;
}

function uniqueFilter(fields: string[], values: any[]) {
  const clauses: any[] = [];
  for (let i = 0; i < fields.length; i++) {
    const fld = fields[i];
    if (!fld) continue;
    const raw = values[i] ?? null;
    const val = normalizeValue(raw);
    clauses.push(['==', ['get', fld], val]);
  }
  if (!clauses.length) return undefined;
  if (clauses.length === 1) return clauses[0];
  return ['all', ...clauses];
}

function normalizeValue(v: any) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : v;
}

function sanitizeId(s: any) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseVisualVariables(_visualVariables?: any[]) {
  return {};
}

/* ------------------------------- Legend Generator ------------------------------ */

export function generateLegendHtml(layerJson: EsriLayerJson & { name?: string }): string | null {
  if (!layerJson || !layerJson.drawingInfo || !layerJson.drawingInfo.renderer) {
    return null;
  }

  const renderer = layerJson.drawingInfo.renderer;
  const geometryType = layerJson.geometryType;
  const items: Array<{ label: string; style: string }> = [];

  switch (renderer.type) {
    case 'simple':
      items.push(createLegendItem(renderer.symbol, 'All features', geometryType));
      break;

    case 'uniqueValue':
      if (renderer.uniqueValueInfos && renderer.uniqueValueInfos.length > 0) {
        for (const uvi of renderer.uniqueValueInfos) {
          const label = uvi.label || String(uvi.value || 'Unnamed');
          items.push(createLegendItem(uvi.symbol || renderer.defaultSymbol, label, geometryType));
        }
      }
      if (renderer.defaultSymbol && renderer.uniqueValueInfos && renderer.uniqueValueInfos.length > 0) {
        items.push(createLegendItem(renderer.defaultSymbol, 'Other', geometryType));
      }
      break;

    case 'classBreaks':
      const { field, minValue, classBreakInfos = [] } = renderer;
      for (let i = 0; i < classBreakInfos.length; i++) {
        const cbi = classBreakInfos[i];
        const symbol = cbi.symbol || renderer.defaultSymbol;
        if (!symbol) continue;

        const classMax = (cbi as any).classMaxValue ?? cbi.maxValue;
        const classMin = cbi.minValue ?? (cbi as any).classMinValue;
        const isLast = i === classBreakInfos.length - 1;

        let min: number | undefined;
        if (classMin != null) {
          min = classMin;
        } else if (i === 0) {
          min = minValue;
        } else {
          const prevClassMax = (classBreakInfos[i - 1] as any).classMaxValue ?? classBreakInfos[i - 1].maxValue;
          min = prevClassMax;
        }

        let label = cbi.label;
        if (!label) {
          if (min != null && classMax != null) {
            label = `${formatNumber(min)} - ${formatNumber(classMax)}`;
          } else if (min != null) {
            label = `${formatNumber(min)}+`;
          } else if (classMax != null) {
            label = `< ${formatNumber(classMax)}`;
          } else {
            label = 'Unnamed';
          }
        }

        items.push(createLegendItem(symbol, label, geometryType));
      }
      if (renderer.defaultSymbol && classBreakInfos.length > 0) {
        items.push(createLegendItem(renderer.defaultSymbol, 'Other', geometryType));
      }
      break;
  }

  if (items.length === 0) return null;

  let html = '<div class="esri-legend" style="background:#fff; padding:12px; border-radius:8px; box-shadow:0 2px 10px rgba(0,0,0,0.15); font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; font-size:13px; max-width:200px;">';
  
  // Add title if available
  if ((layerJson as any).name) {
    html += `<div style="font-weight:600; margin-bottom:8px; color:#1a1a1a; border-bottom:1px solid #e0e0e0; padding-bottom:6px;">${escapeHtml((layerJson as any).name)}</div>`;
  }

  html += '<div style="display:flex; flex-direction:column; gap:6px;">';
  
  for (const item of items) {
    html += '<div style="display:flex; align-items:center; gap:8px;">';
    html += `<div style="${item.style}"></div>`;
    html += `<span style="color:#333; line-height:1.4;">${escapeHtml(item.label)}</span>`;
    html += '</div>';
  }

  html += '</div></div>';
  return html;
}

function createLegendItem(symbol: any, label: string, geometryType?: string): { label: string; style: string } {
  if (!symbol) return { label, style: '' };

  const color = pickColor(symbol.color || symbol.fillColor, '#3bb2d0');
  const outline = symbol.outline || {};
  const strokeColor = pickColor(outline.color, '#2c8fb8');
  const strokeWidth = outline.width ?? 0;

  let style = '';

  switch (geometryType) {
    case 'esriGeometryPoint':
      if (symbol.type === 'esriPMS' || symbol.type === 'picture-marker') {
        // Picture marker - use a small square as placeholder
        style = `width:16px; height:16px; background:${color}; border:1px solid ${strokeColor}; border-radius:2px; flex-shrink:0;`;
      } else {
        // Circle marker
        const size = symbol.size || 6;
        const radius = Math.max(6, Math.min(size, 12));
        style = `width:${radius * 2}px; height:${radius * 2}px; background:${color}; border:${strokeWidth}px solid ${strokeColor}; border-radius:50%; flex-shrink:0;`;
      }
      break;

    case 'esriGeometryPolyline':
      // Line - show as a horizontal line
      const lineWidth = symbol.width || 2;
      style = `width:24px; height:${lineWidth}px; background:${color}; border:none; flex-shrink:0;`;
      if (symbol.style === 'esriSLSDash' || symbol.style === 'dash') {
        style += ` background-image:repeating-linear-gradient(to right, ${color} 0, ${color} 4px, transparent 4px, transparent 8px);`;
      }
      break;

    case 'esriGeometryPolygon':
    default:
      // Polygon - show as a rectangle
      style = `width:20px; height:14px; background:${color}; border:${strokeWidth}px solid ${strokeColor}; flex-shrink:0;`;
      break;
  }

  return { label, style };
}

function formatNumber(n: number | undefined | null): string {
  if (n == null) return '';
  if (typeof n === 'number') {
    // Format with appropriate decimal places
    if (n % 1 === 0) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, '');
  }
  return String(n);
}

function escapeHtml(text: string): string {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
  // Fallback for Node.js environments
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

