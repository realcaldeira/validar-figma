---
name: validar-figma
description: Valida se uma tela construída bate com o Figma — lê o frame pelo MCP do Figma, gera uma spec com os valores do design, mede a tela no navegador nativo do agente (script injetado na página: estilos computados, tamanhos, texto, estados hover/focus), entrega um relatório de diferenças e, com o app Figma Validator aberto, um relatório visual com Figma e tela lado a lado. Use sempre que o usuário mandar um link figma.com com "valida", "está igual ao Figma?", "confere com o design", "faz a auditoria", "QA visual", "fidelidade" ou "relatório visual", em qualquer repo.
---

# Validar Figma × tela

Responda sempre em português (pt-BR).

O trabalho tem três partes: **você** lê o Figma e escreve a spec; **o script injetado na página** mede a tela e compara com números; **você** interpreta e reporta. Não declare "está igual" sem o relatório do script. O padrão é **auditar** (QA): medir e reportar, sem mexer no código. Só corrija quando o pedido disser para corrigir.

Tudo roda no **navegador nativo do agente** — sem Playwright, sem API de IA. A medição usa a sessão que o usuário já tem logada (SSO, VPN, cookies).

Arquivos (pasta real `~/.agents/skills/validar-figma/`):
- `browser/validator.js` — mede e compara; define `window.__figmaValidator`.
- `browser/capture.js` — copia a tela e envia relatórios ao app; define `window.__figmaCapture` e `window.__figmaReport`.
- `references/spec-format.md` — formato da spec e tolerâncias (leia antes de escrever a primeira spec).
- `examples/` — página e spec de exemplo.

Os dois scripts e o `bin/validar.mjs` são **gerados** do motor do app Figma Validator (repositório `validar-figma`, pasta `src/engine`) pelo `npm run sync-skill`, que também instala esta pasta. Não edite à mão: mude o motor ou `skill/validar-figma/` no repositório e rode o sync.

## 0. Pré-requisitos (checar uma vez)

- Esta skill é a mesma para Claude Code, Codex e Antigravity (Gemini). A pasta real é `~/.agents/skills/validar-figma`; `~/.claude/skills`, `~/.codex/skills` e `~/.gemini/config/skills` só têm links para ela.
- **MCP do Figma** conectado. Ferramentas: `get_design_context`, `get_screenshot`, `get_variable_defs`, `get_metadata`, `create_session` (podem vir com prefixo do agente, ex.: `mcp__figma__get_design_context`). Se o servidor pedir `create_session`, chame com o `fileKey` antes das outras. Sem MCP do Figma, peça o login e **não invente valores**:
  - Claude Code: conector Figma (`/mcp`).
  - Codex: `codex mcp login figma`.
  - Antigravity: servidor `figma` em `~/.gemini/config/mcp_config.json`, login OAuth no primeiro uso.
- **Navegador nativo com execução de JavaScript na página:**
  - Claude Code: Claude in Chrome (navegar, executar JS, hover/clique, redimensionar, screenshot) — é o Chrome do usuário, já logado. Para localhost, o navegador embutido também serve.
  - Codex: plugin de navegador (Chrome ou navegador do app).
  - Antigravity: o browser agent do Antigravity.
  **Sem navegador do agente (terminal: Codex CLI, Gemini CLI, Claude Code sem Chrome, CI):** use o medidor de terminal da skill, `node ~/.agents/skills/validar-figma/bin/validar.mjs` (precisa de Node 22+ e de Chrome, Chromium ou Edge instalado; `--help` mostra as opções). Ele abre um Chrome em segundo plano, injeta o mesmo `validator.js` e grava o relatório. Não troque por Playwright.
- **Token do Figma: não precisa.** O Figma é lido pelo MCP do agente (passo 1). Nem a skill nem o medidor de terminal chamam a API do Figma.
- **App Figma Validator (opcional, para o relatório visual):** veja se está no ar com `GET http://localhost:5199/api/health` (responde `{ ok: true }`). De outra origem (a tela medida), o app só aceita mandar relatório, captura e resultado de benchmark e ler a sessão: listar, ler ou apagar relatórios só pelo próprio app. Se não estiver e o usuário quiser o relatório visual, ele sobe com `npm run dev` na pasta do app.

## 1. Ler o Figma

- Da URL: `fileKey` (segmento depois de `/design/` ou `/file/`) e `node-id` (troque `-` por `:`).
- `get_metadata` no node para ver a árvore, os tamanhos e escolher as regiões; `get_design_context` para estilos e auto layout (a saída pode ser grande: procure os `data-node-id` das regiões escolhidas); `get_variable_defs` para mapear variáveis → tokens do repo; `get_screenshot` como referência visual (e para o relatório visual).
- Se o arquivo tiver versões do mesmo frame (exploração × hand-off, "REFERENCIA <data>"), pergunte qual vale. Hand-off vale mais que exploração.

## 2. Ler o repo

- Descubra o design system e o padrão de estilos (`package.json`, README, `docs/`, `specs/`, `AGENTS.md`). Se existir `references/local.md` nesta pasta (não vem do repositório; cada pessoa cria o seu), leia: ele lista os repos conhecidos do time e o design system de cada um.
- **Precedência:** regra escrita (spec, critério de aceite, documento de regras de UI do repo) > Figma > o que nenhum dos dois define. Se o Figma contradiz a regra escrita, não mude comportamento: liste o conflito.
- Confira que o frame e a URL são **da mesma tela e do mesmo papel**: telas parecidas (listas por papel) reaproveitam o mesmo componente com textos diferentes.
- Encontre seletores estáveis: `id`, `data-testid`, `aria-labelledby`, role/aria, classes fixas. **Nunca** classe com hash (`sc-abc123`, `css-1x2y3z`).
- Meça o elemento que **desenha** o que o Figma mostra: a caixa visível de um campo costuma ser o `div` em volta do `<input>` (`div:has(> input[aria-label="…"])`); o fundo do cabeçalho de tabela costuma estar no `<thead>`, não no `<tr>`. Na dúvida, confira tamanho e fundo do elemento e do pai antes de escrever a região.

## 3. Abrir a tela

- Use a URL que o usuário mandou (local, dev, UAT). Senão, siga o README do repo.
- Abra no navegador nativo e ajuste a área visível da página à **resolução exata do frame do Figma** (largura **e** altura do `figmaFrame`, ex. 1440 × 1200), não só à largura. Confira com `innerWidth`/`innerHeight` antes de medir; se não bater, o relatório do app mostra um aviso de resolução. Se o login/SSO bloquear, peça para o usuário logar nessa janela e retome. Nunca digite senha do usuário.
- Sem agente, a Validação rápida do app (link do Figma + endereço da tela) já abre a tela nessa resolução sozinha.
- **Pelo terminal:** o medidor abre a tela sozinho no tamanho do `figmaFrame` da spec. Se a tela pede login/SSO, rode uma vez `node ~/.agents/skills/validar-figma/bin/validar.mjs --login --url <tela>`: abre uma janela do Chrome, o usuário faz o login e fecha; o login fica guardado para as próximas medições.
- Aplique o estado necessário pelo próprio navegador (aba, filtro, rolagem) antes de medir. Para estados que dependem de dados, use o mock que o repo já tem — nunca forçado no fluxo real.

## 4. Escrever a spec

Crie `.figma-validation/<nome-do-frame>.spec.json` na raiz do repo e ignore a pasta **só localmente**:

```sh
grep -qxF '.figma-validation/' .git/info/exclude || echo '.figma-validation/' >> .git/info/exclude
```

(Não mexa no `.gitignore` do repo.) Regras:
- `viewport.width` = largura do frame no Figma; `root` = seletor CSS do contêiner equivalente ao frame; `figmaFrame: { width, height }` = tamanho do frame.
- Seletores são **CSS**; filtre por texto com `hasText`, escolha a ocorrência com `index`. Para "o elemento mais interno que contém o texto", use `selector: '*'` + `hasText` (ou `matchMode: 'deepest'`).
- Uma região por elemento relevante: contêineres (tamanho, padding, gap, fundo, borda, raio, sombra), textos (copy, família, tamanho, peso, altura de linha, cor), botões/inputs/chips/ícones e **estados** (`state: 'hover' | 'focus'`) quando o Figma tiver variantes.
- Em cada região, `figmaRect: { x, y, width, height }` relativo ao frame (no `get_metadata`, some o `x`/`y` de cada ancestral até o frame) — é o que marca a região na imagem do Figma no relatório visual.
- Copie os valores do Figma, não da tela. Line height "Auto" → omita; em % → `"120%"`. Cores em hex/rgba (comparação por ΔE). `precision` (0–100) aperta ou afrouxa todas as tolerâncias de uma vez. **O rigor é sempre 100% (Exato)**: o motor ignora qualquer `precision` da spec e só aceita arredondamento invisível (0,1px, ΔE 0,5).

## 5. Medir

1. Carregue `~/.agents/skills/validar-figma/browser/validator.js` na página (define `window.__figmaValidator`; se a página recarregar, carregue de novo). Formas, todas funcionam em qualquer agente:
   - **App no ar (mais simples):** injete `http://localhost:5199/validator.js` — é o mesmo código.
   - **Colar:** leia o arquivo e execute o conteúdo inteiro com a ferramenta de JavaScript do navegador.
   - **Servir:** `python3 -m http.server 8766 --bind 127.0.0.1 --directory ~/.agents/skills/validar-figma/browser` em segundo plano e injete `http://127.0.0.1:8766/validator.js`. Pare o servidor ao terminar.
   Para injetar por URL use sempre **endereço absoluto**:
   ```js
   await new Promise((ok, err) => { const s = document.createElement('script'); s.src = '<url>/validator.js?' + Date.now(); s.onload = ok; s.onerror = () => err(new Error('bloqueado')); document.head.appendChild(s); });
   ```
   Se der erro (CSP da página, navegador sem acesso ao localhost), use a forma "colar".
2. Rode com a spec inline:
   ```js
   const spec = { /* conteúdo do .spec.json */ };
   const r = await window.__figmaValidator(spec);
   ({ summary: r.summary, viewport: r.viewport, rootFound: r.rootFound, pending: r.pendingStates, markdown: r.markdown })
   ```
3. Para cada item de `pendingStates`: aplique o estado (hover/foco) com a ferramenta nativa e rode `await window.__figmaValidator(spec, { only: '<nome da região>', stateApplied: true })`.
4. Salve o `markdown` em `.figma-validation/<frame>/report.md`.
5. Compare um screenshot da tela com o `get_screenshot` do Figma para o que os números não cobrem (imagens, ícones, gradientes, alinhamento óptico).
6. **Relatório visual (lado a lado)** — sempre que o app estiver no ar ou pedirem "relatório visual"/"lado a lado":
   - `get_screenshot` do frame → `image_url` (a URL expira: envie logo).
   - Na mesma página medida, carregue `http://localhost:5199/capture.js` e rode
     ```js
     await window.__figmaReport({ server: 'http://localhost:5199', report: r, name: '<tela>', figmaUrl: '<link do frame>', figmaImageUrl: '<image_url>', figmaFrame: spec.figmaFrame })
     ```
     Para hover/focus, envie depois de medir os estados, juntando as regiões no mesmo `report`.
   - Responda com a `url` devolvida (`/reports/<id>`). Se vier `warning` (imagem não baixou), diga e ofereça reenviar.

**Pelo terminal (sem navegador do agente)** — no lugar dos itens 1 a 4:
```sh
node ~/.agents/skills/validar-figma/bin/validar.mjs --url '<tela>' --spec .figma-validation/<frame>.spec.json --out .figma-validation/<frame>
```
Imprime o resumo e as diferenças e grava `report.md`, `report.json` e `screen.png` em `--out`. Para o relatório visual no app, acrescente `--send --name '<tela>' --project '<projeto>' --figma-url '<link do frame>' --figma-image-url '<image_url do get_screenshot>'` e responda com o link impresso em "Relatório visual". Ponha a URL entre aspas (`?` e `&` quebram no shell). Hover/focus não são aplicados pelo terminal: liste os `pendingStates` como não medidos. Erros comuns: "nada respondendo" (a tela não está no ar), "não terminou de carregar" (VPN/login: use `--login`), "o Chrome fechou ao abrir" (outro Chrome usando o perfil: `--profile <pasta>`).

Ferramentas de JS limitadas: sem `await` no topo, use `window.__figmaValidator(spec).then(r => window.__vfResult = r)` e leia `window.__vfResult` numa segunda chamada; retorno só em texto ou cortado → passe `{ format: 'markdown' }` ou leia campos menores.

Leitura do resultado:
- `viewport.width` é a largura interna; diferença pequena para `expectedWidth` é normal. Se a largura do contêiner principal bater com o Figma, siga.
- `rootFound: false` ou "elemento não encontrado" → seletor errado ou tela não carregou; ajuste antes de concluir que falta o elemento.
- `fail` = diferença real; `warn` = não deu para medir com certeza (fonte não carregada, texto truncado).
- Fonte diferente: confira `get_variable_defs` (ex.: `font/family/header`). Se o repo usa outro token de marca para a mesma variável, é divergência de token para Design decidir.

## 6. Corrigir (só se pedirem)

- Para cada `fail`: corrija com o componente/token do design system (token antes de valor cru; variável do Figma sem token correspondente → avise, não invente token). Siga o padrão do arquivo vizinho.
- Se a tela medida é de um ambiente publicado (dev/UAT), a correção só aparece depois do deploy: valide o código local antes de dizer que ficou certo.
- Meça de novo; no fim rode lint, typecheck e testes do repo.

## 7. Responder

1. Resultado: `X ok · Y falhas (V visíveis, C só no CSS) · Z avisos` (antes e depois, se houve correção).
2. Tabela das diferenças **visíveis**: Região | Propriedade | Figma | Tela | Motivo provável (bug, divergência de token, conflito com spec, limitação de medição). As que o relatório marca como só no CSS (`visibility: "css"`; ΔE abaixo de 3, menos de 4 px de espaço ou tamanho, menos de 1 px de fonte) entram numa linha de contagem, não na tabela: continuam sendo erro, mas não se veem na tela.
3. O que **não** foi medido (regiões fora da spec, imagens/ícones vistos só por screenshot).
4. Link do relatório visual, se gerado; caminho do `report.md`.
5. Se houve correção, os arquivos alterados.

Não commite nem abra PR sem o usuário pedir, e nunca versione `.figma-validation/`.

## Modo benchmark (teste de assertividade)

Use quando o pedido falar em "modo benchmark", "teste de assertividade" ou "teste de mutação", ou quando a URL for um caso do benchmark (`/benchmark-cases/<id>.html`). O servidor é o app Figma Validator (padrão `http://localhost:5199`, página **Assertividade**). Nada aqui usa API de IA.

1. Leia o frame pelo MCP do Figma e escreva **a sua própria** spec (passos 1 e 4). **Não** leia `/api/benchmark/spec` nem `/api/benchmark/scoreboard`: o objetivo é medir o processo inteiro, incluindo a spec que você escreve.
2. `GET <servidor>/api/benchmark/state` → `cases` (`[{ id, url }]`; o primeiro, `base`, é a tela original sem erros) e `results` (o que cada agente já enviou).
3. Para cada caso que o seu nome de agente ainda não enviou, começando pelo `base`: abra a URL na largura do frame, carregue `<servidor>/validator.js` (endereço absoluto: a página tem `<base href>` da tela original), rode `await window.__figmaValidator(spec)` e envie:
   ```js
   await fetch('<servidor>/api/benchmark/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: '<claude | codex | gemini>', caseId: '<id>', report: r }) })
   ```
   Use a mesma spec em todos os casos. Não tente adivinhar os erros plantados: valide cada caso como uma tela normal.
4. No fim, diga quantos casos enviou. O placar fica na página Assertividade do app.

**Capturar outra tela para o benchmark:** escreva a spec, abra a tela, carregue `<servidor>/capture.js` e rode
`await window.__figmaCapture({ server: '<servidor>', name: '<nome da tela>', figmaUrl: '<link>', spec })`. Isso substitui a captura anterior; depois o usuário gera os casos e roda o motor pela página Assertividade.
