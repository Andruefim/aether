import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

let TroikaText: typeof import('troika-three-text').Text | null = null;
import('troika-three-text').then((m) => { TroikaText = m.Text; });

export type StreamType = 'main' | 'association' | 'voice';

export interface IncomingToken {
  text: string;
  stream: StreamType;
  color: string;
}

interface GlyphState {
  mesh: InstanceType<typeof import('troika-three-text').Text>;
  target: THREE.Vector3;
  velocity: THREE.Vector3;
  fillOpacity: number;
  phase: 'in' | 'hold' | 'out' | 'settle';
  holdTimer: number;
  stream: StreamType;
  word: string;
  // settle word order index (set when settling)
  settleIndex: number;
}

// ─── Camera: z=4.8, fov=55
// Visible half-width  at z=0 ≈ 2.55
// Visible half-height at z=0 ≈ 2.00  (16:9 viewport)
// Orb visual radius ≈ 1.05
// Safe word zone: radius 1.35 .. 2.10, clamped in XY

const MAX_GLYPHS   = 60;
const ORBIT_R      = 2.1;    // кольцо дальше от орба
const BIRTH_R      = 1.15;   // рождение у поверхности орба
const EXCL_R       = 1.62;   // мёртвая зона вокруг орба
const MAX_X        = 2.35;   // горизонтальный лимит
const MAX_Y        = 2.00;   // вертикальный лимит

const HOLD_MAIN    = 18;
const HOLD_ASSOC   = 10;
const FADE_IN      = 2.2;
const FADE_OUT     = 0.5;
const SPRING       = 0.009;
const DAMP         = 0.90;
const IMPULSE      = 0.015;

// Settle spring — slow, smooth drift toward corner
const SETTLE_SPRING = 0.003;
const SETTLE_DAMP   = 0.96;

// Delay between consecutive association word spawns (ms)
const ASSOC_STAGGER_MS = 1000;

// Top-right corner layout params (Three.js world units)
const SETTLE_START_X    =  0.55;  // leftmost edge of text block (right half of screen)
const SETTLE_START_Y    =  1.82;  // top row
const SETTLE_CHAR_W     =  0.038; // width per character (monospace-ish estimate)
const SETTLE_WORD_GAP   =  0.055; // extra gap between words
const SETTLE_ROW_H      =  0.17;  // vertical step between rows
const SETTLE_MAX_LINE_W =  1.85;  // max line width before wrap (~5-6 words per line)

const FS: Record<StreamType, number> = {
  main:        0.068,
  voice:       0.068,
  association: 0.044,
};

const SKIP = /^[\s\n.,;:!?*#\-–—]+$/;

// Flattened orbit positions — disc in XY, minimal Z spread
function orbitPos(i: number, total: number): THREE.Vector3 {
  // Golden angle spiral in XY plane
  const r     = ORBIT_R * Math.sqrt((i + 0.5) / total);
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  const z = (Math.random() - 0.5) * 0.3;

  // Clamp to safe zone
  const cx = Math.sign(x) * Math.min(Math.abs(x), MAX_X - 0.3);
  const cy = Math.sign(y) * Math.min(Math.abs(y), MAX_Y - 0.2);

  // Enforce exclusion radius
  const dist = Math.sqrt(cx * cx + cy * cy);
  if (dist < EXCL_R) {
    const scale = EXCL_R / dist;
    return new THREE.Vector3(cx * scale, cy * scale, z);
  }
  return new THREE.Vector3(cx, cy, z);
}

/**
 * Compute settled positions for all words at once,
 * flowing left-to-right with proportional spacing and wrapping.
 */
function computeSettlePositions(words: string[]): THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];
  let x = SETTLE_START_X;
  let row = 0;

  for (const word of words) {
    const wordW = word.length * SETTLE_CHAR_W;
    // Wrap to next line if word doesn't fit
    if (x + wordW > SETTLE_START_X + SETTLE_MAX_LINE_W && x > SETTLE_START_X) {
      x = SETTLE_START_X;
      row++;
    }
    // Anchor at center of word
    positions.push(new THREE.Vector3(
      x + wordW / 2,
      SETTLE_START_Y - row * SETTLE_ROW_H,
      0.05,
    ));
    x += wordW + SETTLE_WORD_GAP;
  }
  return positions;
}

interface Props {
  bucketRef: React.MutableRefObject<IncomingToken[]>;
  /** When set to a non-empty string, triggers the "settle" animation for main-stream glyphs */
  settleSignalRef: React.MutableRefObject<string>;
}

export function TokenGlyphSystem({ bucketRef, settleSignalRef }: Props) {
  const groupRef       = useRef<THREE.Group>(null!);
  const glyphs         = useRef<GlyphState[]>([]);
  // Separate word buffers per stream to avoid cross-stream token bleeding
  const wordBufMain    = useRef('');
  const wordBufAssoc   = useRef('');
  const wordBufVoice   = useRef('');
  const slotIdx        = useRef(0);
  const lastSettleText = useRef('');
  // Queue of association words waiting to be spawned with stagger
  const assocQueueRef  = useRef<{ word: string; color: string }[]>([]);
  const assocTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pre-bake positions once — stable across renders
  const positions  = useMemo(
    () => Array.from({ length: MAX_GLYPHS }, (_, i) => orbitPos(i, MAX_GLYPHS)),
    [],
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    // ── Drain bucket ──────────────────────────────────────────────────────────
    const bucket = bucketRef.current;
    if (bucket.length > 0) {
      for (const tok of bucket) {
        // Use per-stream buffer to avoid cross-stream word bleeding
        const bufRef =
          tok.stream === 'association' ? wordBufAssoc :
          tok.stream === 'main'        ? wordBufMain  :
                                         wordBufVoice;
        bufRef.current += tok.text;
        const parts = bufRef.current.split(/(\s+|\n)/);
        bufRef.current = parts.pop() ?? '';
        for (const part of parts) {
          const w = part.trim();
          if (!w || SKIP.test(w)) continue;
          if (tok.stream === 'association') {
            // Queue association words — spawn one by one with stagger
            assocQueueRef.current.push({ word: w, color: tok.color });
            scheduleAssocSpawn(group);
          } else {
            spawnGlyph(group, w, tok.stream, tok.color);
          }
        }
      }
      bucketRef.current = [];
    }

    // ── Settle trigger ────────────────────────────────────────────────────────
    const sig = settleSignalRef.current;
    if (sig && sig !== lastSettleText.current) {
      lastSettleText.current = sig;
      triggerSettle(sig);
    }

    // ── Physics + fade ────────────────────────────────────────────────────────
    const dt = Math.min(delta, 0.05) * 60;

    for (let i = glyphs.current.length - 1; i >= 0; i--) {
      const g = glyphs.current[i];

      if (g.phase === 'settle') {
        // Slow spring toward settle target
        g.velocity.x += (g.target.x - g.mesh.position.x) * SETTLE_SPRING;
        g.velocity.y += (g.target.y - g.mesh.position.y) * SETTLE_SPRING;
        g.velocity.z += (g.target.z - g.mesh.position.z) * SETTLE_SPRING;
        g.velocity.multiplyScalar(SETTLE_DAMP);
      } else {
        // Spring toward orbit target
        g.velocity.x += (g.target.x - g.mesh.position.x) * SPRING;
        g.velocity.y += (g.target.y - g.mesh.position.y) * SPRING;
        g.velocity.z += (g.target.z - g.mesh.position.z) * SPRING;
        g.velocity.multiplyScalar(DAMP);
      }

      g.mesh.position.x += g.velocity.x * dt;
      g.mesh.position.y += g.velocity.y * dt;
      g.mesh.position.z += g.velocity.z * dt;

      g.mesh.lookAt(0, 0, 12);

      // Opacity
      if (g.phase === 'in') {
        g.fillOpacity = Math.min(1, g.fillOpacity + FADE_IN * delta);
        if (g.fillOpacity >= 1) {
          g.phase = 'hold';
          g.holdTimer = g.stream === 'association' ? HOLD_ASSOC : HOLD_MAIN;
        }
      } else if (g.phase === 'hold') {
        g.holdTimer -= delta;
        if (g.holdTimer <= 0) g.phase = 'out';
      } else if (g.phase === 'settle') {
        // Fade in if not yet visible, then hold indefinitely
        g.fillOpacity = Math.min(1, g.fillOpacity + FADE_IN * delta);
      } else {
        g.fillOpacity = Math.max(0, g.fillOpacity - FADE_OUT * delta);
        if (g.fillOpacity <= 0) {
          group.remove(g.mesh);
          g.mesh.dispose();
          glyphs.current.splice(i, 1);
          continue;
        }
      }

      g.mesh.fillOpacity    = g.fillOpacity;
      g.mesh.outlineOpacity = g.fillOpacity * 0.85;
    }
  });

  /**
   * Triggered once when settleSignalRef changes.
   * Assigns ordered settle targets to main-stream glyphs based on word order in the response.
   * Non-main-stream glyphs are faded out.
   */
  function triggerSettle(fullText: string) {
    // Words in the full response (in order)
    const words = fullText
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 1 && !SKIP.test(w));

    const wordQueue = [...words];
    const mainGlyphs = glyphs.current.filter(
      (g) => g.stream === 'main' || g.stream === 'voice',
    );

    // Compute proportional positions for all words at once
    const settlePositions = computeSettlePositions(wordQueue);

    // Match glyphs to words by their text (greedy, in order)
    // Each word starts flying with a stagger delay so they arrive one by one
    const SETTLE_STAGGER_MS = 120;
    let settleIdx = 0;
    for (const word of wordQueue) {
      const match = mainGlyphs.find(
        (g) => g.word === word && g.settleIndex === -1 && g.phase !== 'out',
      );
      if (match) {
        const idx = settleIdx;
        const target = settlePositions[idx];
        // Stagger: delay each word before switching its target
        setTimeout(() => {
          match.phase       = 'settle';
          match.settleIndex = idx;
          match.target      = target;
          match.mesh.fontSize = 0.062;
          match.mesh.color    = '#e8d8ff';
        }, idx * SETTLE_STAGGER_MS);
        settleIdx++;
      }
    }

    // Fade out any main-stream glyphs that didn't match (duplicates, punctuation remnants)
    for (const g of mainGlyphs) {
      if (g.settleIndex === -1 && g.phase !== 'out') {
        g.phase = 'out';
      }
    }

    // Fade out all association glyphs
    for (const g of glyphs.current) {
      if (g.stream === 'association' && g.phase !== 'out') {
        g.phase = 'out';
      }
    }
  }

  function scheduleAssocSpawn(group: THREE.Group) {
    if (assocTimerRef.current !== null) return; // already ticking
    function spawnNext() {
      const item = assocQueueRef.current.shift();
      if (!item) { assocTimerRef.current = null; return; }
      spawnGlyph(group, item.word, 'association', item.color);
      assocTimerRef.current = setTimeout(spawnNext, ASSOC_STAGGER_MS);
    }
    assocTimerRef.current = setTimeout(spawnNext, 0);
  }

  function spawnGlyph(group: THREE.Group, text: string, stream: StreamType, color: string) {
    if (!TroikaText) return;

    if (glyphs.current.length >= MAX_GLYPHS) {
      const oldest = glyphs.current[0];
      if (oldest) oldest.phase = 'out';
    }

    const mesh     = new TroikaText();
    mesh.text      = text;
    mesh.fontSize  = FS[stream];
    mesh.color     = color;
    mesh.fillOpacity  = 0;
    mesh.anchorX   = 'center';
    mesh.anchorY   = 'middle';
    mesh.maxWidth  = 1.1;

    // Dark outline for readability on all backgrounds
    mesh.outlineWidth   = '10%';
    mesh.outlineColor   = '#060010';
    mesh.outlineOpacity = 0;

    mesh.depthOffset  = -1;
    mesh.renderOrder  = 100;

    // Birth: random XY direction, always positive Z (toward camera)
    const angle = Math.random() * Math.PI * 2;
    const dir = new THREE.Vector3(
      Math.cos(angle),
      Math.sin(angle),
      0.5 + Math.random() * 0.3,
    ).normalize();

    mesh.position.copy(dir.clone().multiplyScalar(BIRTH_R + Math.random() * 0.1));

    const vel = dir.clone().multiplyScalar(IMPULSE + Math.random() * 0.008);

    const slot   = slotIdx.current % MAX_GLYPHS;
    slotIdx.current++;
    const target = positions[slot].clone();

    mesh.sync();
    group.add(mesh);

    glyphs.current.push({
      mesh, target, velocity: vel,
      fillOpacity: 0, phase: 'in', holdTimer: 0, stream,
      word: text, settleIndex: -1,
    });
  }

  useEffect(() => {
    return () => {
      if (assocTimerRef.current !== null) {
        clearTimeout(assocTimerRef.current);
        assocTimerRef.current = null;
      }
      assocQueueRef.current = [];
      glyphs.current.forEach((g) => {
        groupRef.current?.remove(g.mesh);
        g.mesh.dispose();
      });
      glyphs.current = [];
    };
  }, []);

  return <group ref={groupRef} />;
}
