import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animatedPose, damp, warmUp } from './common';

/**
 * Jack na faixa de baixo da seção de sabores: na primeira vez que a seção aparece ele entra andando pela esquerda
 * (clipe `walk` do jack.glb, passos casados com o deslocamento), para no vão entre o numeral e a lata e fica
 * admirando a lata gigante (clipe `admire` de jack-admire.glb: mãos juntas no peito, suspiro, balanço). Parado, o
 * corpo gira para a lata e a cabeça completa o olhar; a cada troca de sabor ele reage ("ooh") e o recorte de luz
 * toma a cor do sabor. O quadro corta na canela, como se ele andasse na borda de baixo da tela.
 * Usa o jack-mobile.glb (texturas 1K): ele é pequeno aqui e a página já tem outras duas cenas 3D.
 */

const BASE = '/media/jack/';
/** Faixa visível do corpo (m): da canela ao topo do talo. */
const VIEW_LOW = 0.12;
const VIEW_HIGH = 1.0;
const FOV = 20;
/** Velocidade andando (m/s); o clipe walk avança 0,26 m por ciclo de 1 s. */
const SPEED = 0.68;
const STRIDE_SPEED = 0.26;
/** Andando, quase de perfil para a direita, com o rosto ainda à vista. */
const WALK_YAW = 1.25;

export interface JackAdmirer {
  /** A seção está na tela: na primeira vez, ele entra andando. */
  setShown(shown: boolean): void;
  /** Centro da lata em coordenadas -1…1 do próprio canvas (pode estar fora do quadro). */
  setTarget(x: number, y: number): void;
  /** Onde ele para: centro do corpo, em x -1…1 do canvas. */
  setStop(x: number): void;
  /** Fase e centro do corpo (x -1…1 do canvas), para diagnóstico. */
  getState(): { phase: 'waiting' | 'walking' | 'standing'; x: number };
  /** Troca de sabor: reação curta e cor do recorte. */
  react(accent: string): void;
  setActive(active: boolean): void;
  /** Nível leve (quality.ts): resolução 1× e 30 quadros/s. */
  setLite(lite: boolean): void;
  dispose(): void;
}

interface Options {
  reduced: boolean;
  lite?: boolean;
  onReady?: () => void;
}

export async function createJackAdmirer(canvas: HTMLCanvasElement, opts: Options): Promise<JackAdmirer> {
  let lite = Boolean(opts.lite);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, alpha: true, powerPreference: 'high-performance' });
  const pixelRatio = () => (lite ? 1 : Math.min(window.devicePixelRatio, 1.25));
  renderer.setPixelRatio(pixelRatio());
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

  // câmera de frente, enquadrando a faixa do corpo no plano z = 0 (x da tela vira x do mundo, linear)
  const half = (VIEW_HIGH - VIEW_LOW) / 2;
  const dist = half / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  camera.position.set(0, VIEW_LOW + half, dist);
  camera.lookAt(0, VIEW_LOW + half, 0);

  scene.add(new THREE.HemisphereLight(0xffe9d6, 0x120a06, 0.3));
  const key = new THREE.DirectionalLight(0xfff1e0, 2.1);
  key.position.set(-0.6, 2.2, 1.8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff7a2a, 2.2);
  rim.position.set(1.2, 1.4, -1.6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9fb8ff, 0.3);
  fill.position.set(1.6, 0.4, 1.4);
  scene.add(fill);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const [char, extra] = await Promise.all([
    loader.loadAsync(BASE + 'jack-mobile.glb'),
    loader.loadAsync(BASE + 'jack-admire.glb'),
  ]);
  const model = char.scene;
  const body = new THREE.Group();
  body.add(model);
  scene.add(body);
  let headMat: THREE.MeshStandardMaterial | null = null;
  const bones: Record<string, THREE.Bone> = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.name === 'Jack_Head') headMat = m;
    }
  });

  const mixer = new THREE.AnimationMixer(model);
  const find = (list: THREE.AnimationClip[], name: string) => {
    const c = list.find((a) => a.name === name);
    if (!c) throw new Error(`clipe ausente: ${name}`);
    return mixer.clipAction(c);
  };
  const walk = find(char.animations, 'walk').play();
  const admire = find(extra.animations, 'admire').play();
  // olhar por cima da animação: o osso volta ao último valor animado, não ao repouso (ver animatedPose)
  const lookPose = animatedPose([bones.head, bones.neck]);

  let width = 0;
  let height = 0;
  let halfW = 2;
  let stopNdc = 0.45;
  let phase: 'waiting' | 'walking' | 'standing' = opts.reduced ? 'standing' : 'waiting';
  let x = -99;
  let vx = 0;
  let wWalk = 0;
  let targetX = 0;
  let targetY = 0.8;
  let yaw = 0;
  let headYaw = 0;
  let headPitch = 0;
  let pulse = 0;
  let time = 0;
  let active = true;
  let shown = false;
  const rimColor = new THREE.Color(0xff7a2a);
  const rimTarget = new THREE.Color(0xff7a2a);
  const orange = new THREE.Color(0xff7a2a);
  const look = new THREE.Vector3();
  const head = new THREE.Vector3();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.45);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const timer = new THREE.Timer();
  timer.connect(document);

  const stopX = () => stopNdc * halfW;

  // Tamanho pelo ResizeObserver: ler clientWidth/clientHeight a cada quadro forçava o navegador a recalcular o estilo
  // da página no meio do quadro (o palco acabou de escrever opacidades e transforms).
  let boxW = canvas.clientWidth;
  let boxH = canvas.clientHeight;
  const observer = new ResizeObserver(([entry]) => {
    boxW = entry.contentRect.width;
    boxH = entry.contentRect.height;
    kick();
  });
  observer.observe(canvas);

  function resize() {
    const w = boxW;
    const h = boxH;
    if (!w || !h || (w === width && h === height)) return;
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfW = half * camera.aspect;
    if (phase === 'standing') x = stopX();
  }

  function step(dt: number) {
    time += dt;

    // ---- caminhada até o vão entre o numeral e a lata, desacelerando na chegada
    if (phase === 'walking') {
      const dx = stopX() - x;
      const want = dx > 0.01 ? Math.min(SPEED, dx * 1.6 + 0.06) : 0;
      vx = damp(vx, want, 5, dt);
      x += vx * dt;
      if (dx <= 0.01 && vx < 0.04) {
        phase = 'standing';
        vx = 0;
      }
    } else if (phase === 'standing') {
      x = damp(x, stopX(), 4, dt);
    }
    wWalk = opts.reduced ? 0 : damp(wWalk, phase === 'walking' ? Math.min(1, vx / 0.12) : 0, 6, dt);
    walk.timeScale = Math.max(vx, 0.05) / STRIDE_SPEED;
    walk.setEffectiveWeight(wWalk);
    admire.setEffectiveWeight(1 - wWalk);

    // ---- olhar: um ponto um pouco à frente dele, na direção da lata na tela (assim o rosto continua à vista)
    body.position.x = x;
    body.updateMatrixWorld();
    ndc.set(targetX, targetY);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, look)) look.set(0, 1.2, 0.45);
    bones.head.getWorldPosition(head);
    v.copy(look).sub(head);
    const wantYaw = THREE.MathUtils.clamp(Math.atan2(v.x, v.z), -1.2, 1.2);
    const wantPitch = THREE.MathUtils.clamp(Math.atan2(v.y, Math.hypot(v.x, v.z)), -0.2, 0.42);
    // andando: de perfil para a direita, a cabeça já namorando a lata; parado: o corpo vira para ela
    const bodyGoal = wWalk * WALK_YAW + (1 - wWalk) * wantYaw * 0.55;
    yaw = opts.reduced ? bodyGoal : damp(yaw, bodyGoal, 3, dt);
    const drift = opts.reduced ? 0 : Math.sin(time * 0.37) * 0.05 + Math.sin(time * 0.91 + 1.3) * 0.02;
    const ooh = Math.sin(Math.min(1, 1 - pulse) * Math.PI) * pulse;
    const headGoal = THREE.MathUtils.clamp(wantYaw - yaw, -0.9, 0.9) * (1 - wWalk * 0.6) + drift;
    headYaw = opts.reduced ? headGoal : damp(headYaw, headGoal, 3, dt);
    headPitch = opts.reduced ? wantPitch : damp(headPitch, wantPitch * (1 - wWalk * 0.5) + ooh * 0.16, 4, dt);
    body.rotation.y = yaw;
    body.position.y = ooh * 0.012;

    lookPose.restore();
    mixer.update(opts.reduced ? 0 : dt);
    lookPose.capture();
    // ossos: X inclina para a frente (para cima = negativo), Y gira
    bones.neck.quaternion.multiply(q.setFromEuler(e.set(-headPitch * 0.35, headYaw * 0.35, 0)));
    bones.head.quaternion.multiply(q.setFromEuler(e.set(-headPitch * 0.65, headYaw * 0.65, 0)));

    // vela na abóbora; a reação acende um pouco mais
    pulse = Math.max(0, pulse - dt * 1.4);
    const flick = 0.82 + 0.1 * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 13.1 + 1.7) + 0.04 * Math.sin(time * 23.9 + 0.4);
    if (headMat) headMat.emissiveIntensity = 1.9 * flick * (1 + pulse * 0.6);
    rimColor.lerp(rimTarget, opts.reduced ? 1 : 1 - Math.exp(-3 * dt));
    rim.color.copy(rimColor);

    body.visible = phase !== 'waiting';
    renderer.render(scene, camera);
  }

  let raf = 0;
  let skip = false;
  const loop = () => {
    raf = 0;
    // parado e sem reação (ou no nível leve): um quadro sim, outro não (sobra tempo para o vídeo da lata no mesmo vsync)
    const calm = lite || (phase === 'standing' && pulse === 0 && Math.abs(x - stopX()) < 0.002);
    skip = calm && !skip;
    if (!skip) {
      resize();
      timer.update();
      step(Math.min(timer.getDelta(), 1 / 15));
    }
    if (active && shown && !opts.reduced) raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (opts.reduced) {
      resize();
      step(0);
    } else if (!raf && active && shown) {
      timer.update();
      raf = requestAnimationFrame(loop);
    }
  };
  resize();
  await warmUp(renderer, scene, camera);
  if (opts.reduced) x = stopX();
  step(0);
  opts.onReady?.();
  if (opts.reduced) window.addEventListener('resize', kick);

  return {
    setShown(next) {
      if (next === shown) return;
      shown = next;
      if (shown && phase === 'waiting') {
        phase = 'walking';
        x = -halfW - 0.35; // logo fora da borda esquerda
        vx = SPEED;
        wWalk = 1;
        yaw = WALK_YAW;
      }
      kick();
    },
    setTarget(nx, ny) {
      targetX = nx;
      targetY = ny;
      if (opts.reduced) kick();
    },
    setStop(nx) {
      stopNdc = nx;
      if (opts.reduced) {
        x = stopX();
        kick();
      }
    },
    getState() {
      return { phase, x: x / halfW };
    },
    react(accent) {
      rimTarget.set(accent).lerp(orange, 0.35);
      if (phase === 'standing') pulse = 1;
      kick();
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      kick();
    },
    setLite(next) {
      if (next === lite) return;
      lite = next;
      renderer.setPixelRatio(pixelRatio());
      width = 0; // força o setSize com a nova resolução
      kick();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
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
      envTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
