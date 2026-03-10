import { useEffect, useRef, useState } from 'react';

interface NovaMsg {
  id: string;
  text: string;
  phase: 'speech' | 'question';
  awaitsReply: boolean;
  ts: number;
  dismissed: boolean;
}

interface Props {
  onReply: (text: string) => void;
  hasPendingQuestion: boolean;
}

/**
 * NovaMessage
 * ────────────
 * Displays messages Nova sends proactively to the user.
 * Appears as a floating card below/above the orb.
 *
 * phase='speech'   → Nova sharing something (may or may not await reply)
 * phase='question' → Nova explicitly asking the user something
 *
 * The component listens to /api/nova/thoughts SSE for relevant events.
 */
export function NovaMessage({ onReply, hasPendingQuestion }: Props) {
  const [messages, setMessages] = useState<NovaMsg[]>([]);
  const [replyText, setReplyText] = useState('');
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── SSE listener ────────────────────────────────────────────────────────────
  // Note: NovaPage already has a thought SSE connection — in production,
  // pass thought events down as props instead of opening a second connection.
  // For simplicity this component opens its own SSE.

  useEffect(() => {
    const es = new EventSource('/api/nova/thoughts');

    es.onmessage = (evt) => {
      try {
        const event = JSON.parse(evt.data as string) as {
          phase: string;
          text: string;
          messageId?: string;
          awaitsReply?: boolean;
          ts: number;
        };

        if (event.phase !== 'speech' && event.phase !== 'question') return;
        if (!event.text?.trim()) return;

        const msg: NovaMsg = {
          id:          event.messageId ?? crypto.randomUUID(),
          text:        event.text,
          phase:       event.phase as 'speech' | 'question',
          awaitsReply: event.awaitsReply ?? event.phase === 'question',
          ts:          event.ts,
          dismissed:   false,
        };

        setMessages((prev) => {
          // Keep last 3 visible
          const next = [...prev, msg].slice(-3);
          return next;
        });

        if (msg.awaitsReply) {
          setActiveReplyId(msg.id);
          setTimeout(() => inputRef.current?.focus(), 100);
        }
      } catch { /* skip */ }
    };

    return () => es.close();
  }, []);

  // ── Send reply ───────────────────────────────────────────────────────────────

  const sendReply = () => {
    if (!replyText.trim()) return;
    onReply(replyText.trim());
    setReplyText('');
    setActiveReplyId(null);
    // Dismiss the question that was answered
    setMessages((prev) => prev.map((m) => m.id === activeReplyId ? { ...m, dismissed: true } : m));
  };

  const dismiss = (id: string) => {
    setMessages((prev) => prev.map((m) => m.id === id ? { ...m, dismissed: true } : m));
    if (activeReplyId === id) setActiveReplyId(null);
  };

  const visible = messages.filter((m) => !m.dismissed);
  if (visible.length === 0) return null;

  return (
    <div style={{
      position:      'absolute',
      bottom:        '110px',
      left:          '50%',
      transform:     'translateX(-50%)',
      width:         'min(520px, 90vw)',
      display:       'flex',
      flexDirection: 'column',
      gap:           '10px',
      zIndex:        50,
      pointerEvents: 'auto',
    }}>
      {visible.map((msg) => (
        <div
          key={msg.id}
          style={{
            background:      'rgba(20, 10, 40, 0.82)',
            backdropFilter:  'blur(20px)',
            border:          `1px solid ${msg.phase === 'question' ? 'rgba(251,191,36,0.4)' : 'rgba(192,132,252,0.35)'}`,
            borderRadius:    '16px',
            padding:         '16px 20px',
            color:           'rgba(255,255,255,0.92)',
            fontSize:        '14px',
            lineHeight:      '1.6',
            animation:       'novaMessageIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
            boxShadow:       msg.phase === 'question'
              ? '0 0 24px rgba(251,191,36,0.15)'
              : '0 0 24px rgba(168,85,247,0.15)',
          }}
        >
          {/* Header */}
          <div style={{
            display:        'flex',
            alignItems:     'center',
            gap:            '8px',
            marginBottom:   '8px',
          }}>
            <div style={{
              width:           '6px',
              height:          '6px',
              borderRadius:    '50%',
              background:      msg.phase === 'question' ? '#fbbf24' : '#c084fc',
              boxShadow:       msg.phase === 'question'
                ? '0 0 8px #fbbf24'
                : '0 0 8px #c084fc',
              flexShrink:      0,
              animation:       'pulse 2s infinite',
            }} />
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em' }}>
              {msg.phase === 'question' ? 'NOVA ASKS' : 'NOVA'}
            </span>
            <button
              onClick={() => dismiss(msg.id)}
              style={{
                marginLeft:      'auto',
                background:      'none',
                border:          'none',
                color:           'rgba(255,255,255,0.25)',
                cursor:          'pointer',
                fontSize:        '16px',
                lineHeight:      1,
                padding:         '0 2px',
              }}
            >×</button>
          </div>

          {/* Message text */}
          <p style={{ margin: 0, fontStyle: msg.phase === 'speech' ? 'italic' : 'normal' }}>
            {msg.text}
          </p>

          {/* Reply input — only shown for the active question */}
          {msg.awaitsReply && activeReplyId === msg.id && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
              <input
                ref={inputRef}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendReply()}
                placeholder="Reply to Nova..."
                style={{
                  flex:            1,
                  background:      'rgba(255,255,255,0.07)',
                  border:          '1px solid rgba(255,255,255,0.2)',
                  borderRadius:    '10px',
                  padding:         '8px 14px',
                  color:           'white',
                  fontSize:        '13px',
                  outline:         'none',
                }}
              />
              <button
                onClick={sendReply}
                disabled={!replyText.trim()}
                style={{
                  background:   replyText.trim() ? 'rgba(192,132,252,0.3)' : 'rgba(255,255,255,0.05)',
                  border:       '1px solid rgba(192,132,252,0.4)',
                  borderRadius: '10px',
                  color:        replyText.trim() ? '#c084fc' : 'rgba(255,255,255,0.2)',
                  padding:      '8px 16px',
                  cursor:       replyText.trim() ? 'pointer' : 'default',
                  fontSize:     '13px',
                  transition:   'all 0.2s',
                }}
              >
                Send
              </button>
            </div>
          )}
        </div>
      ))}

      <style>{`
        @keyframes novaMessageIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>
    </div>
  );
}