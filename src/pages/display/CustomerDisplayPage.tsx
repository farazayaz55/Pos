import { useEffect, useRef, useState } from 'react'
import type { CustomerDisplayState } from '@/types/desktop'
import { emptyCustomerDisplayState } from '@/types/customerDisplay'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import { isDesktopApp } from '@/stores/posSettingsStore'

const THANKS_HOLD_MS = 4000

const CustomerDisplayPage = () => {
  const [state, setState] = useState<CustomerDisplayState>(emptyCustomerDisplayState)
  const thanksTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const holdingThanks = useRef(false)

  useEffect(() => {
    if (!isDesktopApp() || !window.posDesktop) return

    const apply = (next: CustomerDisplayState) => {
      if (next.phase === 'thanks') {
        holdingThanks.current = true
        if (thanksTimer.current) clearTimeout(thanksTimer.current)
        setState(next)
        thanksTimer.current = setTimeout(() => {
          holdingThanks.current = false
          setState((prev) => ({
            ...emptyCustomerDisplayState(),
            companyName: prev.companyName,
            companyLogoUrl: prev.companyLogoUrl,
          }))
        }, THANKS_HOLD_MS)
        return
      }

      if (holdingThanks.current) return

      setState(next)
    }

    void window.posDesktop.getCustomerDisplayState().then((cached) => {
      if (cached) apply(cached)
    })

    const unsub = window.posDesktop.onCustomerDisplayState(apply)
    return () => {
      unsub()
      if (thanksTimer.current) clearTimeout(thanksTimer.current)
    }
  }, [])

  if (state.phase === 'thanks') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-8 text-white">
        <p className="text-sm uppercase tracking-[0.35em] text-slate-400">
          {state.companyName || 'Thank you'}
        </p>
        <h1 className="mt-6 text-5xl font-semibold tracking-tight sm:text-6xl">
          Thank you!
        </h1>
        {state.orderNumber != null && (
          <p className="mt-4 text-xl text-slate-300">
            Order #{formatOrderNumber(state.orderNumber)}
          </p>
        )}
        <p className="mt-8 text-4xl font-bold tabular-nums sm:text-5xl">
          {formatMoney(state.thanksTotal ?? state.total)}
        </p>
      </div>
    )
  }

  const isEmpty = state.phase === 'idle' || state.lines.length === 0

  if (isEmpty) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-8 text-white">
        {state.companyLogoUrl ? (
          <img
            src={state.companyLogoUrl}
            alt=""
            className="mb-6 h-24 w-24 rounded-full object-cover ring-2 ring-slate-700"
          />
        ) : null}
        <p className="text-sm uppercase tracking-[0.4em] text-slate-400">
          {state.companyName || 'Welcome'}
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your order will appear here
        </h1>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-5">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
            {state.companyName || 'Order'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Your order</h1>
        </div>
        {state.tableNumber ? (
          <p className="rounded-lg bg-slate-800 px-4 py-2 text-lg font-medium">
            Table {state.tableNumber}
          </p>
        ) : null}
      </header>

      <ul className="flex-1 space-y-4 overflow-y-auto px-8 py-6">
        {state.lines.map((line) => (
          <li
            key={line.lineId}
            className="flex items-start justify-between gap-6 border-b border-slate-800/80 pb-4"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xl font-medium">
                <span className="mr-2 tabular-nums text-slate-400">{line.quantity}×</span>
                {line.itemName}
              </p>
              {line.modifiers.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-sm text-slate-400">
                  {line.modifiers.map((m, i) => (
                    <li key={`${line.lineId}-m-${i}`}>
                      {m.optionName}
                      {m.priceAdjustment !== 0
                        ? ` (${m.priceAdjustment > 0 ? '+' : ''}${formatMoney(m.priceAdjustment)})`
                        : ''}
                    </li>
                  ))}
                </ul>
              )}
              {line.note ? (
                <p className="mt-1 text-sm italic text-slate-500">{line.note}</p>
              ) : null}
            </div>
            <p className="shrink-0 text-xl font-semibold tabular-nums">
              {formatMoney(line.lineTotal)}
            </p>
          </li>
        ))}
      </ul>

      <footer className="border-t border-slate-800 bg-slate-900 px-8 py-6">
        <div className="space-y-2 text-base text-slate-300">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatMoney(state.subtotal)}</span>
          </div>
          {state.discountAmount > 0 && (
            <div className="flex justify-between text-emerald-400">
              <span>Discount</span>
              <span className="tabular-nums">−{formatMoney(state.discountAmount)}</span>
            </div>
          )}
          {state.taxLines.map((t) => (
            <div key={t.name} className="flex justify-between">
              <span>
                {t.name} ({Math.round(t.rate * 1000) / 10}%)
              </span>
              <span className="tabular-nums">{formatMoney(t.amount)}</span>
            </div>
          ))}
          {state.taxLines.length === 0 && state.tax > 0 && (
            <div className="flex justify-between">
              <span>Tax</span>
              <span className="tabular-nums">{formatMoney(state.tax)}</span>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-end justify-between border-t border-slate-700 pt-4">
          <span className="text-2xl font-semibold">Total</span>
          <span className="text-4xl font-bold tabular-nums sm:text-5xl">
            {formatMoney(state.total)}
          </span>
        </div>
      </footer>
    </div>
  )
}

export default CustomerDisplayPage
