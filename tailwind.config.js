/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          950: '#080b14',
          900: '#0b1020',
          850: '#0f1525',
          800: '#141b2e',
          700: '#1c2540',
          600: '#283356',
          500: '#3a466b',
          400: '#5a6690',
          300: '#8b95b8',
          200: '#b8c0db',
          100: '#dde3f3',
        },
        brand: {
          50: '#eaf4ff',
          100: '#d4e8ff',
          200: '#a8d1ff',
          300: '#6fb3ff',
          400: '#3b93ff',
          500: '#1a74f0',
          600: '#0d5ad1',
          700: '#0a47a8',
          800: '#0c3a85',
          900: '#0e3168',
        },
        emerald2: {
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
        },
        amber2: {
          400: '#fbbf24',
          500: '#f59e0b',
        },
        rose2: {
          400: '#fb7185',
          500: '#f43f5e',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(59,147,255,0.18), 0 8px 40px -12px rgba(26,116,240,0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 12px 32px -16px rgba(0,0,0,0.6)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        'pulse-soft': 'pulse-soft 1.6s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        'spin-slow': 'spin-slow 1.1s linear infinite',
      },
    },
  },
  plugins: [],
};
