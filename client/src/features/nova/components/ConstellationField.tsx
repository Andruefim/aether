import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export interface ConstellationPoint {
  id: string;
  text: string;
  type: 'main' | 'association' | 'voice';
  timestamp: number;
  x: number;
  y: number;
  z: number;
}

interface Props {
  /** Ref to array of highlighted point IDs (nearest neighbors of current query) */
  highlightIdsRef: React.MutableRefObject<Set<string>>;
}

// Color per memory type
const TYPE_COLOR: Record<string, THREE.Color> = {
  main:        new THREE.Color('#a855f7'),
  association: new THREE.Color('#60a5fa'),
  voice:       new THREE.Color('#fbbf24'),
};
const DEFAULT_COLOR = new THREE.Color('#6b7280');
const HIGHLIGHT_COLOR = new THREE.Color('#ffffff');

const POLL_INTERVAL_MS = 12000; // re-fetch projection every 12s
const MAX_LINE_DIST    = 1.0;   // draw edges between points closer than this
const MAX_LINES        = 200;   // cap total line segments for perf
const POINT_SCALE      = 1.8;   // base point size in shader (small stars)
const POS_LERP_SPEED   = 0.6;   // lerp speed for smooth repositioning after poll

async function fetchProject(): Promise<ConstellationPoint[]> {
  try {
    const res = await fetch('/api/nova/memory/project?limit=300');
    if (!res.ok) return [];
    return (await res.json()) as ConstellationPoint[];
  } catch {
    return [];
  }
}

export function ConstellationField({ highlightIdsRef }: Props) {
  const pointsRef  = useRef<THREE.Points>(null);
  const linesRef   = useRef<THREE.LineSegments>(null);
  const groupRef   = useRef<THREE.Group>(null);

  // Target data from server
  const targetRef  = useRef<ConstellationPoint[]>([]);
  // Current interpolated positions per id
  const currentPos = useRef<Map<string, THREE.Vector3>>(new Map());
  const needsInit  = useRef(false);

  // --- Poll projection ---
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

  // --- Initialise geometry when new data arrives (first time or count changed) ---
  function initGeometry(pts: ConstellationPoint[]) {
    const n   = pts.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const siz = new Float32Array(n);
    const now = Date.now();

    // For new points start at target; existing ones keep current lerp pos
    pts.forEach((p, i) => {
      let cur = currentPos.current.get(p.id);
      if (!cur) {
        cur = new THREE.Vector3(p.x, p.y, p.z);
        currentPos.current.set(p.id, cur);
      }
      pos[i * 3]     = cur.x;
      pos[i * 3 + 1] = cur.y;
      pos[i * 3 + 2] = cur.z;

      const ageSec    = (now - p.timestamp) / 1000;
      const brightness = Math.max(0.25, 1 - ageSec / (60 * 60)); // fade over 60 min
      const base = TYPE_COLOR[p.type] ?? DEFAULT_COLOR;
      col[i * 3]     = base.r * brightness;
      col[i * 3 + 1] = base.g * brightness;
      col[i * 3 + 2] = base.b * brightness;
      siz[i] = POINT_SCALE * (0.6 + 0.4 * brightness);
    });

    if (pointsRef.current) {
      const geo = pointsRef.current.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor',   new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize',    new THREE.BufferAttribute(siz, 1));
      geo.setDrawRange(0, n);
      geo.computeBoundingSphere();
    }
  }

  function rebuildLines(pts: ConstellationPoint[]) {
    if (!linesRef.current) return;
    const lineVerts: number[] = [];

    for (let i = 0; i < pts.length && lineVerts.length / 6 < MAX_LINES; i++) {
      for (let j = i + 1; j < pts.length && lineVerts.length / 6 < MAX_LINES; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dz = pts[i].z - pts[j].z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < MAX_LINE_DIST) {
          lineVerts.push(pts[i].x, pts[i].y, pts[i].z);
          lineVerts.push(pts[j].x, pts[j].y, pts[j].z);
        }
      }
    }

    const geo = linesRef.current.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineVerts), 3));
    geo.setDrawRange(0, lineVerts.length / 3);
    geo.computeBoundingSphere();
  }

  // --- Per-frame: lerp positions toward targets, animate highlights ---
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

    const ids = highlightIdsRef.current;
    const t   = performance.now() / 1000;
    const lerpF = Math.min(1, POS_LERP_SPEED * delta);
    let posDirty = false;
    let colDirty = false;

    const now = Date.now();
    for (let i = 0; i < pts.length; i++) {
      const p   = pts[i];
      const cur = currentPos.current.get(p.id);
      if (!cur) continue;

      // Lerp toward target
      cur.x += (p.x - cur.x) * lerpF;
      cur.y += (p.y - cur.y) * lerpF;
      cur.z += (p.z - cur.z) * lerpF;
      posBuf.setXYZ(i, cur.x, cur.y, cur.z);
      posDirty = true;

      // Highlight pulse
      const highlighted = ids.has(p.id);
      if (highlighted) {
        const pulse = 0.7 + 0.3 * Math.sin(t * 4);
        colBuf.setXYZ(i, HIGHLIGHT_COLOR.r * pulse, HIGHLIGHT_COLOR.g * pulse, HIGHLIGHT_COLOR.b);
        sizBuf.setX(i, POINT_SCALE * 2.5);
        colDirty = true;
      } else {
        const ageSec    = (now - p.timestamp) / 1000;
        const brightness = Math.max(0.25, 1 - ageSec / (60 * 60));
        const base = TYPE_COLOR[p.type] ?? DEFAULT_COLOR;
        colBuf.setXYZ(i, base.r * brightness, base.g * brightness, base.b * brightness);
        sizBuf.setX(i, POINT_SCALE * (0.6 + 0.4 * brightness));
        colDirty = true;
      }
    }

    if (posDirty) { posBuf.needsUpdate = true; geo.computeBoundingSphere(); }
    if (colDirty) { colBuf.needsUpdate = true; sizBuf.needsUpdate = true; }

    // Rebuild lines periodically when positions settle (simple: every 120 frames)
    if (Math.floor(t * 60) % 120 === 0) rebuildLines(pts);

    // Slow rotation
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.008;
    }
  });

  // --- Shader material for points ---
  // Note: vertexColors must be false when using custom color/size attributes
  // to avoid Three.js injecting a conflicting built-in `color` attribute.
  const pointMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute vec3  aColor;
      varying   vec3  vColor;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (300.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        if (d > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.3, 0.5, d);
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: false,
  }), []);

  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: 0x4c2d7a,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  return (
    <group ref={groupRef}>
      <points ref={pointsRef} material={pointMaterial} renderOrder={0}>
        <bufferGeometry />
      </points>
      <lineSegments ref={linesRef} material={lineMaterial} renderOrder={0}>
        <bufferGeometry />
      </lineSegments>
    </group>
  );
}
