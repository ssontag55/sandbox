/**
 * ESRI Popup Formatting Utilities
 * Formats popups based on ESRI popupInfo configuration
 */

import React from 'react';

export function isEsriSystemField(fieldName: string): boolean {
  if (!fieldName) return true;
  const name = String(fieldName).toLowerCase();
  const systemFields = [
    'objectid', 'objectid_1', 'fid', 'id', 'globalid', 'globalid_2', 'globalid_3',
    'shape', 'shape_length', 'shape_area', 'shape.stlength()', 'shape.starea()',
    'shapestlength', 'shapestlen', 'shapestarea', 'shapestare',
    'created_user', 'created_date', 'last_edited_user', 'last_edited_date',
    'creationdate', 'creator', 'editdate', 'editor'
  ];
  return systemFields.includes(fieldName.toLowerCase()) ||
         systemFields.includes(fieldName.toUpperCase()) ||
         name.startsWith('shape_') || name.startsWith('shape.') || name.startsWith('shapest') ||
         /^globalid(_\d+)?$/i.test(fieldName);
}

export function formatPopupExpression(expression: string, properties: any): string {
  if (typeof expression === 'string') {
    return expression.replace(/\{([^}]+)\}/g, (match, fieldName) => {
      const value = properties[fieldName];
      return value != null ? String(value) : match;
    });
  }
  return String(expression);
}

export function formatValue(value: any): string {
  if (value == null) return '';
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  return String(value);
}

export function formatFieldValue(value: any, format: any): string {
  if (format?.places != null && typeof value === 'number') {
    return value.toFixed(format.places);
  }
  if (format?.dateFormat && value) {
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.toLocaleDateString();
      }
    } catch (e) {
      // Ignore
    }
  }
  return formatValue(value);
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

export function formatEsriPopup(feature: any, popupInfo: any, displayField?: string | null): React.ReactElement | null {
  if (!feature || !feature.properties) return null;
  
  const props = feature.properties;
  const elements: React.ReactNode[] = [];

  // Format title - use displayField value if available, otherwise use popupInfo title
  let title: string | null = null;
  if (displayField && props[displayField]) {
    title = String(props[displayField]);
  } else if (popupInfo?.title) {
    title = formatPopupExpression(popupInfo.title, props);
  }

  if (title) {
    elements.push(
      <div key="title" style={{ marginBottom: '8px', fontSize: '14px', lineHeight: 1.5 }}>
        {title}
      </div>
    );
    // Add separator line after title
    elements.push(
      <div key="separator" style={{ height: '1px', backgroundColor: '#e0e0e0', marginBottom: '8px' }} />
    );
  }

  // Format field infos
  if (popupInfo?.fieldInfos && Array.isArray(popupInfo.fieldInfos)) {
    const fieldElements: React.ReactNode[] = [];
    popupInfo.fieldInfos.forEach((fieldInfo: any, index: number) => {
      if (!fieldInfo.visible && fieldInfo.visible !== undefined) return;
      
      const fieldName = fieldInfo.fieldName;
      if (isEsriSystemField(fieldName)) return;
      
      const label = fieldInfo.label || fieldName;
      let value = props[fieldName];
      if (value == null || value === '') return;

      if (fieldInfo.format) {
        value = formatFieldValue(value, fieldInfo.format);
      } else {
        value = formatValue(value);
      }

      fieldElements.push(
        <div key={index} style={{ marginBottom: '6px', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 'bold', color: '#1a1a1a' }}>{label}:</span>
          <span style={{ color: '#1a1a1a', marginLeft: '4px' }}>{value}</span>
        </div>
      );
    });
    
    if (fieldElements.length > 0) {
      elements.push(
        <div key="fields" style={{ marginTop: '8px' }}>
          {fieldElements}
        </div>
      );
    }
  } else {
    // Fallback: show all properties
    const fieldElements: React.ReactNode[] = [];
    let index = 0;
    for (const [key, value] of Object.entries(props)) {
      if (isEsriSystemField(key) || value == null || value === '') continue;
      fieldElements.push(
        <div key={index++} style={{ marginBottom: '6px', lineHeight: 1.5 }}>
          <span style={{ fontWeight: 'bold', color: '#1a1a1a' }}>{key}:</span>
          <span style={{ color: '#1a1a1a', marginLeft: '4px' }}>{formatValue(value)}</span>
        </div>
      );
    }
    
    if (fieldElements.length > 0) {
      elements.push(
        <div key="fields" style={{ marginTop: '8px' }}>
          {fieldElements}
        </div>
      );
    }
  }

  return elements.length > 0 ? <>{elements}</> : null;
}

export function formatSimplePopup(properties: any, displayField?: string | null): React.ReactElement | null {
  if (!properties) return null;
  
  const elements: React.ReactNode[] = [];
  
  // Use displayField as title if available
  if (displayField && properties[displayField]) {
    elements.push(
      <div key="title" style={{ marginBottom: '8px', fontSize: '14px', lineHeight: 1.5 }}>
        {String(properties[displayField])}
      </div>
    );
    // Add separator line after title
    elements.push(
      <div key="separator" style={{ height: '1px', backgroundColor: '#e0e0e0', marginBottom: '8px' }} />
    );
  }
  
  let count = 0;
  for (const [key, value] of Object.entries(properties)) {
    if (isEsriSystemField(key) || value == null || value === '' || count >= 15) continue;
    // Skip displayField if we already showed it as title
    if (displayField && key === displayField) continue;
    
    elements.push(
      <div key={count} style={{ marginBottom: '6px', lineHeight: 1.5 }}>
        <span style={{ fontWeight: 'bold', color: '#1a1a1a' }}>{key}:</span>
        <span style={{ color: '#1a1a1a', marginLeft: '4px' }}>{String(value)}</span>
      </div>
    );
    count++;
  }
  
  return elements.length > 0 ? <div style={{ fontSize: '14px', lineHeight: 1.6 }}>{elements}</div> : null;
}

