import {config} from './config';

export type PaymentStatus='paid'|'due';
export type ReceiptLine={label:string;amountSen:number;paymentStatus:PaymentStatus};
export type CheckoutReceipt={lines:ReceiptLine[];alreadyPaidSen:number;dueNowSen:number;grandTotalSen:number};

export const getReservationFee=()=>config.pricing.reservation;
export const getWalkInEntryCharge=()=>config.pricing.walkInEntry;
export const getWalkInTotalCharge=()=>config.pricing.walkInDay;
export const getWalkInExitDue=()=>config.pricing.walkInDay-config.pricing.walkInEntry;
export const getReservedTotalCharge=()=>config.pricing.reservation+config.pricing.reservedExit;
export const getReservedExitDue=()=>config.pricing.reservedExit;

export function calculateCheckoutReceipt(type:'reserved'|'walkIn'):CheckoutReceipt{
  const lines:ReceiptLine[]=type==='reserved'?
    [{label:'Reservation fee',amountSen:getReservationFee(),paymentStatus:'paid'},{label:'Parking day rate',amountSen:getReservedExitDue(),paymentStatus:'due'}]:
    [{label:'Walk-in entry payment',amountSen:getWalkInEntryCharge(),paymentStatus:'paid'},{label:'Remaining day rate',amountSen:getWalkInExitDue(),paymentStatus:'due'}];
  const alreadyPaidSen=lines.filter(x=>x.paymentStatus==='paid').reduce((n,x)=>n+x.amountSen,0);
  const dueNowSen=lines.filter(x=>x.paymentStatus==='due').reduce((n,x)=>n+x.amountSen,0);
  return {lines,alreadyPaidSen,dueNowSen,grandTotalSen:alreadyPaidSen+dueNowSen};
}

export function formatRinggit(sen:number){return `RM ${(sen/100).toFixed(2)}`;}
