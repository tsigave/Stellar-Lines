import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three/webgpu";
import { gasGiant, photosphere, planet } from "tsl-textures";
import type { PlanetType, StarSystem } from "../../types.js";

export interface CelestialRenderBody {
  id: string;
  kind: "star" | "planet" | "moon";
  x: number;
  y: number;
  radius: number;
  opacity: number;
  color?: string;
  spectralClass?: StarSystem["spectralClass"];
  planetType?: PlanetType;
  rotationDegrees?: number;
  axialTiltDegrees?: number;
  hasRings?: boolean;
  ringTilt?: number;
}

export interface CelestialCamera {
  centerX: number;
  centerY: number;
  viewWidth: number;
  viewHeight: number;
}

interface CelestialWebGpuLayerProps {
  bodies: readonly CelestialRenderBody[];
  camera: CelestialCamera;
  onReadyChange: (ready: boolean) => void;
}

interface BodyObject {
  group: THREE.Group;
  surface: THREE.Mesh | null;
  materials: THREE.Material[];
}

interface Runtime {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  objects: Map<string, BodyObject>;
  sphereGeometry: THREE.SphereGeometry;
  moonGeometry: THREE.SphereGeometry;
  ringGeometry: THREE.RingGeometry;
}

const PLANET_PALETTES: Record<PlanetType, readonly [string, string, string, string, string, string]> = {
  terrestrial: ["#082d4c", "#347f9c", "#d6c899", "#66a263", "#22553e", "#e9f3ef"],
  "super-earth": ["#183249", "#7197aa", "#b9977d", "#7c8f7c", "#485c56", "#dde7e8"],
  rocky: ["#342b28", "#76655c", "#9f8774", "#816b5c", "#443a35", "#c4b5a7"],
  ocean: ["#062b58", "#2b9abb", "#d7d9b7", "#62a889", "#2e665b", "#f2fbff"],
  desert: ["#6f3e22", "#a96335", "#e1bd77", "#b9773e", "#704024", "#edcf9b"],
  ice: ["#315a73", "#8bc7d6", "#d9edf0", "#a9d5dc", "#6da7b6", "#ffffff"],
  volcanic: ["#1b1111", "#58221e", "#d35b32", "#732b24", "#371513", "#ff9a4f"],
  "gas-giant": ["#4b2e28", "#8b5e47", "#e7c28e", "#be835e", "#6b4236", "#f2d8ae"],
  "ice-giant": ["#153e59", "#377f9d", "#9ed7df", "#66b3c6", "#2c718e", "#d5f5f8"],
  dwarf: ["#272426", "#5c5554", "#8d817b", "#6b6160", "#393436", "#aaa19d"],
};

const STAR_PALETTES: Record<
  StarSystem["spectralClass"],
  { surface: string; background: string; scale: number }
> = {
  O: { surface: "#eef4ff", background: "#4673d7", scale: 2.7 },
  B: { surface: "#edf3ff", background: "#6689dc", scale: 2.55 },
  A: { surface: "#fffdf5", background: "#9caed6", scale: 2.35 },
  F: { surface: "#fff5d6", background: "#d5aa6d", scale: 2.2 },
  G: { surface: "#fff0a8", background: "#d36d2d", scale: 2.05 },
  K: { surface: "#ffd18a", background: "#a94624", scale: 1.9 },
  M: { surface: "#ffad78", background: "#76202a", scale: 1.72 },
};

function stableSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) / 4_294_967_296 * 10_000;
}

function createPlanetMaterial(body: CelestialRenderBody): THREE.MeshStandardNodeMaterial {
  const type = body.planetType ?? "rocky";
  const colors = PLANET_PALETTES[type];
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: type === "ice" ? 0.58 : 0.78,
    metalness: 0,
    transparent: true,
  });
  const seed = stableSeed(body.id);

  if (type === "gas-giant" || type === "ice-giant") {
    material.colorNode = gasGiant({
      scale: type === "gas-giant" ? 1.7 : 1.25,
      turbulence: type === "gas-giant" ? 0.48 : 0.22,
      blur: type === "gas-giant" ? 0.48 : 0.72,
      colorA: new THREE.Color(colors[2]),
      colorB: new THREE.Color(colors[1]),
      colorC: new THREE.Color(colors[4]),
      seed,
    });
  } else {
    const ocean = type === "ocean" || type === "terrestrial" || type === "super-earth";
    material.colorNode = planet({
      scale: type === "dwarf" ? 2.8 : 2.15,
      iterations: type === "rocky" || type === "dwarf" ? 6 : 5,
      levelSea: type === "ocean" ? 0.72 : ocean ? 0.46 : 0.16,
      levelMountain: type === "ice" ? 0.62 : 0.71,
      balanceWater: 0.38,
      balanceSand: type === "desert" ? 0.88 : 0.26,
      balanceSnow: type === "ice" ? 0.2 : 0.78,
      colorDeep: new THREE.Color(colors[0]),
      colorShallow: new THREE.Color(colors[1]),
      colorBeach: new THREE.Color(colors[2]),
      colorGrass: new THREE.Color(colors[3]),
      colorForest: new THREE.Color(colors[4]),
      colorSnow: new THREE.Color(colors[5]),
      seed,
    });
  }

  return material;
}

function createBodyObject(body: CelestialRenderBody, runtime: Runtime): BodyObject {
  const group = new THREE.Group();
  let surface: THREE.Mesh | null = null;
  const materials: THREE.Material[] = [];

  if (body.kind === "star") {
    const palette = STAR_PALETTES[body.spectralClass ?? "G"];
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
    });
    material.colorNode = photosphere({
      scale: palette.scale,
      color: new THREE.Color(palette.surface),
      background: new THREE.Color(palette.background),
      seed: stableSeed(body.id),
    });
    materials.push(material);
    surface = new THREE.Mesh(runtime.sphereGeometry, material);
    group.add(surface);

    const glowMaterial = new THREE.MeshBasicNodeMaterial({
      color: body.color ?? "#ffd479",
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(runtime.sphereGeometry, glowMaterial);
    glow.scale.setScalar(1.28);
    materials.push(glowMaterial);
    group.add(glow);
  } else {
    const material = createPlanetMaterial(body);
    materials.push(material);
    surface = new THREE.Mesh(body.kind === "moon" ? runtime.moonGeometry : runtime.sphereGeometry, material);
    group.add(surface);

    const atmosphereMaterial = new THREE.MeshBasicNodeMaterial({
      color: PLANET_PALETTES[body.planetType ?? "rocky"][1],
      transparent: true,
      opacity: body.planetType === "rocky" || body.planetType === "dwarf" ? 0.035 : 0.085,
      depthWrite: false,
      side: THREE.BackSide,
    });
    const atmosphere = new THREE.Mesh(runtime.sphereGeometry, atmosphereMaterial);
    atmosphere.scale.setScalar(1.055);
    materials.push(atmosphereMaterial);
    group.add(atmosphere);

    if (body.hasRings) {
      const ringMaterial = new THREE.MeshBasicNodeMaterial({
        color: "#d7c595",
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(runtime.ringGeometry, ringMaterial);
      ring.position.z = -0.05;
      ring.scale.y = 0.32;
      ring.rotation.z = THREE.MathUtils.degToRad(body.ringTilt ?? 0);
      materials.push(ringMaterial);
      group.add(ring);
    }
  }

  runtime.scene.add(group);
  return { group, surface, materials };
}

function disposeBody(body: BodyObject, runtime: Runtime): void {
  runtime.scene.remove(body.group);
  for (const material of body.materials) material.dispose();
}

function renderLatest(
  runtime: Runtime,
  canvas: HTMLCanvasElement,
  bodiesRef: RefObject<readonly CelestialRenderBody[]>,
  cameraRef: RefObject<CelestialCamera>,
): void {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  runtime.renderer.setSize(width, height, false);

  const mapCamera = cameraRef.current;
  const left = mapCamera.centerX - mapCamera.viewWidth / 2;
  const right = mapCamera.centerX + mapCamera.viewWidth / 2;
  const top = mapCamera.centerY - mapCamera.viewHeight / 2;
  const bottom = mapCamera.centerY + mapCamera.viewHeight / 2;
  runtime.camera.left = left;
  runtime.camera.right = right;
  runtime.camera.top = -top;
  runtime.camera.bottom = -bottom;
  runtime.camera.updateProjectionMatrix();

  const activeIds = new Set<string>();
  for (const body of bodiesRef.current) {
    activeIds.add(body.id);
    let object = runtime.objects.get(body.id);
    if (!object) {
      object = createBodyObject(body, runtime);
      runtime.objects.set(body.id, object);
    }
    object.group.position.set(body.x, -body.y, body.kind === "moon" ? 2 : body.kind === "planet" ? 1 : 0);
    object.group.scale.setScalar(Math.max(0.001, body.radius));
    object.group.rotation.z = THREE.MathUtils.degToRad(body.axialTiltDegrees ?? 0);
    if (object.surface) {
      object.surface.rotation.y = THREE.MathUtils.degToRad(body.rotationDegrees ?? 0);
    }
    object.group.visible = body.opacity > 0.002;
    for (const material of object.materials) {
      const baseOpacity = material.userData.baseOpacity ?? material.opacity;
      material.userData.baseOpacity = baseOpacity;
      material.opacity = baseOpacity * body.opacity;
    }
  }

  for (const [id, object] of runtime.objects) {
    if (!activeIds.has(id)) {
      disposeBody(object, runtime);
      runtime.objects.delete(id);
    }
  }

  runtime.renderer.render(runtime.scene, runtime.camera);
}

export function CelestialWebGpuLayer({ bodies, camera, onReadyChange }: CelestialWebGpuLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const bodiesRef = useRef(bodies);
  const cameraRef = useRef(camera);
  const onReadyRef = useRef(onReadyChange);
  bodiesRef.current = bodies;
  cameraRef.current = camera;
  onReadyRef.current = onReadyChange;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let active = true;
    let resizeObserver: ResizeObserver | null = null;

    const initialize = async () => {
      try {
        const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        await renderer.init();
        if (!active) {
          renderer.dispose();
          return;
        }

        const scene = new THREE.Scene();
        const threeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
        threeCamera.position.z = 100;
        scene.add(new THREE.HemisphereLight(0xc9e8ff, 0x07111a, 1.28));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
        keyLight.position.set(-4, 5, 10);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x5dcfe4, 0.75);
        rimLight.position.set(6, -4, 4);
        scene.add(rimLight);

        const runtime: Runtime = {
          renderer,
          scene,
          camera: threeCamera,
          objects: new Map(),
          sphereGeometry: new THREE.SphereGeometry(1, 48, 32),
          moonGeometry: new THREE.SphereGeometry(1, 28, 20),
          ringGeometry: new THREE.RingGeometry(1.24, 1.82, 96),
        };
        runtimeRef.current = runtime;
        renderLatest(runtime, canvas, bodiesRef, cameraRef);
        onReadyRef.current(true);

        resizeObserver = new ResizeObserver(() => {
          if (runtimeRef.current) renderLatest(runtimeRef.current, canvas, bodiesRef, cameraRef);
        });
        resizeObserver.observe(canvas);
      } catch (error) {
        console.warn("WebGPU celestial layer failed; retaining SVG fallback.", error);
        onReadyRef.current(false);
      }
    };

    void initialize();
    return () => {
      active = false;
      resizeObserver?.disconnect();
      const runtime = runtimeRef.current;
      if (!runtime) return;
      for (const body of runtime.objects.values()) disposeBody(body, runtime);
      runtime.sphereGeometry.dispose();
      runtime.moonGeometry.dispose();
      runtime.ringGeometry.dispose();
      runtime.renderer.dispose();
      runtimeRef.current = null;
      onReadyRef.current(false);
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const canvas = canvasRef.current;
    if (runtime && canvas) renderLatest(runtime, canvas, bodiesRef, cameraRef);
  }, [bodies, camera]);

  return <canvas ref={canvasRef} className="celestial-webgpu-layer" aria-hidden="true" />;
}
