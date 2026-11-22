// Gera os scripts de navegador da skill validar-figma a partir do motor deste app (src/engine),
// para que a skill (usada pelos agentes) e o app usem exatamente o mesmo código.
// Uso: npm run sync-skill   (pasta da skill: VALIDAR_FIGMA_SKILL ou ~/.agents/skills/validar-figma)
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCaptureBundle, buildValidatorBundle } from '../server/scripts.ts';

const skillDir = process.env.VALIDAR_FIGMA_SKILL || path.join(os.homedir(), '.agents', 'skills', 'validar-figma');
const outDir = path.join(skillDir, 'browser');
await mkdir(outDir, { recursive: true });

const header = (fonte) =>
  `// validar-figma — gerado de ${fonte} pelo "npm run sync-skill" do app validar-figma. Não edite à mão.\n`;

const [validator, capture] = await Promise.all([buildValidatorBundle(), buildCaptureBundle()]);
await writeFile(path.join(outDir, 'validator.js'), header('src/engine/compare.ts + runner.ts') + validator);
await writeFile(path.join(outDir, 'capture.js'), header('src/engine/capture.ts') + capture);

// Medição pelo terminal (agentes sem navegador próprio): bin/validar.mjs, ao lado de browser/.
const binDir = path.join(skillDir, 'bin');
await mkdir(binDir, { recursive: true });
await copyFile(new URL('./skill-cli.mjs', import.meta.url), path.join(binDir, 'validar.mjs'));
await chmod(path.join(binDir, 'validar.mjs'), 0o755);

console.log(`Skill atualizada em ${outDir}`);
console.log(`  validator.js ${(validator.length / 1024).toFixed(1)} KB · capture.js ${(capture.length / 1024).toFixed(1)} KB`);
