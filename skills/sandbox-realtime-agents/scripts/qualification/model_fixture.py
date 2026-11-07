"""Deterministic loopback model fixture; actual Pi tool execution and Relay transports remain real."""
import http.server,json,re,shlex,time,pathlib
ROOT=pathlib.Path('/app/relay-test')
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  b=json.dumps({'object':'list','data':[{'id':'test','object':'model'}]}).encode();self.send_response(200);self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def do_POST(self):
  d=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  ms=d['messages'];last=next((m for m in reversed(ms) if m['role']=='user'),{})
  content=last.get('content','');content=content if isinstance(content,str) else '\n'.join(c.get('text','') for c in content)
  query=re.search(r'E2E_QUERY ([a-zA-Z0-9_-]+) ([a-zA-Z0-9_./-]+)',content)
  finish='stop'
  if query and ms[-1]['role']=='tool':
   t=ms[-1].get('content','');t=t if isinstance(t,str) else json.dumps(t)
   digest=re.search(r'\b[a-f0-9]{64}\b',t)
   delta={'content':f'ACK {query[1]} {digest[0]}' if digest else 'E2E_FAILED missing peer file hash'}
  elif query:
   path=pathlib.PurePosixPath('/app/shared')/query[2]
   if '..' in path.parts:raise ValueError('Bad fixture path')
   delta={'tool_calls':[{'index':0,'id':'call_'+query[1],'type':'function','function':{'name':'bash','arguments':json.dumps({'command':'sha256sum '+shlex.quote(str(path))})}}]};finish='tool_calls'
  else:delta={'content':'Ready for isolated Relayfile qualification.'}
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  def send(delta,reason=None):
   event={'id':'fixture','object':'chat.completion.chunk','created':int(time.time()),'model':'test','choices':[{'index':0,'delta':delta,'finish_reason':reason}]}
   self.wfile.write(('data: '+json.dumps(event)+'\n\n').encode());self.wfile.flush()
  send({'role':'assistant'});send(delta);send({},finish);self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
http.server.ThreadingHTTPServer(('127.0.0.1',8099),Handler).serve_forever()
