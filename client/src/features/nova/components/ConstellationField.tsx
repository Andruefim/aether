import { useRef, useEffect, useMemo, useCallback } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface ConstellationPoint {
  id: string;
  text: string;
  type: 'main' | 'association' | 'voice';
  status: 'raw' | 'consolidated' | 'fading';
  surprise: number;      // 0–1 novelty score
  recallCount: number;   // how many times recalled
  timestamp: number;
  lastRecalled: number;
  x: number;
  y: number;
  z: number;
}

export interface TooltipState { text: string; x: number; y: number; visible: boolean }

interface Props {
  highlightIdsRef: React.MutableRefObject<Set<string>>;
  onTooltip: (state: TooltipState) => void;
}

// ── Tooltip (HTML overlay, rendered in NovaPage) ──────────────────────────
export function ConstellationTooltip({ state }: { state: TooltipState }) {
  if (!state.visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: state.x + 14,
        top:  state.y - 10,
        maxWidth: 260,
        padding: '6px 10px',
        background: 'rgba(15,10,30,0.88)',
        border: '1px solid rgba(168,85,247,0.4)',
        borderRadius: 8,
        color: '#e2d9f3',
        fontSize: 12,
        lineHeight: 1.5,
        pointerEvents: 'none',
        zIndex: 1000,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 20px rgba(168,85,247,0.2)',
      }}
    >
      {state.text}
    </div>
  );
}

// Color by memory type
const TYPE_COLOR: Record<string, THREE.Color> = {
  main:        new THREE.Color('#a855f7'),
  association: new THREE.Color('#60a5fa'),
  voice:       new THREE.Color('#fbbf24'),
};
const DEFAULT_COLOR   = new THREE.Color('#6b7280');
const HIGHLIGHT_COLOR = new THREE.Color('#c4b5fd');

// Status base brightness — surprise and recall_count scale on top of this
const STATUS_BRIGHTNESS: Record<string, number> = {
  raw:          0.45,
  consolidated: 0.85,
  fading:       0.2,
};
const STATUS_SCALE: Record<string, number> = {
  raw:          0.65,
  consolidated: 1.1,
  fading:       0.4,
};

const POLL_INTERVAL_MS = 12000;
const MAX_LINE_DIST    = 1.0;
const MAX_LINES        = 200;
const POINT_SCALE      = 1.6;
const POINT_SCALE_HI   = 2.2;
const POS_LERP_SPEED   = 0.6;
const SIZE_DIVISOR     = 180.0;

async function fetchProject(): Promise<ConstellationPoint[]> {
  try {
    const res = await fetch('/api/nova/memory/project?limit=300');
    if (!res.ok) return [];
    return (await res.json()) as ConstellationPoint[];
  } catch {
    return [];
  }
}

// ── Glow sprite texture (radial gradient baked into canvas) ────────────────
function makeGlowTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0,   'rgba(180,130,255,0.85)');
  grad.addColorStop(0.4, 'rgba(120,80,200,0.30)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ── Tooltip (HTML overlay, lives outside Canvas) ──────────────────────────
function Tooltip({ state }: { state: TooltipState }) {
  if (!state.visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        left: state.x + 14,
        top:  state.y - 10,
        maxWidth: 260,
        padding: '6px 10px',
        background: 'rgba(15,10,30,0.88)',
        border: '1px solid rgba(168,85,247,0.4)',
        borderRadius: 8,
        color: '#e2d9f3',
        fontSize: 12,
        lineHeight: 1.5,
        pointerEvents: 'none',
        zIndex: 1000,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 20px rgba(168,85,247,0.2)',
      }}
    >
      {state.text}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export function ConstellationField({ highlightIdsRef, onTooltip }: Props) {
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef  = useRef<THREE.LineSegments>(null);
  const groupRef  = useRef<THREE.Group>(null);

  const targetRef  = useRef<ConstellationPoint[]>([]);
  const currentPos = useRef<Map<string, THREE.Vector3>>(new Map());
  const needsInit  = useRef(false);

  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { camera, gl } = useThree();

  // ── Poll projection ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const pts = await fetchProject();
      if (!cancelled && pts.length > 0) {
        targetRef.current = pts;
        needsInit.current = true;
      }
      if (!cancelled) setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  // ── Init geometry ────────────────────────────────────────────────────────
  function initGeometry(pts: ConstellationPoint[]) {
    const n   = pts.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const now = Date.now();

    pts.forEach((p, i) => {
      let cur = currentPos.current.get(p.id);
      if (!cur) { cur = new THREE.Vector3(p.x, p.y, p.z); currentPos.current.set(p.id, cur); }
      pos[i * 3]     = cur.x;
      pos[i * 3 + 1] = cur.y;
      pos[i * 3 + 2] = cur.z;

      const ageSec    = (now - p.timestamp) / 1000;
      const ageFade   = Math.max(0.2, 1 - ageSec / 3600);
      const statusB   = STATUS_BRIGHTNESS[p.status] ?? 0.45;
      // keep_score mirrors server logic: surprise*0.5 + recallWeight*0.5
      const recallW   = Math.min(1, p.recallCount / 5);
      const keepScore = (p.surprise ?? 0.5) * 0.5 + recallW * 0.5;
      const brightness = ageFade * statusB * (0.5 + keepScore * 0.5);
      const base = TYPE_COLOR[p.type] ?? DEFAULT_COLOR;
      col[i * 3]     = base.r * brightness;
      col[i * 3 + 1] = base.g * brightness;
      col[i * 3 + 2] = base.b * brightness;
      const statusScale = STATUS_SCALE[p.status] ?? 0.65;
      siz[i] = POINT_SCALE * statusScale * (0.6 + keepScore * 0.8);
    });

    if (pointsRef.current) {
      const geo = pointsRef.current.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor',   new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize',    new THREE.BufferAttribute(siz, 1));
      geo.setDrawRange(0, n);
      geo.computeBoundingSphere();
    }
    rebuildLines(pts);
    rebuildGlow(pts);
  }

  // ── Line segments between nearby points ──────────────────────────────────
  function rebuildLines(pts: ConstellationPoint[]) {
    if (!linesRef.current) return;
    const verts: number[] = [];
    for (let i = 0; i < pts.length && verts.length / 6 < MAX_LINES; i++) {
      for (let j = i + 1; j < pts.length && verts.length / 6 < MAX_LINES; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dz = pts[i].z - pts[j].z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < MAX_LINE_DIST) {
          verts.push(pts[i].x, pts[i].y, pts[i].z, pts[j].x, pts[j].y, pts[j].z);
        }
      }
    }
    const geo = linesRef.current.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setDrawRange(0, verts.length / 3);
    geo.computeBoundingSphere();
  }

  // ── Nebula / glow sprites ────────────────────────────────────────────────
  // We compute cluster centroids and place a large additive sprite at each.
  const glowGroupRef = useRef<THREE.Group>(null);
  const glowTexture  = useMemo(() => makeGlowTexture(128), []);

  function rebuildGlow(pts: ConstellationPoint[]) {
    const grp = glowGroupRef.current;
    if (!grp) return;

    // Remove old sprites
    while (grp.children.length) grp.remove(grp.children[0]);

    if (pts.length < 3) return;

    // Simple clustering: group points within radius 0.8 of each other
    const visited = new Set<number>();
    const clusters: ConstellationPoint[][] = [];
    for (let i = 0; i < pts.length; i++) {
      if (visited.has(i)) continue;
      const cluster = [pts[i]];
      visited.add(i);
      for (let j = i + 1; j < pts.length; j++) {
        if (visited.has(j)) continue;
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dz = pts[i].z - pts[j].z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.8) {
          cluster.push(pts[j]);
          visited.add(j);
        }
      }
      if (cluster.length >= 2) clusters.push(cluster);
    }

    for (const cluster of clusters) {
      const cx = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
      const cy = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
      const cz = cluster.reduce((s, p) => s + p.z, 0) / cluster.length;

      const radius = Math.max(0.4, Math.sqrt(cluster.length) * 0.25);
      const mat = new THREE.SpriteMaterial({
        map: glowTexture,
        transparent: true,
        opacity: Math.min(0.55, 0.2 + cluster.length * 0.04),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(cx, cy, cz);
      sprite.scale.setScalar(radius * 2.8);
      grp.add(sprite);
    }
  }

  // ── Raycasting for tooltip ───────────────────────────────────────────────
  const raycaster  = useMemo(() => new THREE.Raycaster(), []);
  raycaster.params.Points = { threshold: 0.12 };

  const handlePointerMove = useCallback((e: MouseEvent) => {
    const pts = targetRef.current;
    if (!pts.length || !pointsRef.current) return;

    const rect   = gl.domElement.getBoundingClientRect();
    const ndc    = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  *  2 - 1,
      ((e.clientY - rect.top)  / rect.height) * -2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);

    const hits = raycaster.intersectObject(pointsRef.current);
    if (tooltipTimerRef.current) { clearTimeout(tooltipTimerRef.current); tooltipTimerRef.current = null; }

    if (hits.length > 0) {
      const idx = hits[0].index ?? 0;
      const pt  = pts[idx];
      if (pt) {
        onTooltip({ text: pt.text, x: e.clientX, y: e.clientY, visible: true });
      }
    } else {
      tooltipTimerRef.current = setTimeout(() => onTooltip({ text: '', x: 0, y: 0, visible: false }), 200);
    }
  }, [camera, gl, raycaster]);

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('mousemove', handlePointerMove);
    return () => el.removeEventListener('mousemove', handlePointerMove);
  }, [gl, handlePointerMove]);

  // ── Per-frame update ─────────────────────────────────────────────────────
  useFrame((_, delta) => {
    if (needsInit.current) {
      needsInit.current = false;
      initGeometry(targetRef.current);
    }

    const pts = targetRef.current;
    if (!pointsRef.current || pts.length === 0) return;

    const geo    = pointsRef.current.geometry;
    const posBuf = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    const colBuf = geo.getAttribute('aColor')   as THREE.BufferAttribute | undefined;
    const sizBuf = geo.getAttribute('aSize')    as THREE.BufferAttribute | undefined;
    if (!posBuf || !colBuf || !sizBuf) return;

    const ids   = highlightIdsRef.current;
    const t     = performance.now() / 1000;
    const lerpF = Math.min(1, POS_LERP_SPEED * delta);
    const now   = Date.now();

    for (let i = 0; i < pts.length; i++) {
      const p   = pts[i];
      const cur = currentPos.current.get(p.id);
      if (!cur) continue;

      cur.x += (p.x - cur.x) * lerpF;
      cur.y += (p.y - cur.y) * lerpF;
      cur.z += (p.z - cur.z) * lerpF;
      posBuf.setXYZ(i, cur.x, cur.y, cur.z);

      if (ids.has(p.id)) {
        const pulse = 0.75 + 0.25 * Math.sin(t * 4);
        colBuf.setXYZ(i, HIGHLIGHT_COLOR.r * pulse, HIGHLIGHT_COLOR.g * pulse, HIGHLIGHT_COLOR.b * pulse);
        sizBuf.setX(i, POINT_SCALE_HI);
      } else {
        const ageSec    = (now - p.timestamp) / 1000;
        const ageFade   = Math.max(0.2, 1 - ageSec / 3600);
        const statusB   = STATUS_BRIGHTNESS[p.status] ?? 0.45;
        const recallW   = Math.min(1, p.recallCount / 5);
        const keepScore = (p.surprise ?? 0.5) * 0.5 + recallW * 0.5;
        const brightness = ageFade * statusB * (0.5 + keepScore * 0.5);
        const base = TYPE_COLOR[p.type] ?? DEFAULT_COLOR;
        colBuf.setXYZ(i, base.r * brightness, base.g * brightness, base.b * brightness);
        const statusScale = STATUS_SCALE[p.status] ?? 0.65;
        sizBuf.setX(i, POINT_SCALE * statusScale * (0.6 + keepScore * 0.8));
      }
    }

    posBuf.needsUpdate = true;
    colBuf.needsUpdate = true;
    sizBuf.needsUpdate = true;
    geo.computeBoundingSphere();

    if (Math.floor(t * 60) % 120 === 0) rebuildLines(pts);

    if (groupRef.current) groupRef.current.rotation.y += delta * 0.008;
  });

  // ── Materials ─────────────────────────────────────────────────────────────
  const pointMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute vec3  aColor;
      varying   vec3  vColor;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (${SIZE_DIVISOR.toFixed(1)} / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        // Soft glow: bright core + halo
        float core  = 1.0 - smoothstep(0.0, 0.22, d);
        float halo  = 1.0 - smoothstep(0.22, 0.50, d);
        float alpha = core * 0.95 + halo * 0.35;
        gl_FragColor = vec4(vColor + core * 0.4, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: false,
  }), []);

  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: 0x6d28d9,
    transparent: true,
    opacity: 0.14,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  return (
    <group ref={groupRef}>
      {/* Nebula glow sprites */}
      <group ref={glowGroupRef} />

      {/* Star points */}
      <points ref={pointsRef} material={pointMaterial} renderOrder={0}>
        <bufferGeometry />
      </points>

      {/* Constellation lines */}
      <lineSegments ref={linesRef} material={lineMaterial} renderOrder={0}>
        <bufferGeometry />
      </lineSegments>
    </group>
  );
}
