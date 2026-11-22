// Conteúdo da tela "O que faz e o que não faz", nas duas línguas. Curto de propósito: é para bater o olho.
import type { Locale } from '../i18n/types.ts';

export interface CapabilityMode {
  id: string;
  title: string;
  badge: string;
  needs: string;
  does: string[];
  doesNot: string[];
  recommended?: boolean;
}

export interface CapabilitiesContent {
  title: string;
  lead: string;
  doesLabel: string;
  doesNotLabel: string;
  needsLabel: string;
  recommended: string;
  modes: CapabilityMode[];
  allTitle: string;
  allLead: string;
  allDoes: string[];
  allDoesNot: string[];
  readTitle: string;
  read: { tone: 'fail' | 'warn' | 'pass'; label: string; text: string }[];
  /** Assertividade medida de cada análise: só números de testes que rodaram, com a origem de cada um. */
  accuracyTitle: string;
  accuracyLead: string;
  accuracyHead: [string, string, string];
  accuracy: { analysis: string; result: string; tone: 'pass' | 'warn' | 'fail'; source: string }[];
  accuracyNote: string;
}

const pt: CapabilitiesContent = {
  title: 'O que faz e o que não faz',
  lead: 'Resumo de cada forma de validar. Em todas, a ferramenta só aponta as diferenças: ela não mexe no código da tela.',
  doesLabel: 'Faz',
  doesNotLabel: 'Não faz',
  needsLabel: 'Precisa de',
  recommended: 'Recomendado',
  modes: [
    {
      id: 'quick',
      title: 'Validação rápida',
      badge: 'Sem IA',
      needs: 'link do frame no Figma, endereço da tela, chave do Figma (fica salva) e internet para falar com o Figma',
      recommended: true,
      does: [
        'Não pede autorização nenhuma: usa o Google Chrome, Chromium ou Edge já instalado em modo headless sem ver suas abas, favoritos nem senhas',
        'Controla esse Chrome isolado (.chrome-profile) pelo protocolo DevTools local (127.0.0.1) no tamanho exato do frame (1x desktop)',
        'Espera a página carregar de verdade (load, rede > 0,5 s, DOM ~0,8 s sem aria-busy/skeletons e document.fonts), injeta validator.js, fotografa e desliga após 10 min sem uso',
        'Compara textos, fontes, cores, caixas, bordas, cantos, sombras e espaçamentos sempre no rigor 100%, nos dois sentidos',
        'Para páginas com SSO, o botão Abrir Chrome do app abre o mesmo Chrome visível para só você digitar sua senha (o app nunca digita senhas) e outros sites no navegador recebem 403',
        'Gera o relatório com Figma e tela lado a lado, separado por projeto',
      ],
      doesNot: [
        'Não funciona sem internet (precisa falar com o Figma), nem sem Chrome/Chromium/Edge instalado ou sem alcance da URL (localhost ou UAT via VPN)',
        'Não abre menu, modal nem hover sozinha e nunca digita ou armazena sua senha em código',
      ],
    },
    {
      id: 'offline',
      title: 'Offline (com imagens)',
      badge: 'Sem IA · sem chave',
      needs: 'uma imagem exportada do Figma e a tela (URL localhost via proxy, aba aberta via Console ou screenshot)',
      does: [
        'Funciona sem internet e sem chave do Figma',
        'Com print da tela, compara o Figma pixel a pixel (Sobreposição e Pixel Diff)',
        'Com URL localhost, abre em <iframe> via proxy local (/api/proxy); ou capture qualquer aba aberta (login/UAT) colando o snippet no Console do navegador',
        'Com uma spec JSON salva antes, faz também a checagem completa por elemento na tela aberta',
      ],
      doesNot: [
        'Não abre o Chrome headless automático do app nem tem botão Abrir Chrome do app',
        'O proxy embutido só aceita localhost sem cookies/SSO; telas protegidas exigem snippet no Console ou print (e print sozinho não roda Spec JSON)',
        'Não lê o Figma: a imagem (e a spec opcional) vêm de você',
      ],
    },
    {
      id: 'api',
      title: 'API do Figma + spec editável',
      badge: 'Sem IA · avançado',
      needs: 'link do frame, chave do Figma e a tela (URL localhost via proxy, aba aberta via Console ou print)',
      does: [
        'Baixa a imagem 2x e gera as regras do frame para você revisar ou editar à mão (como hover e foco) antes de comparar',
        'Captura a tela pelos mesmos meios do modo Offline: <iframe> + proxy em localhost, snippet no Console do DevTools (abas com login/UAT) ou comparação com print',
      ],
      doesNot: [
        'Não abre o Chrome headless do app nem tem login automático (para UAT/SSO sem colar snippet no Console, use a validação rápida)',
        'Dá mais trabalho que a validação rápida: para o dia a dia, use a rápida',
      ],
    },
    {
      id: 'mcp',
      title: 'MCP do Figma + IA',
      badge: 'Com IA',
      needs: 'um agente (Claude, Codex ou Gemini) com o MCP do Figma e a skill validar-figma',
      does: [
        'A IA lê o Figma pelo MCP e mede no navegador próprio dela (abrindo menu, modal e hover) ou pelo CLI bin/validar.mjs em segundo plano',
        'No CLI bin/validar.mjs, usa o mesmo Chrome headless + CDP (perfil ~/.cache/validar-figma/chrome, --login para SSO) e fecha ao fim da medição',
        'Explica as diferenças em texto, corrige o código e envia o relatório visual para o app (--send)',
      ],
      doesNot: [
        'Não funciona sem IA: o MCP do Figma é uma ferramenta feita para agentes',
        'Fora do validar.mjs, a aba do navegador do agente precisa estar na largura exata do frame; a validação rápida é mais previsível',
      ],
    },
  ],
  allTitle: 'Em todos os modos',
  allLead: 'O que é medido e o que fica para o olho.',
  allDoes: [
    'Texto: fonte, tamanho, peso, entrelinha, espaçamento entre letras, cor, alinhamento e o próprio texto',
    'Caixas, botões e cards: fundo, borda, cantos, sombra e tamanho fixo',
    'Espaçamento: padding de cima e da esquerda, espaço entre vizinhos e, onde o Figma define o fim do conteúdo, padding da direita e de baixo',
    'Elemento do Figma que não está na tela (aviso)',
    'Botão, filtro, aba ou link na tela que não existe no Figma (erro)',
    'Texto solto, imagem ou card que talvez não exista no Figma (aviso, para conferir)',
    'Comparação visual: lado a lado, sobreposição e diferença de pixels',
    'Separa o erro que se vê na tela do que existe só no CSS (cor com ΔE abaixo de 3, menos de 4 px, menos de 1 px de fonte): o relatório abre nos visíveis e os outros ficam a um clique',
  ],
  allDoesNot: [
    'Estados e larguras que não estão desenhados no Figma (hover, modal, mobile…)',
    'Caixa com outro dado ou outro estado: vira aviso e o estilo não é comparado (inclui chips e cabeçalhos com texto de exemplo diferente)',
    'Desenho do ícone e conteúdo de imagens',
    'Padding da direita e de baixo onde o tamanho depende do texto (caixa de largura fixa com conteúdo à esquerda)',
    'Animação, rolagem e comportamento',
  ],
  readTitle: 'Como ler o relatório',
  read: [
    { tone: 'fail', label: 'Diferente', text: 'erro confirmado: a tela não bate com o Figma' },
    { tone: 'warn', label: 'Atenção', text: 'não deu para comparar com certeza (outro estado ou dado de exemplo): confira no olho' },
    { tone: 'pass', label: 'Igual', text: 'bate com o Figma' },
  ],
  accuracyTitle: 'Assertividade medida',
  accuracyLead:
    'Números dos testes que rodaram de verdade, com erros plantados de propósito. “Pegou” é quantos erros plantados apareceram no relatório; “erro falso” é diferença apontada onde não havia erro.',
  accuracyHead: ['Análise', 'Resultado', 'De onde vem'],
  accuracy: [
    { analysis: 'Comparação com regras escritas (MCP + IA, API + spec): o que está na spec', result: '31 de 31 pegos · 0 erro falso, inclusive nas 12 cópias sem erro plantado', tone: 'pass', source: 'Teste de assertividade: 100 cópias da tela com erros plantados' },
    { analysis: 'Comparação com regras escritas: o que ficou fora da spec', result: '0 de 96 pegos: elemento que a spec não lista não é medido. No total foram 31 de 127 (24%). A validação rápida gera a spec do Figma com todos os textos e caixas; spec escrita à mão só cobre o que ela lista', tone: 'fail', source: 'Mesmo teste: 96 dos 127 erros plantados estavam fora das 8 regiões da spec' },
    { analysis: 'Elemento certo nas telas reais (casamento Figma × tela)', result: '429 de 429 regiões com erro comparavam o mesmo componente; nenhum erro falso por comparar o elemento errado', tone: 'pass', source: 'Juiz independente (gemini-decision-1) sobre recortes das 22 telas reais; contraprova com pares trocados: 86% rejeitados' },
    { analysis: 'Erro visível × só no CSS', result: 'Dos 249 erros marcados como só no CSS, 6 se viam (2%); 98% dos erros que se viam ficaram como visíveis. Nas 22 telas, 28% dos erros são só no CSS', tone: 'pass', source: 'Mesmo juiz, 804 erros das 22 telas reais' },
    { analysis: 'Texto: tamanho, cor e peso (validação rápida)', result: '3 de 3 pegos', tone: 'pass', source: 'Teste de 19 erros plantados contra o frame real do Figma' },
    { analysis: 'Caixa: raio e borda', result: '2 de 2 pegos', tone: 'pass', source: 'Mesmo teste' },
    { analysis: 'Padding da esquerda, de cima e de baixo', result: '3 de 3 pegos', tone: 'pass', source: 'Mesmo teste' },
    { analysis: 'Espaço entre elementos', result: '1 de 2 pegos (título → subtítulo sim; cabeçalho → tabela não)', tone: 'warn', source: 'Mesmo teste' },
    { analysis: 'Elemento faltando', result: '1 de 1, como aviso', tone: 'pass', source: 'Mesmo teste' },
    { analysis: 'Imagem a mais', result: '1 de 1, como aviso', tone: 'pass', source: 'Mesmo teste' },
    { analysis: 'Texto a mais', result: '2 de 2, como aviso (uma frase e um rótulo curto, "PDF")', tone: 'pass', source: 'Mesmo teste' },
    { analysis: 'Botão, filtro ou aba a mais', result: 'Telas reais: 2 apontados, os 2 reais (0 falso) · demo: 2 de 2 plantados (1 como aviso) · teste: 1 de 1, como aviso (fica numa área que o Figma desenha em outro estado)', tone: 'pass', source: '22 telas revisadas uma a uma, demo com controles plantados e teste de 19 erros' },
    { analysis: 'Fundo, raio ou padding em caixa com texto de exemplo diferente (chip, cabeçalho, busca)', result: '0 de 4: a caixa vira aviso e não é comparada', tone: 'fail', source: 'Teste de 19 erros plantados' },
    { analysis: 'Erros falsos na validação rápida', result: '0 nos 19 casos: só aparece o erro plantado (em alguns muda o valor de uma diferença que já existia, porque o card usa altura mínima). Linhas de lista agora casam pela ordem, o que eliminou a cascata de 3 erros falsos do teste anterior', tone: 'pass', source: 'Teste de 19 erros plantados; 120 erros falsos já removidos nas 22 telas reais' },
  ],
  accuracyNote:
    'Resumo: no teste, 9 de 19 erros viraram erro, 5 viraram aviso e 5 não apareceram (4 em caixas com texto de exemplo diferente do Figma e 1 espaço entre cabeçalho e tabela), sem nenhum erro falso. O que a validação rápida aponta como erro é real; o que ela não vê fica para os avisos e para a comparação visual.',
};

const en: CapabilitiesContent = {
  title: 'What it does and does not do',
  lead: 'A summary of each way to validate. In all of them the tool only points out differences: it never changes the screen code.',
  doesLabel: 'Does',
  doesNotLabel: 'Does not',
  needsLabel: 'Needs',
  recommended: 'Recommended',
  modes: [
    {
      id: 'quick',
      title: 'Quick validation',
      badge: 'No AI',
      needs: 'Figma frame link, screen address, Figma token (saved) and internet to reach Figma',
      recommended: true,
      does: [
        'Asks zero permissions: runs your local Chrome, Chromium, or Edge headless without touching your daily tabs, bookmarks, or passwords',
        'Drives that isolated .chrome-profile over local 127.0.0.1 DevTools Protocol at exact Figma frame dimensions (1x desktop)',
        'Waits for true readiness (load, >0.5s network idle, ~0.8s DOM stability with no aria-busy/skeletons, document.fonts), injects validator.js, captures PNG, and closes after 10 min idle',
        'Compares text, fonts, colors, boxes, borders, corners, shadows, and spacing always at 100% strictness in both directions',
        'For SSO routes, the Open app\'s Chrome button opens visible Chrome so only you type your password (app never types passwords), while foreign browser tabs get 403',
        'Builds side-by-side Figma vs. live screen reports grouped by project',
      ],
      doesNot: [
        'Does not work offline (needs Figma API access), without Chrome/Chromium/Edge installed, or if the URL is unreachable from your machine (localhost or UAT via VPN)',
        'Does not open menus, modals, or hover states on its own, and never types or stores your password in code',
      ],
    },
    {
      id: 'offline',
      title: 'Offline (with images)',
      badge: 'No AI · no token',
      needs: 'an image exported from Figma and the screen (localhost URL via proxy, open tab via Console, or screenshot)',
      does: [
        'Works without internet and without a Figma token',
        'With a screen screenshot, compares Figma pixel by pixel (Overlay and Pixel Diff)',
        'With a localhost URL, opens in an <iframe> via the built-in local proxy (/api/proxy); or capture any open tab (including SSO/UAT) by pasting the DevTools Console snippet',
        'With a saved spec JSON, also runs the full element-by-element check on the live screen',
      ],
      doesNot: [
        'Does not launch the app\'s automatic headless Chrome or offer the Open app\'s Chrome login flow',
        'The built-in proxy only accepts localhost without cookies/SSO; protected pages require the Console snippet or a screenshot (and a screenshot alone skips Spec JSON checks)',
        'Does not read Figma: the image (and optional spec) come from you',
      ],
    },
    {
      id: 'api',
      title: 'Figma API + editable spec',
      badge: 'No AI · advanced',
      needs: 'frame link, Figma token, and the screen (localhost URL via proxy, open tab via Console, or screenshot)',
      does: [
        'Downloads the 2x frame image and builds the spec JSON so you can inspect or hand-edit rules (such as hover and focus) before comparing',
        'Captures the screen through the same Offline mechanisms: <iframe> + local proxy on localhost, DevTools Console snippet for SSO/UAT tabs, or visual screenshot comparison',
      ],
      doesNot: [
        'Does not launch the app\'s headless Chrome or provide Open app\'s Chrome login (use Quick validation for that)',
        'More work than quick validation: for everyday use, use quick validation',
      ],
    },
    {
      id: 'mcp',
      title: 'Figma MCP + AI',
      badge: 'With AI',
      needs: 'an agent (Claude, Codex or Gemini) with the Figma MCP and the validar-figma skill',
      does: [
        'The AI reads Figma through MCP and picks its runner: injects scripts in its own browser (opening menus, modals, and hover) OR runs the bin/validar.mjs CLI in the background',
        'Over the terminal CLI (validar.mjs), uses the same headless Chrome + CDP technique (~/.cache/validar-figma/chrome profile, --login for SSO) and shuts Chrome down after measuring',
        'Explains differences in plain text, fixes your code, and sends the visual report to the app (--send)',
      ],
      doesNot: [
        'Does not work without AI: the Figma MCP is a tool made for agents',
        'Outside validar.mjs, the agent browser viewport width must match the Figma frame; quick validation is more predictable',
      ],
    },
  ],
  allTitle: 'In every mode',
  allLead: 'What is measured and what is left for the eye.',
  allDoes: [
    'Text: font, size, weight, line height, letter spacing, color, alignment and the copy itself',
    'Boxes, buttons and cards: background, border, corners, shadow and fixed size',
    'Spacing: top and left padding, space between neighbors and, where Figma defines where content ends, right and bottom padding',
    'Figma elements missing from the screen (warning)',
    'Buttons, filters, tabs or links on screen that do not exist in Figma (error)',
    'Loose text, image or card that may not exist in Figma (warning, to check)',
    'Visual comparison: side by side, overlay and pixel diff',
    'Separates errors you can see on screen from CSS-only ones (color ΔE under 3, under 4 px, under 1 px of font size): the report opens on the visible ones and the rest are one click away',
  ],
  allDoesNot: [
    'States and widths that are not drawn in Figma (hover, modal, mobile…)',
    'Boxes showing other data or another state: they become a warning and their style is not compared (including chips and headers with different sample copy)',
    'Icon shapes and image content',
    'Right and bottom padding where the size depends on the text (fixed-width box with left-aligned content)',
    'Animation, scrolling and behavior',
  ],
  readTitle: 'How to read the report',
  read: [
    { tone: 'fail', label: 'Different', text: 'confirmed error: the screen does not match Figma' },
    { tone: 'warn', label: 'Attention', text: 'could not compare with certainty (another state or sample data): check by eye' },
    { tone: 'pass', label: 'Match', text: 'matches Figma' },
  ],
  accuracyTitle: 'Measured accuracy',
  accuracyLead:
    'Numbers from tests that actually ran, with errors planted on purpose. “Caught” is how many planted errors showed up in the report; a “false error” is a difference reported where there was none.',
  accuracyHead: ['Analysis', 'Result', 'Source'],
  accuracy: [
    { analysis: 'Comparison with written rules (MCP + AI, API + spec): what the spec lists', result: '31 of 31 caught · 0 false errors, including the 12 copies with no planted error', tone: 'pass', source: 'Accuracy test: 100 copies of the screen with planted errors' },
    { analysis: 'Comparison with written rules: what the spec leaves out', result: '0 of 96 caught: an element the spec does not list is not measured. Overall it was 31 of 127 (24%). Quick validation builds the spec from Figma with every text and box; a hand-written spec only covers what it lists', tone: 'fail', source: 'Same test: 96 of the 127 planted errors were outside the 8 spec regions' },
    { analysis: 'Right element on real screens (Figma × screen matching)', result: '429 of 429 regions with errors compared the same component; no false error from comparing the wrong element', tone: 'pass', source: 'Independent judge (gemini-decision-1) on crops of the 22 real screens; control with swapped pairs: 86% rejected' },
    { analysis: 'Visible × CSS-only errors', result: 'Of the 249 errors tagged CSS-only, 6 were visible (2%); 98% of the visible errors stayed visible. On the 22 screens, 28% of the errors are CSS-only', tone: 'pass', source: 'Same judge, 804 errors from the 22 real screens' },
    { analysis: 'Text: size, color and weight (quick validation)', result: '3 of 3 caught', tone: 'pass', source: 'Test with 19 planted errors against the real Figma frame' },
    { analysis: 'Box: radius and border', result: '2 of 2 caught', tone: 'pass', source: 'Same test' },
    { analysis: 'Left, top and bottom padding', result: '3 of 3 caught', tone: 'pass', source: 'Same test' },
    { analysis: 'Space between elements', result: '1 of 2 caught (title → subtitle yes; header → table no)', tone: 'warn', source: 'Same test' },
    { analysis: 'Missing element', result: '1 of 1, as a warning', tone: 'pass', source: 'Same test' },
    { analysis: 'Extra image', result: '1 of 1, as a warning', tone: 'pass', source: 'Same test' },
    { analysis: 'Extra text', result: '2 of 2, as a warning (a sentence and a short label, "PDF")', tone: 'pass', source: 'Same test' },
    { analysis: 'Extra button, filter or tab', result: 'Real screens: 2 reported, both real (0 false) · demo: 2 of 2 planted (1 as a warning) · test: 1 of 1, as a warning (it sits in an area Figma draws in another state)', tone: 'pass', source: '22 screens reviewed one by one, demo with planted controls and the 19-error test' },
    { analysis: 'Background, radius or padding in a box with different sample copy (chip, header, search)', result: '0 of 4: the box becomes a warning and is not compared', tone: 'fail', source: '19-error test' },
    { analysis: 'False errors in quick validation', result: '0 in the 19 cases: only the planted error shows up (in some, the value of an existing difference changes because the card uses min-height). List rows now match by order, which removed the 3-false-error cascade of the previous test', tone: 'pass', source: '19-error test; 120 false errors already removed on the 22 real screens' },
  ],
  accuracyNote:
    'Summary: in the test, 9 of 19 errors became errors, 5 became warnings and 5 did not show up (4 in boxes whose sample copy differs from Figma and 1 header-to-table gap), with no false errors. What quick validation reports as an error is real; what it does not see is left to warnings and the visual comparison.',
};

export const capabilitiesContent: Record<Locale, CapabilitiesContent> = { pt, en };
