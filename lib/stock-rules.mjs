// Shared by production controls and the isolated demo adapter. The database
// enforces the same invariants independently; browser decisions are not authority.
export const stockStates = ['READY','FROZEN','THAWING'];
export const stockStateLabels = {READY:'目前可用',FROZEN:'尚需解凍',THAWING:'解凍中'};
export function quantity(value) { const n=Number(value);if(value===''||value===null||!Number.isFinite(n)||n<=0||n>=1e9)throw Error('INVALID_QUANTITY');return n; }
export function normalizedUnit(value) {const unit=String(value??'').normalize('NFKC').trim();if(!unit||unit.length>30)throw Error('INVALID_UNIT');return unit;}
export function movementPlan(source,amount,state,minutes,now=Date.now()) {
 const q=quantity(amount);if(!stockStates.includes(state)||q>source.quantity)throw Error(q>source.quantity?'INSUFFICIENT_STOCK':'INVALID_STOCK_STATE');
 if(state==='THAWING'&&(!(Number(minutes)>0)||Number(minutes)>43200))throw Error('THAW_DURATION_REQUIRED');
 return {sourceQuantity:source.quantity-q,destinationQuantity:q,state,readyAt:state==='THAWING'?new Date(now+Number(minutes)*60000).toISOString():null};
}
export function availability(positions,unit) {const rows=positions.filter(p=>p.unit===unit);return {total:rows.reduce((n,p)=>n+Number(p.quantity),0),available:rows.filter(p=>p.state==='READY').reduce((n,p)=>n+Number(p.quantity),0)};}
export function shortage(available,safety) {return safety===null||available===null?null:Math.max(0,Number(safety)-Number(available));}
export function reminderTone(count,priorities=[]) {if(!Number(count))return 'neutral';return priorities.includes('immediate')?'immediate':priorities.includes('soon')?'soon':'normal';}
