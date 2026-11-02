import { MAX_NOTE_LENGTH } from '../../shared/types';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from './api';
import { enqueue, listQueue, removeFromQueue, startQueue, sealQueue, unsealQueue, subscribeQueue, getQueueStatus, type QItem } from './queue';
import { Field, Sheet, bump, dayLabel, fmt, getState, loadCats, setState, todayStr, useAppState, catMap, Icons, inputMinor, normName, thisMonth, monthLabel, type Cat } from './ui';

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
  const [financialProfile,categories]=await Promise.all([api('GET','/api/financial-profile'),api('GET','/api/categories')]);
  setState({ login: me.login, name: me.name, queueKey: me.queueKey, financialProfile, cats:categories.categories, onboardingRequired:['new','draft'].includes(financialProfile.status), ready: true });
  startQueue(me.login);
}
/** Выход возможен только онлайн: cookie HttpOnly, очистить её может лишь сервер. Иначе сессия осталась бы жива. */
export async function doLogout(): Promise<string | null> {
  const { login, queueKey } = getState();
  try { await api('POST', '/api/auth/logout', {}); } catch (e) {
    if ((e as ApiError).status === 0) return 'Нет связи: выйти можно только при подключении к сети';
  }
  if (login) { try { await sealQueue(login, queueKey); } catch {} }
  setState({ login: null, name: '', queueKey: '', cats: [], financialProfile:null, onboardingRequired:false });
  return null;
}

// ---------- Лента ----------
interface Entry { id: string; occurredAt: number; version: number; payload: { direction: 'in' | 'out'; amountMinor: number; counterparty: string; note?: string; categoryId?: string | null }; effectiveCategoryId: string | null }

export function Feed({ onImport }: {onImport:()=>void}) {
  const queueStatus=useSyncExternalStore(subscribeQueue,getQueueStatus);
  const { cats, login, version } = useAppState(); const cm = useMemo(() => catMap(cats), [cats]);
  const [items, setItems] = useState<Entry[]>([]); const [next, setNext] = useState<any>(null); const [q, setQ] = useState('');
  const [filter,setFilter]=useState<'all'|'out'|'in'|'auto'>('all');
  const [summary,setSummary]=useState<{in:number;out:number;net:number}|null>(null);
  useEffect(()=>{let active=true;api('GET','/api/reports/summary?month='+thisMonth()).then(r=>{if(active)setSummary(r.totals);}).catch(()=>{});return ()=>{active=false;};},[version,queueStatus.count]);
  const [pending, setPending] = useState<QItem[]>([]); const [err, setErr] = useState(''); const [edit, setEdit] = useState<Entry | null>(null); const [loading, setLoading] = useState(true);
  const generation=useRef(0);
  const load = useCallback(async (append = false) => {
    const current=++generation.current;setLoading(true);
    try {
      let cursor=append?next:null;
      let visible:Entry[]=[], following:any=null;
      do {
        const p=new URLSearchParams({limit:'50'});if(q)p.set('q',q);
        if(cursor){p.set('beforeTime',cursor.beforeTime);p.set('beforeId',cursor.beforeId);}
        const r=await api('GET','/api/entries?'+p);
        if(current!==generation.current)return;
        visible=r.items.filter((e:Entry)=>filter==='auto'?!e.payload.categoryId&&!!e.effectiveCategoryId:filter==='all'||e.payload.direction===filter);
        following=r.next;cursor=r.next;
        // Finite pagination triggered by the filter, never timer polling.
      }while(!visible.length&&cursor);
      setItems(prev=>append?[...prev,...visible]:visible);setNext(following);setErr('');
    }catch(e){if(current===generation.current)setErr((e as Error).message);}
    finally{if(current===generation.current)setLoading(false);}
  },[q,next,filter]);
  useEffect(()=>{const t=setTimeout(()=>load(false),q?250:0);return ()=>{clearTimeout(t);generation.current++;};},[q,version,filter,queueStatus.count]);
  useEffect(() => { if (login) listQueue(login).then(setPending); }, [login, version, items, queueStatus.count]);
  const groups = useMemo(() => { const g = new Map<string, Entry[]>(); for (const e of items) { if(filter==='auto' ? !!e.payload.categoryId || !e.effectiveCategoryId : filter!=='all' && e.payload.direction!==filter)continue; const k = dayLabel(e.occurredAt); (g.get(k) ?? g.set(k, []).get(k)!).push(e); } return [...g]; }, [items,filter]);
  return <>
    <header className="feed-heading"><div><div className="screen-kicker">QARJY · ВАШИ ФИНАНСЫ</div><h1>Лента</h1></div><button className="header-import" aria-label="Загрузить выписку" onClick={onImport}>{Icons.upload}</button></header>
    <div className="spotlight">{Icons.search}<input aria-label="Поиск" type="search" placeholder="Поиск по получателю и заметке" value={q} onChange={e => setQ(e.target.value)}  /></div>
    <div className="filter-pills" aria-label="Фильтры операций">{([['all','Все'],['out','Расходы'],['in','Доходы'],['auto','✨ Авто-правила']] as const).map(([key,label])=><button key={key} aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    <section className="balance-card" aria-label="Сводка за месяц"><div className="balance-label">Баланс · {monthLabel(thisMonth()).replace(/ г\.$/,'')}</div><div className="balance-value" style={{color:summary?.net?summary.net>0?'var(--green)':'var(--red)':undefined}}>{summary ? fmt(summary.net) : '— ₸'}</div><div className="balance-split"><div><span><i className="flow-dot in"/>Доходы</span><strong>{summary?fmt(summary.in):'—'}</strong></div><div><span><i className="flow-dot out"/>Расходы</span><strong>{summary?fmt(summary.out):'—'}</strong></div></div>{pending.length>0&&<small className="muted">Без ожидающих отправки</small>}</section>
    {err && <div className="banner" role="alert">{err}</div>}
    {pending.length > 0 && <><h2>Ждут отправки ({pending.length})</h2><div className="group">{pending.map(p => <div className="row" key={p.id}>
      <div className="grow"><div className="ell">{p.payload.counterparty || 'Без получателя'}</div><div className="sub">{p.status === 'failed' ? `Не принято: ${p.lastError}` : 'Отправится при появлении сети'}</div></div>
      <span className={'amt ' + p.payload.direction}>{p.payload.direction === 'in' ? '+' : '−'}{fmt(p.payload.amountMinor)}</span>
      {p.status === 'failed' && <button className="btn small danger" onClick={async () => { await removeFromQueue(p.login, p.id); bump(); }}>Убрать</button>}
    </div>)}</div></>}
    {!loading && !items.length && !pending.length && filter==='all' && !q && <div className="empty">Пока нет записей.<br />Добавьте первую операцию кнопкой «+»<br/>или загрузите выписку.<button className="btn" onClick={onImport}>Загрузить выписку</button></div>}
    {!loading && !groups.length && (filter!=='all'||!!q) && <div className="empty">{q?'Ничего не найдено':'Нет операций по выбранному фильтру'}</div>}
    {groups.map(([day, list]) => <section className="day-section" key={day}><h2>{day}</h2><div className="group">{list.map(e => {
      const c = cm.get(e.effectiveCategoryId ?? ''); const p = e.payload;
      return <button className="row" key={e.id} onClick={() => setEdit(e)} aria-label={`${p.counterparty || 'Без получателя'} ${fmt(p.amountMinor)}`}>
        <span className="merchant-icon" style={{color:c?.color??'var(--accent)',background:c?.color?c.color+'20':undefined}} aria-hidden="true">{p.direction==='in'?'↙':(p.counterparty||'₸').slice(0,1).toUpperCase()}</span>
        <div className="grow"><div className="ell">{p.counterparty || p.note || 'Без получателя'}</div><div className="sub ell">{c ? c.name : <span className="chip warn">без категории</span>}{!p.categoryId&&c&&<span className="auto-mark" title="Категория по привязке или правилу"> ✨</span>}{p.note && p.counterparty ? ' · ' + p.note : ''}</div></div>
        <span className={'amt ' + p.direction}>{p.direction === 'in' ? '+' : '−'}{fmt(p.amountMinor)}</span>
      </button>;
    })}</div></section>)}
    {loading && <div className="feed-loading" role="status">Обновляем ленту…</div>}
    {next && <button disabled={loading} className="btn sec" style={{ marginTop: 16 }} onClick={() => load(true)}>Показать ещё</button>}
    {edit && <EditSheet e={edit} cats={cats} onClose={() => setEdit(null)} />}
  </>;
}

function EditSheet({ e, cats, onClose }: { e: Entry; cats: Cat[]; onClose: () => void }) {
  const p = e.payload;
  const [dir, setDir] = useState(p.direction); const [amount, setAmount] = useState(String(p.amountMinor / 100)); const [cp, setCp] = useState(p.counterparty);
  const [cat, setCat] = useState(p.categoryId ?? ''); const [note, setNote] = useState(p.note ?? ''); const [date, setDate] = useState(new Date(e.occurredAt + 5 * 3600e3).toISOString().slice(0, 10));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const opts = cats.filter(c => c.type === (dir === 'in' ? 'income' : 'expense'));
  async function save() {
    setBusy(true); setErr('');
    try { await api('PATCH', `/api/entries/${e.id}`, { version: e.version, direction: dir, amount, counterparty: cp, categoryId: cat || null, note, occurredAt: date === new Date(e.occurredAt + 5 * 3600e3).toISOString().slice(0, 10) ? e.occurredAt : date }); bump(); onClose(); }
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
  const {cats,login,financialProfile}=useAppState();
  const [dir,setDir]=useState<'out'|'in'>('out'), [amount,setAmount]=useState(''), [cp,setCp]=useState(''),[cat,setCat]=useState('');
  const [note,setNote]=useState(''),[date,setDate]=useState(todayStr()),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
  const [counterparties,setCounterparties]=useState<Array<{display:string;name_norm:string;category_out_id:string|null;category_in_id:string|null}>>([]);
  const [rules,setRules]=useState<Array<{pattern:string;direction:string;categoryId:string}>>([]);
  useEffect(()=>{let active=true;Promise.allSettled([
    api('GET','/api/counterparties').then(r=>{if(active)setCounterparties(r.counterparties);}),
    api('GET','/api/rules').then(r=>{if(active)setRules(r.rules);})
  ]);return ()=>{active=false;};},[]);
  const preferred=new Set(dir==='in'?financialProfile?.profile?.incomes.map(i=>i.categoryId):financialProfile?.profile?.expenseCategoryIds);
  const opts=cats.filter(c=>c.type===(dir==='in'?'income':'expense')).sort((a,b)=>Number(preferred.has(b.id))-Number(preferred.has(a.id)));
  const cpRow=counterparties.find(c=>c.name_norm===normName(cp));
  const bound=opts.find(c=>c.id===(dir==='in'?cpRow?.category_in_id:cpRow?.category_out_id));
  const hay=normName(`${cp} ${note}`);
  const rule=rules.find(r=>(r.direction==='any'||r.direction===dir)&&normName(r.pattern)&&hay.includes(normName(r.pattern))&&opts.some(c=>c.id===r.categoryId));
  const auto=bound??opts.find(c=>c.id===rule?.categoryId);
  async function save(e:React.FormEvent) {
    e.preventDefault();if(busy)return;setErr('');const minor=inputMinor(amount);
    if(minor===null||minor<=0){setErr('Введите сумму больше нуля, не более двух знаков после запятой');return;}
    setBusy(true);
    try{
      await enqueue(login!,{id:crypto.randomUUID(),direction:dir,amountMinor:minor,counterparty:cp.trim(),categoryId:cat||null,note:note.trim(),occurredAt:date===todayStr()?Date.now():date});
      bump();onDone();
    }catch{setErr('Не удалось сохранить на устройстве. Попробуйте ещё раз');setBusy(false);}
  }
  function increase(minor:number) {
    const total=(inputMinor(amount)??0)+minor;
    if(!Number.isSafeInteger(total))return;
    setAmount(String(Math.floor(total/100))+(total%100?','+String(total%100).padStart(2,'0'):''));
  }
  return <form className="add-form" onSubmit={save}>
    <div className="seg"><button type="button" className={dir==='out'?'on':''} onClick={()=>{setDir('out');setCat('');}}>Расход</button><button type="button" className={dir==='in'?'on':''} onClick={()=>{setDir('in');setCat('');}}>Доход</button></div>
    <div className="amount-entry"><input data-autofocus className="big" aria-label="Сумма" inputMode="decimal" placeholder="0" value={amount} onChange={e=>setAmount(e.target.value)} autoFocus/><span aria-hidden="true">₸</span></div>
    <div className="quick-amounts">{[100000,250000,500000].map(n=><button key={n} type="button" onClick={()=>increase(n)}>+{fmt(n)}</button>)}</div>
    <div className="form-group">
      <Field label={dir==='out'?'Кому / где':'От кого'}><input aria-label="Получатель" list="cps" value={cp} onChange={e=>setCp(e.target.value)} placeholder="Например: ИП Мирас" maxLength={120}/><datalist id="cps">{counterparties.slice(0,200).map(c=><option key={c.name_norm} value={c.display}/>)}</datalist></Field>
      <Field label="Категория"><div className="category-control">{!cat&&auto&&<span className="auto-badge" data-testid="auto-category">✨ Авто · {auto.name}</span>}<select aria-label="Категория" value={cat} onChange={e=>setCat(e.target.value)}><option value="">{auto?`Автоматически: ${auto.name}`:'Автоматически (по получателю)'}</option>{opts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div></Field>
      <Field label="Дата"><input aria-label="Дата" type="date" required value={date} onChange={e=>setDate(e.target.value)}/></Field>
      <Field label="Заметка"><input aria-label="Заметка" value={note} placeholder="Необязательно" maxLength={MAX_NOTE_LENGTH} onChange={e=>setNote(e.target.value)}/></Field>
    </div>
    {err&&<div className="err" role="alert">{err}</div>}
    <button className="btn" disabled={busy}>{busy?'Сохраняем…':'Сохранить'}</button>
  </form>;
}
