const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',testMatch:'browser-smoke.spec.cjs',timeout:20000,retries:0,reporter:'list',projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'firefox',use:{browserName:'firefox'}},{name:'webkit',use:{browserName:'webkit'}}]});
