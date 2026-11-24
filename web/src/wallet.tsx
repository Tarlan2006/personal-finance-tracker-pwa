import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { FinancialAccount, FinancialProfileRecord } from '../../shared/financial-profile';
import { api, ApiError } from './api';
import { Field, fmt, getState, monthLabel, setState, Sheet, thisMonth, useAppState, useAction } from './ui';
import { BankLogo, BankSelectControl, bankBrand, bankFallback } from './bank-logo';
import { BudgetSheet, TransferSheet } from './wallet-actions';
import { Money as ProfileAmount } from './onboarding';
import { useWalletDrag } from './wallet-drag';
import './wallet.css';

const kinds = {card:'Карта',deposit:'Депозит',account:'Счёт',cash:'Наличные'};
export function AccountSelect({ value, onChange, disabled, label = 'Счёт операции' }: {value:string;onChange:(id:string)=>void;disabled?:boolean;label?:string}) {
  const { financialProfile } = useAppState();
  const accounts = financialProfile?.profile?.accounts ?? [];
  if (!accounts.length && !value) return null;
  return <Field label={label}><BankSelectControl account={accounts.find(a=>a.id===value)}><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
    <option value="">Без счёта</option>
    {value && !accounts.some(a=>a.id===value) && <option value={value}>Счёт удалён из анкеты</option>}
    {accounts.map(a=><option key={a.id} value={a.id}>{a.bank} · {a.name} · {kinds[a.kind]}</option>)}
  </select></BankSelectControl></Field>;
}
type WalletAccount = FinancialAccount & {balanceMinor:number|null;in:number;out:number};
interface WalletData {accounts:WalletAccount[];balanceDate:string|null;unassigned:number}

function tilt(event: PointerEvent<HTMLElement>) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const face = event.currentTarget;
  if (face.closest('[data-dragging]')) return;
  const rect = face.parentElement!.getBoundingClientRect();
  const x = Math.max(-1, Math.min(1, 2 * (event.clientX - rect.left) / rect.width - 1));
  const y = Math.max(-1, Math.min(1, 2 * (event.clientY - rect.top) / rect.height - 1));
  face.style.setProperty('--rx', -y * 5 + 'deg');
  face.style.setProperty('--ry', x * 5 + 'deg');
  face.style.setProperty('--glint-x', x * 18 + '%');
  face.style.setProperty('--glint-y', y * 12 + '%');
  face.dataset.tilt = '';
}
function releaseTilt(event: PointerEvent<HTMLElement>) {
  const face = event.currentTarget;
  delete face.dataset.tilt;
  for (const name of ['--rx','--ry','--glint-x','--glint-y']) face.style.removeProperty(name);
}

export function Wallet({ queueCount, disabled }: {queueCount:number;disabled:boolean}) {
  const {financialProfile,version,selectedAccount,login}=useAppState();
  const [data,setData]=useState<WalletData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [budgetAccount,setBudgetAccount]=useState<string|null>(null),[transferring,setTransferring]=useState(false);
  const [balanceId,setBalanceId]=useState<string|null>(null),[amount,setAmount]=useState<number|null>(null);
  const [ordering,setOrdering]=useState(false),[preview,setPreview]=useState<string[]|null>(null);
  const [notice,setNotice]=useState('');
  const save=useAction();
  const configured=financialProfile?.profile?.accounts ?? [];
  const locked=disabled||save.busy;
  const drag=useWalletDrag(financialProfile?.version,locked);
  const focusAfterMove=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    let active=true;setError('');
    if(!configured.length){setData(null);return;}
    api<WalletData>('GET','/api/wallet').then(r=>{if(active)setData(r);}).catch(e=>{if(active){setData(null);setError(e.message);}});
    return()=>{active=false;};
  },[version,queueCount,financialProfile,retry]);
  useEffect(()=>{if(selectedAccount && !configured.some(a=>a.id===selectedAccount))setState({selectedAccount:null});},[financialProfile,selectedAccount]);
  useEffect(()=>{
    if(!save.busy && focusAfterMove.current){
      focusAfterMove.current.focus({preventScroll:true});
      focusAfterMove.current=null;
    }
  },[save.busy]);
  if(!configured.length || !financialProfile?.profile)return null;

  const profile=financialProfile.profile;
  const record=financialProfile;
  const ids=preview??configured.map(a=>a.id);
  const accounts=ids.flatMap(id=>configured.find(a=>a.id===id)??[]);
  const selectedIndex=ordering?-1:accounts.findIndex(a=>a.id===selectedAccount);
  const balanceAccount=configured.find(a=>a.id===balanceId);
  function acceptRecord(next:FinancialProfileRecord){
    const state=getState();
    if(state.login===login && (state.financialProfile?.version??0)<=next.version)setState({financialProfile:next});
  }
  async function persist(next:FinancialAccount[]){
    try{
      const result=await api<FinancialProfileRecord>('PUT','/api/financial-profile',{
        version:record.version,status:record.status,profile:{...profile,accounts:next}
      });
      acceptRecord(result);
    }catch(e){
      if(!(e instanceof ApiError) || e.status!==409)throw e;
      if(getState().login!==login)return;
      acceptRecord(await api<FinancialProfileRecord>('GET','/api/financial-profile'));
      throw new Error('Анкета изменилась на другом устройстве. Загружены свежие данные. Повторите изменение.');
    }
  }
  function move(id:string,to:number,button?:HTMLButtonElement){
    if(locked || save.running.current || to<0 || to>=configured.length)return;
    const next=[...configured],from=next.findIndex(a=>a.id===id);
    if(from<0||from===to)return;
    next.splice(to,0,next.splice(from,1)[0]);
    focusAfterMove.current=button??null;
    setNotice('');
    setPreview(next.map(a=>a.id));
    void save.run(async()=>{
      try{await persist(next);setNotice(`Порядок сохранён. ${next[to].name} — ${to+1} из ${next.length}.`);}
      finally{setPreview(null);}
    });
  }
  const reset=()=>{setState({selectedAccount:null});setOrdering(false);};
  return <section className="wallet" aria-label="Мои счета">
    <div className="wallet-heading"><h2>Счета и бюджеты</h2><div className="wallet-tools"><button className="wallet-round" disabled={locked} aria-label="Перевод между счетами" onClick={()=>setTransferring(true)}>⇄</button><button className="wallet-round" disabled={locked} aria-label="Свернуть карточки" onClick={reset}>✕</button></div></div>
    <div className="wallet-menu">
      <button className="text-action wallet-all" disabled={locked} aria-pressed={selectedAccount===null} onClick={reset}>Все счета</button>
      <button className="text-action wallet-order" disabled={locked||accounts.length<2} aria-pressed={ordering} onClick={()=>{setNotice('');setOrdering(!ordering);}}>{ordering?'Готово':'Порядок'}</button>
    </div>
    {error&&<div role="alert" className="err">{error} <button className="text-action" onClick={()=>setRetry(n=>n+1)}>Повторить загрузку счетов</button></div>}
    {save.error&&!balanceAccount&&<p role="alert" className="err">{save.error}</p>}
    <span className="wallet-announcement" role="status">{notice}</span>
    <div className="wallet-stack" ref={drag.stack} onClickCapture={e=>{if(drag.suppressClick.current){e.preventDefault();e.stopPropagation();}}}>
      {accounts.map((a,i)=>{
        const open=i===selectedIndex,brand=bankBrand(a.bank,a.kind),budgets=a.budgets??[];
        const totals=data?.accounts.find(row=>row.id===a.id);
        const balance=totals?.balanceMinor;
        const label=`${a.bank} · ${a.name}`;
        const toggle=()=>{if(!locked&&!ordering)setState({selectedAccount:open?null:a.id});};
        return <article key={a.id} data-testid="wallet-card" data-account={a.id}
          className={`wallet-card wallet-${brand}${open?' expanded':''}${selectedIndex>=0&&i>selectedIndex?' below':''}`}
          style={brand==='other'?{'--bank-color':bankFallback(a.bank).background} as CSSProperties:undefined}>
          <div className="wallet-face" onPointerMove={tilt} onPointerDown={tilt} onPointerLeave={releaseTilt} onPointerUp={releaseTilt} onPointerCancel={releaseTilt}>
            <div className="wallet-finish" aria-hidden="true"><i/></div>
            <div className="wallet-card-header">
              <button type="button" disabled={locked} aria-disabled={locked||ordering} className="wallet-card-toggle"
                aria-pressed={selectedAccount===a.id} aria-expanded={open} aria-controls={'wallet-details-'+a.id}
                aria-label={label+' · '+kinds[a.kind]} onClick={toggle}
                onContextMenu={e=>e.preventDefault()} onPointerDown={e=>{if(accounts.length>1)drag.start(e,false,to=>move(a.id,to));}}>
                <BankLogo bank={a.bank} kind={a.kind} size={40} glass/>
                <span className="wallet-card-title"><strong>{brand==='cash'?'Наличка':a.bank}</strong><span className="wallet-account-name">{a.name}{a.kind==='deposit'?' · Депозит':''}</span></span>
                <span className="wallet-mini-balance"><small>БАЛАНС</small><b>{balance==null?'—':fmt(balance)}</b></span>
              </button>
              {!ordering&&(brand==='cash'?<span className="wallet-budget-count">Бюджеты · {budgets.length}</span>:
                <button type="button" className="wallet-budget-add" aria-label={'Бюджеты '+label} disabled={locked} onClick={()=>setBudgetAccount(a.id)}><span>+ бюджет</span></button>)}
              {ordering&&<div className="wallet-order-tools">
                <span className="wallet-grip" aria-hidden="true" onContextMenu={e=>e.preventDefault()} onPointerDown={e=>drag.start(e,true,to=>move(a.id,to))}>⠿</span>
                {[-1,1].map(d=><button key={d} type="button" aria-label={label+(d<0?' выше':' ниже')} aria-disabled={locked||!accounts[i+d]}
                  onClick={e=>move(a.id,i+d,e.currentTarget)}>{d<0?'↑':'↓'}</button>)}
              </div>}
            </div>
            <div id={'wallet-details-'+a.id} className="wallet-reveal" aria-hidden={!open}>
              <div className="wallet-clip"><div className="wallet-details" onClick={e=>{if(!(e.target as HTMLElement).closest('button,.wallet-budgets'))toggle();}}>
                <span className="wallet-balance-label">Текущий баланс</span>
                <strong className={'wallet-balance'+(String(Math.abs(balance??0)).length>9?' wallet-balance-long':'')}>{balance==null?'—':fmt(balance)}</strong>
                {a.openingBalanceMinor===null?<button type="button" className="wallet-set-balance" tabIndex={open?0:-1} disabled={locked||!open}
                  onClick={()=>{save.setError('');setAmount(null);setBalanceId(a.id);}}>Указать остаток</button>:<span className="wallet-period">{monthLabel(thisMonth()).replace(/ г\.$/,'')}</span>}
                {brand==='cash'&&<div className="wallet-budgets" tabIndex={open?0:-1} aria-label="Бюджеты наличных">{budgets.map(b=><button className="wallet-budget-tile" key={b.id} disabled={locked||!open} onClick={()=>setBudgetAccount(a.id)}><span>{b.name}</span><strong>{fmt(b.amountMinor)}</strong></button>)}<button className="wallet-budget-tile wallet-new-budget" disabled={locked||!open} onClick={()=>setBudgetAccount(a.id)}>+ Бюджет</button></div>}
                <div className="wallet-flows"><span>Доходы<strong>{totals?'+'+fmt(totals.in):'—'}</strong></span><span>Расходы<strong>{totals?'−'+fmt(totals.out):'—'}</strong></span></div>
              </div></div>
            </div>
          </div>
        </article>;
      })}
    </div>
    <p className="sub wallet-note">Остаток на начало {financialProfile?.profile?.balanceDate} и сохранённые операции после этой даты. {data?.unassigned?`Без счёта: ${data.unassigned}. `:''}{queueCount?'Ожидающие отправки ещё не учтены. ':''}Счета и депозиты: «Ещё → Финансовый профиль».</p>
    {balanceAccount&&<Sheet title="Указать остаток" busy={save.busy} onClose={()=>{save.setError('');setBalanceId(null);}}>
      <p>{balanceAccount.bank} · {balanceAccount.name} · на начало {profile.balanceDate}</p>
      <form onSubmit={e=>{e.preventDefault();if(amount===null)return;void save.run(async()=>{
        await persist(configured.map(a=>a.id===balanceId?{...a,openingBalanceMinor:amount}:a));setBalanceId(null);
      });}}>
        <ProfileAmount label="Начальный остаток" value={amount} signed={balanceAccount.kind==='account'||balanceAccount.kind==='card'} onChange={setAmount}/>
        {save.error&&<p className="err" role="alert">{save.error}</p>}
        <button className="btn" disabled={save.busy||amount===null}>Сохранить остаток</button>
      </form>
    </Sheet>}
    {budgetAccount&&<BudgetSheet accountId={budgetAccount} onClose={()=>setBudgetAccount(null)}/>}
    {transferring&&<TransferSheet onClose={()=>setTransferring(false)}/>}
  </section>;
}
