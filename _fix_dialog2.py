import re

file_path = r'D:\code\py\practise\resume\frontend\src\components\employee\agent\agent-preferences-dialog.tsx'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the leftover trace rendering block
# Pattern: everything from "}>{getToolEventLabel" to the closing "\n            )}\n          </section>"
trace_leftover_start = content.find("}>{getToolEventLabel(item.type)}</Badge>")
if trace_leftover_start != -1:
    # Find the end of the trace block - look backwards from start to find {activeTab
    # and forward to find the matching closing
    # The leftover starts right after the memories closing </div>\n            )}
    # Find the last occurrence of the memories block closing
    memories_close = content.rfind("{activeTab === 'memories'", 0, trace_leftover_start)
    # Find the end of memories block
    after_memories = content.find("</div>", memories_close)
    # Find the end of the memories conditional
    after_memories_conditional = content.find(")}", after_memories)
    
    # The trace leftover is between after_memories_conditional and </section>
    section_close = content.find("</section>", trace_leftover_start)
    
    # Extract: keep everything up to and including the memories closing ")}"
    # then skip to </section>
    before_trace = content[:after_memories_conditional + 2]
    after_trace = content[section_close:]
    
    content = before_trace + "\n          " + after_trace

# Also fix the preferenceTabs - the unicode replacements didn't work from PS file
# Let me check what's actually in there
print("Checking tabs content...")
tabs_match = re.search(r"const preferenceTabs = \[.+?\];", content, re.DOTALL)
if tabs_match:
    print(f"Current tabs: {repr(tabs_match.group())}")

with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(content)

print("Done")
