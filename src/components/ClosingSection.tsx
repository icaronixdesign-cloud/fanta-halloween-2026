import { useMemo, useRef, type CSSProperties } from 'react';
import { COLLECTION, COLLECTION_ORDER } from '../data/products';
import { computeFraming } from '../media/framing';
import { useElementSize, useInView, useScrollProgress, useWideLayout } from '../interaction/hooks';
import { goToFlavor, goToSection } from '../interaction/navigation';

/**
 * Fecho: a capa oficial da coleção (Ghost Face Punch à frente) enquadrada sem cortes, com acesso
 * direto a cada sabor e chamadas de volta. A nota de projeto conceitual fica no rodapé.
 */

interface Props {
  reducedMotion: boolean;
}

export function ClosingSection({ reducedMotion }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const lineupRef = useRef<HTMLDivElement>(null);
  const wide = useWideLayout();
  const size = useElementSize(frameRef);
  const near = useInView(sectionRef, '80% 0px 80% 0px');

  const framing = useMemo(() => {
    if (!size.width || !size.height) return null;
    return computeFraming({
      containerWidth: size.width,
      containerHeight: size.height,
      aspect: COLLECTION.aspect,
      safe: COLLECTION.safe,
      insets: { top: 8, bottom: wide ? 56 : 8, left: 8, right: 8 },
    });
  }, [size, wide]);

  useScrollProgress(
    sectionRef,
    null,
    ({ scrollY, sectionTop, viewportHeight }) => {
      const lineup = lineupRef.current;
      if (!lineup) return;
      const enter = (scrollY + viewportHeight - sectionTop) / viewportHeight;
      lineup.style.setProperty('--enter', Math.min(1, Math.max(0, enter)).toFixed(4));
    },
    !reducedMotion,
  );

  return (
    <section id="sobre" ref={sectionRef} className="closing" aria-labelledby="closing-title">
      <div className="closing__head">
        <p className="closing__kicker">Fanta Halloween 2026</p>
        <h2 id="closing-title" className="closing__title" tabIndex={-1} data-section-focus>
          A coleção inteira,
          <br />
          lado a lado.
        </h2>
        <div className="closing__actions">
          <a
            className="button is-primary"
            href="#colecao"
            onClick={(event) => {
              event.preventDefault();
              goToSection('colecao', reducedMotion);
            }}
          >
            Ver coleção
          </a>
          <a
            className="button is-ghost"
            href="#sabores"
            onClick={(event) => {
              event.preventDefault();
              goToSection('sabores', reducedMotion);
            }}
          >
            Explore os sabores
          </a>
        </div>
      </div>

      <div className="closing__lineup" ref={lineupRef} data-reduced={reducedMotion}>
        <div className="closing__frame" ref={frameRef}>
          {framing && (
            <div
              className="closing__image framed-video"
              style={{ left: framing.left, top: framing.top, width: framing.width, height: framing.height }}
              data-revealed="false"
            >
              <img
                className="framed-video__poster"
                src={near ? COLLECTION.officialPoster : undefined}
                alt="Capa da coleção: as seis latas lado a lado, com Ghost Face Punch à frente"
                width={COLLECTION.width}
                height={COLLECTION.height}
                loading="lazy"
                decoding="async"
              />
              <span className="framed-video__fade is-top" style={{ height: framing.fades.top }} />
              <span className="framed-video__fade is-bottom" style={{ height: framing.fades.bottom }} />
              <span className="framed-video__fade is-left" style={{ width: framing.fades.left }} />
              <span className="framed-video__fade is-right" style={{ width: framing.fades.right }} />
            </div>
          )}
          {framing && wide && (
            <ul className="closing__labels" aria-label="Ir para um sabor">
              {COLLECTION_ORDER.map((item) => (
                <li
                  key={item.id}
                  style={
                    {
                      left: framing.left + item.collectionX * framing.width,
                      top: framing.safeRect.bottom,
                      '--item-accent': item.accent,
                    } as CSSProperties
                  }
                >
                  <a
                    href={`#sabor-${item.id}`}
                    onClick={(event) => {
                      if (goToFlavor(item.id, { moveFocus: true })) event.preventDefault();
                    }}
                  >
                    {item.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!wide && (
          <ul className="closing__chips" aria-label="Ir para um sabor">
            {COLLECTION_ORDER.map((item) => (
              <li key={item.id}>
                <a
                  className="hero__chip"
                  href={`#sabor-${item.id}`}
                  style={{ '--item-accent': item.accent } as CSSProperties}
                  onClick={(event) => {
                    if (goToFlavor(item.id, { moveFocus: true })) event.preventDefault();
                  }}
                >
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

    </section>
  );
}
