import React from 'react';
import { TOCNode } from '../../CustomTOC/types';
import { GisLayer } from '../types';
import { LegendContent } from './LegendContent';

// Rectangle icon component for layer color
const Rectangle = ({ color, opacity }: { color: string; opacity: number }) => (
  <div
    style={{
      width: '16px',
      height: '16px',
      backgroundColor: color,
      opacity: opacity,
      border: '1px solid #ccc',
      marginRight: '8px',
      display: 'inline-block',
      verticalAlign: 'middle',
    }}
  />
);

export default function buildGisLayerTocNode(gisLayer: GisLayer, layerJson?: any): TOCNode {
  const value = gisLayer.layer_name;
  let color = 'white';
  let opacity = 1;
  let styleType = 'fill';

  // Parse layer_style for non-ArcGIS layers
  if (gisLayer.layer_style && gisLayer.layer_type !== 'WMS Layer') {
    try {
      const style = JSON.parse(gisLayer.layer_style);
      if (style.type) {
        styleType = style.type;
      }
      if (style.paint) {
        if (styleType === 'fill') {
          color = style.paint['fill-color'] || color;
          opacity = style.paint['fill-opacity'] ?? opacity;
        } else if (styleType === 'line') {
          color = style.paint['line-color'] || color;
          opacity = style.paint['line-opacity'] ?? opacity;
        } else if (styleType === 'circle') {
          color = style.paint['circle-color'] || color;
          opacity = style.paint['circle-opacity'] ?? opacity;
        }
      }
    } catch (e) {
      console.warn(`Failed to parse GIS Layer styles.`, e);
    }
  }

  const isFeatureServer = /FeatureServer/i.test(gisLayer.layer_url || '');
  const isMapServer = /\/MapServer(\/\d+)?$/i.test(gisLayer.layer_url || '') && !/FeatureServer/i.test(gisLayer.layer_url || '');
  const isArcGIS = isFeatureServer || isMapServer;
  
  // FeatureServer: add legend as child, no icon
  // Use component so node structure stays stable, content updates via React rendering
  if (isFeatureServer) {
    return {
      label: value,
      value,
      // No icon for ArcGIS layers
      children: [
        {
          label: <LegendContent layerName={value} layerJson={layerJson} />,
          value: `${value}_legend`,
          showCheckbox: false,
        }
      ],
    };
  }

  // MapServer: no children, no icon
  if (isMapServer) {
    return {
      label: value,
      value,
      // No icon for ArcGIS layers
    };
  }

  // Other GIS layers: keep icon
  return {
    label: value,
    value,
    icon: <Rectangle color={color} opacity={opacity} />,
  };
}
