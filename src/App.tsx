import {Component,lazy,Suspense,useEffect,useState,type ReactNode} from 'react';
import {NavLink,Route,Routes,useLocation} from 'react-router-dom';
import {Activity as ActivityIcon,Car,ExternalLink,Home,MapPin,Moon,ParkingCircle,ScanLine,Settings,Sun,Bell} from 'lucide-react';
import {AnimatePresence,motion} from 'framer-motion';
import {localTime} from './domain';
import {useStore} from './state/store';
import {Toast} from './components/shared';
import {AuthPage,RequireAuth,useAuth} from './auth';

const HomePage=lazy(()=>import('./pages/HomePage').then(module=>({default:module.HomePage})));
const ReservePage=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.ReservePage})));
const MyParking=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.MyParking})));
const ActivityPage=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.ActivityPage})));
const ProfilePage=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.ProfilePage})));
const DemoPage=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.DemoPage})));
const Signboard=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.Signboard})));

const nav=[['/','Home',Home],['/reserve','Reserve',ParkingCircle],['/my-parking','My Parking',Car],['/activity','Activity',ActivityIcon],['/profile','Profile',Settings]] as const;

function RouteFallback(){
  return <div className="route-loading" role="status" aria-label="Loading page">
    <span className="loading-line wide"/><span className="loading-line medium"/>
    <div className="loading-card"><span className="loading-line medium"/><span className="loading-line wide"/><span className="loading-line short"/></div>
    <div className="loading-grid"><div className="loading-card"/><div className="loading-card"/></div>
  </div>;
}

class RouteErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};

  static getDerivedStateFromError(){return {failed:true};}

  render(){
    if(this.state.failed)return <section className="route-error" role="alert">
      <span className="eyebrow">PAGE LOAD INTERRUPTED</span>
      <h2>This screen could not be loaded.</h2>
      <p>Your saved parking information is still stored in this browser. Reload the app to try again.</p>
      <button className="btn primary" onClick={()=>window.location.reload()}>Reload ParkEase</button>
    </section>;
    return this.props.children;
  }
}

export function App(){
  const {s,act}=useStore();
  const auth=useAuth();
  const [bell,setBell]=useState(false);
  const location=useLocation();

  return <Routes><Route path="/login" element={<AuthPage/>}/><Route path="/register" element={<AuthPage/>}/><Route path="/verify" element={<AuthPage/>}/><Route path="/reset-password" element={<AuthPage/>}/><Route path="/accept-invitation" element={<AuthPage/>}/><Route path="/signboard" element={<PublicSignboard/>}/><Route path="*" element={<RequireAuth><div className={`app ${s.theme}`}>
    <header className="topbar">
      <NavLink to="/" className="brand"><span className="brand-icon"><ParkingCircle size={21}/></span><span>parkease<span className="brand-dot">.</span><small>UNIVERSITY PARKING</small></span></NavLink>
      <div className="top-right">
        <span className="live-pill"><i/>Simulation live</span>
        <button className="icon-btn" aria-label="Toggle theme" onClick={()=>act({type:'theme'})}>{s.theme==='light'?<Moon/>:<Sun/>}</button>
        <div className="bell-wrap">
          <button className="icon-btn" aria-label="Notifications" onClick={()=>setBell(!bell)}><Bell/>{s.notices.some(n=>!n.read)&&<b/>}</button>
          {bell&&<div className="notification-pop">
            <div className="notification-head"><strong>Notifications</strong><button className="text-button" onClick={()=>act({type:'read'})}>Mark all read</button></div>
            {s.notices.length?s.notices.slice(0,8).map(n=><button className={`notice-row ${n.read?'read':''}`} key={n.id} onClick={()=>act({type:'read',id:n.id})}><span className="notice-dot"/><span><strong>{n.title}</strong><small>{n.message}</small><time>{localTime(n.at,'h:mm a')}</time></span></button>):<p className="muted pad">You're all caught up.</p>}
          </div>}
        </div>
      </div>
    </header>
    <div className="layout">
      <aside className="sidebar">
        <div className="side-label">MENU</div>
        {nav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`side-link ${isActive?'selected':''}`}><Icon size={18}/>{label}{label==='My Parking'&&s.reservations.some(r=>r.status==='active')&&<span className="nav-dot"/>}</NavLink>)}
        {(auth.user?.role==='campus_admin'||auth.user?.role==='operator')&&<NavLink to="/operations" className="side-link"><ScanLine size={18}/>Operations</NavLink>}
        {auth.user?.role==='campus_admin'&&<NavLink to="/admin" className="side-link"><Settings size={18}/>Campus admin</NavLink>}
        <div className="side-bottom"><div className="campus-card"><div className="campus-icon"><MapPin size={16}/></div><small>YOUR CAMPUS</small><strong>University Campus</strong><span>Basement Parking</span></div>{auth.user?.role==='campus_admin'&&<NavLink to="/demo" className="demo-link"><span className="demo-mini">▶</span> Demo controls <ExternalLink size={14}/></NavLink>}<div className="version">ParkEase MVP 1.0 <span>·</span> Simulated</div><button className="sign-out" onClick={()=>void auth.logout()}>Sign out · {auth.user?.email}</button></div>
      </aside>
      <main className="main">
        <div className="mobile-head"><span>ParkEase</span><button className="icon-btn" onClick={()=>act({type:'theme'})}>{s.theme==='light'?<Moon/>:<Sun/>}</button></div>
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.18}}>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback/>}>
                <Routes>
                  <Route path="/" element={auth.user?.role==='driver'?<HomePage/>:<RoleConsole/>}/>
                  {auth.user?.role==='driver'&&<><Route path="/reserve" element={<ReservePage/>}/><Route path="/my-parking" element={<MyParking/>}/><Route path="/activity" element={<ActivityPage/>}/><Route path="/profile" element={<ProfilePage/>}/></>}
                  {auth.user?.role==='campus_admin'&&<Route path="/demo" element={<DemoPage/>}/>}
                  {auth.user?.role==='operator'&&<Route path="/operations" element={<RoleConsole/>}/>}
                  {auth.user?.role==='campus_admin'&&<Route path="/admin" element={<RoleConsole/>}/>}
                  <Route path="*" element={<RoleConsole/>}/>
                </Routes>
              </Suspense>
            </RouteErrorBoundary>
          </motion.div>
        </AnimatePresence>
        <footer className="footer">ParkEase is a student demo. Payments, availability and gate events are simulated.</footer>
      </main>
    </div>
    <nav className="bottom-nav">{nav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>isActive?'active':''}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>
    {s.notice&&<Toast message={s.notice} clear={()=>act({type:'notice',message:''})}/>}<NavLink to="/demo" className="floating-demo"><ScanLine size={16}/> Demo</NavLink>
  </div></RequireAuth>}/> </Routes>;
}

function PublicSignboard(){return <Signboard/>;}
function RoleConsole(){const {user,token}=useAuth();const [data,setData]=useState<unknown>(null),[error,setError]=useState('');useEffect(()=>{if(token?.startsWith('local-demo-')){setData(user?.role==='campus_admin'?[{id:1,email:'driver@parkease.local',role:'driver',active:true},{id:2,email:'operator@parkease.local',role:'operator',active:true},{id:3,email:'admin@parkease.local',role:'campus_admin',active:true}]:{items:[],scope:'Local demo operational status'});return}const endpoint=user?.role==='campus_admin'?'/admin/users':'/operator/plates';fetch(endpoint,{headers:{Authorization:`Bearer ${token}`}}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.detail??'Unable to load operational data');return body}).then(setData).catch(value=>setError(value.message))},[user,token]);return <section className="page-heading"><span className="eyebrow">{user?.role==='campus_admin'?'CAMPUS ADMINISTRATION':'PARKING OPERATIONS'}</span><h1>{user?.role==='campus_admin'?'Campus admin':'Operations console'}</h1><p>{user?.role==='campus_admin'?'Manage campus access and staff accounts. Financial ledger controls are not available here.':'Monitor operational plate and session status. Wallet information is private to drivers.'}</p><div className="card role-console">{error?<p role="alert">{error}</p>:<pre>{data?JSON.stringify(data,null,2):'Loading…'}</pre>}</div></section>;}
