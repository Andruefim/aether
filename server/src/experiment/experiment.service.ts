import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { NovaMemoryService } from '../nova/nova-memory.service';
import { ThoughtBusService } from '../nova/thought-bus.service';
import {
  ExperimentPlan,
  ExperimentResult,
  ExperimentEvent,
} from './experiment.types';

const SANDBOX_URL_DEFAULT = 'http://localhost:5050';

const PLAN_SYSTEM = `You are Nova's experiment designer.
Given a research hypothesis and goal, design a Python experiment to test it using real-world data.
Available libraries: numpy, pandas, scipy, networkx, requests (for PubChem, UniProt, PDB APIs).
Optional if installed: rdkit (chemistry), Bio (biology), sklearn.

The code MUST call nova_output(dict) at the end with structured results. Example:
nova_output({
  "type": "scatter3d",            # visualization type
  "points": [[x,y,z,label],...],  # data for renderer
  "summary": "one sentence",      # what was found
  "metrics": {"key": value}
})

Visualization types: molecule3d | graph3d | scatter3d | timeseries | heatmap | text | none

Reply ONLY with JSON (no markdown):
{
  "hypothesis": "<restate clearly>",
  "domain": "<molecular|data|network|simulation|custom>",
  "approach": "<one sentence>",
  "code": "<complete Python code>",
  "visualization": "<type>"
}`;

const INTERPRET_SYSTEM = `You are Nova's scientific interpreter.
An experiment was conducted. Based on the code output and results, extract the key scientific finding.
Be precise, concise, and honest about uncertainty.
Reply with 2-4 sentences describing the finding and its implications for the research goal.`;

@Injectable()
export class ExperimentService {
  private readonly logger   = new Logger(ExperimentService.name);
  private readonly emitter  = new EventEmitter();
  private readonly sandboxUrl: string;

  // Latest results cache for the UI to fetch
  private recentResults: ExperimentResult[] = [];

  constructor(
    private readonly config:  ConfigService,
    private readonly ollama:  OllamaService,
    private readonly memory:  NovaMemoryService,
    private readonly bus:     ThoughtBusService,
  ) {
    this.sandboxUrl = this.config.get<string>('SANDBOX_URL', SANDBOX_URL_DEFAULT);
    this.emitter.setMaxListeners(50);
  }

  // ── SSE subscription ───────────────────────────────────────────────────────

  subscribe(listener: (e: ExperimentEvent) => void): () => void {
    this.emitter.on('experiment', listener);
    return () => this.emitter.off('experiment', listener);
  }

  private emit(event: ExperimentEvent) {
    this.emitter.emit('experiment', event);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  getRecentResults(limit = 20): ExperimentResult[] {
    return this.recentResults.slice(-limit);
  }

  /** Full experiment lifecycle: plan → execute → interpret → store */
  async runExperiment(hypothesis: string, goalContext: string): Promise<ExperimentResult> {
    const id  = crypto.randomUUID();
    const t0  = Date.now();

    // ── Plan ─────────────────────────────────────────────────────────────────
    this.emit({ phase: 'plan', text: `Designing experiment: "${hypothesis.slice(0, 80)}"`, experimentId: id, ts: Date.now() });
    this.bus.emit({ phase: 'act', text: `[Lab] Designing experiment: ${hypothesis.slice(0, 80)}`, tool: 'experiment', ts: Date.now() });

    let plan: ExperimentPlan;
    try {
      plan = await this.planExperiment(id, hypothesis, goalContext);
    } catch (err) {
      const result = this.makeError(id, hypothesis, err, Date.now() - t0);
      this.finalize(result);
      return result;
    }

    this.emit({ phase: 'plan', text: `Approach: ${plan.approach}`, experimentId: id, ts: Date.now() });

    // ── Execute ───────────────────────────────────────────────────────────────
    this.emit({ phase: 'execute', text: 'Running Python sandbox...', experimentId: id, ts: Date.now() });

    let sandboxResult: { success: boolean; stdout: string; stderr: string; result: Record<string, unknown>; error?: string };
    try {
      sandboxResult = await this.executeSandbox(plan.code, id);
    } catch (err) {
      const result = this.makeError(id, hypothesis, err, Date.now() - t0);
      this.finalize(result);
      return result;
    }

    if (!sandboxResult.success) {
      const result = this.makeError(id, hypothesis, sandboxResult.error ?? 'Sandbox failed', Date.now() - t0);
      result.stdout = sandboxResult.stdout;
      result.stderr = sandboxResult.stderr;
      this.finalize(result);
      return result;
    }

    this.emit({
      phase: 'execute',
      text: `Executed in ${((Date.now() - t0) / 1000).toFixed(1)}s. Output: ${sandboxResult.stdout.slice(0, 120)}`,
      experimentId: id,
      ts: Date.now(),
    });

    // ── Interpret ─────────────────────────────────────────────────────────────
    this.emit({ phase: 'interpret', text: 'Interpreting results...', experimentId: id, ts: Date.now() });
    const interpretation = await this.interpret(hypothesis, goalContext, sandboxResult, plan);

    const visData = sandboxResult.result ?? {};

    const result: ExperimentResult = {
      id,
      hypothesis,
      success:       true,
      stdout:        sandboxResult.stdout,
      stderr:        sandboxResult.stderr,
      visualization: plan.visualization,
      visData,
      interpretation,
      durationMs:    Date.now() - t0,
      ts:            Date.now(),
    };

    // ── Store in memory ───────────────────────────────────────────────────────
    this.emit({ phase: 'store', text: `Storing finding: "${interpretation.slice(0, 80)}"`, experimentId: id, ts: Date.now() });
    await this.memory.store(
      `[experiment] H: ${hypothesis} | Finding: ${interpretation}`,
      'main',
      'raw',
    ).catch(() => {});

    this.bus.emit({ phase: 'store', text: `[Lab] ${interpretation.slice(0, 100)}`, ts: Date.now() });

    this.finalize(result);
    return result;
  }

  // ── Plan (LLM) ─────────────────────────────────────────────────────────────

  private async planExperiment(id: string, hypothesis: string, goalContext: string): Promise<ExperimentPlan> {
    const msgs: OllamaMessage[] = [
      { role: 'system', content: PLAN_SYSTEM },
      { role: 'user',   content: `Research goal: ${goalContext}\n\nHypothesis to test: "${hypothesis}"\n\nDesign an experiment.` },
    ];

    const resp  = await this.ollama.chat(msgs, undefined, undefined, 'json');
    const raw   = resp.content?.trim() ?? '{}';
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(clean) as Partial<ExperimentPlan>;

    return {
      id,
      hypothesis:    parsed.hypothesis    ?? hypothesis,
      domain:        parsed.domain        ?? 'custom',
      approach:      parsed.approach      ?? 'Custom analysis',
      code:          parsed.code          ?? 'nova_output({"type":"text","summary":"No code generated"})',
      visualization: parsed.visualization ?? 'text',
      goalContext,
    };
  }

  // ── Execute (Python sandbox) ───────────────────────────────────────────────

  private async executeSandbox(code: string, experimentId: string) {
    const res = await fetch(`${this.sandboxUrl}/run`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ code, timeout: 60, experiment_id: experimentId }),
      signal:  AbortSignal.timeout(70_000),
    });
    if (!res.ok) throw new Error(`Sandbox HTTP ${res.status}`);
    return res.json() as Promise<{
      success: boolean; stdout: string; stderr: string;
      result: Record<string, unknown>; error?: string;
    }>;
  }

  // ── Interpret (LLM or VLM) ─────────────────────────────────────────────────

  private async interpret(
    hypothesis: string,
    goalContext: string,
    sandbox: { stdout: string; result: Record<string, unknown> },
    plan: ExperimentPlan,
    screenshotB64?: string,
  ): Promise<string> {
    const context = [
      `Hypothesis: ${hypothesis}`,
      `Approach: ${plan.approach}`,
      `Output:\n${sandbox.stdout.slice(0, 1000)}`,
      `Structured result: ${JSON.stringify(sandbox.result).slice(0, 800)}`,
    ].join('\n\n');

    const userMsg: OllamaMessage = {
      role:    'user',
      content: `Research goal: ${goalContext}\n\n${context}\n\nWhat is the key scientific finding?`,
    };

    // If screenshot provided, use vision capability
    if (screenshotB64) {
      userMsg.images = [screenshotB64.replace(/^data:image\/\w+;base64,/, '')];
    }

    const msgs: OllamaMessage[] = [
      { role: 'system', content: INTERPRET_SYSTEM },
      userMsg,
    ];

    try {
      const resp = await this.ollama.chat(msgs);
      return resp.content?.trim() ?? 'No interpretation available.';
    } catch {
      const summary = (sandbox.result['summary'] as string | undefined) ?? '';
      return summary || 'Experiment completed. Review stdout for details.';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private makeError(id: string, hypothesis: string, err: unknown, durationMs: number): ExperimentResult {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Experiment ${id} failed: ${msg}`);
    this.bus.emit({ phase: 'error', text: `[Lab] ${msg}`, ts: Date.now() });
    return {
      id, hypothesis, success: false,
      stdout: '', stderr: msg,
      visualization: 'none', visData: {},
      interpretation: `Experiment failed: ${msg}`,
      error: msg, durationMs, ts: Date.now(),
    };
  }

  private finalize(result: ExperimentResult) {
    this.recentResults = [...this.recentResults.slice(-19), result];
    this.emit({ phase: 'done', text: result.interpretation.slice(0, 120), experimentId: result.id, result, ts: Date.now() });
  }
}
