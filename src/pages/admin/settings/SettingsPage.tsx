import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { isDesktopApp, usePosSettingsStore } from '@/stores/posSettingsStore'
import { useCompany } from '@/hooks/useCompany'
import { useBranches } from '@/hooks/useBranches'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import { useCompanyTaxSettings } from '@/hooks/useCompanyTaxSettings'
import { useCompanyReceiptSettings } from '@/hooks/useCompanyReceiptSettings'
import { useCompanyKitchenReceiptSettings } from '@/hooks/useCompanyKitchenReceiptSettings'
import BranchWriteScopeToggle from '@/components/common/BranchWriteScopeToggle'
import type { BranchWriteScope } from '@/types'
import {
  CANADIAN_TAX_PRESETS,
  componentsFromPreset,
  saveTaxSettings,
} from '@/services/taxSettings'
import { saveReceiptSettings } from '@/services/receiptSettings'
import { saveKitchenReceiptSettings } from '@/services/kitchenReceiptSettings'
import type {
  DesktopDisplayInfo,
  DesktopPrinter,
  UpdateEventPayload,
  UpdateStatus,
} from '@/types/desktop'
import type {
  CompanyKitchenReceiptSettings,
  Order,
  ReceiptAlign,
  ReceiptBlock,
  ReceiptBlockType,
  TaxComponent,
  TaxConditionType,
} from '@/types'
import { can } from '@/utils/permissions'
import { generateId } from '@/utils/idGen'
import {
  RECEIPT_BLOCK_LABELS,
  RECEIPT_BLOCK_TYPES,
  blockSupportsAlign,
  blockSupportsLabel,
  createReceiptBlock,
  defaultReceiptBlocks,
  resolveReceiptBlocks,
} from '@/utils/receiptBlocks'
import ReceiptDocument, {
  SAMPLE_RECEIPT_ORDER,
} from '@/components/receipt/ReceiptDocument'
import KitchenReceiptDocument from '@/components/receipt/KitchenReceiptDocument'
import { cn } from '@/utils/cn'

type ItemKitchenOverride = 'follow' | 'include' | 'exclude'

const ALIGN_OPTIONS: { value: ReceiptAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

const updateStatusLabel = (status: UpdateStatus): string => {
  switch (status) {
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return 'Update available — downloading…'
    case 'not-available':
      return 'You are up to date'
    case 'downloading':
      return 'Downloading update…'
    case 'downloaded':
      return 'Update ready — restart to install'
    case 'error':
      return 'Update check failed'
    default:
      return 'No update check yet'
  }
}

const emptyComponent = (sortOrder: number): TaxComponent => ({
  id: generateId('tax'),
  name: '',
  rate: 0.05,
  conditionType: 'always',
  active: true,
  sortOrder,
})

const rateToPercentInput = (rate: number) => {
  const pct = rate * 100
  return Number.isInteger(pct) ? String(pct) : String(Math.round(pct * 1000) / 1000)
}

const SettingsPage = () => {
  const desktop = isDesktopApp()
  const user = useAuthStore((s) => s.user)
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const branchId = useCompanyContextStore((s) => s.activeBranchId) || ''
  const { company } = useCompany(companyId)
  const { branches } = useBranches(companyId || undefined)
  const activeBranch = branches.find((b) => b.id === branchId) ?? null
  const receiptPreviewCompany =
    company && activeBranch
      ? {
          ...company,
          location: activeBranch.location || company.location,
          phone: activeBranch.phone ?? company.phone,
        }
      : company
  const { settings, loading: taxLoading } = useCompanyTaxSettings(
    companyId,
    branchId || undefined,
  )
  const {
    settings: receiptRemote,
    loading: receiptLoading,
    error: receiptError,
  } = useCompanyReceiptSettings(companyId, branchId || undefined)
  const {
    settings: kitchenRemote,
    loading: kitchenLoading,
    error: kitchenError,
  } = useCompanyKitchenReceiptSettings(companyId, branchId || undefined)
  const { categories, items: menuItems } = useCompanyMenu(
    companyId || undefined,
    branchId || undefined,
  )
  const [taxWriteScope, setTaxWriteScope] = useState<BranchWriteScope>('this')
  const showTaxScopeToggle = user?.role === 'admin' || user?.role === 'super_admin'

  const canSettings = can(user, 'settings')
  const canReceipt = can(user, 'receipt')
  /** Device printer / auto-print — available with receipt or full settings access. */
  const canPrinter = canSettings || canReceipt

  const receiptPrinterName = usePosSettingsStore((s) => s.receiptPrinterName)
  const autoPrint = usePosSettingsStore((s) => s.autoPrint)
  const autoPrintKitchen = usePosSettingsStore((s) => s.autoPrintKitchen)
  const customerDisplayEnabled = usePosSettingsStore((s) => s.customerDisplayEnabled)
  const customerDisplayId = usePosSettingsStore((s) => s.customerDisplayId)
  const setReceiptPrinterName = usePosSettingsStore((s) => s.setReceiptPrinterName)
  const setAutoPrint = usePosSettingsStore((s) => s.setAutoPrint)
  const setAutoPrintKitchen = usePosSettingsStore((s) => s.setAutoPrintKitchen)
  const setCustomerDisplayEnabled = usePosSettingsStore((s) => s.setCustomerDisplayEnabled)
  const setCustomerDisplayId = usePosSettingsStore((s) => s.setCustomerDisplayId)

  const [printers, setPrinters] = useState<DesktopPrinter[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(desktop)
  const [selectedPrinter, setSelectedPrinter] = useState(receiptPrinterName ?? '')
  const [autoPrintLocal, setAutoPrintLocal] = useState(autoPrint)
  const [autoPrintKitchenLocal, setAutoPrintKitchenLocal] = useState(autoPrintKitchen)
  const [testing, setTesting] = useState(false)

  const [displays, setDisplays] = useState<DesktopDisplayInfo[]>([])
  const [loadingDisplays, setLoadingDisplays] = useState(desktop)
  const [cfdEnabledLocal, setCfdEnabledLocal] = useState(customerDisplayEnabled)
  const [cfdDisplayIdLocal, setCfdDisplayIdLocal] = useState<string>(
    customerDisplayId != null ? String(customerDisplayId) : '',
  )
  const [identifyingDisplays, setIdentifyingDisplays] = useState(false)
  const [cfdBusy, setCfdBusy] = useState(false)

  const [taxComponents, setTaxComponents] = useState<TaxComponent[]>([])
  const [savingTax, setSavingTax] = useState(false)
  const [taxDirty, setTaxDirty] = useState(false)

  const [receiptBlocks, setReceiptBlocks] = useState<ReceiptBlock[]>([])
  const [receiptDirty, setReceiptDirty] = useState(false)
  const [savingReceipt, setSavingReceipt] = useState(false)
  const [addBlockType, setAddBlockType] = useState<ReceiptBlockType>('text')

  const [kitchenDraft, setKitchenDraft] = useState<CompanyKitchenReceiptSettings | null>(
    null,
  )
  const [kitchenDirty, setKitchenDirty] = useState(false)
  const [savingKitchen, setSavingKitchen] = useState(false)
  const [expandedKitchenCats, setExpandedKitchenCats] = useState<Set<string>>(
    () => new Set(),
  )

  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateEventPayload | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)

  useEffect(() => {
    setSelectedPrinter(receiptPrinterName ?? '')
    setAutoPrintLocal(autoPrint)
    setAutoPrintKitchenLocal(autoPrintKitchen)
  }, [receiptPrinterName, autoPrint, autoPrintKitchen])

  useEffect(() => {
    setCfdEnabledLocal(customerDisplayEnabled)
    setCfdDisplayIdLocal(customerDisplayId != null ? String(customerDisplayId) : '')
  }, [customerDisplayEnabled, customerDisplayId])

  useEffect(() => {
    if (!desktop || !window.posDesktop) return
    let cancelled = false
    const desktopApi = window.posDesktop

    void (async () => {
      try {
        const [version, status] = await Promise.all([
          desktopApi.getAppVersion(),
          desktopApi.getUpdateStatus(),
        ])
        if (!cancelled) {
          setAppVersion(version)
          setUpdateInfo(status)
        }
      } catch {
        // Updater unavailable in unexpected environments
      }
    })()

    const unsubscribe = desktopApi.onUpdateEvent((payload) => {
      if (cancelled) return
      setUpdateInfo(payload)
      setAppVersion(payload.version)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [desktop])

  useEffect(() => {
    if (taxDirty) return
    if (!settings?.components) {
      setTaxComponents([])
      return
    }
    const list = Object.values(settings.components).sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    )
    setTaxComponents(list)
  }, [settings, taxDirty])

  useEffect(() => {
    if (receiptDirty) return
    setReceiptBlocks(resolveReceiptBlocks(receiptRemote))
  }, [receiptRemote, receiptDirty])

  useEffect(() => {
    if (kitchenDirty) return
    setKitchenDraft(kitchenRemote)
  }, [kitchenRemote, kitchenDirty])

  useEffect(() => {
    if (!kitchenError || !canReceipt) return
    toast.error(
      kitchenError.message.includes('PERMISSION') ||
        kitchenError.code === 'PERMISSION_DENIED'
        ? 'Cannot load kitchen receipt settings — deploy database rules (npm run deploy:rules).'
        : kitchenError.message,
    )
  }, [kitchenError, canReceipt])

  useEffect(() => {
    if (!receiptError || !canReceipt) return
    toast.error(
      receiptError.message.includes('PERMISSION') ||
        receiptError.code === 'PERMISSION_DENIED'
        ? 'Cannot load receipt settings — deploy database rules (npm run deploy:rules).'
        : receiptError.message,
    )
  }, [receiptError, canReceipt])

  useEffect(() => {
    if (!desktop || !window.posDesktop) return
    let cancelled = false
    void (async () => {
      try {
        const list = await window.posDesktop!.getPrinters()
        if (!cancelled) setPrinters(list)
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load printers')
        }
      } finally {
        if (!cancelled) setLoadingPrinters(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [desktop])

  const handleSavePrinter = () => {
    setReceiptPrinterName(selectedPrinter || null)
    setAutoPrint(autoPrintLocal)
    setAutoPrintKitchen(autoPrintKitchenLocal)
    toast.success('Printer settings saved')
  }

  const patchKitchenDraft = (
    patch: Partial<
      Pick<
        CompanyKitchenReceiptSettings,
        'excludedCategoryIds' | 'excludedItemIds' | 'includedItemIds'
      >
    >,
  ) => {
    setKitchenDraft((prev) => {
      if (!prev) return prev
      return { ...prev, ...patch }
    })
    setKitchenDirty(true)
  }

  const toggleKitchenCategory = (categoryId: string, excluded: boolean) => {
    if (!kitchenDraft) return
    const set = new Set(kitchenDraft.excludedCategoryIds)
    if (excluded) set.add(categoryId)
    else set.delete(categoryId)
    patchKitchenDraft({ excludedCategoryIds: [...set] })
  }

  const getItemKitchenOverride = (itemId: string): ItemKitchenOverride => {
    if (!kitchenDraft) return 'follow'
    if (kitchenDraft.includedItemIds.includes(itemId)) return 'include'
    if (kitchenDraft.excludedItemIds.includes(itemId)) return 'exclude'
    return 'follow'
  }

  const setItemKitchenOverride = (itemId: string, state: ItemKitchenOverride) => {
    if (!kitchenDraft) return
    const included = new Set(kitchenDraft.includedItemIds)
    const excluded = new Set(kitchenDraft.excludedItemIds)
    included.delete(itemId)
    excluded.delete(itemId)
    if (state === 'include') included.add(itemId)
    if (state === 'exclude') excluded.add(itemId)
    patchKitchenDraft({
      includedItemIds: [...included],
      excludedItemIds: [...excluded],
    })
  }

  const toggleKitchenCatExpanded = (categoryId: string) => {
    setExpandedKitchenCats((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const handleSaveKitchen = async () => {
    if (!user || !companyId || !branchId || !kitchenDraft) return
    setSavingKitchen(true)
    try {
      await saveKitchenReceiptSettings(
        companyId,
        branchId,
        {
          excludedCategoryIds: kitchenDraft.excludedCategoryIds,
          excludedItemIds: kitchenDraft.excludedItemIds,
          includedItemIds: kitchenDraft.includedItemIds,
        },
        user.uid,
      )
      setKitchenDirty(false)
      toast.success('Kitchen receipt settings saved')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save kitchen receipt settings',
      )
    } finally {
      setSavingKitchen(false)
    }
  }

  const kitchenPreviewOrder = useMemo((): Order => {
    const sampleItems = menuItems.slice(0, 8).map((item, index) => ({
      lineId: `kitchen-preview-${item.id}`,
      itemId: item.id,
      itemName: item.name,
      categoryId: item.categoryId,
      basePrice: item.basePrice,
      quantity: index === 0 ? 2 : 1,
      modifiers: [],
      unitPrice: item.basePrice,
      lineTotal: item.basePrice * (index === 0 ? 2 : 1),
      ...(index === 1 ? { note: 'No onions' } : {}),
    }))
    return {
      ...SAMPLE_RECEIPT_ORDER,
      companyId: companyId || 'preview',
      branchId: branchId || 'preview-branch',
      tableNumber: '12',
      items:
        sampleItems.length > 0
          ? sampleItems
          : SAMPLE_RECEIPT_ORDER.items.map((it) => ({
              ...it,
              note: it.lineId === '2' ? 'Extra sauce' : it.note,
            })),
    }
  }, [menuItems, companyId, branchId])

  const handleTestPrint = async () => {
    if (!selectedPrinter || !window.posDesktop) {
      toast.error('Select a printer first')
      return
    }
    setTesting(true)
    try {
      const result = await window.posDesktop.testPrint({
        deviceName: selectedPrinter,
      })
      if (!result.success) {
        throw new Error(result.error || 'Test print failed')
      }
      toast.success('Test print sent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test print failed')
    } finally {
      setTesting(false)
    }
  }

  const handleRefreshPrinters = async () => {
    if (!window.posDesktop) return
    setLoadingPrinters(true)
    try {
      const list = await window.posDesktop.getPrinters()
      setPrinters(list)
      toast.success('Printer list refreshed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh printers')
    } finally {
      setLoadingPrinters(false)
    }
  }

  useEffect(() => {
    if (!desktop || !window.posDesktop) return
    let cancelled = false
    void (async () => {
      try {
        const list = await window.posDesktop!.getDisplays()
        if (!cancelled) setDisplays(list)
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load displays')
        }
      } finally {
        if (!cancelled) setLoadingDisplays(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [desktop])

  const handleRefreshDisplays = async () => {
    if (!window.posDesktop) return
    setLoadingDisplays(true)
    try {
      const list = await window.posDesktop.getDisplays()
      setDisplays(list)
      toast.success('Display list refreshed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to refresh displays')
    } finally {
      setLoadingDisplays(false)
    }
  }

  const handleSaveCustomerDisplay = () => {
    setCustomerDisplayEnabled(cfdEnabledLocal)
    setCustomerDisplayId(cfdDisplayIdLocal ? Number(cfdDisplayIdLocal) : null)
    toast.success('Customer display settings saved')
  }

  const handleIdentifyDisplays = async () => {
    if (!window.posDesktop) return
    setIdentifyingDisplays(true)
    try {
      await window.posDesktop.identifyDisplays()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not identify displays')
    } finally {
      setIdentifyingDisplays(false)
    }
  }

  const handleOpenCustomerDisplay = async () => {
    if (!window.posDesktop) return
    setCfdBusy(true)
    try {
      const id = cfdDisplayIdLocal ? Number(cfdDisplayIdLocal) : null
      setCustomerDisplayEnabled(true)
      setCfdEnabledLocal(true)
      setCustomerDisplayId(id)
      await window.posDesktop.openCustomerDisplay({ displayId: id })
      toast.success('Customer display opened')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open customer display')
    } finally {
      setCfdBusy(false)
    }
  }

  const handleCloseCustomerDisplay = async () => {
    if (!window.posDesktop) return
    setCfdBusy(true)
    try {
      await window.posDesktop.closeCustomerDisplay()
      toast.success('Customer display closed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close customer display')
    } finally {
      setCfdBusy(false)
    }
  }

  const handleCheckForUpdates = async () => {
    if (!window.posDesktop) return
    setCheckingUpdate(true)
    try {
      const status = await window.posDesktop.checkForUpdates()
      setUpdateInfo(status)
      if (status.status === 'not-available') {
        toast.success('You are up to date')
      } else if (status.status === 'error' && status.error) {
        toast.error(status.error)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update check failed')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleInstallUpdate = async () => {
    if (!window.posDesktop) return
    setInstallingUpdate(true)
    try {
      const result = await window.posDesktop.installUpdate()
      if (!result.success) {
        throw new Error(result.error || 'Install failed')
      }
    } catch (err) {
      setInstallingUpdate(false)
      toast.error(err instanceof Error ? err.message : 'Failed to install update')
    }
  }

  const updateComponent = (id: string, patch: Partial<TaxComponent>) => {
    setTaxDirty(true)
    setTaxComponents((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const handleAddComponent = () => {
    setTaxDirty(true)
    setTaxComponents((list) => [...list, emptyComponent(list.length)])
  }

  const handleRemoveComponent = (id: string) => {
    setTaxDirty(true)
    setTaxComponents((list) => list.filter((c) => c.id !== id))
  }

  const handleApplyPreset = (presetId: string) => {
    const preset = CANADIAN_TAX_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    setTaxDirty(true)
    setTaxComponents(componentsFromPreset(preset))
    toast.success(`Loaded ${preset.label} — save to apply`)
  }

  const handleSaveTax = async () => {
    if (!companyId || !branchId || !user) {
      toast.error('Missing company or branch context')
      return
    }
    for (const c of taxComponents) {
      if (!c.name.trim()) {
        toast.error('Each tax component needs a name')
        return
      }
      if (!(Number(c.rate) > 0) || Number(c.rate) > 1) {
        toast.error('Rates must be greater than 0% and at most 100%')
        return
      }
      if (
        (c.conditionType === 'taxableBaseLte' || c.conditionType === 'taxableBaseGt') &&
        !(Number(c.conditionAmount) >= 0)
      ) {
        toast.error(`Set a threshold amount for ${c.name}`)
        return
      }
    }
    setSavingTax(true)
    try {
      await saveTaxSettings(
        companyId,
        branchId,
        taxComponents,
        user.uid,
        taxWriteScope,
      )
      setTaxDirty(false)
      toast.success('Tax settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save tax settings')
    } finally {
      setSavingTax(false)
    }
  }

  const updateReceiptBlock = (id: string, patch: Partial<ReceiptBlock>) => {
    setReceiptDirty(true)
    setReceiptBlocks((list) =>
      list.map((block) => (block.id === id ? { ...block, ...patch } : block)),
    )
  }

  const addReceiptBlock = () => {
    setReceiptDirty(true)
    setReceiptBlocks((list) => [...list, createReceiptBlock(addBlockType)])
  }

  const removeReceiptBlock = (id: string) => {
    setReceiptDirty(true)
    setReceiptBlocks((list) => list.filter((block) => block.id !== id))
  }

  const moveReceiptBlock = (id: string, dir: -1 | 1) => {
    setReceiptDirty(true)
    setReceiptBlocks((list) => {
      const idx = list.findIndex((b) => b.id === id)
      if (idx < 0) return list
      const next = idx + dir
      if (next < 0 || next >= list.length) return list
      const copy = [...list]
      const [item] = copy.splice(idx, 1)
      copy.splice(next, 0, item)
      return copy
    })
  }

  const handleResetReceipt = () => {
    if (!window.confirm('Reset receipt template to the default layout?')) return
    setReceiptDirty(true)
    setReceiptBlocks(defaultReceiptBlocks())
  }

  const handleSaveReceipt = async () => {
    if (!companyId || !branchId || !user) {
      toast.error('Missing company or branch context')
      return
    }
    setSavingReceipt(true)
    try {
      await saveReceiptSettings(companyId, branchId, receiptBlocks, user.uid)
      setReceiptDirty(false)
      toast.success('Receipt template saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save receipt template')
    } finally {
      setSavingReceipt(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure tax, receipt content, and POS printing for this company and device.
        </p>
      </div>

      {canSettings && (
      <div className="card space-y-6 p-6">
        <section>
          <h2 className="text-sm font-semibold text-slate-900">Tax groups</h2>
          <p className="mt-1 text-sm text-slate-500">
            Condition-based tax components apply automatically to every order. Matching
            components stack (e.g. GST + QST). Confirm rates with your accountant — Ontario
            CRA prepared-food rebate threshold is $4.00.
          </p>

          {!companyId ? (
            <p className="mt-3 text-sm text-amber-700">Select a company to edit tax settings.</p>
          ) : taxLoading && !taxDirty ? (
            <p className="mt-3 text-sm text-slate-400">Loading tax settings…</p>
          ) : (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Canadian preset
                </span>
                <select
                  className="input w-full"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      handleApplyPreset(e.target.value)
                      e.target.value = ''
                    }
                  }}
                >
                  <option value="">Apply a preset…</option>
                  {CANADIAN_TAX_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              {taxComponents.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  No tax components configured. Orders will have 0% tax until you add
                  components or apply a preset.
                </p>
              ) : (
                <ul className="space-y-3">
                  {taxComponents.map((c) => (
                    <li
                      key={c.id}
                      className="space-y-3 rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex flex-wrap gap-2">
                        <label className="min-w-[120px] flex-1">
                          <span className="mb-1 block text-xs font-medium text-slate-600">
                            Name
                          </span>
                          <input
                            className="input w-full"
                            value={c.name}
                            placeholder="e.g. HST"
                            onChange={(e) => updateComponent(c.id, { name: e.target.value })}
                          />
                        </label>
                        <label className="w-28">
                          <span className="mb-1 block text-xs font-medium text-slate-600">
                            Rate %
                          </span>
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            max="100"
                            className="input w-full"
                            value={rateToPercentInput(c.rate)}
                            onChange={(e) =>
                              updateComponent(c.id, {
                                rate: (Number(e.target.value) || 0) / 100,
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-[180px] flex-1">
                          <span className="mb-1 block text-xs font-medium text-slate-600">
                            Condition
                          </span>
                          <select
                            className="input w-full"
                            value={c.conditionType}
                            onChange={(e) => {
                              const conditionType = e.target.value as TaxConditionType
                              updateComponent(c.id, {
                                conditionType,
                                ...(conditionType === 'always'
                                  ? { conditionAmount: undefined }
                                  : {
                                      conditionAmount:
                                        c.conditionAmount != null ? c.conditionAmount : 4,
                                    }),
                              })
                            }}
                          >
                            <option value="always">Always apply</option>
                            <option value="taxableBaseLte">
                              When taxable base ≤ amount
                            </option>
                            <option value="taxableBaseGt">
                              When taxable base &gt; amount
                            </option>
                          </select>
                        </label>
                        {c.conditionType !== 'always' && (
                          <label className="w-32">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              Amount ($)
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="input w-full"
                              value={c.conditionAmount ?? ''}
                              onChange={(e) =>
                                updateComponent(c.id, {
                                  conditionAmount: Number(e.target.value) || 0,
                                })
                              }
                            />
                          </label>
                        )}
                        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            checked={c.active !== false}
                            onChange={(e) =>
                              updateComponent(c.id, { active: e.target.checked })
                            }
                          />
                          Active
                        </label>
                        <button
                          type="button"
                          className="btn-secondary mb-0.5 text-red-700"
                          onClick={() => handleRemoveComponent(c.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {showTaxScopeToggle && (
                  <BranchWriteScopeToggle
                    value={taxWriteScope}
                    onChange={setTaxWriteScope}
                    disabled={savingTax}
                  />
                )}
                <button type="button" className="btn-secondary" onClick={handleAddComponent}>
                  Add component
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingTax || !companyId || !branchId}
                  onClick={() => void handleSaveTax()}
                >
                  {savingTax ? 'Saving…' : 'Save tax settings'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
      )}

      {canReceipt && (
        <div className="card space-y-6 p-6">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Receipt template</h2>
            <p className="mt-1 text-sm text-slate-500">
              Build the full receipt from ordered blocks: custom text, company fields,
              and order fields. Reorder, align, and save. Logo and company name values
              still come from the company profile.
            </p>

            {!companyId ? (
              <p className="mt-3 text-sm text-amber-700">
                Select a company to edit the receipt template.
              </p>
            ) : receiptLoading && !receiptDirty ? (
              <p className="mt-3 text-sm text-slate-400">Loading receipt template…</p>
            ) : (
              <div className="mt-4 space-y-6">
                <ul className="space-y-3">
                  {receiptBlocks.map((block, index) => (
                    <li
                      key={block.id}
                      className="rounded-lg border border-slate-200 bg-slate-50/80 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                          {RECEIPT_BLOCK_LABELS[block.type]}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={index === 0}
                            onClick={() => moveReceiptBlock(block.id, -1)}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            disabled={index === receiptBlocks.length - 1}
                            onClick={() => moveReceiptBlock(block.id, 1)}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs text-red-700"
                            onClick={() => removeReceiptBlock(block.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-end gap-2">
                        {block.type === 'text' && (
                          <label className="min-w-[160px] flex-1">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              Text
                            </span>
                            <input
                              type="text"
                              className="input w-full"
                              value={block.text ?? ''}
                              placeholder="e.g. 123 Main St · (555) 0100"
                              onChange={(e) =>
                                updateReceiptBlock(block.id, { text: e.target.value })
                              }
                            />
                          </label>
                        )}
                        {block.type === 'thankYou' && (
                          <label className="min-w-[160px] flex-1">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              Thank-you text
                            </span>
                            <input
                              type="text"
                              className="input w-full"
                              value={block.text ?? ''}
                              placeholder="Thank you!"
                              onChange={(e) =>
                                updateReceiptBlock(block.id, { text: e.target.value })
                              }
                            />
                          </label>
                        )}
                        {blockSupportsLabel(block.type) && (
                          <label className="w-36">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              Label
                            </span>
                            <input
                              type="text"
                              className="input w-full"
                              value={block.label ?? ''}
                              placeholder={RECEIPT_BLOCK_LABELS[block.type]}
                              onChange={(e) =>
                                updateReceiptBlock(block.id, { label: e.target.value })
                              }
                            />
                          </label>
                        )}
                        {blockSupportsAlign(block.type) && (
                          <label className="w-28">
                            <span className="mb-1 block text-xs font-medium text-slate-600">
                              Align
                            </span>
                            <select
                              className="input w-full"
                              value={block.align ?? 'left'}
                              onChange={(e) =>
                                updateReceiptBlock(block.id, {
                                  align: e.target.value as ReceiptAlign,
                                })
                              }
                            >
                              {ALIGN_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-[180px] flex-1">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Add block
                    </span>
                    <select
                      className="input w-full"
                      value={addBlockType}
                      onChange={(e) =>
                        setAddBlockType(e.target.value as ReceiptBlockType)
                      }
                    >
                      {RECEIPT_BLOCK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {RECEIPT_BLOCK_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn-secondary" onClick={addReceiptBlock}>
                    Add
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleResetReceipt}
                  >
                    Reset to default
                  </button>
                </div>

                <div className="border-t border-slate-100 pt-6">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Preview
                  </h3>
                  <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 py-4">
                    <ReceiptDocument
                      id="receipt-preview"
                      order={{
                        ...SAMPLE_RECEIPT_ORDER,
                        companyId: companyId || 'preview',
                      }}
                      company={receiptPreviewCompany}
                      blocks={receiptBlocks}
                      className="shadow-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingReceipt || !companyId || !branchId}
                  onClick={() => void handleSaveReceipt()}
                >
                  {savingReceipt ? 'Saving…' : 'Save receipt template'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {canReceipt && (
        <div className="card space-y-6 p-6">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Kitchen receipt</h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose which categories appear on kitchen tickets. Override individual
              items to always include or always exclude them.
            </p>

            {!companyId || !branchId ? (
              <p className="mt-3 text-sm text-amber-700">
                Select a company and branch to edit kitchen receipt settings.
              </p>
            ) : kitchenLoading && !kitchenDirty ? (
              <p className="mt-3 text-sm text-slate-400">Loading kitchen settings…</p>
            ) : !kitchenDraft ? (
              <p className="mt-3 text-sm text-slate-400">Loading kitchen settings…</p>
            ) : (
              <div className="mt-4 space-y-4">
                {categories.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No categories yet. Add menu categories first.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {categories
                      .slice()
                      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                      .map((cat) => {
                        const excluded = kitchenDraft.excludedCategoryIds.includes(
                          cat.id,
                        )
                        const catItems = menuItems
                          .filter((i) => i.categoryId === cat.id)
                          .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
                        const expanded = expandedKitchenCats.has(cat.id)
                        return (
                          <li
                            key={cat.id}
                            className="rounded-lg border border-slate-200 bg-slate-50/80"
                          >
                            <div className="flex flex-wrap items-center gap-3 p-3">
                              <button
                                type="button"
                                className="text-left text-sm font-medium text-slate-900"
                                onClick={() => toggleKitchenCatExpanded(cat.id)}
                              >
                                <span className="mr-2 text-slate-400">
                                  {expanded ? '▾' : '▸'}
                                </span>
                                {cat.name}
                                <span className="ml-2 text-xs font-normal text-slate-500">
                                  ({catItems.length} items)
                                </span>
                              </button>
                              <div className="ml-auto flex items-center gap-2">
                                <span className="text-xs text-slate-500">
                                  {excluded ? 'Excluded' : 'Included'}
                                </span>
                                <button
                                  type="button"
                                  className={cn(
                                    'rounded-md px-2.5 py-1 text-xs font-medium',
                                    excluded
                                      ? 'bg-slate-200 text-slate-700'
                                      : 'bg-brand-600 text-white',
                                  )}
                                  onClick={() =>
                                    toggleKitchenCategory(cat.id, !excluded)
                                  }
                                >
                                  {excluded ? 'Include category' : 'Exclude category'}
                                </button>
                              </div>
                            </div>
                            {expanded && (
                              <div className="border-t border-slate-200 px-3 py-2">
                                {catItems.length === 0 ? (
                                  <p className="py-1 text-xs text-slate-400">
                                    No items in this category.
                                  </p>
                                ) : (
                                  <ul className="space-y-2 py-1">
                                    {catItems.map((item) => {
                                      const override = getItemKitchenOverride(item.id)
                                      return (
                                        <li
                                          key={item.id}
                                          className="flex flex-wrap items-center gap-2"
                                        >
                                          <span className="min-w-0 flex-1 text-sm text-slate-800">
                                            {item.name}
                                          </span>
                                          <div className="flex flex-wrap gap-1">
                                            {(
                                              [
                                                ['follow', 'Follow'],
                                                ['include', 'Always include'],
                                                ['exclude', 'Always exclude'],
                                              ] as const
                                            ).map(([value, label]) => (
                                              <button
                                                key={value}
                                                type="button"
                                                className={cn(
                                                  'rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                  override === value
                                                    ? 'bg-brand-600 text-white'
                                                    : 'bg-white text-slate-600 ring-1 ring-slate-200',
                                                )}
                                                onClick={() =>
                                                  setItemKitchenOverride(item.id, value)
                                                }
                                              >
                                                {label}
                                              </button>
                                            ))}
                                          </div>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                  </ul>
                )}

                <div className="border-t border-slate-100 pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Preview
                  </h3>
                  <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 py-4">
                    <KitchenReceiptDocument
                      id="kitchen-receipt-settings-preview"
                      order={kitchenPreviewOrder}
                      settings={kitchenDraft}
                      className="shadow-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingKitchen || !kitchenDirty}
                  onClick={() => void handleSaveKitchen()}
                >
                  {savingKitchen ? 'Saving…' : 'Save kitchen receipt settings'}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {canSettings && desktop && (
        <div className="card space-y-4 p-6">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">Customer display</h2>
            <p className="mt-1 text-sm text-slate-500">
              Show the live order on a second monitor facing the customer. Works with
              dual-screen POS terminals and external monitors.
            </p>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={cfdEnabledLocal}
                  onChange={(e) => setCfdEnabledLocal(e.target.checked)}
                />
                Enable customer display
              </label>

              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[220px] flex-1">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Screen
                  </span>
                  <select
                    className="input w-full"
                    value={cfdDisplayIdLocal}
                    disabled={loadingDisplays}
                    onChange={(e) => setCfdDisplayIdLocal(e.target.value)}
                  >
                    <option value="">Auto (second screen if available)</option>
                    {displays.map((d, index) => (
                      <option key={d.id} value={String(d.id)}>
                        Display {index + 1}
                        {d.isPrimary ? ' · Primary' : ''} — {d.width}×{d.height}
                        {d.label ? ` (${d.label})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleRefreshDisplays()}
                  disabled={loadingDisplays}
                >
                  Refresh
                </button>
              </div>

              {loadingDisplays && (
                <p className="text-xs text-slate-400">Loading displays…</p>
              )}
              {!loadingDisplays && displays.length < 2 && (
                <p className="text-sm text-amber-700">
                  Only one display detected. Connect a second screen for a dedicated
                  customer view.
                </p>
              )}

              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSaveCustomerDisplay}
                >
                  Save customer display
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={identifyingDisplays}
                  onClick={() => void handleIdentifyDisplays()}
                >
                  {identifyingDisplays ? 'Showing…' : 'Identify screens'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={cfdBusy}
                  onClick={() => void handleOpenCustomerDisplay()}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={cfdBusy}
                  onClick={() => void handleCloseCustomerDisplay()}
                >
                  Close
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {canSettings && desktop && (
        <div className="card space-y-4 p-6">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">App updates</h2>
            <p className="mt-1 text-sm text-slate-500">
              Desktop builds check GitHub Releases automatically and prompt when an update is ready.
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Installed version</dt>
                <dd className="font-medium text-slate-900">{appVersion || '…'}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Status</dt>
                <dd className="text-right text-slate-800">
                  {updateInfo
                    ? updateStatusLabel(updateInfo.status)
                    : 'No update check yet'}
                  {updateInfo?.status === 'downloading' &&
                    updateInfo.progress != null &&
                    ` (${updateInfo.progress}%)`}
                  {updateInfo?.availableVersion &&
                    (updateInfo.status === 'available' ||
                      updateInfo.status === 'downloading' ||
                      updateInfo.status === 'downloaded') && (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        Version {updateInfo.availableVersion}
                      </span>
                    )}
                  {updateInfo?.status === 'error' && updateInfo.error && (
                    <span className="mt-0.5 block text-xs text-red-600">
                      {updateInfo.error}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {(updateInfo?.status === 'downloading' ||
              updateInfo?.status === 'available') &&
              updateInfo.progress != null && (
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, updateInfo.progress))}%` }}
                  />
                </div>
              )}
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={
                  checkingUpdate ||
                  updateInfo?.status === 'checking' ||
                  updateInfo?.status === 'downloading'
                }
                onClick={() => void handleCheckForUpdates()}
              >
                {checkingUpdate || updateInfo?.status === 'checking'
                  ? 'Checking…'
                  : 'Check for updates'}
              </button>
              {updateInfo?.status === 'downloaded' && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={installingUpdate}
                  onClick={() => void handleInstallUpdate()}
                >
                  {installingUpdate ? 'Restarting…' : 'Restart to update'}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {canPrinter && (
      <div className="card space-y-6 p-6">
        <section>
          <h2 className="text-sm font-semibold text-slate-900">Receipt printer</h2>
          {desktop ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-slate-500">
                Receipts print silently to the selected printer — no dialog. Install the
                printer in macOS or Windows first, then choose it here.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="block min-w-[240px] flex-1">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Printer
                  </span>
                  <select
                    className="input w-full"
                    value={selectedPrinter}
                    disabled={loadingPrinters}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                  >
                    <option value="">Select a printer…</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName || p.name}
                        {p.isDefault ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleRefreshPrinters()}
                  disabled={loadingPrinters}
                >
                  Refresh
                </button>
              </div>
              {loadingPrinters && (
                <p className="text-xs text-slate-400">Loading printers…</p>
              )}
              {!loadingPrinters && printers.length === 0 && (
                <p className="text-sm text-amber-700">
                  No printers found. Add a printer in system settings, then refresh.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Silent printing and printer selection require the{' '}
              <span className="font-medium">desktop app</span> (Windows / macOS). In the
              browser, printing still uses the system print dialog.
            </p>
          )}
        </section>

        <section className="border-t border-slate-100 pt-6">
          <h2 className="text-sm font-semibold text-slate-900">Auto-print</h2>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={autoPrintLocal}
              onChange={(e) => setAutoPrintLocal(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                Print automatically when opening a receipt
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Applies after checkout and when opening a receipt from order history.
              </span>
            </span>
          </label>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              checked={autoPrintKitchenLocal}
              onChange={(e) => setAutoPrintKitchenLocal(e.target.checked)}
              disabled={!autoPrintLocal}
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                Also print kitchen ticket
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Prints on the same receipt printer right after the customer receipt.
                Skipped when the order has no kitchen items.
              </span>
            </span>
          </label>
        </section>

        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-6">
          <button type="button" className="btn-primary" onClick={handleSavePrinter}>
            Save printer settings
          </button>
          {desktop && (
            <button
              type="button"
              className={cn('btn-secondary', testing && 'opacity-60')}
              disabled={testing || !selectedPrinter}
              onClick={() => void handleTestPrint()}
            >
              {testing ? 'Printing…' : 'Test print'}
            </button>
          )}
        </div>
      </div>
      )}
    </div>
  )
}

export default SettingsPage
