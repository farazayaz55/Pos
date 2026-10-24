import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import toast from 'react-hot-toast'
import { useCompanyContextStore } from '@/stores/companyContextStore'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import { usePosKioskMode } from '@/hooks/usePosKioskMode'
import { useCustomerDisplaySync } from '@/hooks/useCustomerDisplaySync'
import { useCartStore } from '@/stores/cartStore'
import type { MenuItem } from '@/types'
import LoadingScreen from '@/components/common/LoadingScreen'
import CachedImage from '@/components/common/CachedImage'
import { formatMoney } from '@/utils/currency'
import ItemModifierModal from '@/components/pos/ItemModifierModal'
import CartPanel from '@/components/pos/CartPanel'
import CheckoutModal from './CheckoutModal'

const HOLD_EXIT_MS = 3000

const PosPage = () => {
  const companyId = useCompanyContextStore((s) => s.activeCompanyId) || ''
  const { categories, items, modifierGroups, loading, fromCache } =
    useCompanyMenu(companyId)
  const setCartCompany = useCartStore((s) => s.setCompanyId)
  const addLine = useCartStore((s) => s.addLine)
  const { active: kioskActive, supported: kioskSupported, desired, enter, exit } =
    usePosKioskMode()
  useCustomerDisplaySync(companyId)

  const [activeCat, setActiveCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [pickFor, setPickFor] = useState<MenuItem | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [mobileCartOpen, setMobileCartOpen] = useState(false)

  useEffect(() => {
    setCartCompany(companyId || null)
  }, [companyId, setCartCompany])

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.active),
    [categories],
  )

  const filtered = useMemo(() => {
    const list = activeCat === 'all' ? items : items.filter((i) => i.categoryId === activeCat)
    const q = search.trim().toLowerCase()
    return q ? list.filter((i) => i.name.toLowerCase().includes(q)) : list
  }, [items, activeCat, search])

  const handleSelectItem = (item: MenuItem) => {
    if (!item.available) return
    const groups = modifierGroups.filter((g) => item.modifierGroupIds?.includes(g.id))
    if (groups.length === 0) {
      addLine({
        itemId: item.id,
        itemName: item.name,
        basePrice: item.basePrice,
        imageUrl: item.imageUrl,
        quantity: 1,
        modifiers: [],
      })
      return
    }
    setPickFor(item)
  }

  const handleEnterKiosk = async () => {
    try {
      await enter()
      toast.success('Kiosk mode on — hold Exit for 3s to leave. OS app switching is not blocked.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not enter kiosk mode'
      toast.error(msg)
    }
  }

  if (loading) return <LoadingScreen label="Loading menu..." />

  if (items.length === 0 && categories.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="card max-w-md p-8 text-center">
          <h2 className="text-lg font-semibold">No menu yet</h2>
          <p className="mt-2 text-sm text-slate-500">
            Create categories and items first under <b>Menu</b>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {kioskActive && (
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-4 py-2 text-white">
          <p className="text-xs font-medium tracking-wide">
            Kiosk mode — hold Exit to leave
          </p>
          <HoldToExitButton onComplete={() => void exit()} />
        </div>
      )}

      {fromCache && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          Offline — showing last cached menu. Cash orders will sync when back online.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center">
            <input
              type="search"
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input sm:max-w-xs"
            />
            <div className="flex flex-1 flex-wrap gap-2">
              <button
                onClick={() => setActiveCat('all')}
                className={
                  activeCat === 'all'
                    ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                    : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
                }
              >
                All
              </button>
              {visibleCategories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCat(c.id)}
                  className={
                    activeCat === c.id
                      ? 'rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200'
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
            {!kioskActive && kioskSupported && (
              <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
                <button
                  type="button"
                  onClick={() => void handleEnterKiosk()}
                  className="btn-secondary whitespace-nowrap text-xs"
                >
                  Enter kiosk
                </button>
                {desired && (
                  <p className="text-[10px] text-slate-500">
                    Session prefers kiosk — tap to re-enter
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {filtered.length === 0 ? (
              <div className="card p-10 text-center">
                <p className="text-slate-500">No items match.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    disabled={!item.available}
                    className="card group overflow-hidden text-left transition-shadow hover:shadow-md disabled:opacity-60"
                  >
                    <div className="relative flex h-28 items-center justify-center bg-slate-50">
                      {item.imageUrl ? (
                        <CachedImage
                          src={item.imageUrl}
                          companyId={companyId}
                          alt={item.name}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          fallback={
                            <span className="text-3xl font-bold text-slate-300">
                              {item.name.slice(0, 2).toUpperCase()}
                            </span>
                          }
                        />
                      ) : (
                        <span className="text-3xl font-bold text-slate-300">
                          {item.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      {!item.available && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 text-xs font-semibold text-white">
                          Unavailable
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-2 text-sm font-semibold leading-tight">
                        {item.name}
                      </p>
                      <p className="mt-1 text-sm font-bold text-brand-600">
                        {formatMoney(item.basePrice)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setMobileCartOpen(true)}
            className="fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-brand-600 px-5 py-3 text-sm font-semibold text-white shadow-lg md:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M6 6h15l-1.5 9h-12L6 6Z" />
              <circle cx="9" cy="19" r="1.5" />
              <circle cx="17" cy="19" r="1.5" />
            </svg>
            Cart
            <CartCount />
          </button>
        </section>

        <aside className="hidden w-96 border-l border-slate-200 bg-white md:flex md:flex-col">
          <CartPanel onCheckout={() => setCheckoutOpen(true)} />
        </aside>

        {mobileCartOpen && (
          <div className="fixed inset-0 z-40 flex md:hidden">
            <div className="flex-1 bg-slate-900/40" onClick={() => setMobileCartOpen(false)} />
            <div className="flex w-full max-w-sm flex-col bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <p className="text-sm font-semibold">Order</p>
                <button onClick={() => setMobileCartOpen(false)} className="btn-ghost p-1">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="flex-1">
                <CartPanel
                  onCheckout={() => {
                    setMobileCartOpen(false)
                    setCheckoutOpen(true)
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {pickFor && (
          <ItemModifierModal
            item={pickFor}
            groups={modifierGroups}
            onCancel={() => setPickFor(null)}
            onConfirm={(data) => {
              addLine({
                itemId: pickFor.id,
                itemName: pickFor.name,
                basePrice: pickFor.basePrice,
                imageUrl: pickFor.imageUrl,
                quantity: data.quantity,
                modifiers: data.modifiers,
                note: data.note,
              })
              setPickFor(null)
            }}
          />
        )}

        <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
      </div>
    </div>
  )
}

const HoldToExitButton = ({ onComplete }: { onComplete: () => void }) => {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  const stopHold = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    startRef.current = null
    setProgress(0)
  }

  const tick = (now: number) => {
    if (startRef.current == null) return
    const elapsed = now - startRef.current
    const next = Math.min(1, elapsed / HOLD_EXIT_MS)
    setProgress(next)
    if (next >= 1) {
      stopHold()
      onComplete()
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const startHold = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    stopHold()
    startRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }

  useEffect(() => () => stopHold(), [])

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onPointerLeave={stopHold}
      className="relative overflow-hidden rounded-md border border-white/30 bg-white/10 px-4 py-1.5 text-xs font-semibold select-none touch-none"
      aria-label="Hold to exit kiosk mode"
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-0 bg-white/30 transition-[width]"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative z-10">
        {progress > 0 ? `Hold… ${Math.ceil((1 - progress) * 3)}s` : 'Hold to exit'}
      </span>
    </button>
  )
}

const CartCount = () => {
  const count = useCartStore((s) =>
    s.lines.reduce((sum, l) => sum + l.quantity, 0),
  )
  if (count === 0) return null
  return (
    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-brand-700">
      {count}
    </span>
  )
}

export default PosPage
