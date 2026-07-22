// 태그 뱃지 색 팔레트 (임포트 디자인 PRESETS 기준).
// 태그에는 DB 색상 컬럼이 없으므로 정렬 순서에 따라 결정적으로 배정한다.
export interface Swatch {
  bg: string
  fg: string
  bd: string
}

export const TAG_SWATCHES: Swatch[] = [
  { bg: '#E1F5EE', fg: '#085041', bd: '#B7E3D3' }, // green
  { bg: '#E6F1FB', fg: '#0C447C', bd: '#B8D4EF' }, // blue
  { bg: '#EEEDFE', fg: '#3C3489', bd: '#C9C5F5' }, // purple
  { bg: '#FAEEDA', fg: '#633806', bd: '#E0C9A6' }, // amber
  { bg: '#FCEBEB', fg: '#A32D2D', bd: '#EFCFCF' }, // red
  { bg: '#EAF3E9', fg: '#3D6B33', bd: '#C7DEC2' }, // olive
  { bg: '#F0EFEC', fg: '#55534E', bd: '#D9D7D1' }, // gray
]

export function tagSwatch(index: number): Swatch {
  // 음수·NaN 인덱스에도 안전한 순환 (JS의 %는 음수를 음수로 반환하므로 보정)
  const n = TAG_SWATCHES.length
  const i = Number.isFinite(index) ? ((Math.trunc(index) % n) + n) % n : 0
  return TAG_SWATCHES[i]
}
