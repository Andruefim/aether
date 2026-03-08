import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import { ExperimentResult } from './types';

// ─── Molecule 3D ─────────────────────────────────────────────────────────────
// Expected visData: { atoms: [{x,y,z,element,radius?}], bonds: [[i,j],...] }

function Molecule3D({ data }: { data: Record<string, unknown> }) {
  const atoms  = (data['atoms']  as Array<{ x: number; y: number; z: number; element?: string; radius?: number }>) ?? [];
  const bonds  = (data['bonds']  as Array<[number, number]>) ?? [];

  const ELEMENT_COLORS: Record<string, string> = {
    C: '#aaaaaa', N: '#4477ff', O: '#ff4444', H: '#ffffff',
    S: '#ffcc00', P: '#ff8800', F: '#00ff88', CL: '#00dd44',
    default: '#cc88ff',
  };

  return (
    <group>
      {atoms.map((a, i) => {
        const color = ELEMENT_COLORS[(a.element ?? '').toUpperCase()] ?? ELEMENT_COLORS['default'];
        return (
          <mesh key={i} position={[a.x, a.y, a.z]}>
            <sphereGeometry args={[a.radius ?? 0.3, 16, 16]} />
            <meshStandardMaterial color={color} roughness={0.3} metalness={0.1} />
          </mesh>
        );
      })}
      {bonds.map(([i, j], k) => {
        if (!atoms[i] || !atoms[j]) return null;
        const a  = new THREE.Vector3(atoms[i].x, atoms[i].y, atoms[i].z);
        const b  = new THREE.Vector3(atoms[j].x, atoms[j].y, atoms[j].z);
        const mid   = a.clone().add(b).multiplyScalar(0.5);
        const dir   = b.clone().sub(a);
        const len   = dir.length();
        const up    = new THREE.Vector3(0, 1, 0);
        const quat  = new THREE.Quaternion().setFromUnitVectors(up, dir.normalize());
        return (
          <mesh key={`b${k}`} position={mid.toArray()} quaternion={quat}>
            <cylinderGeometry args={[0.06, 0.06, len, 8]} />
            <meshStandardMaterial color="#888888" roughness={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Graph 3D (force-directed style) ─────────────────────────────────────────
// Expected visData: { nodes: [{id,label,x?,y?,z?,group?}], edges: [{source,target}] }

function Graph3D({ data }: { data: Record<string, unknown> }) {
  const nodes  = (data['nodes'] as Array<{ id: string; label?: string; x?: number; y?: number; z?: number; group?: number }>) ?? [];
  const edges  = (data['edges'] as Array<{ source: string; target: string }>) ?? [];
  const nodeMap = useMemo(() => new Map(nodes.map((n, i) => [n.id, i])), [nodes]);

  const GROUP_COLORS = ['#a78bfa', '#34d399', '#60a5fa', '#f59e0b', '#f87171'];

  return (
    <group>
      {nodes.map((n, i) => {
        const x = n.x ?? (Math.cos(i / nodes.length * Math.PI * 2) * 2.5);
        const y = n.y ?? (Math.sin(i / nodes.length * Math.PI * 2) * 2.5);
        const z = n.z ?? (((i % 3) - 1) * 1.2);
        const color = GROUP_COLORS[(n.group ?? 0) % GROUP_COLORS.length];
        return (
          <group key={n.id} position={[x, y, z]}>
            <mesh>
              <sphereGeometry args={[0.18, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
            </mesh>
            {n.label && (
              <Text position={[0, 0.28, 0]} fontSize={0.12} color="#e5e7eb" anchorX="center">
                {n.label.slice(0, 12)}
              </Text>
            )}
          </group>
        );
      })}
      {edges.map((e, k) => {
        const si = nodeMap.get(String(e.source));
        const ti = nodeMap.get(String(e.target));
        if (si == null || ti == null) return null;
        const sn = nodes[si], tn = nodes[ti];
        const sx = sn.x ?? (Math.cos(si / nodes.length * Math.PI * 2) * 2.5);
        const sy = sn.y ?? (Math.sin(si / nodes.length * Math.PI * 2) * 2.5);
        const sz = sn.z ?? (((si % 3) - 1) * 1.2);
        const tx = tn.x ?? (Math.cos(ti / nodes.length * Math.PI * 2) * 2.5);
        const ty = tn.y ?? (Math.sin(ti / nodes.length * Math.PI * 2) * 2.5);
        const tz = tn.z ?? (((ti % 3) - 1) * 1.2);
        const a  = new THREE.Vector3(sx, sy, sz);
        const b  = new THREE.Vector3(tx, ty, tz);
        const mid  = a.clone().add(b).multiplyScalar(0.5);
        const dir  = b.clone().sub(a);
        const len  = dir.length();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        return (
          <mesh key={`e${k}`} position={mid.toArray()} quaternion={quat}>
            <cylinderGeometry args={[0.02, 0.02, len, 6]} />
            <meshStandardMaterial color="#4b5563" transparent opacity={0.5} />
          </mesh>
        );
      })}
    </group>
  );
}

// ─── Scatter 3D ───────────────────────────────────────────────────────────────
// Expected visData: { points: [[x,y,z,label?,group?],...] }

function Scatter3D({ data }: { data: Record<string, unknown> }) {
  const points = (data['points'] as Array<[number, number, number, string?, number?]>) ?? [];
  const GROUP_COLORS = ['#a78bfa', '#34d399', '#60a5fa', '#f59e0b', '#f87171'];

  return (
    <group>
      {points.map((p, i) => {
        const [x, y, z, label, group] = p;
        const color = GROUP_COLORS[(group ?? 0) % GROUP_COLORS.length];
        return (
          <group key={i} position={[x ?? 0, y ?? 0, z ?? 0]}>
            <mesh>
              <sphereGeometry args={[0.08, 8, 8]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
            </mesh>
            {label && (
              <Text position={[0, 0.15, 0]} fontSize={0.09} color="#9ca3af" anchorX="center">
                {label.slice(0, 10)}
              </Text>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ─── Idle animation ───────────────────────────────────────────────────────────

function IdleOrb() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.y += dt * 0.3;
      ref.current.rotation.x += dt * 0.1;
    }
  });
  return (
    <mesh ref={ref}>
      <icosahedronGeometry args={[1.2, 2]} />
      <meshStandardMaterial color="#4c1d95" wireframe emissive="#7c3aed" emissiveIntensity={0.5} />
    </mesh>
  );
}

// ─── Main scene ──────────────────────────────────────────────────────────────

interface LabSceneProps {
  result: ExperimentResult | null;
}

export function LabScene({ result }: LabSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (groupRef.current && result) {
      groupRef.current.rotation.y += dt * 0.05;
    }
  });

  const renderVis = () => {
    if (!result || !result.success) return <IdleOrb />;
    const data = result.visData ?? {};
    switch (result.visualization) {
      case 'molecule3d': return <Molecule3D data={data} />;
      case 'graph3d':    return <Graph3D data={data} />;
      case 'scatter3d':  return <Scatter3D data={data} />;
      default:           return <IdleOrb />;
    }
  };

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={1.2} color="#c084fc" />
      <pointLight position={[-5, -3, -5]} intensity={0.6} color="#60a5fa" />

      <group ref={groupRef}>
        {renderVis()}
      </group>

      <OrbitControls makeDefault enablePan dampingFactor={0.1} enableDamping />

      {/* Grid floor */}
      <gridHelper args={[20, 20, '#1e1b4b', '#1e1b4b']} position={[0, -3, 0]} />
    </>
  );
}
