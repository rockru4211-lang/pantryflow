import {supabase} from './supabase-browser';
export async function readRecipeImage(file:File,storeId:string):Promise<string>{
 const form=new FormData();form.append('file',file);form.append('storeId',storeId);
 const {data,error}=await supabase.functions.invoke('process-recipe-image',{body:form,signal:AbortSignal.timeout(85000)});
 if(error){let message='圖片辨識未完成，請重試此檔。';try{const response='context' in error?error.context:null;if(response instanceof Response){const body=await response.json();if(typeof body.message==='string')message=body.message;}}catch{}throw Error(message);}
 if(typeof data?.text!=='string'||!data.text.trim())throw Error('圖片未辨識出食譜內容，請重新拍攝。');
 return data.text;
}
