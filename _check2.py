import re

file_path = r'D:\code\py\practise\resume\frontend\src\components\employee\agent\agent-preferences-dialog.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

section_match = re.search(r'section className=.{0,80}', content)
print('Section className:', section_match.group() if section_match else 'NOT FOUND')
print()
print('Has hiddenScrollClass:', 'hiddenScrollClass' in content)
print('Has backtick template:', '${hiddenScrollClass}' in content)
