import { Fragment } from 'react'

/**
 * 아주 단순한 볼드 전용 마크다운 렌더러.
 * `**텍스트**` 를 <strong> 으로만 바꾸고 나머지는 그대로 텍스트 노드로 둔다.
 * dangerouslySetInnerHTML 을 쓰지 않으므로(텍스트 노드 + <strong> 만 생성) XSS 안전.
 * 줄바꿈은 호출부에서 white-space:pre-wrap 으로 표현한다.
 */
export function renderBold(text: string): React.ReactNode {
  if (!text) return text
  const nodes: React.ReactNode[] = []
  const re = /\*\*([\s\S]+?)\*\*/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>)
    nodes.push(<strong key={key++}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return nodes
}
