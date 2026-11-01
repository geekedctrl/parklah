import {describe,expect,it} from 'vitest';
import {calculateCheckoutReceipt} from './pricing';

describe('checkout receipt calculations',()=>{
  it('itemizes reserved parking as RM4 paid and RM6 due',()=>{
    const receipt=calculateCheckoutReceipt('reserved');expect(receipt.lines.map(x=>[x.label,x.amountSen,x.paymentStatus])).toEqual([['Reservation fee',400,'paid'],['Parking day rate',600,'due']]);expect(receipt.alreadyPaidSen+receipt.dueNowSen).toBe(receipt.grandTotalSen);expect(receipt.grandTotalSen).toBe(1000);
  });
  it('itemizes walk-in parking as RM3 paid and RM3 due',()=>{
    const receipt=calculateCheckoutReceipt('walkIn');expect(receipt.lines.map(x=>[x.label,x.amountSen,x.paymentStatus])).toEqual([['Walk-in entry payment',300,'paid'],['Remaining day rate',300,'due']]);expect(receipt.alreadyPaidSen+receipt.dueNowSen).toBe(receipt.grandTotalSen);expect(receipt.grandTotalSen).toBe(600);
  });
});
