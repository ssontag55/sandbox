import { H3HexagonLayer, MVTLayer } from '@deck.gl/geo-layers';
import { IconLayer } from '@deck.gl/layers';

import DeckGL from '@deck.gl/react';

import { HighlightAlt, HighlightOff } from '@mui/icons-material';
import { Box, Fab, Typography } from '@mui/material';
import { SxProps } from '@mui/system';
import { SelectionLayer } from '@nebula.gl/layers';
import FEATURE_FLAGS from 'config/featureFlags';
import { DataContext } from 'context/DataContext';

import { ThemeContext } from 'context/themes';
import { productColors } from 'context/themes/BaseTheme/Colors';
import { UserContext } from 'context/UserContext';
import { LinearInterpolator } from 'deck.gl';
import useCASTFlags from 'hooks/useCASTFlags';
import MapboxGL from 'mapbox-gl';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';

import { _MapContext as MapContext, Popup, StaticMap } from 'react-map-gl';
// Only used to keep consistent with the table's loader (which is rsuite)
import { Loader } from 'rsuite';
import { formatToKebabCase } from '../../../utils/helpers';
import { LayerTypes } from './useLayerConfigurations';
import { BaseMapSelector } from '../BaseMapSelector';

import FeatureService from '../FeatureService';

import { DataSearch } from '../Search/DataSearch';
import TableOfContents, { buildChildValue } from '../TableOfContents';
import GeolocateButton from './GeolocateButton';

const basemapURL = 'https://basemaps-api.arcgis.com/arcgis/rest/services/styles';
const ESRI_TOKEN = process.env.NEXT_PUBLIC_ESRI_API_KEY;
const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

export type CASTMapProps = {
  loading: boolean;
  layerData: any;
  toc?: {
    /*
        keys can be:
            { 'title': ['item'] },
        or  { 'title': { 'subtitle': ['item'] } }
    */
    keys: Record<string, string[] | Record<string, string[]>>;
    expanded: string[];
    visible: Record<string, boolean>;
    onToggleVisible: Record<string, any>;
    onToggleExpanded(expanded: string[]): void;
    showCheckboxOnDefault: boolean;
    defaultVisibleLayers: Record<string, boolean>;
    extendedColors?: Record<string, any>;
  };
  onMapSearch?: (any) => any; // DataSearch holdover
  onViewStateChange?: (any) => any;
  disableSearch?: boolean;
  disableGeolocate?: boolean;
  disableMultiselect?: boolean;
  enableCustomGISLayers?: boolean;
  onMultiselect?: (any) => any;
  multiSelectEnabledLayers?: string[];
  minSearchInputLength?: number;
  customOnMapPointClick?: (any) => void;
  onMapSearchSelection?: (any) => any; // More DataSearch holdover
  popup?: React.FC;
  tooltip?: React.FC;
  onTooltipUnmount?: (any) => Promise<void> | void;
  geoLocateButtonStyle?: SxProps;
};

export const CASTMap: React.FC<CASTMapProps> = (props: CASTMapProps) => {
  const mapRef = useRef<{ getMap: () => MapboxGL.Map }>(undefined);
  const flags = useCASTFlags([FEATURE_FLAGS.ARCGIS_BASEMAPS]);
  const useArcGISBasemap = flags.arcgis_basemaps.enabled;

  /*
        the mapview state currently resides in the userContext. In the future
        it may be best to move this into this component.
    */
  const userContext = useContext(UserContext);
  const { minSearchInputLength = 3 } = props;

  const dataContext = useContext(DataContext);

  let customLayerList;

  if (dataContext) {
    customLayerList = dataContext.layerList;
  }

  let displayedCustomLayerList = [];
  if (customLayerList && customLayerList !== 'error') {
    displayedCustomLayerList = customLayerList.filter((layerList) => layerList.enabled);
  }

  // Theme and colors
  const themeContext = useContext(ThemeContext);
  const colors = themeContext.isLightTheme ? productColors.light : productColors.dark;

  // States
  const [popupInfo, setPopupInfo] = useState(null);
  const [userCoordinates, setUserCoordinates] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [isMultiSelecting, setIsMultiSelecting] = useState(false);
  const [hoverInfo, setHoverInfo] = useState(null);

  const initialBasemap = useArcGISBasemap
    ? `${basemapURL}/ArcGIS:LightGray?type=style&token=${ESRI_TOKEN}`
    : 'mapbox://styles/mapbox/light-v10';
  const [basemap, setBasemap] = useState(initialBasemap);

  /***************************************************************************
   * Popup Functions
   ***************************************************************************/

  // Helper function: Delays the popup, so it is not jarring when the map flies to a location
  const delaySetPopupInfo = (selectedInfo) =>
    setTimeout(() => {
      setPopupInfo(selectedInfo);
    }, 1300);

  useEffect(() => {
    if (selectedItem) delaySetPopupInfo(selectedItem[0]);
  }, [selectedItem]);

  const setMapSelection = (selection) => {
    if (props.onMapSearchSelection && selection.length > 0) {
      props.onMapSearchSelection(selection[0]);
    }
    setSelectedItem(selection);
  };

  /***************************************************************************
   * TOC Functions
   ***************************************************************************/
  const buildInitialVisibleLayers = (keys, result = {}) => {
    /*
        Builds out the complete visible layer object. This will
        have keys of `{parent name}_{child name}` with booleans
        as values determined by the defaultLayersVisible.
    */
    const { defaultVisibleLayers } = props.toc;
    Object.entries(keys).forEach(([parent, val]) => {
      result[parent] = defaultVisibleLayers[parent] || false;
      if (Array.isArray(val)) {
        val.forEach((leaf) => {
          result[buildChildValue([parent, leaf])] =
            defaultVisibleLayers[parent] || defaultVisibleLayers[leaf] || false;
        });
      } else {
        buildInitialVisibleLayers(val, result);
      }
    });

    return result;
  };

  // set the visibleLayer state, the callback toggleVisible will update this
  // based on what node is checked in the checkbox-tree.
  const initVisible = props.toc ? buildInitialVisibleLayers(props.toc.keys) : null;
  const [visibleLayers, setVisibleLayers] = useState(initVisible);

  const toggleVisible = (lastCheckedName, _, customLayer, selectedNodes) => {
    /*
        This is the type of function the TOC looks for.

        If you are wondering about the first 3 arguments, <TableOfContents/>
        expects these values as function args for the prop toggleVisible.
        See the function handleChecked in TableOfContents for more details.
    */
    const newVisibleLayers = {};

    displayedCustomLayerList.forEach((d) => {
      newVisibleLayers[d.layer_name] = false;
    });

    selectedNodes.forEach((key) => {
      newVisibleLayers[key] = true;
    });

    setVisibleLayers(newVisibleLayers);

    if (!mapRef.current) {
      return;
    }

    const cMap = mapRef.current.getMap();

    if (cMap && customLayer) {
      cMap.setLayoutProperty(
        lastCheckedName,
        'visibility',
        newVisibleLayers[lastCheckedName] ? 'visible' : 'none'
      );
    }

    if (lastCheckedName in props.toc?.onToggleVisible)
      props.toc?.onToggleVisible[lastCheckedName]();
  };

  // This is the prop legendItems for <TableOfContents />
  const legendItems = {
    colors: { ...colors, ...props.toc.extendedColors },
    keys: props.toc?.keys,
    visible: { ...props.toc?.visible },
    expanded: props.toc?.expanded,
    gislayers: props.enableCustomGISLayers ? displayedCustomLayerList : [],
  };

  /***************************************************************************
   * Map Functions
   ***************************************************************************/

  useEffect(() => {
    // This useEffect adds all the custom layers to the map
    if (!mapRef.current || !props.enableCustomGISLayers) {
      return;
    }
    const cMap = mapRef.current.getMap();
    cMap.on('styledata', () => {
      displayedCustomLayerList.forEach((layer) => {
        let mapLayerExists = cMap.getLayer(layer.layer_name);
        if (!mapLayerExists) {
          let sourceID = layer.layer_name;
          // @ts-ignore
          const service = new FeatureService(sourceID, cMap, {
            name: sourceID,
            useStaticZoomLevel: false,
            setAttributionFromService: false,
            url: layer.layer_url,
            tiles: [],
          });
          service.enableRequests();

          let stylePaint = {
            'fill-opacity': 0.8,
            'fill-color': 'pink',
            'fill-outline-color': 'black',
          };
          let styleType = 'fill';

          if (layer.layer_style) {
            if (JSON.parse(layer.layer_style).paint) {
              stylePaint = JSON.parse(layer.layer_style).paint;
            }
            if (JSON.parse(layer.layer_style).type) {
              styleType = JSON.parse(layer.layer_style).type;
            }
          }

          const visibility = legendItems.visible[layer.layer_name] ? 'visible' : 'none';

          cMap.addLayer({
            id: layer.layer_name,
            layout: {
              visibility,
            },
            source: sourceID,
            // @ts-ignore
            type: styleType,
            // @ts-ignore
            paint: stylePaint,
          });
        }
      });
    });
  }, [mapRef.current, displayedCustomLayerList]);

  const { layerData } = props;

  // Add visible and onClick to layerData
  const layersDataWithVisibility = (layerData ?? []).filter(Boolean).map((data) => {
    // If data has visible use that, else if visibleLayers is defined
    // (e.g. the TOC is included) use its value. If not default to true

    // When the TOC is enabled, check if the layer is visible or
    // default to true
    const tocVisibility = visibleLayers ? visibleLayers[data.id] : true;

    /*  Overwrite visible if the property is already set, else it is
        managed by the TOC

        Note: the overwrite is useful in cases where the parent component
        wants to manage visibility of a layer.

        Also worth pointing out if the TOC is disabled and no overwrite is
        present this logic defaults to true, showing all layers.
    */
    const isVisible = data.hasOwnProperty('visible') ? data.visible : tocVisibility;

    let dataWithVisibility = {
      ...data,
      visible: isVisible,
    };

    if (data.pickable) {
      dataWithVisibility = {
        ...dataWithVisibility,
        onClick: (e) => {
          if (props.customOnMapPointClick !== undefined) {
            props.customOnMapPointClick(e.object);
          }
          if (!Object.hasOwn(e.object, 'geometry')) return;

          if (mapRef.current.getMap().getZoom() <= 15) {
            flyToLocation([e.object.geometry.coordinates[0], e.object.geometry.coordinates[1]])
          }
          // Delay the tooltip so it shows after fly animation
          delaySetPopupInfo(e.object);
        },
      };
    }
    return dataWithVisibility;
  });

  // Map to the actual Deck.gl layer
  const layers = layersDataWithVisibility.map((d) => {
    const { layerType } = d;
    switch (layerType) {
      case LayerTypes.MVT:
        return new MVTLayer(d);
      case LayerTypes.H3:
        return new H3HexagonLayer(d);
      default:
        return new IconLayer(d);
    }
  });

  // This layer is the anchor icon that shows when a user flys to their
  // current location
  const usersLocationAnchorLayer = new IconLayer({
    id: 'user-location-layer',
    data: [{ coordinates: userCoordinates }],
    iconAtlas: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
    iconMapping: {
      marker: { x: 0, y: 0, width: 128, height: 128 },
    },
    getIcon: (_) => 'marker',
    sizeScale: 10,
    getPosition: (d: { coordinates: any; }) => d.coordinates,
    getSize: (_) => 3,
    getColor: (_) => [0, 191, 255],
  });

  let layerIds = ['icon-layer', 'mvt-layer'];
  if (props.multiSelectEnabledLayers) {
    layerIds = [...layerIds, ...props.multiSelectEnabledLayers];
  }
  const multiSelectLayer = new SelectionLayer({
    id: 'selection',
    selectionType: 'rectangle',
    onSelect: props.onMultiselect ? props.onMultiselect : null,
    layerIds,
    lineWidthMinPixels: 2,
  });

  const flyToLocation = ([long, lat]) => {
    userContext.setMapView({
      latitude: lat,
      longitude: long,
      zoom: 18,
      transitionDuration: 10,
      transitionInterpolator: new LinearInterpolator(),
      transitionEasing: (t: any) => t,
    });
  };

  const handleViewportChange = useCallback(
    (newViewport) => userContext.setMapView(newViewport),
    []
  );

  const LoadingOverlay = () => (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        position: 'absolute',
        zIndex: 9001,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
      }}
    >
      <Loader size="sm" />
      <Typography
        sx={{
          fontSize: '20px',
          fontFamily: 'Nunito, sans-serif',
          marginLeft: '12px',
        }}
        component="div"
      >
        Loading...
      </Typography>
    </Box>
  );

  const multiSelectModeEnabled = isMultiSelecting && !props.disableMultiselect;

  return (
    <>
      {props.loading && <LoadingOverlay />}
      {userContext.userMapOptions && (
        <>
          {/* @ts-ignore */}
          <DeckGL
            initialViewState={userContext.userMapOptions}
            width="100%"
            height="100%"
            position="relative"
            controller={true}
            layers={[
              usersLocationAnchorLayer,
              ...(multiSelectModeEnabled ? [multiSelectLayer] : []),
              layers,
            ]}
            pickable={true}
            ContextProvider={MapContext.Provider}
            getCursor={() => (multiSelectModeEnabled ? 'copy' : 'grab')}
            // If CASTMap's tooltip prop is passed it will add the `getTooltip` prop to DeckGL
            {...(props.tooltip && {
              onHover: async (info) => {
                if (hoverInfo?.object && props.onTooltipUnmount)
                  await props.onTooltipUnmount(hoverInfo);
                setHoverInfo(info);
              },
            })}
            // If CASTMap's onViewStateCHange prop is passed add it to DeckGL
            {...(props.onViewStateChange && {
              onViewStateChange: props.onViewStateChange,
            })}
          >
            {popupInfo && props.popup && (
              <Popup
                anchor="left"
                longitude={Number(popupInfo.geometry.coordinates[0])}
                latitude={Number(popupInfo.geometry.coordinates[1])}
                onClose={() => setPopupInfo(null)}
              >
                {props.popup(popupInfo?.properties ?? popupInfo)}
              </Popup>
            )}
            {hoverInfo && hoverInfo.object && props.tooltip && (
              <Popup
                longitude={hoverInfo.coordinate[0]}
                latitude={hoverInfo.coordinate[1]}
                closeButton={false}
              >
                {props.tooltip(hoverInfo)}
              </Popup>
            )}
            <StaticMap
              key="map"
              reuseMaps
              ref={mapRef as any}
              mapStyle={basemap}
              mapboxApiAccessToken={MAPBOX_ACCESS_TOKEN}
            />
          </DeckGL>
        </>
      )}

      {props.toc && (
        <TableOfContents
          toggleVisible={toggleVisible}
          toggleExpanded={props.toc.onToggleExpanded}
          legendItems={legendItems}
          showCheckOnDefault={props.toc.showCheckboxOnDefault}
        />
      )}
      {!props.disableSearch && (
        <DataSearch
          handleViewportChange={handleViewportChange}
          setMapSelection={setMapSelection}
          searchFunction={props.onMapSearch}
          minSearchLength={minSearchInputLength}
          searchResultsComponent={(d) => {
            return (
              <Typography
                data-test-id={`address-${formatToKebabCase(d.address)}`}
                variant="body3"
              >{`${d.address}`}</Typography>
            );
          }}
        />
      )}

      {!props.disableGeolocate && (
        <GeolocateButton
          userCoordinates={userCoordinates}
          setUserCoordinates={setUserCoordinates}
          buttonStyle={
            props.geoLocateButtonStyle
              ? props.geoLocateButtonStyle
              : {
                  color: 'white',
                  backgroundColor: '#052838',
                  position: 'absolute',
                  right: '1.5rem',
                  bottom: '1.5rem',
                }
          }
          flyToLocation={flyToLocation}
        />
      )}
      <BaseMapSelector basemap={basemap} setBasemap={setBasemap} />
      {!props.disableMultiselect && (
        <div
          style={{
            justifyContent: 'right',
            position: 'absolute',
            top: '0.75rem',
            right: '0',
            marginLeft: 'auto',
            alignItems: 'center',
          }}
        >
          <Fab
            onClick={() => {
              setIsMultiSelecting((prevState) => !prevState);
            }}
            size="small"
            sx={{
              color: '#FFF',
              backgroundColor: isMultiSelecting ? '#7BDBC5' : '#052838',
              marginRight: '12px',
              ':hover': {
                backgroundColor: isMultiSelecting ? '#7BDBC5' : '#052838',
              },
              boxShadow: isMultiSelecting ? 'none' : 'default',
            }}
          >
            {isMultiSelecting ? <HighlightOff /> : <HighlightAlt />}
          </Fab>
        </div>
      )}
    </>
  );
};