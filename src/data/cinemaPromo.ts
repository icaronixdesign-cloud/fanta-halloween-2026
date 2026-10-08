/**
 * Textos e link da seção da promoção Fanta × Cinemark. Os textos são os da página da campanha que veio como
 * referência (só o texto; o visual da seção é o do site). O componente só lê este arquivo.
 * PROVISÓRIO: a URL da página de cadastro ainda não chegou; até lá o botão aponta para o site do Cinemark.
 */
export interface CinemaPromoCopy {
  /** Etiqueta no canto de cima enquanto a cena passa. */
  tag: string;
  kicker: string;
  title: [string, string];
  lead: string;
  cta: { label: string; href: string };
  /** Detalhe da oferta, abaixo do botão. */
  offer: { label: string; title: string; text: string };
  /** Textos impressos nos dois ingressos (só visuais; o detalhe acessível é o da oferta). */
  ticket: { brand: string; discount: string; note: string; stub: string };
}

export const CINEMA_PROMO: CinemaPromoCopy = {
  tag: 'Fanta + Cinemark',
  kicker: 'Fanta Halloween',
  title: ['Fanta leva você', 'ao cinema'],
  lead: 'Registre-se para ganhar 50% off em dois ingressos no Cinemark.',
  cta: { label: 'Registre-se', href: 'https://www.cinemark.com.br/' },
  offer: {
    label: 'Fanta + Cinemark',
    title: '50% off em dois ingressos para o cinema',
    text: 'Escolha seu filme de terror favorito e viva a noite mais arrepiante do ano. Cadastre-se e ganhe 50% off em dois ingressos.',
  },
  ticket: { brand: 'Fanta × Cinemark', discount: '50% off', note: 'Sessão de terror · 2 ingressos', stub: 'Entrada' },
};
