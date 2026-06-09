file_path = r'D:\code\py\practise\resume\frontend\src\components\employee\agent\agent-preferences-dialog.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the section className - PowerShell ate the backtick template literal
broken = "section className={overflow-y-auto p-5 }>"
fixed = 'section className={`overflow-y-auto p-5 ${hiddenScrollClass}`}>'
content = content.replace(broken, fixed)

with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print('Fixed')
