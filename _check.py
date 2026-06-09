import re

file_path = r'D:\code\py\practise\resume\frontend\src\components\employee\agent\agent-preferences-dialog.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Check for the template literal issue
section_match = re.search(r'section className=.{0,80}', content)
print('Section className:', section_match.group() if section_match else 'NOT FOUND')

# Check for Chinese chars
print('Has Chinese in tabs:', '\u8fd0\u884c\u6307\u6807' in content)
print('Has Chinese in desc:', '\u4f1a\u8bdd\u6d88\u8017\u6982\u89c8' in content)

# Check no trace
has_trace_type = "type: 'trace'" in content
print('Has trace tab:', has_trace_type)
has_trace_render = "activeTab === 'trace'" in content
print('Has trace render:', has_trace_render)

# Check imports
print('Has Cpu import:', 'Cpu' in content)
print('Has Badge import:', 'Badge' in content)
print('Has IAgentToolStreamItem:', 'IAgentToolStreamItem' in content)
print('Has getToolEventLabel:', 'getToolEventLabel' in content)

# Check toolEvents prop
print('Has toolEvents?:', 'toolEvents?:' in content)
print('Has unknown[]:', 'unknown[]' in content)
