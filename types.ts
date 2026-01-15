export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface GridParameters {
  // Geometry
  pixelSize: number;
  gap: number;
  
  // Colors (RGB Strings for ease of use in UI, parsed internally)
  bgColor: string;
  baseGray: string;
  accentYellow: string;
  accentPink: string;

  // Density / Probabilities
  blankProb: number;
  accentYellowProb: number;
  accentPinkProb: number;
  
  // Alpha Ranges
  baseAlphaMin: number;
  baseAlphaMax: number;
  accentAlphaMin: number;
  accentAlphaMax: number;

  // Motion
  fieldScaleCells: number;
  fieldTimeScale: number;
  twinkleSpeed: number;
  twinkleAmp: number;
  
  // Toggles
  showGrid: boolean; // Debug grid
}
