import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { enqueue, listQueue, removeFromQueue, startQueue, sealQueue, unsealQueue, type QItem } from './queue';
import { Field, Sheet, bump, dayLabel, fmt, getState, loadCats, setState, todayStr, useAppState, catMap, type Cat } from './ui';

// ---------- Вход ----------
export function Login() {
  const [accounts, setAccounts] = useState<Array<{ login: string; name: string }>>([]);
  const [login, setLogin] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('GET', '/api/accounts').then(r => { setAccounts(r.accounts); setLogin(r.accounts[0]?.login ?? ''); }).catch(e => setErr(e.message)); }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await api('POST', '/api/auth/login', { login, password: pw, device: deviceLabel() });
      await unsealQueue(login, r.queueKey);
      await afterLogin();
    } catch (x) { setErr((x as ApiError).message + ((x as ApiError).retryAfter ? ` (через ${Math.ceil((x as ApiError).retryAfter / 60)} мин)` : '')); } finally { setBusy(false); }
  }
  return <div className="app" style={{ paddingBottom: 24 }}>
    <h1 style={{ marginTop: 56 }}>Қаржы</h1><p className="muted" style={{ marginTop: -8 }}>Войдите в свой аккаунт</p>
    <form onSubmit={submit}>
      <Field label="Аккаунт"><select aria-label="Аккаунт" value={login} onChange={e => setLogin(e.target.value)}>{accounts.map(a => <option key={a.login} value={a.login}>{a.name}</option>)}</select></Field>
      <Field label="Пароль"><input aria-label="Пароль" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></Field>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn" disabled={busy || !login || !pw}>{busy ? 'Входим…' : 'Войти'}</button>
    </form>
  </div>;
}
const deviceLabel = () => /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Android/.test(navigator.userAgent) ? 'Android' : 'Браузер';
export async function afterLogin() {
  const me = await api('GET', '/api/me');
  setState({ login: me.login, name: me.name, queueKey: me.queueKey, ready: true });
  await loadCats(); startQueue(me.login);
}
/** Выход возможен только онлайн: cookie HttpOnly, очистить её может лишь сервер. Иначе сессия осталась бы жива. */
export async function doLogout(): Promise<string | null> {
  const { login, queueKey } = getState();
  try { await api('POST', '/api/auth/logout', {}); } catch (e) {
    if ((e as ApiError).status === 0) return 'Нет связи: выйти можно только при подключении к сети';
  }
  if (login) { try { await sealQueue(login, queueKey); } catch {} }
  setState({ login: null, name: '', queueKey: '', cats: [] });
  return null;
}

// ---------- Лента ----------
interface Entry { id: string; occurredAt: number; version: number; payload: { direction: 'in' | 'out'; amountMinor: number; counterparty: string; note?: string; categoryId?: string | null }; effectiveCategoryId: string | null }

export function Feed() {
  const { cats, login, version } = useAppState(); const cm = useMemo(() => catMap(cats), [cats]);
  const [items, setItems] = useState<Entry[]>([]); const [next, setNext] = useState<any>(null); const [q, setQ] = useState('');
  const [pending, setPending] = useState<QItem[]>([]); const [err, setErr] = useState(''); const [edit, setEdit] = useState<Entry | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(async (append = false) => {
    try {
      const p = new URLSearchParams({ limit: '50' }); if (q) p.set('q', q);
      if (append && next) { p.set('beforeTime', next.beforeTime); p.set('beforeId', next.beforeId); }
      const r = await api('GET', '/api/entries?' + p);
      setItems(prev => append ? [...prev, ...r.items] : r.items); setNext(r.next); setErr('');
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [q, next]);
  useEffect(() => { const t = setTimeout(() => load(false), q ? 250 : 0); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, version]);
  useEffect(() => { if (login) listQueue(login).then(setPending); }, [login, version, items]);
  const groups = useMemo(() => { const g = new Map<string, Entry[]>(); for (const e of items) { const k = dayLabel(e.occurredAt); (g.get(k) ?? g.set(k, []).get(k)!).push(e); } return [...g]; }, [items]);
  return <>
    <h1>Лента</h1>
    <input aria-label="Поиск" type="search" placeholder="Поиск по получателю и заметке" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 12 }} />
    {err && <div className="banner" role="alert">{err}</div>}
    {pending.length > 0 && <><h2>Ждут отправки ({pending.length})</h2><div className="group">{pending.map(p => <div className="row" key={p.id}>
      <div className="grow"><div className="ell">{p.payload.counterparty || 'Без получателя'}</div><div className="sub">{p.status === 'failed' ? `Не принято: ${p.lastError}` : 'Отправится при появлении сети'}</div></div>
      <span className={'amt ' + p.payload.direction}>{p.payload.direction === 'in' ? '+' : '−'}{fmt(p.payload.amountMinor)}</span>
      {p.status === 'failed' && <button className="btn small danger" onClick={async () => { await removeFromQueue(p.login, p.id); bump(); }}>Убрать</button>}
    </div>)}</div></>}
    {!loading && !items.length && !pending.length && <div className="empty">Пока нет записей.<br />Нажмите «Добавить» или загрузите выписку в разделе «Ещё».</div>}
    {groups.map(([day, list]) => <section key={day}><h2>{day}</h2><div className="group">{list.map(e => {
      const c = cm.get(e.effectiveCategoryId ?? ''); const p = e.payload;
      return <button className="row" key={e.id} onClick={() => setEdit(e)} aria-label={`${p.counterparty || 'Без получателя'} ${fmt(p.amountMinor)}`}>
        <span className="dot" style={{ background: c?.color ?? 'var(--bg3)' }} />
        <div className="grow"><div className="ell">{p.counterparty || p.note || 'Без получателя'}</div><div className="sub ell">{c ? c.name : <span className="chip warn">без категории</span>}{p.note && p.counterparty ? ' · ' + p.note : ''}</div></div>
        <span className={'amt ' + p.direction}>{p.direction === 'in' ? '+' : '−'}{fmt(p.amountMinor)}</span>
      </button>;
    })}</div></section>)}
    {next && <button className="btn sec" style={{ marginTop: 16 }} onClick={() => load(true)}>Показать ещё</button>}
    {edit && <EditSheet e={edit} cats={cats} onClose={() => setEdit(null)} />}
  </>;
}

function EditSheet({ e, cats, onClose }: { e: Entry; cats: Cat[]; onClose: () => void }) {
  const p = e.payload;
  const [dir, setDir] = useState(p.direction); const [amount, setAmount] = useState(String(p.amountMinor / 100)); const [cp, setCp] = useState(p.counterparty);
  const [cat, setCat] = useState(p.categoryId ?? ''); const [note, setNote] = useState(p.note ?? ''); const [date, setDate] = useState(new Date(e.occurredAt).toISOString().slice(0, 10));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const opts = cats.filter(c => c.type === (dir === 'in' ? 'income' : 'expense'));
  async function save() {
    setBusy(true); setErr('');
    try { await api('PATCH', `/api/entries/${e.id}`, { version: e.version, direction: dir, amount, counterparty: cp, categoryId: cat || null, note, occurredAt: date === new Date(e.occurredAt).toISOString().slice(0, 10) ? e.occurredAt : date }); bump(); onClose(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  async function remove() { if (!confirm('Удалить запись?')) return; try { await api('DELETE', `/api/entries/${e.id}`); bump(); onClose(); } catch (x) { setErr((x as Error).message); } }
  return <Sheet title="Запись" onClose={onClose}>
    <div className="seg"><button className={dir === 'out' ? 'on' : ''} onClick={() => { setDir('out'); setCat(''); }}>Расход</button><button className={dir === 'in' ? 'on' : ''} onClick={() => { setDir('in'); setCat(''); }}>Доход</button></div>
    <Field label="Сумма, ₸"><input aria-label="Сумма" inputMode="decimal" value={amount} onChange={x => setAmount(x.target.value)} /></Field>
    <Field label="Получатель / отправитель"><input aria-label="Получатель" value={cp} onChange={x => setCp(x.target.value)} /></Field>
    <Field label="Категория"><select aria-label="Категория" value={cat} onChange={x => setCat(x.target.value)}><option value="">Автоматически (по получателю)</option>{opts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
    <Field label="Дата"><input aria-label="Дата" type="date" value={date} onChange={x => setDate(x.target.value)} /></Field>
    <Field label="Заметка"><input aria-label="Заметка" value={note} onChange={x => setNote(x.target.value)} /></Field>
    {err && <div className="err" role="alert">{err}</div>}
    <button className="btn" onClick={save} disabled={busy}>Сохранить</button>
    <button className="btn danger" style={{ marginTop: 8 }} onClick={remove}>Удалить</button>
  </Sheet>;
}

// ---------- Добавить ----------
export function Add({ onDone }: { onDone: () => void }) {
  const { cats, login } = useAppState();
  const [dir, setDir] = useState<'out' | 'in'>('out'); const [amount, setAmount] = useState(''); const [cp, setCp] = useState(''); const [cat, setCat] = useState('');
  const [note, setNote] = useState(''); const [date, setDate] = useState(todayStr()); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [names, setNames] = useState<string[]>([]); const amtRef = useRef<HTMLInputElement>(null);
  useEffect(() => { api('GET', '/api/counterparties').then(r => setNames(r.counterparties.map((c: any) => c.display))).catch(() => {}); }, []);
  const opts = cats.filter(c => c.type === (dir === 'in' ? 'income' : 'expense'));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const norm = amount.replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(norm) || Number(norm) <= 0) { setErr('Введите сумму больше нуля'); return; }
    const payload: any = { id: crypto.randomUUID(), direction: dir, amountMinor: Math.round(Number(norm) * 100), counterparty: cp.trim(), categoryId: cat || null, note: note.trim(), occurredAt: date === todayStr() ? Date.now() : date };
    await enqueue(login!, payload); // сначала в очередь (IndexedDB), потом отправка: запись не потеряется при обрыве
    setMsg('Сохранено'); setAmount(''); setCp(''); setNote(''); setCat(''); bump();
    setTimeout(onDone, 350);
  }
  return <>
    <h1>Добавить</h1>
    <form onSubmit={save}>
      <div className="seg"><button type="button" className={dir === 'out' ? 'on' : ''} onClick={() => { setDir('out'); setCat(''); }}>Расход</button><button type="button" className={dir === 'in' ? 'on' : ''} onClick={() => { setDir('in'); setCat(''); }}>Доход</button></div>
      <input ref={amtRef} className="big" aria-label="Сумма" inputMode="decimal" placeholder="0 ₸" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
      <Field label={dir === 'out' ? 'Кому / где' : 'От кого'}><input aria-label="Получатель" list="cps" value={cp} onChange={e => setCp(e.target.value)} placeholder="Например: ИП Мирас" /><datalist id="cps">{names.slice(0, 200).map(n => <option key={n} value={n} />)}</datalist></Field>
      <Field label="Категория"><select aria-label="Категория" value={cat} onChange={e => setCat(e.target.value)}><option value="">Автоматически (по получателю)</option>{opts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Дата"><input aria-label="Дата" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="Заметка"><input aria-label="Заметка" value={note} onChange={e => setNote(e.target.value)} /></Field>
      {err && <div className="err" role="alert">{err}</div>}{msg && <div className="ok" role="status">{msg}</div>}
      <button className="btn">Сохранить</button>
    </form>
  </>;
}
