// Belkin CRM — клиентская часть (без фреймворков и сборки).
'use strict';

const SERVICES = ['SMM', 'Таргет', 'Контекст', 'Сайты'];
const STATUSES = ['В работе', 'Ждёт оплаты', 'На паузе', 'Завершён'];
const TASK_COLS = ['К выполнению', 'В работе', 'Готово'];
const DOC_TYPES = ['Договор', 'Допсоглашение', 'Акт', 'Бриф', 'Счёт', 'Другое'];
const STD_PROCESSES = {
  'SMM': ['Контент-план', 'Дизайн и съёмка', 'Постинг и сторис', 'Комьюнити-менеджмент', 'Отчёт'],
  'Таргет': ['Стратегия и аудитории', 'Креативы', 'Запуск и оптимизация', 'Отчёт'],
  'Контекст': ['Семантика', 'Объявления', 'Оптимизация ставок', 'Отчёт'],
  'Сайты': ['ТЗ и структура', 'Дизайн', 'Разработка', 'Запуск', 'Поддержка'],
};

let db = null;
let saveTimer = null;

// ---------- утилиты ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const money = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ₽';
const fmtDate = (s) => s ? new Date(s + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '—';
const monthKey = (s) => s.slice(0, 7);
const monthName = (k) => new Date(k + '-01T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
const initials = (n) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const chip = (text, cls = '') => h('span', { class: 'chip ' + cls }, text);

function save() {
  const el = document.getElementById('saved');
  el.textContent = 'Сохраняю…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch('/api/db', { method: 'PUT', body: JSON.stringify(db) });
      el.textContent = r.ok ? 'Все изменения сохранены' : 'Ошибка сохранения!';
    } catch { el.textContent = 'Нет связи с сервером!'; }
  }, 250);
}

// ---------- данные ----------
const findProject = (id) => db.projects.find((p) => p.id === id);
const isOverdue = (pay) => pay.status !== 'Оплачено' && pay.date < today();
const nextPayment = (p) => p.payments.filter((x) => x.status !== 'Оплачено').sort((a, b) => a.date.localeCompare(b.date))[0];
const openTasks = (p) => p.tasks.filter((t) => t.status !== 'Готово');
const taskOverdue = (t) => t.status !== 'Готово' && t.due && t.due < today();

function allPeople() {
  const s = new Set();
  for (const p of db.projects) {
    if (p.manager) s.add(p.manager);
    p.processes.forEach((x) => x.owner && s.add(x.owner));
    p.tasks.forEach((t) => t.assignee && s.add(t.assignee));
  }
  return [...s].sort();
}

function makeProject(v) {
  const p = {
    id: uid(), client: v.client, title: v.title || '', status: v.status || 'В работе', manager: v.manager || '',
    services: v.services || [], amount: Number(v.amount) || 0, periodDays: Number(v.periodDays) || 14,
    brief: { goal: v.goal || '', preferences: v.preferences || '', avoid: v.avoid || '', contactName: v.contactName || '',
      contactPhone: v.contactPhone || '', contactEmail: v.contactEmail || '', links: v.links || '' },
    processes: [], tasks: [], payments: [], documents: [], notes: [],
  };
  for (const s of p.services) {
    for (const name of STD_PROCESSES[s] || []) p.processes.push({ id: uid(), service: s, name, owner: p.manager, note: '' });
  }
  return p;
}

function generatePayments(p, from, count) {
  let d = from;
  for (let i = 0; i < count; i++) {
    p.payments.push({ id: uid(), date: d, amount: p.amount, status: 'Ожидается', note: 'Предоплата' });
    d = addDays(d, p.periodDays);
  }
  p.payments.sort((a, b) => a.date.localeCompare(b.date));
}

function demoData() {
  const t = today();
  const a = makeProject({ client: 'Кофейня «Зерно»', title: 'Запуск соцсетей и реклама', manager: 'Анна Белова',
    services: ['SMM', 'Таргет'], amount: 45000, periodDays: 14,
    goal: 'Увеличить поток гостей в будни, собрать базу подписчиков 5 000 за квартал.',
    preferences: 'Тёплые тона, живые фото без стока, неформальный тон, эмодзи в меру.',
    avoid: 'Не использовать слово «бренд», не показывать конкурентов.',
    contactName: 'Игорь Зернов', contactPhone: '+7 900 000-00-01', contactEmail: 'igor@example.com' });
  a.processes.forEach((x, i) => { if (x.service === 'Таргет') x.owner = 'Максим Орлов'; if (i === 1) x.owner = 'Мария Ким'; });
  generatePayments(a, addDays(t, -6), 4);
  a.payments[0].status = 'Оплачено';
  a.tasks.push(
    { id: uid(), title: 'Утвердить контент-план на месяц', assignee: 'Анна Белова', due: addDays(t, 2), status: 'В работе', service: 'SMM' },
    { id: uid(), title: 'Креативы для рекламы кофе с собой', assignee: 'Мария Ким', due: addDays(t, -1), status: 'К выполнению', service: 'Таргет' },
    { id: uid(), title: 'Настроить пиксель и аудитории', assignee: 'Максим Орлов', due: addDays(t, 5), status: 'К выполнению', service: 'Таргет' },
    { id: uid(), title: 'Фотосессия в кофейне', assignee: 'Мария Ким', due: addDays(t, -8), status: 'Готово', service: 'SMM' });
  a.documents.push({ id: uid(), type: 'Договор', title: 'Договор № 12 от 01.09', url: '', date: addDays(t, -40) });
  a.notes.push({ id: uid(), date: new Date().toISOString(), text: 'Клиент просил больше сторис с бариста. Согласовали 3 в неделю.' });

  const b = makeProject({ client: 'Студия «Лофт Мебель»', title: 'Новый сайт и контекст', manager: 'Максим Орлов',
    services: ['Сайты', 'Контекст'], amount: 60000, periodDays: 14, status: 'Ждёт оплаты',
    goal: 'Сайт-каталог с заявками и контекстная реклама на Яндекс.Директ.',
    preferences: 'Минимализм, много воздуха, шрифт без засечек.', avoid: '' });
  generatePayments(b, addDays(t, -20), 3);
  b.payments[0].status = 'Оплачено';
  b.tasks.push({ id: uid(), title: 'Прототип главной страницы', assignee: 'Максим Орлов', due: addDays(t, 3), status: 'В работе', service: 'Сайты' });

  const c = makeProject({ client: 'Клиника «Дента+»', title: 'Продвижение в соцсетях', manager: 'Анна Белова',
    services: ['SMM'], amount: 30000, periodDays: 14, status: 'В работе',
    goal: 'Узнаваемость и запись на первичный приём.', preferences: 'Деликатный тон, без «страшилок».' });
  generatePayments(c, addDays(t, 4), 3);
  return { demo: true, projects: [a, b, c] };
}

// ---------- модальные формы ----------
const UPLOAD_ERROR = 'Не удалось загрузить файл (слишком большой).';

// Подтверждение внутри страницы: window.confirm в некоторых окнах просмотра отключён.
function ask(message, onYes) {
  const dlg = h('dialog', {}, h('h2', {}, message),
    h('div', { class: 'actions' },
      onYes && h('button', { class: 'btn danger', onclick: () => { dlg.close(); onYes(); } }, 'Да, удалить'),
      h('button', { class: 'btn', onclick: () => dlg.close() }, onYes ? 'Отмена' : 'Понятно')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function openForm({ title, fields, values = {}, onSave, onDelete, saveLabel = 'Сохранить' }) {
  const dlg = h('dialog');
  const inputs = {};
  const form = h('form', { method: 'dialog' }, h('h2', {}, title));
  for (const f of fields) {
    let el;
    const val = values[f.key] ?? f.default ?? '';
    if (f.type === 'textarea') el = h('textarea', { placeholder: f.placeholder || '' }); 
    else if (f.type === 'select') el = h('select', {}, f.options.map((o) => h('option', { value: o }, o)));
    else if (f.type === 'checks') {
      const boxes = f.options.map((o) => h('input', { type: 'checkbox', value: o, checked: (values[f.key] || []).includes(o) }));
      inputs[f.key] = { get: () => boxes.filter((b) => b.checked).map((b) => b.value) };
      form.append(h('label', {}, f.label), h('div', { class: 'checks' }, f.options.map((o, i) => h('label', {}, boxes[i], o))));
      continue;
    } else {
      el = h('input', { type: f.type || 'text', placeholder: f.placeholder || '', list: f.list ? 'people' : null, step: f.type === 'number' ? 'any' : null });
    }
    el.value = val;
    if (f.required) el.required = true;
    inputs[f.key] = { get: () => el.value.trim() };
    form.append(h('label', {}, f.label), el);
  }
  const cancel = h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Отмена');
  const actions = h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit' }, saveLabel), cancel);
  if (onDelete) {
    actions.append(h('span', { class: 'spacer' }), h('button', {
      type: 'button', class: 'btn danger',
      onclick: () => ask('Удалить? Это действие нельзя отменить.', () => { dlg.close(); onDelete(); }),
    }, 'Удалить'));
  }
  form.append(actions);
  form.addEventListener('submit', () => {
    const out = {};
    for (const [k, i] of Object.entries(inputs)) out[k] = i.get();
    onSave(out);
  });
  dlg.append(form);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function peopleList() {
  let dl = document.getElementById('people');
  if (!dl) { dl = h('datalist', { id: 'people' }); document.body.append(dl); }
  dl.replaceChildren(...allPeople().map((n) => h('option', { value: n })));
}

const projectFields = [
  { key: 'client', label: 'Клиент', required: true },
  { key: 'title', label: 'Суть проекта (коротко)' },
  { key: 'status', label: 'Статус', type: 'select', options: STATUSES },
  { key: 'manager', label: 'Главный ответственный', list: true },
  { key: 'services', label: 'Направления', type: 'checks', options: SERVICES },
  { key: 'amount', label: 'Сумма за период, ₽', type: 'number' },
  { key: 'periodDays', label: 'Период предоплаты, дней', type: 'number', default: 14 },
];

function editProject(p, rerender) {
  const isNew = !p;
  const values = isNew ? {} : { ...p };
  openForm({
    title: isNew ? 'Новый проект' : 'Параметры проекта', fields: projectFields, values,
    onSave: (v) => {
      if (isNew) {
        const np = makeProject(v);
        db.projects.push(np);
        save();
        location.hash = '#/p/' + np.id + '/overview';
        return;
      }
      Object.assign(p, { client: v.client, title: v.title, status: v.status, manager: v.manager, services: v.services,
        amount: Number(v.amount) || 0, periodDays: Number(v.periodDays) || 14 });
      save(); rerender();
    },
    onDelete: isNew ? null : () => { db.projects = db.projects.filter((x) => x !== p); save(); location.hash = '#/'; },
  });
}

// ---------- экран: проекты ----------
const filters = { q: '', status: 'Активные', owner: '' };

function viewProjects() {
  const t = today();
  const active = db.projects.filter((p) => p.status !== 'Завершён');
  const in14 = addDays(t, 14);
  const expected = active.flatMap((p) => p.payments).filter((x) => x.status !== 'Оплачено' && x.date <= in14);
  const overdue = db.projects.flatMap((p) => p.payments).filter(isOverdue);
  const overdueTasks = active.flatMap((p) => p.tasks).filter(taskOverdue);

  const list = h('div', { class: 'grid' });
  const draw = () => {
    const shown = db.projects.filter((p) => {
      if (filters.status === 'Активные' ? p.status === 'Завершён' : filters.status !== 'Все' && p.status !== filters.status) return false;
      if (filters.owner && !(p.manager === filters.owner || p.processes.some((x) => x.owner === filters.owner))) return false;
      const q = filters.q.toLowerCase();
      return !q || (p.client + ' ' + p.title).toLowerCase().includes(q);
    });
    list.replaceChildren(...(shown.length ? shown.map(projectCard) : [h('div', { class: 'empty' }, 'Проектов не найдено')]));
  };
  return h('div', {},
    h('h1', {}, 'Проекты'),
    h('div', { class: 'sub' }, `${active.length} в работе. Всё, что нужно по клиентам, — в одной карточке.`),
    h('div', { class: 'stats' },
      stat(active.length, 'активных проектов'),
      stat(money(expected.reduce((s, x) => s + x.amount, 0)), 'ожидается за 14 дней'),
      stat(money(overdue.reduce((s, x) => s + x.amount, 0)), `просрочено оплат: ${overdue.length}`, overdue.length),
      stat(overdueTasks.length, 'просроченных задач', overdueTasks.length)),
    h('div', { class: 'row toolbar', style: 'margin-bottom:16px' },
      h('input', { type: 'search', placeholder: 'Поиск по клиенту…', value: filters.q, oninput: (e) => { filters.q = e.target.value; draw(); } }),
      h('select', { onchange: (e) => { filters.status = e.target.value; draw(); } },
        ['Активные', 'Все', ...STATUSES].map((o) => h('option', { value: o, selected: filters.status === o }, o))),
      h('select', { onchange: (e) => { filters.owner = e.target.value; draw(); } },
        [h('option', { value: '' }, 'Все ответственные'), ...allPeople().map((n) => h('option', { value: n, selected: filters.owner === n }, n))]),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => editProject(null) }, '+ Новый проект')),
    (draw(), list));
}

const stat = (v, label, bad) => h('div', { class: 'stat' + (bad ? ' bad' : '') }, h('b', {}, v), h('span', {}, label));

function projectCard(p) {
  const np = nextPayment(p);
  const done = p.tasks.filter((t) => t.status === 'Готово').length;
  const pct = p.tasks.length ? Math.round(done / p.tasks.length * 100) : 0;
  const od = p.tasks.filter(taskOverdue).length;
  const owners = [...new Set([p.manager, ...p.processes.map((x) => x.owner)].filter(Boolean))];
  const statusCls = { 'В работе': 'ok', 'Ждёт оплаты': 'warn', 'На паузе': 'gray', 'Завершён': 'gray' }[p.status];
  return h('div', { class: 'card', onclick: () => { location.hash = '#/p/' + p.id + '/overview'; } },
    h('div', { class: 'row' }, h('h3', {}, p.client), h('span', { class: 'spacer' }), chip(p.status, statusCls)),
    p.title && h('div', { class: 'meta' }, p.title),
    h('div', {}, p.services.map((s) => chip(s))),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Следующая оплата'),
      np ? h('span', { class: isOverdue(np) ? 'bad' : '' }, `${fmtDate(np.date)} · ${money(np.amount)}${isOverdue(np) ? ' · просрочена' : ''}`) : h('span', { class: 'muted' }, 'не назначена')),
    h('div', { class: 'kv' }, h('span', { class: 'muted' }, `Задачи ${done}/${p.tasks.length}`),
      od ? h('span', { class: 'bad' }, `просрочено: ${od}`) : h('span', { class: 'muted' }, `открыто: ${openTasks(p).length}`)),
    h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
    h('div', { class: 'row', title: owners.join(', ') }, owners.slice(0, 6).map((n) => h('span', { class: 'avatar', title: n }, initials(n))),
      h('span', { class: 'meta' }, p.manager)));
}

// ---------- экран: проект ----------
const TABS = [['overview', 'Обзор'], ['processes', 'Процессы'], ['tasks', 'Задачи'], ['payments', 'Оплаты'], ['docs', 'Документы'], ['notes', 'Заметки']];

function viewProject(id, tab) {
  const p = findProject(id);
  if (!p) return h('div', { class: 'empty' }, 'Проект не найден');
  const rerender = () => route();
  const body = { overview: tabOverview, processes: tabProcesses, tasks: tabTasks, payments: tabPayments, docs: tabDocs, notes: tabNotes }[tab] || tabOverview;
  return h('div', {},
    h('a', { class: 'back', href: '#/' }, '← Все проекты'),
    h('div', { class: 'head' },
      h('div', {}, h('h1', {}, p.client), h('div', { class: 'sub', style: 'margin:0' }, p.title)),
      h('div', {}, chip(p.status, { 'В работе': 'ok', 'Ждёт оплаты': 'warn' }[p.status] || 'gray'), p.services.map((s) => chip(s))),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: () => editProject(p, rerender) }, 'Параметры')),
    h('div', { class: 'tabs' }, TABS.map(([k, label]) => h('a', { href: `#/p/${id}/${k}`, class: k === tab ? 'on' : '' }, label))),
    body(p, rerender));
}

const field = (label, value) => [h('div', { class: 'field-label' }, label), h('div', { class: 'pre' }, value || h('span', { class: 'muted' }, '—'))];

function tabOverview(p, rerender) {
  const b = p.brief;
  const np = nextPayment(p);
  const edit = () => openForm({
    title: 'Основная информация', values: b,
    fields: [
      { key: 'goal', label: 'Что за задача, цели', type: 'textarea' },
      { key: 'preferences', label: 'Предпочтения клиента', type: 'textarea' },
      { key: 'avoid', label: 'Чего избегать', type: 'textarea' },
      { key: 'contactName', label: 'Контактное лицо' }, { key: 'contactPhone', label: 'Телефон' },
      { key: 'contactEmail', label: 'Email' }, { key: 'links', label: 'Важные ссылки (соцсети, сайт, диск)', type: 'textarea' },
    ],
    onSave: (v) => { Object.assign(p.brief, v); save(); rerender(); },
  });
  const linkify = (text) => text.split(/(https?:\/\/\S+)/g).map((s) => /^https?:\/\//.test(s) ? h('a', { href: s, target: '_blank', rel: 'noopener' }, s) : s);
  return h('div', { class: 'two' },
    h('div', { class: 'panel' }, h('div', { class: 'row' }, h('h2', {}, 'О клиенте и задаче'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: edit }, 'Изменить')),
      field('Задача и цели', b.goal), field('Предпочтения', b.preferences), field('Чего избегать', b.avoid)),
    h('div', {},
      h('div', { class: 'panel' }, h('h2', {}, 'Контакты'),
        field('Контактное лицо', b.contactName), field('Телефон', b.contactPhone), field('Email', b.contactEmail),
        h('div', { class: 'field-label' }, 'Ссылки'), h('div', { class: 'pre' }, b.links ? linkify(b.links) : h('span', { class: 'muted' }, '—'))),
      h('div', { class: 'panel' }, h('h2', {}, 'Коротко'),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Главный ответственный'), h('b', {}, p.manager || '—')),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Предоплата'), h('b', {}, `${money(p.amount)} / ${p.periodDays} дн.`)),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Следующая оплата'), h('b', {}, np ? `${fmtDate(np.date)} · ${money(np.amount)}` : '—')),
        h('div', { class: 'kv' }, h('span', { class: 'muted' }, 'Открытых задач'), h('b', {}, openTasks(p).length)))));
}

function tabProcesses(p, rerender) {
  const edit = (x) => openForm({
    title: x ? 'Процесс' : 'Новый процесс', values: x || { service: p.services[0] || SERVICES[0], owner: p.manager },
    fields: [
      { key: 'service', label: 'Направление', type: 'select', options: SERVICES },
      { key: 'name', label: 'Процесс', required: true }, { key: 'owner', label: 'Ответственный', list: true },
      { key: 'note', label: 'Заметка / что входит', type: 'textarea' },
    ],
    onSave: (v) => { if (x) Object.assign(x, v); else p.processes.push({ id: uid(), ...v }); save(); rerender(); },
    onDelete: x && (() => { p.processes = p.processes.filter((y) => y !== x); save(); rerender(); }),
  });
  const services = [...new Set([...p.services, ...p.processes.map((x) => x.service)])];
  return h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:14px' },
      h('span', { class: 'muted' }, 'Кто за какой процесс отвечает в этом проекте'), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => edit(null) }, '+ Процесс')),
    services.length ? services.map((s) => h('div', { class: 'panel proc-group' }, h('h3', {}, s),
      p.processes.filter((x) => x.service === s).map((x) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' }, h('div', {}, x.name), x.note && h('div', { class: 'meta muted' }, x.note)),
        h('input', { class: 'inline-owner', list: 'people', placeholder: 'Назначить…', value: x.owner || '', title: 'Ответственный: нажмите и выберите или впишите имя',
          onchange: (e) => { x.owner = e.target.value.trim(); e.target.blur(); save(); setTimeout(rerender, 0); } }),
        h('button', { class: 'btn small', onclick: () => edit(x) }, 'Изменить')))))
      : h('div', { class: 'empty panel' }, 'Выберите направления в «Параметры» или добавьте процесс вручную'));
}

function taskForm(p, t, rerender, preset = {}) {
  openForm({
    title: t ? 'Задача' : 'Новая задача', values: t || { status: 'К выполнению', service: p.services[0] || '', assignee: p.manager, ...preset },
    fields: [
      { key: 'title', label: 'Что сделать', required: true },
      { key: 'assignee', label: 'Исполнитель', list: true }, { key: 'due', label: 'Срок', type: 'date' },
      { key: 'service', label: 'Направление', type: 'select', options: ['', ...SERVICES] },
      { key: 'status', label: 'Статус', type: 'select', options: TASK_COLS },
    ],
    onSave: (v) => { if (t) Object.assign(t, v); else p.tasks.push({ id: uid(), ...v }); save(); rerender(); },
    onDelete: t && (() => { p.tasks = p.tasks.filter((x) => x !== t); save(); rerender(); }),
  });
}

function tabTasks(p, rerender) {
  const card = (t) => h('div', { class: 'task', draggable: 'true', onclick: () => taskForm(p, t, rerender),
    ondragstart: (e) => e.dataTransfer.setData('text/plain', t.id) },
    h('div', { class: 't' }, t.title),
    h('div', { class: 'meta' }, t.assignee && h('span', {}, t.assignee), t.service && h('span', {}, t.service),
      t.due && h('span', { class: taskOverdue(t) ? 'bad' : '' }, (taskOverdue(t) ? 'просрочено · ' : '') + fmtDate(t.due))));
  return h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('span', { class: 'muted' }, 'Перетаскивайте карточки между колонками'),
      h('span', { class: 'spacer' }), h('button', { class: 'btn primary', onclick: () => taskForm(p, null, rerender) }, '+ Задача')),
    h('div', { class: 'kanban' }, TASK_COLS.map((c) => {
      const col = h('div', { class: 'col',
        ondragover: (e) => { e.preventDefault(); col.classList.add('over'); },
        ondragleave: () => col.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault();
          const t = p.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          if (t) { t.status = c; save(); rerender(); }
        } },
        h('h4', {}, `${c} · ${p.tasks.filter((t) => t.status === c).length}`),
        p.tasks.filter((t) => t.status === c).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).map(card));
      return col;
    })));
}

function payForm(p, x, rerender) {
  openForm({
    title: x ? 'Оплата' : 'Новая оплата', values: x || { date: today(), amount: p.amount, status: 'Ожидается', note: 'Предоплата' },
    fields: [
      { key: 'date', label: 'Дата', type: 'date', required: true }, { key: 'amount', label: 'Сумма, ₽', type: 'number', required: true },
      { key: 'status', label: 'Статус', type: 'select', options: ['Ожидается', 'Оплачено'] }, { key: 'note', label: 'Комментарий' },
    ],
    onSave: (v) => {
      v.amount = Number(v.amount) || 0;
      if (x) Object.assign(x, v); else p.payments.push({ id: uid(), ...v });
      p.payments.sort((a, b) => a.date.localeCompare(b.date)); save(); rerender();
    },
    onDelete: x && (() => { p.payments = p.payments.filter((y) => y !== x); save(); rerender(); }),
  });
}

function tabPayments(p, rerender) {
  const paid = p.payments.filter((x) => x.status === 'Оплачено').reduce((s, x) => s + x.amount, 0);
  const wait = p.payments.filter((x) => x.status !== 'Оплачено').reduce((s, x) => s + x.amount, 0);
  const last = p.payments[p.payments.length - 1];
  const more = () => openForm({
    title: 'Сгенерировать график предоплат', saveLabel: 'Создать',
    values: { from: last ? addDays(last.date, p.periodDays) : today(), count: 4, amount: p.amount, periodDays: p.periodDays },
    fields: [
      { key: 'from', label: 'Первая дата', type: 'date', required: true }, { key: 'count', label: 'Сколько платежей', type: 'number', required: true },
      { key: 'amount', label: 'Сумма, ₽', type: 'number', required: true }, { key: 'periodDays', label: 'Через сколько дней', type: 'number' },
    ],
    onSave: (v) => {
      p.amount = Number(v.amount) || 0; p.periodDays = Number(v.periodDays) || 14;
      generatePayments(p, v.from, Math.min(Math.max(Number(v.count) || 1, 1), 52)); save(); rerender();
    },
  });
  return h('div', {},
    h('div', { class: 'stats' }, stat(money(paid), 'получено'), stat(money(wait), 'ожидается'),
      stat(p.payments.filter(isOverdue).length, 'просрочено', p.payments.filter(isOverdue).length)),
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('span', { class: 'spacer' }),
      h('button', { class: 'btn', onclick: more }, 'Сгенерировать график'),
      h('button', { class: 'btn primary', onclick: () => payForm(p, null, rerender) }, '+ Оплата')),
    h('div', { class: 'panel' }, p.payments.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Дата'), h('th', {}, 'Комментарий'), h('th', { class: 'num' }, 'Сумма'), h('th', {}, 'Статус'), h('th', {}))),
      h('tbody', {}, p.payments.map((x) => h('tr', { class: isOverdue(x) ? 'overdue' : '' },
        h('td', {}, fmtDate(x.date)), h('td', { class: 'muted' }, x.note), h('td', { class: 'num' }, money(x.amount)),
        h('td', {}, chip(isOverdue(x) ? 'Просрочена' : x.status, x.status === 'Оплачено' ? 'ok' : isOverdue(x) ? 'bad' : 'warn')),
        h('td', { class: 'num' },
          x.status !== 'Оплачено' && h('button', { class: 'btn small', onclick: () => { x.status = 'Оплачено'; save(); rerender(); } }, 'Оплачено '),
          h('button', { class: 'btn small ghost', onclick: () => payForm(p, x, rerender) }, 'Изменить'))))))
      : h('div', { class: 'empty' }, 'Оплат пока нет — нажмите «Сгенерировать график»')));
}

function tabDocs(p, rerender) {
  const add = (preset = {}) => openForm({
    title: 'Документ', values: { type: 'Договор', date: today(), ...preset }, saveLabel: 'Добавить',
    fields: [
      { key: 'type', label: 'Тип', type: 'select', options: DOC_TYPES }, { key: 'title', label: 'Название', required: true },
      { key: 'date', label: 'Дата', type: 'date' }, { key: 'url', label: 'Ссылка (Google Диск, Notion…) или загрузите файл', type: 'url' },
    ],
    onSave: (v) => { p.documents.push({ id: uid(), ...v }); save(); rerender(); },
  });
  const upload = h('input', { type: 'file', hidden: true, onchange: async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
    if (!r.ok) return ask(UPLOAD_ERROR);
    const j = await r.json();
    add({ title: f.name, url: j.url });
  } });
  const order = (d) => DOC_TYPES.indexOf(d.type);
  return h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('span', { class: 'muted' }, 'Договоры, акты, брифы и всё остальное по проекту'), h('span', { class: 'spacer' }),
      upload, h('button', { class: 'btn', onclick: () => upload.click() }, 'Загрузить файл'),
      h('button', { class: 'btn primary', onclick: () => add() }, '+ Ссылка / документ')),
    h('div', { class: 'panel' }, p.documents.length ? [...p.documents].sort((a, b) => order(a) - order(b)).map((d) => h('div', { class: 'list-item' },
      chip(d.type, d.type === 'Договор' ? 'ok' : ''),
      h('div', { class: 'grow' }, d.url && /^(https?:\/\/|\/files\/)/.test(d.url) ? h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.title) : d.title),
      h('span', { class: 'muted' }, fmtDate(d.date)),
      h('button', { class: 'btn small danger ghost', onclick: () => ask('Удалить документ из списка?', () => { p.documents = p.documents.filter((x) => x !== d); save(); rerender(); }) }, '✕')))
      : h('div', { class: 'empty' }, 'Документов пока нет')));
}

function tabNotes(p, rerender) {
  const ta = h('textarea', { placeholder: 'Что обсудили, о чём договорились…' });
  return h('div', { class: 'panel' }, ta,
    h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => {
      if (!ta.value.trim()) return;
      p.notes.unshift({ id: uid(), date: new Date().toISOString(), text: ta.value.trim() }); save(); rerender();
    } }, 'Добавить заметку')),
    h('div', { style: 'margin-top:14px' }, p.notes.map((n) => h('div', { class: 'note' },
      h('small', {}, new Date(n.date).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }), ' · ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); openForm({ title: 'Заметка', values: n, fields: [{ key: 'text', label: 'Текст', type: 'textarea', required: true }],
          onSave: (v) => { n.text = v.text; save(); rerender(); } }); } }, 'изменить'), ' · ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); ask('Удалить заметку?', () => { p.notes = p.notes.filter((x) => x !== n); save(); rerender(); }); } }, 'удалить')),
      h('div', { class: 'pre' }, n.text)))));
}

// ---------- экран: оплаты (все проекты) ----------
let payTab = 'upcoming';

function viewPayments() {
  const rows = db.projects.filter((p) => p.status !== 'Завершён' || payTab === 'paid')
    .flatMap((p) => p.payments.map((x) => ({ p, x })))
    .filter(({ x }) => payTab === 'paid' ? x.status === 'Оплачено' : x.status !== 'Оплачено')
    .sort((a, b) => (payTab === 'paid' ? b.x.date.localeCompare(a.x.date) : a.x.date.localeCompare(b.x.date)));
  const groups = {};
  rows.forEach((r) => (groups[monthKey(r.x.date)] ||= []).push(r));
  const m = monthKey(today());
  const allPays = db.projects.flatMap((p) => p.payments);
  const inMonth = allPays.filter((x) => monthKey(x.date) === m);
  return h('div', {},
    h('h1', {}, 'Оплаты'), h('div', { class: 'sub' }, 'Календарь предоплат по всем проектам'),
    h('div', { class: 'stats' },
      stat(money(inMonth.filter((x) => x.status === 'Оплачено').reduce((s, x) => s + x.amount, 0)), 'получено в этом месяце'),
      stat(money(inMonth.filter((x) => x.status !== 'Оплачено').reduce((s, x) => s + x.amount, 0)), 'ещё ожидается в этом месяце'),
      stat(money(allPays.filter(isOverdue).reduce((s, x) => s + x.amount, 0)), 'просрочено', allPays.some(isOverdue))),
    h('div', { class: 'tabs' }, [['upcoming', 'Предстоящие'], ['paid', 'Оплаченные']].map(([k, l]) =>
      h('a', { href: '#/payments', class: k === payTab ? 'on' : '', onclick: () => { payTab = k; route(); } }, l))),
    rows.length ? Object.entries(groups).map(([k, rs]) => h('div', { class: 'panel' },
      h('h2', {}, monthName(k), h('span', { class: 'muted' }, ' · ' + money(rs.reduce((s, r) => s + r.x.amount, 0)))),
      h('table', {}, h('tbody', {}, rs.map(({ p, x }) => h('tr', { class: isOverdue(x) ? 'overdue' : '' },
        h('td', {}, fmtDate(x.date)),
        h('td', {}, h('a', { href: `#/p/${p.id}/payments` }, p.client)),
        h('td', { class: 'muted' }, x.note), h('td', { class: 'num' }, money(x.amount)),
        h('td', {}, isOverdue(x) && chip('Просрочена', 'bad')),
        h('td', { class: 'num' }, x.status !== 'Оплачено'
          ? h('button', { class: 'btn small', onclick: () => { x.status = 'Оплачено'; save(); route(); } }, 'Оплачено')
          : h('button', { class: 'btn small ghost', onclick: () => { x.status = 'Ожидается'; save(); route(); } }, 'Вернуть'),
          ' ', h('button', { class: 'btn small ghost', onclick: () => payForm(p, x, route) }, 'Изменить'))))))))
      : h('div', { class: 'empty panel' }, 'Здесь пока пусто'));
}

// ---------- экран: задачи ----------
const taskFilter = { who: '', hideDone: true };

function viewTasks() {
  const rows = db.projects.filter((p) => p.status !== 'Завершён').flatMap((p) => p.tasks.map((t) => ({ p, t })))
    .filter(({ t }) => (!taskFilter.who || t.assignee === taskFilter.who) && (!taskFilter.hideDone || t.status !== 'Готово'))
    .sort((a, b) => (a.t.due || '9').localeCompare(b.t.due || '9'));
  return h('div', {},
    h('h1', {}, 'Задачи'), h('div', { class: 'sub' }, 'Все задачи по всем проектам — удобно смотреть по исполнителю'),
    h('div', { class: 'row toolbar', style: 'margin-bottom:16px' },
      h('select', { onchange: (e) => { taskFilter.who = e.target.value; route(); } },
        [h('option', { value: '' }, 'Все исполнители'), ...allPeople().map((n) => h('option', { value: n, selected: taskFilter.who === n }, n))]),
      h('label', { class: 'row', style: 'gap:6px' }, h('input', { type: 'checkbox', style: 'width:auto', checked: taskFilter.hideDone,
        onchange: (e) => { taskFilter.hideDone = e.target.checked; route(); } }), 'Скрыть выполненные')),
    h('div', { class: 'panel' }, rows.length ? h('table', {}, h('tbody', {}, rows.map(({ p, t }) => h('tr', { class: t.status === 'Готово' ? 'done' : taskOverdue(t) ? 'overdue' : '' },
      h('td', { style: 'width:30px' }, h('input', { type: 'checkbox', style: 'width:auto', checked: t.status === 'Готово',
        onchange: (e) => { t.status = e.target.checked ? 'Готово' : 'К выполнению'; save(); route(); } })),
      h('td', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); taskForm(p, t, route); } }, t.title)), h('td', {}, h('a', { href: `#/p/${p.id}/tasks` }, p.client)),
      h('td', { class: 'muted' }, t.assignee), h('td', {}, t.service && chip(t.service)),
      h('td', { class: 'num' }, t.due && h('span', { class: taskOverdue(t) ? 'bad' : '', style: taskOverdue(t) ? 'color:var(--bad);font-weight:600' : '' }, fmtDate(t.due)))))))
      : h('div', { class: 'empty' }, 'Задач нет 🎉')));
}

// ---------- экран: команда ----------
function renamePerson(oldName) {
  openForm({
    title: 'Переименовать сотрудника', values: { name: oldName }, fields: [{ key: 'name', label: 'Имя (поменяется во всех проектах и задачах)', required: true }],
    onSave: ({ name }) => {
      for (const p of db.projects) {
        if (p.manager === oldName) p.manager = name;
        p.processes.forEach((x) => { if (x.owner === oldName) x.owner = name; });
        p.tasks.forEach((t) => { if (t.assignee === oldName) t.assignee = name; });
      }
      save(); route();
    },
  });
}

function viewTeam() {
  const people = allPeople();
  return h('div', {}, h('h1', {}, 'Команда'), h('div', { class: 'sub' }, 'Кто за что отвечает и сколько на ком проектов'),
    people.length ? h('div', { class: 'grid' }, people.map((n) => {
      const procs = db.projects.filter((p) => p.status !== 'Завершён').flatMap((p) => p.processes.filter((x) => x.owner === n).map((x) => ({ p, x })));
      const managed = db.projects.filter((p) => p.manager === n && p.status !== 'Завершён');
      const tasks = db.projects.flatMap((p) => p.tasks).filter((t) => t.assignee === n && t.status !== 'Готово');
      const projects = new Set([...procs.map((r) => r.p), ...managed]);
      return h('div', { class: 'card', style: 'cursor:default' },
        h('div', { class: 'row' }, h('span', { class: 'avatar', style: 'width:34px;height:34px;font-size:13px' }, initials(n)), h('h3', {}, n), h('span', { class: 'spacer' }),
          h('button', { class: 'btn small ghost', onclick: () => renamePerson(n) }, 'Переименовать')),
        h('div', { class: 'meta' }, `Проектов: ${projects.size} · открытых задач: ${tasks.length} (просрочено ${tasks.filter(taskOverdue).length})`),
        managed.length > 0 && h('div', {}, h('div', { class: 'field-label' }, 'Ведёт проекты'),
          managed.map((p) => h('a', { href: `#/p/${p.id}/overview`, style: 'margin-right:8px' }, p.client))),
        procs.length > 0 && h('div', {}, h('div', { class: 'field-label' }, 'Процессы'),
          procs.map(({ p, x }) => h('div', { class: 'kv' }, h('a', { href: `#/p/${p.id}/processes` }, p.client), h('span', { class: 'muted' }, `${x.service} · ${x.name}`)))));
    })) : h('div', { class: 'empty panel' }, 'Добавьте ответственных в проектах — они появятся здесь'));
}

// ---------- роутер ----------
function renderNav() {
  const overduePay = db.projects.flatMap((p) => p.payments).filter(isOverdue).length;
  const items = [['#/', 'Проекты', 0], ['#/payments', 'Оплаты', overduePay], ['#/tasks', 'Задачи', 0], ['#/team', 'Команда', 0]];
  const hash = location.hash || '#/';
  const nav = document.getElementById('nav');
  nav.replaceChildren(...items.map(([href, label, n]) => h('a', {
    href, class: (href === '#/' ? hash === '#/' || hash.startsWith('#/p/') : hash.startsWith(href)) ? 'on' : '',
  }, label, n > 0 && h('span', { class: 'badge' }, n))));
  document.getElementById('demo-clear').hidden = !db.demo;
}

function route() {
  peopleList();
  renderNav();
  const hash = location.hash || '#/';
  const main = document.getElementById('main');
  const scroll = window.scrollY;
  let view;
  let m;
  if ((m = hash.match(/^#\/p\/([^/]+)(?:\/(\w+))?/))) view = viewProject(m[1], m[2] || 'overview');
  else if (hash.startsWith('#/payments')) view = viewPayments();
  else if (hash.startsWith('#/tasks')) view = viewTasks();
  else if (hash.startsWith('#/team')) view = viewTeam();
  else view = viewProjects();
  main.replaceChildren(view);
  window.scrollTo(0, scroll);
}

async function init() {
  const r = await fetch('/api/db');
  db = await r.json();
  if (db.empty) { db = demoData(); save(); }
  document.getElementById('demo-clear').addEventListener('click', () => {
    ask('Удалить демо-проекты и начать с чистого листа?', () => { db = { projects: [] }; save(); location.hash = '#/'; route(); });
  });
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });
  route();
}

init();
