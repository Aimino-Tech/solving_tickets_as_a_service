import json
with open('/tmp/hermes-results/call_1eaf1a4aef8641a7b4cc5526.txt') as f:
    data = json.load(f)
content = data['content']
lines = content.split('\n')
# Find LinkedIn sections with more context
for i, line in enumerate(lines):
    l = line.lower()
    if 'linkedin' in l:
        start = max(0, i-2)
        end = min(len(lines), i+5)
        for j in range(start, end):
            print(f'{j}: {lines[j][:180]}')
        print('---')
