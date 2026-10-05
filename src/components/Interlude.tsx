import { Fragment, useRef, type CSSProperties } from 'react';
import { FLAVORS } from '../data/products';
import { useScrollProgress } from '../interaction/hooks';

/**
 * Intervalo tipográfico entre a coleção e os sabores: duas linhas gigantes que correm em
 * sentidos opostos conforme a página passa (sem prender o scroll). Com movimento reduzido, ficam paradas.
 */

interface Props {
  reducedMotion: boolean;
}

export function Interlude({ reducedMotion }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useScrollProgress(
    sectionRef,
    null,
    ({ scrollY, sectionTop, viewportHeight }) => {
      const section = sectionRef.current;
      const inner = innerRef.current;
      if (!section || !inner) return;
      // Progresso de passagem: 0 quando a seção entra por baixo, 1 quando sai por cima.
      const travel = (scrollY + viewportHeight - sectionTop) / (section.offsetHeight + viewportHeight);
      inner.style.setProperty('--travel', Math.min(1.2, Math.max(-0.2, travel)).toFixed(4));
    },
    !reducedMotion,
  );

  const names = [...FLAVORS, ...FLAVORS];

  return (
    <section className="interlude" ref={sectionRef} aria-labelledby="interlude-title">
      <div className="interlude__inner" ref={innerRef}>
        <h2 id="interlude-title" className="interlude__line is-outline">
          <span>Escolha seu susto</span>
          <span aria-hidden="true">Escolha seu susto</span>
          <span aria-hidden="true">Escolha seu susto</span>
        </h2>
        <p className="interlude__line is-names" aria-hidden="true">
          {names.map((flavor, index) => (
            <Fragment key={`${flavor.id}-${index}`}>
              <span style={{ color: flavor.accent } as CSSProperties}>{flavor.name}</span>
              <span className="interlude__sep">✦</span>
            </Fragment>
          ))}
        </p>
        <p className="interlude__copy">
          Seis latas, seis personagens. Role para girar cada uma, arraste para explorar e troque de
          sabor quando quiser.
        </p>
      </div>
    </section>
  );
}
