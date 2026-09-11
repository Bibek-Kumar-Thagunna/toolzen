import type { Config } from 'tailwindcss';

/**
 * Design tokens live in two places on purpose:
 *   - `src/app/globals.css` holds the raw channel values for light + dark themes
 *   - this file maps them to semantic Tailwind utilities
 *
 * Rule: application code must never use a raw palette utility (e.g. `bg-zinc-800`).
 * It uses semantic names (`bg-surface`, `text-fg-muted`, `border-border`) so the
 * light and dark themes stay coherent and are designed, not inverted.
 */
const withAlpha = (variable: string) => `rgb(var(${variable}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      screens: {
        xs: '380px',
        '3xl': '1600px',
      },
      colors: {
        canvas: withAlpha('--c-canvas'),
        surface: {
          DEFAULT: withAlpha('--c-surface'),
          raised: withAlpha('--c-surface-raised'),
          sunken: withAlpha('--c-surface-sunken'),
          hover: withAlpha('--c-surface-hover'),
        },
        track: withAlpha('--c-track'),
        border: {
          DEFAULT: withAlpha('--c-border'),
          strong: withAlpha('--c-border-strong'),
          subtle: withAlpha('--c-border-subtle'),
        },
        fg: {
          DEFAULT: withAlpha('--c-fg'),
          muted: withAlpha('--c-fg-muted'),
          subtle: withAlpha('--c-fg-subtle'),
          onAccent: withAlpha('--c-fg-on-accent'),
        },
        /**
         * The primary action colour, deliberately separate from `accent`.
         *
         * Buttons are near-black; the accent is teal and is reserved for links,
         * focus, active state and the mark. Collapsing the two would put a
         * coloured button on every card and leave the accent meaning nothing.
         */
        primary: {
          DEFAULT: withAlpha('--c-primary'),
          hover: withAlpha('--c-primary-hover'),
          active: withAlpha('--c-primary-active'),
          fg: withAlpha('--c-primary-fg'),
        },
        accent: {
          DEFAULT: withAlpha('--c-accent'),
          hover: withAlpha('--c-accent-hover'),
          active: withAlpha('--c-accent-active'),
          subtle: withAlpha('--c-accent-subtle'),
          border: withAlpha('--c-accent-border'),
          fg: withAlpha('--c-accent-fg'),
        },
        success: {
          DEFAULT: withAlpha('--c-success'),
          subtle: withAlpha('--c-success-subtle'),
          fg: withAlpha('--c-success-fg'),
          border: withAlpha('--c-success-border'),
        },
        warning: {
          DEFAULT: withAlpha('--c-warning'),
          subtle: withAlpha('--c-warning-subtle'),
          fg: withAlpha('--c-warning-fg'),
          border: withAlpha('--c-warning-border'),
        },
        danger: {
          DEFAULT: withAlpha('--c-danger'),
          subtle: withAlpha('--c-danger-subtle'),
          fg: withAlpha('--c-danger-fg'),
          border: withAlpha('--c-danger-border'),
        },
        info: {
          DEFAULT: withAlpha('--c-info'),
          subtle: withAlpha('--c-info-subtle'),
          fg: withAlpha('--c-info-fg'),
          border: withAlpha('--c-info-border'),
        },
        ring: withAlpha('--c-ring'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        md: ['1rem', { lineHeight: '1.625rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem', letterSpacing: '-0.005em' }],
        xl: ['1.25rem', { lineHeight: '1.875rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.015em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        '5xl': ['2.75rem', { lineHeight: '2.9rem', letterSpacing: '-0.03em' }],
        '6xl': ['3.5rem', { lineHeight: '3.6rem', letterSpacing: '-0.032em' }],
      },
      borderRadius: {
        // Deliberately restrained. Cards are 8-10px, not 24px pills.
        xs: '0.1875rem',
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        // Tight, low-opacity shadows read as "crafted"; large blurs read as "template".
        xs: '0 1px 2px 0 rgb(var(--c-shadow) / 0.05)',
        sm: '0 1px 2px 0 rgb(var(--c-shadow) / 0.06), 0 1px 1px -1px rgb(var(--c-shadow) / 0.04)',
        DEFAULT: '0 1px 3px 0 rgb(var(--c-shadow) / 0.07), 0 1px 2px -1px rgb(var(--c-shadow) / 0.05)',
        md: '0 4px 10px -2px rgb(var(--c-shadow) / 0.08), 0 2px 4px -2px rgb(var(--c-shadow) / 0.05)',
        lg: '0 12px 28px -8px rgb(var(--c-shadow) / 0.12), 0 4px 8px -4px rgb(var(--c-shadow) / 0.06)',
        popover: '0 16px 40px -12px rgb(var(--c-shadow) / 0.18), 0 0 0 1px rgb(var(--c-border) / 1)',
        none: 'none',
      },
      maxWidth: {
        prose: '68ch',
        tool: '52rem',
        shell: '90rem',
      },
      spacing: {
        '4.5': '1.125rem',
        '13': '3.25rem',
        '18': '4.5rem',
        header: 'var(--header-h)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '180ms',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'indeterminate': {
          '0%': { transform: 'translateX(-100%) scaleX(0.4)' },
          '100%': { transform: 'translateX(320%) scaleX(0.4)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up': 'slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-in': 'scale-in 150ms cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        indeterminate: 'indeterminate 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
