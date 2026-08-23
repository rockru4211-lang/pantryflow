const config=window.PANTRYFLOW_CONFIG||{};
const valid=Boolean(config.supabaseUrl&&config.supabaseAnonKey&&!String(config.supabaseUrl).includes('YOUR_PROJECT'));
if(!valid) throw new Error('CLOUD_CONFIG_REQUIRED');
export const db=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
export async function session(){const {data,error}=await db.auth.getSession();if(error)throw error;return data.session}
