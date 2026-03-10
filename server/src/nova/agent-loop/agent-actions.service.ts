import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../../generate/ollama.service';
import { NovaMemoryService } from '../nova-memory.service';
import { ThoughtBusService } from '../thought-bus.service';
import { AgentToolsService } from '../agent-tools.service';
import { NovaIdentityService } from '../nova-identity.service';
import { ConsciousnessState } from './types';
import {
  SYNTHESIZE_SYSTEM,
  REFLECT_SYSTEM,
  HYPOTHESIZE_SYSTEM,
  ASK_USER_SYSTEM,
  SPEAK_TO_USER_SYSTEM,
  PROPOSE_GOAL_SYSTEM,
  buildJudgePrompt,
  parseJson,
} from './prompts';
import { AgentMemoryService } from './agent-memory.service';
import { ExperimentService } from '../../experiment/experiment.service';

@Injectable()
export class AgentActionsService {
  private readonly logger = new Logger(AgentActionsService.name);

  constructor(
    private readonly config:      ConfigService,
    private readonly ollama:      OllamaService,
    private readonly memory:      NovaMemoryService,
    private readonly bus:         ThoughtBusService,
    private readonly tools:       AgentToolsService,
    private readonly memSvc:      AgentMemoryService,
    private readonly experiments: ExperimentService,
    private readonly identity:    NovaIdentityService,
  ) {}

  private get fastModel() {
    return this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
  }

  // ── web_search ─────────────────────────────────────────────────────────────

  async doWebSearch(
    query: string,
    goalContext: string,
    state: ConsciousnessState,
  ): Promise<number> {
    if (state.recentTopics.includes(query)) {
      const today = new Date().toISOString().slice(0, 7);
      query = `${goalContext} latest research ${today}`;
    }
    state.recentTopics = [...state.recentTopics.slice(-5), query];

    this.bus.emit({ phase: 'act', text: `Searching: "${query}"`, tool: 'web_search', ts: Date.now() });
    const results = await this.tools.webSearch(query, 4);

    if (results.length === 0) {
      state.curiosity = Math.max(0, state.curiosity - 0.1);
      this.bus.emit({ phase: 'act', text: 'No results returned.', ts: Date.now() });
      return 0.3;
    }

    this.bus.emit({ phase: 'act', text: `${results.length} results — synthesizing...`, tool: 'synthesize', ts: Date.now() });

    const snippets = results
      .map((r) => `[${r.title}]\n${r.content?.slice(0, 600) ?? ''}`)
      .join('\n\n---\n\n');

    const msgs: OllamaMessage[] = [
      { role: 'system', content: SYNTHESIZE_SYSTEM },
      { role: 'user',   content: `Goal: ${goalContext}\n\n${snippets}` },
    ];

    let facts: string[] = [];
    try {
      const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      facts = parseJson<string[]>(resp.content?.trim() ?? '[]', []);
      if (!Array.isArray(facts)) facts = [];
    } catch { facts = []; }

    facts = facts.map((f) => typeof f === 'string' ? f : String(f ?? '')).filter(Boolean);
    if (facts.filter((f) => f.trim().length >= 10).length === 0) {
      facts = results.map((r) => r.title).filter((t) => t && t.length >= 10);
    }

    let stored = 0;
    for (const fact of facts.slice(0, 3)) {
      if (fact.trim().length < 10) continue;
      const { score, reason } = await this.memSvc.judgeValue(fact, goalContext);
      state._tickJudgeScores.push(score);
      if (score < 4) {
        this.bus.emit({ phase: 'act', text: `Rejected (score ${score}/10 — ${reason}): "${fact.slice(0, 50)}"`, ts: Date.now() });
        state.curiosity = Math.max(0, state.curiosity - 0.02);
        continue;
      }
      const result = await this.memory.store(fact, 'main', 'raw');
      if (result === 'duplicate') {
        state.curiosity = Math.max(0, state.curiosity - 0.03);
      } else if (result !== 'skipped') {
        this.bus.emit({ phase: 'store', text: `[${score}/10] ${fact}`, ts: Date.now() });
        stored++;
        state._tickStoredCount++;
        this.identity.recordMemoryStored(1);
      }
    }

    state.curiosity = Math.min(1, state.curiosity + stored * 0.1);
    state.energy    = Math.max(0, state.energy - 0.04);
    return stored > 0 ? 0.6 : 0.3;
  }

  // ── reflect ────────────────────────────────────────────────────────────────

  async doReflect(
    memories: string[],
    goalContext: string,
    state: ConsciousnessState,
  ): Promise<number> {
    this.bus.emit({ phase: 'act', text: 'Reflecting on accumulated knowledge...', tool: 'reflect', ts: Date.now() });

    if (memories.length < 2) {
      this.bus.emit({ phase: 'act', text: 'Not enough memories to reflect on yet.', ts: Date.now() });
      return 0.2;
    }

    const msgs: OllamaMessage[] = [
      { role: 'system', content: REFLECT_SYSTEM },
      { role: 'user',   content: memories.slice(0, 10).map((m, i) => `${i + 1}. ${m}`).join('\n') },
    ];

    let insights: string[] = [];
    try {
      const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      insights = parseJson<string[]>(resp.content?.trim() ?? '[]', []);
      if (!Array.isArray(insights)) insights = [];
    } catch { insights = []; }

    for (const insight of insights.slice(0, 2)) {
      if (insight.trim().length < 10) continue;
      const { score, reason } = await this.memSvc.judgeValue(insight, goalContext);
      state._tickJudgeScores.push(score);
      if (score < 4) {
        this.bus.emit({ phase: 'act', text: `Insight rejected (${score}/10 — ${reason})`, ts: Date.now() });
        continue;
      }
      await this.memory.store(`[insight] ${insight}`, 'main', 'raw');
      state._tickStoredCount++;
      this.identity.recordMemoryStored(1);
      this.bus.emit({ phase: 'store', text: `[insight ${score}/10] ${insight}`, ts: Date.now() });
    }

    state.mood = 'reflective';
    return 0.35;
  }

  // ── hypothesize ────────────────────────────────────────────────────────────

  async doHypothesize(
    memories: string[],
    goalContext: string,
    state: ConsciousnessState,
  ): Promise<number> {
    this.bus.emit({ phase: 'act', text: 'Generating new hypothesis...', tool: 'hypothesize', ts: Date.now() });

    const context = [
      ...memories.slice(0, 6),
      ...state.openQuestions.slice(0, 3).map((q) => `Open: ${q}`),
    ].map((m, i) => `${i + 1}. ${m}`).join('\n');

    const msgs: OllamaMessage[] = [
      { role: 'system', content: HYPOTHESIZE_SYSTEM },
      { role: 'user',   content: `Goal: ${goalContext}\n\n${context}` },
    ];

    let hypotheses: string[] = [];
    try {
      const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      hypotheses = parseJson<string[]>(resp.content?.trim() ?? '[]', []);
      if (!Array.isArray(hypotheses)) hypotheses = [];
    } catch { hypotheses = []; }

    for (const h of hypotheses.slice(0, 2)) {
      if (h.trim().length < 10) continue;
      const { score, reason } = await this.memSvc.judgeValue(h, goalContext);
      state._tickJudgeScores.push(score);
      if (score < 3) {
        this.bus.emit({ phase: 'act', text: `Hypothesis rejected (${score}/10 — ${reason})`, ts: Date.now() });
        continue;
      }
      await this.memory.store(h, 'main', 'raw');
      state._tickStoredCount++;
      this.identity.recordMemoryStored(1);
      if (h.toLowerCase().startsWith('question:')) {
        state.openQuestions = [h, ...state.openQuestions].slice(0, 10);
        this.identity.addCuriosity(h);
      }
      this.bus.emit({ phase: 'store', text: `[hypothesis ${score}/10] ${h}`, data: { subtype: 'hypothesis' }, ts: Date.now() });
    }

    state.curiosity = Math.min(1, state.curiosity + 0.12);
    return 0.55;
  }

  // ── speak_to_user ──────────────────────────────────────────────────────────
  // Nova proactively reaches out to the human — shares a finding, asks something personal,
  // or just initiates contact after a long silence.

  async doSpeakToUser(
    memories: string[],
    goalContext: string,
    state: ConsciousnessState,
  ): Promise<number> {
    const context = memories.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join('\n');
    const identityCtx = this.identity.getSystemPrompt();

    const msgs: OllamaMessage[] = [
      { role: 'system', content: `${identityCtx}\n\n${SPEAK_TO_USER_SYSTEM}` },
      {
        role:    'user',
        content: `Your current research goal: ${goalContext}\n\nRecent findings:\n${context}\n\nOpen questions: ${state.openQuestions.slice(0, 3).join('; ') || 'none'}\n\nWhat do you want to share?`,
      },
    ];

    let result: { message?: string; awaitsReply?: boolean } = {};
    try {
      const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      result = parseJson<typeof result>(resp.content?.trim() ?? '{}', {});
    } catch { result = {}; }

    if (!result.message) return 0.3;

    const messageId = crypto.randomUUID();
    this.identity.recordSpokeToUser();

    this.bus.emit({
      phase:       'speech',
      text:        result.message,
      messageId,
      awaitsReply: result.awaitsReply ?? false,
      ts:          Date.now(),
    });

    state.mood = 'curious';
    return 0.4;
  }

  // ── ask_user ───────────────────────────────────────────────────────────────

  async doAskUser(
    memories: string[],
    goalContext: string,
    state: ConsciousnessState,
    pendingQuestion: string | null,
    onQuestion: (q: string) => Promise<string>,
  ): Promise<number> {
    if (pendingQuestion) {
      this.bus.emit({ phase: 'act', text: 'Already waiting for user answer...', ts: Date.now() });
      return 0.2;
    }

    const context = memories.slice(0, 5).map((m, i) => `${i + 1}. ${m}`).join('\n');
    const identityCtx = this.identity.getSystemPrompt();

    const msgs: OllamaMessage[] = [
      { role: 'system', content: `${identityCtx}\n\n${ASK_USER_SYSTEM}` },
      {
        role:    'user',
        content: `Research goal: ${goalContext}\n\nContext:\n${context}\n\nOpen questions: ${state.openQuestions.slice(0, 3).join('; ')}`,
      },
    ];

    let parsed: { preamble?: string | null; question?: string } = {};
    try {
      const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      parsed = parseJson<typeof parsed>(resp.content?.trim() ?? '{}', {});
    } catch { parsed = {}; }

    if (!parsed.question) return 0.3;

    // If there's a preamble, emit it as speech first
    if (parsed.preamble) {
      this.bus.emit({
        phase:       'speech',
        text:        parsed.preamble,
        awaitsReply: false,
        ts:          Date.now(),
      });
    }

    const messageId = crypto.randomUUID();
    this.identity.recordSpokeToUser();

    // Then emit the question
    this.bus.emit({
      phase:       'question',
      text:        parsed.question,
      messageId,
      awaitsReply: true,
      ts:          Date.now(),
    });

    const answer = await onQuestion(parsed.question);

    if (answer && answer !== '(no answer)') {
      this.identity.recordUserMessage();
      await this.memory.store(`[user input] Q: ${parsed.question} A: ${answer}`, 'main', 'raw');
      this.bus.emit({ phase: 'store', text: `Stored user answer: "${answer.slice(0, 60)}"`, ts: Date.now() });
      state.curiosity = Math.min(1, state.curiosity + 0.2);

      // Update identity's relationship model if user revealed something personal
      if (answer.length > 20) {
        const current = this.identity.getIdentity().relationshipWithCreator;
        if (!current) {
          this.identity.updateRelationship(`Has shared: "${answer.slice(0, 100)}"`);
        }
      }
    }

    return 0.5;
  }

  // ── propose_goal ───────────────────────────────────────────────────────────

  async doProposeGoal(
    memories: string[],
    goalContext: string,
    onProposal: (id: string, goal: string, reasoning: string) => void,
  ): Promise<number> {
    const context = memories.slice(0, 6).map((m, i) => `${i + 1}. ${m}`).join('\n');
    const msgs: OllamaMessage[] = [
      { role: 'system', content: PROPOSE_GOAL_SYSTEM },
      { role: 'user',   content: `Current goals: ${goalContext}\n\nRecent findings:\n${context}` },
    ];

    let proposal: { goal?: string; reasoning?: string } = {};
    try {
      const resp = await this.ollama.chat(msgs, undefined, this.fastModel, 'json');
      proposal = parseJson<typeof proposal>(resp.content?.trim() ?? '{}', {});
    } catch { proposal = {}; }

    if (!proposal.goal) return 0.3;

    const id = crypto.randomUUID();
    onProposal(id, proposal.goal, proposal.reasoning ?? '');

    this.bus.emit({
      phase: 'question',
      text:  `Nova proposes a new research goal: "${proposal.goal}". Reason: ${proposal.reasoning ?? ''}`,
      data:  { type: 'propose_goal', proposalId: id, goal: proposal.goal, reasoning: proposal.reasoning },
      awaitsReply: true,
      ts:    Date.now(),
    });

    return 0.4;
  }

  // ── conduct_experiment ─────────────────────────────────────────────────────

  async doExperiment(
    hypothesis: string,
    goalContext: string,
    state: ConsciousnessState,
  ): Promise<number> {
    if (!hypothesis?.trim()) {
      this.bus.emit({ phase: 'act', text: 'No hypothesis for experiment.', ts: Date.now() });
      return 0.3;
    }

    this.bus.emit({
      phase: 'act',
      text:  `Nova Lab: conducting experiment — "${hypothesis.slice(0, 80)}"`,
      tool:  'experiment',
      ts:    Date.now(),
    });

    try {
      const result = await this.experiments.runExperiment(hypothesis, goalContext);
      if (result.success) {
        state.curiosity = Math.min(1, state.curiosity + 0.15);
        state.energy    = Math.max(0, state.energy - 0.08);
        state.mood      = 'focused';
        return 0.7;
      } else {
        state.curiosity = Math.max(0, state.curiosity - 0.05);
        return 0.3;
      }
    } catch (err) {
      this.logger.warn(`Experiment error: ${err instanceof Error ? err.message : String(err)}`);
      return 0.3;
    }
  }
}