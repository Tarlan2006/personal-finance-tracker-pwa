import {useEffect,useRef,useState} from 'react';
import type {AccountBudget,FinancialProfileRecord} from '../../shared/financial-profile';
import {api,ApiError} from './api';
import {Sheet,Field,fmt,inputMinor,setState,useAppState,useAction,bump,todayStr} from './ui';

export function BudgetSheet({accountId,onClose}:{accountId:string;onClose:()=>void}){
  const {financialProfile:record}=useAppState(),action=useAction();
  const account=record?.profile?.accounts.find(a=>a.id===accountId);
  const [editing,setEditing]=useState<string|null>(null),[name,setName]=useState(''),[amount,setAmount]=useState('');
  const reset=()=>{setEditing(null);setName('');setAmount('');};
  const save=(budgets:AccountBudget[])=>action.run(async()=>{
    if(!record?.profile||!account)throw new Error('Счёт недоступен');
    const saved=await api<FinancialProfileRecord>('PUT','/api/financial-profile',{version:record.version,status:record.status,profile:{...record.profile,accounts:record.profile.accounts.map(a=>a.id===accountId?{...a,budgets}:a)}});
    setState({financialProfile:saved});bump();reset();
  });
  return <Sheet title="Бюджеты счёта" onClose={onClose} busy={action.busy}>
    <p className="muted">{account?.bank} · {account?.name}. Это планы расходов: они не списывают деньги и не меняют остаток.</p>
    <div className="group">{account?.budgets?.map(b=><div className="row" key={b.id}><button className="text-action grow" disabled={action.busy} onClick={()=>{setEditing(b.id);setName(b.name);setAmount(String(b.amountMinor/100));}}>{b.name} · {fmt(b.amountMinor)}</button><button className="text-action" aria-label={'Удалить бюджет '+b.name} disabled={action.busy} onClick={()=>{if(confirm('Удалить бюджет «'+b.name+'»?'))void save(account.budgets!.filter(x=>x.id!==b.id));}}>✕</button></div>)}</div>
    <form onSubmit={e=>{e.preventDefault();const minor=inputMinor(amount);if(minor===null)return;const item={id:editing??crypto.randomUUID(),name:name.trim(),amountMinor:minor};void save(editing?(account?.budgets??[]).map(b=>b.id===editing?item:b):[...(account?.budgets??[]),item]);}}>
      <fieldset disabled={action.busy} className="wallet-fields">
        <Field label="Название бюджета"><input aria-label="Название бюджета" required maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></Field>
        <Field label="Сумма бюджета, ₸"><input aria-label="Сумма бюджета" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
        <button className="btn" disabled={!name.trim()||inputMinor(amount)===null||(!editing&&(account?.budgets?.length??0)>=20)}>Сохранить бюджет</button>
        {editing&&<button type="button" className="text-action" onClick={reset}>Новый бюджет</button>}
      </fieldset>
    </form>{action.error&&<p className="err" role="alert">{action.error}</p>}
  </Sheet>;
}

interface Transfer {id:string;fromId:string;toId:string;amountMinor:number;occurredAt:number}
export function TransferSheet({onClose}:{onClose:()=>void}){
  const {financialProfile,selectedAccount,login,version}=useAppState(),accounts=financialProfile?.profile?.accounts??[];
  const [from,setFrom]=useState(selectedAccount??accounts[0]?.id??''),[to,setTo]=useState(accounts.find(a=>a.id!==(selectedAccount??accounts[0]?.id))?.id??'');
  const [amount,setAmount]=useState(''),[date,setDate]=useState(todayStr()),[items,setItems]=useState<Transfer[]>([]),[loadError,setLoadError]=useState(''),[reload,setReload]=useState(0),[notice,setNotice]=useState('');
  const action=useAction(),attempt=useRef<(Transfer&{accountLogin:string|null})|null>(null),[uncertain,setUncertain]=useState(false);
  useEffect(()=>{let active=true;api<{items:Transfer[]}>('GET','/api/transfers').then(r=>{if(active){setItems(r.items);setLoadError('');}}).catch(e=>{if(active)setLoadError(e.message);});return()=>{active=false;};},[version,reload]);
  const label=(id:string)=>{const a=accounts.find(a=>a.id===id);return a?a.bank+' · '+a.name:'Удалённый счёт';};
  const save=()=>action.run(async()=>{
    const minor=inputMinor(amount);if(!minor)throw new Error('Введите положительную сумму');
    attempt.current??={id:crypto.randomUUID(),fromId:from,toId:to,amountMinor:minor,occurredAt:Date.parse(date+'T00:00:00+05:00'),accountLogin:login};
    try{await api('POST','/api/transfers',attempt.current);attempt.current=null;setUncertain(false);setAmount('');setNotice('Перевод учтён');bump();}
    catch(e){if(e instanceof ApiError&&!e.retryable&&(!uncertain||e.code==='transfer_conflict')){attempt.current=null;setUncertain(false);}else setUncertain(true);throw e;}
  });
  return <Sheet title="Между своими счетами" onClose={onClose} busy={action.busy||uncertain}>
    <p className="muted">Запишите уже совершённый перевод. Деньги в банке не переводятся; в учёте изменятся два остатка, без дохода и расхода.</p>
    {accounts.length<2?<p>Добавьте второй счёт в финансовом профиле.</p>:<form onSubmit={e=>{e.preventDefault();void save();}}>
      <fieldset disabled={action.busy||uncertain} className="wallet-fields">
        <Field label="Откуда"><select aria-label="Откуда" value={from} onChange={e=>setFrom(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{label(a.id)}</option>)}</select></Field>
        <Field label="Куда"><select aria-label="Куда" value={to} onChange={e=>setTo(e.target.value)}>{accounts.map(a=><option key={a.id} value={a.id}>{label(a.id)}</option>)}</select></Field>
        <Field label="Сумма перевода, ₸"><input aria-label="Сумма перевода" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
        <Field label="Дата перевода"><input aria-label="Дата перевода" type="date" min={financialProfile?.profile?.balanceDate} max={todayStr()} required value={date} onChange={e=>setDate(e.target.value)}/></Field>
      </fieldset>
      <button className="btn" disabled={action.busy||from===to||!inputMinor(amount)}>{uncertain?'Повторить подтверждение':'Учесть перевод'}</button>
    </form>}
    {uncertain&&<p role="alert" className="err">Ответ не получен. Повторите подтверждение с тем же номером: второй перевод не создастся. Не закрывайте приложение до подтверждения.</p>}
    {action.error&&<p className="err" role="alert">{action.error}</p>}{notice&&<p role="status" className="ok">{notice}</p>}
    <h2>Последние 50 переводов</h2>{loadError&&<p role="alert" className="err">{loadError}<button className="text-action" onClick={()=>setReload(n=>n+1)}>Повторить загрузку</button></p>}
    <div className="group">{items.map(t=><div className="row" key={t.id}><div className="grow"><div>{label(t.fromId)} → {label(t.toId)}</div><div className="sub">{fmt(t.amountMinor)} · {new Date(t.occurredAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Almaty'})}</div></div><button className="text-action" disabled={action.busy||uncertain} aria-label={'Отменить перевод '+fmt(t.amountMinor)} onClick={()=>{if(confirm('Отменить учёт перевода? Остатки обоих счетов будут восстановлены.'))void action.run(async()=>{await api('DELETE','/api/transfers/'+t.id);bump();});}}>Отменить</button></div>)}</div>
  </Sheet>;
}
