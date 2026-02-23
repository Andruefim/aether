import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { OllamaService } from './ollama.service';

@Injectable()
export class GenerateService {
  constructor(private readonly ollama: OllamaService) {}

  streamGenerate(
    prompt: string,
    systemInstruction: string,
  ): Observable<{ data: string }> {
    return new Observable((subscriber) => {
      const run = async () => {
        try {
          for await (const token of this.ollama.streamGenerate(prompt, systemInstruction)) {
            subscriber.next({ data: JSON.stringify({ text: token }) });
          }
          subscriber.next({ data: '[DONE]' });
        } catch (err) {
          subscriber.next({ data: JSON.stringify({ error: 'Generation failed' }) });
        } finally {
          subscriber.complete();
        }
      };
      run();
    });
  }
}
