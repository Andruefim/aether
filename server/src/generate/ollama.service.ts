import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
  /** Base64-encoded images (without data: prefix) for vision models */
  images?: string[];
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  private readonly baseUrl: string;
  readonly defaultModel: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('OLLAMA_BASE_URL', 'http://localhost:11434');
    this.defaultModel = this.config.get<string>('OLLAMA_MODEL', 'qwen3-coder:30b');
    this.logger.log(`Ollama: baseUrl=${this.baseUrl} defaultModel=${this.defaultModel}`);
  }

  /** Non-streaming single turn — used for the agentic tool-call loop. */
  async chat(
    messages: OllamaMessage[],
    tools?: OllamaTool[],
    model?: string,
  ): Promise<OllamaMessage> {

    this.logger.log(`Ollama: chat with model=${model ?? this.defaultModel}`);
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model ?? this.defaultModel,
        messages,
        tools,
        stream: false,
        options: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try {
        const j = JSON.parse(body) as { error?: string };
        if (j.error) detail = j.error;
      } catch {
        // use raw body
      }
      throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}. ${detail}`);
    }
    const data = (await res.json()) as { message: OllamaMessage };
    return data.message;
  }

  /** Streaming token generator — used for the final answer. */
  async *streamGenerate(
    prompt: string,
    systemInstruction: string,
    model?: string,
  ): AsyncGenerator<string> {
    yield* this.streamMessages(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      model,
    );
  }

  /** Streaming from an arbitrary message history — used after the tool loop. */
  async *streamMessages(messages: OllamaMessage[], model?: string): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model ?? this.defaultModel,
        messages,
        stream: true,
        options: { temperature: 0.2 },
      }),
    });

    if (!res.ok || !res.body) throw new Error(res.statusText || 'Ollama request failed');

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
          if (chunk.message?.content) yield chunk.message.content;
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
