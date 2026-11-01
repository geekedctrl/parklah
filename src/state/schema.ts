import {z} from 'zod';
import {config} from '../config';

const VehicleSchema=z.object({
  id:z.string().min(1).max(100),
  plate:z.string().min(2).max(16),
  label:z.string().max(50),
  isDefault:z.boolean(),
});

const ReservationSchema=z.object({
  id:z.string().min(1).max(100),
  vehicleId:z.string().min(1).max(100),
  plate:z.string().min(2).max(16),
  createdAt:z.number().finite().nonnegative(),
  expiresAt:z.number().finite().nonnegative(),
  status:z.enum(['active','entered','cancelled','expired','completed']),
  warnings:z.array(z.number().int()).max(3),
});

const SessionSchema=z.object({
  id:z.string().min(1).max(100),
  vehicleId:z.string().min(1).max(100),
  plate:z.string().min(2).max(16),
  reservationId:z.string().max(100).optional(),
  type:z.enum(['reserved','walkIn']),
  entryAt:z.number().finite().nonnegative(),
  gateConfirmed:z.boolean().default(false),
  gateConfirmedAt:z.number().finite().nonnegative().optional(),
  exitAt:z.number().finite().nonnegative().optional(),
  status:z.enum(['active','completed']),
  entryPaid:z.number().int().nonnegative(),
  reservationPaid:z.number().int().nonnegative(),
  exitPaid:z.number().int().nonnegative(),
});

const TransactionSchema=z.object({
  id:z.string().min(1).max(160),
  at:z.number().finite().nonnegative(),
  type:z.string().min(1).max(50),
  amount:z.number().int(),
  description:z.string().max(200),
});

const NoticeSchema=z.object({
  id:z.string().min(1).max(160),
  at:z.number().finite().nonnegative(),
  title:z.string().max(100),
  message:z.string().max(500),
  read:z.boolean(),
});

const ReceiptSchema=z.object({
  plate:z.string().max(16),
  total:z.number().int().nonnegative(),
  paid:z.number().int().nonnegative(),
  at:z.number().finite().nonnegative(),
});

const ReceiptDetailsSchema=z.object({
  lines:z.array(z.object({
    label:z.string().max(100),
    amountSen:z.number().int().nonnegative(),
    paymentStatus:z.enum(['paid','due']),
  })).max(5),
  alreadyPaidSen:z.number().int().nonnegative(),
  dueNowSen:z.number().int().nonnegative(),
  grandTotalSen:z.number().int().nonnegative(),
});

const StateV1Schema=z.object({
  version:z.literal(1),
  now:z.number().finite().nonnegative(),
  realRef:z.number().finite().nonnegative(),
  vehicles:z.array(VehicleSchema).max(50),
  reservations:z.array(ReservationSchema).max(2000),
  sessions:z.array(SessionSchema.omit({gateConfirmed:true,gateConfirmedAt:true})).max(2000),
  wallet:z.number().int().nonnegative().max(100_000_000),
  transactions:z.array(TransactionSchema).max(5000),
  notices:z.array(NoticeSchema).max(1000),
  theme:z.enum(['light','dark']),
  notificationsEnabled:z.boolean().optional(),
  bgReserved:z.number().int().min(0).max(config.capacity.reservable),
  bgWalk:z.number().int().min(0).max(config.capacity.walkIn),
  bgHolds:z.number().int().min(0).max(config.capacity.reservable),
  notice:z.string().max(500),
  receipt:ReceiptSchema.optional(),
  receiptDetails:ReceiptDetailsSchema.optional(),
});

export const StateSchema=z.object({
  version:z.literal(2),
  now:z.number().finite().nonnegative(),
  realRef:z.number().finite().nonnegative(),
  vehicles:z.array(VehicleSchema).max(50),
  reservations:z.array(ReservationSchema).max(2000),
  sessions:z.array(SessionSchema).max(2000),
  wallet:z.number().int().nonnegative().max(100_000_000),
  transactions:z.array(TransactionSchema).max(5000),
  notices:z.array(NoticeSchema).max(1000),
  theme:z.enum(['light','dark']),
  notificationsEnabled:z.boolean().default(true),
  bgReserved:z.number().int().min(0).max(config.capacity.reservable),
  bgWalk:z.number().int().min(0).max(config.capacity.walkIn),
  bgHolds:z.number().int().min(0).max(config.capacity.reservable),
  notice:z.string().max(500),
  receipt:ReceiptSchema.optional(),
  receiptDetails:ReceiptDetailsSchema.optional(),
}).superRefine((state,ctx)=>{
  const held=state.bgHolds+state.reservations.filter(r=>r.status==='active').length;
  const reservedInside=state.bgReserved+state.sessions.filter(s=>s.status==='active'&&s.type==='reserved').length;
  const walkInside=state.bgWalk+state.sessions.filter(s=>s.status==='active'&&s.type==='walkIn').length;
  const activeSessions=state.sessions.filter(s=>s.status==='active').length;
  const ledgerBalance=state.transactions.reduce((sum,transaction)=>sum+transaction.amount,0);

  if(held+reservedInside>config.capacity.reservable)ctx.addIssue({code:'custom',message:'Reserved capacity exceeds configured pool'});
  if(walkInside>config.capacity.walkIn)ctx.addIssue({code:'custom',message:'Walk-in capacity exceeds configured pool'});
  if(activeSessions>1)ctx.addIssue({code:'custom',message:'Only one account session can be active'});
  if(ledgerBalance!==state.wallet)ctx.addIssue({code:'custom',message:'Wallet balance does not match its transaction ledger'});
});

export function migratePersistedState(raw:unknown):unknown{
  if(typeof raw!=='object'||raw===null||!('version'in raw))return raw;
  const saved=raw as {version:unknown;sessions?:unknown;notificationsEnabled?:unknown};
  if(saved.version!==1)return raw;
  const parsed=StateV1Schema.safeParse(raw);
  if(!parsed.success)return raw;
  return {
    ...parsed.data,
    version:2,
    notificationsEnabled:parsed.data.notificationsEnabled??true,
    sessions:parsed.data.sessions.map(session=>({...session,gateConfirmed:true})),
  };
}
