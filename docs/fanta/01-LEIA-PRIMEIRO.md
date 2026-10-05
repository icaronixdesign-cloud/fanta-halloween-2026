# Kit para Claude Code — Fanta Halloween 2026

## O que enviar

1. O ZIP `documentos-claude-code-fanta.zip`: prompt, guia de integração, dados dos produtos e documentação da revisão final.
2. O ZIP `videos-fanta-halloween-2026-refinados.zip` da pasta `videos-ultrarrealistas-v2`: os sete MP4 corrigidos e as sete capas JPG.
3. As referências de site que você escolher: links, imagens ou vídeos, com uma indicação do que quer aproveitar em cada referência.

O ZIP das cenas Blender é opcional. Não é necessário para implementar o site com os vídeos prontos.

## Como usar no Claude Code

Extraia os documentos na pasta do projeto, por exemplo em `docs/fanta/`. Disponibilize também o ZIP de vídeos na pasta do projeto ou extraia-o em uma pasta de entrada. Cole o conteúdo de `02-PROMPT-CLAUDE-CODE.md` no Claude Code e envie suas referências junto. Se os caminhos forem diferentes, informe onde colocou os arquivos.

O prompt pede uma implementação completa, executável em localhost, com todos os vídeos usados, navegação por scroll e exploração com mouse/toque. Não pede publicação nesta etapa.

## Documentos

| Arquivo | Função |
| --- | --- |
| `02-PROMPT-CLAUDE-CODE.md` | Instrução principal, pronta para copiar. |
| `03-GUIA-ANIMACOES.md` | Integração de vídeo, controle de tempo, estados, fallback e validação. |
| `04-produtos-site.json` | Mapeamento portátil dos sete vídeos, capas, nomes e tempos. |
| `manifest-videos-v2.json` | Manifesto original da entrega corrigida. |
| `verificacao-videos-v2.json` | Verificação dos MP4 e das cenas, anterior à implementação do site. |
| `leia-me-refinamento-v2.txt` | Refinamentos e limitações das artes/embalagens. |

## Organização sugerida no site

```text
docs/fanta/                 documentos deste kit
public/media/fanta/          sete MP4 e sete JPG
src/data/                   dados importados/adaptados de 04-produtos-site.json
```

Os URLs do JSON usam `/media/fanta/`. Essa convenção deve ser ajustada se o framework ou o caminho de implantação exigir outra base. Não use caminhos absolutos do computador nos URLs do navegador.

## Revisão correta

Use exclusivamente os vídeos **v2-tampa-fixa**. São seis loops de 6 segundos e uma coleção de 8 segundos, em 1920 × 1080, 30 fps, sem áudio, H.264/yuv420p, faststart e todos os quadros como keyframes. As tampas permanecem encaixadas durante toda a animação.

As referências visuais do site serão fornecidas por você ao Claude. Este kit não inclui nem presume essas referências. O relatório de mídia comprova os arquivos entregues; o Claude ainda precisa testar a integração no navegador.

