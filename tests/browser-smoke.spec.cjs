const {test,expect}=require('@playwright/test');

test('FlowPay renders its basic interface in each browser engine',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  expect(await page.title()).toMatch(/FlowPay/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content',/width=device-width/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href','manifest.webmanifest');
  const response=await page.request.get('http://127.0.0.1:8765/manifest.webmanifest');
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).display).toBe('standalone');
  expect(errors.filter(message=>/SyntaxError|ReferenceError/.test(message))).toEqual([]);
});

test('bank connections stays hidden on initial load and narrow screens',async({page})=>{
  await page.setViewportSize({width:360,height:740});
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  const panel=page.locator('#flowpay-plaid-panel');
  await expect(panel).toHaveCount(1);
  await expect(panel).toBeHidden();
});

test('header controls reflow without overlap at narrow and wide window sizes',async({page})=>{
  for(const width of [320,390,600,850,1200]){
    await page.setViewportSize({width,height:800});
    await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
    const dock=page.locator('#fp-dock');
    await expect(dock).toBeVisible();
    const dockBox=await dock.boundingBox();
    expect(dockBox.x).toBeGreaterThanOrEqual(-1);
    expect(dockBox.x+dockBox.width).toBeLessThanOrEqual(width+1);
    const controls=page.locator('#fp-toolbar');
    await expect(controls).toBeVisible();
    const toolbarBox=await controls.boundingBox();
    expect(toolbarBox.x).toBeGreaterThanOrEqual(-1);
    expect(toolbarBox.x+toolbarBox.width).toBeLessThanOrEqual(width+1);
    const header=page.locator('header:has(#header-page-title)');
    const headerBox=await header.boundingBox();
    expect(headerBox.height).toBeGreaterThanOrEqual(90);
    for(const button of await controls.locator('button:visible').all()){
      const b=await button.boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.x+b.width).toBeLessThanOrEqual(width+1);
    }
  }
});
