import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Field, Sheet, bump, getState, setState } from './ui';

export function CreateCategorySheet({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
 const [name,setName]=useState(''),[color,setColor]=useState('#0a84ff'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const active=useRef(true);useEffect(()=>()=>{active.current=false;},[]);
 const saving=useRef(false);
 async function save(e:React.FormEvent){
  e.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setError('');
  try{const category=await api('POST','/api/categories',{name:name.trim(),type:'expense',color});if(!active.current)return;setState({cats:[...getState().cats,category]});bump();onCreated(category.id);onClose();}
  catch(e){saving.current=false;if(active.current){setError((e as Error).message);setBusy(false);}}
 }
 return <Sheet title="Новая категория расходов" onClose={()=>{if(!busy)onClose();}}><form onSubmit={save}>
  <Field label="Название категории"><input data-autofocus aria-label="Название категории" required maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="Например: Образование" disabled={busy}/></Field>
  <Field label="Цвет категории"><input aria-label="Цвет категории" type="color" value={color} onChange={e=>setColor(e.target.value)} disabled={busy}/></Field>
  {error&&<div className="err" role="alert">{error}</div>}
  <button className="btn" disabled={busy||!name.trim()}>{busy?'Сохраняем…':'Добавить категорию'}</button>
 </form></Sheet>;
}
