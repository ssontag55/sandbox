import { Rectangle } from '@mui/icons-material';
import { TOCNode } from '../../CustomTOC/types';
import { GisLayer } from '../types';

export default function buildGisLayerTocNode(gisLayer: GisLayer): TOCNode {
  const value = gisLayer.layer_name;
  let color = 'white';
  let opacity = 1;
  let styleType = 'fill';

  if (gisLayer.layer_style && gisLayer.layer_type != 'WMS Layer') {
    try {
      if (JSON.parse(gisLayer.layer_style).type) {
        styleType = JSON.parse(gisLayer.layer_style).type;
      }
  
      if (JSON.parse(gisLayer.layer_style).paint) {
        if (styleType === 'fill') {
          color = JSON.parse(gisLayer.layer_style).paint['fill-color'];
          opacity = JSON.parse(gisLayer.layer_style).paint['fill-opacity'];
        } else if (styleType === 'line') {
          color = JSON.parse(gisLayer.layer_style).paint['line-color'];
          opacity = JSON.parse(gisLayer.layer_style).paint['line-opacity'];
        } else if (styleType === 'circle') {
          color = JSON.parse(gisLayer.layer_style).paint['circle-color'];
          opacity = JSON.parse(gisLayer.layer_style).paint['circle-opacity'];
        }
      }
    }
    catch(e) {
      console.warn(`Failed to parse GIS Layer styles.`, e);
    }
  }

  return {
    label: value,
    value,
    icon: (
      <Rectangle
        sx={{
          fontSize: '1.6em',
          alignSelf: 'center',
          color,
          opacity,
        }}
      />
    ),
  };
  // }
}
