/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#185FA5',
        'primary-light': '#E6F1FB',
        'primary-text': '#0C447C',
        success: '#085041',
        'success-light': '#E1F5EE',
        warning: '#633806',
        'warning-light': '#FAEEDA',
        danger: '#A32D2D',
        'danger-light': '#FCEBEB',
        'sidebar-bg': '#F5F4F0',
        // 중립 톤 (디자인 임포트 기준)
        'ink-1': '#1F1E1B',
        'ink-2': '#55534E',
        'ink-3': '#8A877F',
        'ink-4': '#B4B1A9',
        'line': '#E2E0DB',
        'line-strong': '#CFCDC7',
        'hover-bg': '#EDEBE6',
      },
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', 'Malgun Gothic', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
