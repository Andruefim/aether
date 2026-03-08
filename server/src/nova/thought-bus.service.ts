import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type ThoughtPhase = 'observe' | 'orient' | 'plan' | 'act' | 'store' | 'sleep' | 'wake' | 'question' | 'error';

export interface ThoughtEvent {
  phase: ThoughtPhase;
  text: string;
  tool?: string;
  data?: Record<string, unknown>;
  ts: number;
}

@Injectable()
export class ThoughtBusService {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: ThoughtEvent) {
    this.emitter.emit('thought', event);
  }

  subscribe(listener: (e: ThoughtEvent) => void): () => void {
    this.emitter.on('thought', listener);
    return () => this.emitter.off('thought', listener);
  }
}
