Crie e implemente um site interativo de apresentação da coleção **Fanta Halloween 2026**, usando todos os sete vídeos finais que forneci e as referências de site enviadas nesta conversa. Quero o site funcionando em localhost, com acabamento visual forte, animações ligadas à rolagem e exploração das latas com mouse e toque. Execute o trabalho; não entregue apenas um plano ou mockup.

## Primeiro, entenda os materiais

- Leia os documentos deste kit, especialmente `03-GUIA-ANIMACOES.md` e `04-produtos-site.json`. Localize-os no projeto ou nos anexos; os caminhos podem variar.
- Inspecione o projeto existente, seus comandos e dependências. Reaproveite sua estrutura e preserve arquivos não relacionados. Se não existir projeto, monte uma base simples e adequada para desenvolvimento local. Não adicione backend sem necessidade.
- Analise as referências que enviei: composição, tipografia, navegação, ritmo da rolagem, transições, estados de interação e adaptação mobile. Identifique brevemente o que vai aproveitar e passe à implementação. Adapte a linguagem à coleção Fanta; mantenha marcas de terceiros fora do resultado.
- Confira capas e vários pontos dos vídeos antes de desenhar os enquadramentos. Use somente a revisão `v2-tampa-fixa`, com as tampas encaixadas. Se faltar um arquivo essencial, diga exatamente qual é, enquanto avança nas partes independentes.

## Direção visual e conteúdo

As referências enviadas devem orientar a composição final. Como base, quero uma experiência de produto imersiva, com tipografia expressiva, latas grandes, bom espaço, contraste legível e transições cuidadosas. Integre a mídia de estúdio escura e os acentos por sabor ao layout. Evite uma apresentação genérica formada apenas por cartões iguais.

Preserve nomes, cores e personagens que aparecem nas artes: Ghost Face Punch, Guaraná, Maracujá, Uva, Laranja e Caju. Maracujá e Caju têm versões distintas do personagem e da paleta. Os vídeos são os ativos finais: mantenha suas artes, proporções e movimento renderizado. Não refaça ou substitua as latas por modelos genéricos, emojis, imagens geradas ou rotações CSS de uma imagem plana.

Escreva os textos de interface em português do Brasil. Use títulos e chamadas curtas, como “Explore os sabores” e “Ver coleção”, com ações reais. Não invente preço, disponibilidade, ingredientes, tabela nutricional, benefícios, promoções, licenciamento ou links de compra. Não apresente o projeto como um portal oficial ou uma parceria confirmada. As limitações das recriações estão documentadas no kit.

## Experiência obrigatória

1. **Apresentação da coleção:** use `fanta-colecao-loop.mp4`, com as seis latas visíveis e destaque para Ghost Face Punch. Crie uma sequência de entrada e exploração ligada ao scroll. O avanço e o retorno da rolagem devem controlar a animação de forma reversível. Integre o título e a chamada sem cobrir os produtos.
2. **Exploração dos seis sabores:** cada sabor precisa de uma apresentação visível com seu vídeo individual correto, nome e acento de cor. Permita selecionar diretamente qualquer sabor. Adapte a organização às referências: capítulos de rolagem, um palco com seletor ou uma combinação coerente. Todos os seis vídeos precisam ser usados na experiência principal, não apenas guardados nos assets ou escondidos em links.
3. **Mouse, teclado e toque:** no produto ativo, permita explorar a rotação por arrasto horizontal ou um controle equivalente claramente indicado. Ofereça um slider acessível como alternativa. O deslocamento do mouse pode mover discretamente a composição, sem distorcer as latas. No celular, preserve a rolagem vertical e ofereça controles fáceis de tocar. Navegação e seleção precisam funcionar pelo teclado.
4. **Transições:** trocas de sabor e entrada/saída de seções devem preservar a mídia visível enquanto o próximo vídeo carrega. Use as capas para evitar quadros vazios. Mantenha o nome, a cor, a capa e o vídeo sincronizados mesmo em trocas rápidas.
5. **Responsividade:** componha desktop, tablet e celular deliberadamente. Mantenha a tampa, a base, o logo e o personagem dentro do enquadramento. Para a coleção, preserve as seis latas. Não transforme automaticamente os vídeos 16:9 em recortes verticais que cortem os produtos.

## Integração das animações

Os vídeos são MP4 com fundo de estúdio já renderizado, sem transparência. Integre esse fundo ao design. Não use chroma key, remoção de preto, `mix-blend-mode: screen` ou efeitos semelhantes: o preto também faz parte das latas e das artes. Não separe, oculte, recorte ou recrie a tampa no site.

Implemente um controlador reutilizável de vídeo, com estados claros para scroll, exploração manual e reprodução contínua opcional. Em cada instante, apenas um desses estados deve controlar o tempo do mesmo vídeo. No modo scroll/manual, o vídeo fica pausado e o controlador muda `currentTime`; não deixe autoplay disputar esse tempo.

Siga o guia técnico para mapear progresso em quadros, evitar o fim exato do arquivo, coalescer seeks e tratar carregamento. Não prometa precisão de quadro apenas por atribuir `currentTime`: confirme o resultado no navegador. Se usar uma biblioteca de animação, reutilize uma já presente ou instale apenas a necessária, verificando sua documentação atual.

Carregue a mídia de forma progressiva, priorizando o hero e o produto ativo. Não carregue os sete MP4 inteiros de uma vez nem converta automaticamente todos em milhares de imagens. Suspenda vídeos e callbacks fora da área relevante. Respeite `prefers-reduced-motion`, com capas, navegação funcional e redução dos efeitos; o conteúdo deve continuar acessível. Mantenha um fallback de imagem em erro de mídia ou autoplay bloqueado.

## Código e entrega

Separe dados de produtos, componentes de mídia e lógica de interação. Use nomes claros, remova listeners/callbacks ao desmontar e trate resize, mudança de orientação e troca de fonte. Evite caminhos absolutos do meu computador no código do site. Mantenha os assets originais; qualquer otimização adicional deve usar cópias identificadas e preservar a variante de scroll validada.

Implemente, execute e confira o site. Faça as verificações compatíveis com o ambiente: build, tipos/lint quando configurados, arquivos sem 404 e inspeção no navegador quando disponível. Teste pelo menos larguras próximas de 1440, 768 e 390 px, incluindo:

- Hero com as seis latas e uso real dos sete vídeos.
- Scroll lento, rápido e reverso; início, meio e fim de cada sequência.
- Tampas e produtos sem cortes, desaparecimento, quadros pretos ou deformação.
- Troca rápida entre sabores e alternância entre exploração manual e scroll.
- Navegação por teclado, arrasto/toque, foco e movimento reduzido.
- Carregamento lento, falha de vídeo e poster de fallback.
- Ausência de autoplay concorrente, scroll travado, overflow horizontal e erros de console.

Corrija os problemas encontrados. Se uma verificação não puder ser executada, informe a limitação com precisão. Não use o relatório de mídia anterior como prova de que o site está testado.

Ao finalizar, entregue o código, inicie o servidor local se o ambiente permitir e informe a URL, os comandos para executar/buildar, o que foi implementado e o que foi efetivamente verificado. Faça um README curto. Não publique ou faça deploy nesta etapa.

