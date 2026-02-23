import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OllamaService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434');
    this.model = this.config.get<string>('OLLAMA_MODEL', 'qwen3:latest');
  }

  async *streamGenerate(prompt: string, systemInstruction: string): AsyncGenerator<string> {
    const url = `${this.baseUrl}/api/chat`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ],
        stream: true,
        options: { temperature: 0.2 },
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(res.statusText || 'Ollama request failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed) as { message?: { content?: string } };
          if (chunk.message?.content) {
            yield chunk.message.content;
          }
        } catch {
          // skip malformed
        }
      }
    }

    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer.trim()) as { message?: { content?: string } };
        if (chunk.message?.content) yield chunk.message.content;
      } catch {
        // skip
      }
    }
  }
}
