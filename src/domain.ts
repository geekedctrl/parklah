import {formatInTimeZone,fromZonedTime} from 'date-fns-tz';
import {config} from './config';
import {calculateCheckoutReceipt} from './pricing';
import {seed} from './state/seed';
import {parseValidatedState,readPersistedState,writePersistedState} from './state/persistence';

export type Vehicle={id:string;plate:string;label:string;isDefault:boolean};
export type Reservation={id:string;vehicleId:string;plate:string;createdAt:number;expiresAt:number;status:'active'|'entered'|'cancelled'|'expired'|'completed';warnings:number[]};
export type Session={id:string;vehicleId:string;plate:string;reservationId?:string;type:'reserved'|'walkIn';entryAt:number;gateConfirmed:boolean;gateConfirmedAt?:number;exitAt?:number;status:'active'|'completed';entryPaid:number;reservationPaid:number;exitPaid:number};
export type Tx={id:string;at:number;type:string;amount:number;description:string};
export type Notice={id:string;at:number;title:string;message:string;read:boolean};
export type State={version:2;now:number;realRef:number;vehicles:Vehicle[];reservations:Reservation[];sessions:Session[];wallet:number;transactions:Tx[];notices:Notice[];theme:'light'|'dark';notificationsEnabled:boolean;bgReserved:number;bgWalk:number;bgHolds:number;notice:string;receipt?:{plate:string;total:number;paid:number;at:number};receiptDetails?:{lines:{label:string;amountSen:number;paymentStatus:'paid'|'due'}[];alreadyPaidSen:number;dueNowSen:number;grandTotalSen:number}};

export {seed};
export function parsePersistedState(raw:string,realNow=Date.now()):State|null{
  const saved=parseValidatedState(raw);
  if(!saved)return null;
  const elapsed=Math.max(0,realNow-saved.realRef);
  const advanced={...saved,now:saved.now+elapsed,realRef:realNow};
  return addTransitionNotices(saved,reconcile(advanced));
}
export function load():State{
  try{const raw=readPersistedState();if(!raw)return seed();return parsePersistedState(raw)??seed();}
  catch{return seed();}
}
export function persist(state:State){writePersistedState(state);}

export function isClosed(at:number){
  const current=Number(formatInTimeZone(at,config.timezone,'H'))*60+Number(formatInTimeZone(at,config.timezone,'m'));
  const [closedHour,closedMinute]=config.closedFrom.split(':').map(Number);
  const [openHour,openMinute]=config.reopensAt.split(':').map(Number);
  return current>=closedHour*60+closedMinute&&current<openHour*60+openMinute;
}
export function localTime(at:number,pattern='h:mm a'){return formatInTimeZone(at,config.timezone,pattern);}
export function money(sen:number){return `RM ${(sen/100).toFixed(2)}`;}
export const lowAvailabilityThreshold=Math.ceil(config.capacity.total*config.lowThresholdPercent/100);
export function validateNewVehiclePlate(input:string,vehicles:readonly Vehicle[]):{plate:string|null;error:string|null}{
  const plate=normalizePlate(input);
  if(!plate)return {plate:null,error:'Enter a valid plate using letters and numbers.'};
  if(vehicles.some(v=>v.plate.replace(/\s/g,'')===plate.replace(/\s/g,'')))return {plate,error:'That plate is already saved.'};
  return {plate,error:null};
}export function normalizePlate(input:string):string|null{
  const plate=input.trim().toUpperCase().replace(/\s+/g,' ');
  return /^[A-Z0-9]{2,10}$/.test(plate.replace(/\s/g,''))?plate:null;
}

export function capacity(state:State){
  const activeReservations=state.reservations.filter(r=>r.status==='active').length;
  const reservedSessions=state.sessions.filter(x=>x.status==='active'&&x.type==='reserved').length;
  const walkInSessions=state.sessions.filter(x=>x.status==='active'&&x.type==='walkIn').length;
  const holds=state.bgHolds+activeReservations;
  const occupied=state.bgReserved+state.bgWalk+reservedSessions+walkInSessions;
  const freeReserved=config.capacity.reservable-state.bgReserved-state.bgHolds-activeReservations-reservedSessions;
  const freeWalk=config.capacity.walkIn-state.bgWalk-walkInSessions;
  return {holds,occupied,reserved:state.bgReserved+reservedSessions,walkIn:state.bgWalk+walkInSessions,available:Math.max(0,freeReserved)+Math.max(0,freeWalk),freeReserved:Math.max(0,freeReserved),freeWalk:Math.max(0,freeWalk)};
}

export function getLatestUnresolvedExpiry(state:State):Reservation|undefined{
  const expired=state.reservations.filter(r=>r.status==='expired').sort((a,b)=>b.createdAt-a.createdAt)[0];
  if(!expired)return undefined;
  const laterReservation=state.reservations.some(r=>r.createdAt>expired.createdAt);
  const laterSession=state.sessions.some(session=>(session.exitAt??session.entryAt)>expired.createdAt);
  return laterReservation||laterSession?undefined:expired;
}

function tx(state:State,type:string,amount:number,description:string,at=state.now):State{
  const id=`${type}-${at}-${state.transactions.length}`;
  return {...state,wallet:state.wallet+amount,transactions:[{id,at,type,amount,description},...state.transactions]};
}
function notice(state:State,title:string,message:string):State{
  if(!state.notificationsEnabled)return state;
  return {...state,notices:[{id:`n-${state.now}-${state.notices.length}`,at:state.now,title,message,read:false},...state.notices]};
}
function uniqueNotice(state:State,id:string,title:string,message:string):State{
  if(!state.notificationsEnabled||state.notices.some(item=>item.id===id))return state;
  return {...state,notices:[{id,at:state.now,title,message,read:false},...state.notices]};
}
function malaysiaBoundary(day:string,hour:number,minute:number){
  return fromZonedTime(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`,config.timezone).getTime();
}
function addTransitionNotices(before:State,after:State):State{
  let next=after;
  if(after.now>before.now){
    const firstDay=formatInTimeZone(before.now,config.timezone,'yyyy-MM-dd');
    const date=new Date(`${firstDay}T00:00:00Z`);
    for(let i=0;i<370;i++){
      const day=date.toISOString().slice(0,10);
      const events=[
        ['closing-soon',0,45,'Closing soon','ParkEase closes for new arrivals at 1:00 AM.'],
        ['closed',1,0,'Parking closed','ParkEase is closed, reopens at 5:00 AM.'],
        ['reopened',5,0,'Parking reopened','ParkEase is open for reservations and arrivals.']
      ] as const;
      for(const [event,hour,minute,title,message] of events){
        const at=malaysiaBoundary(day,hour,minute);
        if(at>before.now&&at<=after.now)next=uniqueNotice(next,`ops-${day}-${event}`,title,message);
      }
      date.setUTCDate(date.getUTCDate()+1);
      if(date.getTime()>after.now+36*60*60*1000)break;
    }
  }
  const previousAvailable=capacity(before).available;
  const available=capacity(next).available;
  const low=lowAvailabilityThreshold;
  if(previousAvailable>0&&available===0)next=uniqueNotice(next,`availability-full-${next.now}`,'Parking full','No public bays are currently available.');
  else if(previousAvailable>low&&available<=low)next=uniqueNotice(next,`availability-low-${next.now}`,'Availability low',`Only ${available} bays remain across the campus pools.`);
  else if(previousAvailable<=low&&available>low)next=uniqueNotice(next,`availability-recovered-${next.now}`,'Availability recovered','More spaces are available again.');
  return next;
}

export function reconcile(state:State):State{
  let next=state;
  for(const reservation of state.reservations){
    if(reservation.status!=='active')continue;
    if(next.now>=reservation.expiresAt){
      next={...next,reservations:next.reservations.map(r=>r.id===reservation.id?{...r,status:'expired'}:r)};
      next=tx(next,'reservationRefund',config.pricing.reservation,'Expired reservation refund');
      next=notice(next,'Reservation expired',`Your ${money(config.pricing.reservation)} reservation fee has been refunded.`);
      continue;
    }
    const remaining=(reservation.expiresAt-next.now)/60000;
    for(const minutes of config.warningMinutes){
      if(remaining<=minutes&&!reservation.warnings.includes(minutes)){
        next={...next,reservations:next.reservations.map(r=>r.id===reservation.id?{...r,warnings:[...r.warnings,minutes]}:r)};
        next=notice(next,`Reservation · ${minutes} minutes left`,`Arrive before ${localTime(reservation.expiresAt)}.`);
      }
    }
  }
  return next;
}

export type Action=
  |{type:'reserve';vehicleId:string}|{type:'cancel'}|{type:'enterReserved'}|{type:'enterWalk';vehicleId:string}|{type:'checkout'}
  |{type:'tick'}|{type:'advance';minutes:number}|{type:'setHour';hour:number;minute:number}|{type:'traffic';delta:number}
  |{type:'clearBackground'}|{type:'restoreTraffic'}|{type:'expireReservation'}|{type:'topup';amount?:number}
  |{type:'hydrate';state:State}|{type:'confirmGate';sessionId:string}
  |{type:'addVehicle';plate:string;label:string}|{type:'removeVehicle';id:string}|{type:'theme'}
  |{type:'notifications';enabled:boolean}|{type:'read';id?:string}|{type:'reset'}|{type:'notice';message:string};

function applyAction(state:State,action:Action):State{
  if(action.type==='reset')return seed();
  if(action.type==='confirmGate'){
    const session=state.sessions.find(x=>x.id===action.sessionId&&x.status==='active');
    if(!session||session.gateConfirmed)return state;
    return notice({...state,sessions:state.sessions.map(x=>x.id===session.id?{...x,gateConfirmed:true,gateConfirmedAt:state.now}:x),notice:`${session.plate} entry confirmed. View My Parking.`},'Entry confirmed',`${session.plate} entered after a simulated plate scan.`);
  }
  if(action.type==='tick')return reconcile({...state,now:state.now+1000});
  if(action.type==='advance'){
    // Fast-forward is a user-facing whole-minute control. Real-time clock
    // progress is handled by `tick`; accepting fractions here can surface
    // noisy values such as "Advanced 0.0166 minutes" as repeated toasts.
    if(!Number.isSafeInteger(action.minutes)||action.minutes<=0)return state;
    return reconcile({...state,now:state.now+action.minutes*60000,notice:`Advanced ${action.minutes} minutes.`});
  }
  if(action.type==='setHour'){
    const day=formatInTimeZone(state.now,config.timezone,'yyyy-MM-dd');
    const candidate=fromZonedTime(`${day} ${String(action.hour).padStart(2,'0')}:${String(action.minute).padStart(2,'0')}:00`,config.timezone).getTime();
    const hasActive=state.reservations.some(r=>r.status==='active')||state.sessions.some(s=>s.status==='active');
    const message=candidate<state.now&&hasActive?'Clock moved backward. Active parking records and completed payments remain valid; reset the demo for a clean journey.':`Demo time set to ${String(action.hour).padStart(2,'0')}:${String(action.minute).padStart(2,'0')}. Existing events are not reversed.`;
    return reconcile({...state,now:candidate,notice:message});
  }
  if(action.type==='traffic'){
    const c=capacity(state);
    if(action.delta>0){const added=Math.min(action.delta,c.freeWalk);return {...state,bgWalk:state.bgWalk+added,notice:`Walk-in traffic increased by ${added}.`};}
    const removed=Math.min(-action.delta,Math.max(0,state.bgWalk-config.seedOccupancy.walkIn));
    return {...state,bgWalk:state.bgWalk-removed,notice:`Walk-in traffic decreased by ${removed}.`};
  }
  if(action.type==='expireReservation'){
    const reservation=state.reservations.find(r=>r.status==='active');
    if(!reservation)return {...state,notice:'There is no active reservation to expire.'};
    return reconcile({...state,now:Math.max(state.now,reservation.expiresAt),notice:'Reservation expiry triggered. The held bay is released and the fee is refunded once.'});
  }
  if(action.type==='clearBackground')return {...state,bgReserved:0,bgWalk:0,notice:'Background occupied cars cleared. Your own active parking session and reservation holds are preserved.'};
  if(action.type==='restoreTraffic')return {...state,bgReserved:config.seedOccupancy.reserved,bgWalk:config.seedOccupancy.walkIn,bgHolds:config.seedOccupancy.holds,notice:'Seed traffic restored.'};
  if(action.type==='topup'){
    const amount=action.amount??config.demoTopUp;
    return {...tx(state,'topUp',amount,'Demo funds top-up'),notice:`${money(amount)} demo funds added.`};
  }
  if(action.type==='addVehicle'){
    const validation=validateNewVehiclePlate(action.plate,state.vehicles);
    if(validation.error||!validation.plate)return {...state,notice:validation.error??'Enter a valid registration plate.'};
    const plate=validation.plate;
    return {...state,vehicles:[...state.vehicles,{id:crypto.randomUUID(),plate,label:action.label.trim()||'My vehicle',isDefault:false}],notice:`${plate} added.`};
  }
  if(action.type==='removeVehicle'){
    const inUse=state.reservations.some(r=>r.status==='active'&&r.vehicleId===action.id)||state.sessions.some(s=>s.status==='active'&&s.vehicleId===action.id);
    if(inUse)return {...state,notice:'This vehicle is tied to an active reservation or parking session.'};
    return {...state,vehicles:state.vehicles.filter(v=>v.id!==action.id),notice:'Vehicle removed.'};
  }
  if(action.type==='theme')return {...state,theme:state.theme==='light'?'dark':'light'};
  if(action.type==='notifications')return {...state,notificationsEnabled:action.enabled};
  if(action.type==='read')return {...state,notices:state.notices.map(n=>!action.id||n.id===action.id?{...n,read:true}:n)};
  if(action.type==='notice')return {...state,notice:action.message};
  if(action.type==='reserve'){
    const c=capacity(state),vehicle=state.vehicles.find(v=>v.id===action.vehicleId);
    if(!vehicle)return {...state,notice:'Select a saved vehicle.'};
    if(isClosed(state.now))return {...state,notice:'ParkEase is closed, reopens at 5:00 AM'};
    if(state.reservations.some(r=>r.status==='active')||state.sessions.some(s=>s.status==='active'))return {...state,notice:'You already have an active reservation or parking session.'};
    if(!c.freeReserved)return {...state,notice:'Reserved capacity is full.'};
    if(state.wallet<config.pricing.reservation)return {...state,notice:'Insufficient wallet balance. Top up demo funds in Profile.'};
    const reservation:Reservation={id:crypto.randomUUID(),vehicleId:vehicle.id,plate:vehicle.plate,createdAt:state.now,expiresAt:state.now+config.holdMinutes*60000,status:'active',warnings:[]};
    const paid=tx({...state,reservations:[reservation,...state.reservations]},'reservationPayment',-config.pricing.reservation,'60-minute parking reservation');
    return notice({...paid,notice:`Reservation confirmed. ${money(config.pricing.reservation)} charged.`},'Reservation confirmed',`${vehicle.plate} is reserved until ${localTime(reservation.expiresAt)}.`);
  }
  if(action.type==='cancel'){
    const reservation=state.reservations.find(r=>r.status==='active');
    if(!reservation)return state;
    const cancelled={...state,reservations:state.reservations.map(r=>r.id===reservation.id?{...r,status:'cancelled' as const}:r)};
    return notice({...tx(cancelled,'reservationRefund',config.pricing.reservation,'Reservation cancellation refund'),notice:`Reservation cancelled. ${money(config.pricing.reservation)} refunded.`},'Refund issued',`${money(config.pricing.reservation)} has been returned to your wallet.`);
  }
  if(action.type==='enterReserved'){
    const reservation=state.reservations.find(r=>r.status==='active');
    if(!reservation)return {...state,notice:'No eligible active reservation.'};
    if(state.now>=reservation.expiresAt)return reconcile({...state,notice:'Reservation expired. Entry is not available.'});
    if(isClosed(state.now))return {...state,notice:'Gate entry is unavailable while parking is closed.'};
    const session:Session={id:crypto.randomUUID(),vehicleId:reservation.vehicleId,plate:reservation.plate,reservationId:reservation.id,type:'reserved',entryAt:state.now,gateConfirmed:false,status:'active',entryPaid:0,reservationPaid:config.pricing.reservation,exitPaid:0};
    const vehicle=state.vehicles.find(v=>v.id===reservation.vehicleId);
    return {...state,reservations:state.reservations.map(r=>r.id===reservation.id?{...r,status:'entered' as const}:r),sessions:[session,...state.sessions],notice:`Plate recognised: ${vehicle?.plate??reservation.plate}. Gate confirmation in progress.`};
  }
  if(action.type==='enterWalk'){
    const vehicle=state.vehicles.find(v=>v.id===action.vehicleId),c=capacity(state);
    if(!vehicle)return {...state,notice:'Select a saved vehicle.'};
    if(isClosed(state.now))return {...state,notice:'Gate entry is unavailable while parking is closed.'};
    if(state.sessions.some(s=>s.status==='active')||state.reservations.some(r=>r.status==='active'))return {...state,notice:'Finish your current parking journey first.'};
    if(!c.freeWalk)return {...state,notice:'Walk-in capacity is full.'};
    if(state.wallet<config.pricing.walkInEntry)return {...state,notice:'Insufficient wallet balance for entry.'};
    const session:Session={id:crypto.randomUUID(),vehicleId:vehicle.id,plate:vehicle.plate,type:'walkIn',entryAt:state.now,gateConfirmed:false,status:'active',entryPaid:config.pricing.walkInEntry,reservationPaid:0,exitPaid:0};
    const paid=tx({...state,sessions:[session,...state.sessions]},'walkInEntryPayment',-config.pricing.walkInEntry,'Walk-in entry payment');
    return {...paid,notice:`Plate recognised: ${vehicle.plate}. Gate confirmation in progress.`};
  }
  if(action.type==='checkout'){
    const session=state.sessions.find(s=>s.status==='active');
    if(!session)return {...state,notice:'There is no active parking session.'};
    const receipt=calculateCheckoutReceipt(session.type),due=receipt.dueNowSen;
    if(state.wallet<due)return {...state,notice:`Insufficient wallet balance. Top up ${money(due-state.wallet)} in Profile before checkout.`};
    const paid=tx(state,'parkingExitPayment',-due,`${session.plate} parking checkout`);
    const completed:State={...paid,sessions:paid.sessions.map(s=>s.id===session.id?{...s,status:'completed',exitAt:state.now,exitPaid:due}:s),reservations:paid.reservations.map(r=>r.id===session.reservationId?{...r,status:'completed'}:r),receipt:{plate:session.plate,total:receipt.grandTotalSen,paid:receipt.dueNowSen,at:state.now},receiptDetails:receipt,notice:`Checkout complete. ${money(due)} paid.`};
    return notice(completed,'Exit confirmed',`${session.plate} checkout is complete.`);
  }
  return state;
}

export function reduce(state:State,action:Action):State{
  if(action.type==='hydrate')return action.state;
  return addTransitionNotices(state,applyAction(state,action));
}
