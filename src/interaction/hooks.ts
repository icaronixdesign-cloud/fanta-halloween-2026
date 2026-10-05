import { useEffect, useRef, useState, type RefObject } from 'react';
import { scrollEngine, type ScrollInfo } from './scrollEngine';

export const WIDE_LAYOUT_QUERY = '(min-aspect-ratio: 5/4) and (min-width: 720px)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export const usePrefersReducedMotion = (): boolean => useMediaQuery(REDUCED_MOTION_QUERY);
export const useWideLayout = (): boolean => useMediaQuery(WIDE_LAYOUT_QUERY);
export const useFinePointer = (): boolean => useMediaQuery(FINE_POINTER_QUERY);

/** Progresso de scroll de uma seção (palco preso), entregue fora do ciclo de render. */
export function useScrollProgress(
  sectionRef: RefObject<HTMLElement | null>,
  stageRef: RefObject<HTMLElement | null> | null,
  onProgress: (info: ScrollInfo) => void,
  enabled = true,
): void {
  const callbackRef = useRef(onProgress);
  useEffect(() => {
    callbackRef.current = onProgress;
  });
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !enabled) return;
    return scrollEngine.register(section, (info) => callbackRef.current(info), stageRef?.current ?? null);
  }, [sectionRef, stageRef, enabled]);
}

/** true quando o elemento está dentro (ou perto, conforme rootMargin) da viewport. */
export function useInView(ref: RefObject<HTMLElement | null>, rootMargin = '0px'): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

export interface Size {
  width: number;
  height: number;
}

/** Tamanho do palco; ignora 0×0 (aba oculta) e remede quando volta a ter área. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) return;
      setSize((previous) =>
        Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5
          ? previous
          : { width, height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('orientationchange', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', update);
    };
  }, [ref]);
  return size;
}

/**
 * Deslocamento discreto da composição pelo mouse. Escreve --mx/--my (-1…1, suavizados) no
 * elemento; o CSS converte em translate, sem escala nem distorção da mídia.
 */
export function usePointerParallax(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) {
      element?.style.setProperty('--mx', '0');
      element?.style.setProperty('--my', '0');
      return;
    }
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const step = () => {
      raf = 0;
      x += (targetX - x) * 0.08;
      y += (targetY - y) * 0.08;
      element.style.setProperty('--mx', x.toFixed(4));
      element.style.setProperty('--my', y.toFixed(4));
      if (Math.abs(targetX - x) > 0.001 || Math.abs(targetY - y) > 0.001) raf = requestAnimationFrame(step);
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      targetX = (event.clientX / window.innerWidth) * 2 - 1;
      targetY = (event.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      if (!raf) raf = requestAnimationFrame(step);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      element.style.setProperty('--mx', '0');
      element.style.setProperty('--my', '0');
    };
  }, [ref, enabled]);
}
