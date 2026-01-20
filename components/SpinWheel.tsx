import React, { useEffect, useState, useRef } from 'react';
import { motion, useAnimation, AnimatePresence } from 'framer-motion';
import { Trophy, Zap } from 'lucide-react';

export interface WheelItem {
  id: string;
  label: string;
  percentage: number; // 0-100
  color: string;
}

interface SpinWheelProps {
  items: WheelItem[];
  winnerId: string | null;
  onSpinStart?: () => void;
  onSpinComplete?: () => void;
  isSpinning: boolean;
}

// Confetti particle component
const Particle: React.FC<{ color: string; delay: number; x: number; y: number }> = ({ color, delay, x, y }) => (
  <motion.div
    className="absolute w-3 h-3 rounded-full"
    style={{ backgroundColor: color, left: '50%', top: '50%' }}
    initial={{ scale: 0, x: 0, y: 0, opacity: 1 }}
    animate={{
      scale: [0, 1, 1, 0.5],
      x: [0, x * 2, x * 3],
      y: [0, y * 2, y * 4],
      opacity: [1, 1, 0.8, 0],
      rotate: [0, 180, 360]
    }}
    transition={{
      duration: 2,
      delay,
      ease: "easeOut"
    }}
  />
);

export const SpinWheel: React.FC<SpinWheelProps> = ({
  items,
  winnerId,
  onSpinStart,
  onSpinComplete,
  isSpinning
}) => {
  const controls = useAnimation();
  const [gradientStyle, setGradientStyle] = useState<string>('');
  const [currentRotation, setCurrentRotation] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [spinPhase, setSpinPhase] = useState<'idle' | 'accelerating' | 'cruising' | 'decelerating' | 'stopping'>('idle');
  const [hoveredItem, setHoveredItem] = useState<WheelItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const wheelRef = useRef<HTMLDivElement>(null);

  // Handle mouse move to detect which slice is hovered
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isSpinning || !wheelRef.current || items.length === 0) {
      setHoveredItem(null);
      return;
    }

    const rect = wheelRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const mouseX = e.clientX - centerX;
    const mouseY = e.clientY - centerY;

    // Check if mouse is within the wheel (not in center hub)
    const distance = Math.sqrt(mouseX * mouseX + mouseY * mouseY);
    const wheelRadius = rect.width / 2;
    const hubRadius = 56; // Center hub radius

    if (distance < hubRadius || distance > wheelRadius) {
      setHoveredItem(null);
      return;
    }

    // Calculate angle from center (0° = top, clockwise)
    // atan2 gives angle from positive X axis, counter-clockwise
    // We need to convert to clockwise from top
    let angle = Math.atan2(mouseX, -mouseY) * (180 / Math.PI);
    if (angle < 0) angle += 360;

    // Find which slice this angle falls into
    let accumulatedPercent = 0;
    for (const item of items) {
      const sliceEndAngle = ((accumulatedPercent + item.percentage) / 100) * 360;
      if (angle <= sliceEndAngle) {
        setHoveredItem(item);
        setTooltipPos({ x: e.clientX, y: e.clientY });
        return;
      }
      accumulatedPercent += item.percentage;
    }

    setHoveredItem(null);
  };

  const handleMouseLeave = () => {
    setHoveredItem(null);
  };

  // 1. Generate Conic Gradient based on items
  useEffect(() => {
    if (items.length === 0) {
      setGradientStyle('conic-gradient(#1e293b 0% 100%)');
      return;
    }

    let currentPercent = 0;
    const gradientParts: string[] = [];

    items.forEach((item, index) => {
      const start = currentPercent;
      const end = currentPercent + item.percentage;

      // Add main color
      gradientParts.push(`${item.color} ${start}% ${end - 0.3}%`);

      // Add a subtle darker border between slices
      if (index < items.length - 1) {
        gradientParts.push(`rgba(0,0,0,0.4) ${end - 0.3}% ${end}%`);
      }

      currentPercent = end;
    });

    setGradientStyle(`conic-gradient(from -90deg, ${gradientParts.join(', ')})`);
  }, [items]);


  // 2. Handle Spin Logic with dramatic VRF animation
  useEffect(() => {
    if (isSpinning && winnerId) {
      spinToWinner(winnerId);
    }
  }, [isSpinning, winnerId]);

  const spinToWinner = async (targetId: string) => {
    if (onSpinStart) onSpinStart();
    setShowConfetti(false);
    setSpinPhase('accelerating');

    // A. Find Target Slice Geometry
    let accumulatedPercent = 0;
    let targetCenterDeg = 0;

    for (const item of items) {
      const itemDeg = (item.percentage / 100) * 360;
      if (item.id === targetId) {
        const startDeg = (accumulatedPercent / 100) * 360;
        // Add some randomness within the slice for realism
        const randomOffset = (Math.random() - 0.5) * itemDeg * 0.6;
        targetCenterDeg = startDeg + (itemDeg / 2) + randomOffset;
        break;
      }
      accumulatedPercent += item.percentage;
    }

    // B. Calculate Rotation with VRF-style randomness
    const baseSpins = 6 + Math.random() * 2; // 6-8 full rotations
    const fullSpins = Math.floor(baseSpins) * 360;
    // Adjust for the -90deg offset in conic-gradient (starts from top)
    const targetRotation = currentRotation + fullSpins + (360 - targetCenterDeg) + 90;

    // C. Dramatic multi-phase animation
    // Phase 1: Quick acceleration (0.5s)
    setSpinPhase('accelerating');
    await controls.start({
      rotate: currentRotation + 720, // Quick 2 spins
      transition: {
        duration: 0.8,
        ease: [0.4, 0, 1, 1], // Accelerating curve
      }
    });

    // Phase 2: Cruising at high speed (2s)
    setSpinPhase('cruising');
    await controls.start({
      rotate: currentRotation + fullSpins - 360,
      transition: {
        duration: 2.5,
        ease: "linear",
      }
    });

    // Phase 3: Deceleration (3.5s)
    setSpinPhase('decelerating');

    await controls.start({
      rotate: targetRotation,
      transition: {
        duration: 3.5,
        ease: [0.15, 0.85, 0.35, 1], // Heavy deceleration curve
      }
    });

    // Phase 4: Final settling with slight bounce
    setSpinPhase('stopping');
    await controls.start({
      rotate: [targetRotation, targetRotation - 2, targetRotation + 1, targetRotation],
      transition: {
        duration: 0.5,
        times: [0, 0.4, 0.7, 1],
        ease: "easeOut"
      }
    });

    setCurrentRotation(targetRotation % 360);
    setSpinPhase('idle');
    setShowConfetti(true);

    // Hide confetti after animation
    setTimeout(() => setShowConfetti(false), 3000);

    if (onSpinComplete) onSpinComplete();
  };

  // Generate confetti particles
  const confettiParticles = showConfetti ? Array.from({ length: 30 }, (_, i) => ({
    id: i,
    color: items[i % items.length]?.color || '#10b981',
    delay: Math.random() * 0.3,
    x: (Math.random() - 0.5) * 300,
    y: (Math.random() - 0.5) * 300 - 100
  })) : [];


  return (
    <div
      className="relative w-80 h-80 md:w-96 md:h-96 flex items-center justify-center"
      ref={wheelRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Hover Tooltip */}
      <AnimatePresence>
        {hoveredItem && !isSpinning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            className="fixed z-[100] pointer-events-none"
            style={{
              left: tooltipPos.x + 15,
              top: tooltipPos.y - 10,
            }}
          >
            <div
              className="px-3 py-2 rounded-lg border shadow-xl backdrop-blur-md"
              style={{
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                borderColor: hoveredItem.color,
                boxShadow: `0 0 20px ${hoveredItem.color}40`
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: hoveredItem.color }}
                />
                <span className="text-white font-bold text-sm">{hoveredItem.label}</span>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {hoveredItem.percentage.toFixed(1)}% chance
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confetti Explosion */}
      <AnimatePresence>
        {showConfetti && (
          <div className="absolute inset-0 pointer-events-none z-50 overflow-visible">
            {confettiParticles.map(p => (
              <Particle key={p.id} {...p} />
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* 1. Pointer (Static, Top Center) - Enhanced */}
      <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-30">
        <motion.div
          className="relative"
          animate={isSpinning ? {
            scale: [1, 1.1, 1],
            filter: ['drop-shadow(0 0 10px rgba(239,68,68,0.8))', 'drop-shadow(0 0 20px rgba(239,68,68,1))', 'drop-shadow(0 0 10px rgba(239,68,68,0.8))']
          } : {}}
          transition={{ duration: 0.3, repeat: isSpinning ? Infinity : 0 }}
        >
          <div className="w-0 h-0 border-l-[18px] border-l-transparent border-r-[18px] border-r-transparent border-t-[36px] border-t-red-500" />
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[24px] border-t-red-400" />
        </motion.div>
      </div>


      {/* 3. Outer Glow Ring - Dynamic based on spin phase */}
      <motion.div
        className="absolute inset-[-25px] rounded-full z-0 pointer-events-none"
        style={{
          border: '4px solid',
          borderColor: spinPhase === 'idle' ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.8)',
        }}
        animate={{
          boxShadow: spinPhase !== 'idle'
            ? ['0 0 30px rgba(16,185,129,0.4)', '0 0 60px rgba(16,185,129,0.8)', '0 0 30px rgba(16,185,129,0.4)']
            : '0 0 20px rgba(16,185,129,0.2)'
        }}
        transition={{ duration: 0.5, repeat: spinPhase !== 'idle' ? Infinity : 0 }}
      />

      {/* 4. Secondary glow ring */}
      <motion.div
        className="absolute inset-[-35px] rounded-full border-2 border-rehab-green/20 z-0 pointer-events-none"
        animate={spinPhase !== 'idle' ? {
          opacity: [0.2, 0.5, 0.2],
          scale: [1, 1.02, 1]
        } : {}}
        transition={{ duration: 1, repeat: Infinity }}
      />

      {/* 5. The Spinning Wheel */}
      <motion.div
        className="w-full h-full rounded-full relative overflow-hidden"
        animate={controls}
        initial={{ rotate: 0 }}
        style={{
          boxShadow: isSpinning
            ? '0 0 40px rgba(0,0,0,0.8), inset 0 0 60px rgba(0,0,0,0.5)'
            : '0 0 20px rgba(0,0,0,0.8), inset 0 0 30px rgba(0,0,0,0.3)'
        }}
      >
        {/* The Conic Gradient Chart */}
        <div
          className="w-full h-full rounded-full"
          style={{ background: gradientStyle }}
        />



        {/* Inner border ring */}
        <div className="absolute inset-4 rounded-full border-4 border-black/30" />

        {/* Outer border */}
        <div className="absolute inset-0 rounded-full border-8 border-slate-900/70" />
      </motion.div>

      {/* 6. Center Hub (Static) - Enhanced */}
      <div className="absolute z-20 w-28 h-28 rounded-full flex items-center justify-center">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 border-4 border-slate-600" />

        {/* Inner circle */}
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-slate-800 to-black border-2 border-slate-700" />

        {/* Center content */}
        <div className="relative z-30 text-center">
          {isSpinning ? (
            <motion.div
              className="relative"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              <div className="w-14 h-14 rounded-full border-4 border-transparent border-t-rehab-green border-r-rehab-green/50" />
              <Zap className="absolute inset-0 m-auto text-rehab-green w-6 h-6" />
            </motion.div>
          ) : (
            <motion.div
              animate={showConfetti ? {
                scale: [1, 1.2, 1],
                rotate: [0, 10, -10, 0]
              } : {}}
              transition={{ duration: 0.5 }}
            >
              <Trophy className="text-yellow-400 w-12 h-12 drop-shadow-[0_0_15px_rgba(250,204,21,0.6)]" />
            </motion.div>
          )}
        </div>
      </div>

      {/* 7. Spin Phase Indicator */}
      {isSpinning && (
        <motion.div
          className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-xs font-mono uppercase tracking-wider"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <span className={`px-3 py-1 rounded-full border ${
            spinPhase === 'accelerating' ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400' :
            spinPhase === 'cruising' ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' :
            spinPhase === 'decelerating' ? 'bg-orange-500/20 border-orange-500/50 text-orange-400' :
            'bg-rehab-green/20 border-rehab-green/50 text-rehab-green'
          }`}>
            {spinPhase === 'accelerating' && '⚡ Accelerating...'}
            {spinPhase === 'cruising' && '🔄 VRF Processing...'}
            {spinPhase === 'decelerating' && '🎯 Selecting Winner...'}
            {spinPhase === 'stopping' && '✨ Almost there...'}
          </span>
        </motion.div>
      )}

      {/* 8. Winner highlight effect */}
      <AnimatePresence>
        {showConfetti && winnerId && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute -bottom-16 left-1/2 -translate-x-1/2 z-40"
          >
            <div className="bg-rehab-green/20 border border-rehab-green px-4 py-2 rounded-full">
              <span className="text-rehab-green font-bold text-sm">
                🎉 {winnerId} WINS!
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
