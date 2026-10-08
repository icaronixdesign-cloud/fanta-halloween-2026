import * as THREE from 'three';

/** Mesma ordem de FLAVORS em src/data/products.ts; é também a ordem das fileiras, da esquerda para a direita. */
export const FLAVOR_IDS = ['ghost-face-punch', 'guarana', 'maracuja', 'uva', 'laranja', 'caju'] as const;
/** Poça de luz no chão, por sabor. */
export const FLAVOR_GLOW = [0xa7466d, 0x268656, 0xa48148, 0x7055a5, 0xaf5f44, 0xa94a42];
export const FLAVOR_ACCENT = [0xff5fae, 0x52dd74, 0xf7c653, 0xac85ff, 0xff8b3d, 0xff5d4d];

export const smooth = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a: number, b: number, lambda: number, dt: number) => a + (b - a) * (1 - Math.exp(-lambda * dt));

/**
 * Fecha a emenda de um clipe em loop. Os clipes do Jack saíram do Blender com o último quadro um pouco diferente
 * do primeiro (o cabo da abóbora salta 2–6° a cada volta, os dedos ~1°). A diferença de cada trilha é distribuída
 * ao longo do clipe, de nada na primeira chave a tudo na última, então o movimento continua o mesmo e o fim
 * passa a ser igual ao começo.
 */
export function closeLoop(clip: THREE.AnimationClip): THREE.AnimationClip {
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const dq = new THREE.Quaternion();
  const part = new THREE.Quaternion();
  const ident = new THREE.Quaternion();
  for (const track of clip.tracks) {
    const { times, values } = track;
    const last = times.length - 1;
    const span = times[last] - times[0];
    if (last < 1 || span <= 0) continue;
    if (track instanceof THREE.QuaternionKeyframeTrack) {
      qa.fromArray(values, 0);
      qb.fromArray(values, last * 4);
      dq.copy(qb).invert().multiply(qa); // última · dq = primeira
      if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
      if (dq.w > 0.99999) continue;
      for (let k = 1; k <= last; k++) {
        part.copy(ident).slerp(dq, (times[k] - times[0]) / span);
        qa.fromArray(values, k * 4).multiply(part).normalize().toArray(values, k * 4);
      }
    } else {
      const n = track.getValueSize();
      const gap = Array.from({ length: n }, (_, c) => values[c] - values[last * n + c]);
      for (let k = 1; k <= last; k++) {
        const u = (times[k] - times[0]) / span;
        for (let c = 0; c < n; c++) values[k * n + c] += gap[c] * u;
      }
    }
  }
  return clip;
}

/**
 * Arredonda as quinas do clipe: as chaves do Blender (30 por segundo, depois enxugadas no export) são ligadas por
 * retas, então a lata e a mão mudam de direção de uma vez a cada chave (micro-trancos que aparecem quando o gesto
 * é rápido). Cada trilha é reamostrada em `rate` quadros por segundo e suavizada com uma gaussiana de `sigma`
 * segundos. Clipes em loop (`loop`) são suavizados em volta (a emenda continua fechada); os outros mantêm o
 * primeiro e o último valor exatos (reflexão ímpar nas pontas), então continuam encaixando nos clipes vizinhos.
 */
export function smoothClip(clip: THREE.AnimationClip, sigma: number, loop: boolean, rate = 120) {
  const dur = clip.duration;
  const count = Math.max(2, Math.round(dur * rate) + 1);
  const r = Math.max(1, Math.ceil(sigma * rate * 3));
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / (sigma * rate)) ** 2));
  const ksum = kernel.reduce((a, b) => a + b, 0);
  clip.tracks = clip.tracks.map((track) => {
    const n = track.getValueSize();
    const isQ = track instanceof THREE.QuaternionKeyframeTrack;
    if (track.times.length < 2 || !(track instanceof THREE.NumberKeyframeTrack || track instanceof THREE.VectorKeyframeTrack || isQ)) return track;
    // createInterpolant existe em toda trilha (a interpolação que ela já usa), só não está nos tipos
    const interp = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
    const times = new Float32Array(count);
    const raw = new Float32Array(count * n);
    for (let i = 0; i < count; i++) {
      times[i] = (dur * i) / (count - 1);
      raw.set(interp.evaluate(times[i]), i * n);
      // quatérnios: mesmo hemisfério do anterior, para a média não cortar caminho
      if (isQ && i) {
        let dot = 0;
        for (let c = 0; c < 4; c++) dot += raw[i * 4 + c] * raw[(i - 1) * 4 + c];
        if (dot < 0) for (let c = 0; c < 4; c++) raw[i * 4 + c] *= -1;
      }
    }
    const last = count - 1;
    // em loop, o fim pode ter terminado no hemisfério oposto ao do começo: a volta troca o sinal junto
    let wrapSign = 1;
    if (isQ && loop) {
      let dot = 0;
      for (let c = 0; c < 4; c++) dot += raw[c] * raw[last * 4 + c];
      if (dot < 0) wrapSign = -1;
    }
    const at = (i: number, c: number) => {
      if (loop) {
        if (i < 0) return wrapSign * raw[(i + last) * n + c];
        if (i > last) return wrapSign * raw[(i - last) * n + c];
        return raw[i * n + c];
      }
      if (i < 0) return 2 * raw[c] - raw[-i * n + c];
      if (i > last) return 2 * raw[last * n + c] - raw[(2 * last - i) * n + c];
      return raw[i * n + c];
    };
    const values = new Float32Array(count * n);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < n; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += kernel[k + r] * at(i + k, c);
        values[i * n + c] = s / ksum;
      }
      if (isQ) {
        const len = Math.hypot(values[i * 4], values[i * 4 + 1], values[i * 4 + 2], values[i * 4 + 3]) || 1;
        for (let c = 0; c < 4; c++) values[i * 4 + c] /= len;
      }
    }
    if (loop) values.copyWithin(last * n, 0, n); // o último quadro é o primeiro
    const Ctor = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack;
    return new Ctor(track.name, times, values);
  });
  clip.resetDuration();
  clip.duration = dur;
  return clip;
}

/**
 * Reparametriza um clipe pelo próprio movimento: devolve `n` instantes do clipe, e o instante k é quando os pontos
 * medidos (`points`, presos a ossos) já percorreram k/(n-1) do caminho somado de todos. Tocando o clipe por essa
 * tabela (`warpTime` em drinkMotion.ts) com um progresso que acelera e freia, a pose segue o mesmo caminho do
 * Blender, mas a velocidade sai do zero e volta a zero em vez de seguir os trancos do clipe. Avalia o clipe num
 * mixer próprio e devolve os ossos como estavam.
 */
export function motionWarp(
  root: THREE.Object3D,
  clip: THREE.AnimationClip,
  points: { bone: THREE.Object3D; at: THREE.Vector3 }[],
  n = 65,
  steps = 192,
): Float32Array {
  const saved: [THREE.Object3D, THREE.Vector3, THREE.Quaternion, THREE.Vector3][] = [];
  root.traverse((o) => saved.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip).play();
  action.paused = true;
  const dur = clip.duration;
  const times = new Float32Array(steps + 1);
  const dist = new Float32Array(steps + 1);
  const prev = points.map(() => new THREE.Vector3());
  const cur = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    times[i] = Math.min(dur * (i / steps), dur - 1e-4);
    action.time = times[i];
    mixer.update(0);
    root.updateMatrixWorld(true);
    let d = 0;
    points.forEach((pt, k) => {
      pt.bone.localToWorld(cur.copy(pt.at));
      if (i) d += cur.distanceTo(prev[k]);
      prev[k].copy(cur);
    });
    dist[i] = (i ? dist[i - 1] : 0) + d;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  for (const [o, p, q, s] of saved) {
    o.position.copy(p);
    o.quaternion.copy(q);
    o.scale.copy(s);
  }
  root.updateMatrixWorld(true);
  const total = dist[steps];
  const table = new Float32Array(n);
  let i = 0;
  for (let k = 0; k < n; k++) {
    const goal = total > 0 ? (k / (n - 1)) * total : 0;
    if (total <= 0) {
      table[k] = (k / (n - 1)) * dur;
      continue;
    }
    while (i < steps - 1 && dist[i + 1] < goal) i++;
    const span = dist[i + 1] - dist[i];
    table[k] = times[i] + (span > 0 ? THREE.MathUtils.clamp((goal - dist[i]) / span, 0, 1) : 0) * (times[i + 1] - times[i]);
  }
  table[0] = 0;
  table[n - 1] = times[steps];
  return table;
}

/**
 * Olhar (ou qualquer giro somado por cima da animação) sem acumular e sem saltos. O AnimationMixer só reescreve
 * um osso quando o valor animado muda de um quadro para o outro; se o osso voltasse ao repouso antes do update,
 * qualquer trecho parado do clipe deixaria o osso no repouso (o pescoço do Jack pulava 8° no gole). Então o osso
 * volta ao último valor animado: `restore()` antes de `mixer.update`, `capture()` logo depois, e só então o olhar.
 */
export function animatedPose(bones: THREE.Object3D[]) {
  const saved = bones.map((b) => b.quaternion.clone());
  return {
    restore() {
      bones.forEach((b, i) => b.quaternion.copy(saved[i]));
    },
    capture() {
      bones.forEach((b, i) => saved[i].copy(b.quaternion));
    },
  };
}

/** Cede a vez ao navegador (desenhar, rolar) entre duas tarefas pesadas. */
const yieldToBrowser = () => {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return s?.yield ? s.yield() : new Promise<void>((resolve) => setTimeout(resolve, 0));
};

/**
 * Deixa a cena pronta sem travar a página. Sem isto, o primeiro quadro de cada cena compilava todos os shaders de uma
 * vez (a thread principal ficava parada esperando o driver: 0,3–1,4 s ao entrar no hero, nos sabores e no cinema) e
 * subia todas as texturas no mesmo quadro. Aqui os shaders compilam em paralelo (`compileAsync` usa
 * KHR_parallel_shader_compile; sem a extensão o navegador volta ao jeito antigo) e as texturas sobem uma de cada
 * vez, cedendo a vez entre elas. Objetos escondidos agora (que só aparecem no meio da animação) entram também, senão
 * compilariam na hora em que aparecem. Chamar antes do primeiro quadro visível.
 */
export async function warmUp(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    await renderer.compileAsync(scene, camera);
  } finally {
    for (const o of hidden) o.visible = false;
  }
  const textures = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const mat = (o as THREE.Mesh).material;
    for (const m of mat ? (Array.isArray(mat) ? mat : [mat]) : []) {
      const uniforms = (m as THREE.ShaderMaterial).uniforms ?? {};
      const values = [...Object.values(m), ...Object.values(uniforms).map((u) => u?.value)];
      for (const value of values) if (value instanceof THREE.Texture && value.image) textures.add(value);
    }
  });
  for (const texture of textures) {
    await yieldToBrowser();
    renderer.initTexture(texture);
  }
}

/** Troca o rótulo; na primeira vez clona o material (as latas clonadas compartilham o original). */
export function setLabel(root: THREE.Object3D, map: THREE.Texture, clone = true) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const m = mesh.material as THREE.MeshPhysicalMaterial;
    if (m.name === 'Fanta_Label') {
      const target = clone ? m.clone() : m;
      target.map = map;
      mesh.material = target;
    }
  });
}

export function radialTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Reflexo no chão (plano y = 0) sem segunda passada de render: a cópia da malha usa este material, que espelha
 * a posição e a normal já no espaço do mundo (vale para malha skinada, porque a pele é aplicada antes), escurece
 * e some com a profundidade `depth` (m, uniforme: acompanha a escala) e desfoca o rótulo (mip mais baixo), como
 * num chão encerado. `fade` é compartilhado: 0 esconde o reflexo junto com o objeto.
 */
export function mirrorMaterial(src: THREE.Material, fade: { value: number }, depth: { value: number }): THREE.Material {
  const m = src.clone() as THREE.MeshStandardMaterial;
  // a reflexão inverte a ordem dos vértices: a face da frente passa a ser a de trás
  m.side = THREE.BackSide;
  m.normalMap = null;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = fade;
    shader.uniforms.uDepth = depth;
    shader.vertexShader = 'varying float vReflY;\n' + shader.vertexShader
      .replace(
        '#include <normal_vertex>',
        `#include <normal_vertex>
#ifndef FLAT_SHADED
  vec3 mirrorN = normalize( mat3( modelMatrix ) * objectNormal );
  mirrorN.y = -mirrorN.y;
  vNormal = normalize( mat3( viewMatrix ) * mirrorN );
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 mirrorW = modelMatrix * vec4( transformed, 1.0 );
  mirrorW.y = -mirrorW.y;
  vReflY = mirrorW.y;
  vec4 mvPosition = viewMatrix * mirrorW;
  gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = 'varying float vReflY;\nuniform float uFade;\nuniform float uDepth;\n' + shader.fragmentShader
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.rgb *= uFade * 0.26 * pow(clamp(1.0 + vReflY / uDepth, 0.0, 1.0), 2.2);',
      )
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor *= texture2D( map, vMapUv, 3.5 );\n#endif');
  };
  m.customProgramCacheKey = () => 'mirror';
  return m;
}

/** Cria, ao lado de cada malha de `root`, a cópia refletida (mesmo pai, mesma geometria, mesma pele). */
export function addMirrors(root: THREE.Object3D, fade: { value: number }, depth: { value: number }): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !mesh.userData.mirror) meshes.push(mesh);
  });
  return meshes.map((mesh) => {
    const material = mirrorMaterial(mesh.material as THREE.Material, fade, depth);
    const skinned = mesh as THREE.SkinnedMesh;
    let twin: THREE.Mesh;
    if (skinned.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(skinned.geometry, material);
      s.bind(skinned.skeleton, skinned.bindMatrix);
      twin = s;
    } else {
      twin = new THREE.Mesh(mesh.geometry, material);
    }
    twin.userData.mirror = true;
    twin.frustumCulled = false;
    twin.position.copy(mesh.position);
    twin.quaternion.copy(mesh.quaternion);
    twin.scale.copy(mesh.scale);
    mesh.parent?.add(twin);
    return twin;
  });
}
