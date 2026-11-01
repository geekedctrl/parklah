import {Component,lazy,Suspense,useState,type ReactNode} from 'react';
import {Navigate,NavLink,Route,Routes,useLocation} from 'react-router-dom';
import {Activity as ActivityIcon,Car,Home,MapPin,Moon,ParkingCircle,ScanLine,Settings,Sun,Bell,Building2,ClipboardList,Users,ShieldCheck} from 'lucide-react';
import {AnimatePresence,motion} from 'framer-motion';
import {localTime} from './domain';
import {useStore} from './state/store';
import {Toast} from './components/shared';
import {AuthPage,RequireAuth,useAuth} from './auth';

const Signboard=lazy(()=>import('./pages/ParkingPages').then(module=>({default:module.Signboard})));
const HomePage=lazy(()=>import('./pages/HomePage').then(module=>({default:module.HomePage})));
const StaffWorkspace=lazy(()=>import('./pages/StaffWorkspace').then(module=>({default:module.StaffWorkspace})));
const LiveUserWorkspace=lazy(()=>import('./pages/LiveUserWorkspace').then(module=>({default:module.LiveUserWorkspace})));

const nav=[['/','Home',Home],['/reserve','Reserve',ParkingCircle],['/my-parking','My Parking',Car],['/activity','Activity',ActivityIcon],['/profile','Profile',Settings]] as const;
const operatorNav=[['/','Shift overview',Home],['/operations/events','Live events',ScanLine],['/operations/exceptions','Exception queue',ClipboardList],['/operations/handover','Shift handover',ActivityIcon]] as const;
const adminNav=[['/','Campus overview',Home],['/admin/facilities','Facilities & zones',Building2],['/admin/policies','Policies & rates',Settings],['/admin/users','Users & staff',Users],['/admin/reports','Payments & reports',ActivityIcon],['/admin/integrations','Integrations & health',ShieldCheck],['/admin/audit','Audit log',ClipboardList]] as const;

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
        <span className="live-pill"><i/>Parking services</span>
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
        {auth.user?.role==='user'&&nav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`side-link ${isActive?'selected':''}`}><Icon size={18}/>{label}{label==='My Parking'&&s.reservations.some(r=>r.status==='active')&&<span className="nav-dot"/>}</NavLink>)}
        {auth.user?.role==='operator'&&operatorNav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`side-link ${isActive?'selected':''}`}><Icon size={18}/>{label}</NavLink>)}
        {auth.user?.role==='campus_admin'&&adminNav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>`side-link ${isActive?'selected':''}`}><Icon size={18}/>{label}</NavLink>)}
        <div className="side-bottom"><div className="campus-card"><div className="campus-icon"><MapPin size={16}/></div><small>YOUR CAMPUS</small><strong>Sunway Campus</strong><span>{auth.user?.role==='operator'?'Assigned facilities':'Parking services'}</span></div><div className="version">ParkEase MVP 1.0 <span>·</span> Payment sandbox</div><button className="sign-out" onClick={()=>void auth.logout()}>Sign out · {auth.user?.email}</button></div>
      </aside>
      <main className="main">
        <div className="mobile-head"><span>ParkEase</span><button className="icon-btn" onClick={()=>act({type:'theme'})}>{s.theme==='light'?<Moon/>:<Sun/>}</button></div>
        <AnimatePresence mode="wait">
          <motion.div key={location.pathname} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-4}} transition={{duration:.18}}>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback/>}>
                {auth.user?.role==='user'?(location.pathname==='/'?<HomePage/>:<LiveUserWorkspace/>):auth.user?.role==='operator'&&location.pathname.startsWith('/operations')?<StaffWorkspace/>:auth.user?.role==='campus_admin'&&location.pathname.startsWith('/admin')?<StaffWorkspace/>:<RoleHome/>}
              </Suspense>
            </RouteErrorBoundary>
          </motion.div>
        </AnimatePresence>
        <footer className="footer">Parking records are account-backed. External payments remain sandboxed; gate events require a configured campus adapter.</footer>
      </main>
    </div>
    {auth.user?.role==='user'&&<nav className="bottom-nav">{nav.map(([to,label,Icon])=><NavLink key={to} to={to} end={to==='/'} className={({isActive})=>isActive?'active':''}><Icon size={19}/><span>{label}</span></NavLink>)}</nav>}
    {s.notice&&<Toast message={s.notice} clear={()=>act({type:'notice',message:''})}/ >}
  </div></RequireAuth>}/> </Routes>;
}

function RoleHome(){const {user}=useAuth();return <Navigate to={user?.role==='campus_admin'?'/admin':user?.role==='operator'?'/operations':'/'} replace/>;}
function PublicSignboard(){return <Signboard/>;}
