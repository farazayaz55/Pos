import { ref, onValue } from 'firebase/database'
import { db } from '@/lib/firebase'
import type { TeamMember } from '@/types'

export const companyTeamRef = (companyId: string) =>
  ref(db, `companies/${companyId}/team`)

export const subscribeCompanyTeam = (
  companyId: string,
  cb: (members: TeamMember[]) => void,
) => {
  return onValue(companyTeamRef(companyId), (snap) => {
    const val = snap.val() as Record<string, Omit<TeamMember, 'uid'>> | null
    if (!val) {
      cb([])
      return
    }
    const list = Object.entries(val).map(([uid, data]) => ({
      uid,
      ...data,
      active: data.active !== false,
    }))
    list.sort((a, b) => {
      if (a.role === 'admin' && b.role !== 'admin') return -1
      if (b.role === 'admin' && a.role !== 'admin') return 1
      return a.name.localeCompare(b.name)
    })
    cb(list)
  })
}
