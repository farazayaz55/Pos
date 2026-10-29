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
  receipt: boolean
  team: boolean
  reports: boolean
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
  branchId?: string
  permissions?: StaffPermissions
  active?: boolean
  name?: string
  email?: string
}

interface TeamRosterEntry {
  name: string
  email: string
  role: 'admin' | 'staff'
  branchId?: string
  permissions?: StaffPermissions
  createdAt: number
  active: boolean
}

interface BranchRecord {
  companyId: string
  name: string
  location: string
  phone?: string
  active: boolean
  createdAt: number
  createdBy: string
}

const normalizePermissions = (input: unknown): StaffPermissions => {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    pos: !!src.pos,
    menu: !!src.menu,
    orders: !!src.orders,
    settings: !!src.settings,
    receipt: !!src.receipt,
    team: !!src.team,
    reports: !!src.reports,
  }
}

const hasAnyPermission = (p: StaffPermissions): boolean =>
  p.pos || p.menu || p.orders || p.settings || p.receipt || p.team || p.reports

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
  branchId: string
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
    const branchRef = db.ref(`companies/${companyId}/branches`).push()
    const branchId = branchRef.key!
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

    const branch: BranchRecord = {
      companyId,
      name: location.trim() || 'Main',
      location: location.trim(),
      active: true,
      createdAt: now,
      createdBy: caller.uid,
      ...(phone ? { phone } : {}),
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
      branches: {
        [branchId]: branch,
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

    return { companyId, adminUid: userRecord.uid, branchId }
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
      [`receiptSettings/${companyId}`]: null,
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

/** Re-sync Auth custom claims from the caller's RTDB user record (incl. branchId). */
export const syncMyClaims = onCall<Record<string, never>, Promise<{ ok: true }>>(
  async (req) => {
    const uid = req.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign-in required.')

    const snap = await db.ref(`users/${uid}`).get()
    const data = snap.val() as RtdbUser | null
    if (!data?.role) {
      throw new HttpsError('not-found', 'User profile not found.')
    }

    if (data.role === 'super_admin') {
      await auth.setCustomUserClaims(uid, { role: 'super_admin' })
      return { ok: true }
    }

    if (data.role === 'admin') {
      if (!data.companyId) {
        throw new HttpsError('failed-precondition', 'Admin missing companyId.')
      }
      await auth.setCustomUserClaims(uid, {
        role: 'admin',
        companyId: data.companyId,
      })
      return { ok: true }
    }

    if (data.role === 'staff') {
      if (!data.companyId || !data.branchId) {
        throw new HttpsError(
          'failed-precondition',
          'Staff missing companyId or branchId.',
        )
      }
      await auth.setCustomUserClaims(uid, {
        role: 'staff',
        companyId: data.companyId,
        branchId: data.branchId,
        permissions: normalizePermissions(data.permissions),
      })
      return { ok: true }
    }

    throw new HttpsError('failed-precondition', 'Unsupported role.')
  },
)

interface CreateTeamMemberInput {
  companyId: string
  branchId: string
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
    const { companyId, branchId, name, email, password, permissions: rawPerms } =
      req.data || ({} as CreateTeamMemberInput)

    await requireCompanyManager(req, companyId)

    if (!name?.trim() || !email?.trim() || !password) {
      throw new HttpsError('invalid-argument', 'Missing required fields.')
    }
    if (!branchId) {
      throw new HttpsError('invalid-argument', 'branchId is required for staff.')
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

    const branchSnap = await db.ref(`companies/${companyId}/branches/${branchId}`).get()
    if (!branchSnap.exists()) {
      throw new HttpsError('not-found', 'Branch not found.')
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
      branchId,
      permissions,
    })

    const userRecordDb = {
      email: email.trim(),
      name: name.trim(),
      role: 'staff' as const,
      companyId,
      branchId,
      password,
      permissions,
      active: true,
      createdAt: now,
    }

    const teamEntry: TeamRosterEntry = {
      name: name.trim(),
      email: email.trim(),
      role: 'staff',
      branchId,
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
  branchId?: string
}

export const updateTeamMember = onCall<UpdateTeamMemberInput, Promise<{ ok: true }>>(
  async (req) => {
    const { companyId, uid, name, password, permissions: rawPerms, active, branchId } =
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

    let nextBranchId = existing.branchId
    if (branchId !== undefined) {
      if (!branchId) {
        throw new HttpsError('invalid-argument', 'branchId is required for staff.')
      }
      const branchSnap = await db.ref(`companies/${companyId}/branches/${branchId}`).get()
      if (!branchSnap.exists()) {
        throw new HttpsError('not-found', 'Branch not found.')
      }
      nextBranchId = branchId
    }
    if (!nextBranchId) {
      throw new HttpsError('failed-precondition', 'Staff member has no branch assigned.')
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
      branchId: nextBranchId,
      permissions,
    })

    const rtdbUpdates: Record<string, string | boolean | StaffPermissions> = {
      [`users/${uid}/permissions`]: permissions,
      [`companies/${companyId}/team/${uid}/permissions`]: permissions,
      [`users/${uid}/active`]: nextActive,
      [`companies/${companyId}/team/${uid}/active`]: nextActive,
      [`users/${uid}/branchId`]: nextBranchId,
      [`companies/${companyId}/team/${uid}/branchId`]: nextBranchId,
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

interface CreateBranchInput {
  companyId: string
  sourceBranchId: string
  name: string
  location: string
  phone?: string
}

interface CreateBranchResult {
  branchId: string
}

export const createBranch = onCall<CreateBranchInput, Promise<CreateBranchResult>>(
  async (req) => {
    const { companyId, sourceBranchId, name, location, phone } =
      req.data || ({} as CreateBranchInput)
    const caller = await requireCompanyManager(req, companyId)

    // Staff with team permission cannot create branches — company admin / super_admin only
    if (caller.role === 'staff') {
      throw new HttpsError('permission-denied', 'Company admin required to create branches.')
    }

    if (!companyId || !sourceBranchId || !name?.trim() || !location?.trim()) {
      throw new HttpsError('invalid-argument', 'Missing required fields.')
    }

    const sourceSnap = await db
      .ref(`companies/${companyId}/branches/${sourceBranchId}`)
      .get()
    if (!sourceSnap.exists()) {
      throw new HttpsError('not-found', 'Source branch not found.')
    }

    const newRef = db.ref(`companies/${companyId}/branches`).push()
    const branchId = newRef.key!
    const now = Date.now()

    const branch: BranchRecord = {
      companyId,
      name: name.trim(),
      location: location.trim(),
      active: true,
      createdAt: now,
      createdBy: caller.uid,
      ...(phone?.trim() ? { phone: phone.trim() } : {}),
    }

    const updates: Record<string, unknown> = {
      [`companies/${companyId}/branches/${branchId}`]: branch,
    }

    const [menuSnap, taxSnap, receiptSnap] = await Promise.all([
      db.ref(`menu/${companyId}/${sourceBranchId}`).get(),
      db.ref(`taxSettings/${companyId}/${sourceBranchId}`).get(),
      db.ref(`receiptSettings/${companyId}/${sourceBranchId}`).get(),
    ])

    const menuVal = menuSnap.val() as {
      categories?: Record<string, Record<string, unknown>>
      items?: Record<string, Record<string, unknown>>
      modifierGroups?: Record<string, Record<string, unknown>>
    } | null

    if (menuVal?.categories) {
      for (const [id, cat] of Object.entries(menuVal.categories)) {
        updates[`menu/${companyId}/${branchId}/categories/${id}`] = {
          ...cat,
          companyId,
          branchId,
        }
      }
    }
    if (menuVal?.items) {
      for (const [id, item] of Object.entries(menuVal.items)) {
        updates[`menu/${companyId}/${branchId}/items/${id}`] = {
          ...item,
          companyId,
          branchId,
        }
      }
    }
    if (menuVal?.modifierGroups) {
      for (const [id, g] of Object.entries(menuVal.modifierGroups)) {
        updates[`menu/${companyId}/${branchId}/modifierGroups/${id}`] = {
          ...g,
          companyId,
          branchId,
        }
      }
    }

    const taxVal = taxSnap.val()
    if (taxVal) {
      updates[`taxSettings/${companyId}/${branchId}`] = taxVal
    }

    const receiptVal = receiptSnap.val()
    if (receiptVal) {
      updates[`receiptSettings/${companyId}/${branchId}`] = receiptVal
    }

    await db.ref().update(updates)
    return { branchId }
  },
)

interface DeleteBranchInput {
  companyId: string
  branchId: string
}

export const deleteBranch = onCall<DeleteBranchInput, Promise<{ ok: true }>>(
  async (req) => {
    const { companyId, branchId } = req.data || ({} as DeleteBranchInput)
    const caller = await requireCompanyManager(req, companyId)

    if (caller.role === 'staff') {
      throw new HttpsError('permission-denied', 'Company admin required to delete branches.')
    }
    if (!companyId || !branchId) {
      throw new HttpsError('invalid-argument', 'companyId and branchId are required.')
    }

    const branchesSnap = await db.ref(`companies/${companyId}/branches`).get()
    const branches = branchesSnap.val() as Record<string, unknown> | null
    if (!branches || !branches[branchId]) {
      throw new HttpsError('not-found', 'Branch not found.')
    }
    if (Object.keys(branches).length <= 1) {
      throw new HttpsError('failed-precondition', 'Cannot delete the last branch.')
    }

    await db.ref().update({
      [`companies/${companyId}/branches/${branchId}`]: null,
      [`menu/${companyId}/${branchId}`]: null,
      [`orders/${companyId}/${branchId}`]: null,
      [`counters/${companyId}/${branchId}`]: null,
      [`taxSettings/${companyId}/${branchId}`]: null,
      [`receiptSettings/${companyId}/${branchId}`]: null,
      [`dayState/${companyId}/${branchId}`]: null,
      [`zReports/${companyId}/${branchId}`]: null,
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

export { closeBusinessDay } from './dayClose'
