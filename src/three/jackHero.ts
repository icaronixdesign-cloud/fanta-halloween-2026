import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLAVOR_ACCENT, FLAVOR_GLOW, FLAVOR_IDS, damp, radialTexture, setLabel, smooth } from './common';

/**
 * Hero 3D: o Jack (abóbora) em gravidade zero, cercado pelas seis latas da coleção.
 * O scroll (0–1, já amortecido aqui dentro) conduz câmera, latas e a oferta da lata:
 *   0.00–0.18  close baixo, Jack à direita, latas à deriva
 *   0.18–0.56  gravidade zero: Jack levita e dá um giro completo; latas se espalham e passam pela câmera
 *   0.40–0.76  as latas da vitrine entram uma a uma pela esquerda e formam a fileira atrás dele
 *   0.56–0.84  aterrissa e oferece a lata (clipe `offer` guiado pelo scroll) → `offer_idle`
 *   0.80–1.00  vitrine: `go(±n)` desliza a fileira; o Jack leva a lata às costas (clipe `swap`),
 *              devolve a dele à fileira e volta com a que chegou ao centro (rótulo troca em `swapLabel`)
 * Arquivos em /media/jack/ (ver pumpkin-jack/LEIA-ME.md).
 */

const BASE = '/media/jack/';
export const HERO_FLAVORS = FLAVOR_IDS;
const FLAVORS = HERO_FLAVORS;
/** A partir daqui a vitrine aceita trocas. */
export const PICK_FROM = 0.8;

export interface JackHero {
  setProgress(p: number): void;
  setPointer(x: number, y: number): void;
  setActive(active: boolean): void;
  /** Anda n posições na fileira (positivo = a lata da direita vem para o centro). false fora da vitrine. */
  go(delta: number): boolean;
  /** Posição relativa (-2…2) da lata sob o ponto (coordenadas -1…1 do canvas), ou 0 se nenhuma. */
  pickAt(x: number, y: number): number;
  /** O ponto (coordenadas -1…1 do canvas) cai sobre o Jack, na vitrine. */
  hitJack(x: number, y: number): boolean;
  /** Segurar para beber: true começa (ou mantém) o gole, false solta. Retorna false fora da vitrine. */
  drink(on: boolean): boolean;
  dispose(): void;
}

interface Options {
  mobile: boolean;
  reduced: boolean;
  onReady?: () => void;
  /** Sabor escolhido (índice em HERO_FLAVORS), avisado no gesto, antes da troca terminar. */
  onSelect?: (index: number) => void;
}

/**
 * Lugar de uma lata flutuante no quadro inicial. at: [x, y] na tela (-1…1); dist: distância da câmera (m);
 * size: altura da lata na tela (fração da altura do quadro); roll: inclinação do eixo na tela (rad,
 * + = topo para a esquerda); turn: quanto o rótulo vira para o lado (rad).
 */
interface Spot {
  at: [number, number];
  dist: number;
  size: number;
  roll: number;
  turn: number;
}

interface Orbit {
  root: THREE.Object3D;
  anchor: THREE.Vector3;
  /** Rótulo de frente para a câmera do quadro inicial. */
  base: THREE.Quaternion;
  spot: Spot;
  phase: number;
  scale: number;
  spinAxis: THREE.Vector3;
}

/** Altura da lata no GLB (m). */
const CAN_H = 0.122;

export async function createJackHero(canvas: HTMLCanvasElement, opts: Options): Promise<JackHero> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);
  renderer.debug.checkShaderErrors = false;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.25;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);

  // luz: principal quente de cima, recorte laranja por trás, preenchimento frio
  scene.add(new THREE.HemisphereLight(0xffe9d6, 0x120a06, 0.3));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
  key.position.set(-1.2, 2.4, 1.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff7a2a, 1.9);
  rim.position.set(1.4, 1.6, -1.6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.3);
  fill.position.set(1.6, 0.5, 1.4);
  scene.add(fill);

  // ---------------------------------------------------------------- assets
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const [char, can, clipsInfo, ...labels] = await Promise.all([
    loader.loadAsync(BASE + (opts.mobile ? 'jack-mobile.glb' : 'jack.glb')),
    loader.loadAsync(BASE + 'fanta-lata.glb'),
    fetch(BASE + 'clips.json').then(
      (r) => r.json() as Promise<{ clips: Record<string, { duration: number; events?: Record<string, number> }> }>,
    ),
    ...FLAVORS.map((f) =>
      texLoader.loadAsync(`${BASE}labels/label-${f}.webp`).then((t) => {
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return t;
      }),
    ),
  ]);

  const model = char.scene;
  scene.add(model);
  let headMat: THREE.MeshStandardMaterial | null = null;
  const bones: Record<string, THREE.Bone> = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.name === 'Jack_Head') headMat = m;
    }
  });

  // lata na mão (Laranja: o rótulo tem o espantalho-abóbora)
  const heldCan = can.scene.clone(true);
  setLabel(heldCan, labels[FLAVORS.indexOf('laranja')]);
  bones.prop_can.add(heldCan);

  // ---------------------------------------------------------------- latas flutuando (as cinco fora da mão)
  // Quadro inicial: o Jack segura a Laranja e as outras cinco flutuam em camadas de profundidade, cada uma
  // com o rótulo para a câmera, o eixo inclinado e a tampa à mostra (lugares em `Spot`, mesma ordem de FLOATING)
  const FLOATING = ['ghost-face-punch', 'maracuja', 'uva', 'guarana', 'caju'] as const;
  // paisagem: alto à esquerda · pequena ao fundo, ao lado da chamada · gigante atrás da cabeça ·
  // grande à frente, cortada embaixo · atrás da mão do Jack
  const SPOTS_WIDE: Spot[] = [
    { at: [-0.77, 0.63], dist: 1.7, size: 0.16, roll: 0.48, turn: -0.3 },
    { at: [-0.13, 0.34], dist: 2.9, size: 0.15, roll: -0.34, turn: 0.32 },
    { at: [0.72, 0.5], dist: 2.5, size: 0.4, roll: 0.54, turn: -0.22 },
    { at: [-0.46, -0.76], dist: 0.95, size: 0.33, roll: 0.57, turn: 0.26 },
    { at: [0.83, -0.56], dist: 1.9, size: 0.21, roll: -0.2, turn: -0.34 },
  ];
  // retrato: a chamada ocupa o terço de cima; latas nas bordas, atrás e à frente do Jack
  const SPOTS_TALL: Spot[] = [
    { at: [-0.88, -0.36], dist: 1.7, size: 0.11, roll: -0.36, turn: 0.3 },
    { at: [0.44, 0.18], dist: 3.2, size: 0.065, roll: -0.3, turn: -0.3 },
    { at: [0.86, -0.04], dist: 2.6, size: 0.2, roll: 0.5, turn: -0.22 },
    { at: [-0.52, -0.86], dist: 0.95, size: 0.17, roll: 0.55, turn: 0.26 },
    { at: [0.82, -0.66], dist: 1.8, size: 0.11, roll: -0.22, turn: -0.34 },
  ];
  const PITCH = 0.42; // topo virado para a câmera: a tampa aparece
  const orbits: Orbit[] = FLOATING.map((id, i) => {
    const root = new THREE.Group();
    const c = can.scene.clone(true);
    setLabel(c, labels[FLAVORS.indexOf(id)]);
    c.position.y = -CAN_H / 2; // gira em torno do centro da lata
    root.add(c);
    scene.add(root);
    return {
      root,
      anchor: new THREE.Vector3(),
      base: new THREE.Quaternion(),
      spot: SPOTS_WIDE[i],
      phase: i * 1.37,
      scale: 1,
      spinAxis: new THREE.Vector3(Math.sin(i * 1.7), 0.6, Math.cos(i * 2.3)).normalize(),
    };
  });

  // ---------------------------------------------------------------- vitrine: fileira de latas atrás do Jack
  // Latas gigantes de pé num chão espelhado (reflexo escurecido que some com a profundidade) e uma
  // poça de luz na cor de cada sabor, como no quadro de referência. A vaga de cada lata é
  // k = i - rowPos (anel de 6): k = 0 fica atrás do Jack e some, porque essa lata está na mão dele.
  const glowTex = radialTexture();
  const ROW_Z = -1.6;
  let rowS = 6.6; // escala das latas da fileira (menor no retrato)
  const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const rows: Shelf[] = FLAVORS.map((_, i) => {
    const root = new THREE.Group();
    const c = can.scene.clone(true);
    setLabel(c, labels[i]);
    const mats: THREE.Material[] = [];
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as THREE.Material).clone();
      m.transparent = true;
      mesh.material = m;
      mesh.userData.flavor = i;
      mats.push(m);
    });
    root.add(c);
    scene.add(root);

    const refl = new THREE.Group();
    const rc = can.scene.clone(true);
    setLabel(rc, labels[i]);
    const fade = { value: 1 };
    rc.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as THREE.Material).clone();
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uFade = fade;
        shader.vertexShader = 'varying float vReflY;\n' + shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n  vReflY = (modelMatrix * vec4(transformed, 1.0)).y;',
        );
        shader.fragmentShader = 'varying float vReflY;\nuniform float uFade;\n' + shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n  gl_FragColor.rgb *= uFade * 0.26 * pow(clamp(1.0 + vReflY / 0.42, 0.0, 1.0), 2.2);',
        ).replace(
          // rótulo desfocado no reflexo (mip mais baixo), como num chão encerado
          '#include <map_fragment>',
          '#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv, 3.5 );\n#endif',
        );
      };
      m.customProgramCacheKey = () => 'jack-reflection';
      mesh.material = m;
    });
    refl.add(rc);
    scene.add(refl);

    const pool = new THREE.Mesh(
      floorGeo,
      new THREE.MeshBasicMaterial({
        map: glowTex, color: FLAVOR_GLOW[i], transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      }),
    );
    scene.add(pool);
    return { root, refl, pool, mats, fade, lean: 0, lift: 0 };
  });
  const flash = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  flash.position.set(0, 0.45, ROW_Z + 0.3);
  flash.scale.setScalar(1.8);
  scene.add(flash);
  const pickables: THREE.Object3D[] = rows.map((r) => r.root);

  // ---------------------------------------------------------------- brasas e halo
  const N = opts.mobile ? 70 : 150;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(N * 3);
  const emberSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    emberPos[i * 3] = (Math.random() - 0.5) * 2.6;
    emberPos[i * 3 + 1] = Math.random() * 1.6 - 0.1;
    emberPos[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
    emberSeed[i] = Math.random();
  }
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({
      map: glowTex, color: 0xff8a2a, size: 0.035, sizeAttenuation: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
    }),
  );
  scene.add(embers);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, color: 0xff6a10, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }),
  );
  halo.scale.setScalar(1.25);
  scene.add(halo);

  // ---------------------------------------------------------------- animação
  const mixer = new THREE.AnimationMixer(model);
  const clip = (n: string) => {
    const c = char.animations.find((a) => a.name === n);
    if (!c) throw new Error(`clipe ausente: ${n}`);
    return mixer.clipAction(c);
  };
  const idle = clip('idle_hold').play();
  const offer = clip('offer');
  offer.setLoop(THREE.LoopOnce, 1);
  offer.clampWhenFinished = true;
  offer.play();
  offer.paused = true;
  const offerIdle = clip('offer_idle').play();
  const swapAct = clip('swap');
  swapAct.setLoop(THREE.LoopOnce, 1);
  swapAct.clampWhenFinished = true;
  swapAct.play();
  swapAct.paused = true;
  const offerDur = clipsInfo.clips.offer?.duration ?? 2;
  const swapDur = clipsInfo.clips.swap?.duration ?? 2.4;
  const swapAt = clipsInfo.clips.swap?.events?.swapLabel ?? 0.86;
  // gole em duas partes, com o tempo controlado aqui: `drink_in` (da oferta até a lata virada na boca,
  // tocado para a frente ao segurar e para trás ao soltar) e o loop `drink` (engolidas), que começa
  // exatamente onde `drink_in` termina
  const drinkInAct = clip('drink_in').play();
  drinkInAct.paused = true;
  drinkInAct.setEffectiveWeight(0);
  const drinkAct = clip('drink').play();
  drinkAct.paused = true;
  drinkAct.setEffectiveWeight(0);
  const drinkInDur = clipsInfo.clips.drink_in?.duration ?? 0.8;
  const drinkDur = clipsInfo.clips.drink?.duration ?? 1.6;
  const gulpAt = [clipsInfo.clips.drink?.events?.gulp1 ?? 0.38, clipsInfo.clips.drink?.events?.gulp2 ?? 1.18];
  const headRest = bones.head.quaternion.clone();
  const neckRest = bones.neck.quaternion.clone();

  // ---------------------------------------------------------------- estado e loop
  let target = 0;
  let p = 0;
  let pointerX = 0;
  let pointerY = 0;
  let lookX = 0;
  let lookY = 0;
  let active = true;
  let time = 0;
  let width = 0;
  let height = 0;
  const timer = new THREE.Timer();
  timer.connect(document);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const eCan = new THREE.Euler(0, 0, 0, 'ZXY'); // gira o rótulo, inclina a tampa e só então o eixo na tela
  const m4 = new THREE.Matrix4();
  const fwd = new THREE.Vector3();
  let exitX = 0; // as latas saem para longe deste x (entre a câmera inicial e o Jack)
  const v = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // vitrine: posições sem módulo (o anel gira sem fim)
  const START = FLAVORS.indexOf('laranja');
  let sel = START; // destino
  let rowPos = START; // posição exibida da fileira
  let rowPrev = START;
  let spacing = 0.62;
  let rowHalfW = 1.8;
  let hovered = 0;
  let flashK = 0;
  let swap: { t: number; from: number; to: number; fired: boolean } | null = null;
  let pending = 0;
  const SWAP_RATE = 1.2;
  let drinkWant = false;
  let drinkPhase: 'off' | 'in' | 'loop' | 'out' = 'off';
  let inT = 0; // tempo em drink_in (sobe ao segurar, desce ao soltar)
  let loopT = 0; // tempo no loop drink
  let loopW = 0; // 0 = drink_in, 1 = loop (troca curta entre os dois)
  let drinkHeld = 0; // segundos bebendo sem soltar: o brilho da abóbora cresce
  const OUT_RATE = 1.15; // abaixar a lata um pouco mais rápido que levantar
  const hitSphere = new THREE.Sphere(new THREE.Vector3(), 0.22);
  const hitBox = new THREE.Box3();
  const SLIDE_A = 0.2; // a fileira desliza entre estes instantes do clipe, com o meio em swapLabel
  const SLIDE_B = 2 * swapAt - SLIDE_A;
  const mod6 = (n: number) => ((Math.round(n) % 6) + 6) % 6;
  const wrap = (k: number) => k - 6 * Math.floor((k + 3) / 6); // -3…3

  function frameCamera(prog: number) {
    const aspect = width / Math.max(height, 1);
    const wide = aspect > 1.15;
    const k = smooth(0.16, 0.74, prog);
    if (wide) {
      // início: close baixo com o Jack à direita do centro (no mesmo ponto da tela em qualquer proporção;
      // a chamada fica à esquerda); fim: corpo inteiro centralizado, câmera mais baixa e afastada para a
      // fileira de latas caber atrás dele
      const x0 = -THREE.MathUtils.clamp(0.151 * aspect, 0.17, 0.3);
      camPos.set(THREE.MathUtils.lerp(x0, 0, k), THREE.MathUtils.lerp(0.33, 0.34, k), THREE.MathUtils.lerp(1.55, 2.6, k));
      camTarget.set(THREE.MathUtils.lerp(x0, 0, k), THREE.MathUtils.lerp(0.57, 0.38, k), 0);
      camera.fov = 30;
    } else {
      // retrato: Jack embaixo, texto em cima; termina centralizado
      camPos.set(0, THREE.MathUtils.lerp(0.42, 0.46, k), THREE.MathUtils.lerp(2.35, 3.0, k));
      camTarget.set(0, THREE.MathUtils.lerp(0.78, 0.56, k), 0);
      camera.fov = 34;
    }
    // respiração da câmera e paralaxe do mouse
    camPos.x += pointerX * 0.06 + Math.sin(time * 0.31) * 0.012;
    camPos.y += pointerY * 0.035 + Math.sin(time * 0.43) * 0.008;
    camera.position.copy(camPos);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // latas ancoradas na tela do quadro inicial (sem paralaxe), recalculadas a cada proporção
    const px = pointerX;
    const py = pointerY;
    const t0 = time;
    pointerX = pointerY = time = 0;
    frameCamera(0);
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const spots = w / h > 1.15 ? SPOTS_WIDE : SPOTS_TALL;
    orbits.forEach((o, i) => {
      const s = (o.spot = spots[i]);
      const dir = v.set(s.at[0], s.at[1], 0.5).unproject(camera).sub(camera.position).normalize();
      o.anchor.copy(camera.position).addScaledVector(dir, s.dist);
      // escala que dá a altura pedida na tela, na profundidade da lata
      o.scale = (s.size * 2 * s.dist * dir.dot(fwd) * tanHalf) / CAN_H;
      // +z (frente do rótulo) apontando para a câmera
      o.base.setFromRotationMatrix(m4.lookAt(camera.position, o.anchor, camera.up));
    });
    exitX = camera.position.x / 2;
    // largura visível na profundidade da fileira, no quadro final: define o espaçamento das latas
    frameCamera(1);
    rowHalfW = (camera.position.z - ROW_Z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const tall = w / h <= 1.15;
    spacing = tall ? THREE.MathUtils.clamp(rowHalfW * 0.6, 0.34, 0.5) : THREE.MathUtils.clamp(rowHalfW * 0.34, 0.5, 0.66);
    rowS = tall ? 4.8 : 6.6;
    pointerX = px;
    pointerY = py;
    time = t0;
  }

  /** x da fileira na vaga k (contínua); depois de ±2 as latas aceleram para fora do quadro. */
  function slotX(k: number) {
    const a = Math.abs(k);
    const out = Math.max(spacing * 1.6, rowHalfW - 2 * spacing + 0.5);
    return Math.sign(k) * (a <= 2 ? a * spacing : 2 * spacing + (a - 2) * out);
  }

  function startSwap(delta: number) {
    swap = { t: 0, from: rowPos, to: rowPos + delta, fired: false };
  }

  function step(dt: number) {
    time += dt;
    p = opts.reduced ? target : damp(p, target, 5, dt);

    // troca de sabor: o clipe `swap` corre no tempo (não no scroll); a fileira desliza com o meio em
    // swapLabel, quando a mão está atrás das costas: a lata do centro "entra" na mão e a antiga volta à fileira
    let wSwap = 0;
    if (swap) {
      swap.t += opts.reduced ? swapDur : dt * SWAP_RATE;
      rowPos = swap.from + (swap.to - swap.from) * easeInOut(THREE.MathUtils.clamp((swap.t - SLIDE_A) / (SLIDE_B - SLIDE_A), 0, 1));
      if (!swap.fired && swap.t >= swapAt) {
        swap.fired = true;
        const held = mod6(swap.to);
        setLabel(heldCan, labels[held], false);
        flashK = 1;
        (flash.material as THREE.SpriteMaterial).color.setHex(FLAVOR_ACCENT[held]);
      }
      wSwap = smooth(0, 0.25, swap.t) * (1 - smooth(swapDur - 0.45, swapDur, swap.t));
      swapAct.time = Math.min(swap.t, swapDur - 0.001);
      if (swap.t >= swapDur) {
        swap = null;
        if (pending) {
          startSwap(pending);
          pending = 0;
        }
      }
    }

    // gole: só na vitrine e fora de uma troca. Segurando: drink_in para a frente e depois o loop.
    // Soltando: volta do loop para o fim de drink_in (troca curta) e toca drink_in para trás até a oferta.
    const canDrink = drinkWant && !swap && p >= PICK_FROM - 0.03;
    if (opts.reduced) {
      drinkPhase = canDrink ? 'loop' : 'off';
      inT = canDrink ? drinkInDur : 0;
      loopW = canDrink ? 1 : 0;
      loopT = 0;
    } else if (canDrink) {
      if (drinkPhase === 'off' || drinkPhase === 'out') drinkPhase = 'in';
      if (drinkPhase === 'in') {
        inT += dt;
        if (inT >= drinkInDur) {
          inT = drinkInDur;
          drinkPhase = 'loop';
          if (loopW < 0.01) loopT = 0; // o loop começa na pose em que drink_in termina
        }
      }
      if (drinkPhase === 'loop') {
        loopT += dt;
        loopW = Math.min(1, loopW + dt / 0.12);
      }
    } else if (drinkPhase !== 'off') {
      drinkPhase = 'out';
      loopT += dt; // o loop continua enquanto sai, sem congelar no meio da engolida
      loopW = Math.max(0, loopW - dt / 0.2);
      if (loopW === 0) inT -= dt * OUT_RATE;
      if (inT <= 0) {
        inT = 0;
        drinkPhase = 'off';
      }
    }
    drinkHeld = drinkPhase === 'loop' ? drinkHeld + dt : Math.max(0, drinkHeld - dt * 2);
    drinkInAct.time = Math.min(inT, drinkInDur - 0.001);
    drinkAct.time = loopT % drinkDur;
    // na pontinha (lata saindo/voltando à pose de oferta) o peso entra/sai em 80 ms: some o salto entre a
    // respiração de offer_idle e o primeiro quadro de drink_in
    const wDrink = (drinkPhase === 'off' ? 0 : Math.min(1, inT / 0.08 + loopW)) * (1 - wSwap);

    // corpo: idle → oferta guiada pelo scroll → oferta em loop (troca e gole entram por cima)
    const wOffer = smooth(0.56, 0.66, p);
    const wOfferIdle = smooth(0.76, 0.84, p);
    const base = 1 - wSwap - wDrink; // os pesos somam 1
    idle.setEffectiveWeight((1 - wOffer) * base);
    offer.setEffectiveWeight(wOffer * (1 - wOfferIdle) * base);
    offerIdle.setEffectiveWeight(wOffer * wOfferIdle * base);
    swapAct.setEffectiveWeight(wSwap);
    drinkInAct.setEffectiveWeight(wDrink * (1 - loopW));
    drinkAct.setEffectiveWeight(wDrink * loopW);
    offer.time = THREE.MathUtils.clamp((p - 0.58) / 0.22, 0, 1) * (offerDur - 0.001);
    // gravidade zero: sobe, gira 360° (lento nas pontas) e pousa antes da oferta
    const air = smooth(0.18, 0.3, p) * (1 - smooth(0.5, 0.6, p));
    const turn = smooth(0.18, 0.56, p);
    model.position.y = air * (0.07 + Math.sin(time * 1.6) * 0.012);
    model.rotation.set(air * 0.06 * Math.sin(time * 0.9), turn * Math.PI * 2, air * 0.05 * Math.cos(time * 1.1));
    bones.head.quaternion.copy(headRest);
    bones.neck.quaternion.copy(neckRest);
    mixer.update(opts.reduced ? 0 : dt);

    // olhar segue o cursor (aditivo sobre a animação)
    lookX = damp(lookX, pointerX, 4, dt);
    lookY = damp(lookY, pointerY, 4, dt);
    // bebendo, a abóbora fica na lata (o olhar quase não puxa)
    const look = 1 - wDrink * 0.85;
    const yaw = lookX * THREE.MathUtils.degToRad(22) * look;
    const pitch = -lookY * THREE.MathUtils.degToRad(10) * look;
    bones.head.quaternion.multiply(q.setFromEuler(e.set(pitch * 0.7, yaw * 0.7, 0)));
    bones.neck.quaternion.multiply(q.setFromEuler(e.set(pitch * 0.3, yaw * 0.3, 0)));

    // brilho de vela
    const flick = 0.82 + 0.1 * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 13.1 + 1.7) + 0.04 * Math.sin(time * 23.9 + 0.4);
    // gole: a Fanta acende a abóbora; pulso a cada engolida (0,32 s e 0,96 s do loop) e brilho que cresce
    const lt = loopT % drinkDur;
    const gulp = loopW * gulpAt.reduce((s, g) => s + Math.exp(-(((lt - g) / 0.09) ** 2)), 0);
    const fill = Math.min(1, drinkHeld / 3);
    const glow = 1 + wDrink * (0.18 + 0.5 * fill + 0.3 * gulp);
    if (headMat) headMat.emissiveIntensity = 1.9 * flick * glow;
    model.updateMatrixWorld(true);
    bones.head.getWorldPosition(v);
    halo.position.set(v.x, v.y + 0.14, v.z - 0.12);
    halo.scale.setScalar(1.25 * (1 + wDrink * (0.12 + 0.25 * fill)));
    (halo.material as THREE.SpriteMaterial).opacity = Math.min(0.9, 0.5 * flick * glow);

    // latas: deriva lenta em gravidade zero, balançando em volta da pose (o rótulo nunca dá as costas);
    // no meio do scroll giram, se afastam do Jack e passam pela câmera
    const exit = smooth(0.16, 0.5, p);
    const shrink = 1 - smooth(0.42, 0.56, p) * 0.999;
    for (const o of orbits) {
      const t = time * 0.5 + o.phase;
      const s = o.spot;
      const drift = s.dist / 1.6; // a mesma deriva na tela para a lata perto e a do fundo
      v.set(o.anchor.x - exitX, o.anchor.y - 0.55, 0).normalize();
      o.root.position.set(
        o.anchor.x + Math.sin(t * 0.7) * 0.03 * drift + v.x * exit * 1.6,
        o.anchor.y + Math.sin(t * 0.9 + 1.3) * 0.028 * drift + v.y * exit * 1.1,
        o.anchor.z + Math.cos(t * 0.6) * 0.03 * drift + exit * exit * 1.6,
      );
      eCan.set(PITCH + Math.sin(t * 0.8) * 0.06, s.turn + Math.sin(t * 0.55 + 0.7) * 0.26, s.roll + Math.sin(t * 0.65 + 2.1) * 0.05);
      o.root.quaternion.copy(o.base).multiply(q.setFromEuler(eCan));
      if (exit > 0) o.root.quaternion.premultiply(q.setFromAxisAngle(o.spinAxis, exit * 3.2));
      o.root.scale.setScalar(o.scale * shrink);
      o.root.visible = o.scale * shrink > 0.01;
    }

    // vitrine: cada lata entra pela esquerda, uma por vez (a que vai mais longe primeiro, passando atrás
    // do Jack), vira o rótulo para a câmera e assenta com um balanço
    const vel = dt > 0 ? (rowPos - rowPrev) / dt : 0;
    rowPrev = rowPos;
    flashK = Math.max(0, flashK - dt * 1.5);
    (flash.material as THREE.SpriteMaterial).opacity = 0.7 * flashK * flashK;
    const fromX = -(rowHalfW + spacing);
    for (let i = 0; i < 6; i++) {
      const r = rows[i];
      const k = wrap(i - rowPos);
      const ak = Math.abs(k);
      // ordem de entrada pela vaga de destino: +2, +1, -1, -2 (a de ±3 espera fora do quadro)
      const kr = Math.round(wrap(i - sel));
      const rank = kr === 2 ? 0 : kr === 1 ? 1 : kr === -1 ? 2 : 3;
      const t0 = 0.4 + rank * 0.065;
      const enter = smooth(t0, t0 + 0.17, p);
      const ein = 1 - Math.pow(1 - enter, 3);
      // some no centro (está na mão do Jack) e no fundo do anel
      const op = enter > 0 ? smooth(0.28, 0.75, ak) * (1 - smooth(2.55, 2.95, ak)) : 0;
      r.root.visible = r.refl.visible = r.pool.visible = op > 0.005;
      if (!r.root.visible) continue;
      const x = THREE.MathUtils.lerp(fromX, slotX(k), ein);
      // inclinação: puxada pelo deslize (entrada ou troca) e amortecida até assentar
      const push = Math.sin(enter * Math.PI) * 0.14 + THREE.MathUtils.clamp(vel * 0.05, -0.12, 0.12);
      r.lean = damp(r.lean, -push, 7, dt);
      r.lift = damp(r.lift, hovered && Math.round(k) === hovered && !swap ? 1 : 0, 10, dt);
      const y = r.lift * 0.05;
      // chega meio de lado e vira o rótulo para a câmera; nas vagas, leve leque para o centro
      const yaw = (1 - ein) * -1.2 - k * 0.06;
      r.root.position.set(x, y, ROW_Z);
      r.root.rotation.set(0, yaw, r.lean);
      r.root.scale.setScalar(rowS);
      r.refl.position.set(x, -y, ROW_Z);
      r.refl.rotation.set(0, yaw, -r.lean);
      r.refl.scale.set(rowS, -rowS, rowS);
      for (const m of r.mats) m.opacity = op;
      r.fade.value = op;
      r.pool.position.set(x, 0.002, ROW_Z + 0.1);
      r.pool.scale.set(spacing * 2, 1, 1.3);
      (r.pool.material as THREE.MeshBasicMaterial).opacity = op * (0.85 + r.lift * 0.5);
    }

    // brasas sobem em espiral
    const pos = emberGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      let y = pos.getY(i) + dt * (0.04 + emberSeed[i] * 0.07);
      if (y > 1.6) y = -0.1;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.9 + emberSeed[i] * 20) * dt * 0.02);
    }
    pos.needsUpdate = true;

    frameCamera(p);
    renderer.render(scene, camera);
  }

  function pickAt(x: number, y: number) {
    if (p < PICK_FROM - 0.03) return 0;
    ndc.set(x, y);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, true).find((h) => rows[h.object.userData.flavor as number]?.root.visible);
    if (!hit) return 0;
    const k = Math.round(wrap((hit.object.userData.flavor as number) - sel));
    return Math.abs(k) <= 2 ? k : 0;
  }

  /** Acerto barato no Jack: esfera na abóbora + caixa no corpo (sem raycast na malha skinada). */
  function hitJack(x: number, y: number) {
    if (p < PICK_FROM - 0.03) return false;
    ndc.set(x, y);
    ray.setFromCamera(ndc, camera);
    bones.head.getWorldPosition(hitSphere.center);
    hitSphere.center.y += 0.16;
    model.getWorldPosition(v);
    hitBox.min.set(v.x - 0.21, v.y, v.z - 0.16);
    hitBox.max.set(v.x + 0.21, v.y + 0.58, v.z + 0.16);
    return ray.ray.intersectsSphere(hitSphere) || ray.ray.intersectsBox(hitBox);
  }

  let raf = 0;
  const loop = () => {
    raf = 0;
    resize();
    timer.update();
    step(Math.min(timer.getDelta(), 1 / 20));
    if (active && !opts.reduced) raf = requestAnimationFrame(loop);
  };
  resize();
  step(0);
  opts.onReady?.();
  if (!opts.reduced) raf = requestAnimationFrame(loop);

  return {
    setProgress(value) {
      target = THREE.MathUtils.clamp(value, 0, 1);
      if (opts.reduced) step(0);
    },
    setPointer(x, y) {
      pointerX = x;
      pointerY = y;
      const k = pickAt(x, y);
      hovered = k;
      canvas.style.cursor = k ? 'pointer' : drinkWant ? 'grabbing' : hitJack(x, y) ? 'grab' : '';
    },
    hitJack,
    drink(on) {
      if (on && p < PICK_FROM - 0.03) return false;
      if (on === drinkWant) return true;
      drinkWant = on;
      if (canvas.style.cursor) canvas.style.cursor = on ? 'grabbing' : 'grab';
      if (opts.reduced) step(0);
      else if (!raf && active) raf = requestAnimationFrame(loop);
      return true;
    },
    go(delta) {
      if (!delta || p < PICK_FROM - 0.03) return false;
      sel += delta;
      opts.onSelect?.(mod6(sel));
      if (!swap) startSwap(delta);
      else if (!swap.fired && swap.t < swapAt - 0.2) {
        // a mão ainda está indo para as costas: o mesmo gesto leva a fileira mais longe, sem salto
        const e = easeInOut(THREE.MathUtils.clamp((swap.t - SLIDE_A) / (SLIDE_B - SLIDE_A), 0, 1));
        swap.to += delta;
        swap.from = e < 1 ? (rowPos - swap.to * e) / (1 - e) : rowPos;
      } else pending += delta;
      if (opts.reduced) {
        while (swap) step(0);
      } else if (!raf && active) raf = requestAnimationFrame(loop);
      return true;
    },
    pickAt,
    setActive(next) {
      if (next === active) return;
      active = next;
      timer.update();
      if (active && !raf && !opts.reduced) raf = requestAnimationFrame(loop);
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
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
      labels.forEach((t) => t.dispose());
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

interface Shelf {
  root: THREE.Group;
  refl: THREE.Group;
  pool: THREE.Mesh;
  mats: THREE.Material[];
  fade: { value: number };
  lean: number;
  lift: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

