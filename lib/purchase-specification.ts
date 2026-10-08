/** One human-readable package specification; existing storage retains quantity/unit precision. */
export function usesPackageSpecification(unit:string){return !['g','kg','克','公克','公斤','斤','台斤','臺斤','ml','毫升','cc','l','公升','升','待補單位',''].includes(unit.trim().toLowerCase());}
export function formatPurchaseSpecification(quantity?:string|number|null,unit?:string|null){return quantity&&unit?`${quantity}${({g:'克',kg:'公斤',ml:'毫升',l:'公升',L:'公升'} as Record<string,string>)[unit]||unit}`:'';}
export function parsePurchaseSpecification(value:string){
 const m=value.normalize('NFKC').trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(公斤|公克|台斤|臺斤|斤|克|kg|g|毫升|公升|ml|cc|l|升|包|瓶|罐|盒|袋|支|顆|個|片|卷|份)$/i);
 if(!m||!Number.isFinite(Number(m[1]))||Number(m[1])<=0)return null;
 return {quantity:String(Number(m[1])),unit:m[2].toLowerCase()==='cc'?'ml':m[2]==='升'?'公升':m[2].toLowerCase()};
}
export function validatePurchaseSpecification(value?:string){if(value?.trim()&&!parsePurchaseSpecification(value))throw Error('規格請填「2公斤」「500克」或「750毫升」；不知道可先留白。');}
