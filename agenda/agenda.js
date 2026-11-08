(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dateKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const monthKey = date => dateKey(date).slice(0, 7);
  const parseDate = value => new Date(value + 'T12:00:00');
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const monthFormat = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const statusLabels = { pending: 'A confirmar', confirmed: 'Confirmado', completed: 'Concluído', cancelled: 'Cancelado' };
  let selected = todayKey;
  let visible = parseDate(selected);
  let csrf = '';
  let needsSetup = false;
  let records = { appointments: [], blocks: [], times: ['14:00', '16:00', '18:00'] };
  let editing = null;
  let generation = 0;
  let loading = false;
  const activationToken = new URLSearchParams(location.hash.slice(1)).get('ativar') || '';
  if (activationToken) history.replaceState(null, '', location.pathname);

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  async function api(action, body, month) {
    const response = await fetch('/api/agenda?action=' + action + (month ? '&month=' + month : ''), {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json', 'X-Lunar-Csrf': csrf } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && !['login', 'setup'].includes(action)) showLogin();
      throw new Error(result.error || 'Não foi possível atualizar. Tente novamente.');
    }
    return result;
  }

  function notice(message, failure = false) {
    $('notice').textContent = message;
    $('notice').classList.toggle('failure', failure);
    $('notice').hidden = false;
  }

  function showLogin() {
    csrf = '';
    $('dashboard').hidden = true;
    $('logout').hidden = true;
    $('login-panel').hidden = false;
    $('password').value = '';
    $('login-title').textContent = 'Sua agenda, bem cuidada.';
    $('login-description').textContent = 'Entre para organizar seus atendimentos.';
    $('password-label').textContent = 'Sua senha';
    $('login-submit').textContent = 'Entrar na minha agenda ↗';
    $('password').autocomplete = 'current-password';
  }

  function showDashboard() {
    $('login-panel').hidden = true;
    $('dashboard').hidden = false;
    $('logout').hidden = false;
    loadMonth();
  }

  async function loadMonth() {
    const current = ++generation;
    loading = true;
    $('day-message').textContent = 'Atualizando sua agenda…';
    $('block-day').disabled = true;
    $('new-booking').disabled = true;
    $('day-slots').replaceChildren();
    $('cancelled-list').hidden = true;
    $('calendar-days').querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const result = await api('admin', null, monthKey(visible));
      if (current !== generation) return;
      records = result;
      loading = false;
      $('new-booking').disabled = false;
      renderCalendar();
      renderDay();
    } catch (error) {
      if (current !== generation) return;
      notice(error.message, true);
      $('day-message').textContent = 'Toque em Atualizar agenda para tentar novamente.';
    }
  }

  function isDayBlocked(date) { return records.blocks.some(block => block.date === date && !block.time); }
  function renderCalendar() {
    $('month-label').textContent = monthFormat.format(visible);
    const grid = $('calendar-days');
    grid.replaceChildren();
    const first = new Date(visible.getFullYear(), visible.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const count = new Date(visible.getFullYear(), visible.getMonth() + 1, 0).getDate();
    for (let i = 0; i < offset; i += 1) grid.append(node('span'));
    for (let day = 1; day <= count; day += 1) {
      const date = dateKey(new Date(visible.getFullYear(), visible.getMonth(), day));
      const appointments = records.appointments.filter(item => item.date === date && item.status !== 'cancelled');
      const blocked = isDayBlocked(date);
      const button = node('button', '', String(day));
      button.type = 'button';
      button.setAttribute('aria-pressed', String(date === selected));
      button.setAttribute('aria-label', parseDate(date).toLocaleDateString('pt-BR') + ', ' + appointments.length + ' atendimentos' + (blocked ? ', dia bloqueado' : ''));
      button.classList.toggle('today', date === todayKey);
      button.classList.toggle('blocked', blocked);
      if (appointments.length) button.append(node('i', 'day-dot'));
      button.addEventListener('click', () => { selected = date; renderCalendar(); renderDay(); });
      grid.append(button);
    }
    const active = records.appointments.filter(item => item.status !== 'cancelled');
    $('month-total').textContent = active.length + (active.length === 1 ? ' atendimento' : ' atendimentos');
    $('pending-total').textContent = active.filter(item => item.status === 'pending').length + ' a confirmar';
  }

  function renderDay() {
    const date = parseDate(selected);
    $('day-weekday').textContent = date.toLocaleDateString('pt-BR', { weekday: 'long' }).toUpperCase();
    $('day-title').textContent = date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
    const blocked = isDayBlocked(selected);
    $('block-day').textContent = blocked ? 'Liberar dia' : 'Bloquear dia';
    $('block-day').classList.toggle('blocked', blocked);
    $('block-day').disabled = loading;
    const bookings = records.appointments.filter(item => item.date === selected && item.status !== 'cancelled');
    $('day-message').textContent = blocked ? 'Dia fechado para novos agendamentos.' : bookings.length ? 'Toque no atendimento para ver ou editar os detalhes.' : 'Seu dia está livre. Toque em um horário para agendar.';
    const container = $('day-slots');
    container.replaceChildren();
    records.times.forEach(time => {
      const record = bookings.find(item => item.time === time);
      const slotBlocked = records.blocks.some(block => block.date === selected && block.time === time);
      const unavailable = blocked || slotBlocked;
      const row = node('div', 'slot');
      const button = node('button', 'slot-main' + (record ? ' occupied' : unavailable ? ' unavailable' : ''));
      button.type = 'button';
      button.append(node('span', 'slot-time', time));
      const info = node('span', 'slot-info');
      info.append(node('strong', '', record ? record.name : unavailable ? 'Horário bloqueado' : 'Disponível'));
      info.append(node('small', '', record ? record.service : unavailable ? 'Fechado para as clientes' : 'Adicionar atendimento'));
      if (record) info.append(node('span', 'status ' + record.status, statusLabels[record.status]));
      button.append(info, node('span', 'slot-arrow', record ? '↗' : unavailable ? '−' : '+'));
      button.addEventListener('click', () => {
        if (record) openAppointment(record);
        else if (unavailable) notice(blocked ? 'Libere o dia antes de adicionar um atendimento.' : 'Use o botão ao lado para liberar esse horário.');
        else openAppointment(null, time);
      });
      row.append(button);
      if (!record && !blocked) {
        const toggle = node('button', 'slot-lock', slotBlocked ? '+' : '−');
        toggle.setAttribute('aria-label', (slotBlocked ? 'Liberar ' : 'Bloquear ') + time);
        toggle.title = slotBlocked ? 'Liberar horário' : 'Bloquear horário';
        toggle.addEventListener('click', () => setBlock(selected, time, !slotBlocked, toggle));
        row.append(toggle);
      }
      container.append(row);
    });
    const cancelled = records.appointments.filter(item => item.date === selected && item.status === 'cancelled');
    $('cancelled-list').replaceChildren();
    $('cancelled-list').hidden = !cancelled.length;
    if (cancelled.length) {
      $('cancelled-list').append(node('p', '', 'CANCELADOS'));
      cancelled.forEach(record => {
        const button = node('button', '', record.time + ' · ' + record.name + ' ↗');
        button.addEventListener('click', () => openAppointment(record));
        $('cancelled-list').append(button);
      });
    }
  }

  async function setBlock(date, time, blocked, button) {
    button.disabled = true;
    try {
      await api('block', { date, time, blocked });
      notice(blocked ? 'Bloqueio salvo. Esse período já aparece indisponível no site.' : 'Período liberado no site.');
      await loadMonth();
    } catch (error) { notice(error.message, true); button.disabled = false; }
  }

  function openAppointment(record, time) {
    editing = record;
    $('dialog-title').textContent = record ? 'Detalhes do atendimento' : 'Novo atendimento';
    $('client-name').value = record?.name || '';
    $('client-phone').value = record?.phone || '';
    $('client-service').value = record?.service || 'Alongamento Molde F1';
    $('booking-date').value = record?.date || selected;
    $('booking-time').value = record?.time || time || '14:00';
    $('booking-status').value = record?.status || 'confirmed';
    $('booking-notes').value = record?.notes || '';
    $('client-whatsapp').hidden = !record;
    if (record) $('client-whatsapp').href = 'https://wa.me/' + record.phone;
    $('dialog-error').hidden = true;
    $('appointment-dialog').showModal();
  }

  $('appointment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('save-booking');
    button.disabled = true;
    $('dialog-error').hidden = true;
    const body = { name: $('client-name').value, phone: $('client-phone').value, service: $('client-service').value, date: $('booking-date').value, time: $('booking-time').value, status: $('booking-status').value, notes: $('booking-notes').value, ...(editing ? { id: editing.id, revision: editing.revision, updatedAt: editing.updatedAt } : {}) };
    try {
      await api('save', body);
      $('appointment-dialog').close();
      selected = body.date;
      visible = parseDate(selected);
      notice(body.status === 'cancelled' ? 'Atendimento cancelado. O horário foi liberado, se não houver bloqueio.' : 'Atendimento salvo na sua agenda.');
      await loadMonth();
    } catch (error) { $('dialog-error').textContent = error.message; $('dialog-error').hidden = false; }
    finally { button.disabled = false; }
  });

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    $('login-submit').disabled = true;
    $('login-error').hidden = true;
    try {
      const result = await api(needsSetup ? 'setup' : 'login', { password: $('password').value, ...(needsSetup ? { token: activationToken } : {}) });
      csrf = result.csrf;
      needsSetup = false;
      $('password').value = '';
      showDashboard();
    } catch (error) { $('login-error').textContent = error.message; $('login-error').hidden = false; }
    finally { $('login-submit').disabled = false; }
  });

  $('previous-month').addEventListener('click', () => { visible = new Date(visible.getFullYear(), visible.getMonth() - 1, 1); selected = dateKey(visible); loadMonth(); });
  $('next-month').addEventListener('click', () => { visible = new Date(visible.getFullYear(), visible.getMonth() + 1, 1); selected = dateKey(visible); loadMonth(); });
  $('go-today').addEventListener('click', () => { selected = todayKey; visible = parseDate(selected); loadMonth(); });
  $('new-booking').addEventListener('click', () => openAppointment(null));
  $('refresh').addEventListener('click', loadMonth);
  $('block-day').addEventListener('click', () => setBlock(selected, null, !isDayBlocked(selected), $('block-day')));
  $('logout').addEventListener('click', async () => { try { await api('logout', {}); showLogin(); } catch (error) { notice(error.message, true); } });
  document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('change-password').addEventListener('click', () => { $('new-password').value = ''; $('password-error').hidden = true; $('password-dialog').showModal(); });
  $('password-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try { const result = await api('password', { password: $('new-password').value }); csrf = result.csrf; $('password-dialog').close(); notice('Sua senha foi alterada.'); }
    catch (error) { $('password-error').textContent = error.message; $('password-error').hidden = false; }
    finally { button.disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && csrf && !document.querySelector('dialog[open]')) loadMonth(); });

  (async function init() {
    try {
      const result = await api('session');
      needsSetup = result.needsSetup;
      if (result.authenticated) { csrf = result.csrf; showDashboard(); return; }
      if (needsSetup) {
        $('login-title').textContent = 'Sua agenda começa aqui.';
        $('login-description').textContent = activationToken ? 'Crie uma senha para acessar e cuidar dos seus atendimentos.' : 'Sua área de atendimentos está pronta para ser ativada.';
        $('password-label').textContent = 'Crie sua senha · mínimo 10 caracteres';
        $('password').minLength = 10;
        $('password').autocomplete = 'new-password';
        $('login-submit').textContent = 'Criar senha e entrar ↗';
        $('setup-hint').hidden = Boolean(activationToken);
        $('login-form').hidden = !activationToken;
      }
    } catch (error) { $('login-error').textContent = error.message; $('login-error').hidden = false; }
  })();
})();
