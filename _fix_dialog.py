import re

file_path = r'D:\code\py\practise\resume\frontend\src\components\employee\agent\agent-preferences-dialog.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove Cpu icon import
content = content.replace(
    "import { Activity, Brain, Cpu, X } from 'lucide-react';",
    "import { Activity, Brain, X } from 'lucide-react';"
)

# 2. Remove IAgentToolStreamItem import
content = content.replace(
    "import type { IAgentMemoryItem, IAgentToolStreamItem } from '@/types/agent';",
    "import type { IAgentMemoryItem } from '@/types/agent';"
)

# 3. Remove getToolEventLabel, getToolEventVariant imports
content = content.replace(
    "import { getToolEventLabel, getToolEventVariant, hiddenScrollClass } from './agent-ui-utils';",
    "import { hiddenScrollClass } from './agent-ui-utils';"
)

# 4. Update PreferenceTab type
content = content.replace(
    "type PreferenceTab = 'metrics' | 'memories' | 'trace';",
    "type PreferenceTab = 'metrics' | 'memories';"
)

# 5. Update props interface - toolEvents becomes optional unknown[]
old_iface = """interface AgentPreferencesDialogProps {
  open: boolean;
  memories: IAgentMemoryItem[];
  toolEvents: IAgentToolStreamItem[];
  totalTokens: number;
  messageCount: number;
  actionCount: number;
  onClose: () => void;
}"""
new_iface = """interface AgentPreferencesDialogProps {
  open: boolean;
  memories: IAgentMemoryItem[];
  /** \u4fdd\u7559 prop \u4ee5\u517c\u5bb9\u7236\u7ec4\u4ef6\u8c03\u7528\uff0cTrace \u6a21\u5757\u5df2\u79fb\u9664 */
  toolEvents?: unknown[];
  totalTokens: number;
  messageCount: number;
  actionCount: number;
  onClose: () => void;
}"""
content = content.replace(old_iface, new_iface)

# 6. Remove trace tab from preferenceTabs array
tabs_pattern = r"const preferenceTabs = \[.+?\];"
new_tabs = """const preferenceTabs = [
  { type: 'metrics' as const, icon: Activity, label: '\u8fd0\u884c\u6307\u6807', description: '\u4f1a\u8bdd\u6d88\u8017\u6982\u89c8' },
  { type: 'memories' as const, icon: Brain, label: '\u957f\u671f\u8bb0\u5fc6', description: '\u5f53\u524d\u7528\u6237\u8bb0\u5fc6' },
];"""
content = re.sub(tabs_pattern, new_tabs, content, flags=re.DOTALL)

# 7. Update description text (remove Trace mention)
desc_pattern = r'<p className="mt-1 text-sm text-slate-500">.*?</p>'
new_desc = '<p className="mt-1 text-sm text-slate-500">\u8fd0\u884c\u6307\u6807\u4e0e\u957f\u671f\u8bb0\u5fc6\u4fe1\u606f\uff0c\u7528\u4e8e\u6392\u67e5\u5f53\u524d\u4f1a\u8bdd\u6267\u884c\u8fc7\u7a0b\u3002</p>'
content = re.sub(desc_pattern, new_desc, content)

# 8. Remove Trace rendering block
trace_pattern = r"\s*\{activeTab === 'trace' && \(.+?\)\}\s*"
content = re.sub(trace_pattern, '', content, flags=re.DOTALL)

# 9. Remove Badge import if no longer used
if '<Badge' not in content:
    badge_import = "import { Badge } from '@/components/ui/badge';\n"
    content = content.replace(badge_import, '')

with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print('Done')
