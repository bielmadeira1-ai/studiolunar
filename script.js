/* LUNAR Studio — calendário demonstrativo e pedido via WhatsApp.
   Edite o whatsappNumber abaixo com o número real da Isla, DDI+DDD+número (só dígitos).
   A agenda não é sincronizada; conectar backend antes de anunciar disponibilidade em tempo real. */
window.LUNAR_CONFIG = window.LUNAR_CONFIG || { whatsappNumber: '' };
(function () {
  'use strict';
  var state = { date: null, time: null, service: null };
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
  function key(d) { return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); }
  function startToday(){ var x = new Date(); return new Date(x.getFullYear(),x.getMonth(),x.getDate()); }
  function sameDay(a,b){ return a && b && key(a) === key(b); }
  function renderCalendar(){
    grid.replaceChildren();
    monthTitle.textContent=monthFmt.format(visibleMonth);
    var today=startToday();
    prevMonth.disabled=visibleMonth.getFullYear()===today.getFullYear() && visibleMonth.getMonth()===today.getMonth();
    var first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
    var daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth()+1, 0).getDate();
    var offset=(first.getDay()+6)%7;
    for(var b=0;b<offset;b++){var blank=document.createElement('span');blank.setAttribute('aria-hidden','true');grid.append(blank);}
    for(var d=1;d<=daysInMonth;d++){
      var date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), d);
      var button=document.createElement('button'); button.type='button';button.textContent=String(d);
      button.disabled=date<today;
      button.setAttribute('aria-label',weekdayFmt.format(date)+', '+d+' de '+monthFmt.format(date));
      button.setAttribute('aria-pressed',sameDay(date,state.date)?'true':'false');
      if(sameDay(date,today))button.classList.add('today');
      button.addEventListener('click', (function(selected){return function(){state.date=selected;hideError();renderCalendar();};})(date));
      grid.append(button);
    }
  }
  function hideError(){error.hidden=true;error.textContent='';}
  prevMonth.addEventListener('click',function(){if(prevMonth.disabled)return;visibleMonth=new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()-1,1);renderCalendar();});
  nextMonth.addEventListener('click',function(){visibleMonth=new Date(visibleMonth.getFullYear(),visibleMonth.getMonth()+1,1);renderCalendar();});
  document.querySelectorAll('#times button').forEach(function(button){button.setAttribute('aria-pressed','false');button.addEventListener('click',function(){state.time=button.dataset.time;document.querySelectorAll('#times button').forEach(function(b){b.setAttribute('aria-pressed',String(b===button));});hideError();});});
  document.querySelectorAll('input[name="service"]').forEach(function(radio){radio.addEventListener('change',function(){state.service=radio.value;hideError();});});
  document.querySelectorAll('.service-select').forEach(function(button){button.addEventListener('click',function(){state.service=button.dataset.service;var radio=document.querySelector('input[name="service"][value="'+state.service+'"]');if(radio)radio.checked=true;document.getElementById('agendar').scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});});
  function formattedDate(){return state.date.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});}
  document.getElementById('review-button').addEventListener('click',function(){
    if(!state.date || !state.time || !state.service){ error.textContent='Escolha a data, um horário e o serviço pra continuar. ♡';error.hidden=false;return; }
    if(state.date<startToday()){error.textContent='Essa data já passou. Escolha outro dia.';error.hidden=false;return;}
    document.getElementById('review-date').textContent=formattedDate();document.getElementById('review-time').textContent=state.time;
    document.getElementById('review-service').textContent=state.service;
    formPanel.hidden=true;reviewPanel.hidden=false;reviewPanel.scrollIntoView({behavior:'smooth',block:'center'});
  });
  document.getElementById('back-button').addEventListener('click',function(){reviewPanel.hidden=true;formPanel.hidden=false;});
  function message(){return 'Oi, Isla! ♡ Gostaria de solicitar um horário no LUNAR Studio.\n\n✦ Serviço: '+state.service+'\n✦ Data: '+state.date.toLocaleDateString('pt-BR')+'\n✦ Horário: '+state.time+'\n\nEsse horário está disponível?';}
  document.getElementById('send-button').addEventListener('click',function(){
    if(!state.date || !state.time || !state.service)return;
    var number=String(window.LUNAR_CONFIG.whatsappNumber||'').replace(/\D/g,'');
    if(number.length<12){document.getElementById('whatsapp-warning').hidden=false;document.getElementById('copy-button').hidden=false;return;}
    window.open('https://wa.me/'+number+'?text='+encodeURIComponent(message()),'_blank','noopener,noreferrer');
  });
  document.getElementById('copy-button').addEventListener('click',function(){
    var button=this; if(navigator.clipboard && navigator.clipboard.writeText) {navigator.clipboard.writeText(message()).then(function(){button.textContent='Mensagem copiada ✓';}).catch(function(){button.textContent='Selecione e copie a mensagem: '+message();});}else {button.textContent=message();}
  });
  document.getElementById('year').textContent=String(new Date().getFullYear());renderCalendar();
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(entries){entries.forEach(function(entry){if(entry.isIntersecting){entry.target.classList.add('visible');io.unobserve(entry.target);}});},{threshold:.08});document.querySelectorAll('.reveal').forEach(function(el){io.observe(el);});}else {document.querySelectorAll('.reveal').forEach(function(el){el.classList.add('visible');});}
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    var motifs=document.querySelectorAll('.site-orbit');var ticking=false;
    window.addEventListener('scroll',function(){if(ticking)return;ticking=true;requestAnimationFrame(function(){var offset=window.scrollY;motifs.forEach(function(el,i){var drift=(i?0.08:0.055)*offset;var degree=(i?0.025:0.04)*offset;el.style.transform='translateY('+drift.toFixed(1)+'px) rotate('+degree.toFixed(1)+'deg)';});ticking=false;});},{passive:true});
  }
})();
