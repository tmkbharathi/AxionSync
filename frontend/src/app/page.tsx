"use client";

import { motion } from "framer-motion";
import { Copy, ArrowRight, Cloud, Shield, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { useState, useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import { siteConfig } from "@/config/site";

// Animated Particle Background using Three.js
function StarBackground(props: any) {
  const groupRef = useRef<any>(null);
  const pointsRef = useRef<any>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
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
    // 1. Continuous slow drift
    if (groupRef.current) {
      groupRef.current.rotation.x -= delta / 15;
      groupRef.current.rotation.y -= delta / 20;
    }
    
    // 2. Interactive parallax and sway
    if (pointsRef.current) {
      // Target rotation (sway)
      const targetRotX = pointer.current.y * 0.4;
      const targetRotY = pointer.current.x * 0.4;
      
      // Target position (parallax shift)
      const targetPosX = pointer.current.x * 0.1;
      const targetPosY = pointer.current.y * 0.1;
      
      // Smooth interpolation for rotation
      pointsRef.current.rotation.x += (targetRotX - pointsRef.current.rotation.x) * 0.05;
      pointsRef.current.rotation.y += (targetRotY - pointsRef.current.rotation.y) * 0.05;
      
      // Smooth interpolation for position (adds depth)
      pointsRef.current.position.x += (targetPosX - pointsRef.current.position.x) * 0.03;
      pointsRef.current.position.y += (targetPosY - pointsRef.current.position.y) * 0.03;
      
      // Subtle float oscillation
      pointsRef.current.position.z = Math.sin(state.clock.elapsedTime * 0.5) * 0.02;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, 0, Math.PI / 4]}>
      <Points ref={pointsRef} positions={sphere} stride={3} frustumCulled {...props}>
        <PointMaterial
          transparent
          color="#22d3ee"
          size={0.002}
          sizeAttenuation={true}
          depthWrite={false}
        />
      </Points>
    </group>
  );
}

export default function Home() {
  const router = useRouter();
  const [isGenerating, setIsGenerating] = useState(false);
  const [joinKey, setJoinKey] = useState("");

  const handleStart = () => {
    setIsGenerating(true);
    const sessionId = uuidv4().slice(0, 8); // Short 8-char session
    router.push(`/${sessionId}`);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinKey.trim()) {
      router.push(`/${joinKey.trim().toLowerCase()}`);
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-white overflow-hidden flex flex-col justify-center items-center">
      {/* 3D Background */}
      <div className="absolute inset-0 z-0">
        <Canvas camera={{ position: [0, 0, 1] }}>
          <StarBackground />
        </Canvas>
      </div>

      <div className="relative z-10 w-full max-w-5xl px-6 py-12 lg:px-8 flex flex-col items-center">
        
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-center w-full max-w-md"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-slate-800/50 border border-slate-700 backdrop-blur-sm mb-6 text-[11px] font-bold uppercase tracking-widest text-cyan-400">
            <Zap className="w-3 h-3 fill-cyan-400" />
            Real-Time Sync • <span className="text-cyan-300/80">Beta v{siteConfig.version}</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 pb-2 bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500">
            {siteConfig.name}
          </h1>
          <p className="mt-4 text-lg text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Instantly sync your clipboard text and share files securely across all your devices.
          </p>

          <div className="mt-10 flex flex-col gap-4">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleStart}
              disabled={isGenerating}
              className="w-full px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-lg shadow-[0_0_40px_-10px_rgba(37,99,235,0.5)] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isGenerating ? "Creating session..." : "Create New Session"}
              <ArrowRight className="w-5 h-5" />
            </motion.button>

            <div className="flex items-center gap-4 py-2">
              <div className="h-px flex-1 bg-slate-800" />
              <span className="text-slate-500 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap">OR JOIN EXISTING</span>
              <div className="h-px flex-1 bg-slate-800" />
            </div>

            <form onSubmit={handleJoin} className="relative group">
              <input 
                type="text"
                placeholder="Enter Session Key"
                value={joinKey}
                onChange={(e) => setJoinKey(e.target.value)}
                className="w-full px-6 py-4 bg-slate-900/40 border border-slate-800 rounded-xl outline-none focus:border-blue-500/50 focus:bg-slate-900/60 transition-all text-center font-mono tracking-widest uppercase placeholder:text-slate-600 placeholder:font-sans placeholder:tracking-normal placeholder:lowercase"
              />
              {joinKey.trim().length > 0 && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  type="submit"
                  className="absolute right-2 top-2 bottom-2 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-sm transition-colors shadow-lg"
                >
                  JOIN
                </motion.button>
              )}
            </form>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl"
        >
          <FeatureCard 
            icon={<Copy className="w-6 h-6 text-cyan-400" />}
            title="Real-time Clipboard"
            desc="Copy text on your phone, paste it on your laptop instantly."
          />
          <FeatureCard 
            icon={<Cloud className="w-6 h-6 text-blue-400" />}
            title="Cloud File Storage"
            desc="Upload files up to 50MB and access them from any device."
          />
          <FeatureCard 
            icon={<Shield className="w-6 h-6 text-indigo-400" />}
            title="Auto Cleanup"
            desc="Files and text auto-destruct after 12 hours of inactivity."
          />
        </motion.div>

      </div>
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-6 hover:bg-slate-800/50 transition-colors">
      <div className="bg-slate-800/80 w-12 h-12 rounded-lg flex items-center justify-center mb-4 border border-slate-700">
        {icon}
      </div>
      <h3 className="text-xl font-bold mb-2 text-slate-100">{title}</h3>
      <p className="text-slate-400 text-sm leading-relaxed">{desc}</p>
    </div>
  );
}
