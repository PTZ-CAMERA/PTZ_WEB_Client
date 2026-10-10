import { test, expect } from '@playwright/test';
test('theme selection persists and demo interaction stops on release and blur', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: '다크 모드로 전환' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '화이트 모드로 전환' }).click();
  await page.keyboard.down('ArrowRight'); await expect(page.getByRole('button', { name: '오른쪽으로 이동' })).toHaveClass(/active/);
  await page.keyboard.up('ArrowRight'); await expect(page.getByRole('button', { name: '오른쪽으로 이동' })).not.toHaveClass(/active/);
  const up = page.getByRole('button', { name: '위로 이동' }); const box = await up.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await expect(up).toHaveClass(/active/); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await expect(up).not.toHaveClass(/active/); await page.mouse.up();
  await page.getByRole('button', { name: '영상 정지' }).click(); await expect(page.locator('#emptyTitle')).toHaveText('영상이 정지되었습니다');
  await page.locator('#streamToggle').click(); await expect(page.locator('#demoCanvas')).toBeVisible();
  await expect(page.locator('#log')).toContainText('PTZ 이동 정지'); expect(errors).toEqual([]);
});
test('unsupported VMS keeps PTZ disabled and WebRTC failure never shows LIVE', async ({ page }) => {
  await page.routeWebSocket('ws://127.0.0.1:5000/ws', ws => {
    ws.onMessage(raw => { const req = JSON.parse(raw); const camera = { id: 'CAM01', name: 'Test camera', status: 'ONLINE', capabilities: { ptz: false } };
      ws.send(JSON.stringify({ version: 1, type: 'response', requestId: req.requestId, ok: true, data: req.command === 'GET_WEB_STREAM' ? { cameraId: 'CAM01', ready: true, source: 'vms', protocol: 'webrtc', uri: 'http://127.0.0.1:8889/CAM01/whep' } : req.command === 'GET_CAMERA_LIST' ? { cameras: [camera] } : { camera } })); });
  });
  await page.route('http://127.0.0.1:8889/**', route => route.abort()); await page.goto('/'); await page.locator('#demoToggle').uncheck();
  await expect(page.locator('#cameraName')).toHaveText('Test camera');
  await expect(page.getByRole('button', { name: '위로 이동' })).toBeDisabled(); await expect(page.locator('#center')).toBeDisabled();
  await expect(page.locator('#streamBadge')).not.toHaveText('LIVE'); await expect(page.locator('#ptzNotice')).toContainText('사용할 수 없습니다');
});
test('supported PTZ sends move/stop and clears controls after socket disconnect', async ({ page }) => {
  let connection; const commands = [];
  await page.routeWebSocket('ws://127.0.0.1:5000/ws', ws => { connection = ws; ws.onMessage(raw => {
    const req = JSON.parse(raw); commands.push(req); const camera = { id: 'CAM01', name: 'Mock PTZ', status: 'ONLINE', capabilities: { ptz: true } };
    ws.send(JSON.stringify({ version: 1, type: 'response', requestId: req.requestId, ok: true, data: req.command === 'GET_CAMERA_LIST' ? { cameras: [camera] } : req.command === 'GET_CAMERA_STATUS' ? { camera } : {} }));
  }); });
  await page.route('http://192.168.0.92:8889/**', route => route.abort()); await page.goto('/'); await page.locator('#demoToggle').uncheck();
  await expect(page.getByRole('button', { name: '오른쪽으로 이동' })).toBeEnabled(); await page.locator('h1').click(); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
  await expect.poll(() => commands.filter(c => c.command.startsWith('PTZ')).at(-1)?.command).toBe('PTZ_STOP');
  expect(commands.find(c => c.command === 'PTZ_MOVE')).toMatchObject({ cameraId: 'CAM01', panVelocity: .3, tiltVelocity: 0 });
  connection.close(); await expect(page.getByRole('button', { name: '오른쪽으로 이동' })).toBeDisabled();
});
test('settings persist and mobile layout has no horizontal overflow', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '연결 설정 열기' }).click();
  await page.locator('#cameraId').fill('CAM02');
  await page.getByRole('button', { name: '저장', exact: true }).click(); await expect(page.locator('#selectedId')).toHaveText('CAM02');
  await page.reload(); await expect(page.locator('#selectedId')).toHaveText('CAM02');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: '아래로 이동' })).toBeVisible();
});
