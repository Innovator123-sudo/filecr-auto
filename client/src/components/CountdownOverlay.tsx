import { motion, AnimatePresence } from 'framer-motion';

export function CountdownOverlay({ left, phase }: { left: number | null; phase: string }) {
  if (phase === 'idle' || phase === 'go' && (left === 0)) {
    // show GO briefly
  }
  const show = phase === 'countdown' || (phase === 'go' && left === 0);
  const text = phase === 'go' ? 'GO!' : left != null ? String(left) : '';
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <AnimatePresence mode="wait">
        <motion.div
          key={text}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className={`text-8xl md:text-9xl font-black ${phase==='go' ? 'text-emerald-400' : 'text-white'}`}
        >
          {text}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
