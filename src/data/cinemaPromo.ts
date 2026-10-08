/**
 * Textos e link da seção da promoção Fanta × Cinemark.
 * PROVISÓRIO: a imagem com as informações da promoção (image1) e a URL da página de destino ainda não
 * chegaram. Troque os campos abaixo quando chegarem; o componente só lê este arquivo.
 */
export interface CinemaPromoCopy {
  kicker: string;
  title: [string, string];
  lead: string;
  /** Itens curtos (mecânica, prêmio, prazo). Vazio = a lista não aparece. */
  details: string[];
  cta: { label: string; href: string };
  note: string;
}

export const CINEMA_PROMO: CinemaPromoCopy = {
  kicker: 'Fanta × Cinemark · Halloween 2026',
  title: ['A pipoca é de', 'quem pega primeiro.'],
  lead: 'Uma Fanta Halloween e o balde de pipoca da sessão: a dupla que até o Pânico queria.',
  details: [],
  cta: { label: 'Ver a promoção no Cinemark', href: 'https://www.cinemark.com.br/' },
  note: 'Mecânica, prazos e regulamento na página da promoção.',
};
