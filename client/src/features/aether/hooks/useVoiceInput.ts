import { useCallback, useRef, useState } from 'react';
import { useAetherStore } from '../../../core';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'error';

interface UseVoiceInputReturn {
  voiceState: VoiceState;
  startListening: () => Promise<void>;
  stopListening: () => void;
  error: string | null;
}

/**
 * Records audio from the microphone and transcribes it via the Voice FastAPI service.
 * On successful transcription, calls `onTranscript(text)`.
 *
 * Falls back to Web Speech API if the server is unavailable.
 */
export function useVoiceInput(onTranscript: (text: string) => void): UseVoiceInputReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const setAetherIsListening = useAetherStore((s) => s.setAetherIsListening);
  const setAetherStatus = useAetherStore((s) => s.setAetherStatus);

  const startListening = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunksRef.current = [];

      // Pick a supported MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/ogg';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach((t) => t.stop());

        setVoiceState('processing');
        setAetherStatus('Transcribing...');

        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        try {
          const transcript = await transcribeAudio(audioBlob, mimeType);
          if (transcript) {
            onTranscript(transcript);
          } else {
            setError('No speech detected');
          }
        } catch (err) {
          // Fallback: try Web Speech API
          const fallback = await tryWebSpeechFallback();
          if (fallback) {
            onTranscript(fallback);
          } else {
            setError(err instanceof Error ? err.message : 'Transcription failed');
            setVoiceState('error');
          }
        } finally {
          setVoiceState('idle');
          setAetherIsListening(false);
          setAetherStatus(null);
        }
      };

      recorder.start(250); // collect in 250ms chunks
      setVoiceState('listening');
      setAetherIsListening(true);
      setAetherStatus('Listening...');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access denied');
      setVoiceState('error');
    }
  }, [onTranscript, setAetherIsListening, setAetherStatus]);

  const stopListening = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    setVoiceState('idle');
  }, []);

  return { voiceState, startListening, stopListening, error };
}

async function transcribeAudio(blob: Blob, mimeType: string): Promise<string | null> {
  const form = new FormData();
  form.append('audio', blob, 'recording.webm');

  const res = await fetch('/api/aether/transcribe', {
    method: 'POST',
    body: form,
  });

  if (!res.ok) throw new Error(`Server transcription failed: ${res.statusText}`);
  const data = (await res.json()) as { text: string };
  return data.text?.trim() || null;
}

function tryWebSpeechFallback(): Promise<string | null> {
  return new Promise((resolve) => {
    const SpeechRecognition =
      (window as typeof window & { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition })
        .SpeechRecognition ??
      (window as typeof window & { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) { resolve(null); return; }

    const recognition = new SpeechRecognition();
    recognition.lang = 'ru-RU';
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      resolve(e.results[0]?.[0]?.transcript ?? null);
    };
    recognition.onerror = () => resolve(null);
    recognition.start();

    setTimeout(() => { try { recognition.stop(); } catch { /* ignore */ } resolve(null); }, 5000);
  });
}
