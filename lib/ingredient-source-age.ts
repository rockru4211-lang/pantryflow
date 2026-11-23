export function ingredientHistoryCutoff(now=new Date()){
 const [year,month,day]=now.toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}).split('-').map(Number);
 const limit=new Date(Date.UTC(year-2,month,0)).getUTCDate();
 return [year-2,String(month).padStart(2,'0'),String(Math.min(day,limit)).padStart(2,'0')].join('-');
}

export function isHistoricalIngredientSource(date:string|null|undefined,cutoff:string){
 return !!date&&/^\d{4}-\d{2}-\d{2}/.test(date)&&date.slice(0,10)<cutoff;
}
