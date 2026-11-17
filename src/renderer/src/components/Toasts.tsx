import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useStore } from '../store'
import { cx } from './ui'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[340px] flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cx(
            'animate-fade-up pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl',
            toast.kind === 'success' && 'border-ok/25 bg-[#0d1714]/95',
            toast.kind === 'error' && 'border-err/25 bg-[#1a1012]/95',
            toast.kind === 'info' && 'border-line bg-[#11141b]/95'
          )}
        >
          {toast.kind === 'success' ? (
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-ok" />
          ) : toast.kind === 'error' ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-err" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-cyan" />
          )}
          <p className="flex-1 text-[12px] leading-relaxed text-ink/90">{toast.message}</p>
          <button onClick={() => dismiss(toast.id)} className="text-muted transition-colors hover:text-ink">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
