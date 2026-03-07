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

const POLL_INTERVAL_MS = 8000; // re-fetch projection every 8s
const MAX_LINE_DIST    = 1.2;  // draw edges between points closer than this
const MAX_LINES        = 300;  // cap total line segments for perf
const POINT_SCALE      = 4.5;  // base point size in shader

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

  // Live data
  const dataRef    = useRef<ConstellationPoint[]>([]);
  const needsRebuild = useRef(false);

  // Geometry refs — rebuilt when data changes
  const posArr   = useRef<Float32Array>(new Float32Array(0));
  const colorArr = useRef<Float32Array>(new Float32Array(0));
  const sizeArr  = useRef<Float32Array>(new Float32Array(0));

  // --- Poll projection ---
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const pts = await fetchProject();
      if (!cancelled) {
        dataRef.current = pts;
        needsRebuild.current = true;
      }
      if (!cancelled) setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  // --- Rebuild geometry buffers when data changes ---
  function rebuildGeometry() {
    const pts = dataRef.current;
    const n   = pts.length;

    const pos   = new Float32Array(n * 3);
    const col   = new Float32Array(n * 3);
    const sizes = new Float32Array(n);

    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      pos[i * 3]     = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;

      // Age fade: 0.3 (old) → 1.0 (< 1 min)
      const ageSec = (now - p.timestamp) / 1000;
      const brightness = Math.max(0.3, 1 - ageSec / (60 * 30)); // fade over 30 min

      const base = TYPE_COLOR[p.type] ?? DEFAULT_COLOR;
      col[i * 3]     = base.r * brightness;
      col[i * 3 + 1] = base.g * brightness;
      col[i * 3 + 2] = base.b * brightness;

      // Size: proportional to how recent it is
      sizes[i] = POINT_SCALE * (0.5 + 0.5 * brightness);
    }

    posArr.current   = pos;
    colorArr.current = col;
    sizeArr.current  = sizes;

    if (pointsRef.current) {
      const geo = pointsRef.current.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
      geo.setAttribute('size',     new THREE.BufferAttribute(sizes, 1));
      geo.setDrawRange(0, n);
      geo.computeBoundingSphere();
    }

    // Rebuild line segments
    rebuildLines(pts);
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

  // --- Per-frame: rebuild if dirty, animate highlight ---
  useFrame((_, delta) => {
    if (needsRebuild.current) {
      needsRebuild.current = false;
      rebuildGeometry();
    }

    if (!pointsRef.current) return;
    const pts   = dataRef.current;
    const ids   = highlightIdsRef.current;
    const geo   = pointsRef.current.geometry;
    const colBuf = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
    const sizBuf = geo.getAttribute('size')  as THREE.BufferAttribute | undefined;
    if (!colBuf || !sizBuf) return;

    const t = performance.now() / 1000;
    let dirty = false;
    for (let i = 0; i < pts.length; i++) {
      const highlighted = ids.has(pts[i].id);
      const pulse = highlighted ? 0.7 + 0.3 * Math.sin(t * 4) : 0;

      if (highlighted) {
        colBuf.setXYZ(i, HIGHLIGHT_COLOR.r * (0.7 + pulse * 0.3), HIGHLIGHT_COLOR.g * (0.7 + pulse * 0.3), HIGHLIGHT_COLOR.b);
        sizBuf.setX(i, POINT_SCALE * 2.0 * (1 + pulse * 0.3));
        dirty = true;
      }
    }
    if (dirty) {
      colBuf.needsUpdate = true;
      sizBuf.needsUpdate = true;
    }

    // Slow rotation of the whole constellation
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.012;
    }
  });

  // --- Shader material for points ---
  const pointMaterial = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: /* glsl */`
      attribute float size;
      attribute vec3 color;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * (300.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alpha = 1.0 - smoothstep(0.3, 0.5, d);
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  }), []);

  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: 0x4c2d7a,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);

  const emptyGeo = useMemo(() => new THREE.BufferGeometry(), []);

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
