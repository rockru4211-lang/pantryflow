/** Prices entering downstream ledgers are always effective, tax-exclusive prices. */
export type ReceiptDiscount={kind:'PERCENT'|'AMOUNT';value:number;base_price:number|null};
const round=(n:number)=>Math.round((n+Number.EPSILON)*10000)/10000;
export function discountAmounts(price:number|null,quantity:number|null,kind:string,value:number|null){
 if(!['PERCENT','AMOUNT'].includes(kind)||value===null||!Number.isFinite(value)||value<0||value>=1e9||kind==='PERCENT'&&value>100)throw Error('折讓請填有效數字；百分比需介於 0～100。');
 if(price!==null&&(!Number.isFinite(price)||price<0))throw Error('折讓前單價需為零或正數。');
 if(price===null||quantity===null||quantity<=0)return {unit_price:price===null?null:kind==='PERCENT'?round(price*(1-value/100)):null,subtotal:null};
 const before=round(price*quantity),amount=kind==='PERCENT'?round(before*(1-value/100)):round(before-value);
 if(amount<0)throw Error('折讓金額不可超過該列未稅金額。');
 return {unit_price:round(amount/quantity),subtotal:amount};
}
export function validSavedDiscount(line:{discount?:ReceiptDiscount|null;unit_price:number|null;quantity:number|null;subtotal:number|null}){
 const d=line.discount;if(!d)return false;
 try{const a=discountAmounts(d.base_price,line.quantity,d.kind,d.value);return a.unit_price===line.unit_price&&a.subtotal===line.subtotal;}catch{return false;}
}
