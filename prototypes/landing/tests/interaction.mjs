import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.LANDING_URL || 'http://127.0.0.1:5176/';
const out = fileURLToPath(new URL('../../../artifacts/landing/', import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 3 });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base); await page.locator('.loading').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.scene-fallback').count(), 0);
  await page.screenshot({ path: out + 'desktop.png', fullPage: true });
  assert.equal(await page.getByRole('link', { name: 'Открыть сервис' }).count(), 1);
  assert.equal(await page.locator('.prototype-label,.eyebrow,.scene-caption,.zone-meta,#tour').count(), 0);
  for (const width of [320, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const dock = await page.locator('.zone-dock').boundingBox(), panel = await page.locator('.scene-panel').boundingBox();
    assert.ok(dock.height <= 54 && dock.y + dock.height <= panel.y + panel.height && dock.y >= panel.y);
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      const ratio = Math.min(devicePixelRatio, 3, Math.sqrt(3_000_000 / (canvas.clientWidth * canvas.clientHeight)));
      return Math.abs(canvas.width - Math.floor(canvas.clientWidth * ratio)) <= 1;
    });
    const density = await page.locator('canvas').evaluate(canvas => canvas.width / canvas.clientWidth);
    assert.ok(density >= 2.9, `Expected native mobile density, got ${density}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (let i = 0; i < 4; i++) {
    await page.getByRole('tab').nth(i).click(); await page.waitForTimeout(1650);
    assert.equal(await page.getByRole('tab').nth(i).getAttribute('aria-selected'), 'true');
    await page.screenshot({ path: out + `zone-${i + 1}-390.png`, fullPage: true });
  }
  await page.getByRole('tab').nth(1).click(); await page.waitForTimeout(1650);
  await page.getByRole('tab').nth(2).click(); await page.waitForTimeout(750);
  await page.screenshot({ path: out + 'cutaway-midpoint.png', fullPage: true });
  await page.getByRole('tab').first().click(); await page.waitForTimeout(180);
  await page.getByRole('tab').nth(3).click(); await page.waitForTimeout(1650);
  assert.equal(await page.getByRole('tab').nth(3).getAttribute('aria-selected'), 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('tab').first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab').nth(1).getAttribute('aria-selected'), 'true');
  assert.deepEqual(errors, []);
  // Isolated real renderer: verify no shader variants appear during the first cutaway.
  await page.route('**/renderer-qa.html', route => route.fulfill({ contentType: 'text/html', body: '<div id="fixture" style="width:390px;height:400px"></div>' }));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(new URL('renderer-qa.html', base).href);
  const rendering = await page.evaluate(async () => {
    const { BuildingScene } = await import('/src/scene.ts');
    const { entrance, rampHeightAt, routes } = await import('/src/layout.ts');
    const scene = new BuildingScene(document.querySelector('#fixture')); await scene.ready;
    const programs = scene.renderer.info.programs.length;
    let stable = true, modes = true, maximumCalls = 0;
    for (const zone of [1, 2, 3, 0]) {
      scene.select(zone);
      await new Promise(resolve => {
        const started = performance.now();
        function sample() {
          stable &&= scene.renderer.info.programs.length === programs;
          modes &&= scene.facadeMaterials.every(material => material.transparent && !material.depthWrite);
          maximumCalls = Math.max(maximumCalls, scene.renderer.info.render.calls);
          if (performance.now() - started > 1600) resolve(); else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    }
    const maxRouteDraws = scene.routeMeshes.length;
    const noRoofTranslation = scene.roof.position.y === 0 && scene.facade.position.y === 0;
    const routeDots = scene.routeMeshes[3];
    const matrix = scene.camera.matrix.clone();
    let noWallCrossing = true;
    for (let i = 0; i < routeDots.count; i++) {
      routeDots.getMatrixAt(i, matrix); const x = matrix.elements[12], z = matrix.elements[14];
      if (Math.abs(z - .65) < .12 && !(x > 2.6 && x < 4.3)) noWallCrossing = false;
      if (Math.abs(x - 1.45) < .12 && z < .725) noWallCrossing = false;
    }
    const exactRamp = rampHeightAt(entrance.landingFront) === entrance.landingTop && Math.abs(rampHeightAt(entrance.rampEnd) - entrance.groundTop) < 1e-9;
    const entranceRoute = routes[1].every(([x,y,z]) => z <= entrance.landingFront || Math.abs(y - rampHeightAt(z) - .025) < 1e-9);
    scene.dispose(); return { stable, modes, maximumCalls, maxRouteDraws, noRoofTranslation, noWallCrossing, exactRamp, entranceRoute };
  });
  assert.ok(rendering.stable && rendering.modes && rendering.noRoofTranslation);
  assert.ok(rendering.maximumCalls < 200); assert.equal(rendering.maxRouteDraws, 4);
  assert.ok(rendering.noWallCrossing && rendering.exactRamp && rendering.entranceRoute);
  console.log('PASS: four views, native-density canvas, 320/390/430px, 54px map-bound dock, keyboard, reduced motion, interrupted transition, stable shaders, four instanced routes, exact ramp endpoints and restroom door clearance.', rendering);
} finally { await browser.close(); }
