import type { PlanetType } from "../../types.js";

interface PlanetBodyProps {
  id: string;
  type: PlanetType;
  x: number;
  y: number;
  radius: number;
  hasRings: boolean;
  ringTilt: number;
  detailed?: boolean;
  surfaceRotationDegrees?: number;
  axialTiltDegrees?: number;
}

interface PlanetPalette {
  highlight: string;
  base: string;
  shadow: string;
  feature: string;
  atmosphere: string;
}

const PALETTES: Record<PlanetType, PlanetPalette> = {
  terrestrial: { highlight: "#b7dba7", base: "#39765e", shadow: "#102b2b", feature: "#496d39", atmosphere: "#72d8db" },
  "super-earth": { highlight: "#c5d5d7", base: "#667f8b", shadow: "#1b2933", feature: "#8f725d", atmosphere: "#9bcbd8" },
  rocky: { highlight: "#c7b5a0", base: "#826f61", shadow: "#281f1a", feature: "#4e4037", atmosphere: "#9d958e" },
  ocean: { highlight: "#9ce6ed", base: "#247f9f", shadow: "#092a42", feature: "#b9dbca", atmosphere: "#70d8ef" },
  desert: { highlight: "#f0ce8c", base: "#bd7b3f", shadow: "#4a2518", feature: "#8e4f2b", atmosphere: "#e0b66d" },
  ice: { highlight: "#f2ffff", base: "#9ccbd4", shadow: "#314d62", feature: "#6da9ba", atmosphere: "#c9f5ff" },
  volcanic: { highlight: "#e78b54", base: "#7f2e29", shadow: "#1e1011", feature: "#ff824a", atmosphere: "#b65143" },
  "gas-giant": { highlight: "#efd2aa", base: "#a97558", shadow: "#38241f", feature: "#68483d", atmosphere: "#d9ad87" },
  "ice-giant": { highlight: "#bde3e8", base: "#4e91ae", shadow: "#18374f", feature: "#7bbdd0", atmosphere: "#8ed9ea" },
  dwarf: { highlight: "#b8b0aa", base: "#706964", shadow: "#221f20", feature: "#4a4544", atmosphere: "#827d79" },
};

function stableSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash % 997) + 1;
}

export function PlanetBody({
  id,
  type,
  x,
  y,
  radius,
  hasRings,
  ringTilt,
  detailed = false,
  surfaceRotationDegrees = 0,
  axialTiltDegrees = 0,
}: PlanetBodyProps) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const palette = PALETTES[type];
  const giant = type === "gas-giant" || type === "ice-giant";
  const icy = type === "ice";
  const rocky = type === "rocky" || type === "dwarf" || type === "desert";
  const living = type === "terrestrial" || type === "ocean" || type === "super-earth";
  const turbulenceFrequency = giant ? "0.008 0.075" : rocky ? "0.055" : "0.028";
  const ringWidth = detailed ? 8 : 2.1;

  return (
    <g
      className={`planet-body ${detailed ? "detail-scale" : "system-scale"}`}
      transform={`rotate(${axialTiltDegrees} ${x} ${y})`}
    >
      <defs>
        <radialGradient id={`${safeId}-sphere`} cx="31%" cy="24%" r="76%">
          <stop offset="0" stopColor={palette.highlight} />
          <stop offset="0.36" stopColor={palette.base} />
          <stop offset="0.76" stopColor={palette.shadow} />
          <stop offset="1" stopColor="#020509" />
        </radialGradient>
        <radialGradient id={`${safeId}-lighting`} cx="31%" cy="24%" r="76%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.3" />
          <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="0.76" stopColor="#000000" stopOpacity="0.24" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.84" />
        </radialGradient>
        <clipPath id={`${safeId}-clip`}>
          <circle cx={x} cy={y} r={radius} />
        </clipPath>
        <filter id={`${safeId}-texture`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
          <feTurbulence
            type="fractalNoise"
            baseFrequency={turbulenceFrequency}
            numOctaves={giant ? 2 : 4}
            seed={stableSeed(id)}
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values=".34 .34 .34 0 0  .34 .34 .34 0 0  .34 .34 .34 0 0  0 0 0 .28 0"
            result="texture"
          />
          <feComposite in="texture" in2="SourceAlpha" operator="in" result="clippedTexture" />
          <feBlend in="SourceGraphic" in2="clippedTexture" mode="soft-light" />
        </filter>
        <linearGradient id={`${safeId}-ring`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8c7b5d" stopOpacity="0.18" />
          <stop offset="0.35" stopColor="#e7d7aa" stopOpacity="0.82" />
          <stop offset="0.7" stopColor="#b7a47f" stopOpacity="0.58" />
          <stop offset="1" stopColor="#685c49" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {hasRings && (
        <ellipse
          cx={x}
          cy={y}
          rx={radius * 1.72}
          ry={radius * 0.4}
          fill="none"
          stroke={`url(#${safeId}-ring)`}
          strokeWidth={ringWidth}
          transform={`rotate(${ringTilt} ${x} ${y})`}
          className="planet-ring-back"
        />
      )}

      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={`url(#${safeId}-sphere)`}
        filter={detailed ? `url(#${safeId}-texture)` : undefined}
      />

      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={`url(#${safeId}-lighting)`}
        pointerEvents="none"
      />

      {detailed && (
        <g
          clipPath={`url(#${safeId}-clip)`}
          className="planet-surface-features"
          pointerEvents="none"
          transform={`rotate(${surfaceRotationDegrees} ${x} ${y})`}
        >
          {giant && [-0.52, -0.26, 0.02, 0.29, 0.54].map((offset, index) => (
            <path
              key={offset}
              d={`M ${x - radius * 1.05} ${y + radius * offset} Q ${x} ${y + radius * (offset + (index % 2 ? 0.12 : -0.1))} ${x + radius * 1.05} ${y + radius * offset}`}
              fill="none"
              stroke={index % 2 ? palette.highlight : palette.feature}
              strokeWidth={radius * (index === 2 ? 0.11 : 0.065)}
              opacity={index === 2 ? 0.34 : 0.24}
            />
          ))}
          {living && (
            <>
              <ellipse cx={x - radius * 0.22} cy={y - radius * 0.08} rx={radius * 0.34} ry={radius * 0.19} fill={palette.feature} opacity="0.62" transform={`rotate(-22 ${x} ${y})`} />
              <ellipse cx={x + radius * 0.29} cy={y + radius * 0.28} rx={radius * 0.27} ry={radius * 0.13} fill={palette.feature} opacity="0.48" transform={`rotate(18 ${x} ${y})`} />
              <path d={`M ${x - radius} ${y - radius * 0.35} Q ${x - radius * 0.15} ${y - radius * 0.58} ${x + radius} ${y - radius * 0.26}`} fill="none" stroke="#eef9f3" strokeWidth={radius * 0.045} opacity="0.36" />
            </>
          )}
          {rocky && ([
            [-0.3, -0.18, 0.12], [0.24, 0.18, 0.16], [0.12, -0.42, 0.08], [-0.42, 0.36, 0.07],
          ] as const).map(([offsetX, offsetY, size], index) => (
            <circle
              key={index}
              cx={x + radius * offsetX}
              cy={y + radius * offsetY}
              r={radius * size}
              fill="none"
              stroke={palette.feature}
              strokeWidth={radius * 0.035}
              opacity="0.55"
            />
          ))}
          {icy && (
            <path d={`M ${x - radius * 0.75} ${y - radius * 0.34} L ${x - radius * 0.18} ${y + radius * 0.04} L ${x - radius * 0.4} ${y + radius * 0.62} M ${x + radius * 0.52} ${y - radius * 0.7} L ${x + radius * 0.12} ${y - radius * 0.05} L ${x + radius * 0.58} ${y + radius * 0.45}`} fill="none" stroke={palette.feature} strokeWidth={radius * 0.035} opacity="0.7" />
          )}
        </g>
      )}

      <circle
        cx={x}
        cy={y}
        r={radius + (detailed ? 1.8 : 0.5)}
        fill="none"
        stroke={palette.atmosphere}
        strokeWidth={detailed ? 2.6 : 0.8}
        opacity={type === "rocky" || type === "dwarf" ? 0.22 : 0.52}
        className="planet-atmosphere-rim"
      />

      {hasRings && (
        <path
          d={`M ${x - radius * 1.72} ${y} A ${radius * 1.72} ${radius * 0.4} 0 0 0 ${x + radius * 1.72} ${y}`}
          fill="none"
          stroke={`url(#${safeId}-ring)`}
          strokeWidth={ringWidth * 0.72}
          transform={`rotate(${ringTilt} ${x} ${y})`}
          className="planet-ring-front"
        />
      )}
    </g>
  );
}
