import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { FLAVOR_GLOW, FLAVOR_IDS, addMirrors, damp, radialTexture, setLabel, smooth } from './common';

/**
 * Vitrine final: as seis latas gigantes expostas num chão espelhado, com uma poça de luz na cor de cada sabor, e
 * o Jack pequeno embaixo carregando a caixa de ferro cheia de Fanta (clipes `carry`/`carry_walk` de
 * jack-carry.glb sobre o esqueleto do jack.glb; a caixa vai no osso livre prop_can, como a lata no hero).
 * Ele entra andando pela lateral; depois `hold` (segurar a seta), `step` (um toque) e `walkTo` (clique no palco)
 * o levam de um lado para o outro. Título e botão ficam no DOM, por cima do canvas: ao cruzar, ele passa por trás.
 * Arquivos em /media/jack/ (ver pumpkin-jack/LEIA-ME.md).
 */

const BASE = '/media/jack/';
const CAN_H = 0.122;
const CAN_ASPECT = 0.0666 / CAN_H;
/** Altura do Jack com o talo (m). */
const JACK_H = 0.98;
/** Velocidade andando (m/s): os passos de carry_walk a ~2x, sem os pés patinarem. */
const SPEED = 0.6;
/** Giro do corpo andando: quase de perfil, com o rosto da caixa ainda à vista. */
const FACE = THREE.MathUtils.degToRad(78);
/** Um toque na seta anda isto (m). */
const STEP = 0.55;

/** Latas dentro da caixa (m, espaço da caixa: x à direita, y para cima, z para a frente), como em pumpkin-jack. */
const BOX_CANS: Array<[(typeof FLAVOR_IDS)[number], number, number, number]> = [
  ['ghost-face-punch', -0.076, 0.148, 0],
  ['guarana', 0, 0.148, -0.002],
  ['maracuja', 0.076, 0.148, 0],
  ['uva', -0.076, 0.132, 0.048],
  ['laranja', 0, 0.132, 0.05],
  ['caju', 0.076, 0.132, 0.048],
];
const BOX_CAN_SCALE = 1.1;

/** Lugar de uma lata da vitrine: base na tela (x, y em -1…1) e altura na tela (fração da altura do quadro). */
interface Spot {
  x: number;
  y: number;
  h: number;
}

interface Layout {
  fov: number;
  /** Câmera inclinada para baixo (graus). */
  pitch: number;
  /** Altura do Jack na tela (fração). */
  jackH: number;
  /** Pés do Jack na tela (y em -1…1). */
  feetY: number;
  /** Onde ele para ao entrar (fração da meia-largura, -1…1). */
  rest: number;
  spots: Spot[];
}

// O texto fica no topo; as latas, na metade de baixo, logo atrás do Jack: ele anda na frente delas e cobre a parte
// de baixo dos rótulos, o que dá a profundidade (latas gigantes ao fundo, personagem pequeno no primeiro plano).
function layoutFor(aspect: number): Layout {
  if (aspect > 1.15) {
    // paisagem: as seis numa fileira; a altura cede quando a vaga fica estreita (telas quase quadradas)
    const step = 0.315;
    const h = Math.min(0.3, (0.78 * step * aspect) / (2 * CAN_ASPECT));
    return {
      fov: 30,
      pitch: 8,
      jackH: 0.33,
      feetY: -0.9,
      rest: -0.5,
      spots: FLAVOR_IDS.map((_, i) => ({ x: (i - 2.5) * step, y: -0.52, h })),
    };
  }
  // retrato: duas fileiras de três, a de trás aparecendo por cima da da frente
  const h = Math.min(0.17, (0.78 * 0.6 * aspect) / (2 * CAN_ASPECT));
  return {
    fov: 34,
    pitch: 14,
    jackH: 0.24,
    feetY: -0.76,
    rest: -0.45,
    spots: FLAVOR_IDS.map((_, i) =>
      i < 3 ? { x: (i - 1) * 0.6, y: -0.1, h: h * 0.8 } : { x: (i - 4) * 0.6, y: -0.4, h },
    ),
  };
}

export interface FinalShelf {
  setActive(active: boolean): void;
  /** Primeira chegada: as latas pousam uma a uma e o Jack entra andando pela esquerda. */
  enter(): void;
  /** Segurar uma direção: anda até soltar (0) ou até a borda. */
  hold(dir: number): void;
  /** Um passo curto na direção. */
  step(dir: number): void;
  /** Anda até o x do ponto clicado (coordenadas -1…1 do canvas). */
  walkTo(x: number, y: number): void;
  setPointer(x: number, y: number): void;
  dispose(): void;
}

interface Options {
  mobile: boolean;
  reduced: boolean;
  onReady?: () => void;
}

interface ShelfCan {
  root: THREE.Group;
  pool: THREE.Mesh;
  mats: THREE.Material[];
  fade: { value: number };
  depth: { value: number };
  base: THREE.Vector3;
  scale: number;
  spot: Spot;
  glow: number;
}

export async function createFinalShelf(canvas: HTMLCanvasElement, opts: Options): Promise<FinalShelf> {
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

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  // mesma luz do hero: principal quente, recorte laranja por trás, preenchimento frio
  scene.add(new THREE.HemisphereLight(0xffe9d6, 0x120a06, 0.3));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
  key.position.set(-1.2, 2.4, 1.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff7a2a, 1.9);
  rim.position.set(1.4, 1.6, -1.6);
  scene.add(rim);
  const fillLight = new THREE.DirectionalLight(0x9fb8ff, 0.3);
  fillLight.position.set(1.6, 0.5, 1.4);
  scene.add(fillLight);

  // ---------------------------------------------------------------- assets
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const texLoader = new THREE.TextureLoader();
  const [char, carry, boxGltf, can, clipsInfo, ...labels] = await Promise.all([
    loader.loadAsync(BASE + (opts.mobile ? 'jack-mobile.glb' : 'jack.glb')),
    loader.loadAsync(BASE + 'jack-carry.glb'),
    loader.loadAsync(BASE + 'caixa.glb'),
    loader.loadAsync(BASE + 'fanta-lata.glb'),
    fetch(BASE + 'clips.json').then(
      (r) => r.json() as Promise<{ clips: Record<string, { duration: number; stride?: number | null }> }>,
    ),
    ...FLAVOR_IDS.map((f) =>
      texLoader.loadAsync(`${BASE}labels/label-${f}.webp`).then((t) => {
        t.flipY = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        return t;
      }),
    ),
  ]);
  const labelOf = (id: string) => labels[FLAVOR_IDS.indexOf(id as (typeof FLAVOR_IDS)[number])];

  // ---------------------------------------------------------------- Jack + caixa
  const walker = new THREE.Group();
  scene.add(walker);
  const model = char.scene;
  walker.add(model);
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

  const box = boxGltf.scene;
  let glowMat: THREE.MeshStandardMaterial | null = null;
  box.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m.name === 'Box_Glow') {
      m.emissive.setRGB(0.28, 1, 0.2);
      glowMat = m;
    }
    else if (m.name === 'Box_Iron' || m.name === 'Box_Grip') rustify(m);
  });
  for (const [id, x, y, z] of BOX_CANS) {
    const c = can.scene.clone(true);
    setLabel(c, labelOf(id));
    c.position.set(x, y, z);
    c.scale.setScalar(BOX_CAN_SCALE);
    box.add(c);
  }
  bones.prop_can.add(box);

  const jackFade = { value: 1 };
  addMirrors(model, jackFade, { value: 0.45 });

  const glowTex = radialTexture();
  const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // sombra de contato: um borrão escuro no chão (também escurece o reflexo logo abaixo dele)
  const shadowTex = radialTexture();
  const contact = new THREE.Mesh(
    floorGeo,
    new THREE.MeshBasicMaterial({ map: shadowTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.75 }),
  );
  contact.renderOrder = 2;
  scene.add(contact);

  // ---------------------------------------------------------------- vitrine: seis latas gigantes
  const shelf: ShelfCan[] = FLAVOR_IDS.map((_, i) => {
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
      mats.push(m);
    });
    root.add(c);
    scene.add(root);
    const fade = { value: 0 };
    const depth = { value: 1 };
    addMirrors(c, fade, depth);
    const pool = new THREE.Mesh(
      floorGeo,
      new THREE.MeshBasicMaterial({
        map: glowTex, color: FLAVOR_GLOW[i], transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      }),
    );
    scene.add(pool);
    return { root, pool, mats, fade, depth, base: new THREE.Vector3(), scale: 1, spot: { x: 0, y: 0, h: 0 }, glow: 0 };
  });

  // ---------------------------------------------------------------- brasas
  const N = opts.mobile ? 60 : 120;
  const emberGeo = new THREE.BufferGeometry();
  const emberPos = new Float32Array(N * 3);
  const emberSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) emberSeed[i] = Math.random();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPos, 3));
  const embers = new THREE.Points(
    emberGeo,
    new THREE.PointsMaterial({
      map: glowTex, color: 0xff8a2a, size: 0.06, sizeAttenuation: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75,
    }),
  );
  scene.add(embers);
  let emberW = 4;
  let emberH = 3;

  // ---------------------------------------------------------------- animação
  const mixer = new THREE.AnimationMixer(model);
  const clip = (n: string) => {
    const c = carry.animations.find((a) => a.name === n);
    if (!c) throw new Error(`clipe ausente: ${n}`);
    return mixer.clipAction(c);
  };
  const idle = clip('carry').play();
  const walk = clip('carry_walk').play();
  walk.setEffectiveWeight(0);
  const walkInfo = clipsInfo.clips.carry_walk;
  const cycleSpeed = (walkInfo?.stride ?? 0.24) / (walkInfo?.duration ?? 0.8); // m/s com timeScale 1
  const headRest = bones.head.quaternion.clone();
  const neckRest = bones.neck.quaternion.clone();

  // ---------------------------------------------------------------- estado
  let width = 0;
  let height = 0;
  let layout = layoutFor(1.6);
  let minX = -1;
  let maxX = 1;
  let x = -99;
  let vx = 0;
  let yaw = 0;
  let wWalk = 0;
  let holdDir = 0;
  let target: number | null = null;
  let entered = false; // passou da borda: a partir daqui os limites valem
  let enterAt = -1; // instante da chegada (s); -1 = ainda não
  let pointerX = 0;
  let pointerY = 0;
  let lookX = 0;
  let lookY = 0;
  let active = true;
  let time = 0;
  const timer = new THREE.Timer();
  timer.connect(document);
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const walkPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  /** Onde o raio da tela (x, y em -1…1) cruza o plano. */
  function hit(px: number, py: number, plane: THREE.Plane, out: THREE.Vector3) {
    ndc.set(px, py);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(plane, out);
  }

  function placeCamera(px = 0, py = 0) {
    const t = Math.tan(THREE.MathUtils.degToRad(layout.fov / 2));
    // distância que dá ao Jack a altura pedida e altura que põe os pés no lugar pedido
    const dist = JACK_H / (2 * layout.jackH * t);
    const below = THREE.MathUtils.degToRad(layout.pitch) + Math.atan(-layout.feetY * t);
    camera.fov = layout.fov;
    camera.position.set(px * 0.08, dist * Math.tan(below) + py * 0.04, dist);
    camera.rotation.set(-THREE.MathUtils.degToRad(layout.pitch), px * 0.012, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    layout = layoutFor(w / h);
    placeCamera();
    camera.getWorldDirection(fwd);
    const t = Math.tan(THREE.MathUtils.degToRad(layout.fov / 2));
    // cada lata pousa no chão onde a base pedida na tela cruza o piso, na escala que dá a altura pedida
    shelf.forEach((s, i) => {
      s.spot = layout.spots[i];
      if (!hit(s.spot.x, s.spot.y, floor, s.base)) s.base.set(s.spot.x * 4, 0, -20);
      const along = v.copy(s.base).sub(camera.position).dot(fwd);
      s.scale = (2 * s.spot.h * t * along) / CAN_H;
      s.depth.value = s.scale * CAN_H * 0.45;
      s.pool.scale.set(s.scale * 0.2, 1, s.scale * 0.11);
      s.pool.position.set(s.base.x, 0.002, s.base.z + s.scale * 0.01);
    });
    // limites da caminhada: a meia-largura visível na altura dos pés, com folga para o corpo e a caixa
    const half = hit(1, layout.feetY, floor, v) ? Math.abs(v.x) : 2;
    minX = -half + 0.36;
    maxX = half - 0.36;
    if (entered) x = THREE.MathUtils.clamp(x, minX, maxX);
    if (target !== null) target = THREE.MathUtils.clamp(target, minX, maxX);
    // brasas no volume entre o Jack e a vitrine
    emberW = half * 2.4;
    emberH = camera.position.y * 1.6;
    const pos = emberGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      pos.setXYZ(i, (emberSeed[i] - 0.5) * emberW, Math.random() * emberH, -Math.random() * Math.abs(shelf[0].base.z) * 0.9 + 0.6);
    }
    pos.needsUpdate = true;
    if (opts.reduced && !entered) x = restX();
  }

  const restX = () => THREE.MathUtils.clamp(layout.rest * (maxX + 0.36), minX, maxX);

  function update(dt: number) {
    time += dt;

    // ---- caminhada: segurar a seta tem prioridade; senão, anda até o alvo e desacelera na chegada
    let want = 0;
    if (holdDir) {
      target = null;
      const blocked = entered && ((holdDir < 0 && x <= minX + 0.005) || (holdDir > 0 && x >= maxX - 0.005));
      want = blocked ? 0 : holdDir * SPEED;
    } else if (target !== null) {
      const dx = target - x;
      if (Math.abs(dx) < 0.015 && Math.abs(vx) < 0.12) target = null;
      else want = Math.sign(dx) * Math.min(SPEED, Math.abs(dx) * 2.4 + 0.1);
    }
    if (opts.reduced) {
      vx = 0;
    } else {
      vx = damp(vx, want, want ? 6 : 8, dt);
      x += vx * dt;
    }
    if (!entered && x >= minX) entered = true;
    if (entered) {
      if (x < minX) {
        x = minX;
        vx = Math.max(vx, 0);
      } else if (x > maxX) {
        x = maxX;
        vx = Math.min(vx, 0);
      }
    }
    const speed = Math.abs(vx);
    wWalk = damp(wWalk, Math.min(1, speed / 0.16), 10, dt);
    walk.timeScale = Math.max(speed, 0.05) / cycleSpeed;
    // de perfil para o lado em que anda; parado, vira de frente
    const dir = want ? Math.sign(want) : speed > 0.1 ? Math.sign(vx) : 0;
    yaw = opts.reduced ? 0 : damp(yaw, dir * FACE, 9, dt);
    walker.position.set(x, 0, 0);
    model.rotation.y = yaw;
    contact.position.set(x, 0.001, 0.02);
    contact.scale.set(0.62 + 0.12 * Math.abs(Math.sin(yaw)), 1, 0.42 + 0.14 * Math.abs(Math.sin(yaw)));

    idle.setEffectiveWeight(1 - wWalk);
    walk.setEffectiveWeight(wWalk);
    bones.head.quaternion.copy(headRest);
    bones.neck.quaternion.copy(neckRest);
    mixer.update(opts.reduced ? 0 : dt);

    // olhar segue o cursor (aditivo), menos quando anda de lado
    lookX = damp(lookX, pointerX, 4, dt);
    lookY = damp(lookY, pointerY, 4, dt);
    const look = 1 - wWalk * 0.7;
    const yawLook = (lookX - x / Math.max(maxX, 0.5) * 0.4) * THREE.MathUtils.degToRad(20) * look;
    const pitchLook = -lookY * THREE.MathUtils.degToRad(8) * look;
    bones.head.quaternion.multiply(q.setFromEuler(e.set(pitchLook * 0.7, yawLook * 0.7, 0)));
    bones.neck.quaternion.multiply(q.setFromEuler(e.set(pitchLook * 0.3, yawLook * 0.3, 0)));

    // brilho de vela na abóbora; o rosto da caixa pulsa devagar
    const flick = 0.82 + 0.1 * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 13.1 + 1.7) + 0.04 * Math.sin(time * 23.9 + 0.4);
    if (headMat) headMat.emissiveIntensity = 1.9 * flick;
    const pulse = 0.85 + 0.15 * Math.sin(time * 2.1) + 0.05 * Math.sin(time * 9.7);
    if (glowMat) glowMat.emissiveIntensity = 1.15 * pulse;

    // ---- vitrine: as latas pousam uma a uma (a de fora primeiro); a que está atrás do Jack acende a poça
    camera.getWorldDirection(fwd);
    v.set(x, 0.45, 0).project(camera);
    const jackScreenX = v.x;
    const since = enterAt < 0 ? -1 : time - enterAt;
    shelf.forEach((s) => {
      const order = Math.abs(s.spot.x) * 2.2 + (s.spot.y + 1) * 0.5;
      const pop = opts.reduced ? 1 : since < 0 ? 0 : smooth(0, 0.7, since - order * 0.18);
      const land = 1 - Math.pow(1 - pop, 3);
      const near = Math.exp(-(((jackScreenX - s.spot.x) / 0.17) ** 2)) * (entered ? 1 : 0);
      s.glow = damp(s.glow, near, 5, dt);
      const drop = (1 - land) * s.scale * CAN_H * 0.35;
      s.root.position.set(s.base.x, drop, s.base.z);
      s.root.rotation.set(0, Math.atan2(camera.position.x - s.base.x, camera.position.z - s.base.z) * 0.9, (1 - land) * 0.12 * Math.sign(s.spot.x || 1));
      s.root.scale.setScalar(s.scale * (0.92 + 0.08 * land));
      s.root.visible = pop > 0.001;
      for (const m of s.mats) m.opacity = Math.min(1, pop * 1.6);
      s.fade.value = pop;
      (s.pool.material as THREE.MeshBasicMaterial).opacity = pop * (0.7 + 0.55 * s.glow);
    });

    // brasas sobem devagar
    const pos = emberGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      let y = pos.getY(i) + dt * (0.08 + emberSeed[i] * 0.12);
      if (y > emberH) y = 0;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.7 + emberSeed[i] * 20) * dt * 0.04);
    }
    pos.needsUpdate = true;

    placeCamera(opts.reduced ? 0 : pointerX, opts.reduced ? 0 : pointerY);
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
  x = opts.reduced ? restX() : minX - 0.75;
  update(0);
  opts.onReady?.();
  if (!opts.reduced) raf = requestAnimationFrame(loop);
  // sem o laço (movimento reduzido), o quadro é refeito só quando algo muda
  if (opts.reduced) window.addEventListener('resize', kick);

  return {
    setActive(next) {
      if (next === active) return;
      active = next;
      timer.update();
      kick();
    },
    enter() {
      if (enterAt >= 0) return;
      enterAt = time;
      if (opts.reduced) {
        entered = true;
        x = restX();
      } else {
        x = Math.min(x, minX - 0.75);
        target = restX();
      }
      kick();
    },
    hold(dir) {
      holdDir = Math.sign(dir);
      if (opts.reduced && holdDir) x = THREE.MathUtils.clamp(x + holdDir * STEP, minX, maxX);
      kick();
    },
    step(dir) {
      if (!dir) return;
      const from = target ?? x;
      if (opts.reduced) x = THREE.MathUtils.clamp(x + Math.sign(dir) * STEP, minX, maxX);
      else target = THREE.MathUtils.clamp(from + Math.sign(dir) * STEP, minX, maxX);
      kick();
    },
    walkTo(px, py) {
      if (!hit(px, py, walkPlane, v)) return;
      const to = THREE.MathUtils.clamp(v.x, minX, maxX);
      if (opts.reduced) x = to;
      else target = to;
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
      labels.forEach((t) => t.dispose());
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

/**
 * Ferro gasto sem textura: ruído no espaço do objeto escurece e mancha o metal e abre placas de ferrugem
 * (mais ásperas e menos metálicas) — a caixa da Tripo veio sem UV.
 */
function rustify(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec3 vObj;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vObj = position;',
    );
    shader.fragmentShader = `varying vec3 vObj;
float rHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rHash(i), rHash(i + vec3(1, 0, 0)), f.x), mix(rHash(i + vec3(0, 1, 0)), rHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(rHash(i + vec3(0, 0, 1)), rHash(i + vec3(1, 0, 1)), f.x), mix(rHash(i + vec3(0, 1, 1)), rHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float rFbm(vec3 p) { return 0.5 * rNoise(p) + 0.3 * rNoise(p * 2.1) + 0.2 * rNoise(p * 4.3); }
` + shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float rust = smoothstep(0.56, 0.78, rFbm(vObj * 34.0));
  float grime = rFbm(vObj * 120.0 + 7.0);
  diffuseColor.rgb *= 0.78 + 0.44 * grime;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.11, 0.035), rust * 0.8);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.92, rust);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.15, rust);',
      );
  };
  m.customProgramCacheKey = () => 'box-rust';
}
