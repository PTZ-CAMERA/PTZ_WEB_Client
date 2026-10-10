import { chromium, expect } from '@playwright/test';
const [webPort, apiPort] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); const errors = [], urls = [], commands = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => urls.push(r.url()));
  page.on('websocket', ws => ws.on('framesent', e => { try { commands.push(JSON.parse(e.payload).command); } catch {} }));
  await page.addInitScript(({ apiPort }) => localStorage.setItem('ptz.connection', JSON.stringify({ cameraId: 'CAM01', wsUrl: `ws://127.0.0.1:${apiPort}/ws` })), { apiPort });
  await page.goto(`http://127.0.0.1:${webPort}`); await page.locator('#demoToggle').uncheck();
  await expect(page.locator('#streamBadge')).toHaveText('LIVE', { timeout: 30000 });
  const video = await page.locator('#video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
  if (video.width !== 1280 || video.height !== 720 || video.frames < 2 || errors.length) throw new Error(JSON.stringify({ video, errors }));
  if (urls.some(url => url.includes('192.168.0.92') || url.includes('/whep') || url.includes(':8889'))) throw new Error('External gateway or direct Pi request');
  if (!commands.includes('WEBRTC_START') || !commands.includes('WEBRTC_ANSWER')) throw new Error('Missing native signaling');
  await page.locator('#streamToggle').click(); await expect(page.locator('#streamBadge')).toHaveText('STOPPED');
  await page.locator('#streamToggle').click(); await expect(page.locator('#streamBadge')).toHaveText('LIVE', { timeout: 30000 });
  console.log(JSON.stringify({ route: 'synthetic RTSP -> VMS native WebRTC -> browser', ...video, errors, stopAndReconnect: true }));
} finally { await browser.close(); }
