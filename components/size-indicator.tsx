'use client'

import { motion } from "framer-motion"

interface SizeIndicatorProps {
  size: number // size in cm
  time: number // time in seconds
  battery?: number | null
}

export function SizeIndicator({ size, time, battery }: SizeIndicatorProps) {
  const cm = Math.floor(size)
  const mm = Math.floor((size - cm) * 10)
  
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  
  return (
    <motion.div 
      className="fixed top-4 left-4 flex items-center justify-center gap-4"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <div className="relative w-24 h-24">
        {/* Colorful circular background */}
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="absolute inset-0 rounded-full"
            style={{
              background: `hsl(${i * 60}, 70%, 60%)`,
              transform: `scale(${1 - i * 0.1})`,
              zIndex: -i
            }}
          />
        ))}
        
        {/* Size text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white font-bold">
          <span className="text-2xl">{cm}<span className="text-lg">cm</span></span>
          <span className="text-xl">{mm}<span className="text-sm">mm</span></span>
        </div>
      </div>
      
      {/* Time display */}
      <div className="bg-white bg-opacity-80 rounded-lg p-2 text-black font-bold">
        <span className="text-xl">{minutes.toString().padStart(2, '0')}:{seconds.toString().padStart(2, '0')}</span>
      </div>
      {typeof battery === "number" && (
        <div className="bg-white bg-opacity-80 rounded-lg p-2 text-black font-bold min-w-24">
          <div className="text-xs uppercase tracking-wide">battery</div>
          <div className="text-xl">{battery}%</div>
          <div className="mt-1 h-2 w-full rounded bg-black/10">
            <div
              className="h-2 rounded"
              style={{
                width: `${Math.max(0, Math.min(100, battery))}%`,
                background: battery > 30 ? "#16a34a" : battery > 10 ? "#ca8a04" : "#dc2626",
              }}
            />
          </div>
        </div>
      )}
    </motion.div>
  )
}


