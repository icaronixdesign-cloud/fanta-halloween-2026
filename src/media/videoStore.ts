/**
 * Vídeos de scrub baixados inteiros antes de entrarem em cena.
 *
 * Com a URL do MP4 no <video>, cada busca para um trecho ainda não baixado espera a rede: a lata congela 0,3–2,7 s no
 * meio do giro (medido com rolagem contínua). Aqui cada arquivo vira um Blob na memória e só então o elemento recebe
 * a URL dele: toda busca é local (1–3 ms com decodificação por hardware).
 *
 * Fila com prioridade (o sabor exibido primeiro, depois os próximos no sentido da rolagem) e no máximo dois downloads
 * de cada vez. Nada baixa antes de `startVideoDownloads()` (a página chama quando o hero termina de carregar), exceto
 * pedidos explícitos com `now` (a pessoa tocou no slider, por exemplo). Em erro, o consumidor volta à URL direta.
 */

export type VideoState = 'idle' | 'loading' | 'ready' | 'error';

interface Entry {
  url: string;
  state: VideoState;
  objectUrl: string | null;
  priority: number;
  urgent: boolean;
}

const MAX_PARALLEL = 2;
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let started = false;
let running = 0;
let version = 0;

function entryFor(url: string): Entry {
  let entry = entries.get(url);
  if (!entry) {
    entry = { url, state: 'idle', objectUrl: null, priority: Infinity, urgent: false };
    entries.set(url, entry);
  }
  return entry;
}

function notify(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function pump(): void {
  while (running < MAX_PARALLEL) {
    let next: Entry | null = null;
    for (const entry of entries.values()) {
      if (entry.state !== 'idle' || entry.priority === Infinity) continue;
      if (!started && !entry.urgent) continue;
      if (!next || entry.priority < next.priority) next = entry;
    }
    if (!next) return;
    void download(next);
  }
}

async function download(entry: Entry): Promise<void> {
  running += 1;
  entry.state = 'loading';
  notify();
  try {
    // Os dois primeiros da fila vão com prioridade alta; o resto não disputa banda com o hero.
    const response = await fetch(entry.url, { priority: entry.priority <= 1 || entry.urgent ? 'high' : 'low' } as RequestInit);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    entry.objectUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'video/mp4' }));
    entry.state = 'ready';
  } catch (error) {
    console.warn('[vídeo] download falhou; usando a URL direta', entry.url, error);
    entry.state = 'error';
  } finally {
    running -= 1;
    notify();
    pump();
  }
}

/** Libera a fila (até aqui só pedidos urgentes baixam). */
export function startVideoDownloads(): void {
  if (started) return;
  started = true;
  pump();
}

/**
 * Ordem desejada: `urls[0]` é o mais urgente. Quem não está na lista sai da fila (o que já baixou continua na
 * memória). `now` baixa mesmo antes de a fila ser liberada.
 */
export function prioritizeVideos(urls: readonly string[], now = false): void {
  const wanted = new Set(urls);
  for (const entry of entries.values()) {
    if (!wanted.has(entry.url) && entry.state === 'idle') entry.priority = Infinity;
  }
  urls.forEach((url, index) => {
    const entry = entryFor(url);
    entry.priority = index;
    if (now) entry.urgent = true;
  });
  pump();
}

/** URL para o <video>: o Blob quando pronto, a URL direta se o download falhou, senão null (fica a capa). */
export function playableSource(url: string): string | null {
  const entry = entries.get(url);
  if (!entry) return null;
  if (entry.state === 'ready') return entry.objectUrl;
  if (entry.state === 'error') return url;
  return null;
}

export function videoState(url: string): VideoState {
  return entries.get(url)?.state ?? 'idle';
}

export function subscribeVideos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function videoStoreVersion(): number {
  return version;
}
