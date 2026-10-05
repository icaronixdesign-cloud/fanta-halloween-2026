# Elementos de fundo dos sabores (gerados)

Folhas geradas em 2026-10-05 com o Figma AI (modelo `gpt-image-2.5-sunburst`, 1024 × 1024, plano
"luizfelipekall's team"), uma por sabor e uma de gelo compartilhada. São **direção de arte** para o
sabor, não lista de ingredientes: o site não afirma a composição de nenhum produto. Em Ghost Face
Punch, romã e framboesa são uma leitura de "punch" (não há perfil de sabor oficial).

## Do original ao site

1. Cada folha tem 3–4 elementos isolados sobre preto. Os blocos foram detectados por limiar de
   luminância (grade de 8 px, dilatação de 2 células para as gotas acompanharem a fruta) e recortados
   com 28 px de margem.
2. Os pretos abaixo de 3,5 % viram 0 e as bordas do recorte recebem 22 px de degradê.
3. Alfa a partir do preto: `a = (max(r,g,b)/255)^0.75`, cor = `rgb / a`. Sobre preto o resultado é
   idêntico ao original; sobre o brilho colorido do chão as partes escuras ficam parcialmente opacas.
4. Saída: `public/media/fanta/derived/sabores-elementos/*.webp` (WebP com alfa, qualidade 86).

## Prompts (estrutura comum)

> Low-key beverage advertising photograph on a pure solid black background (#000000). Three separate,
> fully isolated elements floating in darkness with wide empty black space between them, none touching
> each other or the image edges: … Dramatic chiaroscuro lighting: strong \<cor do sabor\> rim light
> from behind outlining every edge, soft side key light, deep shadows dissolving into pure black.
> Juicy, mouth-watering, cold, ultra sharp macro detail, photorealistic. No table, no surface, no
> floor, no reflection, no text, no logos, no props, no background gradient.

| Folha | Elementos | Luz de recorte |
| --- | --- | --- |
| `folha-ghost.png` | romã aberta, três framboesas, monte de sementes de romã | rosa-magenta |
| `folha-guarana.png` | cacho de guaraná aberto ("olhos"), fruto único, sementes | quente + verde ácido |
| `folha-maracuja.png` | metade de maracujá amarelo, metade menor, polpa escorrendo | quente |
| `folha-uva.png` | cacho de uva com condensação, bago cortado, bagos soltos | violeta |
| `folha-laranja.png` | rodela contra a luz, metade, casca em espiral | laranja |
| `folha-caju.png` | caju com castanha, caju cortado, fatia | coral |
| `folha-ice.png` | cubo de gelo, cubo menor, explosão de gotas e bolhas, lascas | branca fria |
