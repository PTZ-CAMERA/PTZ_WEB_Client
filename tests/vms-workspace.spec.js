import { test, expect } from '@playwright/test';

const camera = id => ({ id, name: `Mock ${id}`, status: 'ONLINE', eventsStatus: 'SUBSCRIBED', recordingRequested: false, recordingState: 'STOPPED', capabilities: { ptz: true, ptzCenter: true, tracking: true, events: true, recordings: true, chatSearch: true } });
async function fixture(page, handler = () => {}) {
  const commands = []; let connection;
  await page.routeWebSocket('ws://127.0.0.1:5000/ws', ws => {
    connection = ws;
    ws.onMessage(raw => {
      const req = JSON.parse(raw); commands.push(req);
      const reply = (data, ok = true) => ws.send(JSON.stringify({ version: 1, type: 'response', requestId: req.requestId, ok, ...(ok ? { data } : { error: { code: 'TEST_ERROR', message: data } }) }));
      if (req.command === 'GET_CAMERA_LIST') reply({ cameras: [camera('CAM01'), camera('CAM02')] });
      else if (req.command === 'GET_CAMERA_STATUS') reply({ camera: camera(req.cameraId) });
      else if (req.command === 'GET_WEB_STREAM') reply({ cameraId: req.cameraId, source: 'vms', protocol: 'webrtc', ready: true, uri: `http://127.0.0.1:8889/${req.cameraId}/whep` });
      else if (req.command.startsWith('PTZ')) {
        reply({ cameraId: req.cameraId, command: req.command, phase: 'ACCEPTED', motorArrivalConfirmed: false });
        ws.send(JSON.stringify({ version: 1, type: 'notification', event: 'PTZ_RESULT', requestId: req.requestId, ok: true, data: { cameraId: req.cameraId, command: req.command, phase: 'PI_ACKNOWLEDGED', motorArrivalConfirmed: false } }));
      } else handler(req, reply, ws);
    });
  });
  await page.route('http://127.0.0.1:8889/**', route => route.abort());
  await page.goto('/'); await page.locator('#demoToggle').uncheck();
  await expect(page.locator('#cameraName')).toHaveText('Mock CAM01');
  return { commands, notify(event, data, id = 'CAM01') { connection.send(JSON.stringify({ version: 1, type: 'notification', event, cameraId: id, data })); }, disconnect() { connection.close(); } };
}
test('PTZ repeats while held, stops on release, supports center and separates Pi acknowledgement', async ({ page }) => {
  const { commands } = await fixture(page);
  const button = page.getByRole('button', { name: '오른쪽으로 이동' }); const box = await button.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect.poll(() => commands.filter(r => r.command === 'PTZ_MOVE').length).toBeGreaterThanOrEqual(3);
  await page.mouse.up();
  await expect.poll(() => commands.at(-1)?.command).toBe('PTZ_STOP');
  const count = commands.filter(r => r.command === 'PTZ_MOVE').length;
  await page.waitForTimeout(300); expect(commands.filter(r => r.command === 'PTZ_MOVE')).toHaveLength(count);
  expect(commands.find(r => r.command === 'PTZ_MOVE')).toMatchObject({ panVelocity: .3, tiltVelocity: 0 });
  expect(commands.find(r => r.command === 'PTZ_MOVE')).not.toHaveProperty('pan');
  await page.locator('#center').click(); await expect.poll(() => commands.at(-1)?.command).toBe('PTZ_CENTER');
  await expect(page.locator('#log')).toContainText('ACCEPTED'); await expect(page.locator('#log')).toContainText('PI_ACKNOWLEDGED'); await expect(page.locator('#log')).toContainText('모터 도착 확인 아님');
});
test('nullable metadata respects camera/topic scope and stale bbox expires', async ({ page }) => {
  const f = await fixture(page);
  f.notify('CAMERA_METADATA', { cameraId: 'CAM01', topic: 'Analytics/PersonDetection', receivedTimeMs: Date.now(), detected: true, confidence: .92, bboxX: 10, bboxY: 20, bboxWidth: 100, bboxHeight: 200, imageWidth: 1280, imageHeight: 720, frameId: '9007199254740993' });
  await expect(page.locator('#metaDetected')).toHaveText('ON'); await expect(page.locator('#metaConfidence')).toHaveText('92.0%');
  f.notify('CAMERA_METADATA', { cameraId: 'CAM01', topic: 'Tracking/State', receivedTimeMs: Date.now(), tracking: true, detected: null, confidence: null, panCommandAngle: 100, tiltCommandAngle: 90 });
  await expect(page.locator('#metaTracking')).toHaveText('ON'); await expect(page.locator('#metaConfidence')).toHaveText('92.0%'); await expect(page.locator('#metaAngles')).toHaveText('100 / 90');
  f.notify('CAMERA_METADATA', { cameraId: 'CAM02', topic: 'Analytics/PersonDetection', detected: false }, 'CAM02');
  await expect(page.locator('#metaDetected')).toHaveText('ON');
  await expect(page.locator('#metaConfidence')).toHaveText('—', { timeout: 3500 }); await expect(page.locator('#metaDetected')).toHaveText('—');
  f.disconnect(); await expect(page.locator('#metaAngles')).toHaveText('— / —'); await expect(page.locator('#chatSend')).toBeDisabled();
});
test('event filters and cursor map to VMS API without Web playback controls', async ({ page }) => {
  const record = { id: 7, sampleId: 7, recordKind: 'detection_sample', cameraId: 'CAM01', searchTimeMs: Date.now(), type: 'DETECTION_SAMPLE', confidence: .95 };
  const { commands } = await fixture(page, (req, reply) => {
    if (req.command === 'GET_DETECTIONS') reply({ detections: [record], nextCursor: req.cursor ? null : { timeMs: record.searchTimeMs, id: 7 } });
    if (req.command === 'GET_EVENTS') reply({ events: [{ ...record, recordKind: 'state_event', type: 'PERSON_DETECTED', confidence: null }], nextCursor: null });
  });
  await page.locator('#tabEvents').click(); await page.locator('#eventConfidence').fill('90'); await page.locator('#eventSearch').click();
  await expect(page.locator('#eventRows')).toContainText('95.0%');
  expect(commands.find(r => r.command === 'GET_DETECTIONS')).toMatchObject({ minConfidence: .9, limit: 50 });
  await page.locator('#eventNext').click(); await expect(page.locator('#eventNext')).toBeDisabled();
  expect(commands.filter(r => r.command === 'GET_DETECTIONS').at(-1).cursor).toEqual({ timeMs: record.searchTimeMs, id: 7 });
  await expect(page.locator('#eventRows button')).toHaveCount(0); await expect(page.locator('#playbackDetails')).toHaveCount(0);
  expect(commands.some(r => r.command === 'GET_EVENT_PLAYBACK')).toBe(false);
  await page.locator('#eventKind').selectOption('events'); await page.locator('#eventType').selectOption('PERSON_DETECTED'); await page.locator('#eventSearch').click();
  await expect(page.locator('#eventRows')).toContainText('PERSON_DETECTED'); await expect(page.locator('#eventRows td').nth(2)).toHaveText('—');
  expect(commands.find(r => r.command === 'GET_EVENTS')).toMatchObject({ types: ['PERSON_DETECTED'], minConfidence: 0 });
});
test('chat renders plain text, handles clarify/errors, paging and camera changes', async ({ page }) => {
  let delayed; const { commands } = await fixture(page, (req, reply) => {
    if (req.command !== 'CHAT_SEARCH') return;
    if (req.message === '늦은 응답') { delayed = reply; return; }
    if (req.message === '오류') { reply('quota', false); return; }
    if (req.message === '모호한 질문') { reply({ action: 'clarify', answer: '시간 범위를 알려주세요.' }); return; }
    reply({ action: 'search', answer: '<img src=x onerror=alert(1)> 기록 1개', results: [{ cameraId: req.cameraId, id: 1, sampleId: 1, recordKind: 'detection_sample', searchTimeMs: Date.now(), type: 'DETECTION_SAMPLE', confidence: .9, playback: { playable: false } }], nextCursor: req.message.includes('다음') ? null : { id: 1, timeMs: Date.now() } });
  });
  await page.locator('#tabChat').click(); await page.locator('#chatMessage').fill('오늘 사람 탐지'); await page.locator('#chatSend').click();
  await expect(page.locator('#chatRows')).toContainText('90.0%'); await expect(page.locator('#chatHistory')).toContainText('<img src=x'); await expect(page.locator('#chatHistory img')).toHaveCount(0); await expect(page.locator('#chatRows button')).toHaveCount(0);
  expect(commands.find(r => r.command === 'CHAT_SEARCH')).toMatchObject({ timezone: 'Asia/Seoul', cameraId: 'CAM01' });
  await page.locator('#chatNext').click(); await expect(page.locator('#chatNext')).toBeDisabled();
  await page.locator('#chatMessage').fill('모호한 질문'); await page.locator('#chatSend').click(); await expect(page.locator('#chatHistory')).toContainText('시간 범위를 알려주세요');
  await page.locator('#chatMessage').fill('오류'); await page.locator('#chatSend').click(); await expect(page.locator('#chatStatus')).toContainText('TEST_ERROR'); await expect(page.locator('#chatSend')).toBeEnabled();
  await page.locator('#chatMessage').fill('늦은 응답'); await page.locator('#chatSend').click(); await expect(page.locator('#chatSend')).toBeDisabled();
  await page.locator('.camera-card').filter({ hasText: 'CAM02' }).click();
  delayed({ action: 'search', answer: '이전 카메라 응답', results: [], nextCursor: null });
  await expect(page.locator('#chatHistory')).toBeEmpty(); await expect(page.locator('#chatSend')).toBeEnabled();
});
test('registration uses server credentials and recording UI uses existing APIs', async ({ page }) => {
  const { commands } = await fixture(page, (req, reply) => {
    if (req.command === 'DISCOVER_CAMERAS') reply({ devices: [{ name: 'Pi', deviceServiceUrl: 'http://192.168.0.92:8080/onvif/device_service' }] });
    if (req.command === 'REGISTER_CAMERA') reply({ cameraId: 'CAM01', onvifStatus: 'VERIFIED' });
    if (req.command === 'GET_RECORDINGS') reply({ recordings: [{ id: 1, cameraId: 'CAM01', startTimeMs: Date.now() - 10000, endTimeMs: Date.now(), duration: 10, filePath: 'C:/recordings/test.mkv' }] });
    if (req.command === 'START_RECORDING') reply({});
  });
  await page.locator('#tabDevices').click(); await page.locator('#discoverCameras').click(); await expect(page.locator('#discoveredDevices')).toContainText('Pi'); await page.locator('#registerCamera').click(); await expect(page.locator('#deviceStatus')).toContainText('등록 완료');
  const req = commands.find(r => r.command === 'REGISTER_CAMERA'); expect(req).toMatchObject({ profileToken: 'main' }); expect(req).not.toHaveProperty('username'); expect(req).not.toHaveProperty('password');
  await page.locator('#tabRecordings').click(); await page.locator('#recordingSearch').click(); await expect(page.locator('#recordingRows')).toContainText('C:/recordings/test.mkv'); await page.locator('#recordStart').click(); await expect.poll(() => commands.some(r => r.command === 'START_RECORDING')).toBe(true);
  await page.locator('#tabEvents').click(); await page.locator('#eventSearch').focus(); await page.keyboard.press('ArrowRight'); expect(commands.filter(r => r.command === 'PTZ_MOVE')).toHaveLength(0);
});
test('Web live uses the VMS gateway URI and ignores a saved direct Pi WHEP address', async ({ page }) => {
  const requests = [];
  await page.addInitScript(() => localStorage.setItem('ptz.connection', JSON.stringify({ cameraId: 'CAM01', wsUrl: 'ws://127.0.0.1:5000/ws', whepUrl: 'http://192.168.0.92:8889/cam/whep' })));
  page.on('request', req => requests.push(req.url()));
  const { commands } = await fixture(page);
  await expect.poll(() => commands.some(req => req.command === 'GET_WEB_STREAM' && req.cameraId === 'CAM01')).toBe(true);
  await expect.poll(() => requests.some(url => url.startsWith('http://127.0.0.1:8889/CAM01/whep'))).toBe(true);
  expect(requests.some(url => url.includes('192.168.0.92'))).toBe(false);
  await page.locator('#settingsOpen').click(); await expect(page.locator('#whepUrl')).toHaveCount(0);
});
test('tracking distinguishes acceptance, Pi response and confirmed state without optimistic ON', async ({ page }) => {
  const f=await fixture(page,(req,reply,ws)=>{
    if (!req.command.startsWith('TRACKING_'))return;
    reply({cameraId:req.cameraId,command:req.command,phase:'ACCEPTED'});
    ws.send(JSON.stringify({version:1,type:'notification',event:'PTZ_RESULT',requestId:req.requestId,ok:req.command==='TRACKING_ON',
      data:{cameraId:req.cameraId,command:req.command,phase:req.command==='TRACKING_ON' ? 'PI_ACKNOWLEDGED':'FAILED'}}));
  });
  f.notify('CAMERA_METADATA',{topic:'Tracking/State',tracking:false,receivedTimeMs:Date.now()});
  await expect(page.locator('#metaTracking')).toHaveText('OFF'); await page.locator('#trackingToggle').click();
  await expect(page.locator('#trackingRequestStatus')).toContainText('Pi ONVIF 응답');
  await expect(page.locator('#metaTracking')).toHaveText('OFF'); await expect(page.locator('#trackingToggle')).toBeDisabled();
  f.notify('CAMERA_METADATA',{topic:'Tracking/State',tracking:true,receivedTimeMs:Date.now()});
  await expect(page.locator('#metaTracking')).toHaveText('ON'); await expect(page.locator('#trackingToggle')).toBeEnabled();
  await page.locator('#trackingToggle').click(); await expect(page.locator('#trackingRequestStatus')).toContainText('FAILED');
  await expect(page.locator('#metaTracking')).toHaveText('ON'); await expect(page.locator('#trackingToggle')).toBeEnabled();
  expect(f.commands.filter(r=>r.command.startsWith('TRACKING_')).map(r=>r.command)).toEqual(['TRACKING_ON','TRACKING_OFF']);
  f.disconnect(); await expect(page.locator('#trackingToggle')).toBeDisabled();
});
