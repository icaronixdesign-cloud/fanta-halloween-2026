// Gole do Jack sem navegador: carrega jack.glb no Node (sem texturas), prepara os clipes como o jackHero.ts
// (closeLoop, smoothClip, motionWarp), roda o mesmo controlador (src/three/drinkMotion.ts) com passo fixo de 60 Hz
// em vários gestos e mede saltos de osso e trancos (aceleração da lata, do rosto e da ponta do cabo). Compara com a
// lógica antiga (`atual`: loop sem emenda, peso em 80 ms, osso voltando ao repouso antes do mixer), que tinha o
// pescoço pulando 8° ao entrar no loop e ao soltar.
// node scripts/verify/drink-probe.mjs            → tabela + PASS/FAIL (sai com 1 se a versão nova tiver tranco)
// node scripts/verify/drink-probe.mjs emendas    → diferença entre o primeiro e o último quadro de cada loop
// node scripts/verify/drink-probe.mjs fidelidade → quanto a suavização desvia a pose do clipe original
// node scripts/verify/drink-probe.mjs velocidade [ini] [fim] → velocidades quadro a quadro no gesto do vídeo
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createDrinkState, drinkStep, warpTime } from '../../src/three/drinkMotion.ts';
import { animatedPose, closeLoop, motionWarp, smoothClip } from '../../src/three/common.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CAN_H = 0.122;
const DT = 1 / 60;

/** jack.glb sem imagens/texturas (no Node não há DOM para decodificar WebP; aqui só importam ossos e clipes). */
function withoutTextures(file) {
  const buf = fs.readFileSync(file);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const m of json.materials ?? []) {
    for (const k of Object.keys(m)) if (/Texture$/.test(k)) delete m[k];
    for (const k of Object.keys(m.pbrMetallicRoughness ?? {})) if (/Texture$/.test(k)) delete m.pbrMetallicRoughness[k];
  }
  for (const list of ['extensionsUsed', 'extensionsRequired']) if (json[list]) json[list] = json[list].filter((e) => e !== 'EXT_texture_webp');
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const bin = buf.subarray(20 + jsonLen);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + text.length + bin.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, text, bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

globalThis.self ??= globalThis; // o GLTFLoader procura `self`
const gltf = await new Promise((resolve, reject) =>
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(withoutTextures(path.join(ROOT, 'public/media/jack/jack.glb')), '', resolve, reject),
);
const model = gltf.scene;
const bones = {};
model.traverse((o) => o.isBone && (bones[o.name] = o));
const rest = Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, { q: b.quaternion.clone(), p: b.position.clone() }]));
const original = (n) => gltf.animations.find((a) => a.name === n);

// clipes preparados como no jackHero.ts (cópias: os originais servem para a lógica antiga)
const prepared = {};
for (const n of ['idle_hold', 'offer_idle', 'drink']) prepared[n] = smoothClip(closeLoop(original(n).clone()), 0.06, true, 60);
prepared.drink_in = smoothClip(original('drink_in').clone(), 0.03, false);
const WARP = motionWarp(model, prepared.drink_in, [
  { bone: bones.prop_can, at: new THREE.Vector3(0, 0, 0) },
  { bone: bones.prop_can, at: new THREE.Vector3(0, CAN_H, 0) },
  { bone: bones.head, at: new THREE.Vector3(0, 0.16, 0.16) },
  { bone: bones.hand_L, at: new THREE.Vector3(0, 0, 0) },
]);
const D_IN = original('drink_in').duration;
const D_LOOP = original('drink').duration;

function resetBones() {
  for (const [n, b] of Object.entries(bones)) {
    b.quaternion.copy(rest[n].q);
    b.position.copy(rest[n].p);
  }
}

/** Pose de um clipe num instante (ossos locais + pontos no mundo). */
function poseOf(clip, t) {
  resetBones();
  const mixer = new THREE.AnimationMixer(model);
  const a = mixer.clipAction(clip).play();
  a.paused = true;
  a.time = Math.min(t, clip.duration - 1e-4);
  mixer.update(0);
  model.updateMatrixWorld(true);
  const out = { local: {}, can: bones.prop_can.getWorldPosition(new THREE.Vector3()) };
  for (const [n, b] of Object.entries(bones)) out.local[n] = b.quaternion.clone();
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  return out;
}

/** A lógica antiga do jackHero.ts (até 2026-10-08), para comparação. */
function stepAntigo(S, want, dt) {
  if (want) {
    if (S.phase === 'off' || S.phase === 'out') S.phase = 'in';
    if (S.phase === 'in') {
      S.inT += dt;
      if (S.inT >= D_IN) {
        S.inT = D_IN;
        S.phase = 'loop';
        if (S.loopW < 0.01) S.loopT = 0;
      }
    }
    if (S.phase === 'loop') {
      S.loopT += dt;
      S.loopW = Math.min(1, S.loopW + dt / 0.12);
    }
  } else if (S.phase !== 'off') {
    S.phase = 'out';
    S.loopT += dt;
    S.loopW = Math.max(0, S.loopW - dt / 0.2);
    if (S.loopW === 0) S.inT -= dt * 1.15;
    if (S.inT <= 0) {
      S.inT = 0;
      S.phase = 'off';
    }
  }
  const w = S.phase === 'off' ? 0 : Math.min(1, S.inT / 0.08 + S.loopW);
  return { w, wIn: w * (1 - S.loopW), wLoop: w * S.loopW, inTime: Math.min(S.inT, D_IN - 0.001), loopTime: S.loopT % D_LOOP };
}

/** Roda um gesto (função t → segurando?) e devolve a pose quadro a quadro. */
function simulate(gesture, { nova = true, T = 10.5 } = {}) {
  resetBones();
  const mixer = new THREE.AnimationMixer(model);
  const clipOf = (n) => (nova ? prepared[n] : original(n));
  const offerIdle = mixer.clipAction(clipOf('offer_idle')).play();
  const drinkIn = mixer.clipAction(clipOf('drink_in')).play();
  const drink = mixer.clipAction(clipOf('drink')).play();
  drinkIn.paused = drink.paused = true;
  const S = nova ? createDrinkState() : { phase: 'off', inT: 0, loopT: 0, loopW: 0 };
  const look = animatedPose([bones.head, bones.neck]);
  const headRest = bones.head.quaternion.clone();
  const neckRest = bones.neck.quaternion.clone();
  const rows = [];
  for (let t = 0; t <= T; t += DT) {
    const want = gesture(t);
    let m;
    if (nova) {
      const sip = drinkStep(S, want, DT, D_LOOP);
      m = { w: sip.weight, wIn: sip.weight * (1 - sip.loop), wLoop: sip.weight * sip.loop, inTime: Math.min(warpTime(WARP, sip.progress), D_IN - 0.001), loopTime: sip.loopTime };
    } else m = stepAntigo(S, want, DT);
    offerIdle.setEffectiveWeight(1 - m.w);
    drinkIn.setEffectiveWeight(m.wIn);
    drink.setEffectiveWeight(m.wLoop);
    drinkIn.time = m.inTime;
    drink.time = m.loopTime;
    if (nova) look.restore();
    else {
      bones.head.quaternion.copy(headRest);
      bones.neck.quaternion.copy(neckRest);
    }
    mixer.update(DT);
    if (nova) look.capture();
    model.updateMatrixWorld(true);
    rows.push({
      t,
      phase: S.phase,
      local: Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, b.quaternion.clone()])),
      can: bones.prop_can.getWorldPosition(new THREE.Vector3()),
      face: bones.head.localToWorld(new THREE.Vector3(0, 0.16, 0.16)),
      tip: bones.stem_03.localToWorld(new THREE.Vector3(0, 0.05, 0)),
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  return rows;
}

/** Saltos isolados: um osso gira num quadro ≥1,5° e ≥2,5× o maior dos vizinhos. */
function pops(rows) {
  const names = Object.keys(rows[0].local);
  const d = rows.map((r, k) => (k ? Object.fromEntries(names.map((n) => [n, THREE.MathUtils.radToDeg(rows[k - 1].local[n].angleTo(r.local[n]))])) : null));
  const out = [];
  for (let k = 2; k < rows.length - 1; k++) {
    for (const n of names) {
      const x = d[k][n];
      if (x >= 1.5 && x >= 2.5 * Math.max(d[k - 1][n], d[k + 1][n])) out.push({ t: rows[k].t, bone: n, deg: x });
    }
  }
  return out;
}

/** Velocidade (cm/s) e aceleração (cm/s²) de cada ponto, quadro a quadro. */
function kinematics(rows) {
  const keys = ['can', 'face', 'tip'];
  const vel = rows.map((r, i) => (i ? Object.fromEntries(keys.map((k) => [k, r[k].clone().sub(rows[i - 1][k]).divideScalar(DT)])) : null));
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    const o = { t: rows[i].t, phase: rows[i].phase };
    for (const k of keys) {
      o[k + 'V'] = vel[i][k].length() * 100;
      o[k + 'A'] = vel[i][k].clone().sub(vel[i - 1][k]).length() / DT * 100;
    }
    out.push(o);
  }
  return out;
}

const GESTURES = {
  // o gesto da gravação de tela: segura 3,6 s, solta, segura 3 s
  video: (t) => (t >= 1.0 && t < 4.6) || (t >= 6.0 && t < 9.0),
  // toques curtos: solta subindo, logo depois de entrar no loop, toque mínimo, meio da subida
  toques: (t) => (t >= 1.0 && t < 1.25) || (t >= 1.6 && t < 2.75) || (t >= 3.4 && t < 3.45) || (t >= 4.2 && t < 4.7),
  // solta em fases diferentes da engolida
  soltaNoLoop: (t) => (t >= 1.0 && t < 3.0) || (t >= 4.0 && t < 6.37) || (t >= 7.2 && t < 9.95),
  // volta a segurar no meio da descida (cedo e tarde)
  voltaNoMeio: (t) => (t >= 1.0 && t < 3.0) || (t >= 3.3 && t < 4.5) || (t >= 5.0 && t < 6.0) || (t >= 6.55 && t < 8.0),
};
// limites da versão nova (a antiga chega a 16 000 cm/s² no cabo e 9 900 no rosto)
const LIMIT = { canA: 2500, faceA: 1200, tipA: 2500 };

const cmd = process.argv[2] ?? 'check';
if (cmd === 'check') {
  let fail = 0;
  console.log('gesto          versão  saltos   lata v / a máx   rosto a máx   cabo a máx   (cm/s · cm/s²)');
  for (const [name, gesture] of Object.entries(GESTURES)) {
    for (const nova of [false, true]) {
      const rows = simulate(gesture, { nova });
      const p = pops(rows);
      const k = kinematics(rows);
      const mx = (key) => Math.max(...k.map((r) => r[key]));
      console.log(
        `${name.padEnd(14)} ${(nova ? 'nova' : 'antiga').padEnd(6)} ${String(p.length).padStart(6)}   ${mx('canV').toFixed(0).padStart(4)} / ${mx('canA').toFixed(0).padStart(5)}   ${mx('faceA').toFixed(0).padStart(9)}   ${mx('tipA').toFixed(0).padStart(9)}`,
      );
      if (nova) {
        const bad = [p.length ? `${p.length} saltos (${p.map((x) => `${x.bone}@${x.t.toFixed(2)}`).join(', ')})` : '', ...Object.entries(LIMIT).filter(([key, lim]) => mx(key) > lim).map(([key, lim]) => `${key} ${mx(key).toFixed(0)} > ${lim}`)].filter(Boolean);
        if (bad.length) {
          fail++;
          console.log(`  FAIL ${name}: ${bad.join('; ')}`);
        }
      }
    }
  }
  console.log(fail ? `FAIL (${fail} gestos)` : 'PASS: nenhum salto e nenhum tranco acima do limite na versão nova');
  process.exit(fail ? 1 : 0);
}
if (cmd === 'emendas') {
  for (const n of ['idle_hold', 'offer_idle', 'drink']) {
    for (const [label, clip] of [['original', original(n)], ['preparado', prepared[n]]]) {
      const a = poseOf(clip, 0);
      const b = poseOf(clip, clip.duration);
      const worst = Object.keys(a.local).map((k) => [k, THREE.MathUtils.radToDeg(a.local[k].angleTo(b.local[k]))]).sort((x, y) => y[1] - x[1])[0];
      console.log(`${n.padEnd(10)} ${label.padEnd(9)} maior salto na emenda: ${worst[0]} ${worst[1].toFixed(2)}°`);
    }
  }
}
if (cmd === 'fidelidade') {
  for (const n of ['drink_in', 'drink', 'offer_idle']) {
    let worstCan = 0;
    let worstAng = ['', 0];
    for (let t = 0; t <= original(n).duration + 1e-6; t += DT) {
      const a = poseOf(original(n), t);
      const b = poseOf(prepared[n], t);
      worstCan = Math.max(worstCan, a.can.distanceTo(b.can) * 100);
      for (const k of Object.keys(a.local)) {
        const d = THREE.MathUtils.radToDeg(a.local[k].angleTo(b.local[k]));
        if (d > worstAng[1]) worstAng = [`${k}@${t.toFixed(2)}`, d];
      }
    }
    console.log(`${n.padEnd(10)} lata desvia no máximo ${worstCan.toFixed(2)} cm · maior giro ${worstAng[0]} ${worstAng[1].toFixed(1)}° (inclui a emenda fechada)`);
  }
}
if (cmd === 'velocidade') {
  const [lo, hi] = [Number(process.argv[3] ?? 4.5), Number(process.argv[4] ?? 5.8)];
  for (const r of kinematics(simulate(GESTURES.video))) {
    if (r.t >= lo && r.t <= hi) console.log(r.t.toFixed(3), r.phase.padEnd(4), 'lata', r.canV.toFixed(1).padStart(6), 'cm/s · rosto', r.faceV.toFixed(1).padStart(6), '· cabo', r.tipV.toFixed(1).padStart(6));
  }
}
