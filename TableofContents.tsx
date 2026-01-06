import React, { useState } from 'react';
import Card from '@mui/material/Card';
import { Fab, Typography } from '@mui/material';
import ArrowBackIosNewOutlinedIcon from '@mui/icons-material/ArrowBackIosNewOutlined';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import CustomTOC from '../CustomTOC';
import { buildCheckedArray, buildCustomTocNode, buildGisLayerTocNode } from './utils';
import { LegendItems } from './types';

type Props = {
  legendItems: LegendItems;
  toggleVisible: Function;
  toggleExpanded(expanded: string[]): void;
  toggleSetShowML?: Function;
  toggleLeadHexVisibility?: Function;
  showCheckOnDefault: boolean;
} & typeof defaultProps;

const defaultProps = {
  showCheckOnDefault: false,
};

const parseCheckedState = (visibleItems: LegendItems['visible'], keys: LegendItems['keys']) => {
  const visible = Object.keys(visibleItems).filter((key) => visibleItems[key]);
  return buildCheckedArray(keys, visible);
};

const TableOfContents = (props: Props) => {
  const [tabVisible, setTabVisible] = useState(false);

  const customLayers = Object.entries(props.legendItems.keys).map(([value, children]) =>
    buildCustomTocNode(value, props.legendItems.colors, props.showCheckOnDefault ?? false, children)
  );
  
  const visible = props.legendItems.visible || {};
  const serviceMetadata = (props.legendItems as any).serviceMetadata as Map<string, any> | undefined;
  
  // Build nodes - they rebuild when legend loads (for legend updates)
  // The LegendContent component will re-render when layerJson prop changes
  const gisLayers = props.legendItems.gislayers.map((layer) => 
    buildGisLayerTocNode(layer, serviceMetadata?.get(layer.layer_name))
  );
  const nodes = [...customLayers, ...gisLayers];
  
  // Calculate checked array - ensure it includes all visible GIS layers
  const checked = [
    ...parseCheckedState(visible, props.legendItems.keys),
    ...props.legendItems.gislayers
      .filter((layer) => visible[layer.layer_name] === true)
      .map((layer) => layer.layer_name),
  ];
  
  const tocState = {
    nodes: nodes,
    checked: checked,
    expanded: props.legendItems.expanded,
  };

  function handleChecked(nextChecked: string[], checkedItem) {
    const layer = props.legendItems.gislayers.find(
      ({ layer_name }) => layer_name === checkedItem.value
    );
    const isChecked = checkedItem.checked === true;
    props.toggleVisible(checkedItem.value, isChecked, layer, nextChecked);
  }

  function handleExpand(expanded: string[]) {
    props.toggleExpanded(expanded);
    
    // Fetch metadata for expanded GIS layers
    if ((props.legendItems as any).onExpand) {
      expanded.forEach((expandedValue) => {
        const isGisLayer = props.legendItems.gislayers.some(
          (layer) => layer.layer_name === expandedValue
        );
        if (isGisLayer) {
          (props.legendItems as any).onExpand(expandedValue);
        }
      });
    }
  }


  return tabVisible ? (
    <Card className="toc">
      <div style={{ width: '280px',maxHeight: '680px', overflowY: 'auto' }}>
        <CustomTOC
          id="main-toc"
          nodes={tocState.nodes}
          checked={checked}
          expanded={tocState.expanded}
          onCheck={handleChecked}
          onExpand={handleExpand}
          checkModel="all"
        />
        <div
          style={{
            borderTop: '1px solid #e0e0e0',
            marginTop: '8px',
            marginLeft: '24px',
            paddingTop: '8px',
            paddingBottom: '8px',
          }}
        >
          <Typography component="div" variant="caption" sx={{ fontStyle: 'italic', fontWeight: 'normal' }}>
            Please allow a few minutes for your updates to be reflected on the map.
          </Typography>
        </div>
      </div>
      <ArrowBackIosNewOutlinedIcon
        onClick={() => setTabVisible(false)}
        sx={{ cursor: 'pointer', marginTop: '9px', marginLeft: '-9px', zIndex: 10 }}
      />
    </Card>
  ) : (
    <Fab className="map-toc" size="small">
      {/* <FormatListBulletedIcon fontSize="small" onClick={() => setTabVisible(true)} /> */}
      <KeyboardArrowRightIcon onClick={() => setTabVisible(true)} />
    </Fab>
  );
};

export default TableOfContents;
