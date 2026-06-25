/**
 * WaveText：字符波浪跳动 + 品牌蓝光泽逐字流动。
 *
 * 仅用于 running 态步骤提示。每个字符独立 span 做正弦上下波动，
 * 整体容器用渐变 background-clip:text + shimmer 动画营造光流过效果。
 *
 * 注意：Tailwind 动态类名需对应已在 index.css 定义的 @keyframes
 * （wave / shimmer），这里用任意值语法 animate-[wave_...] / animate-[shimmer_...]。
 */

interface WaveTextProps {
  /** 要渲染的文本（按字符拆分波动） */
  text: string;
  /** 附加 className */
  className?: string;
}

export function WaveText({ text, className = '' }: WaveTextProps) {
  if (!text) return null;
  return (
    <span
      aria-label={text}
      // 纯色 fallback #0369A1 优先保证可读；渐变 bg-clip-text 在动画生效时覆盖外观。
      // 动画/shimmer 失效（Tailwind purge、嵌套 inline-block 未穿透）时文字仍可见。
      className={`inline-block text-[#0369A1]
                  bg-[linear-gradient(90deg,#0369A1,#0EA5E9,#38BDF8,#0EA5E9,#0369A1)]
                  bg-[length:200%_100%] bg-clip-text
                  animate-[shimmer_2.5s_linear_infinite] ${className}`}
    >
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          className="inline-block animate-[wave_1.4s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 60}ms`, whiteSpace: 'pre' }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}
