import React from 'react';
import { generateLegendHtml } from '../../../../utils/esriStyleHelper';

interface LegendContentProps {
  layerName: string;
  layerJson: any;
}

export const LegendContent: React.FC<LegendContentProps> = ({ layerName, layerJson }) => {
  if (!layerJson) {
    return <span style={{ color: '#999', fontSize: '11px' }}>Loading legend...</span>;
  }
  
  const legendHtml = generateLegendHtml(layerJson);
  if (!legendHtml) {
    return null;
  }
  
  return <div dangerouslySetInnerHTML={{ __html: legendHtml }} />;
};

