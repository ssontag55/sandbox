import tilebelt from '@mapbox/tilebelt';
import tileDecode from 'arcgis-pbf-parser';
import { mapboxLayersFromEsriLayer, EsriLayerJson } from '../../utils/esriStyleHelper';

export class EsriAuthError extends Error {
  constructor(message: string, url: string) {
    super(message);
    this.name = 'EsriAuthError';
    this.url = url;
  }
}

export default class FeatureService {
  constructor(sourceId, map, arcgisOptions, geojsonSourceOptions) {
    if (!sourceId || !map || !arcgisOptions)
      throw new Error(
        'Source id, map and arcgisOptions must be supplied as the first three arguments.'
      );
    if (!arcgisOptions.url)
      throw new Error('A url must be supplied as part of the esriServiceOptions object.');

    this.sourceId = sourceId;
    this._map = map;

    this._tileIndices = new Map();
    this._featureIndices = new Map();
    this._featureCollections = new Map();

    this._esriServiceOptions = Object.assign(
      {
        useStaticZoomLevel: false,
        minZoom: arcgisOptions.useStaticZoomLevel ? 7 : 2,
        simplifyFactor: 0.3,
        precision: 8,
        where: '1=1',
        to: null,
        from: null,
        outFields: '*',
        setAttributionFromService: true,
        f: 'pbf',
        useSeviceBounds: true,
        projectionEndpoint: `${
          arcgisOptions.url.split('rest/services')[0]
        }rest/services/Geometry/GeometryServer/project`,
        token: null,
        fetchOptions: null,
        useEsriRenderer: false, // New: Use ESRI renderer for styling
        applyEsriStyles: false, // New: Apply ESRI styles automatically
        popupInfo: null, // New: Store popupInfo for popups
        onLoadingStart: null, // New: Callback when loading starts
        onLoadingEnd: null, // New: Callback when loading ends
        onAuthError: null, // New: Callback when authentication error occurs
      },
      arcgisOptions
    );

    this._fallbackProjectionEndpoint =
      'https://tasks.arcgisonline.com/arcgis/rest/services/Geometry/GeometryServer/project';
    this.serviceMetadata = null;
    this._maxExtent = [-Infinity, Infinity, -Infinity, Infinity];

    const gjOptions = !geojsonSourceOptions ? {} : geojsonSourceOptions;
    // Check if source already exists before adding
    // Wait for map style to be loaded before adding source
    const addSource = () => {
      if (!this._map.getSource(sourceId)) {
        try {
          this._map.addSource(
            sourceId,
            Object.assign(gjOptions, {
              type: 'geojson',
              data: this._getBlankFc(),
            })
          );
        } catch (e) {
          // Source creation failed
        }
      }
    };

    if (this._map.isStyleLoaded()) {
      addSource();
    } else {
      this._map.once('styledata', () => {
        addSource();
      });
    }

    this._getServiceMetadata().then(() => {
      if (!this.supportsPbf) {
        if (!this.supportsGeojson) {
          this._map.removeSource(sourceId);
          throw new Error('Server does not support PBF or GeoJSON query formats.');
        }
        this._esriServiceOptions.f = 'geojson';
      }

      // Store popupInfo if available
      if (this.serviceMetadata.popupInfo) {
        this._esriServiceOptions.popupInfo = this.serviceMetadata.popupInfo;
      }

      if (this._esriServiceOptions.useSeviceBounds) {
        const serviceExtent = this.serviceMetadata.extent;
        if (serviceExtent.spatialReference.wkid === 4326) {
          this._setBounds([
            serviceExtent.xmin,
            serviceExtent.ymin,
            serviceExtent.xmax,
            serviceExtent.ymax,
          ]);
        } else {
          // Await _projectBounds to properly catch errors
          return this._projectBounds().then(() => {
            // Continue with rest of initialization after projection
            this._continueInitialization();
          });
        }
      }

      // Continue with rest of initialization
      this._continueInitialization();
    }).catch((error) => {
      // Handle authentication errors silently - onAuthError callback handles UI
      if (error instanceof EsriAuthError) {
        // Error already handled in _getServiceMetadata or _projectBounds, just prevent unhandled rejection
        return;
      }
      // For other errors, clean up the source
      try {
        if (this._map.getSource(sourceId)) {
          this._map.removeSource(sourceId);
        }
      } catch (e) {
        // Source might not exist or already removed
      }
      // Don't re-throw - prevent unhandled promise rejection
      // The error is logged for debugging, but we don't want to crash the app
    });
  }

  _continueInitialization() {
    if (this._esriServiceOptions.outFields !== '*') {
      this._esriServiceOptions.outFields = `${this._esriServiceOptions.outFields},${this.serviceMetadata.uniqueIdField.name}`;
    }

    // Apply ESRI renderer styles if enabled
    if (this._esriServiceOptions.applyEsriStyles && this.serviceMetadata.drawingInfo?.renderer) {
      this.applyEsriRendererStyles();
    }

    // we don't want attribution because it's duplicating
    // this._setAttribution()
    this.enableRequests();
    this._clearAndRefreshTiles();
  }

  destroySource() {
    this.disableRequests();
    this._map.removeSource(this.sourceId);
  }

  _getBlankFc() {
    return {
      type: 'FeatureCollection',
      features: [],
    };
  }

  _setBounds(bounds) {
    this._maxExtent = bounds;
  }

  get supportsGeojson() {
    return this.serviceMetadata.supportedQueryFormats.indexOf('geoJSON') > -1;
  }

  get supportsPbf() {
    return this.serviceMetadata.supportedQueryFormats.indexOf('PBF') > -1;
  }

  disableRequests() {
    this._map.off('moveend', this._boundEvent);
  }

  enableRequests() {
    this._boundEvent = this._findAndMapData.bind(this);
    this._map.on('moveend', this._boundEvent);
  }

  _clearAndRefreshTiles() {
    // Ensure source exists before trying to load data
    if (!this._map.getSource(this.sourceId)) {
      try {
        this._map.addSource(this.sourceId, {
          type: 'geojson',
          data: this._getBlankFc(),
        });
      } catch (e) {
        return;
      }
    }
    this._tileIndices = new Map();
    this._featureIndices = new Map();
    this._featureCollections = new Map();
    this._findAndMapData();
  }

  setWhere(newWhere) {
    this._esriServiceOptions.where = newWhere;
    this._clearAndRefreshTiles();
  }

  clearWhere() {
    this._esriServiceOptions.where = '1=1';
    this._clearAndRefreshTiles();
  }

  setDate(to, from) {
    this._esriServiceOptions.to = to;
    this._esriServiceOptions.from = from;
    this._clearAndRefreshTiles();
  }

  setToken(token) {
    this._esriServiceOptions.token = token;
    this._clearAndRefreshTiles();
  }

  _createOrGetTileIndex(zoomLevel) {
    const existingZoomIndex = this._tileIndices.get(zoomLevel);
    if (existingZoomIndex) return existingZoomIndex;
    const newIndex = new Map();
    this._tileIndices.set(zoomLevel, newIndex);
    return newIndex;
  }

  _createOrGetFeatureCollection(zoomLevel) {
    const existingZoomIndex = this._featureCollections.get(zoomLevel);
    if (existingZoomIndex) return existingZoomIndex;
    const fc = this._getBlankFc();
    this._featureCollections.set(zoomLevel, fc);
    return fc;
  }

  _createOrGetFeatureIdIndex(zoomLevel) {
    const existingFeatureIdIndex = this._featureIndices.get(zoomLevel);
    if (existingFeatureIdIndex) return existingFeatureIdIndex;
    const newFeatureIdIndex = new Map();
    this._featureIndices.set(zoomLevel, newFeatureIdIndex);
    return newFeatureIdIndex;
  }

  async _findAndMapData() {
    const z = this._map.getZoom();

    if (z < this._esriServiceOptions.minZoom) {
      return;
    }

    // Notify loading start
    if (this._esriServiceOptions.onLoadingStart) {
      this._esriServiceOptions.onLoadingStart();
    }
    const bounds = this._map.getBounds().toArray();
    const primaryTile = tilebelt.bboxToTile([
      bounds[0][0],
      bounds[0][1],
      bounds[1][0],
      bounds[1][1],
    ]);

    if (this._esriServiceOptions.useSeviceBounds) {
      if (this._maxExtent[0] !== -Infinity && !this._doesTileOverlapBbox(this._maxExtent, bounds)) {
        return;
      }
    }

    // If we're not using a static zoom level we'll round to the nearest even zoom level
    // This means we don't need to request new data for every zoom level allowing us to reuse the previous levels data
    const zoomLevel = this._esriServiceOptions.useStaticZoomLevel
      ? this._esriServiceOptions.minZoom
      : 2 * Math.floor(z / 2);
    const zoomLevelIndex = this._createOrGetTileIndex(zoomLevel);
    const featureIdIndex = this._createOrGetFeatureIdIndex(zoomLevel);
    const fc = this._createOrGetFeatureCollection(zoomLevel);

    const tilesToRequest = [];

    if (primaryTile[2] < zoomLevel) {
      let candidateTiles = tilebelt.getChildren(primaryTile);
      let minZoomOfCandidates = candidateTiles[0][2];
      while (minZoomOfCandidates < zoomLevel) {
        const newCandidateTiles = [];
        candidateTiles.forEach((t) => newCandidateTiles.push(...tilebelt.getChildren(t)));
        candidateTiles = newCandidateTiles;
        minZoomOfCandidates = candidateTiles[0][2];
      }

      for (let index = 0; index < candidateTiles.length; index++) {
        if (this._doesTileOverlapBbox(candidateTiles[index], bounds)) {
          tilesToRequest.push(candidateTiles[index]);
        }
      }
    } else {
      tilesToRequest.push(primaryTile);
    }

    for (let index = 0; index < tilesToRequest.length; index++) {
      const quadKey = tilebelt.tileToQuadkey(tilesToRequest[index]);
      if (zoomLevelIndex.has(quadKey)) {
        tilesToRequest.splice(index, 1);
        index--;
      } else zoomLevelIndex.set(quadKey, true);
    }

    try {
      if (tilesToRequest.length === 0) {
        this._updateFcOnMap(fc);
      } else {
        // This tolerance will be used to inform the quantization/simplification of features
        const mapWidth = Math.abs(bounds[1][0] - bounds[0][0]);
        const tolerance =
          (mapWidth / this._map.getCanvas().width) * this._esriServiceOptions.simplifyFactor;
        await this._loadTiles(tilesToRequest, tolerance, featureIdIndex, fc);
        this._updateFcOnMap(fc);
      }
    } catch (error) {
      // Handle authentication errors
      if (error instanceof EsriAuthError) {
        if (this._esriServiceOptions.onAuthError) {
          this._esriServiceOptions.onAuthError(error);
        }
        // Don't re-throw auth errors to prevent repeated prompts
        return;
      }
      // Re-throw other errors after ensuring loading end is called
      throw error;
    } finally {
      // Notify loading end
      if (this._esriServiceOptions.onLoadingEnd) {
        this._esriServiceOptions.onLoadingEnd();
      }
    }
  }

  async _loadTiles(tilesToRequest, tolerance, featureIdIndex, fc) {
    return new Promise((resolve) => {
      const promises = tilesToRequest.map((t) => this._getTile(t, tolerance));
      Promise.all(promises).then((featureCollections) => {
        featureCollections.forEach((tileFc) => {
          if (tileFc) this._iterateItems(tileFc, featureIdIndex, fc);
        });
        resolve();
      });
    });
  }

  _iterateItems(tileFc, featureIdIndex, fc) {
    tileFc.features.forEach((feature) => {
      if (!featureIdIndex.has(feature.id)) {
        fc.features.push(feature);
        featureIdIndex.set(feature.id);
      }
    });
  }

  get _time() {
    if (!this._esriServiceOptions.to) return false;
    let from = this._esriServiceOptions.from;
    let to = this._esriServiceOptions.to;
    if (from instanceof Date) from = from.valueOf();
    if (to instanceof Date) to = to.valueOf();

    return `${from},${to}`;
  }

  _getTile(tile, tolerance) {
    const tileBounds = tilebelt.tileToBBOX(tile);

    const extent = {
      spatialReference: {
        latestWkid: 4326,
        wkid: 4326,
      },
      xmin: tileBounds[0],
      ymin: tileBounds[1],
      xmax: tileBounds[2],
      ymax: tileBounds[3],
    };

    const params = new URLSearchParams({
      f: this._esriServiceOptions.f,
      geometry: JSON.stringify(extent),
      where: this._esriServiceOptions.where,
      outFields: this._esriServiceOptions.outFields,
      outSR: 4326,
      returnZ: false,
      returnM: false,
      precision: this._esriServiceOptions.precision,
      quantizationParameters: JSON.stringify({
        extent,
        tolerance,
        mode: 'view',
      }),
      resultType: 'tile',
      spatialRel: 'esriSpatialRelIntersects',
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
    });

    if (this._time) params.append('time', this._time);

    this._appendTokenIfExists(params);

    return new Promise((resolve) => {
      fetch(
        `${`${this._esriServiceOptions.url}/query?${params.toString()}`}`,
        this._esriServiceOptions.fetchOptions
      )
        .then((response) =>
          this._esriServiceOptions.f === 'pbf' ? response.arrayBuffer() : response.json()
        )
        .then((data) => {
          let out;
          try {
            out =
              this._esriServiceOptions.f === 'pbf'
                ? tileDecode(new Uint8Array(data)).featureCollection
                : data;
          } catch (err) {
            console.error('Could not parse arcgis buffer. Please check the url you requested.');
          }
          resolve(out);
        });
    });
  }

  _updateFcOnMap(fc) {
    if (this._map.getSource(this.sourceId)) {
      this._map.getSource(this.sourceId).setData(fc);
    }
  }

  _doesTileOverlapBbox(tile, bbox) {
    const tileBounds = tile.length === 4 ? tile : tilebelt.tileToBBOX(tile);
    if (tileBounds[2] < bbox[0][0]) return false;
    if (tileBounds[0] > bbox[1][0]) return false;
    if (tileBounds[3] < bbox[0][1]) return false;
    if (tileBounds[1] > bbox[1][1]) return false;
    return true;
  }

  _getServiceMetadata() {
    if (this.serviceMetadata !== null) return Promise.resolve(this.serviceMetadata);

    const params = new URLSearchParams({ f: 'json' });

    this._appendTokenIfExists(params);
    return this._requestJson(
      `${this._esriServiceOptions.url}?${params.toString()}`,
      this._esriServiceOptions.fetchOptions
    ).then((data) => {
      // Esri sends error responses with a 200 status code, so handle them in `.then`
      if (data.error) {
        throw new Error(JSON.stringify(data.error));
      }
      this.serviceMetadata = data;
      return this.serviceMetadata;
    }).catch((error) => {
      // Handle authentication errors
      if (error instanceof EsriAuthError) {
        if (this._esriServiceOptions.onAuthError) {
          this._esriServiceOptions.onAuthError(error);
        }
        // Return a rejected promise to prevent further processing
        return Promise.reject(error);
      }
      throw error;
    });
  }

  getFeaturesByLonLat(lnglat, radius, returnGeometry) {
    returnGeometry = returnGeometry ? returnGeometry : false;
    radius = radius ? radius : 20;

    const params = new URLSearchParams({
      sr: 4326,
      geometryType: 'esriGeometryPoint',
      geometry: JSON.stringify({
        x: lnglat.lng,
        y: lnglat.lat,
        spatialReference: {
          wkid: 4326,
        },
      }),
      returnGeometry,
      time: this._time,
      outFields: '*',
      spatialRel: 'esriSpatialRelIntersects',
      units: 'esriSRUnit_Meter',
      distance: radius,
      f: 'geojson',
    });

    this._appendTokenIfExists(params);

    return new Promise((resolve) => {
      this._requestJson(
        `${this._esriServiceOptions.url}/query?${params.toString()}`,
        this._esriServiceOptions.fetchOptions
      ).then((data) => resolve(data));
    });
  }

  getFeaturesByObjectIds(objectIds, returnGeometry) {
    if (Array.isArray(objectIds)) objectIds = objectIds.join(',');
    returnGeometry = returnGeometry ? returnGeometry : false;
    const params = new URLSearchParams({
      sr: 4326,
      objectIds,
      returnGeometry,
      outFields: '*',
      f: 'geojson',
    });

    this._appendTokenIfExists(params);

    return new Promise((resolve) => {
      this._requestJson(
        `${this._esriServiceOptions.url}/query?${params.toString()}`,
        this._esriServiceOptions.fetchOptions
      ).then((data) => resolve(data));
    });
  }

  _projectBounds() {
    const extent = this.serviceMetadata.extent;
    if (!extent || !extent.spatialReference) {
      // Skip projection and continue without bounds
      return Promise.resolve();
    }

    // Get the spatial reference ID - prefer wkid, fallback to latestWkid
    const spatialRef = extent.spatialReference;
    let inSR = spatialRef.wkid || spatialRef.latestWkid;
    
    // If no WKID, we can't use the projection service - skip it
    if (!inSR) {
      // Skip projection and continue without bounds
      return Promise.resolve();
    }

    const params = new URLSearchParams({
      geometries: JSON.stringify({
        geometryType: 'esriGeometryEnvelope',
        geometries: [extent],
      }),
      inSR: String(inSR), // Ensure it's a string
      outSR: '4326',
      f: 'json',
    });
    let fetchOptions = {};
    if (!this._projectionEndpointIsFallback()) {
      fetchOptions = this._esriServiceOptions.fetchOptions;
      this._appendTokenIfExists(params);
    }

    return this._requestJson(
      `${this._esriServiceOptions.projectionEndpoint}?${params.toString()}`,
      fetchOptions
    )
      .then((data) => {
        if (data.geometries && data.geometries[0]) {
          const projectedExtent = data.geometries[0];
          this._maxExtent = [projectedExtent.xmin, projectedExtent.ymin, projectedExtent.xmax, projectedExtent.ymax];
        }
      })
      .catch((error) => {
        // Handle authentication errors
        if (error instanceof EsriAuthError) {
          if (this._esriServiceOptions.onAuthError) {
            this._esriServiceOptions.onAuthError(error);
          }
          // Return rejected promise to prevent further processing
          return Promise.reject(error);
        }
        // if projection endpoint has already been set to fallback, do not re-request project bounds
        if (this._projectionEndpointIsFallback()) {
          // Don't throw - just continue without bounds
          return Promise.resolve();
        } else {
          this._esriServiceOptions.projectionEndpoint = this._fallbackProjectionEndpoint;
          return this._projectBounds();
        }
      });
  }

  _requestJson(url, fetchOptions) {
    return new Promise((resolve, reject) => {
      fetch(url, fetchOptions)
        .then((response) => {
          // For non-OK responses, read the JSON body to check the actual error
          if (!response.ok) {
            // Try to read error message from response body
            return response.json().then((data) => {
              const err = data?.error;
              const msg = err?.message || err?.details?.[0] || '';
              const code = err?.code || response.status;

              // Only treat as auth error if error message explicitly mentions auth/token/login
              // Don't assume 400/403/498/499 are always auth errors - check the message
              const isAuthError = 
                code === 498 || // 498 is specifically "Invalid token"
                (code === 499 && (/token/i.test(msg) || /required/i.test(msg))) || // 499 is "Token Required" - but verify message
                (code === 400 && (/token/i.test(msg) || /authentication/i.test(msg) || /login/i.test(msg) || /invalid.*credential/i.test(msg) || /credential/i.test(msg) || /token.*required/i.test(msg))) ||
                (code === 403 && (/token/i.test(msg) || /authentication/i.test(msg) || /login/i.test(msg) || /invalid.*credential/i.test(msg) || /credential/i.test(msg) || /token.*required/i.test(msg))) ||
                /invalid.*token/i.test(msg) ||
                /token.*expired/i.test(msg) ||
                /token.*invalid/i.test(msg) ||
                /token.*required/i.test(msg) ||
                /authentication.*required/i.test(msg) ||
                /login.*required/i.test(msg) ||
                /credential.*invalid/i.test(msg);

              if (isAuthError) {
                reject(
                  new EsriAuthError(
                    'Authentication required. Please login to access this ESRI service.',
                    url
                  )
                );
              } else {
                reject(new Error(msg || `Request failed with status ${response.status}`));
              }
            }).catch(() => {
              // If we can't parse JSON, only treat 498 as auth error (499 needs message check)
              if (response.status === 498) {
                reject(
                  new EsriAuthError(
                    'Authentication required. Please login to access this ESRI service.',
                    url
                  )
                );
              } else {
                reject(new Error(`Request failed with status ${response.status}`));
              }
            });
            return;
          }
          return response.json();
        })
        .then((data) => {
          // If parsing failed, data might be undefined
          if (!data || typeof data !== 'object') {
            resolve(data);
            return;
          }

          if ('error' in data && data.error) {
            const err = data.error;
            const msg = err.message || err.details?.[0] || 'Request failed';
            const code = err.code;

            // Only treat as auth error if error message explicitly mentions auth/token/login
            const isAuthError = 
              code === 498 || // 498 is specifically "Invalid token"
              (code === 499 && (/token/i.test(msg) || /required/i.test(msg))) || // 499 is "Token Required" - but verify message
              (code === 400 && (/token/i.test(msg) || /authentication/i.test(msg) || /login/i.test(msg) || /invalid.*credential/i.test(msg) || /credential/i.test(msg) || /token.*required/i.test(msg))) ||
              (code === 403 && (/token/i.test(msg) || /authentication/i.test(msg) || /login/i.test(msg) || /invalid.*credential/i.test(msg) || /credential/i.test(msg) || /token.*required/i.test(msg))) ||
              /invalid.*token/i.test(msg) ||
              /token.*expired/i.test(msg) ||
              /token.*invalid/i.test(msg) ||
              /token.*required/i.test(msg) ||
              /authentication.*required/i.test(msg) ||
              /login.*required/i.test(msg) ||
              /credential.*invalid/i.test(msg);

            if (isAuthError) {
              reject(
                new EsriAuthError(
                  'Authentication required. Please login to access this ESRI service.',
                  url
                )
              );
            } else {
              reject(new Error(msg || 'Endpoint does not exist'));
            }
            return;
          }
          resolve(data as any);
        })
        .catch((error) => {
          // If error is already an EsriAuthError, pass it through
          if (error instanceof EsriAuthError) {
            reject(error);
          } else {
            reject(error);
          }
        });
    });
  }

  _projectionEndpointIsFallback() {
    return this._esriServiceOptions.projectionEndpoint === this._fallbackProjectionEndpoint;
  }

  _setAttribution() {
    const POWERED_BY_ESRI_ATTRIBUTION_STRING = 'Powered by <a href="https://www.esri.com">Esri</a>';

    const attributionController = this._map._controls.find((c) => '_attribHTML' in c);

    if (!attributionController) return;

    const customAttribution = attributionController.options.customAttribution;

    if (typeof customAttribution === 'string') {
      attributionController.options.customAttribution = `${customAttribution} | ${POWERED_BY_ESRI_ATTRIBUTION_STRING}`;
    } else if (customAttribution === undefined) {
      attributionController.options.customAttribution = POWERED_BY_ESRI_ATTRIBUTION_STRING;
    } else if (Array.isArray(customAttribution)) {
      if (customAttribution.indexOf(POWERED_BY_ESRI_ATTRIBUTION_STRING) === -1) {
        customAttribution.push(POWERED_BY_ESRI_ATTRIBUTION_STRING);
      }
    }

    if (
      this._esriServiceOptions.setAttributionFromService &&
      this.serviceMetadata.copyrightText.length > 0
    ) {
      this._map.style.sourceCaches[this.sourceId]._source.attribution =
        this.serviceMetadata.copyrightText;
    }

    attributionController._updateAttributions();
  }

  _appendTokenIfExists(params) {
    const token = this._esriServiceOptions.token;
    // Only append token if it's actually provided and not empty
    if (token && typeof token === 'string' && token.trim() !== '') {
      params.append('token', token);
    }
    // If token is null, undefined, or empty string, don't append it
  }

  /**
   * Apply ESRI renderer styles to the map
   * This will create Mapbox layers based on the ESRI renderer configuration
   */
  applyEsriRendererStyles() {
    if (!this.serviceMetadata || !this.serviceMetadata.drawingInfo?.renderer) {
      return;
    }

    // Wait for map style to be loaded before adding layers
    if (!this._map.isStyleLoaded()) {
      this._map.once('styledata', () => {
        this.applyEsriRendererStyles();
      });
      return;
    }

    // Ensure source exists
    if (!this._map.getSource(this.sourceId)) {
      return;
    }

    const layerJson: EsriLayerJson = {
      drawingInfo: this.serviceMetadata.drawingInfo,
      geometryType: this.serviceMetadata.geometryType,
      popupInfo: this.serviceMetadata.popupInfo,
    };

    const mbLayers = mapboxLayersFromEsriLayer(layerJson, {
      source: this.sourceId,
      layerIdPrefix: this.sourceId,
      addPolygonOutline: true,
    });

    if (mbLayers.length === 0) {
      return;
    }

    // Remove existing layers with this sourceId prefix
    const existingLayers = this._map.getStyle().layers.filter((l: any) =>
      l.id.startsWith(`${this.sourceId}-`)
    );
    existingLayers.forEach((layer: any) => {
      try {
        this._map.removeLayer(layer.id);
      } catch (e) {
        // Layer might not exist
      }
    });

    // Add new layers
    mbLayers.forEach((layer: any) => {
      if (layer['source-layer']) delete layer['source-layer'];
      if (typeof layer.filter === 'undefined') delete layer.filter;
      try {
        this._map.addLayer(layer);
      } catch (e) {
        // Layer add failed
      }
    });
  }

  /**
   * Get popupInfo for this service
   */
  getPopupInfo() {
    return this._esriServiceOptions.popupInfo || this.serviceMetadata?.popupInfo || null;
  }

  /**
   * Generate ESRI token from username/password
   */
  static async generateEsriToken(serverUrl: string, username: string, password: string): Promise<string> {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const urlObj = new URL(serverUrl);
    
    // Check if this is an ArcGIS Online server (arcgis.com domain)
    const isArcGISOnline = urlObj.hostname.includes('arcgis.com') || 
                           urlObj.hostname.includes('maps.arcgis.com') ||
                           urlObj.hostname.includes('services.arcgis.com') ||
                           urlObj.hostname.includes('services1.arcgis.com') ||
                           urlObj.hostname.includes('services2.arcgis.com') ||
                           urlObj.hostname.includes('services3.arcgis.com') ||
                           urlObj.hostname.includes('services4.arcgis.com') ||
                           urlObj.hostname.includes('services5.arcgis.com') ||
                           urlObj.hostname.includes('services6.arcgis.com') ||
                           urlObj.hostname.includes('services7.arcgis.com') ||
                           urlObj.hostname.includes('services8.arcgis.com') ||
                           urlObj.hostname.includes('services9.arcgis.com');
    
    // Extract server root URL for on-premise servers
    const pathParts = urlObj.pathname.split('/').filter((p) => p);
    const restIndex = pathParts.indexOf('rest');
    
    let serverRoot: string;
    if (restIndex >= 0) {
      serverRoot = `${urlObj.origin}/${pathParts.slice(0, restIndex + 1).join('/')}`;
    } else {
      serverRoot = `${urlObj.origin}/arcgis/rest`;
    }
    
    // For ArcGIS Online, use the portal token service
    // For on-premise, try server-specific endpoints
    const tokenEndpoints = isArcGISOnline
      ? ['https://www.arcgis.com/sharing/rest/generateToken']
      : [
          `${serverRoot}/tokens/generateToken`,
          `${serverRoot}/tokens`,
          `${urlObj.origin}/arcgis/tokens/generateToken`,
          `${urlObj.origin}/tokens/generateToken`,
        ];
    
    let lastError: Error | null = null;
    
    for (const tokenUrl of tokenEndpoints) {
      try {
        // Get the referer URL (current page origin)
        const referer = typeof window !== 'undefined' 
          ? (window.location.origin || 'http://localhost')
          : 'http://localhost';

        const params = new URLSearchParams({
          username,
          password,
          f: 'json',
          expiration: '60' // 60 minutes
        });

        // For ArcGIS Online, we need to specify the referer as a parameter
        if (isArcGISOnline) {
          params.append('referer', referer);
        }

        const fetchOptions: RequestInit = {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params,
          redirect: 'follow' // Follow redirects automatically
        };

        // Also set Referer header for good measure
        if (isArcGISOnline) {
          (fetchOptions.headers as Record<string, string>)['Referer'] = referer;
        }

        const response = await fetch(tokenUrl, fetchOptions);

        // Handle redirects manually if needed
        if (response.status === 301 || response.status === 302 || response.status === 303 || 
            response.status === 307 || response.status === 308) {
          const location = response.headers.get('location');
          if (location) {
            // Try the redirect location
            const redirectUrl = new URL(location, tokenUrl).href;
            const redirectResponse = await fetch(redirectUrl, fetchOptions);
            return await this.processTokenResponse(redirectResponse);
          }
        }

        return await this.processTokenResponse(response);
      } catch (err: any) {
        if (err.message && !err.message.includes('Invalid token endpoint') && 
            !err.message.includes('Authentication failed')) {
          throw err; // Re-throw if it's not about the endpoint
        }
        lastError = err;
      }
    }
    
    // If all endpoints failed, throw the last error or a generic one
    throw lastError || new Error('Unable to connect to authentication service. Please verify the server URL or use a token instead.');
  }

  private static async processTokenResponse(response: Response): Promise<string> {
    if (!response.ok) {
      // Check if it's a redirect that wasn't followed
      if (response.status === 301 || response.status === 302 || response.status === 303 ||
          response.status === 307 || response.status === 308) {
        throw new Error('Token endpoint redirected. This server may require a different authentication method.');
      }
      throw new Error(`Authentication failed: Server returned ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // Server returned HTML or other non-JSON response
      const text = await response.text();
      if (text.includes('<html') || text.includes('<!DOCTYPE')) {
        throw new Error('Invalid token endpoint. This server may not support username/password authentication. Try using a token instead.');
      }
      throw new Error('Server returned an unexpected response format');
    }

    const data = await response.json();
    
    if (data.error) {
      const errorMsg = data.error.message || data.error.details?.[0] || 'Authentication failed';
      throw new Error(errorMsg);
    }

    if (!data.token) {
      throw new Error('No token received from server');
    }

    return data.token;
  }
}