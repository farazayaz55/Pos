import { get, onValue, ref, set, update } from 'firebase/database'
import { db } from '@/lib/firebase'
import { listActiveBranchIds } from '@/services/branches'
import type {
  BranchWriteScope,
  CompanyTaxSettings,
  TaxComponent,
  TaxConditionType,
} from '@/types'
import { generateId } from '@/utils/idGen'

export const taxSettingsRef = (companyId: string, branchId: string) =>
  ref(db, `taxSettings/${companyId}/${branchId}`)

export const subscribeTaxSettings = (
  companyId: string,
  branchId: string,
  cb: (settings: CompanyTaxSettings | null) => void,
) => {
  return onValue(taxSettingsRef(companyId, branchId), (snap) => {
    const val = snap.val() as Omit<CompanyTaxSettings, 'companyId' | 'branchId'> | null
    cb(val ? { companyId, branchId, ...val } : null)
  })
}

export const getTaxSettings = async (
  companyId: string,
  branchId: string,
): Promise<CompanyTaxSettings | null> => {
  const snap = await get(taxSettingsRef(companyId, branchId))
  const val = snap.val() as Omit<CompanyTaxSettings, 'companyId' | 'branchId'> | null
  return val ? { companyId, branchId, ...val } : null
}

const buildTaxPayload = (
  components: TaxComponent[],
  updatedBy: string,
): Omit<CompanyTaxSettings, 'companyId' | 'branchId'> => {
  const map: Record<string, TaxComponent> = {}
  components.forEach((c, i) => {
    const id = c.id || generateId('tax')
    map[id] = {
      id,
      name: c.name.trim(),
      rate: Number(c.rate),
      conditionType: c.conditionType,
      active: c.active !== false,
      sortOrder: c.sortOrder ?? i,
      ...(c.conditionType !== 'always' && c.conditionAmount != null
        ? { conditionAmount: Number(c.conditionAmount) }
        : {}),
    }
  })
  return {
    components: map,
    updatedAt: Date.now(),
    updatedBy,
  }
}

export const saveTaxSettings = async (
  companyId: string,
  branchId: string,
  components: TaxComponent[],
  updatedBy: string,
  scope: BranchWriteScope = 'this',
): Promise<void> => {
  const payload = buildTaxPayload(components, updatedBy)
  if (scope === 'this') {
    await set(taxSettingsRef(companyId, branchId), payload)
    return
  }
  const targets = await listActiveBranchIds(companyId)
  const updates: Record<string, unknown> = {}
  for (const bid of targets) {
    updates[`taxSettings/${companyId}/${bid}`] = {
      ...payload,
    }
  }
  await update(ref(db), updates)
}

export interface TaxPreset {
  id: string
  label: string
  description: string
  components: Omit<TaxComponent, 'id'>[]
}

const component = (
  name: string,
  ratePercent: number,
  conditionType: TaxConditionType,
  conditionAmount: number | undefined,
  sortOrder: number,
): Omit<TaxComponent, 'id'> => ({
  name,
  rate: ratePercent / 100,
  conditionType,
  ...(conditionAmount != null ? { conditionAmount } : {}),
  active: true,
  sortOrder,
})

/** Canadian restaurant presets — rates should be confirmed with an accountant. */
export const CANADIAN_TAX_PRESETS: TaxPreset[] = [
  {
    id: 'on',
    label: 'Ontario (HST / GST ≤ $4)',
    description:
      'CRA prepared-food point-of-sale rebate: 5% GST when taxable base ≤ $4; 13% HST above $4.',
    components: [
      component('GST', 5, 'taxableBaseLte', 4, 0),
      component('HST', 13, 'taxableBaseGt', 4, 1),
    ],
  },
  {
    id: 'ab',
    label: 'Alberta (GST 5%)',
    description: 'GST 5% on restaurant meals.',
    components: [component('GST', 5, 'always', undefined, 0)],
  },
  {
    id: 'bc',
    label: 'British Columbia (GST 5%)',
    description: 'GST 5% on meals. PST on liquor/soda is not included.',
    components: [component('GST', 5, 'always', undefined, 0)],
  },
  {
    id: 'qc',
    label: 'Quebec (GST + QST)',
    description: 'GST 5% + QST 9.975% stacked on the taxable base.',
    components: [
      component('GST', 5, 'always', undefined, 0),
      component('QST', 9.975, 'always', undefined, 1),
    ],
  },
  {
    id: 'mb',
    label: 'Manitoba (GST + RST)',
    description: 'GST 5% + RST 7% on many restaurant sales.',
    components: [
      component('GST', 5, 'always', undefined, 0),
      component('RST', 7, 'always', undefined, 1),
    ],
  },
  {
    id: 'sk',
    label: 'Saskatchewan (GST + PST)',
    description: 'GST 5% + PST 6% on many restaurant sales.',
    components: [
      component('GST', 5, 'always', undefined, 0),
      component('PST', 6, 'always', undefined, 1),
    ],
  },
  {
    id: 'ns',
    label: 'Nova Scotia (HST 14%)',
    description: 'HST 14% (as of April 2025).',
    components: [component('HST', 14, 'always', undefined, 0)],
  },
  {
    id: 'atlantic',
    label: 'Atlantic (HST 15%)',
    description: 'HST 15% for NB, NL, and PE.',
    components: [component('HST', 15, 'always', undefined, 0)],
  },
  {
    id: 'territories',
    label: 'Territories (GST 5%)',
    description: 'GST 5% for NT, NU, and YT.',
    components: [component('GST', 5, 'always', undefined, 0)],
  },
]

export const componentsFromPreset = (preset: TaxPreset): TaxComponent[] =>
  preset.components.map((c, i) => ({
    ...c,
    id: generateId('tax'),
    sortOrder: c.sortOrder ?? i,
  }))
