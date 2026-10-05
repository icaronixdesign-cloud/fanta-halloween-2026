# Fanta Halloween 2026 — apresentação interativa

Apresentação **conceitual e não oficial** da coleção, feita com os sete vídeos finais da revisão
`v2-tampa-fixa`. Vite + React + TypeScript, sem backend.

## Comandos

```bash
npm install
npm run dev        # http://localhost:5190
npm run build      # tsc + build em dist/ (copia public/media sem alterar)
npm run preview    # http://localhost:4180 (build de produção)
npm run lint
npm run typecheck
npm run verify     # testes no Chrome instalado; precisa do dev (ou BASE=http://localhost:4180)
```

`npm run verify` usa `playwright-core` com o Google Chrome instalado (canal `chrome`, que decodifica
H.264). Para usar outro executável, defina `CHROME_PATH`. A comparação de quadros também precisa do
`ffmpeg` no PATH. As capturas ficam em `scripts/verify/out/`.

## Estrutura

| Caminho | Conteúdo |
| --- | --- |
| `docs/fanta/` | Kit original (guia de animações, dados, manifesto, verificação dos MP4). |
| `public/media/fanta/` | 7 MP4 + 7 capas JPG da v2, **sem alteração** (md5 iguais aos da entrega). |
| `public/media/fanta/derived/` | Cópias derivadas e identificadas: miniaturas do seletor (`*-thumb-v2.webp`, recortes das capas), `fanta-colecao-quadro-000-v2.jpg` (quadro 0 da coleção; a capa oficial é o quadro 120), `fanta-<sabor>-quadro-090-v2.jpg` (lata de costas, capa durante a troca) e `sabores-elementos/` (frutas, gelo e gás gerados; ver `docs/elementos-gerados/`). |
| `public/media/fanta/cta/` | CTA final: `fanta-cta-scrub.mp4` (quadros 41–167 de `video-fanta_HD.mp4`, 24 fps, um quadro-chave por quadro, 9,3 MB) e capas dos quadros 0 e 5. |
| `src/data/` | `produtos-site.json` (do kit) + `products.ts` (acentos, descrição visual da arte, áreas seguras) + `flavorWorld.ts` (elementos de fundo por sabor). |
| `src/media/` | `ScrubVideoController` (controlador de vídeo), `framing` (enquadramento sem cortes), `frames`, `posterCache`, `debug`. |
| `src/interaction/` | Motor de scroll único, coreografia dos sabores (`flavorTimeline`), arrasto horizontal, navegação/seleção, hooks. |
| `src/components/` | Cabeçalho, hero da coleção, intervalo tipográfico, palco de sabores, fecho, CTA final. |
| `scripts/verify/` | Testes de navegador (layout, interação, prova de quadro, resiliência, resize) + `capture-swap.mjs` (capturas em pontos da troca) e `record-swap.mjs` (vídeo da rolagem real via screencast do CDP + ffmpeg); para a CTA, `capture-cta.mjs`, `record-cta.mjs` e `cta-checks.mjs` (movimento reduzido, botão, atraso do scrub na roda). |

## Palco de sabores: a troca de lata

- As seis renderizações têm o mesmo movimento quadro a quadro (medido por SSIM de bordas entre
  vídeos: deslocamento 0 é o melhor). Cada capítulo é **uma volta completa** que começa e termina
  com a lata de costas (quadro 90) e passa de frente (quadro 0) no meio. A velocidade de giro é
  `r + (1 − r)·cos²(πq)`: quase parada de frente, rápida nas trocas, contínua entre capítulos.
- A troca acontece **de costas**, num cruzamento de ±0,05 capítulo entre os dois vídeos no mesmo
  quadro: só mudam a cor dos respingos, o tom da tampa e o brilho do chão. Sem dupla exposição de
  rótulos. Se o vídeo do vizinho ainda não carregou, a capa de costas (quadro 90) cobre a troca.
- Um único número move a cena: o capítulo contínuo, suavizado (constante de 110 ms) sem prender a
  página. Ele define quadros, opacidade das camadas, mundo do sabor, barra do capítulo e um leve
  avanço de câmera (2,8 %) na troca. O texto troca letra a letra, no sentido da rolagem, um pouco
  antes do meio do cruzamento (com histerese ao parar).
- A 1ª lata entra girando enquanto o palco sobe; a última sai girando enquanto ele desce.
- Seletor/botões: sabor vizinho → a página desliza pela troca (1,15 s, interrompível); distante →
  corte rápido para preto.
- **Mundo do sabor** (`FlavorWorld`): frutas e gelo em lugares calculados a partir do enquadramento
  real e dos blocos de texto, mais bolhas de gás em canvas (mais rápidas enquanto a lata gira). A
  camada tem uma máscara com o buraco da área da lata em todos os quadros: **nada pinta sobre a
  lata**. Quem chega nasce de trás dela; quem sai passa pela câmera (cresce, desfoca, some).
  Profundidade = desfoque, brilho e deslocamento pelo mouse. Movimento reduzido: composição parada,
  só o sabor escolhido.

## CTA final (scroll transform)

Recria a referência `reference-cta.mp4` medida quadro a quadro (`src/interaction/ctaTimeline.ts`). O palco
fica preso por ~2,4 telas e uma batida suavizada (0–163, a mesma contagem da referência) move tudo:

- **Vídeo:** avança do quadro 0 ao 126 (acelera até 2× e assenta) e volta ao quadro 5, a pose final.
  Curva monotônica sobre os pontos medidos por diferença de imagem, sem tranco na virada.
- **Blocos que passam:** sobem na velocidade da página (1,25 % da altura por batida) e acendem no
  meio da tela, como os retângulos laranja da referência (laranja amostrado: `#f56301`).
- **Título** letra a letra, linha após linha; **degradê** na base; **botão** sobe de baixo e assenta
  ao lado do título. Leva ao capítulo da Uva (a lata na mão).
- **Tela em pé:** o vídeo cobre o palco e recua para o topo (escala ancorada no alto) antes do título,
  para o texto não ficar sobre a lata. **Entrada:** o topo do vídeo nasce do preto da seção anterior.
- **Movimento reduzido:** composição final parada (capa do quadro 5), sem vídeo nem blocos.

## Como a mídia é controlada

- **Um controlador por `<video>`**, com estados exclusivos: `scroll` (progresso da seção),
  `manual` (arrasto/slider/teclado), `returning` (volta suave ao scroll na próxima rolagem) e
  `play` (reprodução contínua opcional). No scrub o vídeo fica pausado, sem `autoplay` nem `loop`.
- Progresso → quadro inteiro (`round(p × (frames − 1))`) → `frame / fps`, limitado ao início do
  último quadro e à duração real. No máximo uma busca pendente por vídeo; só o alvo mais recente é
  mantido; `seeked` libera, `requestVideoFrameCallback` confirma o quadro apresentado, e um
  watchdog destrava buscas que não terminam. Cada troca de fonte invalida callbacks antigos.
- **Enquadramento:** o vídeo mantém 16:9 e cresce até cobrir o palco, mas nunca a ponto de a
  área segura (medida por desvio-padrão temporal de todos os quadros: lata em x 34–64 %, y 13–91 %;
  coleção em x 7–95 %, y 30–82 %) sair da tela ou encostar em textos. Degradês de borda só cobrem
  estúdio vazio. Sem blend, chroma key ou máscara sobre a lata (a máscara do mundo do sabor recorta
  os elementos de fundo, nunca o vídeo).
- **Carregamento:** coleção com `preload=auto`; nos sabores, no máximo 3 vídeos com fonte (exibido +
  os dois vizinhos, prontos para a troca), atribuídos só depois de 160 ms no sabor (passagens rápidas
  mostram capas) ou por intenção (hover/foco no seletor). Imagens do mundo: só do sabor exibido e dos
  vizinhos. Fora da área, o agendador para e a reprodução pausa.
- **Movimento reduzido:** sem seções presas ao scroll, sem parallax; capas por padrão, vídeo só
  quando a pessoa usa o slider, o arrasto ou o botão de reprodução.

Diagnóstico: com `?debug` na URL, `window.__fantaDebug.snapshot()` mostra o estado de cada controlador.

## Limites conhecidos

- Testado no Google Chrome (desktop e emulação móvel com toque). Safari/iOS, Firefox e aparelhos
  reais não foram testados aqui; onde `requestVideoFrameCallback` faltar, vale o fallback por `seeked`.
- As latas são recriações 3D (ver `docs/fanta/leia-me-refinamento-v2.txt`). A página não traz preço,
  disponibilidade, ingredientes, informação nutricional nem links de compra.
- As frutas do fundo são imagens geradas (direção de arte, não ingredientes). No celular, a lata
  ocupa quase toda a largura, então os elementos aparecem só nas bordas; no tablet e no desktop a
  composição completa cabe.
- Desempenho medido só no Chrome headless (renderização por software): com o mundo do sabor,
  média de 20,0 ms por quadro durante a rolagem contra 18,7 ms sem ele. Não houve medição em GPU real
  nem em celular.
