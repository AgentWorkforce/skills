// Bound memory while the private upstream handshake or either peer is stalled.
export function bridge(down, up, {maxBytes=256*1024, maxFrames=32, connectTimeoutMs=2000}={}) {
  let queued = [], queuedBytes = 0, stopped = false;
  const bytes = data => Array.isArray(data) ? data.reduce((sum,item)=>sum+item.byteLength,0)
    : typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
  const stop = (code=1011) => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); queued = []; queuedBytes = 0;
    for (const socket of [down,up]) {
      if (socket.readyState === 0) socket.terminate();
      else if (socket.readyState === 1) socket.close(code);
    }
  };
  const timer = setTimeout(()=>stop(),connectTimeoutMs);
  timer.unref?.();
  const send = (socket,data,binary) => {
    if (stopped) return;
    if (socket.readyState !== 1 || socket.bufferedAmount+bytes(data)>maxBytes) { stop(1009); return; }
    try { socket.send(data,{binary}); } catch { stop(); }
  };
  down.on('message',(data,binary)=>{
    if (stopped) return;
    if (up.readyState === 1) { send(up,data,binary); return; }
    if (up.readyState !== 0 || queued.length>=maxFrames || queuedBytes+bytes(data)>maxBytes) { stop(1009); return; }
    queued.push([data,binary]); queuedBytes += bytes(data);
  });
  up.on('open',()=>{
    clearTimeout(timer);
    const pending = queued; queued = []; queuedBytes = 0;
    for (const [data,binary] of pending) send(up,data,binary);
  });
  up.on('message',(data,binary)=>send(down,data,binary));
  for (const socket of [down,up]) {
    socket.on('close',()=>stop());
    socket.on('error',()=>stop());
  }
}
