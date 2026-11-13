import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database,Json} from './database.types';
import type {CountIngredientName} from './ingredient-usage-names';
import type {InventoryExportSupplier} from './inventory-workbook';
import {operationDeadline} from './operation-deadline';
import {supabase} from './supabase-browser';
import {fieldOptions} from './field-product';

type InventoryExportDatabase=Omit<Database,'public'>&{public:Omit<Database['public'],'Functions'>&{
 Functions:Database['public']['Functions']&{get_count_ingredient_names:{Args:{p_store_id:string};Returns:Json}};
}};
const client=supabase as unknown as SupabaseClient<InventoryExportDatabase>;

export async function readInventoryExportData(storeId:string){
 const permission=await operationDeadline(signal=>client.rpc('authorize_app_feature',{
  p_store_id:storeId,p_feature:'DATA_EXPORT',
 }).abortSignal(signal));
 if(permission.error||permission.data!==true)throw Error('DATA_EXPORT_REQUIRED');
 const [names,directory]=await operationDeadline(signal=>Promise.all([
  client.rpc('get_count_ingredient_names',{p_store_id:storeId}).abortSignal(signal),
  client.rpc('app_workspace',{p_store_id:storeId,p_section:'suppliers'}).abortSignal(signal),
 ]));
 if(names.error||!Array.isArray(names.data))throw Error('INVENTORY_EXPORT_CODES_UNAVAILABLE');
 let suppliers=(directory.data as {suppliers?:InventoryExportSupplier[]}|null)?.suppliers;
 if(directory.error?.code==='42501'){
  suppliers=await fieldOptions(storeId,storeId).then(result=>result.suppliers).catch(()=>undefined);
 }
 if(!Array.isArray(suppliers))throw Error('INVENTORY_EXPORT_SUPPLIERS_UNAVAILABLE');
 return {identities:names.data as unknown as CountIngredientName[],suppliers};
}
