import type { ValidationReport } from '../engine/types.ts';
import type { AgentScore, AnswerKey, BenchmarkCase, CaseDetail, FoundFailure, RateMetric, Scoreboard } from './types.ts';

const LAYOUT_SIDE_EFFECTS = new Set(['width', 'height', 'x', 'y', 'minHeight', 'minWidth']);
const INHERITED_PROPS = new Set(['color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'text']);

function metric(total: number, hits: number): RateMetric {
  return { total, hits, rate: total ? hits / total : null };
}

export function extractFailures(report: ValidationReport | undefined): FoundFailure[] {
  if (!report?.regions) return [];
  return report.regions.flatMap((r) =>
    r.results
      .filter((x) => x.status === 'fail')
      .map((x) => ({
        region: r.name,
        key: r.key ?? null,
        property: x.property,
        expected: x.expected,
        actual: x.actual,
      })),
  );
}

const failureKey = (f: FoundFailure): string => `${f.key ?? f.region}|${f.property}`;

export function explainsMutation(f: FoundFailure, m: BenchmarkCase['mutations'][number]): boolean {
  if (!m.props.includes(f.property) || f.key == null) return false;
  if (f.key === m.key) return true;
  if (m.type === 'text' && m.ancestors.includes(f.key)) return true;
  if (m.props.some((p) => INHERITED_PROPS.has(p)) && m.descendants.includes(f.key)) return true;
  return false;
}

export function scoreAgent(
  agent: string,
  answerKey: AnswerKey,
  reports: Record<string, ValidationReport>,
): AgentScore {
  const cases = answerKey.cases;
  const executedCases = cases.filter((c) => Boolean(reports[c.id]));

  const fallbackBaselineControl = reports.base ? undefined : executedCases.find((c) => c.control);
  const baseline = new Map<string, string | undefined>(
    extractFailures(reports.base ?? (fallbackBaselineControl ? reports[fallbackBaselineControl.id] : undefined)).map((f) => [
      failureKey(f),
      f.actual,
    ]),
  );
  const existedInBaseline = (f: FoundFailure): boolean => baseline.has(failureKey(f)) && baseline.get(failureKey(f)) === f.actual;

  const details: CaseDetail[] = [];
  let falsePositives = 0;
  let casesWithFp = 0;
  const tracked: { inside: boolean; type: string; ok: boolean }[] = [];
  let cleanControls = 0;

  for (const c of cases) {
    const report = reports[c.id];
    if (!report) {
      details.push({
        id: c.id,
        control: c.control,
        executed: false,
        mutations: c.mutations.map((m) => ({
          id: m.id,
          type: m.type,
          description: m.description,
          insideSpec: m.insideSpec,
          region: m.region,
          detected: false,
        })),
        falsePositives: [],
      });
      continue;
    }

    const failures = extractFailures(report).filter((f) => !existedInBaseline(f));
    const mutations = c.mutations.map((m) => {
      const detected = failures.some((f) => explainsMutation(f, m));
      tracked.push({ inside: m.insideSpec, type: m.type, ok: detected });
      return {
        id: m.id,
        type: m.type,
        description: m.description,
        insideSpec: m.insideSpec,
        region: m.region,
        detected,
      };
    });

    const hasMutations = c.mutations.length > 0;
    const unexpectedFailures = failures.filter((f) => {
      if (c.mutations.some((m) => explainsMutation(f, m))) return false;
      if (hasMutations && LAYOUT_SIDE_EFFECTS.has(f.property)) return false;
      return true;
    });

    if (c.control && c !== fallbackBaselineControl && unexpectedFailures.length === 0) cleanControls++;
    falsePositives += unexpectedFailures.length;
    if (unexpectedFailures.length) casesWithFp++;
    details.push({
      id: c.id,
      control: c.control,
      executed: true,
      mutations,
      falsePositives: unexpectedFailures,
    });
  }

  const byType: Record<string, RateMetric> = {};
  for (const type of new Set(tracked.filter((x) => x.inside).map((x) => x.type))) {
    const items = tracked.filter((x) => x.type === type && x.inside);
    byType[type] = metric(items.length, items.filter((x) => x.ok).length);
  }
  const insideItems = tracked.filter((x) => x.inside);
  const outsideItems = tracked.filter((x) => !x.inside);

  return {
    agent,
    casesExecuted: executedCases.length,
    casesTotal: cases.length,
    detection: metric(tracked.length, tracked.filter((x) => x.ok).length),
    insideSpec: metric(insideItems.length, insideItems.filter((x) => x.ok).length),
    outsideSpec: metric(outsideItems.length, outsideItems.filter((x) => x.ok).length),
    byType,
    falsePositives,
    casesWithFalsePositive: casesWithFp,
    controls: {
      executed: executedCases.filter((c) => c.control && c !== fallbackBaselineControl).length,
      clean: cleanControls,
    },
    cases: details,
  };
}

export function scoreAll(
  answerKey: AnswerKey | null,
  results: Record<string, Record<string, ValidationReport>>,
): Scoreboard {
  if (!answerKey) return { agents: [], agreement: null };
  const agents = Object.keys(results)
    .sort((a, b) => (a === 'engine' ? -1 : b === 'engine' ? 1 : a.localeCompare(b)))
    .map((agent) => scoreAgent(agent, answerKey, results[agent]));

  const aiAgents = agents.filter((p) => p.agent !== 'engine');
  let total = 0;
  let equalCount = 0;
  for (const c of answerKey.cases) {
    const participating = aiAgents.filter((p) => Boolean(results[p.agent]?.[c.id]));
    if (participating.length < 2) continue;
    for (const m of c.mutations) {
      const answers = participating.map(
        (p) => p.cases.find((d) => d.id === c.id)?.mutations.find((x) => x.id === m.id)?.detected ?? false,
      );
      total++;
      if (answers.every((a) => a === answers[0])) equalCount++;
    }
  }

  return { agents, agreement: total ? metric(total, equalCount) : null };
}
