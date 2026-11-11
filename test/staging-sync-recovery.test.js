import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bankSection = html.slice(html.indexOf('<!-- FlowPay Plaid Sandbox Bank Connection -->'),
  html.indexOf('<!-- End FlowPay Plaid Sandbox -->'));
const script = bankSection.match(/<script>([\s\S]*?)<\/script>/)[1];
const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const account = {id:'test-account', connection_id:connectionId, institution_name:'Test Bank',
  name:'Checking', mask:'0000', current_balance:100, available_balance:80};

// Only the DOM operations used by the banking module are modeled. Tests execute
// its complete inline script and real event handlers with synthetic API replies.
class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.disabled = false;
    this.value = '';
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(' '); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; this.text = ''; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
  querySelectorAll(tag) {
    return this.children.flatMap(child => [
      ...(child.tagName === tag ? [child] : []), ...child.querySelectorAll(tag)
    ]);
  }
  async dispatch(name, event = {}) {
    if (this.disabled) return;
    for (const listener of this.listeners[name] || []) await listener(event);
  }
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
function fixture() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const calls = [];
  const window = new Element();
  window.flowpayActiveUserId = 'user-A';
  let getToken = async () => 'synthetic-token';
  window.flowpayGetAccessToken = () => getToken();
  let job = {pending:false, running:false, attempts:0, next_retry_at:null, last_synced_at:null};
  let consent = true;
  let responder = null;
  const fetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({url, options});
    if (responder) {
      const response = await responder(parsed, options);
      if (response) return response;
    }
    if (parsed.pathname === '/consent') return Response.json({consents:consent ? [{consent_type:'bank_connection'}] : []});
    if (parsed.pathname === '/bank-accounts') return Response.json({accounts:[account]});
    if (parsed.pathname === '/bank-transactions') return Response.json({transactions:[]});
    if (parsed.pathname === '/diagnostics/sync-status') return Response.json(job);
    if (parsed.pathname === '/sync-transactions') {
      job = {...job,pending:false,running:false,attempts:0,next_retry_at:null,last_synced_at:'2026-11-11 19:00:00'};
      return Response.json({success:true,added:1,modified:0,removed:0});
    }
    throw Error('Unexpected synthetic API route ' + parsed.pathname);
  };
  runInNewContext(script, {
    window, fetch, URL, URLSearchParams,
    document:{getElementById:get, createElement:tag => new Element(tag)},
    location:{search:'',href:'https://flowpay-6aay.onrender.com/'}, console
  });
  const buttons = () => get('flowpay-bank-accounts').querySelectorAll('button');
  return {
    get, calls, window, buttons,
    setJob(value) {job = value;},
    setConsent(value) {consent = value;},
    setResponder(value) {responder = value;},
    setTokenGetter(value) {getToken = value;},
    async staging() {
      await settle();
      get('flowpay-bank-environment').value = 'staging';
      await get('flowpay-bank-environment').dispatch('change');
    },
    button(name) {
      const button = buttons().find(item => item.textContent === name);
      assert.ok(button, 'Missing button ' + name);
      return button;
    },
    async auth(userId) {
      window.flowpayActiveUserId = userId;
      await window.dispatch('flowpay-auth-user-changed',{detail:{userId}});
      await settle();
    }
  };
}

test('staging shows named connections and failed attempts with retry timing', async () => {
  const f = fixture();
  f.setJob({pending:true,running:false,attempts:2,next_retry_at:1794427200,last_synced_at:'2026-11-11 19:00:00'});
  await f.staging();
  const content = f.get('flowpay-bank-accounts').textContent;
  assert.match(content, /Test Bank/);
  assert.match(content, /Connection aaaaaaaa/);
  assert.match(content, /Current \$100\.00/);
  assert.match(content, /Available \$80\.00/);
  assert.match(content, /Sync delayed after 2 failed attempts/);
  assert.match(content, /Automatic retry scheduled for/);
  assert.match(content, /Last synced/);
  assert.equal(f.button('Retry sync now').disabled, false);
  const diagnostic = f.calls.find(call => call.url.includes('/diagnostics/sync-status'));
  assert.equal(new URL(diagnostic.url).origin, 'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev');
  assert.equal(new URL(diagnostic.url).searchParams.get('connection_id'), connectionId);
});

test('retry invokes the owned staging connection and refreshes status without loading financial matches', async () => {
  const f = fixture();
  f.setJob({pending:true,running:false,attempts:1,next_retry_at:1794427200,last_synced_at:null});
  await f.staging();
  const before = f.calls.length;
  await f.button('Retry sync now').dispatch('click');
  const requests = f.calls.slice(before);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0].url).origin, 'https://flowpay-plaid-api-staging.james-a-sorensen.workers.dev');
  assert.equal(new URL(requests[0].url).pathname, '/sync-transactions');
  assert.equal(requests[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].options.body), {connection_id:connectionId});
  assert.equal(new URL(requests[1].url).pathname, '/diagnostics/sync-status');
  assert.match(f.get('flowpay-plaid-status').textContent, /Staging sync completed with 1 added/);
  assert.match(f.get('flowpay-bank-accounts').textContent, /Last synced/);
  assert.equal(f.button('Sync now').disabled, false);
});

test('running jobs and withdrawn consent disable the retry action', async () => {
  const f = fixture();
  f.setJob({pending:true,running:true,attempts:0});
  await f.staging();
  assert.match(f.get('flowpay-bank-accounts').textContent, /Sync in progress/);
  assert.equal(f.button('Sync now').disabled, true);
  f.setConsent(false);
  f.setJob({pending:true,running:false,attempts:1});
  await f.get('flowpay-refresh-banks').dispatch('click');
  // Refreshing the environment reads consent again, matching normal entry.
  await f.get('flowpay-bank-environment').dispatch('change');
  assert.equal(f.button('Retry sync now').disabled, true);
});

test('status lookup failure does not hide accounts or prevent later refresh', async () => {
  const f = fixture();
  f.setResponder(url => url.pathname === '/diagnostics/sync-status' ? Response.json({error:'Request failed'},{status:503}) : null);
  await f.staging();
  assert.match(f.get('flowpay-bank-accounts').textContent, /Checking/);
  assert.match(f.get('flowpay-bank-accounts').textContent, /Sync status unavailable/);
  f.setResponder(null);
  await f.button('Refresh sync status').dispatch('click');
  assert.match(f.get('flowpay-bank-accounts').textContent, /No transaction sync has completed yet/);
});

test('a failed manual retry reports failure and reloads durable retry state', async () => {
  const f = fixture();
  await f.staging();
  f.setResponder(url => {
    if (url.pathname !== '/sync-transactions') return null;
    f.setJob({pending:true,running:false,attempts:1,next_retry_at:1794427200});
    return Response.json({error:'Transaction sync temporarily unavailable'},{status:503});
  });
  await f.button('Sync now').dispatch('click');
  assert.match(f.get('flowpay-plaid-status').textContent, /Staging sync failed/);
  assert.match(f.get('flowpay-bank-accounts').textContent, /Sync delayed after 1 failed attempt/);
  assert.equal(f.button('Retry sync now').disabled, false);
});

test('a delayed status response cannot populate another signed-in user or environment', async () => {
  const f = fixture();
  await f.staging();
  const waiting = deferred();
  f.setResponder(url => url.pathname === '/diagnostics/sync-status' ? waiting.promise : null);
  const oldRefresh = f.button('Refresh sync status').dispatch('click');
  await settle();
  await f.auth('user-B');
  const status = f.get('flowpay-plaid-status').textContent;
  waiting.resolve(Response.json({pending:true,running:false,attempts:99}));
  await oldRefresh;
  assert.equal(f.get('flowpay-bank-environment').value, 'current');
  assert.doesNotMatch(f.get('flowpay-bank-accounts').textContent, /99 failed attempts|Refresh sync status/);
  assert.equal(f.get('flowpay-plaid-status').textContent, status);
});

test('account changes while obtaining a token stop the old staging retry before network dispatch', async () => {
  const f = fixture();
  await f.staging();
  const waiting = deferred();
  f.setTokenGetter(() => waiting.promise);
  const oldRetry = f.button('Sync now').dispatch('click');
  f.setTokenGetter(async () => 'synthetic-new-user-token');
  await f.auth('user-B');
  const before = f.calls.length;
  waiting.resolve('synthetic-old-user-token');
  await oldRetry;
  assert.equal(f.calls.length, before);
  assert.ok(f.calls.every(call => new URL(call.url).pathname !== '/sync-transactions'));
});

test('existing Sandbox connections retain their existing manual sync action', async () => {
  const f = fixture();
  await settle();
  assert.equal(f.button('Sync transactions').disabled, false);
  assert.ok(f.calls.every(call => !call.url.includes('/diagnostics/sync-status')));
  await f.button('Sync transactions').dispatch('click');
  const request = f.calls.find(call => new URL(call.url).pathname === '/sync-transactions');
  assert.equal(new URL(request.url).origin, 'https://flowpay-plaid-api.james-a-sorensen.workers.dev');
});


test('an environment change discards a delayed staging status response', async () => {
  const f = fixture();
  await settle();
  const waiting = deferred();
  f.setResponder(url => url.pathname === '/diagnostics/sync-status' ? waiting.promise : null);
  const oldLoad = f.staging();
  await settle();
  f.get('flowpay-bank-environment').value = 'current';
  await f.get('flowpay-bank-environment').dispatch('change');
  const status = f.get('flowpay-plaid-status').textContent;
  waiting.resolve(Response.json({pending:true,running:false,attempts:99}));
  await oldLoad;
  assert.doesNotMatch(f.get('flowpay-bank-accounts').textContent, /99 failed attempts|Refresh sync status/);
  assert.equal(f.get('flowpay-plaid-status').textContent, status);
});
