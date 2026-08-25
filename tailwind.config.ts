import type { Config } from 'tailwindcss';

/**
 * Design tokens are the single source of truth in app/globals.css (CSS variables).
 * Tailwind maps to those variables so the palette stays centralized and themable
 * per-brand (multi-brand / white-label requirement).
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        velvet: 'var(--velvet)',
        'velvet-2': 'var(--velvet-2)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        brass: 'var(--brass)',
      },
      fontFamily: {
        heading: ['var(--font-heading)', 'Playfair Display', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'Montserrat', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // Prototype rule: border radius maximum 2px.
        none: '0px',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: '2px',
      },
      maxWidth: {
        shell: '1440px',
      },
      letterSpacing: {
        luxe: '0.18em',
      },
    },
  },
  plugins: [],
};

export default config;
