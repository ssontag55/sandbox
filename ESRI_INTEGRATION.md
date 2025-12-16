# ESRI Feature Service Integration Guide

This document explains how to use the enhanced `FeatureService` class with ESRI authentication, style conversion, and popup support.

## Overview

The `FeatureService` class has been enhanced with:
1. **ESRI Authentication** - Support for username/password and token authentication
2. **ESRI Renderer to Mapbox Style Conversion** - Automatically converts ESRI renderers to Mapbox styles
3. **PopupInfo Support** - Access to ESRI popupInfo for feature identification
4. **Backward Compatibility** - Existing tile-based loading still works

## New Features

### 1. ESRI Style Conversion

The `FeatureService` can now automatically apply ESRI renderer styles to Mapbox layers.

**Usage in castamap.tsx:**
```typescript
const service = new FeatureService(sourceID, cMap, {
  name: sourceID,
  useStaticZoomLevel: false,
  setAttributionFromService: false,
  url: layer.layer_url,
  tiles: [],
  applyEsriStyles: true, // Enable ESRI style conversion
  token: layer.token || null, // Optional: provide token if needed
});
```

When `applyEsriStyles: true`:
- The service will automatically convert ESRI renderers (simple, uniqueValue, classBreaks) to Mapbox styles
- Multiple Mapbox layers will be created based on the renderer configuration
- Labels will be automatically added if `labelingInfo` is present
- Custom `layer.layer_style` will be ignored (ESRI renderer takes precedence)

### 2. Authentication Support

**Static Method - Generate Token:**
```typescript
import FeatureService, { EsriAuthError } from './FeatureService';

try {
  const token = await FeatureService.generateEsriToken(
    'https://services1.arcgis.com/.../FeatureServer/0',
    'username',
    'password'
  );
  // Use token in service options
} catch (error) {
  if (error instanceof EsriAuthError) {
    // Handle authentication error
  }
}
```

**Instance Method - Set Token:**
```typescript
const service = new FeatureService(sourceID, cMap, {
  url: layer.layer_url,
  token: null, // Initially no token
});

// Later, set token after authentication
service.setToken(generatedToken);
```

**Error Handling:**
The `_requestJson` method now throws `EsriAuthError` when a 400 status is detected, indicating authentication is required.

### 3. PopupInfo Access

Get popupInfo for creating popups:
```typescript
const service = new FeatureService(sourceID, cMap, options);
const popupInfo = service.getPopupInfo();

// Use popupInfo to format popups (see esri_to_mapbox_style.js for formatPopupFromEsriInfo)
```

### 4. Service Metadata Access

The service metadata (including popupInfo) is stored and accessible:
```typescript
// After service loads
const metadata = service.serviceMetadata;
const popupInfo = metadata.popupInfo;
const renderer = metadata.drawingInfo?.renderer;
```

## Integration with castamap.tsx

The updated `castamap.tsx` now:
1. Creates `FeatureService` instances with `applyEsriStyles: true`
2. Stores service references in `cMap._featureServices` for popup access
3. Falls back to custom styles if ESRI styles aren't available

**Example:**
```typescript
cMap.on('styledata', () => {
  displayedCustomLayerList.forEach((layer) => {
    const service = new FeatureService(layer.layer_name, cMap, {
      url: layer.layer_url,
      applyEsriStyles: true,
      token: layer.token || null,
    });
    
    // Store for popup access
    cMap._featureServices = cMap._featureServices || new Map();
    cMap._featureServices.set(layer.layer_name, service);
  });
});
```

## Files Created/Modified

1. **`mabox/esriStyleConverter.ts`** - New utility for converting ESRI renderers to Mapbox styles
2. **`mabox/FeatureService.tsx`** - Enhanced with:
   - `applyEsriRendererStyles()` method
   - `getPopupInfo()` method
   - `setToken()` method
   - `generateEsriToken()` static method
   - `EsriAuthError` class
   - Enhanced error handling for authentication
3. **`mabox/castamap.tsx`** - Updated to use new features

## Backward Compatibility

The existing tile-based loading system remains unchanged. If `applyEsriStyles` is `false` or not provided, the service works exactly as before.

## Next Steps

1. **Add Popup Handler**: Create a click handler in `castamap.tsx` that uses `service.getPopupInfo()` and formats popups
2. **Add Authentication UI**: Create a login modal similar to `index.html` for handling authentication
3. **Error Handling**: Add UI to handle `EsriAuthError` and prompt for credentials

## Example: Complete Integration

```typescript
// In castamap.tsx
const handleLayerClick = async (e: any, layerName: string) => {
  const service = cMap._featureServices?.get(layerName);
  if (!service) return;
  
  const popupInfo = service.getPopupInfo();
  const features = cMap.queryRenderedFeatures(e.point, {
    layers: cMap.getStyle().layers
      .filter(l => l.id.startsWith(`${layerName}-`))
      .map(l => l.id)
  });
  
  if (features.length > 0 && popupInfo) {
    // Format popup using popupInfo (see esri_to_mapbox_style.js)
    const popupContent = formatPopupFromEsriInfo(features[0], popupInfo);
    // Show popup...
  }
};
```

