# Formato do `figma-spec.json`

Um arquivo por frame validado. Fica na pasta de saída do repo (`.figma-validation/`), nunca versionado.

```json
{
  "name": "Card de campanhas",
  "figma": { "url": "https://www.figma.com/design/<fileKey>/...?node-id=1-2", "fileKey": "<fileKey>", "nodeId": "1:2" },
  "url": "http://localhost:3001/campanhas",
  "viewport": { "width": 1440, "height": 900 },
  "root": "[data-testid=campaign-card]",
  "tolerances": { "spacing": 2 },
  "regions": [
    {
      "name": "Título do card",
      "selector": "[data-testid=campaign-card] h2",
      "hasText": "Campanhas",
      "index": 0,
      "figmaNode": "1:3",
      "state": "hover",
      "pseudo": "::before",
      "tolerances": { "fontSize": 0 },
      "expect": { "text": "Campanhas ativas", "fontSize": 16, "lineHeight": 24, "fontWeight": "SemiBold", "color": "#141414" }
    }
  ]
}
```

## Campos do topo

| Campo | Obrigatório | Uso |
|---|---|---|
| `regions` | sim | lista do que medir |
| `url` | não | URL da tela (referência para o agente abrir) |
| `viewport` | não | largura do frame no Figma (padrão 1440×900) |
| `root` | não | seletor CSS do contêiner equivalente ao frame: base para `x`/`y` |
| `figmaFrame` | não | `{ width, height }` do frame — usado no relatório visual |
| `precision` | não | 0–100: aperta ou afrouxa todas as tolerâncias de uma vez |
| `tolerances` | não | sobrescreve tolerâncias específicas |

## Região

- `selector`: seletor **CSS** (`document.querySelectorAll`). Prefira `id`, `data-testid`, `aria-*`, role ou classe estável; **nunca** classe com hash (`sc-abc123`, `css-1x2y3z`).
- `hasText`: filtra os elementos do seletor pelo texto visível (contém, sem diferenciar maiúsculas).
- `index`: qual ocorrência medir depois do filtro (padrão 0).
- `matchMode`: `deepest` mede o elemento mais interno que contém `hasText` (igual a `selector: '*'` + `hasText`). `rect` escolhe, entre os elementos do seletor, o que tem a caixa mais parecida com `figmaRect` (canto a até 24 px e sobreposição de pelo menos 60%); no empate, o que pinta fundo, borda ou sombra.
- `textMatch`: `contains` (padrão) ou `exact`. Com `exact` + `selector: '*'` + `figmaRect`, o motor faz como a spec automática do app: acha o texto pelo lugar (corrige sozinho o deslocamento entre o Figma e a tela) e, se o texto exato não existe ali, aceita um texto parecido no mesmo lugar e mostra a diferença de cópia.
- `autoWidth` / `startAligned` / `fixedGap`: preenchidos pela spec automática do app a partir do Figma (texto de largura automática, alinhado à esquerda, e se o gap até o vizinho é fixo no auto-layout). Com `checkSpacing: true` e `figmaLeaves` na spec, o motor compara o espaço entre vizinhos (`spaceAbove`, `spaceLeft`) medido na tela.
- `expect.contentInsetTop` / `contentInsetLeft` / `contentCenterTop`: padding visual (borda da caixa até o primeiro conteúdo), medido na tela e não no CSS.
- `boxTexts`, `boxTextSlots`, `boxLabel`, `boxHasText` (gerados pela spec automática para caixas com `matchMode: rect`): os textos do Figma dentro da caixa e onde cada um fica. O motor só compara o estilo da caixa se o elemento da tela tiver esses textos (`matchedBy: content`/`label`) ou, com dado de exemplo diferente, textos nos mesmos lugares (`matchedBy: layout`; aceita um deslocamento igual para todo o conteúdo). Senão, a caixa vira aviso. Um elemento da tela casa com uma caixa só.
- `contentInsetRight`, `contentInsetBottom` (+ `contentCenterBottom`): espaço da direita e de baixo, gerados só onde o Figma define o fim do conteúdo (Hug, space-between, alinhado ao fim). Embaixo compara pelo centro da última linha; diferença acima de 40px vira aviso.
- Elementos a mais: com `figmaLeaves` na spec (a spec automática traz), o relatório também lista regiões `extra: true` ("Not in Figma: …"): botão, filtro, aba ou link com rótulo curto, sem números, que não existe no Figma e está onde o Figma não tem nada. Linha a mais de tabela, card repetido, texto solto e imagem não entram (são dado ou contexto da página).
- `ifMissing`: `fail` (padrão) ou `warn`. Use `warn` quando o texto do Figma pode ser dado de exemplo (nomes, números de tabela).
- `state`: `hover`, `focus` ou `active`. O script não simula estado: a região volta em `pendingStates`, o agente aplica o estado pelo navegador e mede com `{ only, stateApplied: true }`.
- `pseudo`: `::before` / `::after` (só estilos; tamanho e texto são do elemento).
- `figmaNode`: id do node no Figma, para rastrear.
- `figmaRect`: `{ x, y, width, height }` da camada **relativo ao frame** (some os `x`/`y` dos ancestrais no `get_metadata`). Usado no relatório visual, para marcar a região na imagem do Figma, e para desempatar quando o mesmo texto aparece em mais de um lugar.


## `expect` — de onde tirar cada valor no Figma

| Propriedade | No Figma | Formato |
|---|---|---|
| `width`, `height` | tamanho do node | px |
| `x`, `y` | posição relativa ao frame (exige `root`) | px |
| `padding` | auto layout → padding | `16` · `[16, 24]` · `[t, r, b, l]` |
| `gap` | auto layout → item spacing | `12` (eixo principal) ou `{ "row": 8, "column": 12 }` |
| `margin`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | constraints / min-max | px |
| `backgroundColor` | fill sólido do frame | `#RRGGBB`, `#RRGGBBAA`, `rgba()` |
| `color` | fill do texto (ou do ícone SVG com `currentColor`) | cor |
| `fill`, `stroke` | ícone SVG inline | cor |
| `borderColor`, `borderWidth` | stroke (inside ≈ border) | cor ou `[t, r, b, l]` / px ou `[t, r, b, l]` |
| `borderRadius` | corner radius | `8` ou `[tl, tr, br, bl]` |
| `boxShadow` | effect drop/inner shadow | `"0 2px 4px rgba(0,0,0,0.16)"`, várias separadas por vírgula, `inset` para inner |
| `opacity` | layer opacity | 0–1 |
| `fontFamily` | família do text style | `"Inter"` |
| `fontSize` | tamanho | px |
| `fontWeight` | peso | `600` ou `"SemiBold"` |
| `lineHeight` | line height | px, ou `"150%"`. Se for **Auto** no Figma, omita |
| `letterSpacing` | letter spacing | px, ou `"2%"` (relativo ao tamanho) |
| `textAlign`, `textTransform`, `textDecorationLine`, `fontStyle` | propriedades do texto | valor CSS |
| `text` | conteúdo literal (copy exata, já com maiúsculas visíveis) | string |
| `placeholder`, `value` | texto de apoio / valor de inputs | string |
| `display`, `flexDirection`, `justifyContent`, `alignItems` | direção/alinhamento do auto layout | valor CSS |
| `count` | quantos elementos o seletor deve achar (ex.: 5 cards) | número |
| `visible` | se deve estar visível | boolean |
| qualquer outra prop CSS computada | — | comparação literal |

Gradientes, imagens e blur não entram em `expect`: cubra com a comparação visual entre o screenshot da tela e o `get_screenshot` do Figma.

## Tolerâncias padrão

| Chave | Padrão | Afeta |
|---|---|---|
| `size` | 1 px | width, height, min/max |
| `position` | 2 px | x, y |
| `spacing` | 2 px | padding, margin, gap |
| `fontSize` | 0.5 px | |
| `lineHeight` | 1 px | |
| `letterSpacing` | 0.2 px | |
| `radius` | 1 px | |
| `borderWidth` | 0.5 px | |
| `color` | ΔE2000 2.3 | todas as cores (≈ limite perceptível) |
| `alpha` | 0.02 | canal alfa |
| `opacity` | 0.02 | |
| `shadow` | 1 px | cada componente da sombra |

## Status no relatório

- `pass`: dentro da tolerância.
- `fail`: diferença real — corrigir ou justificar.
- `warn`: não deu para medir com certeza (fonte não carregada, texto truncado, propriedade não coletada). Verificar visualmente.
