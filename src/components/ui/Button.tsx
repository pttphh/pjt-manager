import { forwardRef } from 'react'

type Variant = 'default' | 'primary' | 'danger' | 'dashed'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-sans'

const variants: Record<Variant, string> = {
  default: 'border border-line-strong bg-white text-ink-2 hover:bg-sidebar-bg',
  primary: 'border border-primary bg-primary text-white hover:bg-[#124e88] hover:border-[#124e88]',
  danger: 'border border-danger-light bg-white text-danger hover:bg-danger-light',
  dashed: 'border border-dashed border-line-strong bg-white text-ink-2 hover:bg-sidebar-bg',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', className = '', ...props }, ref) => (
    <button
      ref={ref}
      className={`${base} ${variants[variant]} px-3.5 py-[7px] ${className}`}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
export default Button
