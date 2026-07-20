interface BadgeProps {
  children: React.ReactNode
  /** 인라인 색상 (배경/글자/보더) — 태그·상태별 커스텀 색 */
  bg?: string
  fg?: string
  bd?: string
  className?: string
}

/** 구분·태그·상태 뱃지. 색은 인라인 스타일로 주입 (임포트 디자인 색 팔레트). */
export default function Badge({ children, bg, fg, bd, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-block rounded-[5px] px-[9px] py-[2px] text-[11px] font-semibold leading-[1.35] [word-break:keep-all] ${className}`}
      style={{
        background: bg ?? '#F0EFEC',
        color: fg ?? '#55534E',
        border: `1px solid ${bd ?? '#E2E0DB'}`,
      }}
    >
      {children}
    </span>
  )
}
