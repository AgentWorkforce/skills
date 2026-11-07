import json
from pathlib import Path
import sys
import urllib.request
root=Path('/app/bench-private')
config=json.loads((root/'config.json').read_text())
size=int(sys.argv[1])
request=urllib.request.Request('http://127.0.0.1:9092/run',
    json.dumps({'bytes':size,'samples':100,'warmups':10}).encode(),
    {'Authorization':'Bearer '+config['callback_token'],'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=600) as response:
    result=json.load(response)
(root/('cell-'+str(size)+'.json')).write_text(json.dumps(result))
print('complete',result['complete'],'samples',len(result['samples']))
