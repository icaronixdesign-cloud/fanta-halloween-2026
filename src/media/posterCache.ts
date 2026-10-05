/**
 * Pré-decodifica capas JPG para que uma troca de sabor só aconteça quando a próxima imagem
 * já pode ser pintada. Nunca bloqueia a interface: erro ou demora resolvem mesmo assim.
 */

const cache = new Map<string, Promise<boolean>>();
const DECODE_TIMEOUT_MS = 1600;

export function preloadPoster(url: string): Promise<boolean> {
  const existing = cache.get(url);
  if (existing) return existing;
  const promise = new Promise<boolean>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), DECODE_TIMEOUT_MS);
    image.onerror = () => finish(false);
    image.src = url;
    image
      .decode()
      .then(() => finish(true))
      .catch(() => finish(image.complete && image.naturalWidth > 0));
  });
  cache.set(url, promise);
  // Falhas não ficam em cache para permitir nova tentativa.
  promise.then((ok) => {
    if (!ok) cache.delete(url);
  });
  return promise;
}
