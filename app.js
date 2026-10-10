'use strict';
const $ = (id) => document.getElementById(id);
const directions = [...document.querySelectorAll('.direction')];
let demo = true, playing = true, reader = null, socket = null, generation = 0;
let ptzReady = false, selectedId = 'CAM01', requestId = 0, move = null, lastVideoFrames = -1, lastFrameAt = 0;
let position = { pan: 0, tilt: 0 }, pending = new Map(), cameras = [];
let contextVersion = 0, ptzResults = new Map();
const trackingOwners = new Set();
let videoPending = false, videoRetry = null;
let config = { cameraId: 'CAM01', wsUrl: 'ws://127.0.0.1:5000/ws' };
try { const saved = JSON.parse(localStorage.getItem('ptz.connection')); if (saved) { for (const key of Object.keys(config)) if (typeof saved[key] === 'string') config[key] = saved[key]; } } catch {}
for (const key of Object.keys(config)) $(key).value = config[key];
let theme = 'light';
try { theme = localStorage.getItem('ptz.theme') || 'light'; } catch {}
function setTheme(value) {
  theme = value === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.theme = theme;
  $('themeToggle').textContent = theme === 'dark' ? '☀' : '☾';
  $('themeToggle').setAttribute('aria-label', theme === 'dark' ? '화이트 모드로 전환' : '다크 모드로 전환');
  $('themeToggle').title = theme === 'dark' ? '화이트 모드' : '다크 모드';
  try { localStorage.setItem('ptz.theme', theme); } catch {}
}
setTheme(theme); $('themeToggle').onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark');
function log(source, message, error = false) {
  const row = document.createElement('div'); row.className = 'log-row' + (error ? ' error' : '');
  for (const [cls, value] of [['log-time', new Date().toLocaleTimeString('en-GB', { hour12: false })], ['log-source', source], ['log-message', message]]) {
    const span = document.createElement('span'); span.className = cls; span.textContent = value; row.append(span);
  }
  $('log').append(row); while ($('log').children.length > 80) $('log').firstChild.remove(); $('log').scrollTop = $('log').scrollHeight;
}
function empty(title, message) { $('emptyState').hidden = false; $('emptyTitle').textContent = title; $('emptyMessage').textContent = message; }
function renderCameras() {
  $('cameraList').replaceChildren(); $('cameraCount').textContent = String(cameras.length).padStart(2, '0');
  if (!cameras.length) { const p = document.createElement('p'); p.className = 'camera-empty'; p.textContent = '등록된 카메라가 없습니다.'; $('cameraList').append(p); }
  cameras.forEach(camera => {
    const button = document.createElement('button'); button.className = 'camera-card' + (camera.id === selectedId ? ' selected' : '');
    const top = document.createElement('span'); top.className = 'camera-card-top';
    const dot = document.createElement('span'); dot.className = 'dot'; top.append(dot, document.createTextNode(camera.id));
    const name = document.createElement('strong'); name.textContent = camera.name || 'PTZ Camera';
    const small = document.createElement('small'); small.textContent = demo ? 'SIMULATED / PREVIEW' : camera.status || 'UNKNOWN';
    button.append(top, name, small); button.setAttribute('aria-pressed', String(camera.id === selectedId));
    button.onclick = () => {
      if (selectedId !== camera.id) { log('CAMERA', `${camera.id} 선택. 영상 시작 시 VMS 게이트웨이에 연결합니다.`); }
      selectCamera(camera); renderCameras();
      if(!demo)send('GET_CAMERA_STATUS',{},data=>{if(data.camera?.id===selectedId)selectCamera(data.camera);});
    }; $('cameraList').append(button);
  });
}
function selectCamera(camera) {
  if (selectedId !== camera.id) {
    if (trackingOwners.has(selectedId) || [...pending.values(),...ptzResults.values()].some(r=>r.cameraId===selectedId && r.command==='TRACKING_ON')) send('TRACKING_OFF');
    stopMovement(); stopVideo(); contextVersion++;
  }
  selectedId = camera.id; $('cameraNumber').textContent = camera.id; $('cameraName').textContent = camera.name || 'PTZ Camera';
  $('stageCamera').textContent = selectedId; $('selectedId').textContent = selectedId;
  if (!demo && camera.status !== 'ONLINE') { stopMovement(); window.VmsWorkspace?.clearOverlay(); }
  ptzReady = !demo && camera.status === 'ONLINE' && camera.capabilities?.ptz === true && socket?.readyState === WebSocket.OPEN; updateControls();
  window.VmsWorkspace?.contextChanged();
}
function updateControls() {
  const enabled = demo || ptzReady;
  directions.forEach(button => button.disabled = !enabled); $('speed').disabled = !enabled; $('stop').disabled = !enabled;
  $('center').disabled = !demo && !(ptzReady && cameras.find(c => c.id === selectedId)?.capabilities?.ptzCenter === true);
  $('ptzBadge').textContent = demo ? 'DEMO' : ptzReady ? 'READY' : 'OFFLINE';
  $('controlStatus').textContent = demo ? '데모' : ptzReady ? '연결됨' : '사용 불가';
  $('ptzNotice').textContent = demo ? '데모 카메라를 조작하고 있습니다.' : ptzReady ? '누르는 동안 이동하며 놓으면 정지를 요청합니다. Pi 응답은 모터 도착 확인이 아닙니다.' : '현재 서버에서 PTZ를 사용할 수 없습니다.';
}
function send(command, fields = {}, callback, onError, timeoutMs = 5000) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  if (pending.size >= 64) { log('VMS', '응답을 기다리는 요청이 너무 많습니다.', true); return false; }
  const id = String(++requestId);
  pending.set(id, { command, callback, onError, cameraId: selectedId, context: contextVersion, deadline: Date.now() + timeoutMs });
  try { socket.send(JSON.stringify({ version: 1, requestId: id, command, ...(command === 'GET_CAMERA_LIST' ? {} : { cameraId: selectedId }), ...fields })); }
  catch { pending.delete(id); onError?.('연결이 끊겼습니다.'); return false; }
  return id;
}
function stopMovement() {
  if (!move) return;
  move = null; directions.forEach(button => button.classList.remove('active'));
  if (demo) log('DEMO', 'PTZ 이동 정지'); else if (send('PTZ_STOP')) log('PTZ', '정지 요청 전송');
}
function startMovement(pan, tilt, button) {
  if ((!demo && !ptzReady) || $('settings').open) return;
  stopMovement(); move = { pan, tilt }; button?.classList.add('active');
  const speed = Number($('speed').value) / 100;
  if (demo) log('DEMO', `PTZ ${pan < 0 ? '왼쪽' : pan > 0 ? '오른쪽' : tilt > 0 ? '위' : '아래'} 이동 · 속도 ${Math.round(speed * 100)}%`);
  else if (send('PTZ_MOVE', { panVelocity: pan * speed, tiltVelocity: tilt * speed })) log('PTZ', '이동 요청 전송');
  else stopMovement();
}
directions.forEach(button => {
  button.addEventListener('pointerdown', event => { if (event.button !== 0) return; event.preventDefault(); button.setPointerCapture(event.pointerId); startMovement(Number(button.dataset.pan), Number(button.dataset.tilt), button); });
  button.addEventListener('pointerup', stopMovement); button.addEventListener('pointercancel', stopMovement); button.addEventListener('lostpointercapture', stopMovement);
  button.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key) && !event.repeat) { event.preventDefault(); startMovement(Number(button.dataset.pan), Number(button.dataset.tilt), button); } });
  button.addEventListener('keyup', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); stopMovement(); } });
});
$('stop').onclick = () => { if (move) stopMovement(); else if (!demo && ptzReady) send('PTZ_STOP'); else log('DEMO', 'PTZ 정지'); };
$('center').onclick = () => { stopMovement(); if (demo) { position = { pan: 0, tilt: 0 }; log('DEMO', '카메라 중앙 복귀'); } else if (!$('center').disabled) send('PTZ_CENTER'); };
// Pi ContinuousMove의 PT1S timeout 안에서 갱신한다. 입력 해제 후 새 MOVE를 쌓지 않는다.
setInterval(() => {
  if (!demo && move && ptzReady) {
    const speed = Number($('speed').value) / 100;
    if (!send('PTZ_MOVE', { panVelocity: move.pan * speed, tiltVelocity: move.tilt * speed })) stopMovement();
  }
}, 200);
const keyMap = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
let heldKey = null;
document.addEventListener('keydown', event => {
  if ($('settings').open || event.target.closest('#vmsWorkspace') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || event.ctrlKey || event.altKey || event.metaKey) return;
  if (keyMap[event.key] && (demo || ptzReady)) { event.preventDefault(); if (!event.repeat) { heldKey = event.key; const [pan, tilt] = keyMap[event.key]; startMovement(pan, tilt, directions.find(b => Number(b.dataset.pan) === pan && Number(b.dataset.tilt) === tilt)); } }
  if (event.key.toLowerCase() === 'r' && (demo || ptzReady) && !event.repeat) $('center').click();
});
document.addEventListener('keyup', event => { if (event.key === heldKey) { heldKey = null; stopMovement(); } });
window.addEventListener('blur', () => { heldKey = null; stopMovement(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { heldKey = null; stopMovement(); } });
document.addEventListener('focusin', event => { if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) stopMovement(); });
$('speed').oninput = () => { $('speedValue').textContent = $('speed').value + '%'; stopMovement(); };
function closeControl() {
  stopMovement(); ptzReady = false;
  if (socket) { const old = socket; socket = null; old.close(); }
  pending.clear(); ptzResults.clear(); trackingOwners.clear(); contextVersion++; updateControls(); window.VmsWorkspace?.contextChanged();
}
function connectControl() {
  closeControl();
  let ws;
  try { ws = new WebSocket(config.wsUrl); } catch (error) { log('VMS', error.message, true); return; }
  socket = ws;
  const timeout = setTimeout(() => { if (socket === ws && ws.readyState === WebSocket.CONNECTING) { log('VMS', '연결 시간 초과', true); ws.close(); } }, 5000);
  ws.onopen = () => { clearTimeout(timeout); if (socket !== ws) return; log('VMS', '제어 소켓 연결됨'); $('connectionFoot').textContent = 'VMS 연결됨';
    window.VmsWorkspace?.contextChanged();
    send('GET_CAMERA_LIST', {}, data => { if (!Array.isArray(data.cameras)) return; cameras = data.cameras; const chosen = cameras.find(c => c.id === selectedId) || cameras[0]; if (chosen) selectCamera(chosen); else { ptzReady = false; updateControls(); } renderCameras(); if (playing && !reader) requestWebStream(generation); });
    send('GET_CAMERA_STATUS', {}, data => { if (data.camera?.id === selectedId) selectCamera(data.camera); });
  };
  ws.onmessage = event => {
    if (socket !== ws || typeof event.data !== 'string' || event.data.length > 65536) return;
    try {
      const message = JSON.parse(event.data); if (message.version !== 1) return;
      if (message.type === 'notification' && message.event === 'PTZ_RESULT') {
        const request = ptzResults.get(message.requestId); if (!request || request.cameraId !== selectedId || request.context !== contextVersion) return;
        if (message.data?.cameraId !== request.cameraId || message.data?.command !== request.command) return;
        ptzResults.delete(message.requestId);
        if (request.command.startsWith('TRACKING_')) window.VmsWorkspace?.trackingResult(message);
        const phase = message.data?.phase;
        if (phase==='PI_ACKNOWLEDGED') { if(request.command==='TRACKING_ON')trackingOwners.add(request.cameraId);else trackingOwners.delete(request.cameraId); }
        log('PTZ PI', `${message.data?.command || request.command} #${message.requestId} ${phase || 'UNKNOWN'}${phase === 'PI_ACKNOWLEDGED' ? ' · ONVIF 응답, 모터 도착 확인 아님' : ''}`, message.ok !== true);
        if (phase === 'FAILED' && !request.command.startsWith('TRACKING_')) { stopMovement(); ptzReady = false; updateControls(); }
        return;
      }
      if (message.type === 'notification' && ['CAMERA_METADATA', 'CAMERA_EVENT', 'EVENT_RECEIVER_STATUS'].includes(message.event)) { window.VmsWorkspace?.notification(message); return; }
      if (message.type === 'notification' && message.event === 'CAMERA_STATUS') {
        const camera = message.data?.camera; if (!camera || camera.id !== message.cameraId) return;
        const index = cameras.findIndex(c => c.id === camera.id); if (index >= 0) cameras[index] = camera; else cameras.push(camera);
        if (camera.id === selectedId) { if (camera.capabilities?.ptz !== true) stopMovement(); selectCamera(camera); if (playing && !reader && !videoPending && !videoRetry && camera.capabilities?.webRtcLive === true) requestWebStream(generation); } renderCameras(); return;
      }
      if (message.type !== 'response') return;
      const request = pending.get(message.requestId); if (!request) return; pending.delete(message.requestId);
      if (request.command !== 'GET_CAMERA_LIST' && (request.cameraId !== selectedId || request.context !== contextVersion)) return;
      if (message.ok === true) {
        request.callback?.(message.data || {});
        if (request.command.startsWith('PTZ') || request.command.startsWith('TRACKING_')) {
          log('PTZ VMS', `${request.command} #${message.requestId} ${message.data?.phase || 'ACCEPTED'} · Pi 응답 대기`);
          ptzResults.set(message.requestId, { ...request, deadline: Date.now() + 5000 });
        }
      } else { const reason = `${message.error?.code || 'FAILED'}: ${message.error?.message || '요청 실패'}`; log('VMS', `${request.command}: ${reason}`, true); request.onError?.(reason); if (request.command.startsWith('PTZ')) { stopMovement(); ptzReady = false; updateControls(); } }
    } catch { log('VMS', '응답 형식을 확인할 수 없습니다.', true); }
  };
  ws.onerror = () => { if (socket === ws) log('VMS', '제어 소켓에 연결할 수 없습니다.', true); };
  ws.onclose = () => { clearTimeout(timeout); if (socket !== ws) return; stopMovement(); socket = null; ptzReady = false; pending.clear(); ptzResults.clear(); contextVersion++; updateControls(); window.VmsWorkspace?.contextChanged(); $('connectionFoot').textContent = 'VMS 연결 끊김'; log('VMS', '제어 소켓 연결 종료'); };
}
function stopVideo() {
  window.VmsWorkspace?.clearOverlay();
  clearTimeout(videoRetry); videoRetry = null; videoPending = false;
  generation++; playing = false; if (reader) { reader.close(); reader = null; }
  const stream = $('video').srcObject; stream?.getTracks().forEach(track => track.stop()); $('video').srcObject = null; $('video').hidden = true; $('demoCanvas').hidden = true;
  lastVideoFrames = -1; lastFrameAt = 0;
  $('videoState').textContent = '영상 정지'; $('streamStatus').textContent = '정지'; $('streamBadge').textContent = 'STOPPED'; $('streamBadge').className = 'badge';
  $('videoDot').style.background = 'var(--muted)'; $('metricSize').textContent = '—'; $('metricFrames').textContent = '—'; $('resolution').textContent = '—'; $('metricConnection').textContent = '정지';
  $('streamToggle').querySelector('span').textContent = '영상 시작'; empty('영상이 정지되었습니다', '영상 시작 버튼을 눌러 다시 연결하세요.');
}
function startVideo() {
  stopVideo(); playing = true; const current = generation;
  $('streamToggle').querySelector('span').textContent = '영상 정지'; $('demoWatermark').hidden = !demo;
  if (demo) {
    $('demoCanvas').hidden = false; $('emptyState').hidden = true; $('streamBadge').className = 'badge demo'; $('streamBadge').textContent = 'DEMO';
    $('videoState').textContent = '데모 화면'; $('streamStatus').textContent = '데모'; $('metricConnection').textContent = '데모'; $('resolution').textContent = '모의 영상'; $('stageLabel').textContent = 'SIMULATED CAMERA FEED'; $('videoDot').style.background = 'var(--accent)'; return;
  }
  empty('영상 연결 중', 'WebRTC 서버에서 영상 트랙을 기다리고 있습니다.'); $('streamBadge').textContent = 'CONNECTING'; $('videoState').textContent = '연결 중'; $('streamStatus').textContent = '연결 중'; $('metricConnection').textContent = '연결 중'; $('stageLabel').textContent = 'LIVE CAMERA FEED';
  requestWebStream(current);
}
function requestWebStream(current) {
  if (current !== generation || demo || !playing || videoPending || reader) return;
  if (socket?.readyState !== WebSocket.OPEN) { empty('VMS 연결 대기', 'VMS에 연결하면 서버가 제공하는 WebRTC 주소를 조회합니다.'); return; }
  videoPending = true;
  const fail = reason => { if (current !== generation) return; videoPending = false; empty('VMS 영상 연결 실패', reason); $('streamBadge').textContent = 'ERROR'; };
  if (!send('GET_WEB_STREAM', {}, data => {
    if (current !== generation || demo || !playing) return;
    videoPending = false;
    let url; try { url = new URL(data.uri); } catch { fail('잘못된 VMS 영상 주소'); return; }
    if (data.cameraId !== selectedId || data.source !== 'vms' || data.protocol !== 'webrtc' || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || typeof data.ready !== 'boolean') { fail('VMS 게이트웨이 응답 형식을 확인하세요.'); return; }
    if (!data.ready) { empty('VMS 영상 준비 대기', '카메라 등록·VMS 수신 상태를 확인하세요.'); videoRetry = setTimeout(() => requestWebStream(current), 1000); return; }
    connectWebVideo(url.href, current);
  }, fail)) fail('VMS 연결 상태를 확인하세요.');
}
function connectWebVideo(url, current) {
  try {
    reader = new window.MediaMTXWebRTCReader({ url,
      onError: error => { if (current !== generation) return; $('videoState').textContent = '재연결 중'; $('streamStatus').textContent = '재연결 중'; $('streamBadge').textContent = 'RETRYING'; $('streamBadge').className = 'badge'; $('metricConnection').textContent = '재연결 중'; $('videoDot').style.background = 'var(--muted)'; empty('영상에 연결할 수 없습니다', 'WebRTC 주소와 서버 상태를 확인하세요. 자동으로 재연결합니다.'); log('WEBRTC', String(error), true); },
      onTrack: event => { if (current !== generation) return; const stream = event.streams[0] || new MediaStream([event.track]); $('video').srcObject = stream; $('video').hidden = false; $('video').play().catch(() => { empty('재생을 시작해 주세요', '브라우저에서 자동 재생을 허용하지 않았습니다. 영상 시작을 눌러주세요.'); }); log('WEBRTC', '영상 트랙 수신. 프레임 재생 확인 중'); }
    });
  } catch (error) { empty('WebRTC 연결 실패', error.message); log('WEBRTC', error.message, true); }
}
setInterval(() => {
  for (const [id, request] of pending) if (Date.now() > request.deadline) { pending.delete(id); log('VMS', `${request.command} 응답 시간 초과`, true); request.onError?.('응답 시간 초과'); if (request.command.startsWith('PTZ')) { stopMovement(); ptzReady = false; updateControls(); } }
  for (const [id, request] of ptzResults) if (Date.now() > request.deadline) { ptzResults.delete(id); if (request.context === contextVersion && request.cameraId === selectedId) { log('PTZ PI', `${request.command} #${id} Pi 응답 시간 초과`, true); if (request.command.startsWith('TRACKING_')) window.VmsWorkspace?.trackingFailed('Pi 응답 시간 초과 · 실제 추적 상태 미확인'); else { stopMovement(); ptzReady = false; updateControls(); } } }
  if (!demo && playing && !$('video').hidden) {
    const video = $('video'), frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? video.webkitDecodedFrameCount ?? 0;
    if (video.readyState >= 2 && video.videoWidth > 0 && !video.paused && frames > lastVideoFrames && lastVideoFrames >= 0) {
      lastFrameAt = Date.now(); $('emptyState').hidden = true; $('streamBadge').textContent = 'LIVE'; $('streamBadge').className = 'badge live';
      $('videoState').textContent = '영상 수신 중'; $('streamStatus').textContent = '수신 중'; $('metricConnection').textContent = '수신 중'; $('videoDot').style.background = 'var(--accent)';
      $('metricSize').textContent = `${video.videoWidth} × ${video.videoHeight}`; $('metricFrames').textContent = frames.toLocaleString(); $('resolution').textContent = `${video.videoWidth} × ${video.videoHeight}`;
    } else if (lastFrameAt && Date.now() - lastFrameAt > 3000) {
      $('streamBadge').textContent = 'STALLED'; $('streamBadge').className = 'badge'; $('videoState').textContent = '프레임 대기'; $('streamStatus').textContent = '프레임 대기'; $('metricConnection').textContent = '프레임 대기'; $('videoDot').style.background = 'var(--muted)'; empty('영상 수신이 멈췄습니다', '새 프레임을 기다리고 있습니다. 연결 상태를 확인하세요.');
    }
    lastVideoFrames = frames;
  }
}, 500);
function setMode(value) {
  stopMovement(); closeControl(); stopVideo(); demo = value; selectedId = config.cameraId;
  $('modeLabel').textContent = demo ? 'DEMO MODE' : 'DEVICE MODE'; $('connectionFoot').textContent = demo ? '로컬 미리보기 모드' : 'VMS 연결 대기';
  cameras = [{ id: selectedId, name: 'PTZ Camera', status: 'DISCONNECTED' }]; selectCamera(cameras[0]); renderCameras(); startVideo();
  if (!demo) connectControl(); log('SYSTEM', demo ? '데모 모드 · 실제 장치 명령 없음' : '실제 연결 모드 · WebRTC 및 VMS 연결 시작');
}
$('demoToggle').onchange = event => setMode(event.target.checked);
$('streamToggle').onclick = () => { if (playing) { stopVideo(); log('WEBRTC', '영상 정지'); } else { startVideo(); log(demo ? 'DEMO' : 'WEBRTC', '영상 시작'); } };
$('emptyConnect').onclick = startVideo;
$('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('stage').requestFullscreen(); } catch { log('SYSTEM', '전체 화면을 사용할 수 없습니다.', true); } };
$('clearLog').onclick = () => $('log').replaceChildren();
function openSettings() { stopMovement(); $('settingsError').textContent = ''; $('settings').showModal(); }
$('settingsOpen').onclick = openSettings; $('settingsLink').onclick = openSettings;
$('settingsClose').onclick = $('settingsCancel').onclick = () => { $('settings').close(); for (const key of Object.keys(config)) $(key).value = config[key]; };
$('settings').addEventListener('cancel', () => { for (const key of Object.keys(config)) $(key).value = config[key]; });
$('settingsForm').onsubmit = event => {
  event.preventDefault();
  try {
    const ws = new URL($('wsUrl').value);
    if (!['ws:', 'wss:'].includes(ws.protocol)) throw new Error('VMS는 ws(s) 주소를 입력하세요.');
    if (ws.username || ws.password) throw new Error('주소에 계정 정보를 포함하지 마세요.');
    config = { cameraId: $('cameraId').value.trim(), wsUrl: ws.href };
    try { localStorage.setItem('ptz.connection', JSON.stringify(config)); } catch {}
    $('settings').close(); log('SYSTEM', '연결 설정 저장'); setMode(demo);
  } catch (error) { $('settingsError').textContent = error.message; }
};
function tickClock() { const now = new Date(); $('date').textContent = now.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }); $('clock').textContent = now.toLocaleTimeString('en-GB', { hour12: false }); $('stageTime').textContent = now.toLocaleTimeString('en-GB', { hour12: false }); }
tickClock(); setInterval(tickClock, 1000);
const canvas = $('demoCanvas'), ctx = canvas.getContext('2d'); canvas.width = 1280; canvas.height = 800;
let previous = performance.now();
function draw(now) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now;
  if (demo && playing && !document.hidden) {
    if (move) { const velocity = Number($('speed').value) * dt * 3; position.pan = Math.max(-400, Math.min(400, position.pan + move.pan * velocity)); position.tilt = Math.max(-240, Math.min(240, position.tilt + move.tilt * velocity)); }
    const w = canvas.width, h = canvas.height; ctx.fillStyle = '#0c1b24'; ctx.fillRect(0, 0, w, h);
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, 700); gradient.addColorStop(0, '#17353d'); gradient.addColorStop(1, '#08121a'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(-position.pan, position.tilt); ctx.strokeStyle = '#35546066'; ctx.lineWidth = 1;
    for (let x = -640; x < 1920; x += 80) { ctx.beginPath(); ctx.moveTo(x, -400); ctx.lineTo(x, 1200); ctx.stroke(); }
    for (let y = -400; y < 1200; y += 80) { ctx.beginPath(); ctx.moveTo(-640, y); ctx.lineTo(1920, y); ctx.stroke(); }
    ctx.strokeStyle = '#668d8d'; ctx.lineWidth = 2; ctx.strokeRect(320, 180, 640, 440);
    const corners = [[320, 180, 1, 1], [960, 180, -1, 1], [320, 620, 1, -1], [960, 620, -1, -1]];
    ctx.strokeStyle = '#72bca8'; ctx.lineWidth = 3; for (const [x, y, a, b] of corners) { ctx.beginPath(); ctx.moveTo(x + a * 25, y); ctx.lineTo(x, y); ctx.lineTo(x, y + b * 25); ctx.stroke(); }
    ctx.strokeStyle = '#5a837c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(640, 400, 114, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(640, 400, 100, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#9abbb7'; ctx.textAlign = 'center'; ctx.font = '16px monospace'; ctx.fillText('PTZ / CAMERA TEST PATTERN', 640, 260); ctx.fillStyle = '#6c9690'; ctx.font = '12px monospace'; ctx.fillText('HOLD ARROW BUTTONS TO MOVE', 640, 560);
    const colors = ['#b4c6c7', '#cab579', '#6aa9a2', '#7394b0', '#7f7c99', '#a97878']; colors.forEach((color, index) => { ctx.fillStyle = color; ctx.fillRect(495 + index * 49, 652, 45, 25); }); ctx.restore();
    ctx.fillStyle = '#7e9d9d'; ctx.font = '11px monospace'; ctx.textAlign = 'left'; ctx.fillText(`PAN ${Math.round(position.pan).toString().padStart(4)}  /  TILT ${Math.round(position.tilt).toString().padStart(4)}`, 35, 735);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
window.addEventListener('pagehide', () => { closeControl(); stopVideo(); });
setMode(true);
// 화면 모듈은 같은 소켓을 재사용한다. 계정과 Gemini 키는 VMS 설정에만 보관한다.
window.VmsControl = {
  send,
  state: () => ({ demo, connected: socket?.readyState === WebSocket.OPEN, cameraId: selectedId, camera: cameras.find(c => c.id === selectedId), context: contextVersion, manualMoving: !!move, stopPending: [...pending.values(), ...ptzResults.values()].some(r => r.cameraId === selectedId && r.command === 'PTZ_STOP') }),
  refresh: () => send('GET_CAMERA_LIST', {}, data => { if (!Array.isArray(data.cameras)) return; cameras = data.cameras; const chosen = cameras.find(c => c.id === selectedId) || cameras[0]; if (chosen) selectCamera(chosen); renderCameras(); window.VmsWorkspace?.contextChanged(); }),
  log,
};
