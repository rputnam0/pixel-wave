import React, { useEffect, useRef } from 'react';
import { createNoise3D } from 'simplex-noise';
import seedrandom from 'seedrandom';
import GUI from 'lil-gui'; 

// --- Helper Functions ---
type RGB = { r: number, g: number, b: number };

function hexToRgb(hex: string): RGB {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function lerpColor(c1: RGB, c2: RGB, t: number): string {
    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    return `rgb(${r}, ${g}, ${b})`;
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PixelGridBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // --- Parameters ---
  const params = useRef({
    // Geometry
    pixelSize: 3,
    gap: 5,
    
    // Palette (Strings for GUI)
    bgColorStr: '#F6F2EF',
    baseGrayStr: '#D9D7D2',
    accentYellowStr: '#F5F7D9',
    accentPinkStr: '#FFEAEA',

    // Probabilities
    accentYellowProb: 0.25, 
    accentPinkProb: 0.1,

    // Masking (Vertical Fade)
    maskHeight: 1.0,     // 1.0 = Full screen, 0.33 = Bottom 3rd
    maskFeatherY: 0.2,   // Softness of the vertical fade

    // Macro Wave (The "Moving Cloud")
    macroScale: 0.012,   // Larger, softer clouds
    macroVx: 2.5,        // Moderate drift speed for "wafting"
    macroVy: -1.0,       // Slight upward drift
    macroTimeScale: 0.003, // Very slow evolution (prevents pulsating), movement dominates
    macroThreshold: 0.35, 
    macroFeather: 0.15,  // Softer edges for smoke look

    // Micro Gate (The "Patchy Texture")
    microScale: 0.08,    // Medium grain
    microTimeScale: 0.01,// Slow morphing
    microThreshold: 0.2,
    microFeather: 0.2,

    // Cell Personality
    biasStrength: 0.5, 
    
    // Mixing & smoothing
    accentMixStrength: 1.0,
    mixGamma: 1.8,
    smoothing: 0.15,     // Increased smoothing for fluid feel

    // Alpha / Visibility
    baseAlpha: 0.25,
    activeAlphaBoost: 0.35,

    // Debug
    enableAnimation: true,
    debugView: false,
  });

  // Parsed colors
  const palette = useRef({
      bg: {r:0, g:0, b:0},
      gray: {r:0, g:0, b:0},
      yellow: {r:0, g:0, b:0},
      pink: {r:0, g:0, b:0},
  });

  // Separate noise instances for uncorrelated fields
  const macroNoise = useRef(createNoise3D(seedrandom('macro'))).current;
  const microNoise = useRef(createNoise3D(seedrandom('micro'))).current;
  
  const animationFrameId = useRef<number>(0);
  
  // Grid Data
  const gridData = useRef<{
    cols: number;
    rows: number;
    // 0: Gray, 1: Yellow, 2: Pink. 
    targetTypes: Uint8Array; 
    biases: Float32Array;      // -1 to 1
    activations: Float32Array; // 0 to 1 (Current interpolated state)
  } | null>(null);

  const updatePalette = () => {
      const p = params.current;
      palette.current.bg = hexToRgb(p.bgColorStr);
      palette.current.gray = hexToRgb(p.baseGrayStr);
      palette.current.yellow = hexToRgb(p.accentYellowStr);
      palette.current.pink = hexToRgb(p.accentPinkStr);
  };

  // --- Initialization ---
  const initGrid = (width: number, height: number) => {
    updatePalette();
    const p = params.current;
    const pitch = p.pixelSize + p.gap;
    
    const cols = Math.ceil(width / pitch);
    const rows = Math.ceil(height / pitch);
    const numCells = cols * rows;

    const targetTypes = new Uint8Array(numCells);
    const biases = new Float32Array(numCells);
    const activations = new Float32Array(numCells);

    const rng = seedrandom('grid-layout-fixed'); 

    for (let i = 0; i < numCells; i++) {
        // Bias: stable random value per cell (-1 to 1)
        biases[i] = rng() * 2 - 1; 

        // Neighbor check to prevent clustering of accents
        const x = i % cols;
        const y = Math.floor(i / cols);
        
        let hasAccentNeighbor = false;
        // Expanded neighbor check to force spread
        // Checking "past" pixels that have already been generated
        // Reduced radius from 2 to 1 to allow higher density of accents
        const radius = 1; 
        
        for (let dy = -radius; dy <= 0; dy++) {
             // For the current row (dy=0), only check columns to the left (dx<0)
             const maxDx = (dy === 0) ? -1 : radius;
             for (let dx = -radius; dx <= maxDx; dx++) {
                 const nx = x + dx;
                 const ny = y + dy;
                 if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
                     const idx = ny * cols + nx;
                     if (targetTypes[idx] !== 0) {
                         hasAccentNeighbor = true;
                         break;
                     }
                 }
             }
             if (hasAccentNeighbor) break;
        }

        let type = 0; // Default Gray
        // Only assign accent if neighbors are clear
        if(!hasAccentNeighbor) {
            const r = rng();
            if(r < p.accentYellowProb) type = 1;
            else if (r < p.accentYellowProb + p.accentPinkProb) type = 2;
        }
        targetTypes[i] = type;
        activations[i] = 0;
    }

    gridData.current = { cols, rows, targetTypes, biases, activations };
  };

  const draw = (time: number) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx || !gridData.current) return;

    const p = params.current;
    const pal = palette.current;
    const { cols, rows, targetTypes, biases, activations } = gridData.current;
    const { pixelSize, gap } = p;
    const pitch = pixelSize + gap;

    // Clear background
    const bgRgb = pal.bg;
    ctx.fillStyle = `rgb(${bgRgb.r},${bgRgb.g},${bgRgb.b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const t = prefersReducedMotion() ? 0 : time * 0.001;

    for (let y = 0; y < rows; y++) {
      // --- Vertical Mask Calculation ---
      // ny is normalized Y from 0 (top) to 1 (bottom)
      const ny = y / rows;
      // We want the active region to be at the bottom (near 1.0).
      // If maskHeight is 1.0, threshold is 0. If maskHeight is 0.3, threshold is 0.7.
      const threshold = 1.0 - p.maskHeight;
      
      // Calculate mask value with feathering
      // Values below threshold become <= 0 (invisible)
      // Values above threshold + feather become >= 1 (fully visible)
      let maskVal = (ny - threshold) / p.maskFeatherY;
      maskVal = Math.max(0, Math.min(1, maskVal));

      // Optimization: Skip row if completely transparent
      if (maskVal <= 0) continue;

      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        
        // --- 1. Compute Macro Wave (The Moving Cloud) ---
        // Advection: we effectively move the noise field over the grid
        const macroX = (x + t * p.macroVx) * p.macroScale;
        const macroY = (y + t * p.macroVy) * p.macroScale;
        const macroVal = (macroNoise(macroX, macroY, t * p.macroTimeScale) + 1) * 0.5; // 0..1
        
        // Macro Mask: Thresholding with feather
        const macroStart = p.macroThreshold - p.macroFeather;
        const macroEnd = p.macroThreshold + p.macroFeather;
        let macroMask = (macroVal - macroStart) / (macroEnd - macroStart);
        // Smoothstep clamping
        macroMask = Math.max(0, Math.min(1, macroMask));
        macroMask = macroMask * macroMask * (3 - 2 * macroMask); 

        // --- 2. Compute Micro Gate (The Patchy Texture) ---
        // Advection: Move the micro texture WITH the macro wave to create "wafting smoke"
        // Using the same velocity ensures the texture travels with the cloud
        const microX = (x + t * p.macroVx) * p.microScale;
        const microY = (y + t * p.macroVy) * p.microScale;
        const microVal = (microNoise(microX, microY, t * p.microTimeScale) + 1) * 0.5;
        
        const microStart = p.microThreshold - p.microFeather;
        const microEnd = p.microThreshold + p.microFeather;
        let microMask = (microVal - microStart) / (microEnd - microStart);
        microMask = Math.max(0, Math.min(1, microMask));
        microMask = microMask * microMask * (3 - 2 * microMask);

        // --- 3. Combine & Bias ---
        let signal = macroMask * microMask;
        
        // Apply per-cell bias (personality)
        // This makes some cells eager (bias>0) and others resistant (bias<0)
        signal += biases[i] * p.biasStrength;
        
        // Clamp to 0..1 target
        let target = Math.max(0, Math.min(1, signal));
        
        // Gamma correction for snappier transitions
        if(p.mixGamma !== 1) target = Math.pow(target, p.mixGamma);

        // --- 4. Temporal Smoothing (EMA) ---
        // Smoothly interpolate current activation towards target
        const current = activations[i] + (target - activations[i]) * p.smoothing;
        activations[i] = current;

        // --- 5. Render ---
        
        // Debug visualization of the activation wave
        if (p.debugView) {
            const v = Math.floor(current * 255 * maskVal); // Apply mask to debug view too
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x * pitch, y * pitch, pixelSize, pixelSize);
            continue;
        }

        // Color Logic:
        // Type 0 (Gray) -> Stays Gray
        // Type 1/2 (Accent) -> Transitions from Gray to Accent based on activation
        const type = targetTypes[i];
        let finalColorStr = '';
        
        if (type === 0) {
             finalColorStr = p.baseGrayStr; 
        } else {
             const accent = type === 1 ? pal.yellow : pal.pink;
             // Apply Mix Strength logic
             const mix = Math.min(1, current * p.accentMixStrength);
             
             // Simple optimization for end states
             if (mix < 0.01) finalColorStr = p.baseGrayStr;
             else if (mix > 0.99) finalColorStr = type === 1 ? p.accentYellowStr : p.accentPinkStr;
             else finalColorStr = lerpColor(pal.gray, accent, mix);
        }

        // Alpha Logic:
        // Base visibility + boost when active.
        // Even gray pixels pulse slightly in opacity when the wave passes over them, 
        // preserving the "wave" structure even in gray areas.
        // FINAL STEP: Multiply by vertical maskVal to fade out top areas
        const alpha = (p.baseAlpha + (current * p.activeAlphaBoost)) * maskVal;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = finalColorStr;
        ctx.fillRect(x * pitch, y * pitch, pixelSize, pixelSize);
      }
    }
  };

  const handleResize = () => {
    if (!containerRef.current || !canvasRef.current) return;
    const { clientWidth: w, clientHeight: h } = containerRef.current;
    const dpr = window.devicePixelRatio || 1;
    
    canvasRef.current.width = w * dpr;
    canvasRef.current.height = h * dpr;
    
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }

    initGrid(w, h);
    draw(performance.now());
  };

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    
    const gui = new GUI({ title: 'Grid Tuner' });
    const p = params.current;
    const update = () => handleResize(); // Re-init on destructive changes
    
    // UI Folders
    const fGeo = gui.addFolder('Geometry');
    fGeo.add(p, 'pixelSize', 1, 10, 1).onChange(update);
    fGeo.add(p, 'gap', 0, 20, 1).onChange(update);

    const fColors = gui.addFolder('Colors');
    fColors.addColor(p, 'bgColorStr').onChange(updatePalette);
    fColors.addColor(p, 'baseGrayStr').onChange(updatePalette);
    fColors.addColor(p, 'accentYellowStr').onChange(updatePalette);
    fColors.addColor(p, 'accentPinkStr').onChange(updatePalette);
    fColors.add(p, 'accentYellowProb', 0, 0.5).onChange(update);
    fColors.add(p, 'accentPinkProb', 0, 0.2).onChange(update);

    const fMask = gui.addFolder('Masking');
    fMask.add(p, 'maskHeight', 0, 1).name('Active Height');
    fMask.add(p, 'maskFeatherY', 0.01, 0.5).name('Feather');

    const fMacro = gui.addFolder('Macro Wave');
    fMacro.add(p, 'macroScale', 0.001, 0.05).name('Scale');
    fMacro.add(p, 'macroVx', -5, 5).name('Vel X');
    fMacro.add(p, 'macroVy', -5, 5).name('Vel Y');
    fMacro.add(p, 'macroThreshold', 0, 1).name('Threshold');
    fMacro.add(p, 'macroFeather', 0, 0.5).name('Feather');

    const fMicro = gui.addFolder('Micro Gate');
    fMicro.add(p, 'microScale', 0.01, 0.5).name('Scale');
    fMicro.add(p, 'microThreshold', 0, 1).name('Threshold');
    fMicro.add(p, 'biasStrength', 0, 1).name('Bias Str');

    const fLook = gui.addFolder('Look & Feel');
    fLook.add(p, 'accentMixStrength', 0, 2).name('Color Mix');
    fLook.add(p, 'mixGamma', 0.5, 3.0).name('Gamma');
    fLook.add(p, 'smoothing', 0.01, 0.5).name('Smoothing');
    fLook.add(p, 'baseAlpha', 0, 1).name('Base Alpha');
    fLook.add(p, 'activeAlphaBoost', 0, 1).name('Active Boost');
    fLook.add(p, 'debugView').name('Debug Mask');

    handleResize();

    const loop = (time: number) => {
      if (p.enableAnimation && !prefersReducedMotion()) {
        draw(time);
      }
      animationFrameId.current = requestAnimationFrame(loop);
    };
    animationFrameId.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId.current);
      gui.destroy();
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 z-0 pointer-events-none">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};

export default PixelGridBackground;