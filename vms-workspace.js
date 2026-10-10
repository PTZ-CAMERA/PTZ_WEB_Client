'use strict';
(() => {
  const el = id => document.getElementById(id), api = window.VmsControl;
  let signature = '', epoch = 0, metadata = {}, topicTimes = new Map(), bbox = null, bboxAt = 0;
  let eventCursor = null, chatCursor = null, eventQuery = null;
  let trackingPending = null;
  const busy = new Map();
  const overlay = document.createElement('canvas'); overlay.id = 'metadataOverlay'; overlay.className = 'metadata-overlay'; overlay.hidden = true;
  el('stage').append(overlay);
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const time = v => finite(v) ? new Date(v).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false }) : '—';
  const confidence = v => finite(v) && v >= 0 && v <= 1 ? `${(v * 100).toFixed(1)}%` : '—';
  const boolean = v => v === true ? 'ON' : v === false ? 'OFF' : '—';
  const selected = () => api.state();
  const connected = () => !selected().demo && selected().connected;
  function reset() {
    epoch++; busy.clear(); metadata = {}; topicTimes.clear(); clearOverlay(); eventQuery = null; eventCursor = chatCursor = null;
    trackingPending=null; el('trackingRequestStatus').textContent='추적 상태는 Pi 메타데이터로 확인합니다.';
    for (const id of ['eventRows', 'recordingRows', 'chatRows', 'eventFeed', 'chatHistory', 'discoveredDevices']) el(id).replaceChildren();
    for (const id of ['eventSearchStatus', 'recordingSearchStatus', 'chatStatus', 'deviceStatus']) el(id).textContent = '';
    renderMetadata();
  }
  function contextChanged() {
    const state = selected(), next = `${state.demo}/${state.connected}/${state.cameraId}/${state.context}`;
    if (next !== signature) { signature = next; reset(); }
    el('workspaceStatus').textContent = state.demo ? '데모 모드 · 검색 기록은 생성하지 않습니다.' : state.connected ? `${state.cameraId} · VMS 연결됨` : '실제 VMS 연결 후 사용할 수 있습니다.';
    el('eventsReceiver').textContent = state.camera?.eventsStatus || '—';
    el('recordingStatus').textContent = state.camera?.recordingState || '—';
    controls();
  }
  function controls() {
    const s = selected(), active = connected(), caps = s.camera?.capabilities || {};
    el('eventSearch').disabled = !active || busy.has('events');
    el('eventNext').disabled = !active || busy.has('events') || !eventCursor;
    el('recordingSearch').disabled = !active || busy.has('recordings');
    el('recordStart').disabled = !active || !caps.recordings || s.camera?.status !== 'ONLINE' || s.camera?.recordingRequested === true || busy.has('recordCommand');
    el('recordStop').disabled = !active || !caps.recordings || s.camera?.recordingRequested !== true || busy.has('recordCommand');
    el('chatSend').disabled = !active || !caps.chatSearch || busy.has('chat');
    el('chatNext').disabled = el('chatSend').disabled || !chatCursor;
    el('discoverCameras').disabled = !active || busy.has('devices');
    el('registerCamera').disabled = !active || busy.has('register');
    el('refreshCameras').disabled = !active;
    el('trackingToggle').disabled = !active || !caps.tracking || (s.camera?.status !== 'ONLINE' && metadata.tracking !== true) || !!trackingPending || s.manualMoving || s.stopPending;
    el('trackingToggle').textContent = metadata.tracking === true ? '자동 추적 OFF' : '자동 추적 ON';
    el('eventType').disabled = el('eventKind').value === 'detections';
    el('eventConfidence').disabled = el('eventKind').value !== 'detections';
  }
  // 작업별 token과 카메라 epoch를 검사해 이전 검색 응답이 현재 화면을 덮지 못하게 한다.
  function request(key, command, fields, statusId, done, timeout = 15000) {
    if (!connected()) return;
    const token = Symbol(key), version = epoch; busy.set(key, token); controls();
    el(statusId).textContent = '응답 대기 중…';
    const current = () => version === epoch && busy.get(key) === token;
    const fail = reason => { if (!current()) return; busy.delete(key); el(statusId).textContent = reason; controls(); };
    const id = api.send(command, fields, data => {
      if (!current()) return; busy.delete(key);
      try { done(data); } catch { el(statusId).textContent = 'VMS 응답 형식을 확인할 수 없습니다.'; }
      controls();
    }, fail, timeout);
    if (!id) fail('VMS 연결 또는 대기 요청 수를 확인하세요.');
  }
  function clearOverlay() { bbox = null; bboxAt = 0; overlay.hidden = true; }
  function renderMetadata() {
    el('metaDetected').textContent = boolean(metadata.detected);
    el('metaConfidence').textContent = confidence(metadata.confidence);
    el('metaTracking').textContent = boolean(metadata.tracking);
    el('metaAngles').textContent = `${finite(metadata.panCommandAngle) ? metadata.panCommandAngle : '—'} / ${finite(metadata.tiltCommandAngle) ? metadata.tiltCommandAngle : '—'}`;
    el('metaReceived').textContent = time(metadata.receivedTimeMs);
  }
  function notification(message) {
    if (!connected() || message.cameraId !== selected().cameraId || !message.data || typeof message.data !== 'object') return;
    const data = message.data;
    if (data.cameraId && data.cameraId !== selected().cameraId) return;
    if (message.event === 'EVENT_RECEIVER_STATUS') {
      el('eventsReceiver').textContent = data.state || '—';
      if (['RECONNECTING', 'STOPPED', 'DATABASE_ERROR', 'QUEUE_OVERFLOW'].includes(data.state)) { clearOverlay(); metadata.detected = metadata.confidence = null; renderMetadata(); }
      return;
    }
    if (message.event === 'CAMERA_EVENT') {
      const row = document.createElement('p'); row.textContent = `${time(data.searchTimeMs ?? data.receivedTimeMs)} ${data.type || data.eventType || '상태 변경'}`;
      el('eventFeed').prepend(row); while (el('eventFeed').children.length > 20) el('eventFeed').lastChild.remove(); return;
    }
    const topic = typeof data.topic === 'string' ? data.topic : '';
    const stamp = finite(data.sourceTimeMs) ? data.sourceTimeMs : data.receivedTimeMs;
    if (finite(stamp) && stamp < (topicTimes.get(topic) ?? -Infinity)) return;
    if (finite(stamp)) topicTimes.set(topic, stamp);
    // 독립 topic의 null 값은 다른 topic에서 받은 유효한 정보를 지우지 않는다.
    for (const [key, value] of Object.entries(data)) if (value !== null && value !== undefined) metadata[key] = value;
    if (topic === 'Analytics/PersonDetection') {
      for (const key of ['detected', 'confidence', 'bboxX', 'bboxY', 'bboxWidth', 'bboxHeight', 'imageWidth', 'imageHeight']) metadata[key] = data[key] ?? null;
      clearOverlay();
      if (data.detected === true && ['bboxX', 'bboxY', 'bboxWidth', 'bboxHeight', 'imageWidth', 'imageHeight'].every(k => finite(data[k])) && data.bboxX >= 0 && data.bboxY >= 0 && data.bboxWidth > 0 && data.bboxHeight > 0 && data.imageWidth > 0 && data.imageHeight > 0 && data.bboxX + data.bboxWidth <= data.imageWidth && data.bboxY + data.bboxHeight <= data.imageHeight) { bbox = data; bboxAt = Date.now(); }
    }
    if (data.available === false) { clearOverlay(); metadata.detected = metadata.confidence = null; }
    renderMetadata();
    if (trackingPending && typeof data.tracking === 'boolean' && data.tracking===trackingPending.desired) {
      trackingPending=null; el('trackingRequestStatus').textContent=`Pi 메타데이터로 추적 ${data.tracking ? 'ON' : 'OFF'} 확인`; controls();
    }
  }
  function trackingFailed(reason) { if (!trackingPending) return; trackingPending=null; el('trackingRequestStatus').textContent=reason; controls(); }
  function trackingResult(message) {
    if (!trackingPending || message.data?.cameraId !== selected().cameraId || message.data?.command !== trackingPending.command) return;
    if (message.ok===true && message.data.phase==='PI_ACKNOWLEDGED') el('trackingRequestStatus').textContent='Pi ONVIF 응답 확인 · 실제 추적 상태 알림 대기';
    else trackingFailed(`${message.data?.phase || 'FAILED'} · 추적 명령 실패/취소, 확인된 상태 유지`);
  }
  el('trackingToggle').onclick=()=>{
    const state=selected(); if (el('trackingToggle').disabled || state.manualMoving || state.stopPending) return;
    const desired=metadata.tracking!==true, command=desired ? 'TRACKING_ON' : 'TRACKING_OFF';
    trackingPending={desired,command,epoch,deadline:Date.now()+20000}; const token=trackingPending;
    el('trackingRequestStatus').textContent='추적 요청 · VMS/Pi 응답 대기'; controls();
    if (!api.send(command,{},data=>{
      if (trackingPending!==token || token.epoch!==epoch) return;
      if (data.cameraId!==selected().cameraId || data.command!==command || data.phase!=='ACCEPTED') {trackingFailed('잘못된 추적 접수 응답');return;}
      el('trackingRequestStatus').textContent='VMS 접수 · Pi 응답 대기';
    },reason=>{if(trackingPending===token)trackingFailed(reason);})) trackingFailed('VMS 연결 상태를 확인하세요.');
  };
  setInterval(()=>{ if(trackingPending && Date.now()>trackingPending.deadline)trackingFailed('추적 상태 확인 시간 초과 · 실제 상태 미확인'); controls(); },250);
  function drawOverlay() {
    const video = el('video');
    if (bboxAt && Date.now() - bboxAt > 2000) { clearOverlay(); metadata.detected = metadata.confidence = null; renderMetadata(); }
    if (!bbox || video.hidden || !el('emptyState').hidden || !video.videoWidth || !video.videoHeight) { overlay.hidden = true; return; }
    const width = video.clientWidth, height = video.clientHeight;
    if (!width || !height) return;
    overlay.width = width; overlay.height = height; overlay.hidden = false;
    // object-fit:contain과 동일한 표시 영역으로 bbox를 변환한다.
    const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
    const displayW = video.videoWidth * scale, displayH = video.videoHeight * scale;
    const x = (width - displayW) / 2 + bbox.bboxX / bbox.imageWidth * displayW;
    const y = (height - displayH) / 2 + bbox.bboxY / bbox.imageHeight * displayH;
    const ctx = overlay.getContext('2d'); ctx.strokeStyle = '#54d6ba'; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, bbox.bboxWidth / bbox.imageWidth * displayW, bbox.bboxHeight / bbox.imageHeight * displayH);
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#54d6ba'; ctx.fillText(`PERSON ${confidence(bbox.confidence)}`, x, Math.max(15, y - 5));
  }
  setInterval(drawOverlay, 100);
  function range(fromId, toId) {
    // datetime-local을 브라우저 OS 시간대 대신 명시적인 한국 시간으로 해석한다.
    const parse = value => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error('날짜와 시간을 입력하세요.');
      const ms = Date.parse(value + '+09:00'); if (!Number.isFinite(ms)) throw new Error('유효한 시각을 입력하세요.'); return ms;
    };
    const fromMs = parse(el(fromId).value), toMs = parse(el(toId).value) + 1000;
    if (fromMs >= toMs) throw new Error('종료 시각은 시작 시각보다 늦어야 합니다.');
    return { fromMs, toMs };
  }
  const seoulInput = ms => new Date(ms + 9 * 3600000).toISOString().slice(0, 19);
  for (const prefix of ['event', 'recording']) { el(prefix + 'From').value = seoulInput(Date.now() - 3600000); el(prefix + 'To').value = seoulInput(Date.now()); }
  function cell(row, text) { const td = document.createElement('td'); td.textContent = String(text); row.append(td); return td; }
  function rows(target, records) {
    if (!Array.isArray(records) || records.length > 100 || records.some(r => r.cameraId !== selected().cameraId)) throw new Error('잘못된 검색 결과');
    el(target).replaceChildren();
    for (const record of records) {
      const row = document.createElement('tr'); cell(row, time(record.searchTimeMs)); cell(row, record.type || '—'); cell(row, confidence(record.confidence));
      el(target).append(row);
    }
  }
  function searchEvents(next = false) {
    try {
      if (!next) {
        const kind = el('eventKind').value, minimum = Number(el('eventConfidence').value);
        if (!finite(minimum) || minimum < 0 || minimum > 100) throw new Error('Confidence는 0~100 사이입니다.');
        eventQuery = { command: kind === 'detections' ? 'GET_DETECTIONS' : 'GET_EVENTS', fields: { ...range('eventFrom', 'eventTo'), limit: 50, minConfidence: kind === 'detections' ? minimum / 100 : 0 } };
        if (kind === 'events' && el('eventType').value) eventQuery.fields.types = [el('eventType').value];
        eventCursor = null; el('eventRows').replaceChildren();
      }
      if (!eventQuery || (next && !eventCursor)) return;
      const { command, fields } = eventQuery;
      request('events', command, { ...fields, ...(next ? { cursor: eventCursor } : {}) }, 'eventSearchStatus', data => {
        const records = command === 'GET_DETECTIONS' ? data.detections : data.events;
        rows('eventRows', records); eventCursor = data.nextCursor ?? null;
        el('eventSearchStatus').textContent = `${records.length}개 기록${eventCursor ? ' · 다음 페이지 있음' : ''}`;
      });
    } catch (error) { el('eventSearchStatus').textContent = error.message; }
  }
  el('eventForm').onsubmit = event => { event.preventDefault(); searchEvents(); };
  el('eventNext').onclick = () => searchEvents(true);
  for (const id of ['eventKind', 'eventFrom', 'eventTo', 'eventType', 'eventConfidence']) el(id).addEventListener('input', () => { busy.delete('events'); eventCursor = eventQuery = null; el('eventRows').replaceChildren(); el('eventSearchStatus').textContent = '조건이 변경되었습니다. 다시 검색하세요.'; controls(); });
  el('recordingForm').onsubmit = event => {
    event.preventDefault();
    try { request('recordings', 'GET_RECORDINGS', { ...range('recordingFrom', 'recordingTo'), limit: 100 }, 'recordingSearchStatus', data => {
      if (!Array.isArray(data.recordings) || data.recordings.length > 100 || data.recordings.some(r => r.cameraId !== selected().cameraId)) throw new Error('잘못된 녹화 응답');
      el('recordingRows').replaceChildren();
      for (const record of data.recordings) { const row = document.createElement('tr'); for (const value of [time(record.startTimeMs), time(record.endTimeMs), finite(record.duration) ? record.duration.toFixed(2) : '—', record.filePath || '—']) cell(row, value); el('recordingRows').append(row); }
      el('recordingSearchStatus').textContent = `${data.recordings.length}개 완료 녹화 · 최대 100개, 더 좁은 시간 범위로 검색할 수 있습니다.`;
    }); } catch (error) { el('recordingSearchStatus').textContent = error.message; }
  };
  for (const id of ['recordingFrom', 'recordingTo']) el(id).addEventListener('input', () => { busy.delete('recordings'); el('recordingRows').replaceChildren(); el('recordingSearchStatus').textContent = '조건이 변경되었습니다. 다시 검색하세요.'; controls(); });
  for (const [id, command] of [['recordStart', 'START_RECORDING'], ['recordStop', 'STOP_RECORDING']]) el(id).onclick = () => request('recordCommand', command, {}, 'recordingSearchStatus', () => { el('recordingSearchStatus').textContent = '녹화 요청 처리됨 · 카메라 상태에서 결과 확인'; api.refresh(); });
  function chatLine(who, text) { const p = document.createElement('p'); p.textContent = `${who}: ${text}`; el('chatHistory').append(p); while (el('chatHistory').children.length > 100) el('chatHistory').firstChild.remove(); el('chatHistory').scrollTop = el('chatHistory').scrollHeight; }
  function chat(message) {
    if (!message.trim() || busy.has('chat')) return;
    chatLine('나', message);
    request('chat', 'CHAT_SEARCH', { message, timezone: 'Asia/Seoul' }, 'chatStatus', data => {
      if (!['search', 'next_page', 'clarify', 'unsupported', 'select_result'].includes(data.action) || typeof data.answer !== 'string') throw new Error('잘못된 채팅 응답');
      chatLine('VMS', data.action === 'select_result' ? '선택 결과를 확인했습니다. 녹화 영상 재생은 Qt에서 사용하세요.' : data.answer); el('chatStatus').textContent = '응답 완료';
      if (['search', 'next_page'].includes(data.action)) { rows('chatRows', data.results); chatCursor = data.nextCursor ?? null; }
      else if (data.action !== 'select_result') { chatCursor = null; el('chatRows').replaceChildren(); }
    }, 45000);
  }
  el('chatForm').onsubmit = event => { event.preventDefault(); const message = el('chatMessage').value.trim(); if (message && !el('chatSend').disabled) { chat(message); el('chatMessage').value = ''; } };
  el('chatNext').onclick = () => chat('다음 페이지 보여줘');
  el('refreshCameras').onclick = () => api.refresh();
  el('discoverCameras').onclick = () => request('devices', 'DISCOVER_CAMERAS', {}, 'deviceStatus', data => {
    if (!Array.isArray(data.devices) || data.devices.length > 256) throw new Error('잘못된 장치 목록');
    el('discoveredDevices').replaceChildren();
    for (const device of data.devices) {
      if (typeof device.deviceServiceUrl !== 'string') continue;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `${device.name || 'ONVIF Camera'} · ${device.deviceServiceUrl}`;
      button.onclick = () => { el('deviceUrl').value = device.deviceServiceUrl; el('deviceStatus').textContent = '선택한 장치를 등록하세요.'; }; el('discoveredDevices').append(button);
    }
    el('deviceStatus').textContent = `${data.devices.length}개 장치 검색됨. 검색만으로 등록되지는 않습니다.`;
  });
  el('registerForm').onsubmit = event => {
    event.preventDefault();
    try {
      const url = new URL(el('deviceUrl').value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('계정 정보 없는 HTTP(S) Device URL을 입력하세요.');
      request('register', 'REGISTER_CAMERA', { deviceServiceUrl: url.href, profileToken: el('profileToken').value.trim() }, 'deviceStatus', data => {
        el('deviceStatus').textContent = `${data.cameraId} 등록 완료 · 인증은 VMS 설정 사용. 영상은 VMS PC 게이트웨이로 연결됩니다.`; api.refresh();
      });
    } catch (error) { el('deviceStatus').textContent = error.message; }
  };
  for (const name of ['Metadata', 'Events', 'Recordings', 'Chat', 'Devices']) el('tab' + name).onclick = () => {
    for (const other of ['Metadata', 'Events', 'Recordings', 'Chat', 'Devices']) { const active = other === name; el('tab' + other).setAttribute('aria-selected', String(active)); el(other.toLowerCase() + 'Panel').hidden = !active; }
  };
  window.VmsWorkspace = { contextChanged, notification, clearOverlay, trackingResult, trackingFailed };
  // 기존 연결 설정의 구버전 PTZ 안내도 현재 계약에 맞춘다.
  el('wsUrl').nextElementSibling.textContent = 'VMS 카메라 관리·PTZ·탐지·녹화·채팅 검색 API';
  contextChanged();
})();
