/**
 * 设计 Token 唯一来源（基于 ui-ux-pro-max Trust & Authority + Minimalism + Micro-interactions）。
 *
 * 任何组件禁止内联 hex/duration；统一通过此 token 暴露到 tailwind 主题或 CSS variable。
 */

export const tokens = {
  color: {
    primary: '#2563EB',
    primaryHover: '#1D4ED8',
    onPrimary: '#FFFFFF',
    secondary: '#3B82F6',
    accent: '#059669',
    onAccent: '#FFFFFF',

    background: '#F8FAFC',
    surface: '#FFFFFF',
    surfaceMuted: '#F1F5FD',
    surfaceSubtle: '#FAFBFD',

    foreground: '#0F172A',
    mutedText: '#475569',
    subtleText: '#94A3B8',

    border: '#E4ECFC',
    borderStrong: '#CBD5E1',

    success: '#059669',
    warning: '#D97706',
    destructive: '#DC2626',

    thinkingBg: '#F8F4FF',
    thinkingBorder: '#E9DFFF',
    thinkingText: '#4C1D95',
  },
  font: {
    sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  },
  fontSize: {
    xs: '12px', sm: '13px', base: '14px', md: '15px', lg: '16px',
    xl: '18px', '2xl': '20px', '3xl': '24px', '4xl': '30px',
  },
  lineHeight: { tight: '1.35', normal: '1.55', loose: '1.7' },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  spacing: {
    '0.5': '2px', '1': '4px', '1.5': '6px', '2': '8px', '3': '12px',
    '4': '16px', '5': '20px', '6': '24px', '8': '32px', '10': '40px', '12': '48px',
  },
  radius: {
    sm: '6px', base: '8px', md: '10px', lg: '12px', xl: '16px', full: '9999px',
  },
  shadow: {
    sm: '0 1px 2px rgba(15,23,42,0.04)',
    md: '0 4px 12px rgba(15,23,42,0.06)',
    lg: '0 12px 32px rgba(15,23,42,0.08)',
    ring: '0 0 0 3px rgba(37,99,235,0.18)',
  },
  duration: {
    instant: '80ms', fast: '150ms', base: '220ms', exit: '160ms', cascade: '300ms',
  },
  easing: {
    enter: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    exit: 'cubic-bezier(0.4, 0.0, 1, 1)',
    standard: 'cubic-bezier(0.4, 0.0, 0.2, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  z: { base: '0', sticky: '10', dropdown: '20', dialog: '40', toast: '100' },
} as const;
