import os,pty,subprocess,select,time,pathlib,json,signal
root=pathlib.Path('/app/relay-test');agent=pathlib.Path.home()/'.pi/agent';agent.mkdir(parents=True,exist_ok=True)
models={'providers':{'relay-test':{'baseUrl':'http://127.0.0.1:8099/v1','api':'openai-completions','apiKey':'synthetic-fixture-value','models':[{'id':'test','contextWindow':128000,'maxTokens':1024}]}}}
(agent/'models.json').write_text(json.dumps(models));(agent/'models.json').chmod(0o600)
(agent/'settings.json').write_text(json.dumps({'quietStartup':True,'lastChangelogVersion':'999.0.0','defaultProvider':'relay-test','defaultModel':'test'}))
master,slave=pty.openpty()
env=dict(os.environ,TERM='xterm-256color',PI_SKIP_VERSION_CHECK='1',PI_CODING_AGENT_DIR=str(agent))
p=subprocess.Popen(['node','/opt/pi-test/node_modules/@earendil-works/pi-coding-agent/dist/cli.js','--provider','relay-test','--model','test','--no-skills','--no-prompt-templates','--no-themes','--session',str(root/'pi-session.jsonl')],cwd='/app/shared',stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True)
os.close(slave)
control=root/'pi-input'
if not control.exists():os.mkfifo(control,0o600)
control_fd=os.open(control,os.O_RDWR|os.O_NONBLOCK)
(root/'pi-pid.json').write_text(json.dumps({'pid':p.pid}))
def stop(*a):
 os.killpg(p.pid,signal.SIGTERM);raise SystemExit
signal.signal(signal.SIGTERM,stop)
with open(root/'pi-terminal.log','ab',buffering=0) as out:
 while p.poll() is None:
  ready,_,_=select.select([master,control_fd],[],[],1)
  if control_fd in ready:
   os.write(master,os.read(control_fd,65536))
  if master in ready:
   try:out.write(os.read(master,65536))
   except OSError:break
raise SystemExit(p.poll() or 0)
