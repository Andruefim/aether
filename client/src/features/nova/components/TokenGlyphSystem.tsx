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
  phase: 'in' | 'hold' | 'out';
  holdTimer: number;
  stream: StreamType;
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

interface Props {
  bucketRef: React.MutableRefObject<IncomingToken[]>;
}

export function TokenGlyphSystem({ bucketRef }: Props) {
  const groupRef   = useRef<THREE.Group>(null!);
  const glyphs     = useRef<GlyphState[]>([]);
  const wordBuf    = useRef('');
  const slotIdx    = useRef(0);
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
        wordBuf.current += tok.text;
        const parts = wordBuf.current.split(/(\s+|\n)/);
        wordBuf.current = parts.pop() ?? '';
        for (const part of parts) {
          const w = part.trim();
          if (w && !SKIP.test(w)) spawnGlyph(group, w, tok.stream, tok.color);
        }
      }
      bucketRef.current = [];
    }

    // ── Physics + fade ────────────────────────────────────────────────────────
    const dt = Math.min(delta, 0.05) * 60;

    for (let i = glyphs.current.length - 1; i >= 0; i--) {
      const g = glyphs.current[i];

      // Spring toward target
      g.velocity.x += (g.target.x - g.mesh.position.x) * SPRING;
      g.velocity.y += (g.target.y - g.mesh.position.y) * SPRING;
      g.velocity.z += (g.target.z - g.mesh.position.z) * SPRING;
      g.velocity.multiplyScalar(DAMP);

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

  function spawnGlyph(group: THREE.Group, text: string, stream: StreamType, color: string) {
    if (!TroikaText) return;

    if (glyphs.current.length >= MAX_GLYPHS) {
      const oldest = glyphs.current[0];
      if (oldest) oldest.phase = 'out';
    }

    const mesh     = new TroikaText();
    mesh.text      = text;
    mesh.fontSize  = FS[stream];
    mesh.color     = color;        // violet/blue/amber from stream
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
    });
  }

  useEffect(() => {
    return () => {
      glyphs.current.forEach((g) => {
        groupRef.current?.remove(g.mesh);
        g.mesh.dispose();
      });
      glyphs.current = [];
    };
  }, []);

  return <group ref={groupRef} />;
}