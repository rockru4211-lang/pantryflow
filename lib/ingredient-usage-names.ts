export type SupplierIngredientName={supplier:string;supplier_id:string|null;name:string;unit:string;specification:string;ingredient_id:string;revision:number;stopped:boolean;supply_revision:number};
export type IngredientUsageNames={id:string;code:string;formal_name:string;count_name:string;recipe_aliases:string[];revision:number;bindings:SupplierIngredientName[];suppliers:{id:string;name:string;stopped:boolean;supply_revision:number}[];products:{id:string;name:string;code:string}[]};
export type CountIngredientName={product_id:string;code:string;count_name:string;names:string[]};
export function usageNamesError(error:unknown){
 const message=String((error as {message?:string})?.message||error);
 if(/REVISION_CONFLICT|INGREDIENT_MATCH_CONFLICT|REQUEST_CONFLICT/.test(message))return '資料已更新，輸入仍保留；請重新讀取後核對。';
 if(/ALIAS_ALREADY_ASSIGNED/.test(message))return '此供應商的品名與規格已對應其他食材，請先核對，避免串錯價格。';
 if(/INVALID_SUPPLIER/.test(message))return '請選擇已建檔的供應商。';
 if(/FORBIDDEN/.test(message))return '目前身分沒有此門市的編輯權限。';
 if(/INVALID_NAMES/.test(message))return '請填正式名稱，並確認別名及單位長度。';
 return '尚未確認儲存，輸入仍保留，請重試。';
}
export function countNameMatches(product:{name?:string;product_code?:string;identity?:CountIngredientName},query:string){
 return [product.name,product.product_code,product.identity?.count_name,product.identity?.code,...(product.identity?.names||[])].join(' ').normalize('NFKC').toLocaleLowerCase().includes(query.trim().normalize('NFKC').toLocaleLowerCase());
}
