import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.env.MOTION_TEST_URL || 'http://127.0.0.1:5175/frontend/';
const out = fileURLToPath(new URL('../../artifacts/motion/', import.meta.url));
await mkdir(out,{recursive:true});
const browser = await chromium.launch(); const errors=[];
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);
  const ids=[];
  for(let i=0;i<2;i++){
    await page.getByRole('button',{name:'Новое обследование',exact:true}).click();
    await page.getByLabel('Название объекта',{exact:true}).fill(`Проверка плавности ${i+1}`);
    await page.getByLabel('Адрес',{exact:true}).fill('Тестовый объект');
    await page.getByLabel('Исполнитель',{exact:true}).fill('Тест UI');
    await page.getByLabel('Проверяем только входную группу Z2').check();
    await page.getByRole('button',{name:'Создать обследование',exact:true}).click();
    await page.locator('.audit-editor[data-page-ready=true]').waitFor();
    ids.push(new URL(page.url()).hash.split('/')[2]);
    await page.getByRole('button',{name:'Все обследования',exact:true}).click();
    await page.locator('.audit-list-card').first().waitFor();
  }
  await page.getByRole('button',{name:'Настройки списка'}).click();
  await page.waitForTimeout(220);
  const trigger=await page.locator('.list-more-button').boundingBox(),panel=await page.locator('.list-more-panel').boundingBox();
  assert.ok(Math.abs(panel.y-(trigger.y+trigger.height+8))<2 && Math.abs(panel.x+panel.width-trigger.x-trigger.width)<2);
  await page.screenshot({path:out+'header-menu.png'});
  await page.getByRole('heading',{name:'Обследования',exact:true}).click();assert.equal(await page.locator('.list-more-panel').getAttribute('aria-hidden'),'true');
  await page.locator('.audit-card-menu > summary').first().click();await page.locator('.audit-card-menu > summary').nth(1).click();
  assert.equal(await page.locator('.audit-card-menu[open]').count(),1);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.audit-card-menu[open]').count(),0);
  await page.locator('.audit-card-menu > summary').first().click();await page.getByRole('button',{name:'Резервная копия',exact:true}).click();
  await page.getByRole('dialog').waitFor();await page.waitForTimeout(250);assert.equal(await page.getByRole('dialog').count(),1);
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.locator('.audit-card-link').first().click();await page.locator('.audit-editor[data-page-ready=true]').waitFor();
  await page.locator('.element-navigation-row').first().click();await page.locator('.element-detail-page').waitFor();
  const before=await page.locator('.audit-header').boundingBox();
  await page.getByRole('switch',{name:'Применимость',exact:true}).click();
  const dirty=await page.locator('.audit-header').boundingBox();
  assert.equal(dirty.height,before.height);assert.equal(dirty.y,before.y);
  await page.locator('.measurement-number-card input').first().fill('85');await page.locator('.measurement-number-card input').first().blur();
  await page.waitForFunction(()=>document.querySelector('[data-save-state=saved]'));
  const saved=await page.locator('.audit-header').boundingBox();assert.equal(saved.height,before.height);
  await page.getByRole('button',{name:'Вернуться к элементам',exact:true}).click();
  await page.getByRole('button',{name:'Все обследования',exact:true}).click();await page.locator('.audit-list-card').first().waitFor();
  await page.locator('.audit-card-link').first().click();await page.locator('.audit-editor[data-page-ready=true]').waitFor();
  const editorTitle=await page.locator('.audit-header-title h1').evaluate(e=>({font:getComputedStyle(e).fontSize,center:e.getBoundingClientRect().x+e.getBoundingClientRect().width/2}));
  await page.locator('.bottom-action-bar button').click();await page.locator('.audit-review[data-page-ready=true]').waitFor();
  assert.equal(await page.locator('.review-topbar button').count(),1);
  assert.equal(await page.locator('.review-topbar .workspace-kicker').count(),0);
  assert.equal(await page.locator('.review-topbar .audit-header-title h1').evaluate(e=>getComputedStyle(e).fontSize),editorTitle.font);
  assert.equal(await page.locator('.review-topbar .audit-header-button').evaluate(e=>e.getBoundingClientRect().width),44);
  await page.waitForTimeout(300);
  await page.screenshot({path:out+'review-header.png'});
  await page.getByRole('button',{name:'Вернуться к карточкам',exact:true}).click();
  await page.getByRole('button',{name:'Все обследования',exact:true}).click();await page.locator('.audit-list-card').first().waitFor();
  for(const width of [320,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.audit-card-link').first().click();await page.locator('.audit-editor[data-page-ready=true]').waitFor();
  assert.equal(await page.locator('.route-stage').evaluate(e=>e.getAnimations().length),0);
  await page.getByRole('button',{name:'Все обследования',exact:true}).click();
  // Exercise the fallback on the same isolated test database, without changing user records.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{document.startViewTransition=undefined;});
  await page.locator('.audit-card-link').first().click();await page.locator('.audit-editor[data-page-ready=true]').waitFor();
  await page.waitForFunction(()=>!document.querySelector('.route-stage').hasAttribute('aria-busy'));
  const persisted=await page.evaluate(async ids=>{
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('urban-accessibility-field-v1',3);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{return await new Promise(resolve=>{const request=db.transaction('audits').objectStore('audits').getAll();request.onsuccess=()=>resolve(request.result.filter(a=>ids.includes(a.id)).some(a=>Object.values(a.measurements).some(m=>m.normalized?.value===85)));});}finally{db.close();}
  },ids);
  assert.ok(persisted);assert.deepEqual(errors,[]);
  console.log('PASS: menu anchoring, outside/Escape close, one menu, portal survives closing, invariant header across dirty/saving/saved, native/fallback/reduced-motion navigation, saved measurement and 320/430px.');
}catch(error){console.error('Browser errors:',errors); console.error(await browser.contexts()[0]?.pages()[0]?.locator('body').innerText().catch(()=>''));throw error;}finally{await browser.close();}
