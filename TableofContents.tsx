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
  const [checkedCustomNodes, setCheckedCustomNodes] = useState<string[]>([]); // TODO: Should be refactored to lift state up into parent

  const customLayers = Object.entries(props.legendItems.keys).map(([value, children]) =>
    buildCustomTocNode(value, props.legendItems.colors, props.showCheckOnDefault ?? false, children)
  );
  const gisLayers = props.legendItems.gislayers.map(buildGisLayerTocNode);
  const nodes = [...customLayers, ...gisLayers].map((node) => node);
  const checked = [
    ...parseCheckedState(props.legendItems.visible, props.legendItems.keys),
    ...checkedCustomNodes,
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
    props.toggleVisible(checkedItem.value, checkedItem.checked, layer, nextChecked);
    // See comment above. All this extra internal "checked" state mgmt is a necessary evil until this component's API can be completely overhauled to manage checked, expanded, and visible state better
    if (layer) {
      const checkedLayer = nextChecked.find((item) => item === layer.layer_name);
      if (checkedLayer) {
        const nextState = [...checkedCustomNodes, checkedLayer];
        setCheckedCustomNodes(nextState);
      } else {
        const nextState = checkedCustomNodes.filter((item) => item !== layer.layer_name);
        setCheckedCustomNodes(nextState);
      }
    }
  }

  return tabVisible ? (
    <Card className="toc">
      <div style={{ width: '280px' }}>
        <CustomTOC
          id="main-toc"
          nodes={tocState.nodes}
          checked={tocState.checked}
          expanded={tocState.expanded}
          onCheck={handleChecked}
          onExpand={(expanded) => props.toggleExpanded(expanded)}
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
