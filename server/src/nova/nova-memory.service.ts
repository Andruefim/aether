import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { UMAP } from 'umap-js';

export interface MemoryPoint {
  id: string;
  text: string;
  type: 'main' | 'association' | 'voice';
  status: 'raw' | 'consolidated' | 'fading';
  surprise: number;      // 0–1: how novel was this when stored
  recallCount: number;   // how many times retrieved via recall()
  timestamp: number;
  lastRecalled: number;  // ms timestamp of last recall (0 if never)
  x: number;
  y: number;
  z: number;
}

const COLLECTION  = 'nova_memory';
const EMBED_MODEL = 'nomic-embed-text';
const VECTOR_SIZE = 768;

// A point is "fading" if not recalled for this many ms (7 days)
const FADING_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// Minimum surprise to bother storing (skip obvious duplicates immediately)
const MIN_SURPRISE = 0.08;

@Injectable()
export class NovaMemoryService implements OnModuleInit {
  private readonly logger = new Logger(NovaMemoryService.name);
  private client: QdrantClient;
  private ollamaBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const qdrantUrl = this.config.get<string>('QDRANT_URL', 'http://localhost:6333');
    this.ollamaBaseUrl = this.config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434');
    this.client = new QdrantClient({ url: qdrantUrl });
  }

  async onModuleInit() {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some((c) => c.name === COLLECTION);
      if (!exists) {
        await this.client.createCollection(COLLECTION, {
          vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
        });
        this.logger.log(`Qdrant collection "${COLLECTION}" created`);
      } else {
        this.logger.log(`Qdrant collection "${COLLECTION}" already exists`);
      }
    } catch (err) {
      this.logger.warn(`Qdrant not available: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Embeddings via Ollama ─────────────────────────────────────────────────

  private async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.ollamaBaseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama embed failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
      this.logger.error(
        `[embed] Model "${EMBED_MODEL}" returned empty embedding for: "${text.slice(0, 60)}". ` +
        `Run: ollama pull ${EMBED_MODEL}`,
      );
      throw new Error(`Empty embedding returned by ${EMBED_MODEL}`);
    }
    return data.embedding;
  }

  // ── Surprise score ────────────────────────────────────────────────────────
  // Returns 0–1: how novel the text is vs existing memory.
  // 1 = completely new, 0 = exact duplicate.

  async computeSurprise(vector: number[]): Promise<number> {
    try {
      const results = await this.client.search(COLLECTION, {
        vector,
        limit: 1,
        with_payload: false,
        score_threshold: 0,
      });
      if (results.length === 0) return 1.0; // empty collection → fully novel
      const topScore = results[0]?.score ?? 0; // cosine similarity 0–1
      return Math.max(0, 1 - topScore);
    } catch {
      return 0.5; // fallback if Qdrant unavailable
    }
  }

  // ── Store ─────────────────────────────────────────────────────────────────
  // Returns: stored id, 'skipped' (embed unavailable), or 'duplicate' (too low surprise)

  async store(
    text: string,
    type: 'main' | 'association' | 'voice' = 'main',
    status: 'raw' | 'consolidated' = 'raw',
  ): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('text is empty');

    let vector: number[];
    try {
      vector = await this.embed(trimmed);
    } catch (err) {
      this.logger.warn(`embed skipped: ${err instanceof Error ? err.message : String(err)}`);
      return 'skipped';
    }

    // Compute surprise before storing
    const surprise = await this.computeSurprise(vector);

    if (surprise < MIN_SURPRISE) {
      this.logger.debug(`[store] Skipped near-duplicate (surprise=${surprise.toFixed(3)}): "${trimmed.slice(0, 60)}"`);
      return 'duplicate';
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    await this.client.upsert(COLLECTION, {
      points: [{
        id,
        vector,
        payload: {
          text:        trimmed,
          type,
          status,
          surprise,
          recall_count:  0,
          last_recalled: 0,
          timestamp:     now,
        },
      }],
    });

    this.logger.log(
      `Stored [${type}/${status}] surprise=${surprise.toFixed(3)}: "${trimmed.slice(0, 60)}"`,
    );
    return id;
  }

  // ── Count raw ─────────────────────────────────────────────────────────────

  async countRaw(): Promise<number> {
    try {
      const result = await this.client.count(COLLECTION, {
        filter: { must: [{ key: 'status', match: { value: 'raw' } }] },
      });
      return result.count;
    } catch {
      return 0;
    }
  }

  // ── Delete many ───────────────────────────────────────────────────────────

  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.delete(COLLECTION, { points: ids });
  }

  // ── Fetch raw for consolidation ──────────────────────────────────────────
  // Returns sorted by keep_score descending so consolidation processes
  // most valuable memories first.

  async fetchRaw(limit = 60): Promise<Array<{ id: string; text: string; surprise: number; recallCount: number }>> {
    try {
      const result = await this.client.scroll(COLLECTION, {
        limit,
        with_payload: true,
        with_vector:  false,
        filter: { must: [{ key: 'status', match: { value: 'raw' } }] },
      });
      return result.points
        .map((p) => {
          const pay = p.payload as Record<string, unknown>;
          return {
            id:          String(p.id),
            text:        String(pay?.['text'] ?? ''),
            surprise:    Number(pay?.['surprise'] ?? 0.5),
            recallCount: Number(pay?.['recall_count'] ?? 0),
          };
        })
        .filter((p) => p.text.length > 0)
        .sort((a, b) => this.keepScore(b) - this.keepScore(a)); // best first
    } catch {
      return [];
    }
  }

  // ── Fetch fading memories (long unused raw points) ───────────────────────

  async fetchFading(): Promise<Array<{ id: string; text: string; surprise: number; recallCount: number }>> {
    try {
      const fadingCutoff = Date.now() - FADING_THRESHOLD_MS;
      const result = await this.client.scroll(COLLECTION, {
        limit: 200,
        with_payload: true,
        with_vector:  false,
        filter: {
          must: [{ key: 'status', match: { value: 'raw' } }],
        },
      });
      return result.points
        .map((p) => {
          const pay = p.payload as Record<string, unknown>;
          return {
            id:           String(p.id),
            text:         String(pay?.['text'] ?? ''),
            surprise:     Number(pay?.['surprise'] ?? 0.5),
            recallCount:  Number(pay?.['recall_count'] ?? 0),
            lastRecalled: Number(pay?.['last_recalled'] ?? 0),
            timestamp:    Number(pay?.['timestamp'] ?? 0),
          };
        })
        .filter((p) => {
          if (p.text.length === 0) return false;
          const lastActivity = Math.max(p.lastRecalled, p.timestamp);
          return lastActivity < fadingCutoff && p.recallCount === 0;
        });
    } catch {
      return [];
    }
  }

  // ── Keep score (Titans-inspired) ─────────────────────────────────────────
  // surprise × 0.5 + recall_weight × 0.5
  // Used to decide what to consolidate vs drop.

  keepScore(p: { surprise: number; recallCount: number }): number {
    const recallWeight = Math.min(1, p.recallCount / 5); // saturates at 5 recalls
    return p.surprise * 0.5 + recallWeight * 0.5;
  }

  // ── Recall ────────────────────────────────────────────────────────────────
  // Increments recall_count for matched points (use-it-or-lose-it).

  async recall(query: string, topK = 5): Promise<string[]> {
    let vector: number[];
    try {
      vector = await this.embed(query);
    } catch {
      return [];
    }

    let results: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }>;
    try {
      results = await this.client.search(COLLECTION, {
        vector,
        limit: topK,
        with_payload: true,
        score_threshold: 0.4, // lowered from 0.5 for better coverage
      });
    } catch {
      return [];
    }

    if (results.length === 0) return [];

    // Fire-and-forget: increment recall_count + update last_recalled
    const now = Date.now();
    Promise.all(
      results.map((r) => {
        const pay = r.payload as Record<string, unknown> | null ?? {};
        const prevCount = Number(pay?.['recall_count'] ?? 0);
        return this.client.setPayload(COLLECTION, {
          points: [String(r.id)],
          payload: {
            recall_count:  prevCount + 1,
            last_recalled: now,
          },
        }).catch(() => {});
      }),
    ).catch(() => {});

    return results
      .map((r) => String((r.payload as Record<string, unknown> | null | undefined)?.['text'] ?? ''))
      .filter((t) => t.length > 0);
  }

  // ── Project (UMAP 768d → 3d) ──────────────────────────────────────────────

  async project(limit = 300): Promise<MemoryPoint[]> {
    let points: Array<{ id: string; vector?: number[] | Record<string, number[]>; payload?: Record<string, unknown> }>;
    try {
      const result = await this.client.scroll(COLLECTION, {
        limit,
        with_vector:  true,
        with_payload: true,
      });
      points = result.points as typeof points;
    } catch {
      return [];
    }

    if (points.length === 0) return [];

    const vectors: number[][] = points.map((p) => {
      const v = p.vector;
      if (Array.isArray(v)) return v as number[];
      if (v && typeof v === 'object') return Object.values(v)[0] as number[];
      return new Array(VECTOR_SIZE).fill(0) as number[];
    });

    let coords: number[][];
    if (vectors.length < 4) {
      coords = vectors.map((_, i) => [i * 0.5, 0, 0]);
    } else {
      const umap = new UMAP({
        nComponents: 3,
        nNeighbors:  Math.min(15, vectors.length - 1),
        minDist:     0.1,
        random: (() => { let s = 42; return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }; })(),
      });
      coords = await umap.fitAsync(vectors);
    }

    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const zs = coords.map((c) => c[2]);
    const norm = (v: number, min: number, max: number) =>
      max === min ? 0 : ((v - min) / (max - min)) * 6 - 3;
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    const [zMin, zMax] = [Math.min(...zs), Math.max(...zs)];

    return points.map((p, i) => {
      const pay = p.payload ?? {};
      return {
        id:          String(p.id),
        text:        String(pay['text'] ?? ''),
        type:        (pay['type'] as MemoryPoint['type']) ?? 'main',
        status:      (pay['status'] as MemoryPoint['status']) ?? 'raw',
        surprise:    Number(pay['surprise'] ?? 0.5),
        recallCount: Number(pay['recall_count'] ?? 0),
        timestamp:   Number(pay['timestamp'] ?? 0),
        lastRecalled:Number(pay['last_recalled'] ?? 0),
        x:           norm(coords[i][0], xMin, xMax),
        y:           norm(coords[i][1], yMin, yMax),
        z:           norm(coords[i][2], zMin, zMax),
      };
    });
  }

  // ── Recall with metadata (for per-goal summary) ──────────────────────────
  // Returns raw payload fields without touching recall_count.

  async recallWithMeta(query: string, topK = 30): Promise<Array<{
    id: string;
    text: string;
    surprise: number;
    recallCount: number;
    status: string;
  }>> {
    let vector: number[];
    try {
      vector = await this.embed(query);
    } catch {
      return [];
    }

    try {
      const results = await this.client.search(COLLECTION, {
        vector,
        limit: topK,
        with_payload: true,
        score_threshold: 0.35,
      });
      return results.map((r) => {
        const pay = r.payload as Record<string, unknown> | null ?? {};
        return {
          id:          String(r.id),
          text:        String(pay['text'] ?? ''),
          surprise:    Number(pay['surprise'] ?? 0.5),
          recallCount: Number(pay['recall_count'] ?? 0),
          status:      String(pay['status'] ?? 'raw'),
        };
      }).filter((p) => p.text.length > 0);
    } catch {
      return [];
    }
  }

  // ── Search (for highlight + query context) ────────────────────────────────

  async search(query: string, topK = 10): Promise<MemoryPoint[]> {
    let vector: number[];
    try {
      vector = await this.embed(query);
    } catch (err) {
      this.logger.warn(`embed failed for search: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    let results: Array<{ id: string | number; score: number; payload?: Record<string, unknown> | null }>;
    try {
      results = await this.client.search(COLLECTION, {
        vector,
        limit: topK,
        with_payload: true,
      });
    } catch {
      return [];
    }

    const allPoints = await this.project();
    const byId = new Map(allPoints.map((p) => [p.id, p]));

    return results
      .map((r) => byId.get(String(r.id)))
      .filter((p): p is MemoryPoint => p !== undefined);
  }
}
