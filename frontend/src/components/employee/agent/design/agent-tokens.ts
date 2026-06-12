/**
 * Agent 工作台设计 Token
 *
 * 仅 Agent 工作台使用，不污染全局 CSS。
 * 颜色值与现有主侧栏（深空蓝渐变）品牌一致。
 */

export const agentColors = {
  brand: {
    navy:    '#0F172A',
    navy2:   '#082F49',
    ink:     '#020617',
    sky:     '#0369A1',
    sky2:    '#0EA5E9',
    skyTint: '#E0F2FE',
  },
  surface: {
    app:     '#F8FAFC',
    card:    '#FFFFFF',
    raised:  '#FFFFFF',
    hover:   '#F1F5F9',
    muted:   '#E8ECF1',
  },
  text: {
    primary:      '#020617',
    secondary:    '#334155',
    tertiary:     '#64748B',
    disabled:     '#94A3B8',
    onBrand:      '#FFFFFF',
    onBrandMuted: 'rgba(255,255,255,0.7)',
  },
  semantic: {
    success:  '#16A34A', successBg:  '#DCFCE7',
    warning:  '#D97706', warningBg:  '#FEF3C7',
    danger:   '#DC2626', dangerBg:   '#FEE2E2',
    info:     '#0369A1', infoBg:     '#E0F2FE',
    thinking: '#7C3AED', thinkingBg: '#F3E8FF',
  },
  border: {
    subtle:  '#E2E8F0',
    default: '#CBD5E1',
    strong:  '#94A3B8',
    focus:   '#0EA5E9',
  },
} as const;

export const agentTypography = {
  fontFamily: "'Plus Jakarta Sans', -apple-system, 'PingFang SC', sans-serif",
  fontSize:   { xs: 12, sm: 13, base: 14, md: 15, lg: 16, xl: 18, '2xl': 22, '3xl': 28 },
  lineHeight: { tight: 1.3, normal: 1.5, relaxed: 1.7 },
  fontWeight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;

export const agentRadius = { sm: 6, md: 10, lg: 14, xl: 18, '2xl': 22, full: 9999 } as const;

export const agentShadow = {
  sm:   '0 1px 2px rgba(15,23,42,0.06)',
  md:   '0 4px 12px rgba(15,23,42,0.08)',
  lg:   '0 8px 24px rgba(15,23,42,0.10)',
  xl:   '0 16px 40px rgba(15,23,42,0.14)',
  ring: '0 0 0 3px rgba(14,165,233,0.25)',
} as const;

export const agentMotion = {
  duration: { fast: 150, normal: 220, slow: 320 } as const,
  easing:   {
    standard:   'cubic-bezier(0.2, 0, 0, 1)',
    emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  } as const,
};
