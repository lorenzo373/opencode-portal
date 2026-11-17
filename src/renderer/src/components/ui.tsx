import { clsx } from 'clsx'
import { Check, ChevronDown, Copy, Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { useEffect, useState } from 'react'

export const cx = clsx

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-[0_10px_30px_-14px_rgba(124,92,255,0.9)] hover:bg-accent-soft border border-white/10',
  secondary: 'bg-raised text-ink border border-line hover:border-line-strong hover:bg-[#1a1f29]',
  ghost: 'bg-transparent text-soft border border-transparent hover:bg-white/5 hover:text-ink',
  danger: 'bg-err/15 text-err border border-err/30 hover:bg-err/25',
  success: 'bg-ok/15 text-ok border border-ok/30 hover:bg-ok/25'
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[12.5px] rounded-lg gap-1.5',
  md: 'h-9.5 px-4 text-[13px] rounded-[10px] gap-2',
  lg: 'h-11 px-5 text-sm rounded-xl gap-2'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'focus-ring inline-flex items-center justify-center font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="spin-slow" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      title={label}
      aria-label={label}
      className={cx(
        'focus-ring inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-raised/60 text-muted transition-colors hover:border-line-strong hover:text-ink',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Card({ className, children, as = 'div', ...rest }: { className?: string; children: ReactNode; as?: any } & Record<string, any>) {
  const Tag = as
  return (
    <Tag {...rest} className={cx('card', className)}>
      {children}
    </Tag>
  )
}

export function SectionHeading({
  title,
  description,
  action,
  className
}: {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description ? <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

const badgeTones: Record<string, string> = {
  neutral: 'bg-white/[0.04] text-soft border-line',
  accent: 'bg-accent/12 text-accent-soft border-accent/25',
  cyan: 'bg-cyan/10 text-cyan border-cyan/25',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  err: 'bg-err/10 text-err border-err/25'
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  title
}: {
  tone?: keyof typeof badgeTones | string
  children: ReactNode
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.04em]',
        badgeTones[tone] || badgeTones.neutral,
        className
      )}
    >
      {children}
    </span>
  )
}

export function StatusDot({ state, className }: { state: 'on' | 'off' | 'warn' | 'err' | 'busy'; className?: string }) {
  const color =
    state === 'on'
      ? 'bg-ok'
      : state === 'warn'
        ? 'bg-warn'
        : state === 'err'
          ? 'bg-err'
          : state === 'busy'
            ? 'bg-cyan'
            : 'bg-[#3a4050]'
  return (
    <span className={cx('relative inline-flex h-2 w-2 shrink-0 rounded-full', color, state === 'on' && 'pulse-dot', className)} />
  )
}

export function StatusRow({ state, label, value }: { state: 'on' | 'off' | 'warn' | 'err' | 'busy'; label: string; value?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot state={state} />
        <span className="text-[12.5px] text-soft">{label}</span>
      </div>
      <span className="truncate text-[12px] font-medium text-ink/90">{value}</span>
    </div>
  )
}

export function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-muted">{children}</span>
      {hint ? <span className="text-[11px] text-muted/80">{hint}</span> : null}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'focus-ring h-10 w-full rounded-[10px] border border-line bg-[#0a0c11] px-3 text-[13px] text-ink placeholder:text-muted/60 transition-colors hover:border-line-strong',
        className
      )}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        'focus-ring w-full rounded-[10px] border border-line bg-[#0a0c11] p-3 font-mono text-[12px] leading-relaxed text-ink placeholder:text-muted/60 transition-colors hover:border-line-strong',
        className
      )}
    />
  )
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cx(
          'focus-ring h-10 w-full appearance-none rounded-[10px] border border-line bg-[#0a0c11] pl-3 pr-9 text-[13px] text-ink transition-colors hover:border-line-strong',
          className
        )}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-4 py-3', disabled && 'cursor-not-allowed opacity-50')}>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'focus-ring relative mt-0.5 h-[22px] w-10 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-accent/50 bg-accent' : 'border-line bg-[#191d26]'
        )}
      >
        <span
          className={cx(
            'pointer-events-none absolute left-[2px] top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-0'
          )}
        />
      </button>
    </label>
  )
}

export function CopyField({
  value,
  label,
  mono = true,
  secret = false,
  className,
  onCopied
}: {
  value: string
  label?: string
  mono?: boolean
  secret?: boolean
  className?: string
  onCopied?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(!secret)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(timer)
  }, [copied])
  const display = revealed ? value : '•'.repeat(Math.min(28, value.length))
  return (
    <div className={className}>
      {label ? <Label>{label}</Label> : null}
      <div className="flex items-stretch gap-2">
        <div
          className={cx(
            'flex min-w-0 flex-1 items-center rounded-[10px] border border-line bg-[#0a0c11] px-3 text-[12.5px] text-ink',
            mono && 'font-mono'
          )}
        >
          <span className="selectable truncate py-2.5">{display || '—'}</span>
        </div>
        {secret ? (
          <Button variant="ghost" size="sm" onClick={() => setRevealed((prev) => !prev)}>
            {revealed ? 'Hide' : 'Reveal'}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await window.portal.clipboard.write(value)
            setCopied(true)
            onCopied?.()
          }}
          icon={copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

export function Stepper({
  steps,
  current,
  onJump
}: {
  steps: { id: string; label: string }[]
  current: number
  onJump?: (index: number) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        return (
          <button
            key={step.id}
            type="button"
            disabled={!onJump || index > current}
            onClick={() => onJump?.(index)}
            className={cx(
              'group flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-all',
              active
                ? 'border-accent/40 bg-accent/10'
                : done
                  ? 'border-line bg-white/[0.03] hover:border-line-strong'
                  : 'border-transparent opacity-55',
              !onJump && 'cursor-default'
            )}
          >
            <span
              className={cx(
                'flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold',
                active ? 'bg-accent text-white' : done ? 'bg-ok/20 text-ok' : 'bg-white/5 text-muted'
              )}
            >
              {done ? <Check size={11} /> : index + 1}
            </span>
            <span className={cx('text-[11.5px] font-medium', active ? 'text-ink' : 'text-muted')}>{step.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('spin-slow text-muted', className)} size={16} />
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-white/[0.03] text-muted">{icon}</div> : null}
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      {description ? <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-soft">{children}</kbd>
  )
}

export function Meter({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'ok' | 'warn' | 'err' }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0))
  const colors = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', err: 'bg-err' }
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={cx('h-full rounded-full transition-all duration-500', colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  )
}
