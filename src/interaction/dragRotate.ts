/**
 * Arrasto horizontal para girar a lata.
 *
 * Mouse: arrasto com botão principal. Toque/caneta: o elemento usa `touch-action: pan-y`, então o
 * navegador continua dono da rolagem vertical; só assumimos o gesto quando ele é claramente
 * horizontal. Nada de capturar todos os gestos ou prender a página.
 */

export interface DragRotateOptions {
  /** Quadro (float) atual no início do arrasto. */
  getFrame: () => number;
  /** Novo quadro manual. */
  setFrame: (frame: number) => void;
  /** Quantos quadros por pixel arrastado. */
  framesPerPixel: () => number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** Inércia ao soltar (desligada com movimento reduzido). */
  inertia: () => boolean;
  /** A inércia para assim que outro controlador (ex.: scroll) assume o vídeo. */
  stillInControl: () => boolean;
}

const INTENT_THRESHOLD = 7;
const HORIZONTAL_BIAS = 1.15;
const FRICTION = 0.92;

export function attachDragRotate(element: HTMLElement, options: DragRotateOptions): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startFrame = 0;
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  let velocity = 0; // quadros por ms
  let inertiaRaf = 0;
  let inertiaFrame = 0;

  const stopInertia = () => {
    if (inertiaRaf) cancelAnimationFrame(inertiaRaf);
    inertiaRaf = 0;
  };

  const frameForX = (x: number) => startFrame - (x - startX) * options.framesPerPixel();

  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    stopInertia();
    pointerId = event.pointerId;
    startX = lastX = event.clientX;
    startY = event.clientY;
    lastT = event.timeStamp;
    velocity = 0;
    dragging = false;
    if (event.pointerType === 'mouse') event.preventDefault(); // evita seleção de texto
  };

  const beginDrag = (event: PointerEvent) => {
    dragging = true;
    startFrame = options.getFrame();
    startX = event.clientX;
    lastX = event.clientX;
    lastT = event.timeStamp;
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      /* ponteiro já liberado */
    }
    element.classList.add('is-dragging');
    options.onDragStart?.();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    if (!dragging) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dy) > INTENT_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
        // Gesto vertical: é rolagem, devolve ao navegador.
        pointerId = null;
        return;
      }
      if (Math.abs(dx) > INTENT_THRESHOLD && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS) beginDrag(event);
      else return;
    }
    const dt = Math.max(1, event.timeStamp - lastT);
    const frameDelta = -(event.clientX - lastX) * options.framesPerPixel();
    velocity = velocity * 0.6 + (frameDelta / dt) * 0.4;
    lastX = event.clientX;
    lastT = event.timeStamp;
    options.setFrame(frameForX(event.clientX));
  };

  const finish = (event: PointerEvent, allowInertia: boolean) => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    if (!dragging) return;
    dragging = false;
    element.classList.remove('is-dragging');
    try {
      element.releasePointerCapture(event.pointerId);
    } catch {
      /* já liberado */
    }
    const idle = event.timeStamp - lastT > 80;
    if (allowInertia && options.inertia() && !idle && Math.abs(velocity) > 0.004) {
      inertiaFrame = options.getFrame();
      let last = performance.now();
      const step = (now: number) => {
        if (!options.stillInControl()) {
          inertiaRaf = 0;
          options.onDragEnd?.();
          return;
        }
        const dt = Math.min(48, now - last);
        last = now;
        inertiaFrame += velocity * dt;
        velocity *= Math.pow(FRICTION, dt / 16.7);
        options.setFrame(inertiaFrame);
        if (Math.abs(velocity) > 0.002) inertiaRaf = requestAnimationFrame(step);
        else {
          inertiaRaf = 0;
          options.onDragEnd?.();
        }
      };
      inertiaRaf = requestAnimationFrame(step);
    } else options.onDragEnd?.();
  };

  const onPointerUp = (event: PointerEvent) => finish(event, true);
  const onPointerCancel = (event: PointerEvent) => finish(event, false);

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('lostpointercapture', onPointerCancel);

  return () => {
    stopInertia();
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('lostpointercapture', onPointerCancel);
  };
}
