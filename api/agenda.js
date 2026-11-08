import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const previewId = createHash('sha256').update(process.env.VERCEL_GIT_COMMIT_REF || 'default').digest('hex').slice(0, 16);
const STORE_PATH = process.env.VERCEL_ENV === 'preview' ? 'agenda/preview-' + previewId + '.json' : 'agenda/state-v1.json';
const TIMES = ['14:00', '16:00', '18:00'];
const SERVICES = ['Alongamento Molde F1', 'Esmaltação em Gel'];
const ACTIVE = ['confirmed', 'in_progress', 'completed'];
const COOKIE = '__Host-lunar-session';
const SESSION_SECONDS = 60 * 60 * 12;

class AgendaError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function emptyState() {
  return { version: 1, auth: null, appointments: [], blocks: [] };
}

async function readStore() {
  const result = await get(STORE_PATH, { access: 'private', useCache: false });
  if (!result) return { data: emptyState(), etag: null };
  const data = await new Response(result.stream).json();
  if (data.version !== 1 || !Array.isArray(data.appointments) || !Array.isArray(data.blocks)) {
    throw new Error('Unsupported agenda state');
  }
  return { data, etag: result.blob.etag };
}

async function writeStore(data, etag) {
  try {
    await put(STORE_PATH, JSON.stringify(data), {
      access: 'private', addRandomSuffix: false, contentType: 'application/json',
      allowOverwrite: Boolean(etag), ...(etag ? { ifMatch: etag } : {}),
    });
  } catch (error) {
    // An overlapping first write can create the document before this request.
    if (!etag && (await readStore()).etag) error.code = 'CONFLICT';
    throw error;
  }
}

async function mutate(storage, operation) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const snapshot = await storage.read();
    const result = operation(snapshot.data);
    try {
      await storage.write(snapshot.data, snapshot.etag);
      return result;
    } catch (error) {
      if (!(error instanceof BlobPreconditionFailedError) && error.code !== 'CONFLICT') throw error;
    }
  }
  throw new AgendaError(409, 'A agenda mudou agora. Atualize e tente novamente.');
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AgendaError(400, 'Escolha uma data válida.');
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new AgendaError(400, 'Escolha uma data válida.');
  return value;
}

function validTime(value) {
  if (!TIMES.includes(value)) throw new AgendaError(400, 'Escolha um dos horários da agenda.');
  return value;
}

function text(value, max, label, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) throw new AgendaError(400, 'Confira ' + label + '.');
  return result;
}

function phone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  if (!/^55\d{10,11}$/.test(digits)) throw new AgendaError(400, 'Informe o WhatsApp com DDD.');
  return digits;
}

function bookingInput(body, isAdmin) {
  const date = validDate(body.date);
  const time = validTime(body.time);
  if (!isAdmin && (date < today() || new Date(date + 'T' + time + ':00-03:00') <= new Date())) throw new AgendaError(400, 'Esse horário já passou. Escolha outro.');
  if (!SERVICES.includes(body.service)) throw new AgendaError(400, 'Escolha um serviço válido.');
  return { date, time, service: body.service, name: text(body.name, 100, 'o nome'), phone: phone(body.phone), notes: isAdmin ? text(body.notes, 800, 'as observações', false) : '' };
}

function ensureAvailable(data, date, time, excludeId) {
  if (data.blocks.some(block => block.date === date && (!block.time || block.time === time))) throw new AgendaError(409, 'Esse horário está bloqueado. Escolha outro.');
  if (data.appointments.some(item => item.id !== excludeId && item.date === date && item.time === time && ACTIVE.includes(item.status))) throw new AgendaError(409, 'Esse horário acabou de ser reservado. Escolha outro.');
}

function publicCalendar(data, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new AgendaError(400, 'Mês inválido.');
  const blockedDays = data.blocks.filter(item => item.date.startsWith(month + '-') && !item.time).map(item => item.date);
  const busy = data.appointments.filter(item => item.date.startsWith(month + '-') && ACTIVE.includes(item.status)).map(item => ({ date: item.date, time: item.time }));
  const blockedSlots = data.blocks.filter(item => item.date.startsWith(month + '-') && item.time).map(item => ({ date: item.date, time: item.time }));
  return { times: TIMES, blockedDays, busy: busy.concat(blockedSlots), today: today() };
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

function equal(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyPassword(password, encoded) {
  const [salt, hash] = encoded.split(':');
  return equal(scryptSync(password, salt, 64).toString('hex'), hash);
}

function sign(value) {
  return createHmac('sha256', process.env.LUNAR_SESSION_SECRET).update(value).digest('base64url');
}

function sessionFor(req, data) {
  if (!data.auth) return null;
  const cookie = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(COOKIE + '='));
  if (!cookie) return null;
  try {
    const [encoded, signature] = cookie.slice(COOKIE.length + 1).split('.');
    if (!equal(signature, sign(encoded))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString());
    if (payload.expires < Date.now() || payload.version !== data.auth.version || typeof payload.csrf !== 'string') return null;
    return payload;
  } catch { return null; }
}

function setSession(res, auth) {
  const payload = { version: auth.version, expires: Date.now() + SESSION_SECONDS * 1000, csrf: randomBytes(24).toString('base64url') };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  res.setHeader('Set-Cookie', COOKIE + '=' + encoded + '.' + sign(encoded) + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + SESSION_SECONDS);
  return payload;
}

function requireSession(req, data, mutation = false) {
  const session = sessionFor(req, data);
  if (!session) throw new AgendaError(401, 'Entre na sua agenda para continuar.');
  if (mutation && !equal(req.headers['x-lunar-csrf'], session.csrf)) throw new AgendaError(403, 'Atualize a página e tente novamente.');
  return session;
}

function requireOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = req.headers.origin;
  if (!origin || !host || origin !== 'https://' + host) throw new AgendaError(403, 'Abra o formulário pelo site da Lunar.');
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

const attempts = new Map();
function limitLogin(req) {
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown').split(',')[0];
  const previous = attempts.get(ip);
  const entry = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 15 * 60 * 1000 };
  entry.count += 1;
  if (attempts.size > 2000) attempts.clear();
  attempts.set(ip, entry);
  if (entry.count > 10) throw new AgendaError(429, 'Muitas tentativas. Aguarde 15 minutos antes de tentar de novo.');
}

export function createHandler(storage = { read: readStore, write: writeStore }) {
  return async function handler(req, res) {
    try {
      if (!process.env.LUNAR_SESSION_SECRET || !process.env.LUNAR_SETUP_TOKEN_HASH) throw new AgendaError(503, 'A agenda está sendo configurada. Tente novamente em instantes.');
      const url = new URL(req.url, 'https://' + req.headers.host);
      const action = url.searchParams.get('action') || 'calendar';
      if (req.method === 'GET') {
        const { data } = await storage.read();
        if (action === 'session') {
          const session = sessionFor(req, data);
          return send(res, 200, { authenticated: Boolean(session), needsSetup: !data.auth, csrf: session?.csrf });
        }
        if (action === 'admin') {
          requireSession(req, data);
          const month = url.searchParams.get('month');
          publicCalendar(data, month);
          return send(res, 200, { appointments: data.appointments.filter(item => item.date.startsWith(month + '-')), blocks: data.blocks.filter(item => item.date.startsWith(month + '-')), times: TIMES, today: today() });
        }
        if (action !== 'calendar') throw new AgendaError(404, 'Página não encontrada.');
        return send(res, 200, publicCalendar(data, url.searchParams.get('month')));
      }
      if (req.method !== 'POST') throw new AgendaError(405, 'Método não permitido.');
      requireOrigin(req);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new AgendaError(415, 'Envie um formulário válido.');
      let body;
      try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
      catch { throw new AgendaError(400, 'Formulário inválido.'); }
      if (!body || typeof body !== 'object' || JSON.stringify(body).length > 12000) throw new AgendaError(400, 'Formulário inválido.');
      if (action === 'setup') {
        limitLogin(req);
        const tokenHash = createHash('sha256').update(String(body.token || '')).digest('hex');
        if (!equal(tokenHash, process.env.LUNAR_SETUP_TOKEN_HASH)) throw new AgendaError(403, 'Use o link de ativação enviado para você.');
        const password = text(body.password, 128, 'a senha');
        if (password.length < 10) throw new AgendaError(400, 'Use uma senha com pelo menos 10 caracteres.');
        const auth = { passwordHash: hashPassword(password), version: randomUUID() };
        await mutate(storage, data => {
          if (data.auth) throw new AgendaError(409, 'A agenda já foi ativada. Entre com sua senha.');
          data.auth = auth;
        });
        const session = setSession(res, auth);
        return send(res, 200, { authenticated: true, csrf: session.csrf });
      }
      if (action === 'login') {
        limitLogin(req);
        const { data } = await storage.read();
        const password = text(body.password, 128, 'a senha');
        if (!data.auth || !verifyPassword(password, data.auth.passwordHash)) throw new AgendaError(401, 'Senha incorreta.');
        const session = setSession(res, data.auth);
        return send(res, 200, { authenticated: true, csrf: session.csrf });
      }
      if (action === 'book') {
        const input = bookingInput(body, false);
        const requestId = text(body.requestId, 80, 'o pedido');
        if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw new AgendaError(400, 'Atualize o formulário e tente novamente.');
        const record = { ...input, id: randomUUID(), requestId, revision: randomUUID(), status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const booked = await mutate(storage, data => {
          const previous = data.appointments.find(item => item.requestId === requestId);
          if (previous) {
            if (previous.phone !== input.phone || previous.date !== input.date || previous.time !== input.time || previous.service !== input.service || previous.status === 'cancelled') throw new AgendaError(409, 'Esse pedido mudou. Escolha novamente o horário.');
            return previous;
          }
          ensureAvailable(data, input.date, input.time);
          data.appointments.push(record);
          return record;
        });
        return send(res, 200, { id: booked.id, status: booked.status });
      }
      const { data: initial } = await storage.read();
      const session = requireSession(req, initial, true);
      if (action === 'logout') {
        res.setHeader('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
        return send(res, 200, { ok: true });
      }
      if (action === 'password') {
        const password = text(body.password, 128, 'a senha');
        if (password.length < 10) throw new AgendaError(400, 'Use uma senha com pelo menos 10 caracteres.');
        const auth = { passwordHash: hashPassword(password), version: randomUUID() };
        await mutate(storage, data => { if (data.auth.version !== session.version) throw new AgendaError(401, 'Entre novamente.'); data.auth = auth; });
        return send(res, 200, { csrf: setSession(res, auth).csrf });
      }
      if (action === 'save') {
        const input = bookingInput(body, true);
        const status = body.status || 'confirmed';
        if (![...ACTIVE, 'pending', 'cancelled'].includes(status)) throw new AgendaError(400, 'Status inválido.');
        const id = body.id || randomUUID();
        await mutate(storage, data => {
          if (data.auth.version !== session.version) throw new AgendaError(401, 'Entre novamente.');
          const previous = data.appointments.find(item => item.id === id);
          if (body.id && !previous) throw new AgendaError(404, 'Atendimento não encontrado.');
          if (previous && (previous.revision ? body.revision !== previous.revision : body.updatedAt !== previous.updatedAt)) throw new AgendaError(409, 'Esse atendimento foi alterado. Atualize antes de salvar.');
          const alreadyOccupiesSlot = previous && ACTIVE.includes(previous.status) && previous.date === input.date && previous.time === input.time;
          if (ACTIVE.includes(status) && !alreadyOccupiesSlot) ensureAvailable(data, input.date, input.time, id);
          const record = { ...previous, ...input, id, status, revision: randomUUID(), createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
          if (previous) Object.assign(previous, record); else data.appointments.push(record);
        });
        return send(res, 200, { id });
      }
      if (action === 'block') {
        const date = validDate(body.date);
        const time = body.time ? validTime(body.time) : null;
        if (typeof body.blocked !== 'boolean') throw new AgendaError(400, 'Bloqueio inválido.');
        await mutate(storage, data => {
          if (data.auth.version !== session.version) throw new AgendaError(401, 'Entre novamente.');
          const sameBlock = item => item.date === date && item.time === time;
          data.blocks = data.blocks.filter(item => !sameBlock(item));
          if (body.blocked) data.blocks.push({ date, time });
        });
        return send(res, 200, { ok: true });
      }
      throw new AgendaError(404, 'Ação não encontrada.');
    } catch (error) {
      if (!(error instanceof AgendaError)) console.error('Agenda request failed', error.name);
      return send(res, error.status || 503, { error: error instanceof AgendaError ? error.message : 'Não foi possível atualizar a agenda. Tente novamente.' });
    }
  };
}

export default createHandler();
