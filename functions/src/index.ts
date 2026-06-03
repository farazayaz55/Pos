import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import * as admin from 'firebase-admin'

setGlobalOptions({ region: 'us-central1', maxInstances: 10 , invoker: 'public'})

admin.initializeApp()

const db = admin.database()
const auth = admin.auth()

interface SuperAdminCheck {
  uid: string
  role: 'super_admin'
}

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

    const company = {
      name: companyName,
      location,
      adminUid: userRecord.uid,
      adminEmail,
      adminName,
      active: true,
      createdAt: now,
      createdBy: caller.uid,
      ...(phone ? { phone } : {}),
      ...(logoUrl ? { logoUrl } : {}),
    }

    const userRecordDb = {
      email: adminEmail,
      name: adminName,
      role: 'admin' as const,
      companyId,
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
    const comp = compSnap.val() as { adminUid?: string } | null
    if (!comp) {
      throw new HttpsError('not-found', 'Company not found.')
    }

    if (comp.adminUid) {
      try {
        await auth.deleteUser(comp.adminUid)
      } catch (err) {
        const code = (err as { code?: string }).code
        if (code !== 'auth/user-not-found') {
          console.warn('[deleteCompany] auth deletion warning', err)
        }
      }
    }

    const updates: Record<string, null> = {
      [`companies/${companyId}`]: null,
      [`menu/${companyId}`]: null,
      [`orders/${companyId}`]: null,
      [`counters/${companyId}`]: null,
    }
    if (comp.adminUid) {
      updates[`users/${comp.adminUid}`] = null
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
    if (adminName) {
      await db.ref().update({
        [`companies/${companyId}/adminName`]: adminName,
        [`users/${comp.adminUid}/name`]: adminName,
      })
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

export {
  getTerminalConnectionToken,
  createKioskPaymentIntent,
  createKioskOrder,
  getKioskOrder,
} from './payments'
