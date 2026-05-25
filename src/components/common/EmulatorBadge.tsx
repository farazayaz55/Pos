import { firebaseEnv } from '@/lib/firebase'

const EmulatorBadge = () => {
  if (!firebaseEnv.useEmulator) return null
  return (
    <div className="no-print pointer-events-none fixed bottom-3 left-3 z-[60] select-none">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-950 shadow-md ring-2 ring-amber-200">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-900" />
        Emulator
      </span>
    </div>
  )
}

export default EmulatorBadge
