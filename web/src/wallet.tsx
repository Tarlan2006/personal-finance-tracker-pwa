import { useEffect, useState, type CSSProperties } from 'react';
import type { FinancialAccount } from '../../shared/financial-profile';
import { api } from './api';
import './wallet.css';
import { Field, fmt, monthLabel, setState, thisMonth, useAppState } from './ui';

const kinds = {card:'Карта',deposit:'Депозит',account:'Счёт',cash:'Наличные'};
export function AccountSelect({ value, onChange, disabled, label = 'Счёт операции' }: {value:string;onChange:(id:string)=>void;disabled?:boolean;label?:string}) {
  const { financialProfile } = useAppState();
  const accounts = financialProfile?.profile?.accounts ?? [];
  if (!accounts.length && !value) return null;
  return <Field label={label}><select aria-label={label} value={value} disabled={disabled} onChange={e=>onChange(e.target.value)}>
    <option value="">Без счёта</option>
    {value && !accounts.some(a=>a.id===value) && <option value={value}>Счёт удалён из анкеты</option>}
    {accounts.map(a=><option key={a.id} value={a.id}>{a.bank} · {a.name} · {kinds[a.kind]}</option>)}
  </select></Field>;
}
type WalletAccount = FinancialAccount & {balanceMinor:number|null;in:number;out:number};
interface WalletData {accounts:WalletAccount[];balanceDate:string|null;unassigned:number}
function palette(a:FinancialAccount) {
  if(a.kind==='cash')return 'cash';
  const bank=a.bank.toLowerCase();
  return bank.includes('kaspi')?'kaspi':bank.includes('freedom')||bank.includes('фридом')?'freedom':bank.includes('halyk')?'halyk':bank.includes('forte')?'forte':'other';
}
export function Wallet({ queueCount, disabled }: {queueCount:number;disabled:boolean}) {
  const {financialProfile,version,selectedAccount}=useAppState();
  const [data,setData]=useState<WalletData|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
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
  const order=[...accounts.filter(a=>a.id!==expanded),accounts.find(a=>a.id===expanded)!];
  return <section className="wallet" aria-label="Мои счета">
    <div className="wallet-heading"><h2>Мои счета</h2><button className="text-action" disabled={disabled} aria-pressed={selectedAccount===null} onClick={()=>setState({selectedAccount:null})}>Все счета</button></div>
    {error&&<div role="alert" className="err">{error} <button className="text-action" onClick={()=>setRetry(n=>n+1)}>Повторить загрузку счетов</button></div>}
    <div className="wallet-stack" style={{'--card-count':accounts.length} as CSSProperties}>
      {accounts.map(a=>{
        const open=a.id===expanded,slot=order.findIndex(row=>row.id===a.id);
        return <button type="button" key={a.id} disabled={disabled} data-testid="wallet-card" data-account={a.id} aria-pressed={selectedAccount===a.id}
          aria-label={`${a.bank} · ${a.name} · ${kinds[a.kind]}`} className={`wallet-card wallet-${palette(a)}${open?' expanded':''}`}
          style={{'--slot':slot,zIndex:slot+1} as CSSProperties} onClick={()=>setState({selectedAccount:selectedAccount===a.id?null:a.id})}>
          <span className="wallet-card-heading"><span className="wallet-emblem" aria-hidden="true">{a.kind==='deposit'?'◇':a.kind==='cash'?'₸':a.bank.slice(0,1)}</span><span className="wallet-card-title"><strong>{a.bank}</strong><span>{a.name} · {kinds[a.kind]}</span></span><span className="wallet-mini-balance">{data&&a.balanceMinor!==null?fmt(a.balanceMinor):'—'}</span></span>
          <span className="wallet-details" aria-hidden={!open}>
            <span className="wallet-balance-label">Расчётный остаток</span>
            <strong className="wallet-balance">{data&&a.balanceMinor!==null?fmt(a.balanceMinor):'—'}</strong>
            <span className="wallet-period">{a.openingBalanceMinor===null?'Укажите начальный остаток в анкете':monthLabel(thisMonth()).replace(/ г\.$/,'')}</span>
            <span className="wallet-flows"><span>Доходы<strong>{data?'+'+fmt(a.in):'—'}</strong></span><span>Расходы<strong>{data?'−'+fmt(a.out):'—'}</strong></span></span>
          </span>
        </button>;
      })}
    </div>
    <p className="sub wallet-note">Остаток на начало {financialProfile?.profile?.balanceDate} и сохранённые операции после этой даты. {data?.unassigned?`Без счёта: ${data.unassigned}. `:''}{queueCount?'Ожидающие отправки ещё не учтены. ':''}Счета и депозиты: «Ещё → Финансовый профиль».</p>
  </section>;
}
