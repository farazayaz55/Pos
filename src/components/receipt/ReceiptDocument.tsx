import type { Company, Order, ReceiptAlign, ReceiptBlock } from '@/types'
import CachedImage from '@/components/common/CachedImage'
import { formatMoney } from '@/utils/currency'
import { formatOrderNumber } from '@/utils/businessDate'
import { resolveReceiptBlocks } from '@/utils/receiptBlocks'
import { receiptAlignClass } from '@/utils/receiptText'
import type { CompanyReceiptSettings } from '@/types'
import { cn } from '@/utils/cn'

const formatDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

const paymentSubtitle = (order: Order): string =>
  order.paymentMethod === 'cash'
    ? order.paymentStatus === 'pending'
      ? 'Payment pending'
      : 'Paid in cash'
    : order.orderSource === 'kiosk'
      ? 'Self-service kiosk order'
      : 'Paid by card'

const FieldRow = ({
  label,
  value,
  align = 'left',
  strong,
}: {
  label: string
  value: string
  align?: ReceiptAlign
  strong?: boolean
}) => {
  if (align === 'center' || align === 'right') {
    return (
      <p className={cn(receiptAlignClass(align), strong && 'font-bold')}>
        {label}: {value}
      </p>
    )
  }
  return (
    <div className={cn('flex justify-between', strong && 'font-bold')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}

const blockLabel = (block: ReceiptBlock, fallback: string) =>
  block.label?.trim() || fallback

type Props = {
  order: Order
  company?: Company | null
  settings?: CompanyReceiptSettings | null
  /** Override resolved blocks (e.g. live Settings draft). */
  blocks?: ReceiptBlock[]
  className?: string
  id?: string
}

const ReceiptDocument = ({
  order,
  company,
  settings,
  blocks: blocksProp,
  className,
  id = 'receipt',
}: Props) => {
  const blocks = blocksProp ?? resolveReceiptBlocks(settings)
  const companyId = company?.id || order.companyId

  return (
    <div
      id={id}
      className={cn(
        'mx-auto max-w-[320px] bg-white p-4 font-mono text-[12px] leading-snug text-slate-900 shadow',
        className,
      )}
    >
      {blocks.map((block) => {
        const align = block.align ?? 'left'
        switch (block.type) {
          case 'text':
            if (!block.text?.trim()) return null
            return (
              <p
                key={block.id}
                className={cn('text-[11px]', receiptAlignClass(block.align ?? 'center'))}
              >
                {block.text}
              </p>
            )
          case 'logo':
            if (!company?.logoUrl) return null
            return (
              <div key={block.id} className="text-center">
                <CachedImage
                  src={company.logoUrl}
                  companyId={companyId}
                  alt=""
                  className="mx-auto mb-2 h-14 w-14 rounded object-cover"
                />
              </div>
            )
          case 'companyName':
            return (
              <h1
                key={block.id}
                className={cn(
                  'text-base font-bold uppercase',
                  receiptAlignClass(block.align ?? 'center'),
                )}
              >
                {company?.name || 'Restaurant'}
              </h1>
            )
          case 'companyLocation':
            if (!company?.location) return null
            return (
              <p
                key={block.id}
                className={cn('text-[11px]', receiptAlignClass(block.align ?? 'center'))}
              >
                {company.location}
              </p>
            )
          case 'companyPhone':
            if (!company?.phone) return null
            return (
              <p
                key={block.id}
                className={cn('text-[11px]', receiptAlignClass(block.align ?? 'center'))}
              >
                {company.phone}
              </p>
            )
          case 'divider':
            return (
              <hr
                key={block.id}
                className="my-2 border-dashed border-slate-300"
              />
            )
          case 'orderNumber':
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'Order #')}
                value={formatOrderNumber(order.orderNumber)}
                align={align}
                strong
              />
            )
          case 'date':
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'Date')}
                value={formatDate(order.createdAt)}
                align={align}
              />
            )
          case 'table':
            if (!order.tableNumber) return null
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'Table')}
                value={order.tableNumber}
                align={align}
              />
            )
          case 'cashier':
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'Cashier')}
                value={order.createdByName}
                align={align}
              />
            )
          case 'lineItems':
            return (
              <table key={block.id} className="w-full">
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.lineId} className="align-top">
                      <td className="py-1">
                        <div className="font-semibold">
                          {it.quantity} x {it.itemName}
                          {it.variantName ? ` (${it.variantName})` : ''}
                        </div>
                        {(it.modifiers?.length ?? 0) > 0 && (
                          <ul className="pl-3 text-[11px] text-slate-600">
                            {(it.modifiers ?? []).map((m, idx) => (
                              <li key={idx}>
                                + {m.optionName}
                                {m.priceAdjustment !== 0 &&
                                  ` (${m.priceAdjustment > 0 ? '+' : ''}${formatMoney(m.priceAdjustment)})`}
                              </li>
                            ))}
                          </ul>
                        )}
                        {it.note && (
                          <p className="pl-3 text-[11px] italic">"{it.note}"</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-1 text-right font-semibold">
                        {formatMoney(it.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          case 'subtotal':
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'Subtotal')}
                value={formatMoney(order.subtotal)}
                align={align}
              />
            )
          case 'discount': {
            if (!(order.discount.amount > 0)) return null
            const label =
              block.label?.trim() ||
              (order.discount.type === 'percent'
                ? `Discount (${order.discount.value}%)`
                : 'Discount')
            return (
              <FieldRow
                key={block.id}
                label={label}
                value={`-${formatMoney(order.discount.amount)}`}
                align={align}
              />
            )
          }
          case 'tax':
            if (order.taxLines && order.taxLines.length > 0) {
              return (
                <div key={block.id} className="space-y-0.5">
                  {order.taxLines.map((line) => (
                    <FieldRow
                      key={`${line.name}-${line.rate}`}
                      label={`${line.name} (${Math.round(line.rate * 10000) / 100}%)`}
                      value={formatMoney(line.amount)}
                      align={align}
                    />
                  ))}
                </div>
              )
            }
            if (order.tax != null && order.tax > 0) {
              return (
                <FieldRow
                  key={block.id}
                  label={blockLabel(block, 'Tax')}
                  value={formatMoney(order.tax)}
                  align={align}
                />
              )
            }
            return null
          case 'tip':
            if (!(order.tip != null && order.tip > 0)) return null
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'Tip')}
                value={formatMoney(order.tip)}
                align={align}
              />
            )
          case 'total':
            return (
              <FieldRow
                key={block.id}
                label={blockLabel(block, 'TOTAL')}
                value={formatMoney(order.total)}
                align={align}
                strong
              />
            )
          case 'payment':
            if (order.paymentStatus === 'refunded') {
              return (
                <FieldRow
                  key={block.id}
                  label="Status"
                  value="Refunded"
                  align={align}
                  strong
                />
              )
            }
            if (order.paymentMethod === 'cash') {
              if (order.paymentStatus === 'pending') {
                return (
                  <div key={block.id} className="space-y-0.5">
                    <FieldRow
                      label="Cash due"
                      value={formatMoney(order.total)}
                      align={align}
                    />
                    <FieldRow label="Status" value="Pending" align={align} />
                  </div>
                )
              }
              return (
                <div key={block.id} className="space-y-0.5">
                  <FieldRow
                    label="Cash"
                    value={formatMoney(order.cashReceived ?? 0)}
                    align={align}
                  />
                  <FieldRow
                    label="Change"
                    value={formatMoney(order.change ?? 0)}
                    align={align}
                    strong
                  />
                </div>
              )
            }
            return (
              <FieldRow
                key={block.id}
                label="Paid"
                value={order.paymentMethod.replace('_', ' ')}
                align={align}
              />
            )
          case 'thankYou': {
            const a = block.align ?? 'center'
            if (order.paymentStatus === 'refunded') {
              return (
                <div key={block.id}>
                  <p
                    className={cn(
                      'text-sm font-bold uppercase tracking-wide',
                      receiptAlignClass(a),
                    )}
                  >
                    REFUNDED
                  </p>
                  {order.refundedAt && (
                    <p
                      className={cn(
                        'text-[10px] text-slate-500',
                        receiptAlignClass(a),
                      )}
                    >
                      {formatDate(order.refundedAt)}
                      {order.refundedByName ? ` · ${order.refundedByName}` : ''}
                    </p>
                  )}
                </div>
              )
            }
            return (
              <div key={block.id}>
                <p className={cn('text-[11px]', receiptAlignClass(a))}>
                  {block.text?.trim() || 'Thank you!'}
                </p>
                <p
                  className={cn(
                    'text-[10px] text-slate-500',
                    receiptAlignClass(a),
                  )}
                >
                  {paymentSubtitle(order)}
                </p>
              </div>
            )
          }
          default:
            return null
        }
      })}
    </div>
  )
}

export default ReceiptDocument

/** Fixed sample order for Settings live preview. */
export const SAMPLE_RECEIPT_ORDER: Order = {
  id: 'preview',
  orderNumber: 1,
  orderDate: '2026-10-24',
  companyId: 'preview',
  branchId: 'preview-branch',
  items: [
    {
      lineId: '1',
      itemId: 'i1',
      itemName: 'Vanilla Ice Cream',
      basePrice: 1,
      quantity: 1,
      modifiers: [],
      unitPrice: 1,
      lineTotal: 1,
    },
    {
      lineId: '2',
      itemId: 'i2',
      itemName: 'Chocolate Scoop',
      basePrice: 2,
      quantity: 1,
      modifiers: [],
      unitPrice: 2,
      lineTotal: 2,
    },
  ],
  subtotal: 3,
  discount: { type: 'none', value: 0, amount: 0 },
  tax: 0,
  taxLines: [],
  total: 3,
  paymentMethod: 'cash',
  paymentStatus: 'paid',
  status: 'completed',
  cashReceived: 5,
  change: 2,
  createdBy: 'preview',
  createdByName: 'cashier@example.com',
  createdAt: Date.now(),
}
