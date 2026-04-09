"use client";

import { motion } from "framer-motion";
import { Copy, ArrowRight, Cloud, Shield, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { useState, useRef, useMemo, useEffect } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";

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
    
    // 2. Interactive mouse sway
    if (pointsRef.current) {
      // Use the global pointer tracking we established
      const targetX = pointer.current.y * 0.5;
      const targetY = pointer.current.x * 0.5;
      
      // Smooth interpolation
      pointsRef.current.rotation.x += (targetX - pointsRef.current.rotation.x) * 0.05;
      pointsRef.current.rotation.y += (targetY - pointsRef.current.rotation.y) * 0.05;
    }
  });

  return (
    <group ref={groupRef} rotation={[0, 0, Math.PI / 4]}>
      <Points ref={pointsRef} positions={sphere} stride={3} frustumCulled {...props}>
        <PointMaterial
          transparent
          color="#38bdf8"
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

  const handleStart = () => {
    setIsGenerating(true);
    const sessionId = uuidv4().slice(0, 8); // Short 8-char session
    router.push(`/${sessionId}`);
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
            className="text-center"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700 backdrop-blur-sm mb-6 text-sm font-medium text-sky-400">
            <Zap className="w-4 h-4" />
            Real-Time Sync 
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 pb-2 bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-400">
            ClipBridge Cloud
          </h1>
          <p className="mt-4 text-lg md:text-xl text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Instantly sync your clipboard text and share files securely across all your devices. No login required.
          </p>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleStart}
            disabled={isGenerating}
            className="mt-10 px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white rounded-xl font-bold text-lg shadow-[0_0_40px_-10px_rgba(14,165,233,0.5)] transition-all flex items-center gap-2 mx-auto disabled:opacity-50"
          >
            {isGenerating ? "Creating connection..." : "Start Secure Session"}
            <ArrowRight className="w-5 h-5" />
          </motion.button>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
          className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-4xl"
        >
          <FeatureCard 
            icon={<Copy className="w-6 h-6 text-sky-400" />}
            title="Real-time Clipboard"
            desc="Copy text on your phone, paste it on your laptop instantly."
          />
          <FeatureCard 
            icon={<Cloud className="w-6 h-6 text-indigo-400" />}
            title="Cloud File Storage"
            desc="Upload files up to 50MB and access them from any device."
          />
          <FeatureCard 
            icon={<Shield className="w-6 h-6 text-purple-400" />}
            title="Auto Cleanup"
            desc="Files and text auto-destruct after 1 hour of inactivity."
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
