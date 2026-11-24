import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { FinancialAccount } from '../../shared/financial-profile';
import { api } from './api';
import './wallet.css';
import { Field, fmt, monthLabel, setState, thisMonth, useAppState } from './ui';
import { BankLogo, BankSelectControl, bankBrand } from './bank-logo';
import {BudgetSheet,TransferSheet} from './wallet-actions';

function CountUp({value,active=true,prefix=''}:{value:number|null;active?:boolean;prefix?:string}){
  const element=useRef<HTMLSpanElement>(null),previous=useRef<number|null>(null);
  useLayoutEffect(()=>{
    const el=element.current;if(!el)return;
    const motion=matchMedia('(prefers-reduced-motion: reduce)');let frame=0;
    const end=()=>{cancelAnimationFrame(frame);el.textContent=value===null?'—':prefix+fmt(value);previous.current=value;};
    if(value===null||!active||motion.matches){end();if(!active)previous.current=null;return;}
    const from=previous.current??0,start=performance.now();
    el.textContent=prefix+fmt(from);
    const tick=(time:number)=>{const t=Math.min(1,(time-start)/600),n=from+(value-from)*(1-Math.pow(1-t,3));el.textContent=prefix+fmt(t===1?value:Math.round(n/100)*100);if(t<1)frame=requestAnimationFrame(tick);else previous.current=value;};
    frame=requestAnimationFrame(tick);motion.addEventListener('change',end);
    return()=>{cancelAnimationFrame(frame);motion.removeEventListener('change',end);};
  },[value,active,prefix]);
  return <span aria-label={value===null?'Остаток не указан':prefix+fmt(value)}><span ref={element} aria-hidden="true">{value===null?'—':prefix+fmt(value)}</span></span>;
}

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
export function Wallet({ queueCount, disabled }: {queueCount:number;disabled:boolean}) {
  const {financialProfile,version,selectedAccount}=useAppState();
  const [data,setData]=useState<WalletData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [budgetAccount,setBudgetAccount]=useState<string|null>(null),[transferring,setTransferring]=useState(false);
  const configured=financialProfile?.profile?.accounts ?? [];
  useEffect(()=>{
    let active=true;setError('');
    if(!configured.length){setData(null);return;}
    api<WalletData>('GET','/api/wallet').then(r=>{if(active)setData(r);}).catch(e=>{if(active){setData(null);setError(e.message);}});
    return()=>{active=false;};
  },[version,queueCount,financialProfile,retry]);
  useEffect(()=>{if(selectedAccount && !configured.some(a=>a.id===selectedAccount))setState({selectedAccount:null});},[financialProfile,selectedAccount]);
  if(!configured.length)return null;
  const accounts=configured.map(a=>data?.accounts.find(row=>row.id===a.id)??{...a,balanceMinor:null,in:0,out:0});
  const expanded=accounts.find(a=>a.id===selectedAccount)?.id??accounts.at(-1)!.id;
  const order=selectedAccount?[accounts.find(a=>a.id===expanded)!,...accounts.filter(a=>a.id!==expanded)]:accounts;
  const cashOpen=accounts.find(a=>a.id===expanded)?.kind==='cash';
  // All visual movement uses transform/opacity. The stack reserves one expanded card,
  // so selecting a card never moves the feed below it or animates document layout.
  const expandedHeight=cashOpen?448:344,step=98,closedHeight=122;
  const reset=()=>setState({selectedAccount:null});
  return <section className="wallet" aria-label="Мои счета">
    <div className="wallet-heading"><h2>Счета и бюджеты</h2><div className="wallet-tools"><button className="wallet-round" disabled={disabled} aria-label="Перевод между счетами" onClick={()=>setTransferring(true)}>⇄</button><button className="wallet-round" disabled={disabled} aria-label="Свернуть карточки" onClick={reset}>✕</button></div></div>
    <button className="wallet-all text-action" disabled={disabled} aria-pressed={selectedAccount===null} onClick={reset}>Все счета</button>
    {error&&<div role="alert" className="err">{error} <button className="text-action" onClick={()=>setRetry(n=>n+1)}>Повторить загрузку счетов</button></div>}
    <div className="wallet-stack" style={{height:(accounts.length-1)*step+(accounts.some(a=>a.kind==='cash')?448:344)} as CSSProperties}>
      {accounts.map(a=>{
        const open=a.id===expanded,slot=order.findIndex(row=>row.id===a.id);
        const height=open?expandedHeight:closedHeight,y=slot*step+(selectedAccount&&slot>0?expandedHeight-step:0),brand=bankBrand(a.bank,a.kind),budgets=a.budgets??[];
        const toggle=()=>{if(!disabled)setState({selectedAccount:selectedAccount===a.id?null:a.id});};
        return <article key={a.id} data-testid="wallet-card" data-account={a.id} className={`wallet-card wallet-${brand}${open?' expanded':''}`}
          onClick={e=>{if(!(e.target as HTMLElement).closest('button,.wallet-budgets'))toggle();}}
          style={{'--y':`${y}px`,'--height':`${height}px`,'--body-scale':(height-56)/288,'--delay':`${accounts.indexOf(a)*60}ms`,zIndex:slot+1} as CSSProperties}>
          <div className="wallet-card-enter">
            <div className="wallet-surface" aria-hidden="true"><i className="wallet-surface-top"/><i className="wallet-surface-middle"/><i className="wallet-surface-bottom"/></div>
            <button type="button" disabled={disabled} className="wallet-card-toggle" aria-pressed={selectedAccount===a.id} aria-expanded={open} aria-label={`${a.bank} · ${a.name} · ${kinds[a.kind]}`} onClick={toggle}>
              <span className="wallet-card-heading"><BankLogo bank={a.bank} kind={a.kind}/><span className="wallet-card-title"><strong>{brand==='cash'?'Наличка':a.bank}</strong><span className="wallet-account-name">{a.name}{a.kind==='deposit'?' · Депозит':''}</span><span className="wallet-budget-placeholder">{brand==='cash'?`Счёт · ${budgets.length} ${budgets.length===1?'бюджет':budgets.length>1&&budgets.length<5?'бюджета':'бюджетов'}`:'\u00a0'}</span></span><span className="wallet-mini-balance"><small>БАЛАНС</small><b>{data&&a.balanceMinor!==null?fmt(a.balanceMinor):'—'}</b></span></span>
            </button>
            {brand!=='cash'&&<button type="button" className="wallet-budget-add" aria-label={'Бюджеты '+a.bank+' · '+a.name} disabled={disabled} onClick={()=>setBudgetAccount(a.id)}>+ бюджет</button>}
            <div className="wallet-details" aria-hidden={!open}>
              <button type="button" className="wallet-balance-toggle" disabled={disabled||!open} tabIndex={open?0:-1} aria-label={'Свернуть '+a.bank+' · '+a.name} onClick={toggle}>
                <span className="wallet-balance-label">Текущий баланс</span><strong className={'wallet-balance'+(String(Math.abs(a.balanceMinor??0)).length>9?' wallet-balance-long':'')}><CountUp value={data?a.balanceMinor:null} active={open}/></strong>
                <span className="wallet-period">{a.openingBalanceMinor===null?'Укажите начальный остаток в анкете':monthLabel(thisMonth()).replace(/ г\.$/,'')}</span>
              </button>
              {brand==='cash'&&<div className="wallet-budgets" tabIndex={open?0:-1} aria-label="Бюджеты наличных">{budgets.map(b=><button className="wallet-budget-tile" key={b.id} tabIndex={open?0:-1} disabled={disabled} onClick={()=>setBudgetAccount(a.id)}><span>{b.name}</span><strong>{fmt(b.amountMinor)}</strong></button>)}<button className="wallet-budget-tile wallet-new-budget" tabIndex={open?0:-1} disabled={disabled} onClick={()=>setBudgetAccount(a.id)}>+ бюджет</button></div>}
              <div className="wallet-flows"><span><i className="wallet-flow-icon income">↙</i><span>Доходы<strong><CountUp value={data?a.in:null} active={open} prefix="+"/></strong></span></span><span><span>Расходы<strong><CountUp value={data?a.out:null} active={open} prefix="−"/></strong></span><i className="wallet-flow-icon expense">↗</i></span></div>
            </div>
          </div>
        </article>;
      })}
    </div>
    <p className="sub wallet-note">Остаток на начало {financialProfile?.profile?.balanceDate} и сохранённые операции после этой даты. {data?.unassigned?`Без счёта: ${data.unassigned}. `:''}{queueCount?'Ожидающие отправки ещё не учтены. ':''}Счета и депозиты: «Ещё → Финансовый профиль».</p>
    {budgetAccount&&<BudgetSheet accountId={budgetAccount} onClose={()=>setBudgetAccount(null)}/>}
    {transferring&&<TransferSheet onClose={()=>setTransferring(false)}/>}
  </section>;
}
