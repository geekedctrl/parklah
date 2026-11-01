import {config} from '../config';
import type {State} from "../domain";
const initialNow=()=>Date.now();
export function seed():State {const now=initialNow();return {version:2,now,realRef:Date.now(),vehicles:[{id:'v1',plate:'WXY 1234',label:'My Car',isDefault:true},{id:'v2',plate:'VBA 8821',label:'Family Car',isDefault:false}],reservations:[],sessions:[],wallet:config.initialBalance,transactions:[{id:'opening',at:now,type:'initialCredit',amount:config.initialBalance,description:'Demo wallet opening balance'}],notices:[],theme:'light',notificationsEnabled:true,bgReserved:config.seedOccupancy.reserved,bgWalk:config.seedOccupancy.walkIn,bgHolds:config.seedOccupancy.holds,notice:'',};}
