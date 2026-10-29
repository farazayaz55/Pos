import { useEffect, useState } from 'react'
import { cn } from '@/utils/cn'

export type VirtualKeyboardMode = 'numeric' | 'text'

interface Props {
  mode: VirtualKeyboardMode
  value: string
  onChange: (next: string) => void
  onDone?: () => void
  className?: string
  /** When true, the next digit/decimal replaces the current value (cash POS UX). */
  replaceOnNextKey?: boolean
  onReplaceConsumed?: () => void
}

const KEY_BASE =
  'inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-base font-semibold text-slate-800 shadow-sm active:bg-slate-100'

const applyNumericKey = (current: string, key: string): string => {
  if (key === 'backspace') return current.slice(0, -1)
  if (key === 'clear') return ''
  if (key === '.') {
    if (current.includes('.')) return current
    return current === '' ? '0.' : `${current}.`
  }
  if (!/^\d$/.test(key)) return current
  const dot = current.indexOf('.')
  if (dot !== -1 && current.length - dot > 2) return current
  if (current === '0' && key !== '.') return key
  return `${current}${key}`
}

const applyTextKey = (current: string, key: string, shift: boolean): string => {
  if (key === 'backspace') return current.slice(0, -1)
  if (key === 'clear') return ''
  if (key === 'space') return `${current} `
  const ch = shift ? key.toUpperCase() : key.toLowerCase()
  return `${current}${ch}`
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled
  }
  return false
}

const KeyButton = ({
  label,
  onPress,
  className,
}: {
  label: string
  onPress: () => void
  className?: string
}) => (
  <button type="button" onClick={onPress} className={cn(KEY_BASE, className)}>
    {label}
  </button>
)

const NumericPad = ({ onPress }: { onPress: (key: string) => void }) => {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

  return (
    <div className="grid grid-cols-3 gap-2">
      {digits.map((d) => (
        <KeyButton key={d} label={d} onPress={() => onPress(d)} />
      ))}
      <KeyButton label="." onPress={() => onPress('.')} />
      <KeyButton label="0" onPress={() => onPress('0')} />
      <KeyButton
        label="⌫"
        onPress={() => onPress('backspace')}
        className="bg-slate-50 text-slate-600"
      />
      <KeyButton
        label="Clear"
        onPress={() => onPress('clear')}
        className="col-span-3 bg-slate-50 text-sm font-medium text-slate-600"
      />
    </div>
  )
}

const TEXT_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
] as const

const TextPad = ({
  onPress,
  shift,
}: {
  onPress: (key: string) => void
  shift: boolean
}) => (
  <div className="space-y-1.5">
    {TEXT_ROWS.map((row, i) => (
      <div key={i} className="flex justify-center gap-1">
        {i === 2 && (
          <button
            type="button"
            onClick={() => onPress('shift')}
            className={cn(
              KEY_BASE,
              'min-w-[3rem] px-2 text-sm',
              shift ? 'border-brand-500 bg-brand-50 text-brand-700' : 'bg-slate-50',
            )}
          >
            ⇧
          </button>
        )}
        {row.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onPress(k)}
            className={cn(KEY_BASE, 'min-w-0 flex-1 px-0 text-sm sm:text-base')}
          >
            {shift ? k.toUpperCase() : k}
          </button>
        ))}
        {i === 2 && (
          <button
            type="button"
            onClick={() => onPress('backspace')}
            className={cn(KEY_BASE, 'min-w-[3rem] bg-slate-50 px-2 text-sm text-slate-600')}
          >
            ⌫
          </button>
        )}
      </div>
    ))}
    <div className="flex gap-1">
      <button
        type="button"
        onClick={() => onPress('clear')}
        className={cn(KEY_BASE, 'min-w-[4rem] bg-slate-50 px-3 text-sm font-medium text-slate-600')}
      >
        Clear
      </button>
      <button
        type="button"
        onClick={() => onPress('space')}
        className={cn(KEY_BASE, 'flex-1 text-sm font-medium text-slate-500')}
      >
        Space
      </button>
      <button
        type="button"
        onClick={() => onPress('done')}
        className={cn(
          KEY_BASE,
          'min-w-[4.5rem] border-brand-600 bg-brand-600 px-3 text-sm text-white active:bg-brand-700',
        )}
      >
        Done
      </button>
    </div>
  </div>
)

const VirtualKeyboard = ({
  mode,
  value,
  onChange,
  onDone,
  className,
  replaceOnNextKey,
  onReplaceConsumed,
}: Props) => {
  const [shift, setShift] = useState(false)

  const pressNumeric = (key: string) => {
    if (key === 'backspace' || key === 'clear') {
      onChange(applyNumericKey(value, key))
      return
    }
    if (replaceOnNextKey) {
      onChange(applyNumericKey('', key))
      onReplaceConsumed?.()
      return
    }
    onChange(applyNumericKey(value, key))
  }

  const pressText = (key: string) => {
    if (key === 'shift') {
      setShift((s) => !s)
      return
    }
    if (key === 'done') {
      onDone?.()
      return
    }
    onChange(applyTextKey(value, key, shift))
    if (shift && key !== 'space' && key !== 'backspace' && key !== 'clear') {
      setShift(false)
    }
  }

  const press = (key: string) => {
    if (mode === 'numeric') pressNumeric(key)
    else pressText(key)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target)) return

      if (mode === 'numeric') {
        const numericKey =
          /^\d$/.test(e.key) || e.key === '.'
            ? e.key
            : e.key === 'Backspace'
              ? 'backspace'
              : null
        if (!numericKey) return
        e.preventDefault()
        if (numericKey === 'backspace') {
          onChange(applyNumericKey(value, 'backspace'))
          return
        }
        if (replaceOnNextKey) {
          onChange(applyNumericKey('', numericKey))
          onReplaceConsumed?.()
          return
        }
        onChange(applyNumericKey(value, numericKey))
        return
      }

      if (e.key === 'Backspace') {
        e.preventDefault()
        onChange(applyTextKey(value, 'backspace', false))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        onDone?.()
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        onChange(applyTextKey(value, 'space', false))
        return
      }
      // Printable character — e.key already reflects Shift/caps
      if (e.key.length === 1) {
        e.preventDefault()
        onChange(`${value}${e.key}`)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, value, onChange, onDone, replaceOnNextKey, onReplaceConsumed])

  return (
    <div className={cn('select-none', className)} onMouseDown={(e) => e.preventDefault()}>
      {mode === 'numeric' ? (
        <NumericPad onPress={press} />
      ) : (
        <TextPad onPress={press} shift={shift} />
      )}
    </div>
  )
}

export default VirtualKeyboard
