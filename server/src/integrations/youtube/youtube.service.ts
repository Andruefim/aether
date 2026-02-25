import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 500;

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnail: string;
  publishedAt: string;
}

export interface YoutubeChannel {
  channelId: string;
  title: string;
  description: string;
  thumbnail: string;
}

interface YtSearchItem {
  id: { videoId?: string; channelId?: string };
  snippet: {
    title: string;
    channelTitle: string;
    description: string;
    publishedAt: string;
    thumbnails: { medium?: { url: string }; default?: { url: string } };
  };
}

interface YtSearchResponse {
  items?: YtSearchItem[];
  error?: { message: string };
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(YoutubeService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://www.googleapis.com/youtube/v3';
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  /** In-flight requests by cache key — subsequent callers wait for the same promise. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('YOUTUBE_API_KEY', '');
  }

  async search(query: string, maxResults = 5): Promise<YoutubeVideo[]> {
    const url = this.buildUrl('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: String(Math.min(maxResults, 50)),
    });

    const data = await this.get<YtSearchResponse>(url);
    return (data.items ?? []).flatMap((item) =>
      item.id.videoId ? [this.mapVideo(item, item.id.videoId)] : [],
    );
  }

  /** Resolve a channel name/handle to a list of matching channels. */
  async searchChannels(query: string, maxResults = 3): Promise<YoutubeChannel[]> {
    const url = this.buildUrl('search', {
      part: 'snippet',
      q: query,
      type: 'channel',
      maxResults: String(Math.min(maxResults, 10)),
    });

    const data = await this.get<YtSearchResponse>(url);
    return (data.items ?? []).flatMap((item) =>
      item.id.channelId ? [this.mapChannel(item, item.id.channelId)] : [],
    );
  }

  async getChannelLatest(channelId: string, maxResults = 5): Promise<YoutubeVideo[]> {
    const url = this.buildUrl('search', {
      part: 'snippet',
      channelId,
      order: 'date',
      type: 'video',
      maxResults: String(Math.min(maxResults, 50)),
    });

    const data = await this.get<YtSearchResponse>(url);
    if (!data.items?.length) throw new NotFoundException('No videos found for this channel');
    return data.items.flatMap((item) =>
      item.id.videoId ? [this.mapVideo(item, item.id.videoId)] : [],
    );
  }

  /**
   * Convenience: resolve a channel name → channelId → latest videos.
   * This is what widgets should use so the model never needs to hardcode channel IDs.
   */
  async getLatestByChannelName(channelName: string, maxResults = 1): Promise<YoutubeVideo[]> {
    const channels = await this.searchChannels(channelName, 1);
    if (!channels.length) throw new NotFoundException(`Channel not found: ${channelName}`);
    return this.getChannelLatest(channels[0].channelId, maxResults);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildUrl(endpoint: string, params: Record<string, string>): string {
    const qs = new URLSearchParams({ ...params, key: this.apiKey }).toString();
    return `${this.baseUrl}/${endpoint}?${qs}`;
  }

  private async get<T>(url: string): Promise<T> {
    const cacheKey = url.replace(/([?&])key=[^&]*/g, '');

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Cache HIT: ${cacheKey.split('?')[0]}`);
      return cached.data as T;
    }

    let pending = this.inFlight.get(cacheKey);
    if (pending) {
      this.logger.debug(`Cache coalesce: waiting for in-flight request — ${cacheKey.split('?')[0]}`);
      return pending as Promise<T>;
    }

    this.logger.debug(`Cache MISS: ${cacheKey.split('?')[0]} — calling YouTube API`);
    // Set in-flight BEFORE any await so concurrent requests see it and coalesce
    const promise = new Promise<T>((resolve, reject) => {
      this.fetchAndCache<T>(url, cacheKey).then(resolve).catch(reject);
    });
    this.inFlight.set(cacheKey, promise);
    try {
      const data = await promise;
      return data;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  private async fetchAndCache<T>(url: string, cacheKey: string): Promise<T> {
    const res = await fetch(url);
    const data = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) {
      throw new Error((data as { error?: { message: string } }).error?.message ?? res.statusText);
    }
    this.cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    this.evictExpired();
    return data;
  }

  private evictExpired(): void {
    if (this.cache.size <= MAX_CACHE_SIZE) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }

  private mapVideo(item: YtSearchItem, videoId: string): YoutubeVideo {
    return {
      videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      description: item.snippet.description,
      thumbnail:
        item.snippet.thumbnails.medium?.url ??
        item.snippet.thumbnails.default?.url ??
        '',
      publishedAt: item.snippet.publishedAt,
    };
  }

  private mapChannel(item: YtSearchItem, channelId: string): YoutubeChannel {
    return {
      channelId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnail:
        item.snippet.thumbnails.medium?.url ??
        item.snippet.thumbnails.default?.url ??
        '',
    };
  }
}