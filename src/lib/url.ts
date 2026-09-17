/** 사용자가 입력한 주소를 href 로 쓸 수 있게 보정. 스킴이 없으면 https 를 붙인다.
 *  (PJT 링크 / Task 링크가 같은 규칙을 쓰도록 여기 한 곳에만 둔다) */
export const toHref = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)
