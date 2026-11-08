/* LUNAR Studio — disponibilidade sincronizada e confirmação pela Isla. */
window.LUNAR_CONFIG = window.LUNAR_CONFIG || { whatsappNumber: '5553997089603' };
(function () {
  'use strict';
  var state = { date: null, time: null, service: null, name: '', phone: '', requestId: null, booked: false };
  var availability = null;
  var loading = true;
  var requestSequence = 0;
  var now = new Date();
  var visibleMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthTitle = document.getElementById('month-title');
  var grid = document.getElementById('calendar-grid');
  var prevMonth = document.getElementById('prev-month');
  var nextMonth = document.getElementById('next-month');
  var reviewPanel = document.getElementById('booking-review');
  var formPanel = document.getElementById('booking-form');
  var error = document.getElementById('form-error');
  var weekdayFmt = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
  var monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  function key(date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'); }
  function todayKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function sameDay(a, b) { return a && b && key(a) === key(b); }
  function hideError() { error.hidden = true; error.textContent = ''; }
  function showError(message) { error.textContent = message; error.hidden = false; }
  function unavailable(date, time) {
    if (!availability || loading) return true;
    var day = key(date);
    return day < todayKey() || availability.blockedDays.includes(day) || availability.busy.some(function (slot) { return slot.date === day && slot.time === time; }) || new Date(day + 'T' + time + ':00-03:00') <= new Date();
  }
  function renderTimes() {
    document.querySelectorAll('#times button').forEach(function (button) {
      button.disabled = !state.date || unavailable(state.date, button.dataset.time);
      if (button.disabled && state.time === button.dataset.time) state.time = null;
      button.setAttribute('aria-pressed', String(button.dataset.time === state.time));
    });
  }
  function renderCalendar() {
    grid.replaceChildren();
    monthTitle.textContent = monthFmt.format(visibleMonth);
    prevMonth.disabled = key(visibleMonth).slice(0, 7) <= todayKey().slice(0, 7);
    var first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    var count = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
    var offset = (first.getDay() + 6) % 7;
    for (var blankIndex = 0; blankIndex < offset; blankIndex += 1) { var blank = document.createElement('span'); blank.setAttribute('aria-hidden', 'true'); grid.append(blank); }
    for (var day = 1; day <= count; day += 1) {
      var date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
      var button = document.createElement('button');
      button.type = 'button'; button.textContent = String(day);
      button.disabled = !availability || loading || availability.times.every(function (time) { return unavailable(date, time); });
      button.setAttribute('aria-label', weekdayFmt.format(date) + ', ' + day + ' de ' + monthFmt.format(date) + (button.disabled ? ', indisponível' : ''));
      button.setAttribute('aria-pressed', String(sameDay(date, state.date)));
      if (key(date) === todayKey()) button.classList.add('today');
      button.addEventListener('click', (function (selected) { return function () { state.date = selected; state.time = null; state.requestId = null; hideError(); renderCalendar(); renderTimes(); }; })(date));
      grid.append(button);
    }
  }
  async function loadAvailability() {
    var sequence = ++requestSequence;
    loading = true;
    document.getElementById('availability-status').textContent = 'Atualizando os horários disponíveis…';
    document.getElementById('retry-availability').hidden = true;
    renderCalendar(); renderTimes();
    try {
      var response = await fetch('/api/agenda?month=' + key(visibleMonth).slice(0, 7), { cache: 'no-store' });
      if (!response.ok) throw new Error('Não foi possível carregar os horários. Tente novamente.');
      var result = await response.json();
      if (sequence !== requestSequence) return;
      availability = result;
      loading = false;
      document.getElementById('availability-status').textContent = 'Agenda atualizada. Escolha um horário disponível.';
      renderCalendar(); renderTimes();
    } catch (failure) {
      if (sequence !== requestSequence) return;
      availability = null;
      loading = false;
      document.getElementById('availability-status').textContent = failure.message;
      document.getElementById('retry-availability').hidden = false;
      renderCalendar(); renderTimes();
    }
  }
  function changeMonth(delta) { visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + delta, 1); state.date = null; state.time = null; state.requestId = null; loadAvailability(); }
  prevMonth.addEventListener('click', function () { if (!prevMonth.disabled) changeMonth(-1); });
  nextMonth.addEventListener('click', function () { changeMonth(1); });
  document.getElementById('retry-availability').addEventListener('click', loadAvailability);
  document.querySelectorAll('#times button').forEach(function (button) {
    button.addEventListener('click', function () { if (button.disabled) return; state.time = button.dataset.time; state.requestId = null; renderTimes(); hideError(); });
  });
  document.querySelectorAll('input[name="service"]').forEach(function (radio) {
    radio.addEventListener('change', function () { state.service = radio.value; state.requestId = null; hideError(); });
  });
  document.querySelectorAll('.service-select').forEach(function (button) {
    button.addEventListener('click', function () {
      state.service = button.dataset.service; state.requestId = null;
      var radio = document.querySelector('input[name="service"][value="' + state.service + '"]');
      if (radio) radio.checked = true;
      document.getElementById('agendar').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  });
  document.getElementById('review-button').addEventListener('click', function () {
    state.name = document.getElementById('booking-name').value.trim();
    state.phone = document.getElementById('booking-phone').value.replace(/\D/g, '');
    if (!state.date || !state.time || !state.service) { showError('Escolha a data, um horário e o serviço pra continuar. ♡'); return; }
    if (unavailable(state.date, state.time)) { showError('Esse horário ficou indisponível. Escolha outro.'); loadAvailability(); return; }
    if (!state.name || state.name.length > 100) { showError('Conta seu nome para a Isla.'); document.getElementById('booking-name').focus(); return; }
    if (state.phone.length === 10 || state.phone.length === 11) state.phone = '55' + state.phone;
    if (!/^55\d{10,11}$/.test(state.phone)) { showError('Confere seu WhatsApp e inclui o DDD.'); document.getElementById('booking-phone').focus(); return; }
    document.getElementById('review-date').textContent = state.date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    document.getElementById('review-time').textContent = state.time;
    document.getElementById('review-service').textContent = state.service;
    document.getElementById('review-name').textContent = state.name;
    document.getElementById('review-phone').textContent = '+' + state.phone;
    document.getElementById('review-error').hidden = true;
    formPanel.hidden = true; reviewPanel.hidden = false;
    reviewPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.getElementById('back-button').addEventListener('click', function () { reviewPanel.hidden = true; formPanel.hidden = false; state.requestId = null; loadAvailability(); });
  function message() { return 'Oi, Isla! ♡ Enviei meu pedido no site do LUNAR Studio.\n\n✦ Nome: ' + state.name + '\n✦ Serviço: ' + state.service + '\n✦ Data: ' + state.date.toLocaleDateString('pt-BR') + '\n✦ Horário: ' + state.time + '\n\nFico aguardando tua confirmação!'; }
  document.getElementById('send-button').addEventListener('click', async function () {
    var button = this;
    if (state.booked || button.disabled) return;
    button.disabled = true;
    document.getElementById('back-button').disabled = true;
    document.getElementById('review-error').hidden = true;
    if (!state.requestId) state.requestId = crypto.randomUUID();
    try {
      var response = await fetch('/api/agenda?action=book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: key(state.date), time: state.time, service: state.service, name: state.name, phone: state.phone, requestId: state.requestId }) });
      var result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Não foi possível enviar. Tente novamente.');
      state.booked = true;
      document.getElementById('review-title').textContent = 'Pedido recebido! ♡';
      document.getElementById('review-description').textContent = 'Seu pedido já aparece para a Isla. Continue pelo WhatsApp para combinar os detalhes. O horário fica reservado após a confirmação.';
      document.getElementById('confirmation-note').textContent = 'Aguarde a confirmação da Isla pelo WhatsApp.';
      button.hidden = true;
      document.getElementById('back-button').hidden = true;
      var whatsapp = document.getElementById('whatsapp-open');
      var number = String(window.LUNAR_CONFIG.whatsappNumber || '').replace(/\D/g, '');
      whatsapp.href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(message());
      whatsapp.hidden = false;
      document.getElementById('copy-button').hidden = false;
      window.location.assign(whatsapp.href);
    } catch (failure) { document.getElementById('review-error').textContent = failure.message; document.getElementById('review-error').hidden = false; }
    finally { button.disabled = false; document.getElementById('back-button').disabled = false; }
  });
  document.getElementById('copy-button').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText(message()); this.textContent = 'Mensagem copiada ✓'; }
    catch { this.textContent = message(); }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !state.booked && !formPanel.hidden) loadAvailability(); });
  document.getElementById('year').textContent = String(new Date().getFullYear());
  loadAvailability();
  if ('IntersectionObserver' in window) { var io = new IntersectionObserver(function (entries) { entries.forEach(function (entry) { if (entry.isIntersecting) { entry.target.classList.add('visible'); io.unobserve(entry.target); } }); }, { threshold: .08 }); document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); }); }
  else { document.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('visible'); }); }
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var motifs = document.querySelectorAll('.site-orbit'); var ticking = false;
    window.addEventListener('scroll', function () { if (ticking) return; ticking = true; requestAnimationFrame(function () { var offset = window.scrollY; motifs.forEach(function (el, i) { var drift = (i ? 0.08 : 0.055) * offset; var degree = (i ? 0.025 : 0.04) * offset; el.style.transform = 'translateY(' + drift.toFixed(1) + 'px) rotate(' + degree.toFixed(1) + 'deg)'; }); ticking = false; }); }, { passive: true });
  }
})();
