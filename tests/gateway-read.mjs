// Python fixture가 띄운 VMS/MediaMTX/정적 서버만 사용한다. 실물 Pi·PTZ·녹화 요청은 없다.
import { chromium, expect } from '@playwright/test';
const [webPort, apiPort] = process.argv.slice(2).map(Number);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(); const errors = [], urls = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('request', r => urls.push(r.url()));
  await page.addInitScript(({ apiPort }) => localStorage.setItem('ptz.connection', JSON.stringify({ cameraId: 'CAM01', wsUrl: `ws://127.0.0.1:${apiPort}/ws` })), { apiPort });
  await page.goto(`http://127.0.0.1:${webPort}`); await page.locator('#demoToggle').uncheck();
  await expect(page.locator('#streamBadge')).toHaveText('LIVE', { timeout: 30000 });
  const video = await page.locator('#video').evaluate(v => ({ width: v.videoWidth, height: v.videoHeight, frames: v.getVideoPlaybackQuality().totalVideoFrames }));
  if (video.width !== 1280 || video.height !== 720 || video.frames < 2 || errors.length) throw new Error(JSON.stringify({ video, errors }));
  if (urls.some(url => url.includes('192.168.0.92'))) throw new Error('Browser attempted a direct Pi connection');
  if (!urls.some(url => url.includes('/CAM01/whep'))) throw new Error('No PC gateway WHEP request');
  console.log(JSON.stringify({ route: 'synthetic RTSP -> VMS relay -> PC MediaMTX -> browser WebRTC', ...video, errors }));
} finally { await browser.close(); }
