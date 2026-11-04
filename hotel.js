// ============================================================
//  Гостиница «Сладкие сны» — ВСЁ В ОДНОМ ФАЙЛЕ
//  Запуск:  node hotel.js
//  Открыть: http://localhost:3000
// ============================================================
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- «База данных» — JSON-файл ----------
const DB_FILE = path.join(__dirname, 'hotel-data.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initial = {
      rooms: [
        { id:1, type:'standard', title:'Стандарт с видом на город', capacity:2, price:3200 },
        { id:2, type:'standard', title:'Стандарт твин', capacity:2, price:2900 },
        { id:3, type:'comfort', title:'Комфорт с балконом', capacity:3, price:4800 },
        { id:4, type:'comfort', title:'Комфорт семейный', capacity:4, price:5400 },
        { id:5, type:'lux', title:'Люкс «Сладкий сон»', capacity:2, price:8900 },
        { id:6, type:'lux', title:'Люкс президентский', capacity:4, price:13500 }
      ],
      bookings: [],
      nextId: 1
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'sweet-dreams-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 4 }
}));

// ---------- Константы ----------
const ADMIN_LOGIN = 'hotel123';
const ADMIN_PASSWORD = 'adminHotel';

function todayISO() {
  const d = new Date();
  const pad = n => n < 10 ? '0' + n : '' + n;
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
}

function isDate(str) { return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str); }

function rangeFree(roomId, checkIn, checkOut) {
  for (const b of db.bookings) {
    if (b.roomId !== roomId || b.status !== 'approved') continue;
    if (!(checkOut <= b.checkIn || checkIn >= b.checkOut)) return false;
  }
  return true;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) return next();
  res.status(401).json({ error: 'Требуется авторизация' });
}

// ---------- API ----------
app.get('/api/rooms', (req, res) => {
  const { type, maxPrice, capacity } = req.query;
  let list = db.rooms.slice();
  if (type) list = list.filter(r => r.type === type);
  if (maxPrice) list = list.filter(r => r.price <= Number(maxPrice));
  if (capacity) list = list.filter(r => r.capacity >= Number(capacity));
  res.json(list);
});

app.get('/api/rooms/:id/busy', (req, res) => {
  const roomId = Number(req.params.id);
  const busy = [];
  for (const b of db.bookings) {
    if (b.roomId !== roomId || b.status !== 'approved') continue;
    const cur = new Date(b.checkIn + 'T00:00:00');
    const end = new Date(b.checkOut + 'T00:00:00');
    while (cur < end) {
      busy.push(cur.toISOString().slice(0,10));
      cur.setDate(cur.getDate() + 1);
    }
  }
  res.json(busy);
});

app.post('/api/bookings', (req, res) => {
  const { roomId, guestName, guestEmail, checkIn, checkOut } = req.body || {};
  const errors = [];

  if (!guestName || guestName.trim().length < 2) errors.push('Имя минимум 2 символа');
  if (!guestEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail)) errors.push('Некорректный email');
  if (!isDate(checkIn)) errors.push('Некорректная дата заезда');
  if (!isDate(checkOut)) errors.push('Некорректная дата выезда');

  const today = todayISO();
  if (isDate(checkIn) && checkIn < today) errors.push('Дата заезда в прошлом');
  if (isDate(checkIn) && isDate(checkOut) && checkOut <= checkIn) errors.push('Выезд должен быть позже заезда');

  const room = db.rooms.find(r => r.id === Number(roomId));
  if (!room) errors.push('Номер не найден');

  if (room && !errors.length && !rangeFree(room.id, checkIn, checkOut)) {
    errors.push('Выбранный период уже забронирован');
  }

  if (errors.length) return res.status(400).json({ errors });

  const booking = {
    id: db.nextId++,
    roomId: room.id,
    roomTitle: room.title,
    guestName: guestName.trim(),
    guestEmail: guestEmail.trim(),
    checkIn, checkOut,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.bookings.push(booking);
  saveDB(db);
  res.json({ id: booking.id, message: 'Заявка создана' });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username !== ADMIN_LOGIN || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  req.session.admin = { username };
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  if (req.session && req.session.admin) return res.json({ admin: req.session.admin });
  res.status(401).json({ error: 'Не авторизован' });
});

app.get('/api/admin/bookings', requireAdmin, (req, res) => {
  const sorted = db.bookings.slice().sort((a,b) => b.id - a.id);
  res.json(sorted);
});

app.post('/api/admin/bookings/:id/approve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const b = db.bookings.find(x => x.id === id);
  if (!b) return res.status(404).json({ error: 'Заявка не найдена' });
  if (b.status !== 'pending') return res.status(400).json({ error: 'Заявка уже обработана' });

  // Проверка пересечения с другими одобренными
  for (const other of db.bookings) {
    if (other.id === b.id || other.roomId !== b.roomId || other.status !== 'approved') continue;
    if (!(b.checkOut <= other.checkIn || b.checkIn >= other.checkOut)) {
      return res.status(409).json({ error: 'Период пересекается с одобренной бронью' });
    }
  }

  b.status = 'approved';
  saveDB(db);
  res.json({ ok: true });
});

app.delete('/api/admin/bookings/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const before = db.bookings.length;
  db.bookings = db.bookings.filter(x => x.id !== id);
  if (db.bookings.length === before) return res.status(404).json({ error: 'Заявка не найдена' });
  saveDB(db);
  res.json({ ok: true });
});

// ---------- HTML-страница (всё в одном файле) ----------
const HTML_PAGE = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Сладкие сны — бронирование гостиницы</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
<style>
  * { margin:0; padding:0; box-sizing:border-box; font-family:'Segoe UI', Roboto, sans-serif; }
  body { background:#f5f7fb; min-height:100vh; display:flex; flex-direction:column; color:#1e2a3a; }
  .container { max-width:1200px; margin:0 auto; padding:0 20px; }
  .header { background:#fff; box-shadow:0 4px 12px rgba(0,0,0,.05); padding:18px 0; margin-bottom:32px; }
  .header .container { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; }
  .logo { font-size:24px; font-weight:700; color:#2d4b6e; }
  .logo i { color:#ffb347; margin-right:8px; }
  .nav-buttons { display:flex; gap:12px; flex-wrap:wrap; }
  .btn { padding:10px 20px; border-radius:30px; border:none; font-weight:600; cursor:pointer; transition:.2s; display:inline-flex; align-items:center; gap:8px; background:#eef2f7; color:#1e2a3a; font-size:14px; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#2d4b6e; color:#fff; }
  .btn-primary:hover:not(:disabled) { background:#1e3a55; }
  .btn-outline { background:transparent; border:1.5px solid #2d4b6e; color:#2d4b6e; }
  .btn-outline:hover:not(:disabled) { background:rgba(45,75,110,.08); }
  .btn-danger { background:#e53935; color:#fff; }
  .btn-danger:hover:not(:disabled) { background:#b71c1c; }
  .btn-sm { padding:6px 14px; font-size:13px; }
  .card { background:#fff; border-radius:24px; padding:24px 28px; box-shadow:0 8px 24px rgba(0,0,0,.04); margin-bottom:28px; }
  h2 { font-size:24px; margin-bottom:20px; font-weight:600; display:flex; align-items:center; gap:10px; }
  .form-group { margin-bottom:18px; }
  label { display:block; font-size:14px; font-weight:500; margin-bottom:6px; color:#4a5f7a; }
  input, select { width:100%; padding:12px 16px; border-radius:16px; border:1.5px solid #dbe2ea; background:#f9fbfd; font-size:15px; outline:none; transition:.2s; }
  input:focus, select:focus { border-color:#2d4b6e; background:#fff; box-shadow:0 0 0 4px rgba(45,75,110,.06); }
  .inline-form { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
  .inline-form .form-group { flex:1 1 180px; margin-bottom:0; }
  .alert { padding:14px 20px; border-radius:16px; margin-bottom:20px; display:flex; align-items:center; gap:12px; font-weight:500; }
  .alert-error { background:#ffebee; color:#b71c1c; border-left:6px solid #e53935; }
  .alert-success { background:#e8f5e9; color:#1b5e20; border-left:6px solid #43a047; }
  .alert-info { background:#e3f2fd; color:#0d47a1; border-left:6px solid #1976d2; }
  .rooms-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:24px; margin-top:16px; }
  .room-card { background:#fff; border-radius:24px; overflow:hidden; box-shadow:0 8px 20px rgba(0,0,0,.05); border:1px solid #eef2f7; display:flex; flex-direction:column; }
  .room-img { height:160px; background:#d9e2ec; display:flex; align-items:center; justify-content:center; font-size:48px; color:#8fa9c9; }
  .room-info { padding:18px 20px 20px; flex:1; display:flex; flex-direction:column; }
  .room-title { font-size:18px; font-weight:700; margin-bottom:6px; }
  .room-meta { display:flex; gap:12px; font-size:13px; color:#5e7188; margin-bottom:12px; flex-wrap:wrap; }
  .room-price { font-size:22px; font-weight:700; color:#2d4b6e; margin:8px 0 16px; }
  .room-price small { font-size:14px; font-weight:400; color:#7b8ea3; }
  .room-actions { margin-top:auto; display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .table-wrap { overflow-x:auto; margin-top:12px; border-radius:18px; border:1px solid #e9eef4; }
  table { width:100%; border-collapse:collapse; font-size:14px; background:#fff; }
  th { text-align:left; padding:16px 18px; background:#f4f8fe; font-weight:600; color:#2d4b6e; white-space:nowrap; }
  td { padding:14px 18px; border-top:1px solid #eef2f7; vertical-align:middle; }
  .status-badge { display:inline-block; padding:4px 12px; border-radius:30px; font-size:12px; font-weight:600; }
  .status-pending { background:#fff3e0; color:#e65100; }
  .status-approved { background:#e8f5e9; color:#1b5e20; }
  .status-rejected { background:#ffebee; color:#b71c1c; }
  .actions-cell { display:flex; gap:6px; flex-wrap:wrap; }
  .hidden { display:none !important; }
  .footer { margin-top:auto; padding:24px 0; text-align:center; color:#8b9bb0; font-size:14px; border-top:1px solid #e9eef4; }
  .page-section { display:none; }
  .page-section.active { display:block; }
  .toast-message { position:fixed; bottom:30px; right:30px; background:#1e2a3a; color:#fff; padding:14px 24px; border-radius:40px; box-shadow:0 12px 30px rgba(0,0,0,.2); font-weight:500; display:flex; align-items:center; gap:12px; z-index:9999; max-width:420px; animation:slideIn .3s ease; }
  @keyframes slideIn { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
  .modal-overlay { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,.5); display:flex; align-items:center; justify-content:center; z-index:10000; padding:20px; }
  .modal-content { background:#fff; border-radius:28px; padding:32px; width:100%; max-width:520px; max-height:90vh; overflow-y:auto; box-shadow:0 24px 60px rgba(0,0,0,.2); }
  .date-info { font-size:13px; color:#7b8ea3; margin-top:4px; }
  .date-info.error { color:#e53935; }
  .date-info.ok { color:#2e7d32; }
  .busy-dates-list { background:#fff3e0; border-left:4px solid #ffb347; padding:10px 14px; border-radius:8px; font-size:13px; margin-bottom:16px; color:#7a4a00; }
</style>
</head>
<body>

<header class="header">
  <div class="container">
    <div class="logo"><i class="fas fa-moon"></i> Сладкие сны</div>
    <div class="nav-buttons">
      <button class="btn btn-outline" id="navGuestBtn"><i class="fas fa-user"></i> Гость</button>
      <button class="btn btn-outline" id="navAdminBtn"><i class="fas fa-shield-alt"></i> Панель управления</button>
      <button class="btn btn-danger hidden" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Выйти</button>
    </div>
  </div>
</header>

<main class="container">
  <section id="guestSection" class="page-section active">
    <div class="card">
      <h2><i class="fas fa-search"></i> Поиск подходящего номера</h2>
      <form id="searchForm" class="inline-form">
        <div class="form-group">
          <label>Тип номера</label>
          <select id="searchType">
            <option value="">Все типы</option>
            <option value="standard">Стандарт</option>
            <option value="comfort">Комфорт</option>
            <option value="lux">Люкс</option>
          </select>
        </div>
        <div class="form-group"><label>Макс. цена, ₽</label><input type="number" id="searchMaxPrice" placeholder="например, 5000" min="0" step="100"></div>
        <div class="form-group"><label>Гостей (минимум)</label><input type="number" id="searchCapacity" placeholder="например, 2" min="1" step="1"></div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-filter"></i> Применить</button>
        <button type="button" class="btn btn-outline" id="resetFilterBtn"><i class="fas fa-undo"></i> Сбросить</button>
      </form>
    </div>
    <div id="guestMessageArea"></div>
    <div id="roomsContainer" class="rooms-grid"></div>
  </section>

  <section id="adminSection" class="page-section">
    <div id="loginCard" class="card">
      <h2><i class="fas fa-lock"></i> Вход администратора</h2>
      <div id="loginMessageArea"></div>
      <form id="loginForm" style="max-width:400px;">
        <div class="form-group"><label>Логин</label><input type="text" id="loginUsername" placeholder="hotel123" autocomplete="username"></div>
        <div class="form-group"><label>Пароль</label><input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password"></div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-sign-in-alt"></i> Войти</button>
      </form>
      <p style="margin-top:16px;color:#7b8ea3;font-size:13px;">Подсказка: логин <b>hotel123</b>, пароль <b>adminHotel</b>.</p>
    </div>

    <div id="adminPanel" class="card hidden">
      <h2><i class="fas fa-clipboard-list"></i> Управление заявками</h2>
      <div id="adminMessageArea"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Номер</th><th>Гость</th><th>Даты</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody id="bookingsTableBody"></tbody>
        </table>
      </div>
    </div>
  </section>
</main>

<footer class="footer"><div class="container">© 2025 Гостиница «Сладкие сны»</div></footer>
<div id="toastContainer"></div>

<script>
(function(){
  'use strict';
  function escapeHtml(str){ return String(str==null?'':str).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function pad(n){ return n<10?'0'+n:''+n; }
  function displayDate(iso){ if(!iso) return '—'; var p=iso.split('-'); return p[2]+'.'+p[1]+'.'+p[0]; }
  function todayISO(){ var d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

  function showToast(msg, isError){
    var c=document.getElementById('toastContainer'), t=document.createElement('div');
    t.className='toast-message';
    if(isError) t.style.background='#b71c1c';
    t.innerHTML='<i class="fas '+(isError?'fa-exclamation-circle':'fa-check-circle')+'"></i><span>'+escapeHtml(msg)+'</span>';
    c.appendChild(t);
    setTimeout(function(){ t.style.transition='opacity .3s'; t.style.opacity='0'; setTimeout(function(){ if(t.parentNode)t.parentNode.removeChild(t); },300); },3500);
  }
  function setMessage(areaId, text, type){
    var a=document.getElementById(areaId); if(!a) return;
    if(!text){ a.innerHTML=''; return; }
    var cls=type==='error'?'alert-error':(type==='success'?'alert-success':'alert-info');
    var ico=type==='error'?'fa-exclamation-triangle':(type==='success'?'fa-check-circle':'fa-info-circle');
    a.innerHTML='<div class="alert '+cls+'"><i class="fas '+ico+'"></i> '+escapeHtml(text)+'</div>';
  }
  async function api(url, opts){
    var res = await fetch(url, opts);
    var data = null;
    try { data = await res.json(); } catch(e){}
    if(!res.ok){
      var msg = (data && (data.error || (data.errors && data.errors.join(', ')))) || ('Ошибка '+res.status);
      throw new Error(msg);
    }
    return data;
  }

  var guestSection=document.getElementById('guestSection');
  var adminSection=document.getElementById('adminSection');
  var loginCard=document.getElementById('loginCard');
  var adminPanel=document.getElementById('adminPanel');
  var logoutBtn=document.getElementById('logoutBtn');
  var adminLoggedIn=false;

  async function checkAdmin(){
    try { await api('/api/admin/me'); adminLoggedIn=true; } catch(e){ adminLoggedIn=false; }
    updateAdminUI();
  }
  function updateAdminUI(){
    if(adminLoggedIn){
      loginCard.classList.add('hidden');
      adminPanel.classList.remove('hidden');
      logoutBtn.classList.remove('hidden');
      renderBookingsTable();
    } else {
      loginCard.classList.remove('hidden');
      adminPanel.classList.add('hidden');
      logoutBtn.classList.add('hidden');
    }
  }
  document.getElementById('navGuestBtn').addEventListener('click',function(){
    guestSection.classList.add('active'); adminSection.classList.remove('active'); renderRooms();
  });
  document.getElementById('navAdminBtn').addEventListener('click',async function(){
    adminSection.classList.add('active'); guestSection.classList.remove('active'); await checkAdmin();
  });
  logoutBtn.addEventListener('click',async function(){
    try{ await api('/api/admin/logout',{method:'POST'}); }catch(e){}
    adminLoggedIn=false; updateAdminUI(); showToast('Вы вышли');
  });

  document.getElementById('loginForm').addEventListener('submit',async function(e){
    e.preventDefault();
    var u=document.getElementById('loginUsername').value.trim();
    var p=document.getElementById('loginPassword').value;
    try{
      await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      document.getElementById('loginUsername').value=''; document.getElementById('loginPassword').value='';
      setMessage('loginMessageArea','');
      adminLoggedIn=true; updateAdminUI(); showToast('Добро пожаловать!');
    } catch(err){ setMessage('loginMessageArea', err.message, 'error'); }
  });

  var currentFilter={type:'',maxPrice:null,capacity:null};

  async function renderRooms(){
    var container=document.getElementById('roomsContainer');
    container.innerHTML='<div class="card" style="grid-column:1/-1;text-align:center;color:#7b8ea3;">Загрузка...</div>';
    var params=[];
    if(currentFilter.type) params.push('type='+encodeURIComponent(currentFilter.type));
    if(currentFilter.maxPrice!=null) params.push('maxPrice='+currentFilter.maxPrice);
    if(currentFilter.capacity!=null) params.push('capacity='+currentFilter.capacity);
    var url='/api/rooms'+(params.length?'?'+params.join('&'):'');
    var list;
    try{ list=await api(url); }
    catch(err){ container.innerHTML='<div class="card" style="grid-column:1/-1;text-align:center;color:#b71c1c;">Ошибка: '+escapeHtml(err.message)+'</div>'; return; }
    if(list.length===0){ container.innerHTML='<div class="card" style="grid-column:1/-1;text-align:center;color:#7b8ea3;">😕 Ничего не найдено</div>'; return; }
    var html='';
    for(var i=0;i<list.length;i++){
      var room=list[i];
      var typeRu={standard:'Стандарт',comfort:'Комфорт',lux:'Люкс'}[room.type]||room.type;
      html+='<div class="room-card"><div class="room-img"><i class="fas fa-bed"></i></div><div class="room-info">'+
        '<div class="room-title">'+escapeHtml(room.title)+'</div>'+
        '<div class="room-meta"><span><i class="fas fa-users"></i> до '+room.capacity+' гостей</span><span><i class="fas fa-tag"></i> '+typeRu+'</span></div>'+
        '<div class="room-price">'+room.price.toLocaleString('ru-RU')+' ₽ <small>/ ночь</small></div>'+
        '<div class="room-actions"><button class="btn btn-primary btn-sm book-btn" data-room-id="'+room.id+'"><i class="fas fa-calendar-plus"></i> Забронировать</button></div>'+
      '</div></div>';
    }
    container.innerHTML=html;
    container.querySelectorAll('.book-btn').forEach(function(btn){
      btn.addEventListener('click',function(){ openBookingDialog(parseInt(this.getAttribute('data-room-id'),10)); });
    });
  }

  async function openBookingDialog(roomId){
    var room=null;
    try{ var rooms=await api('/api/rooms'); for(var i=0;i<rooms.length;i++){ if(rooms[i].id===roomId){ room=rooms[i]; break; } } }
    catch(e){ showToast(e.message,true); return; }
    if(!room) return;
    var busyList=[];
    try{ busyList=await api('/api/rooms/'+roomId+'/busy'); }catch(e){ showToast(e.message,true); return; }

    var busyHtml='';
    if(busyList.length>0){
      var parts=busyList.slice().sort().map(displayDate);
      busyHtml='<div class="busy-dates-list"><strong><i class="fas fa-ban"></i> Занятые даты:</strong><br>'+parts.join(', ')+'</div>';
    }

    var overlay=document.createElement('div'); overlay.className='modal-overlay';
    var content=document.createElement('div'); content.className='modal-content';
    content.innerHTML=
      '<h2 style="margin-bottom:20px;"><i class="fas fa-calendar-check"></i> Бронирование</h2>'+
      '<p style="margin-bottom:16px;color:#2d4b6e;font-weight:600;">'+escapeHtml(room.title)+' — '+room.price.toLocaleString('ru-RU')+' ₽/ночь</p>'+
      busyHtml+
      '<form id="bookingForm">'+
        '<div class="form-group"><label>Ваше имя *</label><input type="text" id="bGuestName" placeholder="Иван Петров"></div>'+
        '<div class="form-group"><label>Email *</label><input type="email" id="bGuestEmail" placeholder="ivan@example.com"></div>'+
        '<div class="form-group"><label>Дата заезда *</label><input type="date" id="bCheckIn"><div class="date-info" id="bInInfo">Не ранее сегодня</div></div>'+
        '<div class="form-group"><label>Дата выезда *</label><input type="date" id="bCheckOut"><div class="date-info" id="bOutInfo">Позже даты заезда</div></div>'+
        '<div id="bErrorArea"></div>'+
        '<div style="display:flex;gap:12px;margin-top:24px;">'+
          '<button type="submit" class="btn btn-primary" style="flex:1;">Отправить заявку</button>'+
          '<button type="button" class="btn btn-outline" id="bCancel" style="flex:1;">Отмена</button>'+
        '</div>'+
      '</form>';
    overlay.appendChild(content); document.body.appendChild(overlay);

    var ciEl=document.getElementById('bCheckIn'), coEl=document.getElementById('bCheckOut');
    var inInfo=document.getElementById('bInInfo'), outInfo=document.getElementById('bOutInfo');
    var today=todayISO(); ciEl.min=today;

    function busySet(){ var s={}; busyList.forEach(function(d){s[d]=true;}); return s; }
    function rangeFreeUI(ci,co){
      if(!ci||!co||co<=ci) return false;
      var set=busySet();
      var cur=new Date(ci+'T00:00:00'), end=new Date(co+'T00:00:00');
      while(cur<end){
        var iso=cur.getFullYear()+'-'+pad(cur.getMonth()+1)+'-'+pad(cur.getDate());
        if(set[iso]) return false;
        cur.setDate(cur.getDate()+1);
      }
      return true;
    }
    function checkDates(){
      var ci=ciEl.value, co=coEl.value;
      if(ci && ci<today){ inInfo.textContent='Дата в прошлом'; inInfo.className='date-info error'; }
      else if(ci){ inInfo.textContent='OK'; inInfo.className='date-info ok'; var n=new Date(ci+'T00:00:00'); n.setDate(n.getDate()+1); coEl.min=n.getFullYear()+'-'+pad(n.getMonth()+1)+'-'+pad(n.getDate()); }
      if(co&&ci){
        if(co<=ci){ outInfo.textContent='Должна быть позже'; outInfo.className='date-info error'; }
        else if(!rangeFreeUI(ci,co)){ outInfo.textContent='Период занят'; outInfo.className='date-info error'; }
        else { outInfo.textContent='Свободно'; outInfo.className='date-info ok'; }
      }
    }
    ciEl.addEventListener('change',checkDates); coEl.addEventListener('change',checkDates);

    document.getElementById('bCancel').addEventListener('click',function(){ overlay.remove(); });
    overlay.addEventListener('click',function(e){ if(e.target===overlay) overlay.remove(); });

    document.getElementById('bookingForm').addEventListener('submit',async function(e){
      e.preventDefault();
      var errArea=document.getElementById('bErrorArea'); errArea.innerHTML='';
      var name=document.getElementById('bGuestName').value.trim();
      var email=document.getElementById('bGuestEmail').value.trim();
      try{
        await api('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          roomId:roomId, guestName:name, guestEmail:email, checkIn:ciEl.value, checkOut:coEl.value
        })});
        overlay.remove();
        showToast('Заявка отправлена!');
        setMessage('guestMessageArea','Заявка отправлена администратору.','success');
        renderRooms();
      } catch(err){
        errArea.innerHTML='<div class="alert alert-error"><i class="fas fa-exclamation-triangle"></i> '+escapeHtml(err.message)+'</div>';
      }
    });
  }

  document.getElementById('searchForm').addEventListener('submit',function(e){
    e.preventDefault();
    var t=document.getElementById('searchType').value;
    var mpRaw=document.getElementById('searchMaxPrice').value;
    var capRaw=document.getElementById('searchCapacity').value;
    var mp=mpRaw?parseInt(mpRaw,10):null, cap=capRaw?parseInt(capRaw,10):null;
    if(mp!=null && (isNaN(mp) || mp<0)) mp=null;
    if(cap!=null && (isNaN(cap) || cap<1)) cap=null;
    currentFilter={type:t, maxPrice:mp, capacity:cap};
    renderRooms();
  });

  document.getElementById('resetFilterBtn').addEventListener('click',function(){
    document.getElementById('searchType').value='';
    document.getElementById('searchMaxPrice').value='';
    document.getElementById('searchCapacity').value='';
    currentFilter={type:'',maxPrice:null,capacity:null};
    renderRooms();
  });

  // ---------- Панель администратора: таблица заявок ----------
  async function renderBookingsTable(){
    var tbody=document.getElementById('bookingsTableBody');
    tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#7b8ea3;">Загрузка...</td></tr>';
    var list;
    try{ list=await api('/api/admin/bookings'); }
    catch(err){
      tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#b71c1c;">Ошибка: '+escapeHtml(err.message)+'</td></tr>';
      return;
    }
    if(!list.length){
      tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#7b8ea3;">Заявок пока нет</td></tr>';
      return;
    }
    var html='';
    for(var i=0;i<list.length;i++){
      var b=list[i];
      var statusRu={pending:'Ожидает',approved:'Подтверждена',rejected:'Отклонена'}[b.status]||b.status;
      var statusCls='status-'+(b.status==='approved'?'approved':(b.status==='rejected'?'rejected':'pending'));
      var actions='';
      if(b.status==='pending'){
        actions+='<button class="btn btn-primary btn-sm approve-btn" data-id="'+b.id+'"><i class="fas fa-check"></i> Подтвердить</button>';
      }
      actions+='<button class="btn btn-danger btn-sm delete-btn" data-id="'+b.id+'"><i class="fas fa-trash"></i> Удалить</button>';
      html+='<tr>'+
        '<td>'+b.id+'</td>'+
        '<td>'+escapeHtml(b.roomTitle)+'</td>'+
        '<td>'+escapeHtml(b.guestName)+'<br><small style="color:#7b8ea3;">'+escapeHtml(b.guestEmail)+'</small></td>'+
        '<td>'+displayDate(b.checkIn)+' — '+displayDate(b.checkOut)+'</td>'+
        '<td><span class="status-badge '+statusCls+'">'+statusRu+'</span></td>'+
        '<td><div class="actions-cell">'+actions+'</div></td>'+
      '</tr>';
    }
    tbody.innerHTML=html;

    tbody.querySelectorAll('.approve-btn').forEach(function(btn){
      btn.addEventListener('click',async function(){
        var id=parseInt(this.getAttribute('data-id'),10);
        btn.disabled=true;
        try{
          await api('/api/admin/bookings/'+id+'/approve',{method:'POST'});
          showToast('Заявка подтверждена');
          setMessage('adminMessageArea','');
          renderBookingsTable();
        }catch(err){
          btn.disabled=false;
          setMessage('adminMessageArea', err.message, 'error');
          showToast(err.message, true);
        }
      });
    });

    tbody.querySelectorAll('.delete-btn').forEach(function(btn){
      btn.addEventListener('click',async function(){
        var id=parseInt(this.getAttribute('data-id'),10);
        if(!confirm('Удалить заявку #'+id+'? Действие необратимо.')) return;
        btn.disabled=true;
        try{
          await api('/api/admin/bookings/'+id,{method:'DELETE'});
          showToast('Заявка удалена');
          setMessage('adminMessageArea','');
          renderBookingsTable();
        }catch(err){
          btn.disabled=false;
          setMessage('adminMessageArea', err.message, 'error');
          showToast(err.message, true);
        }
      });
    });
  }

  // ---------- Инициализация ----------
  renderRooms();

  // Проверяем, не авторизован ли уже админ (например, после перезагрузки страницы)
  (async function init(){
    try{ await api('/api/admin/me'); adminLoggedIn=true; }
    catch(e){ adminLoggedIn=false; }
    updateAdminUI();
  })();
})();
</script>
</body>
</html>`;

// ---------- Отдача HTML ----------
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(HTML_PAGE);
});

// ---------- Обработка 404 для API ----------
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Метод не найден' });
});

// ---------- Запуск сервера ----------
app.listen(PORT, () => {
  console.log('============================================================');
  console.log('  Гостиница «Сладкие сны»');
  console.log('  Сервер запущен: http://localhost:' + PORT);
  console.log('  Логин администратора: ' + ADMIN_LOGIN);
  console.log('  Пароль администратора: ' + ADMIN_PASSWORD);
  console.log('  Данные хранятся в: ' + DB_FILE);
  console.log('============================================================');
});