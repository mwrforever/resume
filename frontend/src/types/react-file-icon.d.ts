/**
 * react-file-icon 类型声明（该包未提供 @types，DefinitelyTyped 也无）。
 *
 * 仅声明本组件实际使用的 API：FileIcon 组件 + defaultStyles/defaultColors 映射。
 */
declare module 'react-file-icon' {
  import type { ReactNode } from 'react';

  export interface FileIconProps {
    extension?: string;
    size?: number | string;
    color?: string;
    labelColor?: string;
    glyphColor?: string;
    type?: string;
    fold?: boolean;
    radius?: number | string;
    gradientOpacity?: number;
    [key: string]: unknown;
  }

  /** 渲染一个按扩展名着色的文件图标。 */
  export function FileIcon(props: FileIconProps): ReactNode;

  /** 扩展名 → 样式（color/labelColor/glyphColor/type 等）的预设映射。 */
  export const defaultStyles: Record<string, Record<string, unknown>>;

  /** 扩展名 → 主色，供自定义用。 */
  export const defaultColors: Record<string, string>;
}
