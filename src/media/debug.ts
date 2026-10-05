import type { ControllerSnapshot, ScrubVideoController } from './ScrubVideoController';

/**
 * Registro somente-leitura dos controladores, para inspeção no navegador e testes automatizados.
 * Ativo em desenvolvimento ou com `?debug` na URL.
 */

interface DebugApi {
  controllers: Map<string, ScrubVideoController>;
  snapshot(): ControllerSnapshot[];
  /** Estado de outras peças (ex.: `showcase`: capítulo suavizado e quadro esperado). */
  probes: Record<string, () => unknown>;
  probe(name: string): unknown;
}

declare global {
  interface Window {
    __fantaDebug?: DebugApi;
  }
}

const enabled =
  typeof window !== 'undefined' &&
  (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug'));

function api(): DebugApi | undefined {
  if (!enabled) return undefined;
  if (!window.__fantaDebug) {
    const controllers = new Map<string, ScrubVideoController>();
    const probes: Record<string, () => unknown> = {};
    window.__fantaDebug = {
      controllers,
      snapshot: () => [...controllers.values()].map((controller) => controller.getSnapshot()),
      probes,
      probe: (name) => probes[name]?.(),
    };
  }
  return window.__fantaDebug;
}

export function registerController(label: string, controller: ScrubVideoController): () => void {
  const registry = api();
  if (!registry) return () => {};
  registry.controllers.set(label, controller);
  return () => {
    if (registry.controllers.get(label) === controller) registry.controllers.delete(label);
  };
}

export function registerProbe(name: string, read: () => unknown): () => void {
  const registry = api();
  if (!registry) return () => {};
  registry.probes[name] = read;
  return () => {
    if (registry.probes[name] === read) delete registry.probes[name];
  };
}
