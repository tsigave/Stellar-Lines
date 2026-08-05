declare module "tsl-textures" {
  import type { Color } from "three";
  import type { Node } from "three/webgpu";

  interface TextureBaseOptions {
    scale?: number;
    seed?: number;
  }

  export interface GasGiantOptions extends TextureBaseOptions {
    turbulence?: number;
    blur?: number;
    colorA?: Color;
    colorB?: Color;
    colorC?: Color;
  }

  export interface PlanetOptions extends TextureBaseOptions {
    iterations?: number;
    levelSea?: number;
    levelMountain?: number;
    balanceWater?: number;
    balanceSand?: number;
    balanceSnow?: number;
    colorDeep?: Color;
    colorShallow?: Color;
    colorBeach?: Color;
    colorGrass?: Color;
    colorForest?: Color;
    colorSnow?: Color;
  }

  export interface PhotosphereOptions extends TextureBaseOptions {
    color?: Color;
    background?: Color;
  }

  export function gasGiant(options?: GasGiantOptions): Node<"vec3">;
  export function planet(options?: PlanetOptions): Node<"vec3">;
  export function photosphere(options?: PhotosphereOptions): Node<"vec3">;
}
