export type PriceLine={product_id:string|null;name:string;unit:string|null;quantity:number|null;unit_price:number|null;receipt_date:string|null;supplier_name:string;source_batch_id:string};
export function receiptPriceSummary(lines:PriceLine[]){
 const groups=new Map<string,{name:string;unit:string|null;latest:number|null;latestDate:string|null;weightedAverage:number|null;quantity:number;weighted:number;source:string;supplier:string}>();
 for(const line of lines){
  const key=JSON.stringify([line.product_id||line.name,line.unit]);
  let group=groups.get(key);if(!group){group={name:line.name,unit:line.unit,latest:null,latestDate:null,weightedAverage:null,quantity:0,weighted:0,source:line.source_batch_id,supplier:line.supplier_name};groups.set(key,group);}
  if(line.unit_price===null||!Number.isFinite(Number(line.unit_price)))continue;
  if(line.receipt_date&&(group.latestDate===null||line.receipt_date>group.latestDate)){group.latest=Number(line.unit_price);group.latestDate=line.receipt_date;group.source=line.source_batch_id;group.supplier=line.supplier_name;}
  if(line.quantity!==null&&Number(line.quantity)>0){group.quantity+=Number(line.quantity);group.weighted+=Number(line.unit_price)*Number(line.quantity);group.weightedAverage=group.weighted/group.quantity;}
 }
 return [...groups.values()];
}
