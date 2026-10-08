import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { addMirrors, damp, radialTexture, setLabel, smooth } from './common';

/**
 * Promoção Cinemark: o Pânico sai do fundo (da luz da tela do cinema) com o balde de pipoca; o vampiro entra
 * pela esquerda, estende a mão e puxa o balde com poderes (rastro roxo); depois pega a Fanta Uva que flutua à
 * frente dele e a mostra para a câmera, enquanto o Pânico recua para o escuro.
 *
 * A animação inteira é um clipe só (`cena`, 10 s) de /media/cinema/cena.glb, feito no Blender a partir dos
 * modelos da Tripo (ver Documents/fanta/cinema-promo/LEIA-ME.md). O scroll escolhe o instante (setProgress);
 * a cena persegue esse instante com amortecimento. Efeitos (energia, faíscas, pipoca que cai, brilho da lata)
 * são funções do instante, então rolar para trás desfaz tudo.
 */

const BASE = '/media/cinema/';
const JACK = '/media/jack/';
/** Duração do clipe e eventos (mesmos de choreo.py / cena.json). */
const DURATION = 10;
const T_REL = 5.8;
const T_CATCH = 6.75;
const T_CALL = 7.15;
const T_GRAB = 7.55;

interface CamKey {
  t: number;
  /** Ponto que a câmera olha (m, espaço do three). */
  at: [number, number, number];
  dist: number;
  yaw: number;
}

interface Layout {
  fov: number;
  pitch: number;
  keys: CamKey[];
}

// paisagem: os dois em cena; no fim o vampiro fica no terço esquerdo e o texto da promoção à direita.
// retrato: a câmera acompanha a ação (Pânico → vampiro → os dois → vampiro), que termina na metade de cima.
function layoutFor(aspect: number): Layout {
  if (aspect > 1.15) {
    return {
      fov: 30,
      pitch: 4,
      keys: [
        { t: 0, at: [0.9, 1.15, -2.6], dist: 6.2, yaw: 4 },
        { t: 2.4, at: [0.7, 1.1, -1.5], dist: 6.4, yaw: 3 },
        { t: 3.6, at: [0.0, 1.1, -0.7], dist: 7.0, yaw: 0 },
        { t: 6.2, at: [0.05, 1.12, -0.6], dist: 6.9, yaw: 0 },
        { t: 7.7, at: [-0.55, 1.2, -0.1], dist: 5.4, yaw: -2 },
        { t: 10, at: [-0.08, 1.18, 0.0], dist: 4.9, yaw: -5 },
      ],
    };
  }
  const narrow = aspect < 0.8;
  return {
    fov: narrow ? 38 : 34,
    pitch: 5,
    keys: [
      { t: 0, at: [1.1, 1.2, -2.6], dist: 5.4, yaw: 3 },
      { t: 2.4, at: [1.0, 1.15, -1.4], dist: 5.4, yaw: 2 },
      // panorâmica rápida para o vampiro que entra pela esquerda
      { t: 2.95, at: [-2.3, 1.1, 0.0], dist: 5.4, yaw: 0 },
      { t: 4.3, at: [-1.15, 1.12, 0.0], dist: 5.2, yaw: 0 },
      { t: 5.0, at: [0.05, 1.15, -0.6], dist: narrow ? 7.6 : 6.8, yaw: 0 },
      { t: 6.75, at: [-0.45, 1.2, -0.2], dist: narrow ? 6.6 : 6.0, yaw: -2 },
      // a lata vem da esquerda até a mão direita
      { t: 7.35, at: [-1.25, 1.18, 0.25], dist: narrow ? 5.2 : 4.8, yaw: -2 },
      { t: 8.2, at: [-0.95, 1.2, 0.1], dist: narrow ? 4.4 : 4.0, yaw: -4 },
      { t: 10, at: [-0.98, 0.98, 0.15], dist: narrow ? 4.7 : 4.2, yaw: -6 },
    ],
  };
}

function camAt(keys: CamKey[], t: number, out: { at: THREE.Vector3; dist: number; yaw: number }) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const u = smooth(a.t, b.t, t);
  out.at.set(
    THREE.MathUtils.lerp(a.at[0], b.at[0], u),
    THREE.MathUtils.lerp(a.at[1], b.at[1], u),
    THREE.MathUtils.lerp(a.at[2], b.at[2], u),
  );
  out.dist = THREE.MathUtils.lerp(a.dist, b.dist, u);
  out.yaw = THREE.MathUtils.lerp(a.yaw, b.yaw, u);
}

export interface CinemaPromo {
  setActive(active: boolean): void;
  /** 0–1: fração da linha do tempo (o componente faz o mapa a partir do scroll). */
  setProgress(p: number): void;
  setPointer(x: number, y: number): void;
  /** Retângulo da tela do notebook em frações do canvas (0–1); { x: 0, y: 0, w: 1, h: 1 } = tela cheia. */
  setScreen(x: number, y: number, w: number, h: number): void;
  dispose(): void;
}

interface Options {
  mobile: boolean;
  reduced: boolean;
  onReady?: () => void;
}

/** Osso pelo nome base: o GLTFLoader renomeia os repetidos (os dois rigs têm 'hand_L') para 'hand_L_1'. */
function bone(root: THREE.Object3D, base: string): THREE.Object3D {
  let found: THREE.Object3D | null = null;
  const re = new RegExp(`^${base}(_\\d+)?$`);
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && re.test(o.name)) found = o;
  });
  if (!found) throw new Error(`osso ${base} não encontrado`);
  return found;
}

/** Gerador pseudoaleatório determinístico (a pipoca cai sempre igual, ida e volta do scroll). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ENERGY_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uStrength;
uniform float uScale;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
varying float vA;
varying float vU;
void main() {
  float speed = 0.45 + 0.6 * fract(aSeed * 7.13);
  float u = fract(aSeed * 3.71 + uTime * speed);
  float w = 1.0 - u;
  vec3 p = w * w * uA + 2.0 * w * u * uC + u * u * uB;
  vec3 tg = normalize(2.0 * w * (uC - uA) + 2.0 * u * (uB - uC) + 1e-5);
  vec3 n1 = normalize(cross(tg, vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
  vec3 n2 = cross(tg, n1);
  float ang = aSeed * 40.0 + uTime * (2.0 + 3.0 * fract(aSeed * 5.3)) + u * 9.0;
  float rad = (0.015 + 0.075 * fract(aSeed * 11.7)) * sin(3.14159 * u);
  p += (n1 * cos(ang) + n2 * sin(ang)) * rad;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (0.012 + 0.03 * fract(aSeed * 13.1)) / -mv.z;
  vA = uStrength * smoothstep(0.0, 0.1, u) * smoothstep(1.0, 0.82, u);
  vU = u;
}`;

const SPARK_FRAG = /* glsl */ `
uniform vec3 uCol1;
uniform vec3 uCol2;
varying float vA;
varying float vU;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  gl_FragColor = vec4(mix(uCol1, uCol2, vU), a * vA);
}`;

const BURST_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aSeed;
uniform float uTau;
uniform float uScale;
uniform vec3 uO;
varying float vA;
varying float vU;
void main() {
  float k = 1.0 - exp(-5.5 * uTau);
  vec3 p = uO + aDir * k * (0.25 + 0.3 * aSeed) + vec3(0.0, -0.12 * uTau * uTau, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (0.014 + 0.02 * aSeed) / -mv.z;
  float life = clamp(uTau / 0.9, 0.0, 1.0);
  vA = (uTau > 0.0 ? 1.0 : 0.0) * (1.0 - life) * (1.0 - life);
  vU = aSeed;
}`;

const SCREEN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.1) + 0.15 * noise(p * 4.3 + 7.7); }
void main() {
  vec2 uv = vUv;
  float edge = smoothstep(0.0, 0.03, uv.x) * smoothstep(1.0, 0.97, uv.x) * smoothstep(0.0, 0.05, uv.y) * smoothstep(1.0, 0.95, uv.y);
  float flick = 0.92 + 0.05 * sin(uTime * 23.0) + 0.03 * sin(uTime * 7.1 + 1.3);
  float hot = exp(-dot((uv - vec2(0.5, 0.56)) * vec2(1.25, 1.9), (uv - vec2(0.5, 0.56)) * vec2(1.25, 1.9)) * 2.4);
  // o "filme": névoa noturna que corre devagar, um horizonte escuro e relâmpagos de vez em quando
  vec2 q = uv * vec2(3.2, 1.6);
  float mist = fbm(q + vec2(uTime * 0.05, uTime * 0.012) + fbm(q * 1.7 - uTime * 0.03));
  float ground = smoothstep(0.42, 0.3, uv.y + 0.05 * fbm(vec2(uv.x * 6.0, 1.0)));
  float bolt = pow(max(0.0, sin(uTime * 0.7) * sin(uTime * 2.9 + 1.0)), 24.0);
  float img = (0.35 + 0.9 * mist) * (1.0 - 0.75 * ground) + bolt * 0.9;
  float grain = hash(floor(uv * vec2(480.0, 220.0)) + floor(uTime * 24.0)) - 0.5;
  float scan = 0.97 + 0.03 * sin(uv.y * 900.0);
  vec3 base = vec3(0.55, 0.64, 0.92);
  vec3 col = base * (0.18 + 0.82 * hot) * img * flick * scan + grain * 0.035;
  gl_FragColor = vec4(col * edge * uLevel, 1.0);
}`;

const CURTAIN_FRAG = /* glsl */ `
uniform float uLevel;
uniform float uSide;
varying vec2 vUv;
void main() {
  float folds = 0.55 + 0.45 * pow(abs(sin(vUv.x * 38.0 + sin(vUv.y * 3.0) * 0.6)), 0.7);
  float lit = mix(1.0, 0.12, pow(uSide > 0.0 ? vUv.x : 1.0 - vUv.x, 0.7));
  float fade = smoothstep(0.0, 0.25, vUv.y) * (0.65 + 0.35 * vUv.y);
  vec3 col = vec3(0.30, 0.025, 0.04) * folds * lit * fade;
  gl_FragColor = vec4(col * uLevel, 1.0);
}`;

const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export async function createCinemaPromo(canvas: HTMLCanvasElement, opts: Options): Promise<CinemaPromo> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  renderer.debug.checkShaderErrors = false;

  const scene = new THREE.Scene();
  // o fundo some no preto: o Pânico nasce da escuridão perto da tela e volta para ela
  scene.fog = new THREE.Fog(0x000000, 6.8, 13.5);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.22;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

  // ---------------------------------------------------------------- luz
  scene.add(new THREE.HemisphereLight(0x8f9cff, 0x000000, 0.2));
  // a tela do cinema recorta os dois por trás (azulado)
  const back = new THREE.DirectionalLight(0xc3d2ff, 2.6);
  back.position.set(0.5, 3.2, -6);
  scene.add(back);
  // principal quente pela frente-direita, roxo pela esquerda (lado do vampiro)
  const key = new THREE.DirectionalLight(0xfff0e2, 1.5);
  key.position.set(2.2, 3.6, 4.5);
  scene.add(key);
  const fillL = new THREE.DirectionalLight(0x9a6bff, 0.9);
  fillL.position.set(-4, 2, 2);
  scene.add(fillL);
  const palmLight = new THREE.PointLight(0xa070ff, 0, 3.2, 1.6);
  scene.add(palmLight);
  const bucketLight = new THREE.PointLight(0xb57dff, 0, 2.4, 1.6);
  scene.add(bucketLight);
  const canLight = new THREE.PointLight(0x9c6bff, 0, 1.6, 1.8);
  scene.add(canLight);

  // ---------------------------------------------------------------- assets
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [gltf, canGltf, label] = await Promise.all([
    loader.loadAsync(BASE + (opts.mobile ? 'cena-mobile.glb' : 'cena.glb')),
    loader.loadAsync(JACK + 'fanta-lata.glb'),
    new THREE.TextureLoader().loadAsync(JACK + 'labels/label-uva.webp').then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      return t;
    }),
  ]);
  const model = gltf.scene;
  scene.add(model);
  const vampRig = model.getObjectByName('Vamp_Rig')!;
  const ghostRig = model.getObjectByName('Ghost_Rig')!;
  const bucket = model.getObjectByName('Bucket')!;
  const canNode = model.getObjectByName('Can')!;
  const palm = bone(vampRig, 'hand_L');
  const palmR = bone(vampRig, 'hand_R');
  const vampRoot = bone(vampRig, 'root');
  const ghostRoot = bone(ghostRig, 'root');
  const ghostMats: THREE.MeshStandardMaterial[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m.name === 'Vamp_Body') m.envMapIntensity = 1.3;
  });

  const canModel = canGltf.scene;
  setLabel(canModel, label);
  canNode.add(canModel);

  const mixer = new THREE.AnimationMixer(model);
  const action = mixer.clipAction(gltf.animations[0]);
  action.play();
  action.paused = true;

  const reflFade = { value: 1 };
  addMirrors(model, reflFade, { value: 0.9 });
  // o Pânico escurece junto com o próprio reflexo (o reflexo usa uma cópia do material)
  model.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m?.name === 'Ghost_Body') ghostMats.push(m);
  });

  // ---------------------------------------------------------------- cinema: tela, cortinas, chão
  const screenMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: UV_VERT,
    fragmentShader: SCREEN_FRAG,
    depthWrite: false,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 4.6), screenMat);
  screen.position.set(0.3, 0.95 + 2.3, -6.4);
  scene.add(screen);
  const curtainMats = [-1, 1].map((side) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { uLevel: { value: 1 }, uSide: { value: side } },
      vertexShader: UV_VERT,
      fragmentShader: CURTAIN_FRAG,
      depthWrite: false,
    });
    const c = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 7.5), m);
    c.position.set(0.3 + side * (5.25 + 1.7), 3.6, -6.3);
    scene.add(c);
    return m;
  });
  // piso fosco e escuro (sem o brilho especular da luz principal): o "encerado" vem dos reflexos (addMirrors e a tela)
  // translúcido e sem gravar profundidade: os reflexos (abaixo de y = 0) aparecem através dele, escurecidos
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x060509, roughness: 0.96, metalness: 0, envMapIntensity: 0.05, transparent: true, opacity: 0.5, depthWrite: false,
  });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 30).rotateX(-Math.PI / 2), floorMat);
  floor.renderOrder = -1;
  floor.position.set(0, -0.001, -2);
  scene.add(floor);
  // a tela refletida no piso encerado: uma faixa azulada que some em direção à câmera
  const glowTex = radialTexture();
  const screenRefl = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: glowTex, color: 0x34407a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      opacity: 0.3, fog: false,
    }),
  );
  screenRefl.scale.set(13, 1, 7);
  screenRefl.position.set(0.3, 0.002, -5.6);
  scene.add(screenRefl);

  // sombras de contato
  const shadowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.8 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const vampShadow = new THREE.Mesh(shadowGeo, shadowMat);
  vampShadow.scale.set(0.95, 1, 0.75);
  const ghostShadow = new THREE.Mesh(shadowGeo, shadowMat);
  ghostShadow.scale.set(1.15, 1, 0.9);
  for (const s of [vampShadow, ghostShadow]) {
    s.renderOrder = 2;
    scene.add(s);
  }

  // ---------------------------------------------------------------- poder: brilho na palma, energia, faíscas
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;
  const palmGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xb98cff, ...additive, opacity: 0, fog: false }));
  scene.add(palmGlow);
  const bucketGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9a5cff, ...additive, opacity: 0, fog: false }));
  scene.add(bucketGlow);
  const canGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x8d5bff, ...additive, opacity: 0, fog: false }));
  scene.add(canGlow);
  const canPool = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0x7a45e0, ...additive, opacity: 0, fog: false }),
  );
  canPool.scale.set(0.9, 1, 0.7);
  scene.add(canPool);

  const NE = opts.mobile ? 160 : 320;
  const energyGeo = new THREE.BufferGeometry();
  energyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NE * 3), 3));
  const seeds = new Float32Array(NE);
  for (let i = 0; i < NE; i++) seeds[i] = Math.random();
  energyGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const energyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uStrength: { value: 0 }, uScale: { value: 600 },
      uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3() },
      uCol1: { value: new THREE.Color(0xd9b8ff) }, uCol2: { value: new THREE.Color(0x7b3dff) },
    },
    vertexShader: ENERGY_VERT,
    fragmentShader: SPARK_FRAG,
    ...additive,
  });
  const energy = new THREE.Points(energyGeo, energyMat);
  energy.frustumCulled = false;
  scene.add(energy);
  // o mesmo poder, mais curto, quando a mão direita chama a lata
  const callMat = energyMat.clone();
  const call = new THREE.Points(energyGeo, callMat);
  call.frustumCulled = false;
  scene.add(call);

  const NB = opts.mobile ? 50 : 90;
  const burstGeo = new THREE.BufferGeometry();
  const dirs = new Float32Array(NB * 3);
  const bseed = new Float32Array(NB);
  const rand = rng(7);
  for (let i = 0; i < NB; i++) {
    const a = rand() * Math.PI * 2;
    const z = rand() * 2 - 1;
    const r = Math.sqrt(1 - z * z);
    dirs.set([r * Math.cos(a), z * 0.7 + 0.2, r * Math.sin(a)], i * 3);
    bseed[i] = rand();
  }
  burstGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NB * 3), 3));
  burstGeo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
  burstGeo.setAttribute('aSeed', new THREE.BufferAttribute(bseed, 1));
  const burstMat = new THREE.ShaderMaterial({
    uniforms: {
      uTau: { value: -1 }, uScale: { value: 600 }, uO: { value: new THREE.Vector3() },
      uCol1: { value: new THREE.Color(0xf1dcff) }, uCol2: { value: new THREE.Color(0x8a4dff) },
    },
    vertexShader: BURST_VERT,
    fragmentShader: SPARK_FRAG,
    ...additive,
  });
  const burst = new THREE.Points(burstGeo, burstMat);
  burst.frustumCulled = false;
  scene.add(burst);

  // ---------------------------------------------------------------- pipoca que pula do balde no tranco
  const kernelGeo = new THREE.IcosahedronGeometry(0.011, 1);
  {
    const p = kernelGeo.attributes.position as THREE.BufferAttribute;
    const r = rng(3);
    for (let i = 0; i < p.count; i++) {
      const k = 0.75 + r() * 0.5;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    kernelGeo.computeVertexNormals();
  }
  const kernelMat = new THREE.MeshStandardMaterial({ color: 0xf2e2b6, roughness: 0.85 });
  const NK = opts.mobile ? 10 : 16;
  const kernels = new THREE.InstancedMesh(kernelGeo, kernelMat, NK);
  kernels.frustumCulled = false;
  scene.add(kernels);
  const kRand = rng(11);
  const kernelV = Array.from({ length: NK }, () => ({
    v: new THREE.Vector3((kRand() - 0.5) * 1.3, 1.1 + kRand() * 1.2, (kRand() - 0.5) * 1.1),
    delay: kRand() * 0.25,
    spin: new THREE.Vector3(kRand(), kRand(), kRand()).multiplyScalar(14),
    off: new THREE.Vector3((kRand() - 0.5) * 0.12, 0, (kRand() - 0.5) * 0.12),
  }));

  // ---------------------------------------------------------------- poeira no feixe do projetor
  const ND = opts.mobile ? 70 : 140;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(ND * 3);
  const dRand = rng(5);
  for (let i = 0; i < ND; i++) dustPos.set([(dRand() - 0.5) * 9, 0.4 + dRand() * 4, -6 + dRand() * 9], i * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: glowTex, color: 0x9fb2ff, size: 0.035, ...additive, opacity: 0.55, sizeAttenuation: true, fog: true,
  });
  scene.add(new THREE.Points(dustGeo, dustMat));

  // ---------------------------------------------------------------- estado
  let width = 0;
  let height = 0;
  let layout = layoutFor(16 / 9);
  const view = { x: 0, y: 0, w: 1, h: 1 };
  let tTarget = opts.reduced ? DURATION : 0;
  let tNow = tTarget;
  let active = true;
  let time = 0;
  let pointerX = 0;
  let pointerY = 0;
  let lookX = 0;
  let lookY = 0;
  const cam = { at: new THREE.Vector3(), dist: 6, yaw: 0 };
  const timer = new THREE.Timer();
  timer.connect(document);
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const releaseTop = new THREE.Vector3();

  // topo do balde no instante em que ele se solta (origem da pipoca que pula)
  action.time = T_REL;
  mixer.update(0);
  model.updateMatrixWorld(true);
  bucket.localToWorld(releaseTop.set(0, 0.26, 0));

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    // o enquadramento (retrato/paisagem) segue a tela cheia, que é onde a cena termina
    layout = layoutFor(w / h);
    camera.fov = layout.fov;
    applyView();
  }

  /**
   * Tela do notebook: o canvas cobre sempre a viewport, mas a câmera projeta o quadro inteiro dentro do retângulo
   * da tela (setViewOffset) e só essa área é desenhada (scissor). Ao ampliar, o retângulo cresce até a tela cheia.
   */
  function applyView() {
    if (!width || !height) return;
    const full = view.w > 0.999 && view.h > 0.999;
    const rw = Math.max(1, view.w * width);
    const rh = Math.max(1, view.h * height);
    if (full) {
      camera.aspect = width / height;
      camera.clearViewOffset();
      renderer.setScissorTest(false);
    } else {
      camera.aspect = rw / rh;
      camera.setViewOffset(rw, rh, -view.x * width, -view.y * height, width, height);
      renderer.setScissorTest(true);
      // só a parte da tela que cai dentro do canvas (em retrato ela passa das bordas no fim do zoom)
      const sx = Math.max(0, view.x * width);
      const sy = Math.max(0, view.y * height);
      const ex = Math.min(width, view.x * width + rw);
      const ey = Math.min(height, view.y * height + rh);
      renderer.setScissor(sx, height - ey, Math.max(1, ex - sx), Math.max(1, ey - sy));
    }
    camera.updateProjectionMatrix();
    const scale = ((full ? height : rh) * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(layout.fov / 2)));
    energyMat.uniforms.uScale.value = scale;
    callMat.uniforms.uScale.value = scale;
    burstMat.uniforms.uScale.value = scale;
  }

  function placeCamera(t: number, shake: number) {
    camAt(layout.keys, t, cam);
    const yaw = THREE.MathUtils.degToRad(cam.yaw + lookX * 2.2);
    const pitch = THREE.MathUtils.degToRad(layout.pitch + lookY * 1.2);
    camera.position.set(
      cam.at.x + Math.sin(yaw) * Math.cos(pitch) * cam.dist,
      cam.at.y + Math.sin(pitch) * cam.dist,
      cam.at.z + Math.cos(yaw) * Math.cos(pitch) * cam.dist,
    );
    v.copy(cam.at);
    if (shake > 0) {
      v.x += Math.sin(time * 61) * shake * 0.02;
      v.y += Math.sin(time * 53 + 1) * shake * 0.015;
    }
    camera.lookAt(v);
  }

  function update(dt: number) {
    time += dt;
    tNow = opts.reduced ? tTarget : damp(tNow, tTarget, 7, dt);
    if (Math.abs(tNow - tTarget) < 1e-4) tNow = tTarget;
    const t = tNow;
    action.time = Math.min(t, DURATION - 1e-3);
    mixer.update(0);
    model.updateMatrixWorld(true);

    // tela: acende no começo, cai no fim (o texto da promoção fica legível)
    const level = smooth(0, 0.9, t) * (1 - 0.62 * smooth(8.2, 9.6, t));
    screenMat.uniforms.uTime.value = time;
    screenMat.uniforms.uLevel.value = level;
    curtainMats.forEach((m) => (m.uniforms.uLevel.value = level));
    (screenRefl.material as THREE.MeshBasicMaterial).opacity = 0.3 * level;
    back.intensity = 2.6 * (0.35 + 0.65 * level);
    dustMat.opacity = 0.5 * level;
    const dust = dustGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < ND; i++) {
      let y = dust.getY(i) + dt * 0.03;
      if (y > 4.6) y = 0.4;
      dust.setY(i, y);
      dust.setX(i, dust.getX(i) + Math.sin(time * 0.3 + i) * dt * 0.02);
    }
    dust.needsUpdate = true;

    // Pânico: sai do escuro no começo e volta para ele ao recuar
    {
      const dim = (0.06 + 0.94 * smooth(0.15, 1.7, t)) * (1 - 0.94 * smooth(7.8, 9.5, t));
      for (const m of ghostMats) {
        m.color.setScalar(dim);
        m.envMapIntensity = dim;
      }
    }

    // sombras de contato seguem o root de cada um
    vampRoot.getWorldPosition(v);
    vampShadow.position.set(v.x, 0.003, v.z);
    ghostRoot.getWorldPosition(v);
    ghostShadow.position.set(v.x, 0.003, v.z);

    // poder: palma -> balde
    const power = smooth(4.95, 5.35, t) * (1 - smooth(T_CATCH + 0.05, T_CATCH + 0.45, t));
    const pull = smooth(5.3, T_REL, t) * (1 - smooth(T_CATCH, T_CATCH + 0.3, t));
    palm.localToWorld(v.set(0, 0.05, -0.03));
    bucket.localToWorld(v2.set(0, 0.14, 0));
    const flick = 0.85 + 0.15 * Math.sin(time * 19) * Math.sin(time * 7.3);
    palmGlow.position.copy(v);
    palmGlow.scale.setScalar(0.32 + 0.22 * power * flick);
    (palmGlow.material as THREE.SpriteMaterial).opacity = 0.9 * power * flick;
    palmLight.position.copy(v);
    palmLight.intensity = 3.2 * power * flick;
    bucketGlow.position.copy(v2);
    bucketGlow.scale.setScalar(0.55 + 0.3 * pull);
    (bucketGlow.material as THREE.SpriteMaterial).opacity = 0.75 * pull * flick;
    bucketLight.position.copy(v2);
    bucketLight.intensity = 2.6 * pull;
    energyMat.uniforms.uTime.value = time;
    energyMat.uniforms.uStrength.value = pull;
    energyMat.uniforms.uA.value.copy(v);
    energyMat.uniforms.uB.value.copy(v2);
    energyMat.uniforms.uC.value.copy(v).lerp(v2, 0.5).add(v.set(0, 0.28, 0.1));
    // faíscas quando o balde chega na mão
    bucket.localToWorld(burstMat.uniforms.uO.value.set(0, 0.06, 0));
    burstMat.uniforms.uTau.value = t - T_CATCH;

    // pipoca: pula no tranco, cai e fica no chão
    for (let i = 0; i < NK; i++) {
      const k = kernelV[i];
      const tau = t - T_REL - 0.05 - k.delay;
      if (tau <= 0) {
        m4.makeScale(0, 0, 0);
      } else {
        const tLand = (k.v.y + Math.sqrt(k.v.y * k.v.y + 2 * 9.8 * (releaseTop.y - 0.012))) / 9.8;
        const s = Math.min(tau, tLand);
        v.copy(releaseTop).add(k.off).addScaledVector(k.v, s);
        v.y -= 0.5 * 9.8 * s * s;
        e.set(k.spin.x * s, k.spin.y * s, k.spin.z * s);
        q.setFromEuler(e);
        m4.compose(v, q, v2.setScalar(1));
      }
      kernels.setMatrixAt(i, m4);
    }
    kernels.instanceMatrix.needsUpdate = true;

    // Fanta Uva flutuando: brilho e poça de luz até ser pega
    const canOn = 1 - smooth(T_GRAB, T_GRAB + 0.6, t);
    canNode.getWorldPosition(v);
    v.y += 0.06;
    canGlow.position.copy(v);
    canGlow.scale.setScalar(0.42 + 0.06 * Math.sin(time * 2.4));
    (canGlow.material as THREE.SpriteMaterial).opacity = 0.55 * canOn;
    canLight.position.copy(v).add(v2.set(0, 0, 0.25));
    canLight.intensity = 1.6 * (0.1 + 0.9 * canOn);
    canPool.position.set(v.x, 0.004, v.z);
    (canPool.material as THREE.MeshBasicMaterial).opacity = 0.5 * canOn;
    const calling = smooth(T_CALL - 0.2, T_CALL + 0.05, t) * (1 - smooth(T_GRAB - 0.05, T_GRAB + 0.25, t));
    palmR.localToWorld(v2.set(0, 0.06, -0.03));
    callMat.uniforms.uTime.value = time * 1.3;
    callMat.uniforms.uStrength.value = calling * 0.85;
    callMat.uniforms.uA.value.copy(v2);
    callMat.uniforms.uB.value.copy(v);
    callMat.uniforms.uC.value.copy(v2).lerp(v, 0.5).y += 0.12;
    // a luz da palma passa para a mão direita enquanto ela chama a lata
    if (calling > power) {
      palmLight.position.copy(v2);
      palmLight.intensity = 2.2 * calling;
    }

    // câmera
    lookX = damp(lookX, pointerX, 3, dt);
    lookY = damp(lookY, pointerY, 3, dt);
    const shake = Math.max(0, 1 - Math.abs(t - T_CATCH) / 0.25) * (opts.reduced ? 0 : 1);
    placeCamera(t, shake);
    renderer.render(scene, camera);
  }

  let raf = 0;
  const loop = () => {
    raf = 0;
    resize();
    timer.update();
    update(Math.min(timer.getDelta(), 1 / 20));
    if (active && !opts.reduced) raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (opts.reduced) {
      resize();
      update(0);
    } else if (!raf && active) raf = requestAnimationFrame(loop);
  };
  resize();
  update(0);
  opts.onReady?.();
  if (!opts.reduced) raf = requestAnimationFrame(loop);
  if (opts.reduced) window.addEventListener('resize', kick);

  return {
    setActive(next) {
      if (next === active) return;
      active = next;
      timer.update();
      kick();
    },
    setProgress(p) {
      if (opts.reduced) return;
      tTarget = THREE.MathUtils.clamp(p, 0, 1) * DURATION;
      kick();
    },
    setScreen(x, y, w, h) {
      if (view.x === x && view.y === y && view.w === w && view.h === h) return;
      Object.assign(view, { x, y, w, h });
      applyView();
      kick();
    },
    setPointer(px, py) {
      pointerX = px;
      pointerY = py;
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', kick);
      timer.dispose();
      mixer.stopAllAction();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
        for (const m of mats) {
          for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose();
          m.dispose();
        }
      });
      label.dispose();
      glowTex.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
