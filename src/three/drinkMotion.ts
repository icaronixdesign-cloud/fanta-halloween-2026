/**
 * Gole do Jack ("segure para um gole"): decide, quadro a quadro, quanto da subida da lata (`drink_in`, da oferta
 * até a boca) já foi feito e quanto o loop `drink` (engolidas) já substituiu a subida, por cima da pose de oferta.
 *
 * A subida é medida em progresso ao longo do próprio movimento (0 = oferta, 1 = lata na boca), não em tempo do
 * clipe: o clipe saiu do Blender arrancando forte (a lata vai de parada a 137 cm/s em 0,3 s), então o tempo do
 * clipe vem de uma tabela (`motionWarp` em common.ts) que dá o instante em que cada fração do caminho é atingida.
 * O progresso anda com aceleração e frenagem limitadas: a lata sai do repouso, cruza, freia ao chegar à boca e
 * ao voltar à oferta, e se o gesto muda no meio ela desacelera e inverte, sem tranco. O loop entra por cima do fim
 * da subida (é a mesma pose) e, ao soltar, sai enquanto a lata já começa a descer. Sem DOM nem three: o teste
 * numérico (scripts/verify/drink-probe.mjs) roda este mesmo arquivo no Node.
 */

export interface DrinkState {
  phase: 'off' | 'in' | 'loop' | 'out';
  /** Progresso da subida ao longo do caminho (0–1), com aceleração e frenagem limitadas. */
  p: number;
  /** Velocidade do progresso (1/s, negativa ao descer). */
  v: number;
  /** `p` amortecido (é este que vai para a pose): a aceleração também fica contínua, sem quina ao começar a
   * frear e sem frear no máximo até o instante de parar. */
  ps: number;
  /** Velocidade de `ps`. */
  pv: number;
  /** Tempo no loop `drink` (s, sem módulo). */
  loopT: number;
  /** 0–1: quanto o loop já substituiu a subida (linear; o peso usa smoothstep). */
  loopU: number;
}

export interface DrinkMix {
  /** Peso do gole sobre a pose de oferta (0–1). */
  weight: number;
  /** Parte do gole que é o loop (0–1); o resto é `drink_in`. */
  loop: number;
  /** Progresso da subida; o tempo de `drink_in` sai de `warpTime`. */
  progress: number;
  loopTime: number;
}

/** Velocidades em progresso por segundo; acelerações em progresso por segundo². */
export const DRINK_TUNING = {
  /** Cruzeiro da subida: com a arrancada e a frenagem, sobe em ~1 s. */
  inRate: 1.3,
  /** Cruzeiro da descida (volta à oferta em ~1,25 s). */
  outRate: 1.3,
  /** Arrancada (sai do zero até o cruzeiro em ~0,3 s). */
  accel: 4,
  /** Frenagem ao chegar à boca e ao pousar na oferta. */
  brake: 3.5,
  /** s: o loop entra por cima do fim da subida. */
  loopIn: 0.3,
  /** s: ao soltar, o loop sai enquanto a lata já desce. */
  loopOut: 0.4,
  /** Progresso em que o gole entra/sai por cima da oferta (a cabeça assenta junto, sem segundo movimento). */
  blend: 0.25,
  /** s: amortecimento crítico do progresso (arredonda o começo e o pouso). */
  settle: 0.09,
};

export function createDrinkState(): DrinkState {
  return { phase: 'off', p: 0, v: 0, ps: 0, pv: 0, loopT: 0, loopU: 0 };
}

/** Mola criticamente amortecida até `target` (o SmoothDamp clássico), estável com qualquer `dt`. */
function smoothDamp(s: DrinkState, target: number, time: number, dt: number) {
  const omega = 2 / time;
  const x = omega * dt;
  const k = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = s.ps - target;
  const temp = (s.pv + omega * change) * dt;
  s.pv = (s.pv - omega * temp) * k;
  s.ps = target + (change + temp) * k;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};

/** Aproxima `v` de `target` subindo com aceleração `up` e descendo com `down`. */
function approach(v: number, target: number, up: number, down: number, dt: number) {
  return v < target ? Math.min(target, v + up * dt) : Math.max(target, v - down * dt);
}

/** Instante do clipe para o progresso `p`, pela tabela de `motionWarp` (entradas igualmente espaçadas em 0–1). */
export function warpTime(table: ArrayLike<number>, p: number) {
  const n = table.length - 1;
  const x = clamp01(p) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

export function drinkMix(s: DrinkState, loopDur: number): DrinkMix {
  const loop = ease(s.loopU);
  const weight = s.phase === 'off' ? 0 : Math.max(ease(s.ps / DRINK_TUNING.blend), loop);
  return { weight, loop, progress: clamp01(s.ps), loopTime: ((s.loopT % loopDur) + loopDur) % loopDur };
}

/** Avança `dt` segundos com o gesto `want` (segurando ou não). */
export function drinkStep(s: DrinkState, want: boolean, dt: number, loopDur: number): DrinkMix {
  const T = DRINK_TUNING;
  if (want) {
    // voltou a segurar: se a lata ainda está na boca (loop saindo), retoma o loop; senão sobe de novo
    if (s.phase === 'off' || s.phase === 'out') s.phase = s.loopU > 0 && s.p >= 0.98 ? 'loop' : 'in';
  } else if (s.phase !== 'off') {
    s.phase = 'out';
  }

  if (s.phase === 'in') {
    // sobe acelerando e freia para chegar parado à boca (a velocidade cabe na distância que falta)
    const reach = Math.sqrt(2 * T.brake * Math.max(0, 1 - s.p));
    s.v = approach(s.v, Math.min(T.inRate, reach), T.accel, s.v > reach ? T.brake * 3 : T.brake, dt);
    s.p += s.v * dt;
    s.loopU = Math.max(0, s.loopU - dt / T.loopOut);
    if (s.loopU > 0) s.loopT += dt;
    if (s.p >= 0.999) {
      s.p = 1;
      s.v = 0;
      s.phase = 'loop';
      if (s.loopU <= 0) s.loopT = 0; // o loop começa na pose em que a subida termina
    }
  } else if (s.phase === 'loop') {
    s.loopT += dt;
    s.loopU = Math.min(1, s.loopU + dt / T.loopIn);
    // voltou a segurar quando a lata mal tinha começado a descer: termina a subida devagar
    s.v = 0;
    s.p = Math.min(1, s.p + dt * 0.5);
  } else if (s.phase === 'out') {
    // o loop continua andando enquanto sai (sem congelar no meio da engolida) e a lata já desce, acelerando e
    // freando para pousar na oferta
    s.loopT += dt;
    s.loopU = Math.max(0, s.loopU - dt / T.loopOut);
    const reach = Math.sqrt(2 * T.brake * Math.max(0, s.p));
    s.v = approach(s.v, -Math.min(T.outRate, reach), -s.v > reach ? T.brake * 3 : T.brake, T.accel, dt);
    s.p = Math.max(0, s.p + s.v * dt);
  }
  smoothDamp(s, s.p, T.settle, dt);
  if (s.phase === 'out' && s.p <= 0.001 && s.ps <= 0.002 && Math.abs(s.pv) < 0.02 && s.loopU <= 0) {
    s.phase = 'off';
    s.p = s.v = s.ps = s.pv = 0;
    s.loopT = 0;
  }
  return drinkMix(s, loopDur);
}
