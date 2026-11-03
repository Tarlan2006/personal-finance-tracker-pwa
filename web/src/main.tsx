import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css'; import './app.css';
import { api, ApiError, setUnauthorizedHandler } from './api';
import { Icons, applyTheme, savedTheme, setState, useAppState, Sheet } from './ui';
import { Add, Feed, Login, afterLogin } from './screens1';
import { Import, More, Reports } from './screens2';
import { FinancialQuestionnaire } from './onboarding';
import { stopQueue } from './queue';
import { registerServiceWorker } from './service-worker';

applyTheme(savedTheme());
setUnauthorizedHandler(() => {stopQueue();setState({ login: null, name:'',queueKey:'',cats:[],ready: true, financialProfile:null,onboardingRequired:false });});

const TABS = [['feed', 'Лента', Icons.feed], ['reports', 'Отчёты', Icons.chart], ['import', 'Выписка', Icons.upload], ['more', 'Ещё', Icons.more]] as const;

function App() {
  const { login, ready, financialProfile, onboardingRequired } = useAppState(); const [tab, setTab] = useState<(typeof TABS)[number][0]>('feed');
  const [adding,setAdding] = useState(false); const [toast,setToast] = useState('');
  const [startupError,setStartupError]=useState(''),[slowStartup,setSlowStartup]=useState(false);
  useEffect(() => {
    let active=true;const timer=setTimeout(()=>{if(active)setSlowStartup(true);},12000);
    api('GET','/api/me').then(()=>afterLogin()).catch(e=>{
      if(!active)return;
      if(e instanceof ApiError&&e.status===401)setState({ready:true});
      else setStartupError(e instanceof Error?e.message:'Не удалось загрузить приложение');
    }).finally(()=>clearTimeout(timer));
    return ()=>{active=false;clearTimeout(timer);};
  }, []);
  useEffect(() => { if(!toast)return; const timer=setTimeout(()=>setToast(''),3200); return ()=>clearTimeout(timer); },[toast]);
  useEffect(() => { if(!login){setAdding(false);setTab('feed');setToast('');} },[login]);
  if (startupError||!ready) return <main className="app"><h1>Қаржы</h1>{startupError?<div className="err" role="alert">Не удалось запустить приложение: {startupError}</div>:<p role="status">{slowStartup?'Загрузка занимает больше времени. Проверьте подключение к интернету.':'Загружаем приложение…'}</p>}{(startupError||slowStartup)&&<button className="btn" onClick={()=>location.reload()}>Попробовать снова</button>}</main>;
  if (!login) return <Login />;
  if(financialProfile&&onboardingRequired)return <main className="app onboarding-app"><FinancialQuestionnaire key={login} record={financialProfile} onDone={()=>setTab('feed')}/></main>;
  const viewFeed=()=>setTab('feed');
  const imported=(count:number)=>setToast(count ? `Добавлено операций: ${count}` : 'Новых операций нет — отчёт готов');
  return <>
    <main className="app" aria-hidden={adding || undefined}>{tab === 'feed' ? <Feed onImport={()=>setTab('import')} /> : tab === 'reports' ? <Reports /> : tab === 'import' ? <Import onImported={imported} onViewFeed={viewFeed} /> : <More onImported={imported} onViewFeed={viewFeed} />}</main>
    <button className="fab" aria-label="Добавить операцию" title="Добавить операцию" disabled={adding} aria-hidden={adding || undefined} onClick={e=>{e.currentTarget.focus();setAdding(true);}}>{Icons.plus}</button>
    <nav className="tabbar" aria-label="Разделы" aria-hidden={adding || undefined}><div>{TABS.map(([k,l,ic])=><button key={k} className={'tab'+(tab===k?' on':'')} aria-current={tab===k?'page':undefined} onClick={()=>setTab(k)}>{ic}<span>{l}</span></button>)}</div></nav>
    {adding && <Sheet title="Добавить" onClose={()=>setAdding(false)}><Add onDone={()=>{setAdding(false);setTab('feed');setToast('Операция сохранена');}} /></Sheet>}
    {toast && <div className="island-toast" role="status">{Icons.check}<span>{toast}</span></div>}
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
void registerServiceWorker();
