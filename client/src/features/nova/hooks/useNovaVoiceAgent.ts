import { useCallback, useRef, useState } from 'react';
import { useAetherStore } from '../../../core';

export type AgentPhase = 'idle' | 'listening' | 'processing' | 'speaking';

interface UseNovaVoiceAgentOptions {
  /** Called when AI responds with text — push to glyph bucket */
  onSpeak: (text: string) => void;
  /** Called whenever Nova streams a token (used for associations in glyph system) */
  onToken?: (payload: { stream: 'main' | 'association'; text: string; color: string }) => void;
}

/**
 * Nova-specific voice agent.
 * Same record → transcribe → generate loop as useVoiceAgent,
 * but routes through /api/nova/input (NOT /api/aether/voice-chat).
 * Never touches aetherHtml — no HTML generation in Nova mode.
 */
export function useNovaVoiceAgent({ onSpeak, onToken }: UseNovaVoiceAgentOptions) {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>('idle');

  const activeRef        = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const currentAudioRef  = useRef<HTMLAudioElement | null>(null);
  const abortRef         = useRef<AbortController | null>(null);
  const onSpeakRef       = useRef(onSpeak);
  onSpeakRef.current     = onSpeak;
  const onTokenRef       = useRef(onToken);
  onTokenRef.current     = onToken;

  const setAetherIsGenerating = useAetherStore((s) => s.setAetherIsGenerating);
  const setAetherStatus       = useAetherStore((s) => s.setAetherStatus);
  const setAetherIsSpeaking   = useAetherStore((s) => s.setAetherIsSpeaking);
  const setAetherIsListening  = useAetherStore((s) => s.setAetherIsListening);
  const pushAetherMessage     = useAetherStore((s) => s.pushAetherMessage);
  const aetherHistoryRef      = useRef(useAetherStore.getState().aetherHistory);
  useAetherStore.subscribe((s) => { aetherHistoryRef.current = s.aetherHistory; });

  // ── TTS ────────────────────────────────────────────────────────────────────
  const playTTS = useCallback(async (text: string) => {
    if (!activeRef.current) return;
    setPhase('speaking');
    setAetherIsSpeaking(true);
    try {
      const res = await fetch('/api/aether/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      currentAudioRef.current = null;
    } catch { /* TTS offline — silent */ } finally {
      setAetherIsSpeaking(false);
    }
  }, [setAetherIsSpeaking]);

  // ── Record ─────────────────────────────────────────────────────────────────
  const record = useCallback((): Promise<Blob | null> => {
    return new Promise(async (resolve) => {
      if (!activeRef.current) { resolve(null); return; }
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { resolve(null); return; }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source  = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      let lastSound = Date.now();
      let hasSpeech = false;

      const check = setInterval(() => {
        if (!activeRef.current) { stop(); return; }
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += Math.abs(v - 128);
        if (sum / buf.length > 10) { hasSpeech = true; lastSound = Date.now(); }
        if (hasSpeech && Date.now() - lastSound > 1500) stop();
      }, 100);

      const maxT = setTimeout(stop, 30_000);

      function stop() {
        clearInterval(check);
        clearTimeout(maxT);
        if (recorder.state !== 'inactive') recorder.stop();
      }

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
        audioCtxRef.current = null;
        resolve(hasSpeech && chunks.length > 0
          ? new Blob(chunks, { type: mimeType }) : null);
      };
      recorder.start(100);
    });
  }, []);

  // ── Transcribe ─────────────────────────────────────────────────────────────
  const transcribe = useCallback(async (blob: Blob): Promise<string | null> => {
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    try {
      const res = await fetch('/api/aether/transcribe', { method: 'POST', body: form });
      if (!res.ok) return null;
      const d = await res.json() as { text: string };
      return d.text?.trim() || null;
    } catch { return null; }
  }, []);

  // ── Nova SSE (no HTML gen) ─────────────────────────────────────────────────
  const processInput = useCallback(async (text: string) => {
    if (!activeRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;

    pushAetherMessage({ role: 'user', content: text, timestamp: Date.now() });
    setAetherIsGenerating(true);
    setAetherStatus('Thinking…');

    let mainText = '';

    try {
      const res = await fetch('/api/nova/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          history: aetherHistoryRef.current.slice(-8),
        }),
      });
      if (!res.ok || !res.body) throw new Error('nova/input failed');

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = '';
      let done   = false;

      while (!done) {
        const { done: d, value } = await reader.read();
        if (d) break;
        sseBuf += decoder.decode(value, { stream: true });
        const segs = sseBuf.split(/\n\n+/);
        sseBuf = segs.pop() ?? '';

        for (const seg of segs) {
          const line = seg.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const ev = JSON.parse(raw) as { type: string; stream?: string; text?: string; color?: string };
            if (ev.type === 'token' && ev.text) {
              if (ev.stream === 'main') {
                mainText += ev.text;
              } else if (ev.stream === 'association' && ev.color) {
                onTokenRef.current?.({ stream: 'association', text: ev.text, color: ev.color });
              }
            }
            if (ev.type === 'done') {
              done = true;
              if (mainText.trim()) {
                // Push full response to glyph system (staggered in caller)
                onSpeakRef.current(mainText.trim());
                // Also play TTS
                void playTTS(mainText.trim());
                pushAetherMessage({ role: 'assistant', content: mainText.trim(), timestamp: Date.now() });
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') console.error('[NovaVoice]', err);
    } finally {
      setAetherIsGenerating(false);
      setAetherStatus(null);
    }
  }, [pushAetherMessage, setAetherIsGenerating, setAetherStatus, playTTS]);

  // ── Main cycle ─────────────────────────────────────────────────────────────
  const runCycle = useCallback(async () => {
    if (!activeRef.current) return;

    setPhase('listening');
    setAetherIsListening(true);
    setAetherStatus('Listening…');

    const blob = await record();
    setAetherIsListening(false);
    if (!activeRef.current) return;

    if (!blob) { if (activeRef.current) setTimeout(runCycle, 300); return; }

    setPhase('processing');
    setAetherStatus('Transcribing…');
    const text = await transcribe(blob);
    if (!activeRef.current) return;

    if (!text) { if (activeRef.current) setTimeout(runCycle, 300); return; }

    await processInput(text);

    // Wait for TTS then loop
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!currentAudioRef.current || currentAudioRef.current.ended) {
          clearInterval(check); resolve();
        }
      }, 100);
    });

    if (activeRef.current) setTimeout(runCycle, 300);
  }, [record, transcribe, processInput, setAetherIsListening, setAetherStatus]);

  // ── Public API ─────────────────────────────────────────────────────────────
  const startAgent = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    setIsActive(true);
    runCycle();
  }, [runCycle]);

  const stopAgent = useCallback(() => {
    activeRef.current = false;
    setIsActive(false);
    setPhase('idle');
    setAetherIsListening(false);
    setAetherIsSpeaking(false);
    setAetherIsGenerating(false);
    setAetherStatus(null);
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
    abortRef.current?.abort();
  }, [setAetherIsListening, setAetherIsSpeaking, setAetherIsGenerating, setAetherStatus]);

  return { isActive, phase, startAgent, stopAgent };
}