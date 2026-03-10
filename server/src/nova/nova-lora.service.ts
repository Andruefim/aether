import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OllamaService, OllamaMessage } from '../generate/ollama.service';
import { ThoughtBusService } from './thought-bus.service';
import { NovaIdentityService } from './nova-identity.service';
import { LORA_TRAINING_DATA_SYSTEM, parseJson } from './agent-loop/prompts';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface TrainingPair {
  instruction: string;
  response: string;
}

@Injectable()
export class NovaLoraService {
  private readonly logger = new Logger(NovaLoraService.name);

  // Accumulated training examples across sleep cycles
  private trainingBuffer: TrainingPair[] = [];

  // Minimum examples before triggering fine-tune
  private readonly MIN_EXAMPLES = 30;

  // Paths
  private readonly dataDir: string;
  private readonly adapterDir: string;
  private readonly trainerScript: string;

  private isTraining = false;

  constructor(
    private readonly config:   ConfigService,
    private readonly ollama:   OllamaService,
    private readonly bus:      ThoughtBusService,
    private readonly identity: NovaIdentityService,
  ) {
    this.dataDir      = this.config.get<string>('NOVA_LORA_DATA_DIR',    path.join(process.cwd(), 'nova-lora', 'data'));
    this.adapterDir   = this.config.get<string>('NOVA_LORA_ADAPTER_DIR', path.join(process.cwd(), 'nova-lora', 'adapters'));
    this.trainerScript = this.config.get<string>('NOVA_LORA_TRAINER',   path.join(process.cwd(), 'nova-lora', 'trainer.py'));

    fs.mkdirSync(this.dataDir,    { recursive: true });
    fs.mkdirSync(this.adapterDir, { recursive: true });
  }

  /**
   * Called by AgentMemoryService after each consolidation batch.
   * Generates synthetic Q&A from memories, buffers them,
   * and triggers fine-tuning when enough have accumulated.
   */
  async onConsolidation(consolidatedMemories: string[], goalContext: string): Promise<void> {
    if (consolidatedMemories.length === 0) return;

    // Generate synthetic training pairs from this consolidation batch
    const pairs = await this.generateTrainingPairs(consolidatedMemories, goalContext);
    if (pairs.length === 0) return;

    this.trainingBuffer = [...this.trainingBuffer, ...pairs];
    this.logger.log(`[LoRA] Buffer: ${this.trainingBuffer.length}/${this.MIN_EXAMPLES} training pairs`);

    this.bus.emit({
      phase: 'sleep',
      text:  `[LoRA] Generated ${pairs.length} training pairs from consolidation. Buffer: ${this.trainingBuffer.length}/${this.MIN_EXAMPLES}`,
      ts:    Date.now(),
    });

    // Trigger training when buffer is full
    if (this.trainingBuffer.length >= this.MIN_EXAMPLES && !this.isTraining) {
      void this.triggerFineTune();
    }
  }

  /**
   * Returns LoRA status for the API.
   */
  getStatus(): { bufferSize: number; minExamples: number; isTraining: boolean; totalTrainings: number } {
    return {
      bufferSize:     this.trainingBuffer.length,
      minExamples:    this.MIN_EXAMPLES,
      isTraining:     this.isTraining,
      totalTrainings: this.identity.getIdentity().totalLoraTrainings,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async generateTrainingPairs(memories: string[], goalContext: string): Promise<TrainingPair[]> {
    const content = memories.slice(0, 10).map((m, i) => `${i + 1}. ${m}`).join('\n');
    const identityCtx = this.identity.getCoreIdentity();

    const msgs: OllamaMessage[] = [
      { role: 'system', content: `${identityCtx}\n\n${LORA_TRAINING_DATA_SYSTEM}` },
      {
        role:    'user',
        content: `Research goal: ${goalContext}\n\nConsolidated findings:\n${content}\n\nGenerate training pairs that teach Nova's identity and this knowledge.`,
      },
    ];

    try {
      const model = this.config.get<string>('NOVA_FAST_MODEL', 'qwen3.5:9b');
      const resp  = await this.ollama.chat(msgs, undefined, model, 'json');
      const pairs = parseJson<TrainingPair[]>(resp.content?.trim() ?? '[]', []);
      return Array.isArray(pairs)
        ? pairs.filter((p) => p.instruction && p.response)
        : [];
    } catch (err) {
      this.logger.warn(`[LoRA] Failed to generate training pairs: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private async triggerFineTune(): Promise<void> {
    this.isTraining = true;
    const batchId   = Date.now().toString();
    const dataFile  = path.join(this.dataDir, `batch_${batchId}.jsonl`);

    // Write training data as JSONL (ShareGPT / Alpaca format)
    const jsonl = this.trainingBuffer
      .map((p) => JSON.stringify({
        conversations: [
          { from: 'human', value: p.instruction },
          { from: 'gpt',   value: p.response    },
        ],
      }))
      .join('\n');

    fs.writeFileSync(dataFile, jsonl, 'utf-8');
    const outputDir = path.join(this.adapterDir, `lora_${batchId}`);
    const baseModel = this.config.get<string>('NOVA_LORA_BASE_MODEL', 'gemma3:12b');
    const ollamaUrl = this.config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434');

    this.bus.emit({
      phase: 'sleep',
      text:  `[LoRA] Starting fine-tune on ${this.trainingBuffer.length} examples. Base: ${baseModel}. This may take 10-30 minutes.`,
      ts:    Date.now(),
    });

    this.logger.log(`[LoRA] Launching trainer: ${this.trainerScript}`);
    this.logger.log(`[LoRA] Data: ${dataFile}, Output: ${outputDir}, Model: ${baseModel}`);

    const proc = spawn('python3', [
      this.trainerScript,
      '--data',       dataFile,
      '--output',     outputDir,
      '--base-model', baseModel,
      '--ollama-url', ollamaUrl,
      '--batch-id',   batchId,
    ], {
      detached: false,
      stdio:    'pipe',
    });

    proc.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) {
        this.logger.log(`[LoRA trainer] ${line}`);
        this.bus.emit({ phase: 'sleep', text: `[LoRA] ${line}`, ts: Date.now() });
      }
    });

    proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line && !line.startsWith('WARNING')) {
        this.logger.warn(`[LoRA trainer stderr] ${line}`);
      }
    });

    proc.on('close', (code) => {
      this.isTraining = false;

      if (code === 0) {
        this.trainingBuffer = []; // clear after successful training
        this.identity.recordLoraTraining();
        this.bus.emit({
          phase: 'wake',
          text:  `[LoRA] Fine-tune complete! Nova's weights updated. Training #${this.identity.getIdentity().totalLoraTrainings}`,
          data:  { type: 'lora_complete', batchId, outputDir },
          ts:    Date.now(),
        });
        this.logger.log(`[LoRA] Fine-tune complete. Adapter: ${outputDir}`);
      } else {
        this.bus.emit({
          phase: 'error',
          text:  `[LoRA] Fine-tune failed (exit code ${code}). Buffer preserved for next attempt.`,
          ts:    Date.now(),
        });
        this.logger.error(`[LoRA] Trainer exited with code ${code}`);
      }
    });

    proc.on('error', (err) => {
      this.isTraining = false;
      this.logger.error(`[LoRA] Failed to spawn trainer: ${err.message}`);
      this.bus.emit({
        phase: 'error',
        text:  `[LoRA] Trainer not available: ${err.message}. Is python3 + trainer.py configured?`,
        ts:    Date.now(),
      });
    });
  }
}