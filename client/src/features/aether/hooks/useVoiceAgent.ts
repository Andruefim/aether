import { useCallback, useRef, useState } from 'react';
import { useAetherStore } from '../../../core';
import { stripMarkdownCodeFence, stripToHtmlDocumentStart } from '../../../shared';
import { INITIAL_AETHER_HTML, MINIMAL_AETHER_HTML } from '../constants';

export type AgentPhase = 'idle' | 'listening' | 'processing' | 'speaking' | 'generating';

interface UseVoiceAgentOptions {
  captureScreenshot?: () => Promise<string | null>;
  onUiReady?: (html: string) => void;
  /** Called when the AI produces spoken text — before TTS plays.
   *  In Nova mode this pushes words into the 3D glyph bucket. */
  onSpeak?: (text: string) => void;
}

/**
 * Voice agent hook — manages a continuous voice conversation loop:
 *
 * 1. Record with silence detection (1.5s silence → auto-stop)
 * 2. Transcribe via /api/aether/transcribe
 * 3. POST /api/aether/voice-chat (SSE)
 *    → { type: 'speak', text }   → play TTS via /api/aether/speak
 *    → { type: 'token', text }   → stream HTML into canvas
 *    → { type: 'done' }          → restart cycle
 * 4. After TTS ends → restart cycle automatically
 */
export function useVoiceAgent({ captureScreenshot, onUiReady, onSpeak }: UseVoiceAgentOptions) {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [agentStatus, setAgentStatus] = useState<string | null>(null);

  const activeRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Keep onSpeak stable via ref so processVoiceChat closure doesn't go stale
  const onSpeakRef = useRef(onSpeak);
  onSpeakRef.current = onSpeak;

  const setAetherHtml = useAetherStore((s) => s.setAetherHtml);
  const setAetherPreviousHtml = useAetherStore((s) => s.setAetherPreviousHtml);
  const setAetherIsGenerating = useAetherStore((s) => s.setAetherIsGenerating);
  const setAetherStatus = useAetherStore((s) => s.setAetherStatus);
  const triggerAetherPulse = useAetherStore((s) => s.triggerAetherPulse);
  const pushAetherMessage = useAetherStore((s) => s.pushAetherMessage);
  const setAetherIsSpeaking = useAetherStore((s) => s.setAetherIsSpeaking);

  // ── TTS playback ──────────────────────────────────────────────────────────
  const playTTS = useCallback(async (text: string): Promise<void> => {
    if (!activeRef.current) return;
    setPhase('speaking');
    setAetherIsSpeaking(true);
    setAgentStatus('Speaking...');

    try {
      const res = await fetch('/api/aether/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('TTS failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.play().catch(() => resolve());
      });

      URL.revokeObjectURL(url);
      currentAudioRef.current = null;
    } catch {
      // TTS unavailable — continue silently
    } finally {
      setAetherIsSpeaking(false);
    }
  }, [setAetherIsSpeaking]);

  // ── Record with silence detection ─────────────────────────────────────────
  const recordWithSilenceDetection = useCallback((): Promise<Blob | null> => {
    return new Promise(async (resolve) => {
      if (!activeRef.current) { resolve(null); return; }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        resolve(null);
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      const chunks: Blob[] = [];

      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const SILENCE_THRESHOLD = 10;
      const SILENCE_DURATION_MS = 1500;
      const MAX_DURATION_MS = 30_000;

      let lastSoundAt = Date.now();
      let hasSpeech = false;

      const checkSilence = () => {
        if (!activeRef.current) { stopRecording(); return; }
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (const val of dataArray) sum += Math.abs(val - 128);
        const rms = sum / dataArray.length;
        if (rms > SILENCE_THRESHOLD) { hasSpeech = true; lastSoundAt = Date.now(); }
        if (hasSpeech && Date.now() - lastSoundAt > SILENCE_DURATION_MS) stopRecording();
      };

      const silenceInterval = setInterval(checkSilence, 100);
      const maxTimer = setTimeout(stopRecording, MAX_DURATION_MS);

      function stopRecording() {
        clearInterval(silenceInterval);
        clearTimeout(maxTimer);
        if (recorder.state !== 'inactive') recorder.stop();
      }

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
        audioContextRef.current = null;
        if (!hasSpeech || chunks.length === 0) { resolve(null); return; }
        resolve(new Blob(chunks, { type: mimeType }));
      };

      recorder.start(100);
    });
  }, []);

  // ── Transcribe ────────────────────────────────────────────────────────────
  const transcribe = useCallback(async (blob: Blob): Promise<string | null> => {
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    try {
      const res = await fetch('/api/aether/transcribe', { method: 'POST', body: form });
      if (!res.ok) return null;
      const data = await res.json() as { text: string };
      return data.text?.trim() || null;
    } catch { return null; }
  }, []);

  // ── Process voice-chat SSE ────────────────────────────────────────────────
  const processVoiceChat = useCallback(async (
    text: string,
    screenshot: string | null,
  ): Promise<void> => {
    if (!activeRef.current) return;

    const storeState = useAetherStore.getState();
    const storeHtml = storeState.aetherHtml || INITIAL_AETHER_HTML;
    const isWelcome = storeHtml === INITIAL_AETHER_HTML;
    const currentHtml = isWelcome ? MINIMAL_AETHER_HTML : storeHtml;
    if (isWelcome) setAetherHtml(MINIMAL_AETHER_HTML);
    setAetherPreviousHtml(storeHtml);

    pushAetherMessage({ role: 'user', content: text, timestamp: Date.now() });

    const controller = new AbortController();
    abortRef.current = controller;
    let bufferRef = '';

    try {
      const res = await fetch('/api/aether/voice-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          screenshot: screenshot ?? undefined,
          currentHtml,
          history: storeState.aetherHistory.slice(-8),
        }),
      });

      if (!res.ok || !res.body) throw new Error('voice-chat failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = '';
      let isDone = false;
      let isGeneratingUi = false;

      while (!isDone) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuffer += decoder.decode(value, { stream: true });
        const segments = sseBuffer.split(/\n\n+/);
        sseBuffer = segments.pop() ?? '';

        for (const segment of segments) {
          if (!activeRef.current) break;
          const line = segment.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const event = JSON.parse(raw) as {
              type: string;
              text?: string;
              action?: string;
              message?: string;
            };

            switch (event.type) {
              case 'speak':
                if (event.text) {
                  pushAetherMessage({ role: 'assistant', content: event.text, timestamp: Date.now() });
                  // ★ Notify Nova glyph system BEFORE TTS
                  onSpeakRef.current?.(event.text);
                  // TTS plays in parallel — don't await
                  void playTTS(event.text);
                }
                break;

              case 'route':
                if (event.action === 'generate_ui') {
                  isGeneratingUi = true;
                  setPhase('generating');
                  setAetherIsGenerating(true);
                  setAetherStatus('Building interface...');
                }
                break;

              case 'token':
                if (event.text && isGeneratingUi) {
                  bufferRef += event.text;
                  const html = stripToHtmlDocumentStart(stripMarkdownCodeFence(bufferRef));
                  if (html) setAetherHtml(html);
                }
                break;

              case 'done':
                isDone = true;
                if (isGeneratingUi && bufferRef) {
                  const finalHtml = stripToHtmlDocumentStart(stripMarkdownCodeFence(bufferRef));
                  if (finalHtml) {
                    setAetherHtml(finalHtml);
                    onUiReady?.(finalHtml);
                    triggerAetherPulse();
                    pushAetherMessage({ role: 'assistant', content: '[UI updated]', timestamp: Date.now() });
                  }
                }
                setAetherIsGenerating(false);
                setAetherStatus(null);
                break;

              case 'error':
                throw new Error(event.message ?? 'Voice chat error');
            }
          } catch {
            // skip malformed event
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      console.error('[VoiceAgent] Error:', err);
    } finally {
      setAetherIsGenerating(false);
    }
  }, [
    setAetherHtml, setAetherPreviousHtml, setAetherIsGenerating,
    setAetherStatus, triggerAetherPulse, pushAetherMessage, playTTS, onUiReady,
  ]);

  // ── Main cycle ────────────────────────────────────────────────────────────
  const runCycle = useCallback(async () => {
    if (!activeRef.current) return;

    setPhase('listening');
    setAgentStatus('Listening...');
    setAetherStatus('Listening...');

    const audioBlob = await recordWithSilenceDetection();
    if (!activeRef.current) return;

    if (!audioBlob) {
      if (activeRef.current) setTimeout(runCycle, 300);
      return;
    }

    setPhase('processing');
    setAgentStatus('Transcribing...');

    const text = await transcribe(audioBlob);
    if (!activeRef.current) return;

    if (!text) {
      if (activeRef.current) setTimeout(runCycle, 300);
      return;
    }

    setAgentStatus('Thinking...');
    setAetherStatus('Thinking...');

    const screenshot = await captureScreenshot?.() ?? null;
    await processVoiceChat(text, screenshot);

    // Wait for TTS
    const waitForTTS = async () => {
      const audio = currentAudioRef.current;
      if (audio && !audio.ended && !audio.paused) {
        await new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (!currentAudioRef.current || currentAudioRef.current.ended) {
              clearInterval(check); resolve();
            }
          }, 100);
        });
      }
    };
    await waitForTTS();

    if (activeRef.current) setTimeout(runCycle, 300);
  }, [recordWithSilenceDetection, transcribe, processVoiceChat, captureScreenshot, setAetherStatus]);

  // ── Public API ────────────────────────────────────────────────────────────
  const startAgent = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setIsActive(true);
    runCycle();
  }, [runCycle]);

  const stopAgent = useCallback(() => {
    activeRef.current = false;
    setIsActive(false);
    setPhase('idle');
    setAgentStatus(null);
    setAetherStatus(null);
    setAetherIsSpeaking(false);
    setAetherIsGenerating(false);

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    abortRef.current?.abort();
  }, [setAetherStatus, setAetherIsSpeaking, setAetherIsGenerating]);

  return { isActive, phase, agentStatus, startAgent, stopAgent };
}