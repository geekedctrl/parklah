import {beforeEach,describe,expect,it} from 'vitest';
import {capacity,getLatestUnresolvedExpiry,isClosed,lowAvailabilityThreshold,normalizePlate,parsePersistedState,reduce,seed,validateNewVehiclePlate} from './domain';
import {config} from './config';

describe('ParkEase parking rules',()=>{
  let s=seed();
  beforeEach(()=>{s=seed();});
  it('starts with 147 public bays and a consistent occupancy split',()=>{
    const c=capacity(s);expect(c.available).toBe(147);expect(c.occupied+c.holds+c.available).toBe(300);expect(lowAvailabilityThreshold).toBe(Math.ceil(config.capacity.total*config.lowThresholdPercent/100));
  });
  it('seeds the wallet opening ledger from the central balance configuration',()=>{
    expect(s.wallet).toBe(config.initialBalance);expect(s.transactions[0]).toMatchObject({type:'initialCredit',amount:config.initialBalance});
  });
  it('advances the display clock silently without replacing the current notice',()=>{
    s={...s,notice:'Reservation confirmed.'};const previous=s.now;s=reduce(s,{type:'tick'});expect(s.now).toBe(previous+1000);expect(s.notice).toBe('Reservation confirmed.');
  });
  it('ignores fractional fast-forward actions so clock ticks cannot create noisy advance notices',()=>{
    const previous=s.now;s=reduce(s,{type:'advance',minutes:1/60});expect(s.now).toBe(previous);expect(s.notice).toBe('');
  });
  it('hydrates a validated cross-tab state without replaying domain transitions',()=>{
    const external=reduce(s,{type:'topup',amount:2000});const received=reduce(s,{type:'hydrate',state:external});expect(received).toBe(external);expect(received.wallet).toBe(7000);expect(received.transactions).toHaveLength(s.transactions.length+1);
  });
  it('persists notification preferences and suppresses new notices without blocking payments',()=>{
    s=reduce(s,{type:'notifications',enabled:false});s=reduce(s,{type:'reserve',vehicleId:'v1'});expect(s.wallet).toBe(4600);expect(s.notices).toHaveLength(0);const legacy={...s};delete (legacy as Partial<typeof s>).notificationsEnabled;expect(parsePersistedState(JSON.stringify(legacy))?.notificationsEnabled).toBe(true);
  });
  it('charges RM4 once and converts a hold to occupied on entry',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});expect(s.wallet).toBe(4600);expect(capacity(s).available).toBe(146);expect(capacity(s).holds).toBe(14);
    s=reduce(s,{type:'enterReserved'});expect(s.wallet).toBe(4600);expect(capacity(s).available).toBe(146);expect(capacity(s).holds).toBe(13);expect(capacity(s).occupied).toBe(141);const session=s.sessions.find(x=>x.status==='active')!;expect(session.gateConfirmed).toBe(false);s=reduce(s,{type:'confirmGate',sessionId:session.id});expect(s.sessions.filter(x=>x.status==='active'&&x.gateConfirmed)).toHaveLength(1);const notices=s.notices.length;s=reduce(s,{type:'confirmGate',sessionId:session.id});expect(s.notices.length).toBe(notices);expect(s.sessions.filter(x=>x.status==='active')).toHaveLength(1);
  });
  it('cancellation refunds RM4 and restores capacity once',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'cancel'});expect(s.wallet).toBe(5000);expect(capacity(s).available).toBe(147);s=reduce(s,{type:'cancel'});expect(s.wallet).toBe(5000);
  });
  it('expiry refunds once and crosses warning thresholds',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'advance',minutes:45});expect(s.notices.some(n=>n.title==='Reservation · 15 minutes left')).toBe(true);s=reduce(s,{type:'advance',minutes:15});expect(s.wallet).toBe(5000);expect(capacity(s).available).toBe(147);s=reduce(s,{type:'advance',minutes:60});expect(s.wallet).toBe(5000);
  });
  it('charges RM3 on walk-in entry and RM3 at exit',()=>{
    s=reduce(s,{type:'enterWalk',vehicleId:'v1'});expect(s.wallet).toBe(4700);expect(capacity(s).available).toBe(146);s=reduce(s,{type:'checkout'});expect(s.wallet).toBe(4400);expect(capacity(s).available).toBe(147);
  });
  it('charges RM6 at reserved exit and reaches RM40 total balance',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'enterReserved'});s=reduce(s,{type:'checkout'});expect(s.wallet).toBe(4000);expect(s.receipt?.total).toBe(1000);expect(capacity(s).available).toBe(147);
  });
  it('blocks bookings at 01:00 and allows them again at 05:00 Malaysia time',()=>{
    const base=new Date('2026-01-01T00:00:00+08:00').getTime();s={...s,now:base};s=reduce(s,{type:'setHour',hour:1,minute:0});s=reduce(s,{type:'reserve',vehicleId:'v1'});expect(s.notice).toMatch(/closed/i);expect(s.reservations).toHaveLength(0);s=reduce(s,{type:'setHour',hour:5,minute:0});s=reduce(s,{type:'reserve',vehicleId:'v1'});expect(s.reservations[0]?.status).toBe('active');
  });
  it('validates persisted state and reconciles elapsed real time',()=>{
    const saved=seed(),loaded=parsePersistedState(JSON.stringify(saved),saved.realRef+30_000);expect(loaded?.now).toBe(saved.now+30_000);expect(parsePersistedState('{"version":1,"wallet":"many"}')).toBeNull();
  });
  it('migrates a v1 parked session without replaying the gate scan',()=>{
    const legacy=reduce(reduce(seed(),{type:'reserve',vehicleId:'v1'}),{type:'enterReserved'});
    const v1={...legacy,version:1 as const,sessions:legacy.sessions.map(({gateConfirmed:_,gateConfirmedAt:__,...session})=>session)};
    const loaded=parsePersistedState(JSON.stringify(v1),v1.realRef+1000);
    expect(loaded?.version).toBe(2);expect(loaded?.sessions[0].gateConfirmed).toBe(true);expect(loaded?.sessions[0].gateConfirmedAt).toBeUndefined();
    const current={...legacy,sessions:legacy.sessions.map(session=>({...session,gateConfirmed:false}))};
    expect(parsePersistedState(JSON.stringify(current))?.sessions[0].gateConfirmed).toBe(false);
  });
  it('rejects persisted capacity values that exceed their pool',()=>{
    const saved=seed();saved.bgWalk=211;expect(parsePersistedState(JSON.stringify(saved))).toBeNull();
  });
  it('rejects persisted wallet balances that disagree with the transaction ledger',()=>{
    const saved=seed();saved.wallet+=1;expect(parsePersistedState(JSON.stringify(saved))).toBeNull();
  });
  it('notifies once when fast-forward crosses closing and reopening boundaries',()=>{
    const base=new Date('2026-02-01T00:00:00+08:00').getTime();s={...s,now:base};s=reduce(s,{type:'setHour',hour:0,minute:44});s=reduce(s,{type:'advance',minutes:1});expect(s.notices.filter(n=>n.title==='Closing soon')).toHaveLength(1);s=reduce(s,{type:'advance',minutes:15});expect(s.notices.filter(n=>n.title==='Parking closed')).toHaveLength(1);s=reduce(s,{type:'setHour',hour:4,minute:59});s=reduce(s,{type:'advance',minutes:1});expect(s.notices.filter(n=>n.title==='Parking reopened')).toHaveLength(1);
  });
  it('reconciles operating notices after elapsed time on reload',()=>{
    s=seed();const base=new Date('2026-03-01T00:30:00+08:00').getTime();s={...s,now:base,realRef:base};const restored=parsePersistedState(JSON.stringify(s),base+5*60*60*1000);expect(restored?.notices.map(n=>n.title)).toEqual(expect.arrayContaining(['Closing soon','Parking closed','Parking reopened']));
  });
  it('never refunds an entered reservation when the parked session outlasts its hold deadline',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'advance',minutes:60});expect(s.wallet).toBe(5000);s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'enterReserved'});s=reduce(s,{type:'advance',minutes:120});expect(s.wallet).toBe(4600);expect(s.transactions.filter(t=>t.type==='reservationRefund')).toHaveLength(1);s=reduce(s,{type:'checkout'});expect(s.wallet).toBe(4000);expect(s.transactions.filter(t=>t.type==='reservationRefund')).toHaveLength(1);expect(s.reservations.find(r=>r.status==='completed')).toBeDefined();expect(getLatestUnresolvedExpiry(s)).toBeUndefined();
  });
  it('accepts compact Malaysian plates and prevents duplicate canonical plates',()=>{
    expect(normalizePlate(' abc1234 ')).toBe('ABC1234');expect(validateNewVehiclePlate('@@@',s.vehicles).error).toMatch(/valid plate/i);expect(validateNewVehiclePlate('wxy1234',s.vehicles).error).toMatch(/already saved/i);s=reduce(s,{type:'addVehicle',plate:'abc1234',label:'Second car'});expect(s.vehicles).toHaveLength(3);s=reduce(s,{type:'addVehicle',plate:'ABC 1234',label:'Duplicate'});expect(s.vehicles).toHaveLength(3);expect(s.notice).toMatch(/already saved/i);
  });
  it('does not remove a vehicle linked to an active reservation or session',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'removeVehicle',id:'v1'});expect(s.vehicles.some(v=>v.id==='v1')).toBe(true);expect(s.notice).toMatch(/active reservation/i);s=reduce(s,{type:'cancel'});s=reduce(s,{type:'removeVehicle',id:'v1'});expect(s.vehicles.some(v=>v.id==='v1')).toBe(false);
  });
  it('clears seeded background occupancy while preserving holds and any own session',()=>{
    s=reduce(s,{type:'clearBackground'});expect(capacity(s).occupied).toBe(0);expect(capacity(s).holds).toBe(13);expect(capacity(s).available).toBe(287);expect(capacity(s).occupied+capacity(s).holds+capacity(s).available).toBe(300);s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'enterReserved'});s=reduce(s,{type:'clearBackground'});expect(capacity(s).occupied).toBe(1);expect(s.sessions.filter(x=>x.status==='active')).toHaveLength(1);s=reduce(s,{type:'restoreTraffic'});expect(capacity(s).available).toBe(146);expect(capacity(s).occupied+capacity(s).holds+capacity(s).available).toBe(300);
  });
  it('keeps an occupied walk-in session until checkout funds are available',()=>{
    s={...s,wallet:config.pricing.walkInEntry};s=reduce(s,{type:'enterWalk',vehicleId:'v1'});expect(s.wallet).toBe(0);const before=capacity(s);s=reduce(s,{type:'checkout'});expect(s.wallet).toBe(0);expect(s.sessions.some(x=>x.status==='active')).toBe(true);expect(capacity(s).occupied).toBe(before.occupied);s=reduce(s,{type:'topup'});s=reduce(s,{type:'checkout'});expect(s.sessions.some(x=>x.status==='active')).toBe(false);const count=s.transactions.length;s=reduce(s,{type:'checkout'});expect(s.transactions).toHaveLength(count);
  });
  it('uses Kuala Lumpur operating boundaries including all closed hours',()=>{
    expect(isClosed(new Date('2026-06-01T00:59:00+08:00').getTime())).toBe(false);expect(isClosed(new Date('2026-06-01T01:00:00+08:00').getTime())).toBe(true);expect(isClosed(new Date('2026-06-01T04:59:00+08:00').getTime())).toBe(true);expect(isClosed(new Date('2026-06-01T05:00:00+08:00').getTime())).toBe(false);
  });
  it('can trigger an active reservation expiry once from the demo panel',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'expireReservation'});expect(s.reservations[0]?.status).toBe('expired');expect(s.wallet).toBe(5000);expect(capacity(s).available).toBe(147);const count=s.transactions.length;s=reduce(s,{type:'expireReservation'});expect(s.transactions).toHaveLength(count);expect(s.notice).toMatch(/no active reservation/i);
  });
  it('explains backward clock changes while active records stay intact',()=>{
    s=reduce(s,{type:'reserve',vehicleId:'v1'});s=reduce(s,{type:'setHour',hour:0,minute:59});expect(s.reservations[0]?.status).toBe('active');expect(s.wallet).toBe(4600);expect(s.notice).toMatch(/active parking records/i);
  });
});
