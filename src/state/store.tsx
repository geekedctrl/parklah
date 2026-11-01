import {createContext,useContext,useEffect,useReducer,useRef,type ReactNode} from 'react';
import {load,persist,reduce} from '../domain';
import type {State} from '../domain';
import {STATE_STORAGE_KEY} from './persistence';
import {useAuth} from '../auth';

type StoreValue={s:State;act:(a:Parameters<typeof reduce>[1])=>void};
const StoreContext=createContext<StoreValue|null>(null);

export function useStore(){
  const value=useContext(StoreContext);
  if(!value)throw new Error('Provider missing');
  return value;
}

export function Provider({children}:{children:ReactNode}){
  const {user}=useAuth();
  const [state,dispatch]=useReducer(reduce,undefined,load);
  const saved=useRef('');

  const fingerprint=(value:State)=>JSON.stringify({...value,now:0,realRef:0});

  useEffect(()=>{
    if(!user)return;
    const business=fingerprint(state);
    if(business!==saved.current){persist(state);saved.current=business;}
  },[state,user]);

  useEffect(()=>{
    if(!user)return;
    const timer=window.setInterval(()=>dispatch({type:'tick'}),1000);
    return()=>window.clearInterval(timer);
  },[user]);

  useEffect(()=>{
    if(!user)return;
    const onStorage=(event:StorageEvent)=>{
      if(event.key!==STATE_STORAGE_KEY&&event.key!==null)return;
      const latest=load();
      saved.current=fingerprint(latest);
      dispatch({type:'hydrate',state:latest});
    };
    window.addEventListener('storage',onStorage);
    return()=>window.removeEventListener('storage',onStorage);
  },[user]);

  return <StoreContext.Provider value={{s:state,act:dispatch}}>{children}</StoreContext.Provider>;
}
