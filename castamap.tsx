import { H3HexagonLayer, MVTLayer } from '@deck.gl/geo-layers';
import { IconLayer } from '@deck.gl/layers';

import DeckGL from '@deck.gl/react';

import { HighlightAlt, HighlightOff } from '@mui/icons-material';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Fab, TextField, Typography } from '@mui/material';
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

import FeatureService, { EsriAuthError } from '../FeatureService';

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
  
  // ESRI Authentication state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authLayerUrl, setAuthLayerUrl] = useState<string | null>(null);
  const [authLayerName, setAuthLayerName] = useState<string | null>(null);
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  
  // Store FeatureService instances for token updates
  const featureServiceRefs = useRef<Map<string, FeatureService>>(new Map());

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
      const isVisible = newVisibleLayers[lastCheckedName];
      const layer = displayedCustomLayerList.find((l) => l.layer_name === lastCheckedName);
      
      if (!layer) return;
      
      // Check if URL is a MapServer (not FeatureServer)
      const isMapServer = /\/MapServer(\/\d+)?$/i.test(layer.layer_url) && !/FeatureServer/i.test(layer.layer_url);
      
      if (isMapServer) {
        // MapServer raster layer - single layer ID
        const layerExists = cMap.getLayer(lastCheckedName);
        if (layerExists) {
          // Layer exists, toggle visibility
          cMap.setLayoutProperty(lastCheckedName, 'visibility', isVisible ? 'visible' : 'none');
        } else if (isVisible && cMap.isStyleLoaded()) {
          // Layer doesn't exist but checkbox is checked - create it
          // MapServer layers are typically public - don't pass token unless service requires it
          addMapServerRaster(cMap, layer.layer_url, lastCheckedName, null);
        }
      } else {
        // FeatureServer - ESRI styles create layers with prefixed IDs (e.g., "layer_name-circle", "layer_name-fill")
        // Check for any layer starting with the layer name
        const allLayers = cMap.getStyle().layers || [];
        const matchingLayers = allLayers.filter((l: any) => 
          l.id === lastCheckedName || l.id.startsWith(`${lastCheckedName}-`)
        );
        
        if (matchingLayers.length > 0) {
          // Layers exist, toggle visibility on all matching layers
          matchingLayers.forEach((layer: any) => {
            try {
              cMap.setLayoutProperty(layer.id, 'visibility', isVisible ? 'visible' : 'none');
            } catch (e) {
              // Layer might not support visibility property
            }
          });
        } else if (isVisible && cMap.isStyleLoaded()) {
          // Layer doesn't exist but checkbox is checked - create it
          // Check if service already exists (might have been created but failed)
          const existingService = featureServiceRefs.current.get(layer.layer_name);
          if (!existingService) {
            let sourceID = layer.layer_name;
            // @ts-ignore
            const service = new FeatureService(sourceID, cMap, {
              name: sourceID,
              useStaticZoomLevel: false,
              setAttributionFromService: false,
              url: layer.layer_url,
              tiles: [],
              token: null, // Start with no token - will be set via login modal if needed
              applyEsriStyles: true, // Use ESRI renderer styles
              onAuthError: (error: EsriAuthError) => {
                handleAuthError(error, layer.layer_name, layer.layer_url);
              },
            });
            // Store service reference for token updates
            featureServiceRefs.current.set(layer.layer_name, service);
            service.enableRequests();
          }
        }
      }
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
   * ESRI Authentication Functions
   ***************************************************************************/
  
  const handleAuthError = (error: EsriAuthError, layerName: string, layerUrl: string) => {
    setAuthLayerUrl(layerUrl);
    setAuthLayerName(layerName);
    setAuthError(null);
    setAuthUsername('');
    setAuthPassword('');
    setAuthModalOpen(true);
  };

  const handleAuthLogin = async () => {
    if (!authLayerUrl || !authUsername.trim() || !authPassword.trim()) {
      setAuthError('Please enter your username and password');
      return;
    }

    setAuthLoading(true);
    setAuthError(null);

    try {
      const token = await FeatureService.generateEsriToken(authLayerUrl, authUsername.trim(), authPassword.trim());
      
      // Update token on the FeatureService instance if it exists
      const service = featureServiceRefs.current.get(authLayerName || '');
      if (service) {
        service.setToken(token);
      }
      
      // Close modal and clear state
      setAuthModalOpen(false);
      setAuthLayerUrl(null);
      setAuthLayerName(null);
      setAuthUsername('');
      setAuthPassword('');
      setAuthError(null);
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed. Please check your credentials and try again.');
      setAuthPassword(''); // Clear password on error
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthCancel = () => {
    setAuthModalOpen(false);
    setAuthLayerUrl(null);
    setAuthLayerName(null);
    setAuthUsername('');
    setAuthPassword('');
    setAuthError(null);
  };

  /***************************************************************************
   * Map Functions
   ***************************************************************************/

  // Helper function to add MapServer as raster layer
  const addMapServerRaster = (cMap: MapboxGL.Map, msUrl: string, layerId: string, token: string | null = null) => {
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
  };

  useEffect(() => {
    // This useEffect adds all the custom layers to the map
    if (!mapRef.current || !props.enableCustomGISLayers) {
      return;
    }
    const cMap = mapRef.current.getMap();
    const handleStyleData = () => {
      displayedCustomLayerList.forEach((layer) => {
        // Only create layer if checkbox is checked (use visibleLayers state)
        if (!visibleLayers || !visibleLayers[layer.layer_name]) {
          return;
        }
        
        // Check if URL is a MapServer (not FeatureServer)
        const isMapServer = /\/MapServer(\/\d+)?$/i.test(layer.layer_url) && !/FeatureServer/i.test(layer.layer_url);
        
        if (isMapServer) {
          // Add MapServer as raster layer
          const layerExists = cMap.getLayer(layer.layer_name);
          const sourceExists = cMap.getSource(layer.layer_name);
          if (!layerExists && !sourceExists) {
            // MapServer layers are typically public - don't pass token unless service requires it
            addMapServerRaster(cMap, layer.layer_url, layer.layer_name, null);
          }
        } else {
          // Check if any layer with this source exists (ESRI styles create prefixed layer IDs)
          const sourceExists = cMap.getSource(layer.layer_name);
          const serviceExists = featureServiceRefs.current.has(layer.layer_name);
          if (!sourceExists && !serviceExists) {
            let sourceID = layer.layer_name;
            // @ts-ignore
            const service = new FeatureService(sourceID, cMap, {
              name: sourceID,
              useStaticZoomLevel: false,
              setAttributionFromService: false,
              url: layer.layer_url,
              tiles: [],
              token: null, // Start with no token - will be set via login modal if needed
              applyEsriStyles: true, // Use ESRI renderer styles
              onAuthError: (error: EsriAuthError) => {
                handleAuthError(error, layer.layer_name, layer.layer_url);
              },
            });
            // Store service reference for token updates
            featureServiceRefs.current.set(layer.layer_name, service);
            service.enableRequests();
          }
        }
      });
    };
    
    cMap.on('styledata', handleStyleData);
    
    // Also check immediately if style is already loaded
    if (cMap.isStyleLoaded()) {
      handleStyleData();
    }
    
    return () => {
      cMap.off('styledata', handleStyleData);
    };
  }, [mapRef.current, displayedCustomLayerList, visibleLayers]);

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
      
      {/* ESRI Authentication Modal */}
      <Dialog open={authModalOpen} onClose={handleAuthCancel} maxWidth="sm" fullWidth>
        <DialogTitle>
          🔐 ESRI Service Authentication Required
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {authLayerName && `Layer: ${authLayerName}`}
            <br />
            Sign in with your ArcGIS credentials to access this secure layer.
          </Typography>
          
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            type="text"
            fullWidth
            variant="outlined"
            value={authUsername}
            onChange={(e) => setAuthUsername(e.target.value)}
            disabled={authLoading}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !authLoading) {
                handleAuthLogin();
              }
            }}
            sx={{ mb: 2 }}
          />
          
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            variant="outlined"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            disabled={authLoading}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !authLoading) {
                handleAuthLogin();
              }
            }}
            sx={{ mb: 1 }}
          />
          
          {authError && (
            <Typography variant="body2" color="error" sx={{ mt: 1, mb: 1 }}>
              {authError}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleAuthCancel} disabled={authLoading}>
            Cancel
          </Button>
          <Button 
            onClick={handleAuthLogin} 
            variant="contained" 
            disabled={authLoading || !authUsername.trim() || !authPassword.trim()}
          >
            {authLoading ? 'Authenticating...' : 'Login'}
          </Button>
        </DialogActions>
      </Dialog>
      
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
