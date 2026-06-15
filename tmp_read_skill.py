import json
with open('/tmp/hermes-results/call_1eaf1a4aef8641a7b4cc5526.txt') as f:
    data = json.load(f)
content = data['content']
lines = content.split('\n')
for i, line in enumerate(lines):
    l = line.lower()
    if 'linkedin' in l or 'gspread' in l or 'google sheet' in l or 'sheet id' in l or 'posting' in l:
        print(f'{i}: {line[:150]}')
