import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.env.LANDING_URL||'http://127.0.0.1:5176/';
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:700}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>document.documentElement.classList.contains('lenis'));
 await page.mouse.move(100,200);await page.mouse.wheel(0,450);
 const samples=await page.evaluate(()=>new Promise(resolve=>{const values=[];function tick(){values.push(scrollY);if(values.length===16)resolve(values);else requestAnimationFrame(tick);}requestAnimationFrame(tick);}));
 assert.ok(samples.at(-1)>samples[0]+50);assert.ok(new Set(samples.map(Math.round)).size>5);assert.ok(samples.every((y,i)=>i===0||y>=samples[i-1]));
 await page.keyboard.press('Home');await page.waitForFunction(()=>scrollY===0);await page.waitForTimeout(400);
 await page.keyboard.press('PageDown');await page.waitForFunction(()=>scrollY>100);
 await page.getByRole('tab').nth(2).click();assert.equal(await page.getByRole('tab').nth(2).getAttribute('aria-selected'),'true');
 await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>!document.documentElement.classList.contains('lenis'));
 await page.mouse.wheel(0,-800);await page.waitForFunction(()=>scrollY===0);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.documentElement.classList.contains('lenis'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const mobile=await browser.newContext({viewport:{width:390,height:700},isMobile:true,hasTouch:true});const touch=await mobile.newPage();touch.on('pageerror',e=>errors.push(e.message));await touch.goto(base);await touch.waitForFunction(()=>document.documentElement.classList.contains('lenis'));
 const session=await mobile.newCDPSession(touch);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:540}]});
 for(const y of [510,470,420,370,320]){await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y}]});await touch.waitForTimeout(16);}
 const before=await touch.evaluate(()=>scrollY);await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.waitForTimeout(180);const after=await touch.evaluate(()=>scrollY);
 assert.ok(before>40);assert.ok(after>before+5,`Touch inertia: ${before} -> ${after}`);
 assert.equal(await touch.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // Repeated creation/destruction leaves one wheel interpolator and native scrolling intact.
 await page.route('**/scroll-fixture.html',route=>route.fulfill({contentType:'text/html',body:'<div style="height:3000px"></div>'}));await page.goto(new URL('scroll-fixture.html',base).href);
 await page.evaluate(async()=>{const {installLandingScroll}=await import('/src/landing-scroll.ts');for(let i=0;i<3;i++){const destroy=installLandingScroll();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));destroy();await new Promise(r=>requestAnimationFrame(r));} });
 assert.equal(await page.locator('html').getAttribute('data-scroll-orientation'),null);
 assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('lenis')),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: interpolated wheel trajectory, keyboard navigation, map controls, reduced-motion teardown/restart, touch swipe inertia, no overflow, cleanup without ghost instances.',{wheel:samples.map(Math.round),touch:[before,after]});
}finally{await browser.close();}
