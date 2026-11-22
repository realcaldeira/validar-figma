import type { Dimensions } from '../engine/types.ts';

export type MutationType =
  | 'padding'
  | 'gap'
  | 'background'
  | 'color'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'border-radius'
  | 'font-family'
  | 'letter-spacing'
  | 'text';

export interface Mutation {
  id: string;
  type: MutationType;
  key: string;
  ancestors: string[];
  descendants: string[];
  props: string[];
  insideSpec: boolean;
  region?: string;
  description: string;
  css?: Record<string, string>;
  text?: { from: string; to: string };
}

export interface BenchmarkCase {
  id: string;
  control: boolean;
  mutations: Mutation[];
}

export interface AnswerKey {
  generatedAt: string;
  seed: number;
  cases: BenchmarkCase[];
}

export interface BenchmarkCapture {
  name: string;
  url: string;
  figmaUrl: string | null;
  spec: unknown;
  viewport: Dimensions;
  elements: number;
  capturedAt: string;
}

export interface BenchmarkState {
  capture: (Omit<BenchmarkCapture, 'spec'> & { hasSpec: boolean }) | null;
  cases: { id: string; url: string }[];
  results: Record<string, string[]>;
}

export interface FoundFailure {
  region: string;
  key: string | null;
  property: string;
  expected?: string;
  actual?: string;
}

export interface CaseDetail {
  id: string;
  control: boolean;
  executed: boolean;
  mutations: (Pick<Mutation, 'id' | 'type' | 'description' | 'insideSpec' | 'region'> & { detected: boolean })[];
  falsePositives: FoundFailure[];
}

export interface RateMetric {
  total: number;
  hits: number;
  rate: number | null;
}

export interface AgentScore {
  agent: string;
  casesExecuted: number;
  casesTotal: number;
  detection: RateMetric;
  insideSpec: RateMetric;
  outsideSpec: RateMetric;
  byType: Record<string, RateMetric>;
  falsePositives: number;
  casesWithFalsePositive: number;
  controls: { executed: number; clean: number };
  cases: CaseDetail[];
}

export interface Scoreboard {
  agents: AgentScore[];
  agreement: RateMetric | null;
}
