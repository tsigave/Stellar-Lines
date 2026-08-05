import { useMemo } from "react";

interface SpaceBackdropProps {
  id: string;
  seed: string;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function randomSequence(seed: string) {
  let state = hashSeed(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

export function SpaceBackdrop({ id, seed }: SpaceBackdropProps) {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const stars = useMemo(() => {
    const random = randomSequence(seed);
    return Array.from({ length: 72 }, (_, index) => ({
      id: index,
      x: random() * 310,
      y: random() * 220,
      radius: 0.28 + random() * (random() > 0.91 ? 1.45 : 0.72),
      opacity: 0.18 + random() * 0.66,
      tint: random() > 0.82 ? "#9ac8df" : random() > 0.86 ? "#d9c2a1" : "#d9edfa",
    }));
  }, [seed]);

  return (
    <g className="space-backdrop" pointerEvents="none">
      <defs>
        <pattern id={`${safeId}-starfield`} width="310" height="220" patternUnits="userSpaceOnUse">
          {stars.map((star) => (
            <circle
              key={star.id}
              cx={star.x}
              cy={star.y}
              r={star.radius}
              fill={star.tint}
              opacity={star.opacity}
            />
          ))}
        </pattern>
        <radialGradient id={`${safeId}-void-glow`} cx="48%" cy="46%" r="68%">
          <stop offset="0" stopColor="#0a1722" stopOpacity="0.48" />
          <stop offset="0.52" stopColor="#050c13" stopOpacity="0.24" />
          <stop offset="1" stopColor="#010307" stopOpacity="0.74" />
        </radialGradient>
      </defs>
      <rect x="-1200" y="-900" width="3300" height="2400" fill={`url(#${safeId}-starfield)`} />
      <rect x="-1200" y="-900" width="3300" height="2400" fill={`url(#${safeId}-void-glow)`} />
    </g>
  );
}
