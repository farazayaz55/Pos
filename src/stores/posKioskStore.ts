import { create } from 'zustand'

interface PosKioskState {
  active: boolean
  setActive: (active: boolean) => void
}

export const usePosKioskStore = create<PosKioskState>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}))
