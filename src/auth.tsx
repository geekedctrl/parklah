import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {Navigate,useLocation} from 'react-router-dom';

export type Role='driver'|'operator'|'campus_admin';
export type AuthUser={id:number;email:string;role:Role;verified:boolean};
type AuthValue={user:AuthUser|null;token:string|null;loading:boolean;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;message:string;setMessage:(message:string)=>void};
const AuthContext=createContext<AuthValue|null>(null);
const API=import.meta.env.VITE_API_BASE??'/api';
const localDemo=import.meta.env.VITE_LOCAL_DEMO_AUTH==='true';
const demoUsers=[
  {id:1,email:'driver@parkease.local',password:'DriverDemo2026!',role:'driver' as const},
  {id:2,email:'operator@parkease.local',password:'OperatorDemo2026!',role:'operator' as const},
  {id:3,email:'admin@parkease.local',password:'AdminDemo2026!',role:'campus_admin' as const},
];

async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch(`${API}${path}`,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(options.headers??{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.detail??data.message??'Request failed.');
  return data as T;
}
export function useAuth(){const context=useContext(AuthContext);if(!context)throw new Error('AuthProvider missing');return context;}
export function AuthProvider({children}:{children:ReactNode}){
  const [token,setToken]=useState<string|null>(null),[user,setUser]=useState<AuthUser|null>(null),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
  useEffect(()=>{if(localDemo){const id=Number(sessionStorage.getItem('parkease.demoUser'));const saved=demoUsers.find(value=>value.id===id);if(saved){setUser({id:saved.id,email:saved.email,role:saved.role,verified:true});setToken(`local-demo-${saved.id}`)}setLoading(false);return}let live=true;api<{access_token:string;user:AuthUser}>('/auth/refresh',{method:'POST'}).then(value=>{if(live){setToken(value.access_token);setUser(value.user)}}).catch(()=>{}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[]);
  const login=async(email:string,password:string)=>{if(localDemo){const match=demoUsers.find(value=>value.email.toLowerCase()===email.toLowerCase()&&value.password===password);if(!match)throw new Error('Email or password is incorrect');sessionStorage.setItem('parkease.demoUser',String(match.id));setToken(`local-demo-${match.id}`);setUser({id:match.id,email:match.email,role:match.role,verified:true});setMessage('');return}const value=await api<{access_token:string;user:AuthUser}>('/auth/login',{method:'POST',body:JSON.stringify({email,password})});setToken(value.access_token);setUser(value.user);setMessage('')};
  const logout=async()=>{try{if(!localDemo)await api('/auth/logout',{method:'POST'})}finally{sessionStorage.removeItem('parkease.demoUser');setToken(null);setUser(null)}};
  return <AuthContext.Provider value={{user,token,loading,login,logout,message,setMessage}}>{children}</AuthContext.Provider>;
}
export function RequireAuth({children,roles}:{children:ReactNode;roles?:Role[]}){
  const {user,loading}=useAuth(),location=useLocation();
  if(loading)return <div className="auth-loading" role="status">Checking your session…</div>;
  if(!user)return <Navigate to="/login" replace state={{from:location.pathname}}/>;
  if(roles&&!roles.includes(user.role))return <Navigate to="/" replace/>;
  return <>{children}</>;
}

export function AuthPage(){
  const {login,user,message,setMessage}=useAuth(),location=useLocation();
  const [mode,setMode]=useState<'login'|'register'|'forgot'|'reset'|'invite'>('login'),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const params=new URLSearchParams(location.search),tokenParam=params.get('token');
  useEffect(()=>{if(location.pathname==='/verify'&&tokenParam){api('/auth/verify?token='+encodeURIComponent(tokenParam)).then(value=>setMessage((value as {message:string}).message)).catch(err=>setError(err.message))}if(location.pathname==='/reset-password')setMode(tokenParam?'reset':'forgot');if(location.pathname==='/accept-invitation')setMode('invite')},[location.pathname,tokenParam,setMessage]);
  if(user)return <Navigate to="/" replace/>;
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError('');setMessage('');try{
    if(mode==='login'){await login(email,password);return}
    if(localDemo&&mode!=='login')throw new Error('Registration and recovery are disabled in local demo auth. Use one of the demo accounts listed below.');
    if(mode==='register'){const value=await api<{message:string}>('/auth/register',{method:'POST',body:JSON.stringify({email,password})});setMessage(value.message+' In local development, check the API log for the verification token.');setMode('login')}
    if(mode==='forgot'){const value=await api<{message:string}>('/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});setMessage(value.message+' In local development, check the API log for the reset token.')}
    if(mode==='reset'){const value=await api<{message:string}>('/auth/reset-password',{method:'POST',body:JSON.stringify({token:tokenParam,password})});setMessage(value.message);setMode('login')}
    if(mode==='invite'){const value=await api<{message:string}>('/auth/accept-invitation',{method:'POST',body:JSON.stringify({token:tokenParam,password})});setMessage(value.message);setMode('login')}
  }catch(err){setError(err instanceof Error?err.message:'Unable to complete the request.')}finally{setBusy(false)}};
  const title=mode==='login'?'Welcome back':mode==='register'?'Create your driver account':mode==='forgot'?'Reset your password':mode==='invite'?'Activate staff account':'Choose a new password';
  return <div className="auth-screen"><section className="auth-card"><a className="auth-brand" href="/">◉ parkease<span>.</span></a><p className="eyebrow">UNIVERSITY PARKING</p><h1>{location.pathname==='/verify'?'Verify your email':title}</h1>
    {location.pathname==='/verify'?<><p>We’re checking your campus email verification.</p>{error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="auth-success" role="status">{message}</p>}<button className="auth-submit" onClick={()=>window.location.href='/login'}>Continue to sign in</button></>:<>
      <p>{mode==='register'?'Register with an approved campus email. Staff accounts are invitation only.':mode==='login'?'Sign in to manage your vehicles, reservations and parking activity.':mode==='invite'?'Set a password to activate your invited staff account.':mode==='reset'?'Choose a strong password for your account.':'We’ll send instructions if an active account matches.'}</p>
      {localDemo&&<div className="demo-account-list"><b>Local demo accounts</b>{demoUsers.map(account=><small key={account.id}><strong>{account.role}</strong> {account.email} · {account.password}</small>)}</div>}
      <form onSubmit={submit}>{(mode==='login'||mode==='register'||mode==='forgot')&&<label>Campus email<input type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)}/></label>}{(mode==='login'||mode==='register'||mode==='reset'||mode==='invite')&&<label>{mode==='login'?'Password':'New password'}<input type="password" autoComplete={mode==='login'?'current-password':'new-password'} required minLength={mode==='login'?1:12} value={password} onChange={event=>setPassword(event.target.value)}/>{mode!=='login'&&<small>Use at least 12 characters.</small>}</label>}
        {error&&<p className="auth-error" role="alert">{error}</p>}{message&&<p className="auth-success" role="status">{message}</p>}<button className="auth-submit" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in':mode==='register'?'Create account':mode==='forgot'?'Send reset instructions':mode==='invite'?'Activate account':'Update password'}</button>
      </form>{mode==='login'?<div className="auth-links"><button onClick={()=>setMode('forgot')}>Forgot password?</button><button onClick={()=>setMode('register')}>Create driver account</button></div>:<button className="auth-back" onClick={()=>setMode('login')}>Back to sign in</button>}</>}
  </section></div>;
}
