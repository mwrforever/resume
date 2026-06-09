import base64, pathlib

# 完整的 agent-interaction-card.tsx 文件内容（用 base64 编码后解码写入）
# 这样可以完全避免 shell 引号/变量插值问题
content = base64.b64decode(
'aW1wb3J0IHsgdXNlTWVtbywgdXNlU3RhdGUgfSBmcm9tICdyZWFjdCc7CmltcG9ydCB7IENoZWNrQ2lyY2xlMiwgQ2xpcGJvYXJkQ2hlY2ssIE1lc'
)
# 上面的 base64 太长，改用直接读+改的方式
print('placeholder')