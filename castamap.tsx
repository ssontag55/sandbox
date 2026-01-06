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

import FeatureService, { EsriAuthError } from '../FeatureService';
import { formatEsriPopup, formatSimplePopup  } from '../../../utils/mapPopupHelper';
import { addMapServerRaster, queryMapServer, isAuthError } from '../../../utils/mapServerHelper';
import { EsriAuthModal } from '../EsriAuthModal';

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
  
  // Store MapServer layer info (URL and token) for click handling
  const mapServerLayers = useRef<Map<string, { url: string; token: string | null }>>(new Map());
  
  // Store service metadata in a REF (not state) to avoid re-renders that break checkboxes
  const serviceMetadataRef = useRef<Map<string, any>>(new Map());
  // Counter to force legend re-render when metadata loads (without affecting TOC)
  const [legendVersion, setLegendVersion] = useState(0);

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
  // Initialize as empty object, never null - this prevents React from resetting it
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>(() => {
    if (props.toc) {
      return buildInitialVisibleLayers(props.toc.keys);
    }
    return {};
  });

  const toggleVisible = (lastCheckedName, isChecked, customLayer, selectedNodes) => {
    /*
        Update state and toggle layer visibility on map.
    */
    if (!lastCheckedName) return;

    let newVisibleLayers: Record<string, boolean>;

    // For GIS layers: use nextChecked array to determine state
    if (customLayer) {
      newVisibleLayers = {};
      // Reset all GIS layers to false
      displayedCustomLayerList.forEach((d: any) => {
        newVisibleLayers[d.layer_name] = false;
      });
      // Set checked layers to true (from selectedNodes/nextChecked)
      // Also explicitly ensure the clicked layer is included if isChecked is true
      const checkedSet = new Set(selectedNodes);
      if (isChecked && !checkedSet.has(lastCheckedName)) {
        checkedSet.add(lastCheckedName);
      } else if (!isChecked) {
        checkedSet.delete(lastCheckedName);
      }
      checkedSet.forEach((key: string) => {
        newVisibleLayers[key] = true;
      });
    } else {
      // For other layers: use original logic
      newVisibleLayers = {};
      
      displayedCustomLayerList.forEach((d: any) => {
        newVisibleLayers[d.layer_name] = false;
      });
      
      selectedNodes.forEach((key: string) => {
        newVisibleLayers[key] = true;
      });
    }

    setVisibleLayers(newVisibleLayers);

    if (!mapRef.current) return;

    const cMap = mapRef.current.getMap();

    // For GIS layers, toggle visibility
    if (cMap && customLayer) {
      // Handle both MapServer (exact ID) and FeatureServer (prefixed IDs)
      const allLayers = cMap.getStyle()?.layers || [];
      const matchingLayers = allLayers.filter((l: any) => 
        l.id === lastCheckedName || l.id.startsWith(`${lastCheckedName}-`)
      );
      
      matchingLayers.forEach((layer: any) => {
        try {
          cMap.setLayoutProperty(
            layer.id,
            'visibility',
            newVisibleLayers[lastCheckedName] ? 'visible' : 'none'
          );
        } catch (e) {
          // Layer might not exist yet
        }
      });
    }

    if (lastCheckedName in props.toc?.onToggleVisible) {
      props.toc?.onToggleVisible[lastCheckedName]();
    }
  };

  // Function to fetch service metadata for legend
  const fetchServiceMetadataForLegend = async (layerName: string) => {
    // Check if metadata already exists (use ref, not state)
    if (serviceMetadataRef.current.has(layerName)) {
      return;
    }

    const layer = displayedCustomLayerList.find((l) => l.layer_name === layerName);
    if (!layer) return;

    // Check if it's a FeatureServer (not MapServer - MapServers don't have legends)
    const isMapServer = /\/MapServer(\/\d+)?$/i.test(layer.layer_url) && !/FeatureServer/i.test(layer.layer_url);
    if (isMapServer) return;

    // Check if service already exists
    let service = featureServiceRefs.current.get(layerName);
    
    if (!service && mapRef.current) {
      const cMap = mapRef.current.getMap();
      if (cMap && cMap.isStyleLoaded()) {
        // Create service instance to fetch metadata (even if layer not visible)
        let sourceID = layer.layer_name;
        // @ts-ignore
        service = new FeatureService(sourceID, cMap, {
          name: sourceID,
          useStaticZoomLevel: false,
          setAttributionFromService: false,
          url: layer.layer_url,
          tiles: [],
          token: null, // Start with no token - will be set via login modal if needed
          applyEsriStyles: false, // Don't apply styles, just fetch metadata
          onAuthError: (error: EsriAuthError) => {
            handleAuthError(error, layer.layer_name, layer.layer_url);
          },
        });
        featureServiceRefs.current.set(layer.layer_name, service);
        service.enableRequests();
      }
    }

    // Wait for metadata to load (it's fetched async)
    if (service) {
      const checkMetadata = (attempts = 0) => {
        const layerJson = service.getLayerJson();
        if (layerJson) {
          serviceMetadataRef.current.set(layerName, layerJson);
          setLegendVersion((v) => v + 1);
        } else if (attempts < 10) {
          // Retry up to 10 times (5 seconds total)
          setTimeout(() => checkMetadata(attempts + 1), 500);
        }
      };
      checkMetadata();
    }
  };

  // This is the prop legendItems for <TableOfContents />
  const legendItems = {
    colors: { ...colors, ...props.toc.extendedColors },
    keys: props.toc?.keys,
    visible: { ...visibleLayers },
    expanded: props.toc?.expanded,
    gislayers: props.enableCustomGISLayers ? displayedCustomLayerList : [],
    serviceMetadata: serviceMetadataRef.current,
    legendVersion: legendVersion, // Include to trigger re-render when legend loads
    onExpand: fetchServiceMetadataForLegend,
  };

  /***************************************************************************
   * ESRI Authentication Functions
   ***************************************************************************/
  
  const clearAuthState = () => {
    setAuthModalOpen(false);
    setAuthLayerUrl(null);
    setAuthLayerName(null);
    setAuthUsername('');
    setAuthPassword('');
    setAuthError(null);
  };

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
      
      const service = featureServiceRefs.current.get(authLayerName || '');
      if (service) {
        service.setToken(token);
      }
      
      // Update MapServer token if this is a MapServer layer
      const mapServerInfo = mapServerLayers.current.get(authLayerName || '');
      if (mapServerInfo) {
        mapServerInfo.token = token;
      }
      
      clearAuthState();
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed. Please check your credentials and try again.');
      setAuthPassword('');
      
      // Uncheck the layer on failed authentication
      if (authLayerName) {
        setVisibleLayers((prev) => {
          const newVisible = { ...prev };
          newVisible[authLayerName] = false;
          return newVisible;
        });
        
        // Hide the layer on the map if it exists
        if (mapRef.current) {
          const cMap = mapRef.current.getMap();
          if (cMap && cMap.isStyleLoaded()) {
            // Hide MapServer layer if it exists
            const mapServerLayer = cMap.getLayer(authLayerName);
            if (mapServerLayer) {
              cMap.setLayoutProperty(authLayerName, 'visibility', 'none');
            }
            
            // Hide FeatureServer layers (prefixed IDs)
            const allLayers = cMap.getStyle().layers || [];
            const matchingLayers = allLayers.filter((l: any) => 
              l.id === authLayerName || l.id.startsWith(`${authLayerName}-`)
            );
            matchingLayers.forEach((layer: any) => {
              try {
                cMap.setLayoutProperty(layer.id, 'visibility', 'none');
              } catch (e) {
                // Layer might not support visibility property
              }
            });
          }
        }
        
        // Remove from tracking maps
        mapServerLayers.current.delete(authLayerName);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleAuthCancel = () => {
    // Uncheck the layer if user cancels authentication
    if (authLayerName) {
      // Uncheck the layer directly - simple
      setVisibleLayers((prev) => {
        const newState = { ...prev };
        newState[authLayerName] = false;
        return newState;
      });
      
      // Hide the layer on the map
      if (mapRef.current) {
        const cMap = mapRef.current.getMap();
        if (cMap && cMap.isStyleLoaded()) {
          const mapServerLayer = cMap.getLayer(authLayerName);
          if (mapServerLayer) {
            cMap.setLayoutProperty(authLayerName, 'visibility', 'none');
          }
          const allLayers = cMap.getStyle().layers || [];
          const matchingLayers = allLayers.filter((l: any) => 
            l.id === authLayerName || l.id.startsWith(`${authLayerName}-`)
          );
          matchingLayers.forEach((layer: any) => {
            try {
              cMap.setLayoutProperty(layer.id, 'visibility', 'none');
            } catch (e) {
              // Ignore errors
            }
          });
        }
      }
      mapServerLayers.current.delete(authLayerName);
    }
    
    clearAuthState();
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
    const handleStyleData = () => {
      displayedCustomLayerList.forEach((layer) => {
        // Only create layer if checkbox is checked (use visibleLayers state)
        if (!visibleLayers[layer.layer_name]) {
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
            const token = null; // Start with no token - will be set via login modal if needed
            addMapServerRaster(cMap, layer.layer_url, layer.layer_name, token);
            // Store MapServer layer info for click handling
            mapServerLayers.current.set(layer.layer_name, { url: layer.layer_url, token });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef.current, displayedCustomLayerList]); // Removed visibleLayers - layer creation handled in toggleVisible

  // Note: ESRI layer click handling is done via DeckGL onClick handler below
  // No separate Mapbox click handler needed since DeckGL intercepts clicks

  const { layerData } = props;

  // Add visible and onClick to layerData
  const layersDataWithVisibility = (layerData ?? []).filter(Boolean).map((data) => {
    // If data has visible use that, else if visibleLayers is defined
    // (e.g. the TOC is included) use its value. If not default to true

    // When the TOC is enabled, check if the layer is visible or
    // default to true
    const tocVisibility = visibleLayers[data.id] ?? true;

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

          // Don't show popup for DeckGL layers when ESRI layers are present
          // ESRI layers are handled by the DeckGL onClick handler below
          if (mapRef.current) {
            const esriSourceIds = Array.from(featureServiceRefs.current.values()).map((s: any) => s.sourceId);
            if (esriSourceIds.length > 0) {
              return; // ESRI handler will manage popups
            }
          }

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
          marginLeft: '12px',
        }}
        component="div"
      >
        Loading...
      </Typography>
    </Box>
  );

  const multiSelectModeEnabled = isMultiSelecting && !props.disableMultiselect;

  /***************************************************************************
   * Click Handlers
   ***************************************************************************/

  const handleMapServerClick = async (
    info: any,
    cMap: MapboxGL.Map,
    mapServerInfo: { url: string; token: string | null },
    layerId: string
  ): Promise<{ geometry: { coordinates: number[] }; properties: { content: React.ReactElement } } | null> => {
    const lng = info.coordinate[0];
    const lat = info.coordinate[1];
    
    const result = await queryMapServer(mapServerInfo.url, lng, lat, mapServerInfo.token);
    
    if (result.error) {
      if (isAuthError(result.error)) {
        const layer = displayedCustomLayerList.find((l) => l.layer_name === layerId);
        if (layer) {
          handleAuthError(
            new EsriAuthError('Authentication required. Please login to access this ESRI service.', mapServerInfo.url),
            layerId,
            mapServerInfo.url
          );
        }
      }
      return null;
    }
    
    if (!result.features || result.features.length === 0) {
      return null;
    }
    
    const feature = result.features[0];
    const attributes = feature.attributes || {};
    const popupContent = formatSimplePopup(attributes, null);
    
    if (!popupContent) {
      return null;
    }
    
    return {
      geometry: { coordinates: [lng, lat] },
      properties: { content: popupContent }
    };
  };

  const handleFeatureServerClick = (
    info: any,
    cMap: MapboxGL.Map,
    esriServices: FeatureService[]
  ): { geometry: { coordinates: number[] }; properties: { content: React.ReactElement } } | null => {
    const esriSourceIds = esriServices.map((s: any) => s.sourceId);
    const allLayers = cMap.getStyle().layers || [];
    const esriLayerIds: string[] = [];
    
    for (const layer of allLayers) {
      try {
        const layerObj = cMap.getLayer(layer.id);
        if (layerObj?.source && esriSourceIds.includes(layerObj.source)) {
          esriLayerIds.push(layer.id);
        }
      } catch (e) {
        // Skip invalid layers
      }
    }
    
    if (esriLayerIds.length === 0) {
      return null;
    }
    
    // Query features at click point with tolerance for easier clicking (especially lines)
    // Create a small bounding box in screen coordinates around the click point
    const tolerancePixels = 15;
    const point = cMap.project([info.coordinate[0], info.coordinate[1]]);
    
    // Create bounding box in screen/pixel coordinates
    const bbox = [
      [point.x - tolerancePixels, point.y - tolerancePixels],
      [point.x + tolerancePixels, point.y + tolerancePixels]
    ];
    
    const features = cMap.queryRenderedFeatures(bbox, {
      layers: esriLayerIds
    });
    
    if (features.length === 0) {
      return null;
    }
    
    const feature = features[0];
    if (!esriSourceIds.includes(feature.source)) {
      return null;
    }
    
    const service = esriServices.find((s: any) => s.sourceId === feature.source);
    if (!service) {
      return null;
    }
    
    const servicePopupInfo = (service as any).getPopupInfo?.();
    const displayField = (service as any).getDisplayField?.();
    let popupContent: React.ReactElement | null = null;
    
    if (servicePopupInfo && feature.properties) {
      popupContent = formatEsriPopup(feature, servicePopupInfo, displayField);
    }
    
    if (!popupContent && feature.properties) {
      popupContent = formatSimplePopup(feature.properties, displayField);
    }
    
    if (!popupContent) {
      return null;
    }
    
    return {
      geometry: { coordinates: [info.coordinate[0], info.coordinate[1]] },
      properties: { content: popupContent }
    };
  };

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
            onClick={async (info) => {
              if (!mapRef.current || !info.coordinate) {
                setPopupInfo(null);
                return;
              }
              
              const cMap = mapRef.current.getMap();
              if (!cMap || !cMap.isStyleLoaded()) {
                setPopupInfo(null);
                return;
              }
              
              try {
                // Check for MapServer layers first (raster layers need Query service)
                const mapServerEntries = Array.from(mapServerLayers.current.entries());
                if (mapServerEntries.length > 0) {
                  // Check if click is on any MapServer layer
                  // Use bounding box for consistent tolerance with FeatureServer layers
                  const tolerancePixels = 15;
                  const point = cMap.project([info.coordinate[0], info.coordinate[1]]);
                  const bbox = [
                    [point.x - tolerancePixels, point.y - tolerancePixels],
                    [point.x + tolerancePixels, point.y + tolerancePixels]
                  ];
                  const clickedLayers = cMap.queryRenderedFeatures(bbox);
                  
                  const mapServerLayerIds = mapServerEntries.map((entry) => (entry as [string, { url: string; token: string | null }])[0]);
                  const clickedMapServerLayer = clickedLayers.find((f: any) => 
                    mapServerLayerIds.includes(f.layer?.id)
                  );
                  
                  if (clickedMapServerLayer) {
                    const layerId = clickedMapServerLayer.layer?.id;
                    const mapServerInfo = mapServerLayers.current.get(layerId);
                    
                    if (mapServerInfo) {
                      const popupData = await handleMapServerClick(info, cMap, mapServerInfo, layerId);
                      if (popupData) {
                        setPopupInfo(popupData);
                      } else {
                        setPopupInfo(null);
                      }
                      return;
                    }
                  }
                }
                
                // Handle FeatureServer layers
                const esriServices = Array.from(featureServiceRefs.current.values());
                if (esriServices.length === 0) {
                  setPopupInfo(null);
                  return;
                }
                
                const popupData = handleFeatureServerClick(info, cMap, esriServices);
                if (popupData) {
                  setPopupInfo(popupData);
                } else {
                  setPopupInfo(null);
                }
              } catch (error) {
                setPopupInfo(null);
              }
            }}
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
            {popupInfo && (
              <Popup
                anchor="left"
                longitude={Number(popupInfo.geometry.coordinates[0])}
                latitude={Number(popupInfo.geometry.coordinates[1])}
                onClose={() => setPopupInfo(null)}
                closeButton={true}
                closeOnClick={false}
                closeOnMove={false}
                maxWidth="300px"
              >
                {popupInfo.properties?.content ? (
                  <div 
                    style={{ 
                      maxWidth: '280px',
                      maxHeight: '400px',
                      overflowY: 'auto',
                      overflowX: 'hidden',
                      padding: '12px 12px 12px 12px', 
                      fontSize: '14px',
                      lineHeight: '1.6',
                      boxSizing: 'border-box',
                      paddingRight: '24px' // Space for scrollbar, close button is positioned by Mapbox
                    }}
                  >
                    {popupInfo.properties.content}
                  </div>
                ) : props.popup ? (
                  <div style={{ maxWidth: '280px', maxHeight: '400px', overflowY: 'auto', padding: '12px 16px' }}>
                    {props.popup(popupInfo?.properties ?? popupInfo)}
                  </div>
                ) : (
                  <div style={{ 
                    padding: '12px 16px', 
                    maxWidth: '280px', 
                    maxHeight: '400px', 
                    overflowY: 'auto',
                    fontSize: '14px',
                    lineHeight: '1.6'
                  }}>
                    {JSON.stringify(popupInfo.properties || popupInfo, null, 2)}
                  </div>
                )}
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
      
      <EsriAuthModal
        open={authModalOpen}
        layerName={authLayerName}
        username={authUsername}
        password={authPassword}
        error={authError}
        loading={authLoading}
        onUsernameChange={setAuthUsername}
        onPasswordChange={setAuthPassword}
        onLogin={handleAuthLogin}
        onCancel={handleAuthCancel}
      />
      
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
