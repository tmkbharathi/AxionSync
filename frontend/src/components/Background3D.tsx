"use client";

import { useRef, useMemo, useEffect, memo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

// Animated Particle Background using Three.js (Memoized to prevent unnecessary re-renders)
const StarBackground = memo(function StarBackground({ isStatic, ...props }: any) {
  const groupRef = useRef<any>(null);
  const pointsRef = useRef<any>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const timeRef = useRef(0);

  useEffect(() => {
    if (isStatic) return;
    const handlePointerMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  const sphere = useMemo(() => {
    // Generate 5000 random points within a sphere of radius 1.2
    const positions = new Float32Array(5000 * 3);
    for (let i = 0; i < 5000; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = Math.cbrt(Math.random()) * 1.2;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta); // x
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta); // y
      positions[i * 3 + 2] = r * Math.cos(phi); // z
    }
    return positions;
  }, []);

  useFrame((state, delta) => {
    if (isStatic) return; // Disable all movement for static mode
    if (typeof document !== "undefined" && document.hidden) return;

    timeRef.current += delta;

    if (groupRef.current) {
      groupRef.current.rotation.x -= delta / 15;
      groupRef.current.rotation.y -= delta / 20;
    }

    if (pointsRef.current) {
      const targetRotX = pointer.current.y * 0.4;
      const targetRotY = pointer.current.x * 0.4;

      const targetPosX = pointer.current.x * 0.1;
      const targetPosY = pointer.current.y * 0.1;

      pointsRef.current.rotation.x += (targetRotX - pointsRef.current.rotation.x) * 0.05;
      pointsRef.current.rotation.y += (targetRotY - pointsRef.current.rotation.y) * 0.05;

      pointsRef.current.position.x += (targetPosX - pointsRef.current.position.x) * 0.03;
      pointsRef.current.position.y += (targetPosY - pointsRef.current.position.y) * 0.03;

      pointsRef.current.position.z = Math.sin(timeRef.current * 0.5) * 0.02;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, 0, Math.PI / 4]}>
      <Points ref={pointsRef} positions={sphere} stride={3} frustumCulled {...props}>
        <PointMaterial
          transparent
          color="#22d3ee"
          size={isStatic ? 0.0015 : 0.002} // Slightly smaller stars for cleaner static look
          sizeAttenuation={true}
          depthWrite={false}
        />
      </Points>
    </group>
  );
});

// Memoized 3D Scene Wrapper to isolate rendering from UI state changes
export const Background3D = memo(function Background3D({ isStatic = false }: { isStatic?: boolean }) {
  return (
    <div className="fixed inset-0 pointer-events-none">
      <Canvas
        camera={{ position: [0, 0, 1] }}
        dpr={[1, 2]}
        gl={{ 
          antialias: false, 
          powerPreference: "high-performance",
          alpha: true,
          stencil: false,
          depth: false
        }}
        onCreated={({ gl }) => {
           gl.setClearColor(0x020617, 1);
        }}
      >
        <StarBackground isStatic={isStatic} />
      </Canvas>
    </div>
  );
});
