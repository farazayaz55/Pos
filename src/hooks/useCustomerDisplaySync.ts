import { useEffect, useRef } from 'react'
import { useCartStore } from '@/stores/cartStore'
import { isDesktopApp, usePosSettingsStore } from '@/stores/posSettingsStore'
import { useCompanyTaxSettings } from '@/hooks/useCompanyTaxSettings'
import { useCompany } from '@/hooks/useCompany'
import {
  cartLinesToDisplayLines,
  emptyCustomerDisplayState,
  type CustomerDisplayState,
} from '@/types/customerDisplay'
import { calcTax, calcTotal } from '@/utils/orderCalc'

/** Ignore cart snapshots briefly after a thanks publish so clear() does not wipe it. */
let suppressCartPublishUntil = 0

/**
 * Opens the customer display when enabled and publishes live cart snapshots over IPC.
 */
export const useCustomerDisplaySync = (
  companyId: string,
  branchId: string | undefined,
) => {
  const enabled = usePosSettingsStore((s) => s.customerDisplayEnabled)
  const displayId = usePosSettingsStore((s) => s.customerDisplayId)
  const { components } = useCompanyTaxSettings(companyId || undefined, branchId)
  const { company } = useCompany(companyId)
  const componentsRef = useRef(components)
  const companyRef = useRef(company)

  useEffect(() => {
    componentsRef.current = components
  }, [components])

  useEffect(() => {
    companyRef.current = company
  }, [company])

  useEffect(() => {
    if (!isDesktopApp() || !window.posDesktop || !enabled) return

    void window.posDesktop.openCustomerDisplay({ displayId })

    return () => {
      // Leave window open when leaving POS; Settings can close it.
    }
  }, [enabled, displayId])

  useEffect(() => {
    if (!isDesktopApp() || !window.posDesktop || !enabled) return

    const publish = () => {
      if (Date.now() < suppressCartPublishUntil) return

      const cart = useCartStore.getState()
      const comps = componentsRef.current
      const co = companyRef.current
      const lines = cart.lines
      const subtotal = cart.subtotal()
      const discountAmount = cart.discountAmount()
      const taxableBase = cart.taxableBase()
      const { tax, taxLines } = calcTax(taxableBase, comps)
      const total = calcTotal(taxableBase, tax)

      const state: CustomerDisplayState =
        lines.length === 0
          ? {
              ...emptyCustomerDisplayState(),
              companyName: co?.name,
              companyLogoUrl: co?.logoUrl,
            }
          : {
              phase: 'ordering',
              companyName: co?.name,
              companyLogoUrl: co?.logoUrl,
              tableNumber: cart.tableNumber || undefined,
              lines: cartLinesToDisplayLines(lines),
              subtotal,
              discountAmount,
              taxLines,
              tax,
              total,
            }

      void window.posDesktop!.publishCustomerDisplay(state)
    }

    publish()
    const unsub = useCartStore.subscribe(publish)
    return () => unsub()
  }, [enabled, companyId, components, company?.name, company?.logoUrl])
}

/** Publish a thank-you frame before clearing the cart. */
export const publishCustomerDisplayThanks = (payload: {
  companyName?: string
  companyLogoUrl?: string
  orderNumber: number
  total: number
}) => {
  if (!isDesktopApp() || !window.posDesktop) return
  if (!usePosSettingsStore.getState().customerDisplayEnabled) return

  suppressCartPublishUntil = Date.now() + 4200
  const state: CustomerDisplayState = {
    ...emptyCustomerDisplayState(),
    phase: 'thanks',
    companyName: payload.companyName,
    companyLogoUrl: payload.companyLogoUrl,
    orderNumber: payload.orderNumber,
    thanksTotal: payload.total,
    total: payload.total,
  }
  void window.posDesktop.publishCustomerDisplay(state)

  window.setTimeout(() => {
    if (!window.posDesktop) return
    if (Date.now() < suppressCartPublishUntil) return
    const cart = useCartStore.getState()
    if (cart.lines.length > 0) return
    void window.posDesktop.publishCustomerDisplay({
      ...emptyCustomerDisplayState(),
      companyName: payload.companyName,
      companyLogoUrl: payload.companyLogoUrl,
    })
  }, 4300)
}
