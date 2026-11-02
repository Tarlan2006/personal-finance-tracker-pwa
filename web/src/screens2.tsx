import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, ApiError, pauseRemainingSec } from './api';
import { getQueueStatus, subscribeQueue, listQueue, retryFailed, flush } from './queue';
import { applyTheme, bump, Field, fmt, getState, loadCats, monthLabel, savedTheme, shiftMonth, Sheet, thisMonth, useAppState, type Cat } from './ui';
import { doLogout } from './screens1';
import { FinancialProfileScreen } from './onboarding';

// ---------- Отчёты ----------
interface Summary { month: string; totals: { in: number; out: number; net: number; count: number }; byCategory: Record<'in' | 'out', Array<{ id: string | null; name: string; color: string; sum: number; count: number }>>; byCounterparty: Record<'in' | 'out', Array<{ name: string; display: string; sum: number; count: number; categoryId: string | null }>>; uncategorized: { count: number; sum: number } }

function Donut({ data, total }: { data: Array<{ name: string; color: string; sum: number }>; total: number }) {
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  return <svg viewBox="0 0 140 140" width="180" height="180" role="img" aria-label="Диаграмма по категориям" style={{ display: 'block', margin: '0 auto' }}>
    <circle cx="70" cy="70" r={R} fill="none" stroke="var(--bg3)" strokeWidth="18" />
    {data.map(d => { const len = total ? (d.sum / total) * C : 0; const el = <circle key={d.name} cx="70" cy="70" r={R} fill="none" stroke={d.color} strokeWidth="18" strokeDasharray={`${Math.max(len - 1, 0)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />; off += len; return el; })}
    <text x="70" y="68" textAnchor="middle" fontSize="9" fill="var(--fg2)">всего</text>
    <text x="70" y="82" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--fg)">{fmt(total)}</text>
  </svg>;
}

export function Reports() {
  const { cats, version } = useAppState();
  const [month, setMonth] = useState(thisMonth()); const [dir, setDir] = useState<'out' | 'in'>('out'); const [s, setS] = useState<Summary | null>(null); const [err, setErr] = useState('');
  const [pick, setPick] = useState<Summary['byCounterparty']['out'][number] | null>(null);
  useEffect(() => { setErr(''); api('GET', '/api/reports/summary?month=' + month).then(setS).catch(e => setErr(e.message)); }, [month, version]);
  const total = s ? s.totals[dir] : 0; const catRows = s?.byCategory[dir] ?? []; const cpRows = s?.byCounterparty[dir] ?? [];
  return <>
    <h1>Отчёты</h1>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
      <button className="btn small sec" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
      <strong>{monthLabel(month).replace(/^./, c => c.toUpperCase()).replace(/ г\.$/, '')}</strong>
      <button className="btn small sec" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth()}>›</button>
    </div>
    {err && <div className="banner" role="alert">{err}</div>}
    <div className="seg"><button className={dir === 'out' ? 'on' : ''} onClick={() => setDir('out')}>Расходы</button><button className={dir === 'in' ? 'on' : ''} onClick={() => setDir('in')}>Доходы</button></div>
    {s && <>
      <div className="group" style={{ padding: 16, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Расходы</span><b>{fmt(s.totals.out)}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Доходы</span><b style={{ color: 'var(--green)' }}>{fmt(s.totals.in)}</b></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Баланс</span><b>{fmt(s.totals.net)}</b></div>
      </div>
      {s.uncategorized.count > 0 && <div className="banner">Без категории: {s.uncategorized.count} {s.uncategorized.count === 1 ? 'запись' : 'записей'} на {fmt(s.uncategorized.sum)}. Назначьте категорию получателю ниже.</div>}
      {!catRows.length ? <div className="empty">За этот месяц нет {dir === 'out' ? 'расходов' : 'доходов'}</div> : <>
        <h2>По категориям</h2>
        <div className="group" style={{ padding: 16 }}><Donut data={catRows} total={total} /></div>
        <div className="group" style={{ marginTop: 8 }}>{catRows.map(c => <div className="row" key={c.name} data-testid="cat-row">
          <span className="dot" style={{ background: c.color }} /><div className="grow"><div>{c.name}</div><div className="bar"><i style={{ width: `${total ? (c.sum / total) * 100 : 0}%`, background: c.color }} /></div></div>
          <div style={{ textAlign: 'right' }}><div className="amt">{fmt(c.sum)}</div><div className="sub">{c.count} · {total ? Math.round((c.sum / total) * 100) : 0}%</div></div></div>)}</div>
        <h2>По {dir === 'out' ? 'получателям' : 'отправителям'}</h2>
        <div className="group">{cpRows.map(c => { const cat = cats.find(x => x.id === c.categoryId);
          return <button className="row" key={c.name} data-testid="cp-row" onClick={() => c.name !== '_none' && setPick(c)}>
            <div className="grow"><div className="ell">{c.display}</div><div className="sub">{c.count} {plural(c.count)} · {cat ? cat.name : <span className="chip warn">выбрать категорию</span>}</div><div className="bar"><i style={{ width: `${total ? (c.sum / total) * 100 : 0}%` }} /></div></div>
            <span className="amt">{fmt(c.sum)}</span></button>; })}</div>
      </>}
    </>}
    {pick && <PickCategory cp={pick} dir={dir} cats={cats} onClose={() => setPick(null)} />}
  </>;
}
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'операция' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'операции' : 'операций');

function PickCategory({ cp, dir, cats, onClose }: { cp: { name: string; display: string; categoryId: string | null }; dir: 'in' | 'out'; cats: Cat[]; onClose: () => void }) {
  const [err, setErr] = useState('');
  async function choose(id: string | null) {
    try {
      const list = (await api('GET', '/api/counterparties')).counterparties as Array<{ id: string; name_norm: string }>;
      const row = list.find(x => x.name_norm === cp.name); if (!row) throw new Error('Контрагент не найден');
      await api('PUT', `/api/counterparties/${row.id}`, dir === 'in' ? { categoryInId: id } : { categoryOutId: id }); bump(); onClose();
    } catch (e) { setErr((e as Error).message); }
  }
  return <Sheet title={`Куда отнести «${cp.display}»?`} onClose={onClose}>
    <div className="group">{cats.filter(c => c.type === (dir === 'in' ? 'income' : 'expense')).map(c => <button className="row" key={c.id} onClick={() => choose(c.id)}><span className="dot" style={{ background: c.color }} /><span className="grow">{c.name}</span>{cp.categoryId === c.id && '✓'}</button>)}</div>
    {cp.categoryId && <button className="btn sec" style={{ marginTop: 12 }} onClick={() => choose(null)}>Снять привязку</button>}
    {err && <div className="err">{err}</div>}
  </Sheet>;
}

// ---------- Ещё ----------
type Sub = null | 'cats' | 'keys' | 'devices' | 'import' | 'sync' | 'password' | 'theme' | 'profile';
export function More({ onImported, onViewFeed }: { onImported?: (n:number)=>void; onViewFeed?:()=>void } = {}) {
  const { name, login } = useAppState(); const [sub, setSub] = useState<Sub>(null); const [lerr, setLerr] = useState('');
  if (sub) return <><button className="back" onClick={() => setSub(null)}>‹ Ещё</button>{{ profile:<FinancialProfileScreen/>, cats: <Categories />, keys: <Keys />, devices: <Devices />, import: <Import onImported={onImported} onViewFeed={onViewFeed} />, sync: <Sync />, password: <Password />, theme: <Theme /> }[sub]}</>;
  const item = (s: Sub, label: string, hint?: string) => <button className="row" onClick={() => setSub(s)}><span className="grow">{label}</span><span className="sub">{hint}</span><span className="sub">›</span></button>;
  return <>
    <h1>Ещё</h1>
    <div className="group"><div className="row"><div className="grow"><div>{name}</div><div className="sub">{login}</div></div></div></div>
    <h2>Мои финансы</h2><div className="group">{item('profile','Финансовый профиль','Счета, доходы, цели')}</div>
    <h2>Данные</h2>
    <div className="group">{item('import', 'Загрузить выписку')}{item('cats', 'Категории и правила')}<a className="row" href="/api/export.csv" download style={{ textDecoration: 'none' }}><span className="grow">Экспорт CSV</span><span className="sub">›</span></a></div>
    <h2>Интеграции</h2><div className="group">{item('keys', 'Быстрые команды (ключи)')}</div>
    <h2>Приложение</h2><div className="group">{item('sync', 'Синхронизация')}{item('theme', 'Тема')}</div>
    <h2>Безопасность</h2><div className="group">{item('devices', 'Устройства')}{item('password', 'Сменить пароль')}</div>
    <div style={{ marginTop: 24 }}>{lerr && <div className="err" role="alert">{lerr}</div>}<button className="btn danger" onClick={async () => setLerr((await doLogout()) ?? '')}>Выйти</button></div>
  </>;
}

function Theme() {
  const [t, setT] = useState(savedTheme());
  return <><h1>Тема</h1><div className="group">{[['system', 'Как в системе'], ['dark', 'Тёмная (OLED)'], ['light', 'Светлая']].map(([k, l]) => <button className="row" key={k} onClick={() => { applyTheme(k); setT(k); }}><span className="grow">{l}</span>{t === k && '✓'}</button>)}</div></>;
}

function Categories() {
  const { cats } = useAppState(); const [type, setType] = useState<'expense' | 'income'>('expense'); const [edit, setEdit] = useState<Cat | 'new' | null>(null);
  const [rules, setRules] = useState<any[]>([]);
  const loadRules = () => api('GET', '/api/rules').then(r => setRules(r.rules));
  useEffect(() => { loadRules(); }, []);
  return <>
    <h1>Категории</h1>
    <div className="seg"><button className={type === 'expense' ? 'on' : ''} onClick={() => setType('expense')}>Расходы</button><button className={type === 'income' ? 'on' : ''} onClick={() => setType('income')}>Доходы</button></div>
    <div className="group">{cats.filter(c => c.type === type).map(c => <button className="row" key={c.id} onClick={() => setEdit(c)}><span className="dot" style={{ background: c.color }} /><span className="grow">{c.name}</span><span className="sub">›</span></button>)}</div>
    <button className="btn sec" style={{ marginTop: 12 }} onClick={() => setEdit('new')}>Добавить категорию</button>
    <h2>Правила по тексту</h2>
    <div className="group">{rules.map(r => <div className="row" key={r.id}><div className="grow"><div>«{r.pattern}»</div><div className="sub">{r.direction === 'in' ? 'доход' : r.direction === 'out' ? 'расход' : 'любое'} → {cats.find(c => c.id === r.categoryId)?.name ?? '—'}</div></div><button className="btn small danger" onClick={async () => { await api('DELETE', `/api/rules/${r.id}`); loadRules(); bump(); }}>Удалить</button></div>)}{!rules.length && <div className="row muted">Правил нет. Правило «ТОО Ромашка → Зарплата» сразу разнесёт все такие поступления.</div>}</div>
    <RuleForm cats={cats} onAdded={() => { loadRules(); bump(); }} />
    {edit && <CatSheet cat={edit === 'new' ? null : edit} type={type} onClose={() => setEdit(null)} />}
  </>;
}
function RuleForm({ cats, onAdded }: { cats: Cat[]; onAdded: () => void }) {
  const [pattern, setPattern] = useState(''); const [dir, setDir] = useState<'in' | 'out' | 'any'>('in'); const [cat, setCat] = useState(''); const [err, setErr] = useState('');
  const opts = cats.filter(c => dir === 'any' || c.type === (dir === 'in' ? 'income' : 'expense'));
  return <div style={{ marginTop: 12 }}>
    <Field label="Новое правило: если в тексте есть…"><input aria-label="Шаблон правила" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="например: зарплата" /></Field>
    <div style={{ display: 'flex', gap: 8 }}><select aria-label="Направление правила" value={dir} onChange={e => { setDir(e.target.value as any); setCat(''); }}><option value="in">доход</option><option value="out">расход</option><option value="any">любое</option></select>
      <select aria-label="Категория правила" value={cat} onChange={e => setCat(e.target.value)}><option value="">Категория…</option>{opts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    {err && <div className="err">{err}</div>}
    <button className="btn sec" style={{ marginTop: 8 }} disabled={!pattern || !cat} onClick={async () => { try { await api('POST', '/api/rules', { pattern, direction: dir, categoryId: cat }); setPattern(''); setErr(''); onAdded(); } catch (e) { setErr((e as Error).message); } }}>Добавить правило</button>
  </div>;
}
const COLORS = ['#34c759', '#ff9f0a', '#0a84ff', '#5e5ce6', '#ff453a', '#bf5af2', '#64d2ff', '#ffd60a', '#ff375f', '#8e8e93'];
function CatSheet({ cat, type, onClose }: { cat: Cat | null; type: 'expense' | 'income'; onClose: () => void }) {
  const [name, setName] = useState(cat?.name ?? ''); const [color, setColor] = useState(cat?.color ?? COLORS[2]); const [err, setErr] = useState('');
  async function save() { try { if (cat) await api('PATCH', `/api/categories/${cat.id}`, { name, color }); else await api('POST', '/api/categories', { name, type, color }); await loadCats(); bump(); onClose(); } catch (e) { setErr((e as Error).message); } }
  async function remove() { if (!confirm('Удалить категорию? Записи останутся, но станут «без категории».')) return; try { await api('DELETE', `/api/categories/${cat!.id}`); await loadCats(); bump(); onClose(); } catch (e) { setErr((e as Error).message); } }
  return <Sheet title={cat ? 'Категория' : 'Новая категория'} onClose={onClose}>
    <Field label="Название"><input aria-label="Название категории" value={name} onChange={e => setName(e.target.value)} /></Field>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '4px 0 16px' }}>{COLORS.map(c => <button key={c} aria-label={'Цвет ' + c} onClick={() => setColor(c)} style={{ width: 32, height: 32, borderRadius: 16, background: c, border: color === c ? '3px solid var(--fg)' : '3px solid transparent', cursor: 'pointer' }} />)}</div>
    {err && <div className="err" role="alert">{err}</div>}
    <button className="btn" disabled={!name.trim()} onClick={save}>Сохранить</button>
    {cat && <button className="btn danger" style={{ marginTop: 8 }} onClick={remove}>Удалить</button>}
  </Sheet>;
}

function Keys() {
  const [keys, setKeys] = useState<any[]>([]); const [label, setLabel] = useState(''); const [scope, setScope] = useState<'write' | 'read'>('write'); const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null); const [err, setErr] = useState('');
  const load = () => api('GET', '/api/keys').then(r => setKeys(r.keys)).catch(e => setErr(e.message)); useEffect(() => { load(); }, []);
  async function create() { try { const r = await api('POST', '/api/keys', { label, scope }); setFresh({ key: r.key, label: r.label }); setLabel(''); load(); } catch (e) { setErr((e as Error).message); } }
  return <>
    <h1>Быстрые команды</h1>
    <p className="muted">Ключ вставляется в приложение «Команды». «Запись» умеет только добавлять записи, «Чтение» — только получать сводку. Ключ показывается один раз.</p>
    <div className="group">{keys.filter(k => !k.revoked_at).map(k => <div className="row" key={k.id}><div className="grow"><div>{k.label} <span className="chip">{k.scope === 'write' ? 'запись' : 'чтение'}</span></div><div className="sub">{k.prefix}… · {k.last_used_at ? 'использован ' + new Date(k.last_used_at).toLocaleString('ru-RU') : 'не использовался'}</div></div>
      <button className="btn small danger" onClick={async () => { await api('DELETE', `/api/keys/${k.id}`); load(); }}>Отозвать</button></div>)}{!keys.some(k => !k.revoked_at) && <div className="row muted">Ключей пока нет</div>}</div>
    <h2>Новый ключ</h2>
    <Field label="Метка"><input aria-label="Метка ключа" value={label} onChange={e => setLabel(e.target.value)} placeholder="Например: iPhone, кнопка действия" /></Field>
    <div className="seg"><button className={scope === 'write' ? 'on' : ''} onClick={() => setScope('write')}>Запись</button><button className={scope === 'read' ? 'on' : ''} onClick={() => setScope('read')}>Чтение</button></div>
    {err && <div className="err" role="alert">{err}</div>}
    <button className="btn" disabled={!label.trim()} onClick={create}>Создать ключ</button>
    {fresh && <Sheet title={`Ключ «${fresh.label}»`} onClose={() => setFresh(null)}><p className="muted">Скопируйте сейчас — позже его не показать.</p><div className="group" style={{ padding: 14 }}><div className="mono" data-testid="new-key">{fresh.key}</div></div>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => navigator.clipboard?.writeText(fresh.key).catch(() => {})}>Скопировать</button></Sheet>}
  </>;
}

function Devices() {
  const [d, setD] = useState<{ devices: any[]; current: string } | null>(null); const [err, setErr] = useState('');
  const load = () => api('GET', '/api/devices').then(setD).catch(e => setErr(e.message)); useEffect(() => { load(); }, []);
  return <><h1>Устройства</h1>{err && <div className="err">{err}</div>}<div className="group">{d?.devices.map(x => <div className="row" key={x.id}><div className="grow"><div>{x.device_label}{x.id === d.current && <span className="chip" style={{ marginLeft: 8 }}>это устройство</span>}</div><div className="sub">активен {new Date(x.last_seen_at).toLocaleString('ru-RU')}</div></div>
    {x.id !== d.current && <button className="btn small danger" onClick={async () => { await api('DELETE', `/api/devices/${x.id}`); load(); }}>Отозвать</button>}</div>)}</div></>;
}

function Password() {
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  return <><h1>Пароль</h1>
    <Field label="Текущий пароль"><input aria-label="Текущий пароль" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} /></Field>
    <Field label="Новый пароль (от 10 символов)"><input aria-label="Новый пароль" type="password" autoComplete="new-password" value={nw} onChange={e => setNw(e.target.value)} /></Field>
    {err && <div className="err" role="alert">{err}</div>}{msg && <div className="ok" role="status">{msg}</div>}
    <button className="btn" disabled={!cur || nw.length < 10} onClick={async () => { setErr(''); setMsg(''); try { await api('POST', '/api/auth/password', { current: cur, next: nw }); setMsg('Пароль изменён, другие устройства вышли'); setCur(''); setNw(''); } catch (e) { setErr((e as Error).message); } }}>Сменить пароль</button></>;
}

function Sync() {
  const st = useSyncExternalStore(subscribeQueue, getQueueStatus); const { login } = useAppState(); const [items, setItems] = useState<any[]>([]);
  useEffect(() => { if (login) listQueue(login).then(setItems); }, [login, st.count, st.failed]);
  const fmtT = (t: number | null) => (t ? new Date(t).toLocaleTimeString('ru-RU') : '—');
  return <><h1>Синхронизация</h1><div className="group">
    <div className="row"><span className="grow">Сеть</span><b>{st.online ? 'онлайн' : 'офлайн'}</b></div>
    <div className="row"><span className="grow">В очереди</span><b data-testid="q-count">{st.count}</b></div>
    <div className="row"><span className="grow">Не принято сервером</span><b>{st.failed}</b></div>
    <div className="row"><span className="grow">Последняя попытка</span><b>{fmtT(st.lastAttemptAt)}</b></div>
    <div className="row"><span className="grow">Результат</span><b data-testid="q-result" style={{ textAlign: 'right' }}>{st.lastResult}</b></div>
    <div className="row"><span className="grow">Следующая попытка</span><b>{fmtT(st.nextAttemptAt)}</b></div>
    {pauseRemainingSec() > 0 && <div className="row"><span className="grow">Пауза сервера</span><b>{pauseRemainingSec()} с</b></div>}
  </div>
  {items.map(i => <div className="banner" key={i.id}>{i.payload.counterparty || 'запись'} — {fmt(i.payload.amountMinor)}: {i.lastError ?? 'ждёт отправки'}</div>)}
  <button className="btn" style={{ marginTop: 16 }} disabled={!st.count} onClick={() => login && (st.failed ? retryFailed(login) : flush(login))}>Отправить сейчас</button>
  <p className="muted">Фоновой отправки на iPhone нет: очередь уходит при открытии приложения и возвращении сети. Быстрые команды отправляют данные сами.</p></>;
}

// ---------- Импорт CSV ----------
const GUESS: Record<string, RegExp> = { date: /дата|date/i, amount: /сумма|amount|итого/i, cp: /получател|отправител|контрагент|merchant|название|наименование|recipient|counterparty/i, note: /назначен|описан|детал|комментар|details|description|операц/i };
export function Import({ onImported, onViewFeed }: { onImported?: (n:number)=>void; onViewFeed?:()=>void } = {}) {
  const {financialProfile}=useAppState();
  const [profiles, setProfiles] = useState<Array<{id: string; title: string; ready: boolean}>>([]);
  const [bank, setBank] = useState(()=>financialProfile?.profile?.accounts.map(a=>a.bank.toLowerCase()).find(b=>['kaspi','halyk','freedom'].includes(b))??'kaspi');
  useEffect(() => { api('GET', '/api/import/profiles').then(r => setProfiles(r.profiles)).catch(e => setErr(e.message)); }, []);
  const [file, setFile] = useState<{ name: string; text: string; header: string[]; delim: string; pdfBase64?: string } | null>(null);
  const [m, setM] = useState<{ date: number; amount: number; cp: number; note: number; mode: 'signed' | 'split' | 'dir'; debit: number; credit: number; dirCol: number; inV: string; outV: string }>({ date: 0, amount: 1, cp: -1, note: -1, mode: 'signed', debit: -1, credit: -1, dirCol: -1, inV: '', outV: '' });
  const [rep, setRep] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function pick(f: File | undefined) {
    if (!f) return; setRep(null); setErr(''); setFile(null);
    if (f.size > 2 * 1024 * 1024) { setErr('Файл не больше 2 МБ'); return; }
    if (bank !== 'generic') {
      const bytes = new Uint8Array(await f.arrayBuffer()); let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      setFile({ name: f.name, text: '', header: [], delim: ';', pdfBase64: btoa(binary) }); return;
    }
    if (/\.pdf$/i.test(f.name)) { setErr('Для PDF выберите банк'); return; }
    const buf = await f.arrayBuffer(); let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf);
    text = text.replace(/^﻿/, ''); const first = text.split(/\r?\n/)[0] ?? '';
    const delim = [';', ',', '\t'].map(d => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
    const header = first.split(delim).map(h => h.replace(/^"|"$/g, '').trim());
    const find = (re: RegExp) => header.findIndex(h => re.test(h));
    setM(x => ({ ...x, date: Math.max(find(GUESS.date), 0), amount: Math.max(find(GUESS.amount), 0), cp: find(GUESS.cp), note: find(GUESS.note) }));
    setFile({ name: f.name, text, header, delim });
  }
  const body = (dryRun: boolean) => ({ bank, pdfBase64: file!.pdfBase64, csv: file!.text, filename: file!.name, dryRun, mapping: { delimiter: file!.delim, hasHeader: true, dateCol: m.date, counterpartyCol: m.cp >= 0 ? m.cp : undefined, noteCol: m.note >= 0 ? m.note : undefined,
    ...(m.mode === 'signed' ? { amountCol: m.amount } : m.mode === 'split' ? { debitCol: m.debit >= 0 ? m.debit : undefined, creditCol: m.credit >= 0 ? m.credit : undefined } : { amountCol: m.amount, directionCol: m.dirCol, inValues: m.inV.split(',').map(s => s.trim()).filter(Boolean), outValues: m.outV.split(',').map(s => s.trim()).filter(Boolean) }) } });
  async function run(dry: boolean) { setBusy(true); setErr(''); try { const r = await api('POST', '/api/import', body(dry)); setRep(r); if (!dry) { bump(); onImported?.(r.imported); } } catch (e) { setErr((e as ApiError).message); } finally { setBusy(false); } }
  const sel = (label: string, key: 'date' | 'amount' | 'cp' | 'note' | 'debit' | 'credit' | 'dirCol', optional = false) => <Field label={label}><select aria-label={label} value={m[key]} onChange={e => setM({ ...m, [key]: Number(e.target.value) })}>{optional && <option value={-1}>— нет —</option>}{file!.header.map((h, i) => <option key={i} value={i}>{h || `Колонка ${i + 1}`}</option>)}</select></Field>;
  return <>
    <div className="screen-kicker">ИМПОРТ ОПЕРАЦИЙ</div><h1>Выписка</h1><div className="import-hero" aria-hidden="true">↥</div>
    <p className="muted">Каждая строка файла попадёт в отчёт: добавлена, пропущена как повтор или отклонена с причиной. Halyk, Kaspi и Freedom: PDF с текстовым слоем. Для других файлов — универсальный CSV. За один раз — до 1000 строк (у Freedom многострочная операция считается одной строкой). Большую выписку разделите по датам, не разбивая операции одного дня.</p>
    <fieldset className="bank-fieldset" aria-label="Банк" disabled={busy}>
      <legend>Выберите банк · PDF</legend>
      <div className="bank-cards">{['halyk','kaspi','freedom'].map(id=>{
        const profile=profiles.find(p=>p.id===id&&p.ready);if(!profile)return null;
        const title=id==='halyk'?'Halyk':id==='kaspi'?'Kaspi':'Freedom';
        return <label key={id} className={'bank-card '+id+(bank===id?' selected':'')}><input type="radio" name="statement-bank" aria-label={title+' PDF'} value={id} checked={bank===id} onChange={()=>{setBank(id);setFile(null);setRep(null);setErr('');}}/><span className="bank-mark" aria-hidden="true">{title[0]}</span><strong>{title}</strong><small>PDF</small></label>;
      })}</div>
      <label className="generic-format"><input type="radio" name="statement-bank" aria-label="Универсальный CSV" checked={bank==='generic'} onChange={()=>{setBank('generic');setFile(null);setRep(null);setErr('');}}/>Универсальный CSV</label>
    </fieldset>
    {bank!=='generic'&&<a className="sample-download" href={'/examples/'+bank+'.pdf'} download>Скачать пример {bank==='halyk'?'Halyk':bank==='kaspi'?'Kaspi':'Freedom'} PDF · вымышленные данные</a>}
    {err&&!file&&<div className="err" role="alert">{err}</div>}
    <input disabled={busy} className="statement-file" key={bank} aria-label="Файл выписки" type="file" accept={bank === 'generic' ? ' .csv,.txt,text/csv'.trim() : '.pdf,application/pdf'} onChange={e => pick(e.target.files?.[0])} />
    {file && <>
      {bank === 'generic' && <><h2>Колонки</h2>{sel('Дата', 'date')}
      <div className="seg"><button className={m.mode === 'signed' ? 'on' : ''} onClick={() => setM({ ...m, mode: 'signed' })}>Сумма со знаком</button><button className={m.mode === 'split' ? 'on' : ''} onClick={() => setM({ ...m, mode: 'split' })}>Две колонки</button><button className={m.mode === 'dir' ? 'on' : ''} onClick={() => setM({ ...m, mode: 'dir' })}>Колонка типа</button></div>
      {m.mode === 'split' ? <>{sel('Списание (расход)', 'debit', true)}{sel('Зачисление (доход)', 'credit', true)}</> : sel('Сумма', 'amount')}
      {m.mode === 'dir' && <>{sel('Колонка типа операции', 'dirCol')}<Field label="Значения дохода (через запятую)"><input aria-label="Значения дохода" value={m.inV} onChange={e => setM({ ...m, inV: e.target.value })} /></Field><Field label="Значения расхода (через запятую)"><input aria-label="Значения расхода" value={m.outV} onChange={e => setM({ ...m, outV: e.target.value })} /></Field></>}
      {sel('Получатель / отправитель', 'cp', true)}{sel('Описание', 'note', true)}</>}
      {err && <div className="err" role="alert">{err}</div>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn sec" disabled={busy} onClick={() => run(true)}>Проверить</button><button className="btn" disabled={busy} onClick={() => run(false)}>Импортировать</button></div>
    </>}
    {busy && <div className="parsing-state" role="status"><span className="spinner"/>Разбираем файл и проверяем операции…</div>}
    {rep && <><h2>{rep.dryRun ? 'Проверка (ничего не записано)' : 'Готово'}</h2>
      <div className="group" data-testid="import-report"><div className="row"><span className="grow">Всего строк</span><b>{rep.total}</b></div><div className="row"><span className="grow">{rep.dryRun ? 'Будет добавлено' : 'Добавлено'}</span><b>{rep.imported}</b></div><div className="row"><span className="grow">Уже были (повторы)</span><b>{rep.duplicates}</b></div><div className="row"><span className="grow">Отклонено</span><b>{rep.rejected}</b></div></div>
      {rep.rows.filter((r: any) => r.status !== 'imported').slice(0, 100).map((r: any) => <div className="banner" key={r.line}>Строка {r.line}: {r.status === 'duplicate' ? 'повтор' : r.reason}<div className="sub ell">{r.preview}</div></div>)}
      {!rep.dryRun && onViewFeed && <button className="btn sec" style={{marginBottom:16}} onClick={onViewFeed}>Посмотреть в Ленте</button>}
      {!rep.dryRun && rep.newCounterparties.length > 0 && <div className="banner">Новых получателей без категории: {rep.newCounterparties.length}. Назначьте категории в «Отчётах».</div>}</>}
  </>;
}
