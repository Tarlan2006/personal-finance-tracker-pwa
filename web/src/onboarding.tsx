import { useEffect, useRef, useState } from 'react';
import type { FinancialProfile, FinancialProfileRecord } from '../../shared/financial-profile';
import { api } from './api';
import { Field, fmt, inputMinor, setState, todayStr, useAppState } from './ui';
import { CreateCategorySheet } from './category-create';

export const emptyProfile=():FinancialProfile=>({balanceDate:todayStr(),accounts:[],expenseCategoryIds:[],monthlyBudgetMinor:null,incomes:[],obligations:[],householdSize:1,goal:'',goalTargetMinor:null,monthlySavingMinor:null});
const moneyText=(n:number|null)=>n===null?'':String(n/100).replace('.',',');
function Money({label,value,onChange,signed=false}:{label:string;value:number|null;onChange:(v:number|null)=>void;signed?:boolean}){
  const [raw,setRaw]=useState(()=>moneyText(value));
  return <Field label={label+' · ₸'}><input aria-label={label} inputMode="decimal" placeholder="Не указано" value={raw} onChange={e=>{
    const s=e.target.value;setRaw(s);const negative=s.trim().startsWith('-'),absolute=s.trim().replace(/^[-+]/,'');const parsed=absolute?inputMinor(absolute):null;
    const n=parsed===null?null:(negative?-parsed:parsed);
    const valid=!s.trim()||(n!==null&&(signed||n>=0)&&Math.abs(n)<=100_000_000_000_000);
    e.target.setCustomValidity(valid?'':'Введите сумму в тенге, до двух знаков после запятой');onChange(valid?n:null);
  }}/></Field>;
}
const steps=['Счета','Расходы','Доходы','Обязательства','Цели'];
export function FinancialQuestionnaire({record,onDone}:{record:FinancialProfileRecord;onDone:()=>void}){
  const {cats}=useAppState();
  const [profile,setProfile]=useState<FinancialProfile>(()=>{
    const p=record.profile??emptyProfile();
    return {...p,expenseCategoryIds:p.expenseCategoryIds.filter(id=>cats.some(c=>c.id===id&&c.type==='expense')),incomes:p.incomes.map(i=>({...i,categoryId:cats.some(c=>c.id===i.categoryId&&c.type==='income')?i.categoryId:''}))};
  });
  const [version,setVersion]=useState(record.version),[step,setStep]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [creatingCategory,setCreatingCategory]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null),form=useRef<HTMLFormElement>(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});window.scrollTo(0,0);},[step]);
  const patch=(p:Partial<FinancialProfile>)=>setProfile(x=>({...x,...p}));
  async function save(status:'draft'|'complete'|'deferred'){
    if(!form.current?.reportValidity())return;
    setBusy(true);setError('');
    try{const saved=await api<FinancialProfileRecord>('PUT','/api/financial-profile',{version,status,profile});setVersion(saved.version);setState({financialProfile:saved,...(status==='draft'?{}:{onboardingRequired:false})});
      if(status==='draft')setStep(s=>s+1);else onDone();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const expense=cats.filter(c=>c.type==='expense'),income=cats.filter(c=>c.type==='income');
  return <div className="questionnaire">
    <div className="screen-kicker">ЗНАКОМСТВО С ВАШИМИ ФИНАНСАМИ</div>
    <div className="questionnaire-progress" aria-label={`Шаг ${step+1} из 5`}>{steps.map((s,i)=><span key={s} className={i<=step?'active':''}/>)}</div>
    <p className="sub">Шаг {step+1} из 5 · {steps[step]}</p>
    <h1 ref={heading} tabIndex={-1}>{['Где ваши деньги?','Что будем учитывать?','Откуда приходит доход?','Что платите регулярно?','К чему хотите прийти?'][step]}</h1>
    <form ref={form} onSubmit={e=>{e.preventDefault();void save(step===4?'complete':'draft');}}>
      <fieldset disabled={busy} className="questionnaire-fields">
      {step===0&&<>
        <p className="muted">Добавьте каждый счёт отдельно: например, карту и депозит одного банка. Только тенге. Пустой остаток означает «пока не знаю», ноль — денег нет.</p>
        <Field label="На какую дату указаны остатки?"><input aria-label="Дата начальных остатков" type="date" required value={profile.balanceDate} onChange={e=>patch({balanceDate:e.target.value})}/></Field>
        <div className="questionnaire-bank-buttons">{['Kaspi','Halyk','Freedom','Другой банк','Наличные'].map(bank=><button type="button" className="pill" key={bank} disabled={profile.accounts.length>=30} onClick={()=>patch({accounts:[...profile.accounts,{id:crypto.randomUUID(),bank,name:bank==='Наличные'?'Кошелёк':'Основная карта',kind:bank==='Наличные'?'cash':'card',openingBalanceMinor:null}]})}>+ {bank}</button>)}</div>
        {profile.accounts.map((a,i)=><section className="questionnaire-card" key={a.id} aria-label={`Счёт ${i+1}`}>
          <div className="questionnaire-card-title"><h2>Счёт {i+1}</h2><button type="button" className="text-action" aria-label={`Удалить счёт ${i+1}`} onClick={()=>patch({accounts:profile.accounts.filter(x=>x.id!==a.id)})}>Удалить</button></div>
          <Field label="Банк / наличные"><input aria-label={`Банк счёта ${i+1}`} required maxLength={80} value={a.bank} onChange={e=>patch({accounts:profile.accounts.map(x=>x.id===a.id?{...x,bank:e.target.value}:x)})}/></Field>
          <Field label="Название для себя"><input aria-label={`Название счёта ${i+1}`} required maxLength={80} value={a.name} onChange={e=>patch({accounts:profile.accounts.map(x=>x.id===a.id?{...x,name:e.target.value}:x)})}/></Field>
          <Field label="Вид счёта"><select aria-label={`Вид счёта ${i+1}`} value={a.kind} onChange={e=>patch({accounts:profile.accounts.map(x=>x.id===a.id?{...x,kind:e.target.value as typeof a.kind}:x)})}><option value="card">Обычная карта</option><option value="deposit">Депозит</option><option value="account">Текущий счёт</option><option value="cash">Наличные</option></select></Field>
          <Money label={`Начальный остаток счёта ${i+1}`} value={a.openingBalanceMinor} signed={a.kind==='card'||a.kind==='account'} onChange={v=>patch({accounts:profile.accounts.map(x=>x.id===a.id?{...x,openingBalanceMinor:v}:x)})}/>
        </section>)}
        {!profile.accounts.length&&<p className="sub">Если счетов пока нет или вы не готовы их указывать, продолжайте без них.</p>}
        <p className="questionnaire-note">Не указывайте номера карт, ИИН, CVV и пароли банка. Начальные остатки сохранятся отдельно от доходов и не попадут в отчёт как поступления.</p>
      </>}
      {step===1&&<>
        <p className="muted">Выберите важные категории из вашего списка. Они будут первыми при добавлении операции; остальные категории останутся доступны.</p>
        <div className="group">{expense.map(c=><label className="row questionnaire-choice" key={c.id}><input type="checkbox" checked={profile.expenseCategoryIds.includes(c.id)} onChange={e=>patch({expenseCategoryIds:e.target.checked?[...profile.expenseCategoryIds,c.id]:profile.expenseCategoryIds.filter(id=>id!==c.id)})}/><span className="dot" style={{background:c.color}}/><span>{c.name}</span></label>)}</div>
        <button type="button" className="btn sec" disabled={profile.expenseCategoryIds.length>=100} onClick={()=>setCreatingCategory(true)}>+ Добавить категорию</button>
        <Money label="План расходов в месяц" value={profile.monthlyBudgetMinor} onChange={v=>patch({monthlyBudgetMinor:v})}/>
        <Field label="На скольких человек ведёте бюджет?"><input aria-label="Человек в бюджете" type="number" min={1} max={30} required value={profile.householdSize} onChange={e=>patch({householdSize:Number(e.target.value)})}/></Field>
      </>}
      {step===2&&<>
        <p className="muted">Зарплата, подработка, бизнес, аренда или другие поступления. Это план, а не реальные операции. Для нерегулярного дохода можно указать среднее за месяц.</p>
        {profile.incomes.map((a,i)=><section className="questionnaire-card" key={a.id}>
          <div className="questionnaire-card-title"><h2>Источник {i+1}</h2><button type="button" className="text-action" aria-label={`Удалить доход ${i+1}`} onClick={()=>patch({incomes:profile.incomes.filter(x=>x.id!==a.id)})}>Удалить</button></div>
          <Field label="Название источника"><input aria-label={`Источник дохода ${i+1}`} required maxLength={80} value={a.name} onChange={e=>patch({incomes:profile.incomes.map(x=>x.id===a.id?{...x,name:e.target.value}:x)})}/></Field>
          <Field label="Категория дохода"><select aria-label={`Категория дохода ${i+1}`} value={a.categoryId} onChange={e=>patch({incomes:profile.incomes.map(x=>x.id===a.id?{...x,categoryId:e.target.value}:x)})}><option value="">Без категории</option>{income.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Money label={`Доход в месяц ${i+1}`} value={a.monthlyMinor} onChange={v=>patch({incomes:profile.incomes.map(x=>x.id===a.id?{...x,monthlyMinor:v}:x)})}/>
          <label className="questionnaire-choice"><input type="checkbox" checked={a.regular} onChange={e=>patch({incomes:profile.incomes.map(x=>x.id===a.id?{...x,regular:e.target.checked}:x)})}/>Регулярный доход</label>
        </section>)}
        <button type="button" className="btn sec" disabled={profile.incomes.length>=30} onClick={()=>patch({incomes:[...profile.incomes,{id:crypto.randomUUID(),name:'Основной доход',categoryId:income[0]?.id??'',monthlyMinor:null,regular:true}]})}>Добавить источник дохода</button>
        <p className="sub">Нет доходов сейчас? Переходите к следующему шагу.</p>
      </>}
      {step===3&&<>
        <p className="muted">Аренда, кредит, рассрочка, подписки, помощь семье. Укажите ежемесячный платёж; остаток долга нужен только для кредитов и займов.</p>
        {profile.obligations.map((a,i)=><section className="questionnaire-card" key={a.id}>
          <div className="questionnaire-card-title"><h2>Обязательство {i+1}</h2><button type="button" className="text-action" aria-label={`Удалить обязательство ${i+1}`} onClick={()=>patch({obligations:profile.obligations.filter(x=>x.id!==a.id)})}>Удалить</button></div>
          <Field label="За что платите?"><input aria-label={`Обязательство ${i+1}`} required maxLength={80} value={a.name} onChange={e=>patch({obligations:profile.obligations.map(x=>x.id===a.id?{...x,name:e.target.value}:x)})}/></Field>
          <Money label={`Платёж в месяц ${i+1}`} value={a.monthlyMinor} onChange={v=>patch({obligations:profile.obligations.map(x=>x.id===a.id?{...x,monthlyMinor:v}:x)})}/>
          <Money label={`Остаток долга ${i+1}`} value={a.debtMinor} onChange={v=>patch({obligations:profile.obligations.map(x=>x.id===a.id?{...x,debtMinor:v}:x)})}/>
        </section>)}
        <button type="button" className="btn sec" disabled={profile.obligations.length>=30} onClick={()=>patch({obligations:[...profile.obligations,{id:crypto.randomUUID(),name:'Регулярный платёж',monthlyMinor:null,debtMinor:null}]})}>Добавить обязательство</button>
        <p className="sub">Если обязательств нет, этот шаг можно оставить пустым.</p>
      </>}
      {step===4&&<>
        <p className="muted">Например: создать подушку, накопить на покупку, уменьшить расходы или погасить долг.</p>
        <Field label="Главная финансовая цель"><input aria-label="Финансовая цель" maxLength={200} value={profile.goal} onChange={e=>patch({goal:e.target.value})} placeholder="Что хотите изменить в своих финансах?"/></Field>
        <Money label="Сумма цели" value={profile.goalTargetMinor} onChange={v=>patch({goalTargetMinor:v})}/>
        <Money label="Готовы откладывать в месяц" value={profile.monthlySavingMinor} onChange={v=>patch({monthlySavingMinor:v})}/>
        <h2>Проверьте ответы</h2><ProfileSummary profile={profile}/>
        <p className="questionnaire-note">Ответы сохранятся в вашем аккаунте. Их можно изменить в «Ещё → Финансовый профиль». Планы и остатки не создают операций; цели пока не отслеживаются автоматически.</p>
      </>}
      {error&&<div className="err" role="alert">{error}</div>}
      <div className="questionnaire-actions">{step>0&&<button type="button" className="btn sec" onClick={()=>{if(form.current?.reportValidity()){setError('');setStep(s=>s-1);}}}>Назад</button>}<button className="btn" type="submit">{busy?'Сохраняем…':step===4?'Завершить настройку':'Сохранить и продолжить'}</button></div>
      <button type="button" className="text-action questionnaire-later" onClick={()=>void save('deferred')}>Сохранить и заполнить позже</button>
      </fieldset>
    </form>
    {creatingCategory&&<CreateCategorySheet onClose={()=>setCreatingCategory(false)} onCreated={id=>patch({expenseCategoryIds:[...profile.expenseCategoryIds,id]})}/>}
  </div>;
}
export function ProfileSummary({profile}:{profile:FinancialProfile}){
  const {cats}=useAppState();
  const total=profile.accounts.reduce((n,a)=>n+(a.openingBalanceMinor??0),0),unknown=profile.accounts.filter(a=>a.openingBalanceMinor===null).length;
  return <div className="group" data-testid="financial-profile-summary">
    <div className="row"><div><strong>Остатки на {profile.balanceDate}</strong><div className="sub">Указано: {fmt(total)}{unknown?` · без остатка: ${unknown}`:''}</div></div></div>
    {profile.accounts.map(a=><div className="row" key={a.id}><div className="grow"><div>{a.bank} · {a.name}</div><div className="sub">{{card:'Карта',deposit:'Депозит',account:'Текущий счёт',cash:'Наличные'}[a.kind]}</div></div><span>{a.openingBalanceMinor===null?'Не указан':fmt(a.openingBalanceMinor)}</span></div>)}
    <div className="row"><span className="grow">Человек в бюджете</span><span>{profile.householdSize}</span></div>
    <div className="row"><div><div>Важные категории</div><div className="sub">{profile.expenseCategoryIds.map(id=>cats.find(c=>c.id===id)?.name).filter(Boolean).join(', ')||'Не выбраны'}</div></div></div>
    <div className="row"><span className="grow">План расходов / месяц</span><span>{profile.monthlyBudgetMinor===null?'Не указан':fmt(profile.monthlyBudgetMinor)}</span></div>
    {profile.incomes.map(a=><div className="row" key={a.id}><div className="grow"><div>{a.name}</div><div className="sub">{a.regular?'Регулярный':'Нерегулярный'} · {cats.find(c=>c.id===a.categoryId)?.name??'Без категории'}</div></div><span>{a.monthlyMinor===null?'Не указан':fmt(a.monthlyMinor)+'/мес.'}</span></div>)}
    {profile.obligations.map(a=><div className="row" key={a.id}><div className="grow"><div>{a.name}</div><div className="sub">{a.debtMinor===null?'Остаток долга не указан':'Долг: '+fmt(a.debtMinor)}</div></div><span>{a.monthlyMinor===null?'Не указан':fmt(a.monthlyMinor)+'/мес.'}</span></div>)}
    <div className="row"><span className="grow">Указанные доходы / месяц</span><span>{fmt(profile.incomes.reduce((n,a)=>n+(a.monthlyMinor??0),0))}</span></div>
    <div className="row"><span className="grow">Указанные платежи / месяц</span><span>{fmt(profile.obligations.reduce((n,a)=>n+(a.monthlyMinor??0),0))}</span></div>
    <div className="row"><span className="grow">Откладывать / месяц</span><span>{profile.monthlySavingMinor===null?'Не указано':fmt(profile.monthlySavingMinor)}</span></div>
    {(profile.goal||profile.goalTargetMinor!==null)&&<div className="row"><div><div>Цель: {profile.goal||'Без названия'}</div>{profile.goalTargetMinor!==null&&<div className="sub">{fmt(profile.goalTargetMinor)}</div>}</div></div>}
  </div>;
}
export function FinancialProfileScreen(){
  const {financialProfile}=useAppState(),[editing,setEditing]=useState(false);
  if(!financialProfile)return <p role="status">Загружаем финансовый профиль…</p>;
  if(editing)return <><button className="back" onClick={()=>setEditing(false)}>‹ К профилю</button><FinancialQuestionnaire record={financialProfile} onDone={()=>setEditing(false)}/></>;
  return <><h1>Финансовый профиль</h1><p className="muted">{financialProfile.status==='complete'?'Настройка завершена.':'Анкету можно продолжить в любое время.'} Начальные остатки — снимок на указанную дату, а не текущий баланс после операций.</p>{financialProfile.profile&&<ProfileSummary profile={financialProfile.profile}/>}<button className="btn" onClick={()=>setEditing(true)}>{financialProfile.status==='complete'?'Изменить ответы':'Продолжить анкету'}</button></>;
}
