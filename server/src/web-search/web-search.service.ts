import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
}

export interface WebFetchResult {
  title: string;
  content: string;
  links: string[];
}

@Injectable()
export class WebSearchService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://ollama.com/api';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('OLLAMA_API_KEY', '');
  }

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
    const res = await fetch(`${this.baseUrl}/web_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, max_results: maxResults }),
    });

    if (!res.ok) throw new Error(`web_search failed: ${res.statusText}`);
    const data = (await res.json()) as { results: WebSearchResult[] };
    return data.results;
  }

  async fetch(url: string): Promise<WebFetchResult> {
    const res = await fetch(`${this.baseUrl}/web_fetch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) throw new Error(`web_fetch failed: ${res.statusText}`);
    return res.json() as Promise<WebFetchResult>;
  }
}