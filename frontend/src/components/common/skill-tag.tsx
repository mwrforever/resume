import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface SkillTagProps {
  skill: string;
  type: '必须满足' | '优先匹配' | '普通技能';
  matchLabel?: string;
  hitContext?: string;
  isHit?: boolean;
}

export function SkillTag({ skill, type, matchLabel, hitContext, isHit }: SkillTagProps) {
  const [showDialog, setShowDialog] = useState(false);

  const bgColor = {
    '必须满足': isHit ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger',
    '优先匹配': isHit ? 'bg-primary/20 text-primary' : 'bg-secondary/20 text-secondary',
    '普通技能': isHit ? 'bg-warning/20 text-warning' : 'bg-secondary/20 text-secondary',
  }[type];

  return (
    <>
      <button
        onClick={() => hitContext && setShowDialog(true)}
        className={`px-3 py-1 rounded-full text-sm ${bgColor} ${hitContext ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
      >
        {skill} {isHit ? '✓' : '✗'}
      </button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogTitle>技能详情: {skill}</DialogTitle>
          <div className="space-y-2">
            <p><span className="font-medium">类型:</span> {type}</p>
            <p><span className="font-medium">匹配度:</span> {matchLabel || (isHit ? '命中' : '未命中')}</p>
            {hitContext && (
              <div>
                <p className="font-medium mb-1">命中片段:</p>
                <p className="text-gray-600 bg-gray-50 p-3 rounded">{hitContext}</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
