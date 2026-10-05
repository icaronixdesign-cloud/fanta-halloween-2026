# Integração das animações — revisão v2-tampa-fixa

## Arquivos e limites

Os nomes e URLs estão em `04-produtos-site.json`. Os seis vídeos individuais têm 180 quadros / 6 segundos. A coleção tem 240 quadros / 8 segundos. Todos são 1920 × 1080, 30 fps, sem áudio, H.264/yuv420p, faststart e GOP 1. Há somente a variante de scroll; ela também pode reproduzir em loop.

As tampas estão fixas nas cenas e nos MP4. A validação anterior conferiu o enquadramento superior em todos os quadros das cenas e decodificou integralmente os sete exports. O site ainda precisa de validação própria: recorte CSS, troca de fonte ou seeks no fim do vídeo podem causar falhas que não existem nos arquivos.

## O que o navegador recebe

É um vídeo com fundo escuro e reflexos no piso, não uma lata 3D isolada com canal alfa. A rotação está renderizada no tempo do MP4. O mouse pode selecionar o tempo e mover sutilmente seu contêiner; não oferece novos ângulos 3D fora do vídeo.

Preserve a razão 16:9 e comece com `object-fit: contain`. Ajuste o layout ao conteúdo, conferindo também a coleção e a tela estreita. Não remova o preto com modos de mistura, máscaras ou chroma key: isso pode apagar a impressão preta e partes da embalagem. Não use uma camada separada de tampa.

## Progresso → tempo

Para progresso normalizado `p`, entre 0 e 1, use:

```js
const progress = Math.min(1, Math.max(0, p));
const frame = Math.round(progress * (frames - 1));
const targetTime = frame / fps;
```

O último quadro começa em `179 / 30 = 5,966667 s` nos individuais e `239 / 30 = 7,966667 s` na coleção. Não use diretamente `p * 6` ou `p * 8` no limite superior: manter o alvo no início do último quadro evita buscar o instante terminal do arquivo.

Espere os metadados, confirme duração finita e fonte correta, e limite o alvo à duração realmente carregada. Trate mudanças de duração/fonte e mídia ainda indisponível. Atribuir `currentTime` solicita uma busca; a posição resultante pode ser ajustada pelo navegador e não comprova sozinha qual quadro foi apresentado. [MDN: currentTime](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/currentTime).

No scrub, mantenha `pause()`. Use `muted` e `playsInline`. Configure o carregamento segundo a proximidade da seção; não acrescente `autoplay` e `loop` ao mesmo elemento enquanto seu tempo estiver sob controle do scroll.

## Agendamento de seeks

Mantenha a coleta do alvo separada da apresentação do quadro:

1. Scroll, slider e pointer atualizam um alvo normalizado em uma referência interna, sem renderizar toda a aplicação a cada evento.
2. Um agendador com `requestAnimationFrame` decide se o quadro alvo mudou. Quantize em 30 fps e descarte atribuições redundantes.
3. Tenha no máximo uma busca pendente por vídeo. Durante a busca, conserve apenas o alvo mais recente; não acumule uma fila de posições ultrapassadas.
4. Use `seeked` para saber que a busca terminou. Quando disponível, `requestVideoFrameCallback` pode observar a apresentação de um novo quadro; faça detecção de suporte e mantenha fallback. Essa API não substitui o agendador de entrada e pode ficar sem callbacks se nenhum quadro novo for apresentado.
5. Libere o controlador em erro, mudança de fonte, saída da seção ou desmontagem. Tenha recuperação para uma busca que não termina; não deixe a interface presa esperando um evento. Use um identificador de geração para ignorar callbacks da fonte anterior.

O evento `seeked` indica o término de uma busca. [MDN: seeked](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeked_event). O callback de vídeo acompanha quadros enviados ao compositor. [MDN: requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

## Um controlador por vez

| Estado | Quem controla o vídeo | Regra |
| --- | --- | --- |
| Carregamento/falha | Capa JPG | Conteúdo e navegação continuam disponíveis. |
| Scroll | Progresso da seção | Vídeo pausado; posição reversível. |
| Exploração | Arrasto horizontal ou slider | Suspender o scrub por scroll enquanto a pessoa interage. |
| Reprodução opcional | Relógio do player | Suspender o scrub; tratar rejeição de `play()`. |

Ao concluir a exploração manual, defina uma retomada previsível: por exemplo, manter a posição escolhida até a próxima rolagem e então retornar suavemente ao alvo da seção. Não deixe mouse e scroll escreverem `currentTime` simultaneamente. A troca de produto deve invalidar os seeks anteriores e sincronizar nome, cor, poster e vídeo.

## Carregamento e mobile

- Os MP4 somam aproximadamente 80 MB; GOP 1 favorece busca, mas não significa arquivos pequenos. Priorize hero/ativo e carregue os demais conforme aproximação ou intenção de seleção.
- Use a capa até a apresentação do primeiro quadro utilizável. Durante uma troca, mantenha conteúdo visível até o próximo estar pronto; evite flashes vazios.
- Fora da área ativa, pause reprodução e suspenda agendamento. Libere recursos sem recarregar repetidamente o mesmo vídeo a cada pequeno scroll.
- Sirva por HTTP via servidor local. Confira URLs, tipo de conteúdo, carregamento e buscas nos browsers de destino; não valide abrindo somente `file://`.
- No touch, diferencie arrasto horizontal da rolagem vertical. Não capture todos os gestos nem imponha um scroll artificial que prenda a página.
- Trate `prefers-reduced-motion` com uma versão baseada em capas e controles, evitando parallax e sequências longas presas à rolagem. [MDN: movimento reduzido](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).

## Conferência final no site

Verifique os sete ativos em seu layout real: início, meio, fim e rolagem reversa; tampas e bases visíveis; seis latas na coleção; seleção rápida; resize; teclado; toque; movimento reduzido; rede lenta/erro; ausência de fontes erradas e buscas concorrentes. Confirme que nenhuma estratégia de integração apaga partes pretas da lata. Registre os navegadores e verificações executados, distinguindo-os da validação dos arquivos de mídia.

