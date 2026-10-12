import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

setGlobalOptions({ region: 'us-central1', maxInstances: 10, invoker: 'public' })

admin.initializeApp()

const db = admin.database()
const auth = admin.auth()

interface StaffPermissions {
  pos: boolean
  menu: boolean
  orders: boolean
  settings: boolean
  team: boolean
}

interface SuperAdminCheck {
  uid: string
  role: 'super_admin'
}

interface CompanyManagerCheck {
  uid: string
  role: 'super_admin' | 'admin' | 'staff'
}

interface RtdbUser {
  role?: string
  companyId?: string
  permissions?: StaffPermissions
  active?: boolean
  name?: string
  email?: string
}

interface TeamRosterEntry {
  name: string
  email: string
  role: 'admin' | 'staff'
  permissions?: StaffPermissions
  createdAt: number
  active: boolean
}

const normalizePermissions = (input: unknown): StaffPermissions => {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    pos: !!src.pos,
    menu: !!src.menu,
    orders: !!src.orders,
    settings: !!src.settings,
    team: !!src.team,
  }
}

const hasAnyPermission = (p: StaffPermissions): boolean =>
  p.pos || p.menu || p.orders || p.settings || p.team

const requireSuperAdmin = async (
  req: CallableRequest<unknown>,
): Promise<SuperAdminCheck> => {
  const uid = req.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required.')
  }
  const snap = await db.ref(`users/${uid}`).get()
  const data = snap.val() as { role?: string } | null
  if (!data || data.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Super admin only.')
  }
  return { uid, role: 'super_admin' }
}

const requireCompanyManager = async (
  req: CallableRequest<unknown>,
  companyId: string,
): Promise<CompanyManagerCheck> => {
  const uid = req.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign-in required.')
  }
  if (!companyId) {
    throw new HttpsError('invalid-argument', 'companyId is required.')
  }

  const snap = await db.ref(`users/${uid}`).get()
  const data = snap.val() as RtdbUser | null
  if (!data?.role) {
    throw new HttpsError('permission-denied', 'No role assigned.')
  }

  if (data.role === 'super_admin') {
    return { uid, role: 'super_admin' }
  }

  if (data.companyId !== companyId) {
    throw new HttpsError('permission-denied', 'Company access required.')
  }

  if (data.role === 'admin') {
    return { uid, role: 'admin' }
  }

  if (data.role === 'staff') {
    if (data.active === false) {
      throw new HttpsError('permission-denied', 'Account is inactive.')
    }
    const perms = normalizePermissions(data.permissions)
    if (!perms.team) {
      throw new HttpsError('permission-denied', 'Team management permission required.')
    }
    return { uid, role: 'staff' }
  }

  throw new HttpsError('permission-denied', 'Company manager required.')
}

interface CreateCompanyAdminInput {
  companyName: string
  location: string
  phone?: string
  logoUrl?: string
  adminName: string
  adminEmail: string
  password: string
}

interface CreateCompanyAdminResult {
  companyId: string
  adminUid: string
}

export const createCompanyAdmin = onCall<CreateCompanyAdminInput, Promise<CreateCompanyAdminResult>>(
  async (req) => {
    const caller = await requireSuperAdmin(req)
    const {
      companyName,
      location,
      phone,
      logoUrl,
      adminName,
      adminEmail,
      password,
    } = req.data || ({} as CreateCompanyAdminInput)

    if (!companyName || !location || !adminName || !adminEmail || !password) {
      throw new HttpsError('invalid-argument', 'Missing required fields.')
    }
    if (password.length < 6) {
      throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.')
    }

    let userRecord: admin.auth.UserRecord
    try {
      userRecord = await auth.createUser({
        email: adminEmail,
        password,
        displayName: adminName,
      })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Email already in use.')
      }
      throw new HttpsError('internal', 'Failed to create auth user.')
    }

    const companyRef = db.ref('companies').push()
    const companyId = companyRef.key!
    const now = Date.now()

    await auth.setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      companyId,
    })

    const teamEntry: TeamRosterEntry = {
      name: adminName,
      email: adminEmail,
      role: 'admin',
      createdAt: now,
      active: true,
    }

    const company = {
      name: companyName,
      location,
      adminUid: userRecord.uid,
      adminEmail,
      adminName,
      active: true,
      createdAt: now,
      createdBy: caller.uid,
      team: {
        [userRecord.uid]: teamEntry,
      },
      ...(phone ? { phone } : {}),
      ...(logoUrl ? { logoUrl } : {}),
    }

    const userRecordDb = {
      email: adminEmail,
      name: adminName,
      role: 'admin' as const,
      companyId,
      password,
      active: true,
      createdAt: now,
    }

    await db.ref().update({
      [`companies/${companyId}`]: company,
      [`users/${userRecord.uid}`]: userRecordDb,
    })

    return { companyId, adminUid: userRecord.uid }
  },
)

interface DeleteCompanyInput {
  companyId: string
}

export const deleteCompany = onCall<DeleteCompanyInput, Promise<{ ok: true }>>(
  async (req) => {
    await requireSuperAdmin(req)
    const { companyId } = req.data || ({} as DeleteCompanyInput)
    if (!companyId) {
      throw new HttpsError('invalid-argument', 'companyId is required.')
    }

    const compSnap = await db.ref(`companies/${companyId}`).get()
    const comp = compSnap.val() as { adminUid?: string; team?: Record<string, unknown> } | null
    if (!comp) {
      throw new HttpsError('not-found', 'Company not found.')
    }

    const teamUids = new Set<string>()
    if (comp.adminUid) teamUids.add(comp.adminUid)
    if (comp.team && typeof comp.team === 'object') {
      for (const uid of Object.keys(comp.team)) {
        teamUids.add(uid)
      }
    }

    for (const uid of teamUids) {
      try {
        await auth.deleteUser(uid)
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code !== 'auth/user-not-found') {
          console.warn('[deleteCompany] auth deletion warning', uid, err)
        }
      }
    }

    const updates: Record<string, null> = {
      [`companies/${companyId}`]: null,
      [`menu/${companyId}`]: null,
      [`orders/${companyId}`]: null,
      [`counters/${companyId}`]: null,
      [`taxSettings/${companyId}`]: null,
    }
    for (const uid of teamUids) {
      updates[`users/${uid}`] = null
    }
    await db.ref().update(updates)

    return { ok: true }
  },
)

interface UpdateCompanyAdminInput {
  companyId: string
  adminName?: string
  password?: string
}

export const updateCompanyAdmin = onCall<UpdateCompanyAdminInput, Promise<{ ok: true }>>(
  async (req) => {
    await requireSuperAdmin(req)
    const { companyId, adminName, password } = req.data || ({} as UpdateCompanyAdminInput)
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.')

    const compSnap = await db.ref(`companies/${companyId}`).get()
    const comp = compSnap.val() as { adminUid?: string } | null
    if (!comp?.adminUid) throw new HttpsError('not-found', 'Company not found.')

    const updates: { displayName?: string; password?: string } = {}
    if (adminName) updates.displayName = adminName
    if (password) {
      if (password.length < 6) {
        throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.')
      }
      updates.password = password
    }
    if (Object.keys(updates).length > 0) {
      await auth.updateUser(comp.adminUid, updates)
    }
    const rtdbUpdates: Record<string, string | boolean> = {}
    if (adminName) {
      rtdbUpdates[`companies/${companyId}/adminName`] = adminName
      rtdbUpdates[`users/${comp.adminUid}/name`] = adminName
      rtdbUpdates[`companies/${companyId}/team/${comp.adminUid}/name`] = adminName
    }
    if (password) {
      rtdbUpdates[`users/${comp.adminUid}/password`] = password
    }
    if (Object.keys(rtdbUpdates).length > 0) {
      await db.ref().update(rtdbUpdates)
    }

    return { ok: true }
  },
)

export const setSuperAdminClaim = onCall<Record<string, never>, Promise<{ ok: true }>>(
  async (req) => {
    const uid = req.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required.')

    const snap = await db.ref(`users/${uid}`).get()
    const data = snap.val() as { role?: string } | null
    if (!data || data.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Not a super admin in RTDB.')
    }

    await auth.setCustomUserClaims(uid, { role: 'super_admin' })
    return { ok: true }
  },
)

interface CreateTeamMemberInput {
  companyId: string
  name: string
  email: string
  password: string
  permissions: StaffPermissions
}

interface CreateTeamMemberResult {
  uid: string
}

export const createTeamMember = onCall<CreateTeamMemberInput, Promise<CreateTeamMemberResult>>(
  async (req) => {
    const { companyId, name, email, password, permissions: rawPerms } =
      req.data || ({} as CreateTeamMemberInput)

    await requireCompanyManager(req, companyId)

    if (!name?.trim() || !email?.trim() || !password) {
      throw new HttpsError('invalid-argument', 'Missing required fields.')
    }
    if (password.length < 6) {
      throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.')
    }

    const permissions = normalizePermissions(rawPerms)
    if (!hasAnyPermission(permissions)) {
      throw new HttpsError('invalid-argument', 'Select at least one permission.')
    }

    const compSnap = await db.ref(`companies/${companyId}`).get()
    if (!compSnap.exists()) {
      throw new HttpsError('not-found', 'Company not found.')
    }

    let userRecord: admin.auth.UserRecord
    try {
      userRecord = await auth.createUser({
        email: email.trim(),
        password,
        displayName: name.trim(),
      })
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Email already in use.')
      }
      throw new HttpsError('internal', 'Failed to create auth user.')
    }

    const now = Date.now()
    await auth.setCustomUserClaims(userRecord.uid, {
      role: 'staff',
      companyId,
      permissions,
    })

    const userRecordDb = {
      email: email.trim(),
      name: name.trim(),
      role: 'staff' as const,
      companyId,
      password,
      permissions,
      active: true,
      createdAt: now,
    }

    const teamEntry: TeamRosterEntry = {
      name: name.trim(),
      email: email.trim(),
      role: 'staff',
      permissions,
      createdAt: now,
      active: true,
    }

    await db.ref().update({
      [`users/${userRecord.uid}`]: userRecordDb,
      [`companies/${companyId}/team/${userRecord.uid}`]: teamEntry,
    })

    return { uid: userRecord.uid }
  },
)

interface UpdateTeamMemberInput {
  companyId: string
  uid: string
  name?: string
  password?: string
  permissions?: StaffPermissions
  active?: boolean
}

export const updateTeamMember = onCall<UpdateTeamMemberInput, Promise<{ ok: true }>>(
  async (req) => {
    const { companyId, uid, name, password, permissions: rawPerms, active } =
      req.data || ({} as UpdateTeamMemberInput)

    await requireCompanyManager(req, companyId)

    if (!uid) {
      throw new HttpsError('invalid-argument', 'uid is required.')
    }

    const compSnap = await db.ref(`companies/${companyId}`).get()
    const comp = compSnap.val() as { adminUid?: string } | null
    if (!comp) {
      throw new HttpsError('not-found', 'Company not found.')
    }
    if (comp.adminUid === uid) {
      throw new HttpsError('failed-precondition', 'Cannot edit the company owner via Team.')
    }

    const userSnap = await db.ref(`users/${uid}`).get()
    const existing = userSnap.val() as RtdbUser | null
    if (!existing || existing.companyId !== companyId || existing.role !== 'staff') {
      throw new HttpsError('not-found', 'Team member not found.')
    }

    const authUpdates: { displayName?: string; password?: string; disabled?: boolean } = {}
    if (name?.trim()) authUpdates.displayName = name.trim()
    if (password) {
      if (password.length < 6) {
        throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.')
      }
      authUpdates.password = password
    }
    if (typeof active === 'boolean') {
      authUpdates.disabled = !active
    }

    let permissions = normalizePermissions(existing.permissions)
    if (rawPerms !== undefined) {
      permissions = normalizePermissions(rawPerms)
      if (!hasAnyPermission(permissions)) {
        throw new HttpsError('invalid-argument', 'Select at least one permission.')
      }
    }

    if (Object.keys(authUpdates).length > 0) {
      await auth.updateUser(uid, authUpdates)
    }

    const nextActive = typeof active === 'boolean' ? active : existing.active !== false

    await auth.setCustomUserClaims(uid, {
      role: 'staff',
      companyId,
      permissions,
    })

    const rtdbUpdates: Record<string, string | boolean | StaffPermissions> = {
      [`users/${uid}/permissions`]: permissions,
      [`companies/${companyId}/team/${uid}/permissions`]: permissions,
      [`users/${uid}/active`]: nextActive,
      [`companies/${companyId}/team/${uid}/active`]: nextActive,
    }
    if (name?.trim()) {
      rtdbUpdates[`users/${uid}/name`] = name.trim()
      rtdbUpdates[`companies/${companyId}/team/${uid}/name`] = name.trim()
    }
    if (password) {
      rtdbUpdates[`users/${uid}/password`] = password
    }

    await db.ref().update(rtdbUpdates)

    return { ok: true }
  },
)

interface DeleteTeamMemberInput {
  companyId: string
  uid: string
}

export const deleteTeamMember = onCall<DeleteTeamMemberInput, Promise<{ ok: true }>>(
  async (req) => {
    const { companyId, uid } = req.data || ({} as DeleteTeamMemberInput)

    await requireCompanyManager(req, companyId)

    if (!uid) {
      throw new HttpsError('invalid-argument', 'uid is required.')
    }

    const compSnap = await db.ref(`companies/${companyId}`).get()
    const comp = compSnap.val() as { adminUid?: string } | null
    if (!comp) {
      throw new HttpsError('not-found', 'Company not found.')
    }
    if (comp.adminUid === uid) {
      throw new HttpsError('failed-precondition', 'Cannot delete the company owner.')
    }

    const userSnap = await db.ref(`users/${uid}`).get()
    const existing = userSnap.val() as RtdbUser | null
    if (!existing || existing.companyId !== companyId) {
      throw new HttpsError('not-found', 'Team member not found.')
    }

    try {
      await auth.deleteUser(uid)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'auth/user-not-found') {
        throw new HttpsError('internal', 'Failed to delete auth user.')
      }
    }

    await db.ref().update({
      [`users/${uid}`]: null,
      [`companies/${companyId}/team/${uid}`]: null,
    })

    return { ok: true }
  },
)

export {
  getTerminalConnectionToken,
  createKioskPaymentIntent,
  createKioskOrder,
  getKioskOrder,
  refundOrder,
} from './payments'
