/**
 * ResumeFileIcon：按文件名扩展名渲染对应文件类型图标。
 *
 * 基于 react-file-icon 的 FileIcon + defaultStyles，区分 pdf/doc/docx 等。
 * 用于 Agent composer 的简历附件 chip 展示，替代通用 Check 图标。
 */

import { FileIcon, defaultStyles } from 'react-file-icon';

interface ResumeFileIconProps {
  /** 完整文件名（含扩展名），用于匹配图标类型 */
  fileName: string;
  /** 图标尺寸（px），默认 18（适配 chip 内高度） */
  size?: number;
}

/** 取文件扩展名（小写，无点）。 */
function extensionOf(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';
}

export function ResumeFileIcon({ fileName, size = 18 }: ResumeFileIconProps) {
  const ext = extensionOf(fileName);
  // defaultStyles 已覆盖 pdf/docx/doc/xls/png 等常见类型；未知扩展回退到默认文件图标
  const style = ext ? (defaultStyles[ext] ?? {}) : {};
  return (
    <span style={{ width: size, height: size, lineHeight: 0 }} className="flex-shrink-0 inline-flex items-center justify-center">
      <FileIcon extension={ext || undefined} size={size} {...style} />
    </span>
  );
}
