// PJT/구분 등 사이드바 트리에 영향을 주는 변경이 있을 때 알리는 경량 이벤트 버스.
// (등록/편집/삭제·상태변경·구분 관리 후 사이드바가 즉시 갱신되도록)
export const DATA_CHANGED = 'pm:data-changed'

export const emitDataChanged = () => window.dispatchEvent(new Event(DATA_CHANGED))
