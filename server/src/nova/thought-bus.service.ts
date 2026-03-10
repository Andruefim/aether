import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export type ThoughtPhase =
  | 'observe'
  | 'orient'
  | 'plan'
  | 'act'
  | 'store'
  | 'sleep'
  | 'wake'
  | 'question'   // existing: Nova asks user, awaits reply
  | 'speech'     // NEW: Nova speaks to user proactively (no reply required)
  | 'error';

export interface ThoughtEvent {
  phase:        ThoughtPhase;
  text:         string;
  tool?:        string;
  data?:        Record<string, unknown>;
  ts:           number;

  // ── Speech-specific fields ──────────────────────────────────────────
  // phase='speech': Nova is talking directly TO the user
  messageId?:   string;   // unique id, used to match reply
  awaitsReply?: boolean;  // true → client shows reply input
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