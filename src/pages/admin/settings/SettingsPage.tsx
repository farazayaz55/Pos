import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/stores/authStore'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { isDesktopApp, usePosSettingsStore } from '@/stores/posSettingsStore'
import { useCompanyTaxSettings } from '@/hooks/useCompanyTaxSettings'
import {
  CANADIAN_TAX_PRESETS,
  componentsFromPreset,
  saveTaxSettings,
} from '@/services/taxSettings'
import type { DesktopPrinter, UpdateEventPayload, UpdateStatus } from '@/types/desktop'
import type { TaxComponent, TaxConditionType } from '@/types'
import { generateId } from '@/utils/idGen'
import { cn } from '@/utils/cn'

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
  const { settings, loading: taxLoading } = useCompanyTaxSettings(companyId)

  const receiptPrinterName = usePosSettingsStore((s) => s.receiptPrinterName)
  const autoPrint = usePosSettingsStore((s) => s.autoPrint)
  const setReceiptPrinterName = usePosSettingsStore((s) => s.setReceiptPrinterName)
  const setAutoPrint = usePosSettingsStore((s) => s.setAutoPrint)

  const [printers, setPrinters] = useState<DesktopPrinter[]>([])
  const [loadingPrinters, setLoadingPrinters] = useState(desktop)
  const [selectedPrinter, setSelectedPrinter] = useState(receiptPrinterName ?? '')
  const [autoPrintLocal, setAutoPrintLocal] = useState(autoPrint)
  const [testing, setTesting] = useState(false)

  const [taxComponents, setTaxComponents] = useState<TaxComponent[]>([])
  const [savingTax, setSavingTax] = useState(false)
  const [taxDirty, setTaxDirty] = useState(false)

  const [appVersion, setAppVersion] = useState('')
  const [updateInfo, setUpdateInfo] = useState<UpdateEventPayload | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)

  useEffect(() => {
    setSelectedPrinter(receiptPrinterName ?? '')
    setAutoPrintLocal(autoPrint)
  }, [receiptPrinterName, autoPrint])

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
    toast.success('Printer settings saved')
  }

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
    if (!companyId || !user) {
      toast.error('Missing company context')
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
      await saveTaxSettings(companyId, taxComponents, user.uid)
      setTaxDirty(false)
      toast.success('Tax settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save tax settings')
    } finally {
      setSavingTax(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure company tax and POS printing for this device.
        </p>
      </div>

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

              <div className="flex flex-wrap gap-3">
                <button type="button" className="btn-secondary" onClick={handleAddComponent}>
                  Add component
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={savingTax || !companyId}
                  onClick={() => void handleSaveTax()}
                >
                  {savingTax ? 'Saving…' : 'Save tax settings'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {desktop && (
        <div className="card space-y-4 p-6">
          <section>
            <h2 className="text-sm font-semibold text-slate-900">App updates</h2>
            <p className="mt-1 text-sm text-slate-500">
              Desktop builds check GitHub Releases for new versions automatically.
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
    </div>
  )
}

export default SettingsPage
