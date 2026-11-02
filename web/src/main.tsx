import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css'; import './app.css';
import { api, setUnauthorizedHandler } from './api';
import { Icons, applyTheme, savedTheme, setState, useAppState } from './ui';
import { Add, Feed, Login, afterLogin } from './screens1';
import { More, Reports } from './screens2';

applyTheme(savedTheme());
setUnauthorizedHandler(() => setState({ login: null, ready: true }));

const TABS = [['feed', 'Лента', Icons.feed], ['reports', 'Отчёты', Icons.chart], ['add', 'Добавить', Icons.plus], ['more', 'Ещё', Icons.more]] as const;

function App() {
  const { login, ready } = useAppState(); const [tab, setTab] = useState<(typeof TABS)[number][0]>('feed');
  useEffect(() => { api('GET', '/api/me').then(() => afterLogin()).catch(() => setState({ ready: true })); }, []);
  if (!ready) return null;
  if (!login) return <Login />;
  return <>
    <div className="app">{tab === 'feed' ? <Feed /> : tab === 'reports' ? <Reports /> : tab === 'add' ? <Add onDone={() => setTab('feed')} /> : <More />}</div>
    <nav className="tabbar" aria-label="Разделы"><div>{TABS.map(([k, l, ic]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{ic}<span>{l}</span></button>)}</div></nav>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
