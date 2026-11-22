import type { Locale } from './types.ts';

// O motor (src/engine) e o servidor (server/) respondem em inglês, porque o mesmo texto
// chega às skills dos agentes. A interface traduz essas mensagens aqui, conforme o idioma escolhido.
type Rule = [RegExp, string | ((...groups: string[]) => string)];

const SIDE_PT: Record<string, string> = { top: 'superior', right: 'direita', bottom: 'inferior', left: 'esquerda' };

const PT_RULES: Rule[] = [
  // Notas e valores do motor de comparação
  [/^not set on screen \(auto\)$/, 'não definido na tela (auto)'],
  [/^not set on screen$/, 'não definido na tela'],
  [/^invalid expected value$/, 'valor esperado inválido na spec'],
  [/^could not measure$/, 'não foi possível medir'],
  [/^invalid expected color in spec$/, 'cor esperada inválida na spec'],
  [/^unrecognized screen color$/, 'cor da tela não reconhecida'],
  [/^(top|right|bottom|left) border color mismatch$/, (side) => `cor da borda ${SIDE_PT[side] ?? side} diferente`],
  [/^font declared but not loaded \(rendering fallback\)$/, 'fonte declarada mas não carregada (usando a fonte reserva)'],
  [/^line-height "normal" \(~1\.2 \* fontSize\)$/, 'line-height "normal" (~1,2 × fontSize)'],
  [/^differs only in letter case$/, 'difere só em maiúsculas/minúsculas'],
  [/^differs only in punctuation \(quotes, dashes or final period\)$/, 'difere só na pontuação (aspas, travessão ou ponto final)'],
  [/^text truncated on screen$/, 'texto truncado na tela'],
  [/^measured on screen: box edge to first content$/, 'medido na tela: da borda da caixa até o primeiro conteúdo'],
  [/^content ends far from Figma \(missing content or another state\)$/, 'o conteúdo termina longe do Figma (conteúdo faltando ou outro estado)'],
  [/^measured on screen: last content to box edge$/, 'medido na tela: do último conteúdo até a borda da caixa'],
  [/^space from "(.*)"$/s, (name) => `espaço até "${name}"`],
  [/^(\S+)px is drawn as (\S+)px \(browsers draw borders in whole pixels\)$/, (a, b) => `${a}px é desenhado como ${b}px (o navegador desenha bordas em pixels inteiros)`],
  [/^Not in Figma: (.*)$/, (label: string) => `A mais na tela: ${label}`],
  [/^possibly not in the Figma frame \(loose text, image or card\): check by eye$/, 'talvez não exista no frame do Figma (texto solto, imagem ou card): confira no olho'],
  [/^on screen but not in the Figma frame$/, 'está na tela, mas não existe no frame do Figma'],
  [/^on screen but not in the Figma frame \(inside a box in another state\)$/, 'está na tela, mas não existe no frame do Figma (dentro de uma caixa em outro estado)'],
  [/^absent$/, 'ausente'],
  [/^box shows another label on screen \(other state or sample data\)$/, 'a caixa mostra outro rótulo na tela (outro estado ou dado de exemplo)'],
  [/^box shows other content on screen \(other state or sample data\)$/, 'a caixa mostra outro conteúdo na tela (outro estado ou dado de exemplo); o estilo não foi comparado'],
  [/^box content appears elsewhere on screen \(layout moved or other state\)$/, 'o conteúdo desta caixa está em outro lugar da tela (layout mudou ou outro estado); o estilo não foi comparado'],
  [/^only numbers differ \(sample data\)$/, 'só os números mudam (dado de exemplo)'],
  [/^same text, shown with text-transform: (\S+)$/, (t) => `mesmo texto, exibido com text-transform: ${t}`],
  [/^both fully rounded \(radius at least half the height\)$/, 'os dois totalmente arredondados (raio de pelo menos metade da altura)'],
  [/^compared as seen over the background behind it$/, 'comparado como aparece sobre o fundo de trás'],
  [/^Figma text appears only elsewhere on the screen$/, 'o texto do Figma só aparece em outro lugar da tela'],
  [/^no element on screen in the place of this Figma box$/, 'nenhum elemento da tela no lugar desta caixa do Figma'],
  [/^transparent; color shown comes from the element behind it$/, 'transparente; a cor que aparece vem do elemento de trás'],
  [/^Figma text not on screen \(may be sample data\)$/, 'texto do Figma não aparece na tela (pode ser dado de exemplo)'],
  [/^invalid selector: (.*)$/s, (msg) => `seletor inválido: ${msg}`],
  [/^present$/, 'presente'],
  [/^not found$/, 'não encontrado'],
  [/^none$/, 'nenhum'],
  [/^— \(not collected\)$/, '— (não coletado)'],
  [/^Apply the state in the browser for each item in pendingStates and re-run (.*)$/s, (cmd) =>
    `Aplique o estado no navegador para cada item de pendingStates e rode de novo ${cmd}`],

  // Scripts de navegador (captura e sessão pelo console)
  [/^failed to load (.*)$/, (src) => `falha ao carregar ${src}`],
  [/^server returned (\d+)$/, (code) => `o servidor respondeu ${code}`],
  [/^missing server URL$/, 'falta a URL do servidor'],
  [/^missing report from window\.__figmaValidator$/, 'falta o relatório de window.__figmaValidator'],
  [/^session lookup failed \((\d+)\)$/, (code) => `sessão de captura não encontrada (${code})`],
  [/^failed to complete session \((\d+)\)$/, (code) => `não foi possível concluir a sessão (${code})`],

  // API do Figma
  [/^Failed to connect to Figma API: (.*)$/s, (msg) => `Não foi possível conectar à API do Figma: ${msg}`],
  [/^Figma API did not respond within (\S+) s$/, (secs) => `A API do Figma não respondeu em ${secs} s. Arquivos grandes demoram; tente de novo ou use um frame menor.`],
  [/^Rendered Figma image did not download within (\S+) s$/, (secs) => `A imagem renderizada do Figma não baixou em ${secs} s`],
  [/^Failed to download rendered Figma image: (.*)$/s, (msg) => `Falha ao baixar a imagem renderizada do Figma: ${msg}`],
  [/^Invalid or unauthorized Figma token$/, 'Token do Figma inválido ou sem permissão'],
  [/^Figma file or node not found$/, 'Arquivo ou node do Figma não encontrado'],
  [/^Figma API rate limit exceeded$/, 'Limite de requisições da API do Figma atingido'],
  [/^Failed to download rendered Figma image \((\d+)\)$/, (code) => `Falha ao baixar a imagem renderizada do Figma (${code})`],
  [/^Missing figmaUrl$/, 'Falta o link do Figma (figmaUrl)'],
  [/^Missing Figma access token$/, 'Falta o token de acesso do Figma'],
  [/^Invalid Figma frame URL \(must include file key and node-id\)$/, 'Link de frame do Figma inválido (precisa ter a chave do arquivo e o node-id)'],
  [/^Node (.+) not found in Figma response$/, (id) => `Node ${id} não veio na resposta do Figma`],
  [/^Figma API did not return a rendered image URL$/, 'A API do Figma não devolveu a URL da imagem renderizada'],

  // Proxy e proteção cross-origin
  [/^Missing url query parameter$/, 'Falta o parâmetro url'],
  [/^Invalid target URL$/, 'URL de destino inválida'],
  [/^Only http and https protocols are allowed$/, 'Só são aceitos os protocolos http e https'],
  [/^Proxy only allows localhost or loopback addresses$/, 'O proxy só aceita localhost ou endereços de loopback'],
  [/^Recursive proxy request is not allowed$/, 'O proxy não pode chamar a si mesmo'],
  [/^Cross-origin request is not allowed on this route$/, 'Requisição de outro site não é permitida nesta rota'],
  [/^Failed to reach localhost target: (.*)$/s, (msg) => `Não foi possível abrir a tela no localhost: ${msg}`],
  [/^Too many redirects$/, 'Muitos redirecionamentos no endereço local'],
  [/^Proxy error \((\d+)\)$/, (code) => `Erro no proxy (${code})`],

  // Relatórios e imagens
  [/^Request body too large$/, 'Corpo da requisição grande demais'],
  [/^Invalid JSON body$/, 'O corpo da requisição não é um JSON válido'],
  [/^Invalid image data URL$/, 'Imagem em data URL inválida'],
  [/^Unsupported image type: (.*)$/, (mime) => `Tipo de imagem não suportado: ${mime}`],
  [/^Image exceeds 25 MB limit$/, 'A imagem passa do limite de 25 MB'],
  [/^Invalid image URL$/, 'URL da imagem inválida'],
  [/^Image URL must use https or localhost$/, 'A URL da imagem precisa ser https ou localhost'],
  [/^Image download failed \((\d+)\)$/, (code) => `Falha ao baixar a imagem (${code})`],
  [/^URL did not return a supported image \((.*)\)$/, (mime) => `A URL não devolveu uma imagem suportada (${mime === 'unknown' ? 'desconhecido' : mime})`],
  [/^Missing report\.regions payload$/, 'Falta report.regions no corpo da requisição'],
  [/^Figma image not saved: (.*)$/s, (msg) => `Imagem do Figma não salva: ${localizeMessage(msg, 'pt')}`],
  [/^Screen image not saved: (.*)$/s, (msg) => `Imagem da tela não salva: ${localizeMessage(msg, 'pt')}`],
  [/^Capture session not found or expired$/, 'Sessão de captura não encontrada ou expirada'],
  [/^Report not found$/, 'Relatório não encontrado'],
  [/^Provide \{ dataUrl \} or \{ url \} or raw image binary$/, 'Envie { dataUrl }, { url } ou a imagem em binário'],
  [/^Asset not found$/, 'Arquivo não encontrado'],
  [/^Failed to read image file$/, 'Não foi possível ler o arquivo de imagem'],
  [/^Unsupported or corrupted image file$/, 'Arquivo de imagem não suportado ou corrompido'],
  [/^Timed out loading target screen$/, 'Tempo esgotado ao carregar a tela'],
  [/^Failed to load image for pixel diff$/, 'Não foi possível carregar a imagem para o Pixel Diff'],

  // Validação rápida e Chrome do app
  [/^Missing screen URL$/, 'Falta o endereço da tela'],
  [/^Google Chrome not found \(set CHROME_PATH\)$/, 'Google Chrome não encontrado. Instale o Chrome ou defina CHROME_PATH.'],
  [/^Chrome closed right after starting \(is the app profile already open\?\)$/, 'O Chrome do app fechou logo ao abrir. Feche a janela do Chrome do app e tente de novo.'],
  [/^Chrome did not start in time$/, 'O Chrome do app demorou demais para abrir'],
  [/^Could not connect to Chrome$/, 'Não foi possível conectar ao Chrome do app'],
  [/^Chrome connection closed$/, 'A conexão com o Chrome do app caiu'],
  [/^Nothing is running at (.+)$/, (url) => `Nada respondendo em ${url}. Confira se a tela está rodando (npm run dev).`],
  [/^Address not found: (.+)$/, (url) => `Endereço não encontrado: ${url}. Confira o endereço ou a VPN.`],
  [/^Screen answered with an HTTP error: (.+)$/, (url) => `A tela respondeu com erro (página inexistente ou fora do ar): ${url}`],
  [/^Could not open (\S+): (.*)$/s, (url, why) => `Não foi possível abrir ${url}: ${why}. Confira se a tela está no ar.`],
  [/^Screen did not finish loading: (.*)$/s, (url) => `A tela não terminou de carregar: ${url}`],
  [/^Validator script failed to load in the page$/, 'O script de medição não carregou na tela'],
  [/^Validator failed: (.*)$/s, (msg) => `A medição falhou: ${msg}`],
  [/^Validator returned no report$/, 'A medição não devolveu relatório'],

  // Teste de assertividade
  [/^Missing html payload$/, 'Falta o html da captura'],
  [/^Capture has no spec$/, 'A captura não tem spec'],
  [/^Capture a screen first$/, 'Capture uma tela primeiro'],
  [/^No capture yet$/, 'Nenhuma captura ainda'],
  [/^Missing cases array$/, 'Falta a lista de casos'],
  [/^Case not found$/, 'Caso não encontrado'],
  [/^Send \{ agent, caseId, report \} with report\.regions$/, 'Envie { agent, caseId, report } com report.regions'],

  // Descrições das mutações plantadas (src/benchmark/mutations.ts)
  [/^text (".*" -> ".*") in (.+)$/s, (change, el) => `texto ${change} em ${el}`],
  [/^(.+ -> .+|gap \+12px) in (.+)$/s, (change, el) => `${change} em ${el}`],
  [/^Failed to open (.*)$/, (src) => `Não foi possível abrir ${src}`],
  [/^Failed to load (.*)$/, (src) => `Não foi possível carregar ${src}`],

  // Genérico
  [/^Request failed \((\d+)\)$/, (code) => `A requisição falhou (${code})`],
  [/^Failed to fetch$/, 'Não foi possível conectar ao servidor'],
];

export function localizeMessage(text: string, locale: Locale): string;
export function localizeMessage(text: string | undefined | null, locale: Locale): string | undefined;
export function localizeMessage(text: string | undefined | null, locale: Locale): string | undefined {
  if (text == null || locale === 'en') return text ?? undefined;
  // Mensagens compostas ("a; b") vindas do servidor
  if (text.includes('; ') && !PT_RULES.some(([re]) => re.test(text))) {
    return text
      .split('; ')
      .map((part) => localizeMessage(part, locale))
      .join('; ');
  }
  for (const [re, out] of PT_RULES) {
    const m = re.exec(text);
    if (m) return typeof out === 'string' ? out : out(...m.slice(1));
  }
  return text;
}

const MD_LINE_RULES: Rule[] = [
  [/^# Figma vs Screen Validation$/, '# Validação Figma × Tela'],
  [/^- Viewport: (.*) \(Figma: (\d+) - resize window\)$/, (v, w) => `- Viewport: ${v} (Figma: ${w} - redimensione a janela)`],
  [/^- Precision level: (.*)$/, (p) => `- Nível de precisão: ${p}`],
  [/^- Fidelity score: (.*)$/, (s) => `- Fidelidade: ${s}`],
  [
    /^- Result: \*\*(OK|MISMATCHES FOUND)\*\* - (\d+) pass, (\d+) fail, (\d+) warn across (\d+) regions(?:, (\d+) pending states)?$/,
    (res, pass, fail, warn, regions, pending) =>
      `- Resultado: **${res === 'OK' ? 'OK' : 'DIFERENÇAS ENCONTRADAS'}** - ${pass} ok, ${fail} falhas, ${warn} avisos em ${regions} regiões${
        pending ? `, ${pending} estados pendentes` : ''
      }`,
  ],
  [/^## Differences$/, '## Diferenças'],
  [/^\| Status \| Region \| Property \| Figma \| Screen \| Delta \| Note \|$/, '| Status | Região | Propriedade | Figma | Tela | Delta | Nota |'],
  [/^## By Region$/, '## Por região'],
  [/^(- \[(?:PASS|FAIL|WARN)\] .* - )(\d+)\/(\d+) pass$/, (head, ok, total) => `${head}${ok}/${total} ok`],
];

const MD_CELL_STATUS: Record<string, string> = { PASS: 'OK', FAIL: 'FALHA', WARN: 'AVISO' };

/** Traduz o markdown gerado por formatReportMarkdown (src/engine/runner.ts). */
export function localizeReportMarkdown(markdown: string, locale: Locale): string {
  if (locale === 'en') return markdown;
  return markdown
    .split('\n')
    .map((line) => {
      for (const [re, out] of MD_LINE_RULES) {
        const m = re.exec(line);
        if (m) {
          const translated = typeof out === 'string' ? out : out(...m.slice(1));
          return translated.replace(/^- \[(PASS|FAIL|WARN)\]/, (_, s: string) => `- [${MD_CELL_STATUS[s]}]`);
        }
      }
      // Linhas da tabela de diferenças: | FAIL | região | prop | figma | tela | delta | nota |
      if (/^\| (PASS|FAIL|WARN) \|/.test(line)) {
        const cells = line.split(/(?<!\\)\|/);
        // cells[0] = '' e cells[last] = ''; índices 1..7 são as colunas
        cells[1] = ` ${MD_CELL_STATUS[cells[1].trim()] ?? cells[1].trim()} `;
        for (const i of [4, 5, 7]) {
          if (cells[i] === undefined) continue;
          const raw = cells[i].trim();
          if (raw) cells[i] = ` ${localizeMessage(raw, locale)} `;
        }
        return cells.join('|');
      }
      return line;
    })
    .join('\n');
}
