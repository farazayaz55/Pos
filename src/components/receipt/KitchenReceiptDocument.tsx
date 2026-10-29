import type { CompanyKitchenReceiptSettings, Order } from '@/types'
import { formatOrderNumber } from '@/utils/businessDate'
import {
  filterKitchenItems,
  type KitchenItemLookup,
} from '@/utils/kitchenReceipt'
import { cn } from '@/utils/cn'

type Props = {
  order: Order
  settings?: CompanyKitchenReceiptSettings | null
  menuByItemId?: Map<string, KitchenItemLookup> | Record<string, KitchenItemLookup>
  className?: string
  id?: string
  /** When true, render nothing if there are no kitchen lines. */
  hideWhenEmpty?: boolean
}

const KitchenReceiptDocument = ({
  order,
  settings,
  menuByItemId,
  className,
  id = 'kitchen-receipt',
  hideWhenEmpty = false,
}: Props) => {
  const items = filterKitchenItems(order, settings, menuByItemId)
  if (hideWhenEmpty && items.length === 0) return null

  return (
    <div
      id={id}
      className={cn(
        'mx-auto max-w-[320px] bg-white p-4 font-mono text-[12px] leading-snug text-slate-900 shadow',
        className,
      )}
    >
      <p className="text-center text-base font-bold tracking-wide">KITCHEN</p>
      <p className="mt-1 text-center text-2xl font-bold">
        #{formatOrderNumber(order.orderNumber)}
      </p>
      {order.tableNumber ? (
        <p className="mt-1 text-center text-sm font-semibold">
          Table {order.tableNumber}
        </p>
      ) : null}

      <hr className="my-3 border-dashed border-slate-400" />

      {items.length === 0 ? (
        <p className="text-center text-slate-500">No kitchen items</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const name = item.variantName
              ? `${item.itemName} (${item.variantName})`
              : item.itemName
            return (
              <li key={item.lineId}>
                <p className="font-semibold">
                  {item.quantity} x {name}
                </p>
                {(item.modifiers ?? []).map((mod) => (
                  <p
                    key={`${item.lineId}-${mod.optionId}`}
                    className="pl-3 text-slate-700"
                  >
                    + {mod.optionName}
                  </p>
                ))}
                {item.note?.trim() ? (
                  <p className="pl-3 italic text-slate-600">
                    &ldquo;{item.note.trim()}&rdquo;
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default KitchenReceiptDocument
