import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface FetchResult {
  title: string;
  content: string;
}

/**
 * Thin wrappers around Ollama's web_search and web_fetch APIs.
 * Used by AgentLoopService as tool calls.
 */
@Injectable()
export class AgentToolsService {
  private readonly logger = new Logger(AgentToolsService.name);
  private readonly baseUrl = 'https://ollama.com/api';
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('OLLAMA_API_KEY', '');
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async webSearch(query: string, maxResults = 5): Promise<SearchResult[]> {
    try {
      const res = await fetch(`${this.baseUrl}/web_search`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, max_results: maxResults }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        this.logger.warn(`web_search HTTP ${res.status}: ${await res.text()}`);
        return [];
      }
      const data = (await res.json()) as { results?: SearchResult[] };
      return data.results ?? [];
    } catch (err) {
      this.logger.warn(`web_search error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  async fetchPage(url: string): Promise<FetchResult> {
    try {
      const res = await fetch(`${this.baseUrl}/web_fetch`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        this.logger.warn(`web_fetch HTTP ${res.status}`);
        return { title: '', content: '' };
      }
      return (await res.json()) as FetchResult;
    } catch (err) {
      this.logger.warn(`web_fetch error: ${err instanceof Error ? err.message : String(err)}`);
      return { title: '', content: '' };
    }
  }
}
