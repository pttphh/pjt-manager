# 프로젝트 관리 툴 v2

경영자와 소수 팀원용 PC 전용 업무 관리 웹앱. **PJT → Tasks → Todo** 3계층으로 관리하고, Task 단위 배포 → Todo 단위 진행 체크.

- 스택: Vite + React 18 + TypeScript + Tailwind CSS v3 / Supabase(anon key, RLS 없음) / React Router v6 / Vercel
- 상세 사양: [`prd-v2.md`](./prd-v2.md), DB 스키마: [`schema-v2.sql`](./schema-v2.sql), 개발 기준: [`CLAUDE.md`](./CLAUDE.md)

## 로컬 실행

```bash
npm install
cp .env.local.example .env.local   # 값 채우기 (아래 참고)
npm run dev                         # http://localhost:5173
```

### 환경변수 (`.env.local`, git에 올리지 않음)

```
VITE_SUPABASE_URL=        # Supabase 프로젝트 URL
VITE_SUPABASE_ANON_KEY=   # Supabase anon key
VITE_APP_PASSWORD=        # 입장 비밀번호(단일)
```

## DB 준비 (Supabase SQL Editor에서 순서대로 실행)

1. `schema-v2.sql` — 테이블 생성 + 기본 시드 (Todo 단위 배포 모델 반영됨)
2. `fix-rls-and-seed.sql` — RLS 비활성화 + anon 권한 + 시드(재실행 안전)
3. `migrations/002-tag-color-and-sort.sql` — 태그 색상·정렬 컬럼
4. `migrations/003-project-link.sql` — PJT 링크 컬럼
5. `migrations/004-sidebar-sort.sql` — 사이드바 PJT 정렬 컬럼

> 기존 DB(구 스키마)를 쓰고 있다면 `migrations/005-todo-level-deploy.sql`도 실행
> (Task 단위 배포 → Todo 단위 배포 전환. 새 설치는 불필요 — schema-v2.sql에 이미 반영됨)

## 배포 (Vercel)

- Framework Preset: **Vite** (Build `npm run build`, Output `dist`)
- SPA 딥링크는 [`vercel.json`](./vercel.json)의 rewrite로 처리됨
- 환경변수 3개를 Vercel 대시보드(Project → Settings → Environment Variables)에 등록
- 최초 연동만 웹 UI 수동, 이후 GitHub push 시 자동 배포

## 스크립트

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 타입체크 + 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 미리보기 |
