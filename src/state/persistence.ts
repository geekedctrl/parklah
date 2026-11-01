import {migratePersistedState,StateSchema} from './schema';
import type {State} from "../domain";

export const STATE_STORAGE_KEY='parkease:mvp1:v1';

export function parseValidatedState(raw:string):State|null{
  try{const result=StateSchema.safeParse(migratePersistedState(JSON.parse(raw)));return result.success?result.data as State:null;}catch{return null;}
}
export function readPersistedState():string|null{return localStorage.getItem(STATE_STORAGE_KEY);}
export function writePersistedState(state:State):void{localStorage.setItem(STATE_STORAGE_KEY,JSON.stringify({...state,realRef:Date.now()}));}
