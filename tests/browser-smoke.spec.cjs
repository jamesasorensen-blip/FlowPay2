const {test,expect}=require('@playwright/test');

test('FlowPay renders its basic interface in each browser engine',async({page})=>{
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8765/',{waitUntil:'domcontentloaded'});
  await expect(page.locator('title')).toHaveText(/FlowPay/);
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
