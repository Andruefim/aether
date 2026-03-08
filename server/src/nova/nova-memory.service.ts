import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import { UMAP } from 'umap-js';

export interface MemoryPoint {
  id: string;
  text: string;
  type: 'main' | 'association' | 'voice';
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

const COLLECTION = 'nova_memory';
const EMBED_MODEL = 'nomic-embed-text';
const VECTOR_SIZE = 768;

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

  // ── Embeddings via Ollama ────────────────────────────────────────────────

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
    return data.embedding;
  }

  // ── Store ────────────────────────────────────────────────────────────────

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
      this.logger.warn(`embed skipped (model unavailable?): ${err instanceof Error ? err.message : String(err)}`);
      return 'skipped';
    }
    const id = crypto.randomUUID();

    await this.client.upsert(COLLECTION, {
      points: [
        {
          id,
          vector,
          payload: { text: trimmed, type, status, timestamp: Date.now() },
        },
      ],
    });

    this.logger.log(`Stored memory [${type}/${status}]: "${trimmed.slice(0, 60)}"`);
    return id;
  }

  /** Count how many raw (unconsolidated) memories are stored */
  async countRaw(): Promise<number> {
    try {
      const result = await this.client.count(COLLECTION, {
        filter: {
          must: [{ key: 'status', match: { value: 'raw' } }],
        },
      });
      return result.count;
    } catch {
      return 0;
    }
  }

  /** Delete a set of points by ID (used after consolidation) */
  async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.client.delete(COLLECTION, { points: ids });
  }

  /** Fetch raw points for consolidation */
  async fetchRaw(limit = 50): Promise<Array<{ id: string; text: string }>> {
    try {
      const result = await this.client.scroll(COLLECTION, {
        limit,
        with_payload: true,
        with_vector: false,
        filter: {
          must: [{ key: 'status', match: { value: 'raw' } }],
        },
      });
      return result.points.map((p) => ({
        id:   String(p.id),
        text: String((p.payload as Record<string, unknown>)?.['text'] ?? ''),
      })).filter((p) => p.text.length > 0);
    } catch {
      return [];
    }
  }

  // ── Project (UMAP 768d → 3d) ─────────────────────────────────────────────

  async project(limit = 300): Promise<MemoryPoint[]> {
    let points: Array<{ id: string; vector?: number[] | Record<string, number[]>; payload?: Record<string, unknown> }>;
    try {
      const result = await this.client.scroll(COLLECTION, {
        limit,
        with_vector: true,
        with_payload: true,
      });
      points = result.points as typeof points;
    } catch {
      return [];
    }

    if (points.length === 0) return [];

    // Extract raw vectors (Qdrant may return named vectors; handle both)
    const vectors: number[][] = points.map((p) => {
      const v = p.vector;
      if (Array.isArray(v)) return v as number[];
      // named vector map — take first value
      if (v && typeof v === 'object') return Object.values(v)[0] as number[];
      return new Array(VECTOR_SIZE).fill(0) as number[];
    });

    let coords: number[][];
    if (vectors.length < 4) {
      // UMAP needs ≥ 4 points; just place them linearly
      coords = vectors.map((_, i) => [i * 0.5, 0, 0]);
    } else {
      const umap = new UMAP({
        nComponents: 3,
        nNeighbors: Math.min(15, vectors.length - 1),
        minDist: 0.1,
        // Fixed seed so projections are stable across polls
        random: (() => { let s = 42; return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }; })(),
      });
      coords = await umap.fitAsync(vectors);
    }

    // Normalize coords to [-3, 3] range
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const zs = coords.map((c) => c[2]);
    const norm = (v: number, min: number, max: number) =>
      max === min ? 0 : ((v - min) / (max - min)) * 6 - 3;
    const [xMin, xMax] = [Math.min(...xs), Math.max(...xs)];
    const [yMin, yMax] = [Math.min(...ys), Math.max(...ys)];
    const [zMin, zMax] = [Math.min(...zs), Math.max(...zs)];

    return points.map((p, i) => ({
      id:        String(p.id),
      text:      String(p.payload?.['text'] ?? ''),
      type:      (p.payload?.['type'] as 'main' | 'association' | 'voice') ?? 'main',
      timestamp: Number(p.payload?.['timestamp'] ?? 0),
      x:         norm(coords[i][0], xMin, xMax),
      y:         norm(coords[i][1], yMin, yMax),
      z:         norm(coords[i][2], zMin, zMax),
    }));
  }

  // ── Recall: text snippets for context injection ──────────────────────────

  async recall(query: string, topK = 5): Promise<string[]> {
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
        score_threshold: 0.5,
      });
      return results
        .map((r) => String((r.payload as Record<string, unknown> | null | undefined)?.['text'] ?? ''))
        .filter((t) => t.length > 0);
    } catch {
      return [];
    }
  }

  // ── Nearest neighbors (for query highlight) ─────────────────────────────

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

    // Get the full projected positions so we can return xyz
    const allPoints = await this.project();
    const byId = new Map(allPoints.map((p) => [p.id, p]));

    return results
      .map((r) => byId.get(String(r.id)))
      .filter((p): p is MemoryPoint => p !== undefined);
  }
}
