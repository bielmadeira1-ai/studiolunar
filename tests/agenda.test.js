import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createHandler } from '../api/agenda.js';

process.env.LUNAR_SESSION_SECRET = 'test-session-secret-for-local-verification-only';
process.env.LUNAR_SETUP_TOKEN_HASH = createHash('sha256').update('activation-test').digest('hex');

function fixture() {
  let state = { version: 1, auth: null, appointments: [], blocks: [] };
  let version = 0;
  const handler = createHandler({
    async read() { return { data: structuredClone(state), etag: String(version) }; },
    async write(data, etag) {
      if (etag !== String(version)) { const error = new Error('Conflict'); error.code = 'CONFLICT'; throw error; }
      state = structuredClone(data); version += 1;
    },
  });
  let cookie = '';
  let csrf = '';
  async function call(action, body, { authenticated = false, origin = 'https://lunar.test', requestCookie = cookie } = {}) {
    const headers = { host: 'lunar.test', origin, 'content-type': 'application/json', 'x-real-ip': randomUUID() };
    if (authenticated) { headers.cookie = requestCookie; headers['x-lunar-csrf'] = csrf; }
    const req = { method: body ? 'POST' : 'GET', url: '/api/agenda?action=' + action + '&month=2099-11', headers, body };
    const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = JSON.parse(value); } };
    await handler(req, res);
    if (res.headers['Set-Cookie'] && res.body.csrf) { cookie = res.headers['Set-Cookie'].split(';')[0]; csrf = res.body.csrf; }
    return res;
  }
  async function setup() { const response = await call('setup', { token: 'activation-test', password: 'local-password-strong' }); assert.equal(response.statusCode, 200); }
  return { call, setup, state: () => structuredClone(state), cookie: () => cookie };
}

const booking = (extras = {}) => ({ date: '2099-11-11', time: '14:00', service: 'Alongamento Molde F1', name: 'Cliente de teste', phone: '(53) 99999-1234', requestId: randomUUID(), ...extras });

test('private data requires login and setup requires the activation token', async () => {
  const app = fixture();
  assert.equal((await app.call('admin')).statusCode, 401);
  assert.equal((await app.call('setup', { token: 'wrong-token', password: 'local-password-strong' })).statusCode, 403);
  await app.setup();
  assert.equal((await app.call('admin', null, { authenticated: true })).statusCode, 200);
  assert.equal((await app.call('setup', { token: 'activation-test', password: 'other-password-strong' })).statusCode, 409);
});

test('public booking is saved once and does not expose client data', async () => {
  const app = fixture();
  const body = booking();
  const first = await app.call('book', body);
  const retried = await app.call('book', body);
  assert.equal(first.statusCode, 200);
  assert.equal(retried.body.id, first.body.id);
  assert.equal(app.state().appointments.length, 1);
  const calendar = await app.call('calendar');
  assert.deepEqual(calendar.body.busy, []);
  assert.ok(!JSON.stringify(calendar.body).includes(body.name));
  assert.ok(!JSON.stringify(calendar.body).includes('999991234'));
});

test('pending requests stay available and only one concurrent confirmation succeeds', async () => {
  const app = fixture(); await app.setup();
  const requests = await Promise.all([app.call('book', booking()), app.call('book', booking())]);
  assert.deepEqual(requests.map(response => response.statusCode), [200, 200]);
  assert.deepEqual((await app.call('calendar')).body.busy, []);
  const responses = await Promise.all(app.state().appointments.map(record => app.call('save', { ...record, status: 'confirmed' }, { authenticated: true })));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
  assert.equal((await app.call('calendar')).body.busy.length, 1);
});

test('day and slot blocks are enforced and can be reopened', async () => {
  const app = fixture(); await app.setup();
  assert.equal((await app.call('block', { date: '2099-11-11', time: null, blocked: true }, { authenticated: true })).statusCode, 200);
  assert.equal((await app.call('book', booking())).statusCode, 409);
  await app.call('block', { date: '2099-11-11', time: null, blocked: false }, { authenticated: true });
  await app.call('block', { date: '2099-11-11', time: '14:00', blocked: true }, { authenticated: true });
  assert.equal((await app.call('book', booking())).statusCode, 409);
  assert.equal((await app.call('book', booking({ time: '16:00' }))).statusCode, 200);
});

test('client details can be edited on a day closed to new bookings', async () => {
  const app = fixture(); await app.setup();
  await app.call('book', booking());
  const pending = app.state().appointments[0];
  await app.call('save', { ...pending, status: 'confirmed' }, { authenticated: true });
  await app.call('block', { date: '2099-11-11', time: null, blocked: true }, { authenticated: true });
  const record = app.state().appointments[0];
  const update = await app.call('save', { ...record, status: 'confirmed', notes: 'Francesinha azul' }, { authenticated: true });
  assert.equal(update.statusCode, 200);
  assert.equal(app.state().appointments[0].status, 'confirmed');
  assert.equal((await app.call('save', { ...record, status: 'cancelled' }, { authenticated: true })).statusCode, 409);
});

test('cancelling an appointment releases its slot and preserves the record', async () => {
  const app = fixture(); await app.setup();
  await app.call('book', booking());
  const record = app.state().appointments[0];
  assert.equal((await app.call('save', { ...record, status: 'cancelled' }, { authenticated: true })).statusCode, 200);
  assert.equal((await app.call('book', booking())).statusCode, 200);
  assert.equal(app.state().appointments.length, 2);
});

test('invalid dates, phone numbers, times, cross-origin and unsigned writes fail', async () => {
  const app = fixture();
  assert.equal((await app.call('book', booking({ date: '2099-02-31' }))).statusCode, 400);
  assert.equal((await app.call('book', booking({ date: '2020-01-01' }))).statusCode, 400);
  assert.equal((await app.call('book', booking({ phone: '123' }))).statusCode, 400);
  assert.equal((await app.call('book', booking({ time: '15:00' }))).statusCode, 400);
  assert.equal((await app.call('book', booking(), { origin: 'https://other.test' })).statusCode, 403);
  assert.equal((await app.call('block', { date: '2099-11-11', blocked: true })).statusCode, 401);
});

test('password change invalidates old sessions', async () => {
  const app = fixture(); await app.setup();
  const previous = app.cookie();
  const changed = await app.call('password', { password: 'changed-password-strong' }, { authenticated: true });
  assert.equal(changed.statusCode, 200);
  assert.equal((await app.call('admin', null, { authenticated: true, requestCookie: previous })).statusCode, 401);
  assert.equal((await app.call('login', { password: 'local-password-strong' })).statusCode, 401);
  assert.equal((await app.call('login', { password: 'changed-password-strong' })).statusCode, 200);
});

 test('in-progress blocks the slot and cancellation releases it', async () => {
  const app = fixture(); await app.setup();
  await app.call('book', booking());
  let record = app.state().appointments[0];
  assert.equal((await app.call('save', { ...record, status: 'in_progress' }, { authenticated: true })).statusCode, 200);
  assert.equal((await app.call('calendar')).body.busy.length, 1);
  record = app.state().appointments[0];
  await app.call('save', { ...record, status: 'cancelled' }, { authenticated: true });
  assert.deepEqual((await app.call('calendar')).body.busy, []);
});
