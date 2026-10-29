import type { BranchWriteScope } from '@/types'
import { cn } from '@/utils/cn'

interface Props {
  value: BranchWriteScope
  onChange: (scope: BranchWriteScope) => void
  disabled?: boolean
  className?: string
}

const BranchWriteScopeToggle = ({ value, onChange, disabled, className }: Props) => {
  return (
    <div
      className={cn(
        'inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium',
        disabled && 'opacity-50',
        className,
      )}
      role="group"
      aria-label="Write scope"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('this')}
        className={cn(
          'rounded-md px-3 py-1.5 transition-colors',
          value === 'this'
            ? 'bg-white text-brand-700 shadow-sm'
            : 'text-slate-600 hover:text-slate-900',
        )}
      >
        This branch
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('all')}
        className={cn(
          'rounded-md px-3 py-1.5 transition-colors',
          value === 'all'
            ? 'bg-white text-brand-700 shadow-sm'
            : 'text-slate-600 hover:text-slate-900',
        )}
      >
        All branches
      </button>
    </div>
  )
}

export default BranchWriteScopeToggle
