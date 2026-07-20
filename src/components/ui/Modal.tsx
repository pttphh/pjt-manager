import { useEffect } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  width?: number
}

export default function Modal({ open, onClose, children, width = 340 }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,30,27,0.4)] p-7"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className="max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-white p-[22px] shadow-[0_12px_32px_rgba(0,0,0,0.14)]"
      >
        {children}
      </div>
    </div>
  )
}
