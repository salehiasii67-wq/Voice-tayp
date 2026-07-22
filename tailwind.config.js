/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        fa: ['Vazirmatn', 'Tahoma', 'sans-serif'],
        en: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        canvas: {
          DEFAULT: '#0B0F14',
          raised: '#111823',
          overlay: '#161F2C',
        },
        line: '#22303F',
        ink: {
          DEFAULT: '#E7EDF3',
          muted: '#8CA0B3',
          faint: '#54687C',
        },
        signal: {
          buy: '#22C55E',
          sell: '#F0473C',
          live: '#3DDC97',
          amber: '#F5A623',
        },
        accent: '#3DDC97',
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'caret-blink': 'caret-blink 1s step-end infinite',
        'fade-up': 'fade-up 0.25s ease-out',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'caret-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        'fade-up': {
          '0%': { transform: 'translateY(6px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
