import { useEffect, useMemo, useState } from 'react'
import type { CartModifierSelection, MenuItem, ModifierGroup } from '@/types'
import CachedImage from '@/components/common/CachedImage'
import VirtualKeyboard from '@/components/common/VirtualKeyboard'
import { formatMoney } from '@/utils/currency'
import { calcLineUnit } from '@/utils/orderCalc'

interface Props {
  item: MenuItem
  groups: ModifierGroup[]
  onCancel: () => void
  onConfirm: (input: {
    quantity: number
    modifiers: CartModifierSelection[]
    note?: string
  }) => void
}

type Selection = Record<string, string[]>

const ItemModifierModal = ({ item, groups, onCancel, onConfirm }: Props) => {
  const itemGroups = useMemo(
    () => groups.filter((g) => item.modifierGroupIds?.includes(g.id)),
    [groups, item.modifierGroupIds],
  )

  const [selection, setSelection] = useState<Selection>({})
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [noteKeyboardOpen, setNoteKeyboardOpen] = useState(false)

  useEffect(() => {
    const init: Selection = {}
    for (const g of itemGroups) init[g.id] = []
    setSelection(init)
  }, [itemGroups])

  const toggle = (group: ModifierGroup, optionId: string) => {
    setSelection((prev) => {
      const cur = prev[group.id] || []
      if (group.max === 1) {
        return { ...prev, [group.id]: cur.includes(optionId) ? [] : [optionId] }
      }
      const exists = cur.includes(optionId)
      if (exists) return { ...prev, [group.id]: cur.filter((id) => id !== optionId) }
      if (cur.length >= group.max) return prev
      return { ...prev, [group.id]: [...cur, optionId] }
    })
  }

  const flatMods: CartModifierSelection[] = useMemo(() => {
    const list: CartModifierSelection[] = []
    for (const g of itemGroups) {
      const picked = selection[g.id] || []
      for (const optId of picked) {
        const opt = g.options?.[optId]
        if (!opt) continue
        list.push({
          groupId: g.id,
          groupName: g.name,
          optionId: opt.id,
          optionName: opt.name,
          priceAdjustment: opt.priceAdjustment,
        })
      }
    }
    return list
  }, [itemGroups, selection])

  const unit = calcLineUnit(item.basePrice, flatMods)
  const total = unit * quantity

  const canConfirm = itemGroups.every((g) => {
    if (!g.required) return true
    const c = selection[g.id]?.length || 0
    return c >= g.min && c <= g.max
  })

  const handleConfirm = () => {
    if (!canConfirm) return
    onConfirm({
      quantity,
      modifiers: flatMods,
      note: note.trim() || undefined,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="card flex max-h-full w-full max-w-xl flex-col overflow-hidden sm:max-h-[90vh]">
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-3">
            {item.imageUrl && (
              <CachedImage
                src={item.imageUrl}
                alt=""
                className="h-14 w-14 rounded-lg object-cover"
              />
            )}
            <div>
              <h3 className="font-semibold">{item.name}</h3>
              <p className="text-xs text-slate-500">Base {formatMoney(item.basePrice)}</p>
            </div>
          </div>
          <button onClick={onCancel} className="btn-ghost p-2" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {itemGroups.length === 0 ? (
            <p className="text-sm text-slate-500">No modifiers for this item.</p>
          ) : (
            itemGroups.map((g) => {
              const options = g.options ? Object.values(g.options) : []
              const selectedCount = selection[g.id]?.length || 0
              const invalid = g.required && (selectedCount < g.min || selectedCount > g.max)
              return (
                <div key={g.id}>
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">
                        {g.name}{' '}
                        {g.required && (
                          <span className="text-xs font-normal text-red-600">required</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">
                        Choose {g.min === g.max ? g.min : `${g.min}-${g.max}`}
                      </p>
                    </div>
                    {invalid && (
                      <span className="text-xs text-red-600">Please choose {g.min}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {options.length === 0 ? (
                      <p className="text-xs text-slate-400">No options</p>
                    ) : (
                      options.map((opt) => {
                        const active = selection[g.id]?.includes(opt.id)
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setNoteKeyboardOpen(false)
                              toggle(g, opt.id)
                            }}
                            className={
                              active
                                ? 'flex items-center justify-between rounded-lg border-2 border-brand-600 bg-brand-50 px-3 py-2 text-sm'
                                : 'flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-slate-300'
                            }
                          >
                            <span className="font-medium">{opt.name}</span>
                            <span className="text-xs text-slate-500">
                              {opt.priceAdjustment > 0
                                ? `+${formatMoney(opt.priceAdjustment)}`
                                : opt.priceAdjustment < 0
                                  ? formatMoney(opt.priceAdjustment)
                                  : '—'}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })
          )}

          <div>
            <label className="label">Note (optional)</label>
            <textarea
              className="input"
              rows={2}
              placeholder="e.g. no onions"
              value={note}
              readOnly
              inputMode="none"
              onFocus={() => setNoteKeyboardOpen(true)}
              onClick={() => setNoteKeyboardOpen(true)}
            />
            {noteKeyboardOpen && (
              <VirtualKeyboard
                mode="text"
                value={note}
                onChange={setNote}
                onDone={() => setNoteKeyboardOpen(false)}
                className="mt-3"
              />
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNoteKeyboardOpen(false)
                  setQuantity((q) => Math.max(1, q - 1))
                }}
                className="btn-secondary h-9 w-9 p-0 text-lg"
              >
                -
              </button>
              <span className="w-8 text-center font-semibold">{quantity}</span>
              <button
                type="button"
                onClick={() => {
                  setNoteKeyboardOpen(false)
                  setQuantity((q) => q + 1)
                }}
                className="btn-secondary h-9 w-9 p-0 text-lg"
              >
                +
              </button>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Total</p>
              <p className="text-lg font-bold text-brand-600">{formatMoney(total)}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="btn-secondary flex-1">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="btn-primary flex-[2]"
            >
              Add to cart
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ItemModifierModal
