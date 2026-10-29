import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useCompanyMenu } from '@/hooks/useCompanyMenu'
import { useCompany } from '@/hooks/useCompany'
import { useBranches } from '@/hooks/useBranches'
import LoadingScreen from '@/components/common/LoadingScreen'
import CachedImage from '@/components/common/CachedImage'
import { itemHasVariants } from '@/utils/variants'

const formatPriceCompact = (value: number): string => {
  if (!Number.isFinite(value)) return '0'
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

const DisplayPage = () => {
  const { companyId = '', branchId = '' } = useParams()
  const { company, loading: companyLoading } = useCompany(companyId)
  const { branches, loading: branchesLoading } = useBranches(companyId || undefined)
  const branch = branches.find((b) => b.id === branchId) ?? null
  const { categories, items, loading } = useCompanyMenu(companyId, branchId || undefined)
  const displayLocation = branch?.location || company?.location

  const grouped = useMemo(() => {
    const activeCats = categories.filter((c) => c.active)
    return activeCats.map((cat) => ({
      category: cat,
      items: items.filter((i) => i.categoryId === cat.id),
    }))
  }, [categories, items])

  if (loading || companyLoading || branchesLoading) {
    return <LoadingScreen label="Loading menu..." />
  }
  if (!branchId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8 text-slate-500">
        Branch not specified.
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#fdfaf3] text-slate-900">
      <main className="mx-auto max-w-5xl px-6 py-12 sm:px-10">
        {(company?.name || displayLocation || company?.logoUrl) && (
          <div className="mb-6 flex flex-col items-center text-center">
            {company?.logoUrl && (
              <CachedImage
                src={company.logoUrl}
                companyId={companyId}
                alt=""
                className="mb-3 h-16 w-16 rounded-full object-cover ring-1 ring-slate-300"
              />
            )}
            {company?.name && (
              <p className="text-sm uppercase tracking-[0.35em] text-slate-500">
                {company.name}
              </p>
            )}
            {displayLocation && (
              <p className="mt-1 text-xs text-slate-400">{displayLocation}</p>
            )}
          </div>
        )}

        <div className="my-8 flex items-center gap-4">
          <div className="h-px flex-1 bg-slate-900" />
          <h1
            className="font-serif text-5xl italic tracking-wide text-slate-900"
            style={{ fontFamily: '"Playfair Display", "Cormorant Garamond", Georgia, serif' }}
          >
            Menu
          </h1>
          <div className="h-px flex-1 bg-slate-900" />
        </div>

        {grouped.length === 0 ? (
          <p className="py-10 text-center text-slate-500">
            This menu has no items yet.
          </p>
        ) : (
          <div className="mt-10 gap-12 sm:columns-2">
            {grouped.map(({ category, items: catItems }) => (
              <section
                key={category.id}
                className="mb-10 break-inside-avoid"
              >
                <h2
                  className="mb-3 border-b-2 border-slate-900 pb-1 text-2xl font-bold uppercase tracking-wide"
                  style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
                >
                  {category.name}
                </h2>

                {catItems.length === 0 ? (
                  <p className="text-sm italic text-slate-400">
                    No items in this section.
                  </p>
                ) : (
                  <ul className="space-y-2.5">
                    {catItems.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-baseline gap-2 text-[15px] leading-snug"
                      >
                        <span
                          className={
                            item.available
                              ? 'font-medium text-slate-900'
                              : 'font-medium text-slate-400 line-through'
                          }
                        >
                          {item.name}
                        </span>
                        <span
                          aria-hidden
                          className="flex-1 translate-y-[-3px] border-b border-dotted border-slate-400"
                        />
                        {item.available ? (
                          <span className="whitespace-nowrap font-semibold text-slate-900">
                            {itemHasVariants(item)
                              ? `from ${formatPriceCompact(item.basePrice)}`
                              : formatPriceCompact(item.basePrice)}
                          </span>
                        ) : (
                          <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wider text-slate-400">
                            Sold out
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}

        <div className="mt-12 flex items-center justify-center gap-3 text-[10px] uppercase tracking-[0.3em] text-slate-400">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          Live menu
        </div>
      </main>
    </div>
  )
}

export default DisplayPage
