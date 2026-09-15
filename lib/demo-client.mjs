import {managementPolicy} from './management-policy.mjs';
// Isolated local demo transport. No formal users, credentials or network access.
import {adjustKnownStock,stockWorkspace,stockOperation,stockShortages,postStock,snapshotStock,lifecycle,saveImportReview,importRows,quantity,normalizedUnit} from "./demo-operations.mjs";
import {saveDemoFile,loadDemoFile,clearDemoFiles,demoFileUrl} from './demo-files.mjs';
// Unknown requests fail closed; they can never reach the production client.
export const isDemoPath = path => path === '/demo' || path === '/demo/';
const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();
const day = (offset = 0) => new Date(Date.now() + offset * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
const uid = () => `demo-${crypto.randomUUID()}`;
const denied = (message = 'DEMO_UNAVAILABLE') => { throw Object.assign(new Error(message), {code: message}); };
const roles = ['STAFF', 'SUPERVISOR', 'LOGISTICS', 'OWNER'];
export const demoNames = {STAFF: '小安', SUPERVISOR: '怡君', LOGISTICS: '柏翰', OWNER: '雅婷'};
let identity = {role: 'STAFF', businessType: 'SINGLE_RESTAURANT', admin: false};
let businesses = {};
let selectedStore = 'demo-single-1';

const requests = new Map();
const demoStorageKey='pantryflow:isolated-demo:v102';
let restored=false;
function restore(){if(restored||typeof localStorage==='undefined')return;restored=true;try{const saved=JSON.parse(localStorage.getItem(demoStorageKey)||'null');if(saved&&saved.expires>Date.now()){businesses=saved.businesses;for(const [k,v] of saved.requests||[])requests.set(k,v);}}catch{/* Invalid demo state is reset without affecting formal data. */}}
function persist(){if(typeof localStorage==='undefined')return;localStorage.setItem(demoStorageKey,JSON.stringify({businesses,requests:[...requests],expires:Date.now()+7*86400000}));}
const reviewRole=(id=selectedStore)=>memberFor(id)?.role==='OWNER'||memberFor(id)?.role===(identity.businessType==='CHAIN_RESTAURANT'?'SUPERVISOR':'LOGISTICS');
const actor = () => identity.displayName||`${demoNames[identity.role]}（示範）`;
const userId = () => identity.userId||`demo-user-${identity.businessType}-${identity.role}`;
const prefix = () => identity.businessType === 'CHAIN_RESTAURANT' ? 'chain' : 'single';

function seedBusiness(type) {
  const chain = type === 'CHAIN_RESTAURANT';
  const tag = chain ? 'chain' : 'single';
  const names = chain ? ['青禾食堂・中山店', '青禾食堂・信義店'] : ['小日子餐館', '小日子二店'];
  const organization = {id: `demo-org-${tag}`, name: chain ? '青禾餐飲（示範）' : '小日子餐飲（示範）', business_type: type, store_mode: 'MULTI', has_erp: chain, updated_at: stamp()};
  const stores = names.map((name, i) => ({id: `demo-${tag}-${i+1}`, name: `${name}（示範）`, store_code: `DEMO-${tag.toUpperCase()}-${i+1}`, organization_id: organization.id, staff_login_mode: 'NAME_OR_NICKNAME', is_active: true, updated_at: stamp(), settings: {count_cadence: chain ? 'DAILY' : 'MONTHLY', paper_required: chain, blind_count: true, erp_receiving: chain, erp_waste: chain, erp_time: '21:30'}, settings_revision: 1}));
  const spaces = Object.fromEntries(stores.map(store => {
    const supplier = {id: `${store.id}-supplier`, name: '田野蔬果行（示範）', supplier_code: 'F001', contact_name: '王先生（示範）', phone: null, delivery_note: '週一至週六，上午到貨', is_active: true, updated_at: stamp()};
    const products = [['高麗菜', '顆', '冷藏'], ['雞腿肉', '包', '冷藏'], ['義大利麵', '包', '乾貨'], ['橄欖油', '瓶', '乾貨']].map(([name, unit, category], i) => ({id: `${store.id}-product-${i}`, name, base_unit: unit, count_unit: unit, product_code: `P00${i+1}`, specification: i === 1 ? '1 公斤／包' : '標準包裝', suppliers: {name: supplier.name}, current_supplier_id: supplier.id, supplier_name: supplier.name, category, aliases: [], is_active: true, safety_quantity: 3, note: null, updated_at: stamp()}));
    const zones = ['冷藏區', '乾貨區'].map((name, i) => ({id: `${store.id}-zone-${i}`, store_id: store.id, name, sort_order: i, is_active: true, zone_products: products.slice(i*2, i*2+2).map((p,j) => ({product_id: p.id, count_unit: p.base_unit, sort_order: j, products: p}))}));
    const snapshot = {zones: zones.flatMap(z => z.zone_products.map(p => ({zone_id: z.id, zone_name: z.name, product_id: p.product_id, product_name: p.products.name, unit: p.count_unit})))};
    const sessions = [{id: `${store.id}-count-active`, store_id: store.id, status: 'IN_PROGRESS', started_at: stamp(), completed_at: null, snapshot, paper_required: chain, paper_completed_at: null, paper_reviewed_at: null}, {id: `${store.id}-count-history`, store_id: store.id, status: 'CLOSED', started_at: `${day(-7)}T01:00:00Z`, completed_at: `${day(-7)}T02:00:00Z`, snapshot, paper_required: chain, paper_completed_at: chain ? `${day(-7)}T02:10:00Z` : null, paper_reviewed_at: chain ? `${day(-7)}T02:30:00Z` : null}];
    const results = snapshot.zones.map((p,i) => ({id: `${store.id}-entry-${i}`, session_id: sessions[1].id, product_id: p.product_id, zone_id: p.zone_id, zone: p.zone_name, name: p.product_name, unit: p.unit, quantity: i === 0 ? 1 : 8+i, entered_at: sessions[1].completed_at, entered_by: '小安（示範）', opening_quantity: 10, supplier: supplier.name}));
    const items = [{id: `${store.id}-expiry-1`, name: '開封鮮奶', expires_on: day(), zone_id: zones[0].id, zone_name: zones[0].name, attention_reason: '已開封', source: 'REMINDER', unit: '瓶', category: 'urgent', created_at: stamp()}, {id: `${store.id}-expiry-2`, name: '自製番茄醬', expires_on: day(2), zone_id: zones[0].id, zone_name: zones[0].name, attention_reason: '自製食品', source: 'REMINDER', unit: '盒', category: 'upcoming', created_at: stamp()}];
    const waste = [{id: `${store.id}-waste`, name: '高麗菜', quantity: 1, unit: '顆', reason: '品質不佳', note: '外葉腐損，已分開處理', delay_reason: null, source: 'MANUAL', store_name: store.name, zone_name: zones[0].name, expires_on: null, actor_name: '小安（示範）', created_at: stamp(), work_date: day(), reference_price: 45, reference_amount: 45, erp_report: null}];
    const records = [['incident', '冷藏櫃門封條鬆脫', '已先移至另一台冷藏櫃，請安排檢修。'], ['handover', '晚班請確認鮮奶效期', '今天到期的開封鮮奶放在冷藏區第一層。'], ['bulletin', '今日到貨與盤點提醒', '先核對到貨，再完成負責區域的盤點。'], ...(chain ? [['company_task', '完成今日 ERP 驗收', '核對收貨資料後回報完成。']] : [])].map(([kind,title,body]) => ({id: `${store.id}-${kind}`, kind, title, body, category: '其他', status: 'OPEN', created_by: `demo-user-${type}-SUPERVISOR`, actor_name: '怡君（示範）', created_at: stamp(), responsible_id: null, responsible_name: null, due_at: null, expires_at: null, completed_at: null, revision: 1, read_at: null, audience: roles, readers: [], events: []}));
    const members = roles.map(role => ({user_id: `demo-user-${type}-${role}`, display_name: `${demoNames[role]}（示範）`, login_identifier: role === 'STAFF' ? '小安' : role.toLowerCase(), role, is_active: true, is_owner: role === 'OWNER', can_manage_business: role === 'OWNER', uses_pin: role === 'STAFF', email: role === 'STAFF' ? null : `${role.toLowerCase()}@example.invalid`, extra_permissions: [], zone_ids: zones.map(z=>z.id), updated_at: stamp(), pending_count: role === 'STAFF' ? 1 : 0}));
    const batches = [0,1].map(i=>({id: `${store.id}-receipt-${i}`, batch_number: `DEMO-${i+1}`, status: i ? 'COMPLETED' : 'OCR_DONE', uploaded_at: stamp(), work_date: day(), erp_required: chain, erp_completed_at: null, erp_completed_by: null, pages: 1, supplier: supplier.name, ocr_status: 'SUCCEEDED', review_allowed: true, retry_allowed: false, job_status: 'SUCCEEDED', review_saved: !!i}));
    const fields = Object.fromEntries(batches.map(b=>[b.id, receiptFields(b.id, products, supplier.name)]));
    const movement = {id: `${store.id}-loan`, from_store_id: stores[1].id, to_store_id: stores[0].id, from_name: stores[1].name, to_name: stores[0].name, kind: 'LOAN', name: '高麗菜', quantity: 3, unit: '顆', returned_quantity: 0, expected_return_on: day(2), status: 'OPEN', revision: 1, actor_name: '小安（示範）', created_at: stamp(), closed_at: null, reference_price: 45, events: []};
    return [store.id, {products, suppliers: [supplier], zones, sessions, drafts: [], progress: [], results, discrepancies: [], items, risks: [{id: `${store.id}-risk`, name: '冷藏櫃第一層', zone_id: zones[0].id, zone_name: zones[0].name, detail: '檢查開封與自製食材', cadence: 'DAILY', is_active: true, due: true, updated_at: stamp()}], waste, used: [], issues: [], records, members, invitations: [], delegations: [], batches, fields, movements: [movement], audit: []}];
  }));
  return {organization, stores, spaces};
}

function receiptFields(id, products, supplier) {
  const row = (key, name, value) => ({id: `${id}-${key}-${name}`, row_key: key, field_name: name, raw_value: value, value, confidence: 0.98, corrected: false, source_region: null, review_status: 'PENDING'});
  return [row('document','supplier_name',supplier), row('document','receipt_date',day()), row('document','document_number','示範貨單-001'), row('document','total_inc_tax',450), ...products.slice(0,2).flatMap((p,i)=>[row(`row-${i}`,'product',p.name), row(`row-${i}`,'specification',p.specification), row(`row-${i}`,'quantity',5), row(`row-${i}`,'unit',p.base_unit), row(`row-${i}`,'unit_price_ex_tax',45), row(`row-${i}`,'subtotal_ex_tax',225),row(`row-${i}`,'tax',0),row(`row-${i}`,'total_inc_tax',225)])];
}
function business() { restore();return businesses[identity.businessType] ||= seedBusiness(identity.businessType); }
function space(id = selectedStore, archived = false) { const value = business().spaces[id]; if (!business().stores.some(x=>x.id===id&&(x.is_active||archived)) || !value || !value.members.some(m=>m.user_id===userId()&&m.is_active)) denied('FORBIDDEN'); return value; }
const fieldRole = (id=selectedStore) => ['STAFF','SUPERVISOR'].includes(memberFor(id)?.role);
const memberFor = (id=selectedStore) => business().spaces[id]?.members.find(m=>m.user_id===userId());
const policy = (id=selectedStore) => managementPolicy(memberFor(id)?.role,identity.businessType,memberFor(id)?.can_manage_business===true);
const management = (id=selectedStore) => policy(id).can_manage_stores;
const feature = (id,name) => memberFor(id)?.role!=='STAFF'||memberFor(id)?.extra_permissions.includes(name);
const canMaintain = (id=selectedStore) => ['OWNER','SUPERVISOR'].includes(memberFor(id)?.role) || (memberFor(id)?.role === 'LOGISTICS' && identity.businessType === 'SINGLE_RESTAURANT');
function requireRole(ok) { if (!ok) denied('FORBIDDEN'); }

export function configureDemo(role, businessType, admin = false) {
  if (!roles.includes(role) || !['SINGLE_RESTAURANT','CHAIN_RESTAURANT'].includes(businessType)) denied('FORBIDDEN');
  identity = {role, businessType, admin:false,userId:`demo-user-${businessType}-${role}`};
  if(admin&&role!=='STAFF')for(const s of Object.values(business().spaces)){const m=s.members.find(m=>m.user_id===userId());if(m)m.can_manage_business=true;}
  selectedStore = business().stores.find(s=>s.is_active&&memberFor(s.id)?.is_active)?.id||`demo-${prefix()}-1`;
  identity.role=memberFor(selectedStore)?.role||role;
  return demoContext();
}
export function demoContext() {
  const b = business();
  return clone({user: {id: userId(), email: `${identity.role.toLowerCase()}@example.invalid`, app_metadata: {}, user_metadata: {}, aud: 'demo', created_at: stamp()}, profile: {display_name: actor(), role: identity.role}, stores: b.stores.filter(s=>(s.is_active||!b.stores.some(a=>a.is_active&&memberFor(a.id)?.is_active))&&b.spaces[s.id].members.some(m=>m.user_id===userId()&&m.is_active)).map(s=>({...s, business_type: identity.businessType, has_erp: b.organization.has_erp, store_mode: b.organization.store_mode, role:memberFor(s.id).role,...policy(s.id), linked_store_count: b.stores.length, can_manage_business: management(s.id), is_business_responsible:memberFor(s.id)?.is_owner===true, permissions: {reports_view: !!feature(s.id,'REPORTS_VIEW'), data_export: !!feature(s.id,'DATA_EXPORT')}}))});
}
export function selectDemoStore(id) { space(id); selectedStore = id;identity.role=memberFor(id).role; }
export function resetDemo() {if(typeof localStorage!=='undefined')localStorage.removeItem(demoStorageKey);businesses = {}; requests.clear(); return clearDemoFiles(); }


function allowsArchive(name,args){return name==='app_workspace'&&['business','store-lifecycle','store-archive','archived-stores','archived-transfers'].includes(args.p_section)||name==='app_operation'&&['store.delete','store.deactivate','store.restore','movement.return','movement.exchange'].includes(args.p_action);}
function demoStoreReferences(id){const s=business().spaces[id];return [['store_memberships',s.members],['count_zones',s.zones],['inventory_count_sessions',s.sessions],['receipt_upload_batches',s.batches],['store_movements',s.movements],['waste_records',s.waste],['expiry_current',s.items],['app_records',s.records],['inventory_import_files',s.importFiles||[]],['audit_logs',s.audit]].filter(([,v])=>v.length).map(([source,v])=>({source,count:v.length}));}

function dashboard(id) {
  const s = space(id);
  return {count: s.sessions[0], count_items: s.products.length, count_completed: s.sessions.filter(c=>c.status==='CLOSED').length, receipt_pending: s.batches.filter(b=>!b.review_saved).length, receipt_issues: 0, expiry_urgent: s.items.filter(i=>i.category==='urgent').length, incidents: s.records.filter(r=>r.kind==='incident'&&r.status!=='COMPLETE').length, handover: s.records.filter(r=>r.kind==='handover'&&r.status!=='COMPLETE').length, erp_pending: business().organization.has_erp ? s.batches.filter(b=>b.review_saved&&!b.erp_completed_at).length+s.waste.filter(w=>!w.erp_report).length : 0, month_receipt_amount: identity.role === 'STAFF' ? null : s.batches.filter(b=>b.review_saved).length*450, month_waste_amount: identity.role === 'STAFF' ? null : s.waste.reduce((n,w)=>n+(w.reference_amount||0),0), bulletins: s.records.filter(r=>r.kind==='bulletin'), shortages:stockShortages(s),expiry_upcoming:s.items.filter(i=>i.category==='upcoming').length,thaw_due:(s.positions||[]).filter(p=>p.state==='THAWING'&&p.quantity>0&&Date.parse(p.ready_at)<=Date.now()).length,reminder_priorities:{expiry:[s.items.some(i=>i.category==='urgent')?'immediate':'soon'],shortages:['immediate'],tasks:[s.movements.some(m=>m.status==='OPEN'&&m.expected_return_on<day())?'immediate':'normal']}};
}
function workspace(id, section, filter={}) {
  const s = space(id,['business','store-lifecycle','store-archive','archived-stores','archived-transfers'].includes(section)); const b = business();
  if(section==='store-lifecycle'){space(filter.id,true);requireRole(management(filter.id));return {store:b.stores.find(x=>x.id===filter.id),references:demoStoreReferences(filter.id)};}
  if(section==='archived-stores')return {stores:b.stores.filter(x=>!x.is_active&&memberFor(x.id)?.is_active)};
  if(section==='store-archive')return {role:memberFor(id).role,store:b.stores.find(x=>x.id===id),can_settle:['STAFF','SUPERVISOR'].includes(memberFor(id).role),counts:s.sessions.map(c=>({...c,lines:s.results.filter(r=>r.session_id===c.id)})),receipts:s.batches.map(r=>({...r,name:r.batch_number,created_at:r.uploaded_at,lines:[],fields:(s.fields[r.id]||[]).filter(f=>memberFor(id).role!=='STAFF'&&identity.businessType==='SINGLE_RESTAURANT'||['product','raw_product_name','supplier_name','receipt_date','document_number','quantity','unit','specification'].includes(f.field_name)).map(f=>({...f,value:f.value}))})),expiry:s.items.map(x=>({...x,zone:x.zone_name,resolved:false})),waste:s.waste.map(({reference_price:price,reference_amount:amount,...w})=>({...w,reference_price:memberFor(id).role!=='STAFF'&&identity.businessType==='SINGLE_RESTAURANT'?price:null,reference_amount:memberFor(id).role!=='STAFF'&&identity.businessType==='SINGLE_RESTAURANT'?amount:null})),movements:s.movements.map(({reference_price:price,...m})=>({...m,reference_price:memberFor(id).role!=='STAFF'&&identity.businessType==='SINGLE_RESTAURANT'?price:null}))};
  if(section==='archived-transfers')return {records:s.movements,units:[],products:[],stores:[],has_erp:true};
  const recordKinds = {incidents:'incident',handover:'handover',bulletins:'bulletin','company-tasks':'company_task'};
  if (recordKinds[section]) return {records: s.records.filter(r=>r.kind===recordKinds[section])};
  if (['activity','tasks','notifications'].includes(section)) return {records:s.records};
  if(section==='stock')return stockWorkspace(s);
  if (section === 'transfers') return {units:s.units||[],records:s.movements, stores:b.stores.filter(x=>x.id!==id&&x.is_active), products:s.products.filter(p=>p.is_active).map(p=>({...p,unit:p.base_unit})), has_erp:b.organization.has_erp};
  if (section === 'transfer-search') return {stores:b.stores.filter(x=>x.id!==id&&x.is_active).map(store=>({...store,products:b.spaces[store.id].products.filter(p=>p.is_active&&p.name.includes(filter.search||'')).map(p=>({id:p.id,name:p.name,unit:p.base_unit,stock:snapshotStock(b.spaces[store.id],p),states:(b.spaces[store.id].positions||[]).filter(x=>x.product_id===p.id&&x.quantity>0)}))}))};
  if (section === 'catalog' || section === 'suppliers') return {lifecycle_allowed:canMaintain(id),editable:['OWNER','LOGISTICS'].includes(identity.role)&&identity.businessType==='SINGLE_RESTAURANT',products:s.products,suppliers:s.suppliers};
  if (section === 'mappings') return {editable:canMaintain(id),lines:[],products:s.products.map(p=>({...p,unit:p.base_unit})),rules:[]};
  if(section==='business')requireRole(management(id));
  if (['business','settings'].includes(section)) return {...(section==='business'?{organization:b.organization,stores:b.stores.filter(x=>memberFor(x.id)?.is_active&&management(x.id)).map(x=>({...x,can_delete:demoStoreReferences(x.id).length===0}))}:{}), settings:b.stores.find(x=>x.id===id).settings, editable:management(id), revision:b.stores.find(x=>x.id===id).settings_revision, devices:[]};
  if (['members','permissions'].includes(section)) { requireRole(policy(id).can_manage_members); return {members:s.members.filter(m=>m.is_active).map(m=>({...m,is_enterprise_admin:m.is_owner})),inactive_members:s.members.filter(m=>!m.is_active),zones:s.zones,candidates:management(id)?[...new Map(Object.values(b.spaces).flatMap(x=>x.members).filter(m=>m.is_active&&!s.members.some(h=>h.user_id===m.user_id)).map(m=>[m.user_id,m])).values()]:[],invitations:s.invitations,delegations:s.delegations}; }
  if (section === 'audit') { requireRole(management(id)); return {events:s.audit}; }
  if (section === 'reports') {
    requireRole(feature(id,'REPORTS_VIEW'));
    const receipts = s.batches.filter(b=>b.review_saved).map(b=>({id:b.id,source_batch_id:b.id,receipt_date:day(),document_number:b.batch_number,supplier_name:b.supplier,total_inc_tax:450}));
    return {counts:s.sessions.filter(c=>c.status==='CLOSED'),receipts,lines:receipts.flatMap(r=>s.products.slice(0,2).map(p=>({id:`${r.id}-${p.id}`,receipt_id:r.id,source_batch_id:r.id,product_id:p.id,name:p.name,quantity:5,unit:p.base_unit,unit_price:45,amount:225,receipt_date:day(),supplier_name:r.supplier_name,inventory_status:'POSTED'})))};
  }
  denied();
}

function operation(id, action, data) {
  const s=space(id,['store.delete','store.deactivate','store.restore','movement.return','movement.exchange'].includes(action)), b=business();
  const audit=()=>s.audit.unshift({id:uid(),action,actor_name:actor(),entity_type:'示範操作',entity_id:data.id||id,old_value:null,new_value:clone(data),created_at:stamp()});
  if(['store.delete','store.deactivate','store.restore'].includes(action)){
    space(data.id,true);requireRole(management(data.id));const target=b.stores.find(x=>x.id===data.id);if(data.name!==target.name||data.store_code!==target.store_code||data.updated_at!==target.updated_at)denied('REVISION_CONFLICT');
    if(action==='store.delete'){if(demoStoreReferences(data.id).length)denied('STORE_REFERENCED_USE_DEACTIVATE');b.stores=b.stores.filter(x=>x.id!==data.id);delete b.spaces[data.id];}else{target.is_active=action==='store.restore';target.updated_at=stamp();}audit();return {id:data.id,action,is_active:action==='store.restore'};
  }
  if(action==='receipt.edit-card'){
   requireRole(reviewRole(id));const batch=s.batches.find(b=>b.id===data.batch_id);if(!batch)denied('RECEIPT_REVIEWER_REQUIRED');if(batch.review_saved||batch.status==='COMPLETED')denied('PUBLISHED_RECEIPT_IMMUTABLE');if(data.run_id!==`${batch.id}-ocr`)denied('OCR_VERSION_CHANGED');
   const fields=(s.fields[batch.id]||[]).filter(f=>f.row_key===data.row_key);if(!fields.length||data.fields.length!==fields.length||new Set(data.fields.map(f=>f.id)).size!==fields.length)denied('REVISION_CONFLICT');
   const mappings=clone(batch.mappings||s.products.slice(0,2).map((p,i)=>({row_key:`row-${i}`,product_id:p.id,name:p.name,code:p.product_code,unit:p.base_unit,specification:p.specification})));const old=mappings.find(m=>m.row_key===data.row_key);
   if((old?.product_id||null)!==(data.previous_product_id||null))denied('REVISION_CONFLICT');
   for(const c of data.fields){const f=fields.find(f=>f.id===c.id);if(!f||JSON.stringify(f.value??null)!==JSON.stringify(c.old))denied('REVISION_CONFLICT');if(['quantity','unit_price_ex_tax','subtotal_ex_tax','tax','total_inc_tax'].includes(f.field_name)&&c.value!==null&&typeof c.value!=='number')denied('NUMBER_REQUIRED');}
   for(const c of data.fields){const f=fields.find(f=>f.id===c.id);if(JSON.stringify(f.value)!==JSON.stringify(c.value))Object.assign(f,{value:c.value,corrected:true});}
   batch.mappings=mappings;if(data.mapping_mode!=='KEEP'&&data.row_key!=='document'){batch.mappings=mappings.filter(m=>m.row_key!==data.row_key);let product;
    if(data.mapping_mode==='CREATE'){requireRole(identity.businessType!=='CHAIN_RESTAURANT');const name=fields.find(f=>f.field_name==='product')?.value,unit=fields.find(f=>f.field_name==='unit')?.value;if(!name||!unit)denied('PRODUCT_NAME_AND_UNIT_REQUIRED');product=s.products.find(p=>p.name===name&&p.base_unit===unit&&p.is_active);if(!product){product={id:uid(),name,base_unit:unit,count_unit:unit,specification:fields.find(f=>f.field_name==='specification')?.value||'',aliases:[],is_active:true,updated_at:stamp()};s.products.push(product);}}
    if(data.mapping_mode==='SELECT'){product=s.products.find(p=>p.id===data.product_id&&p.is_active);if(!product)denied('PRODUCT_NOT_IN_ORGANIZATION');}
    if(product)batch.mappings.push({row_key:data.row_key,product_id:product.id,name:product.name,unit:product.base_unit,specification:product.specification});
   }audit();return {id:batch.id,row_key:data.row_key,saved:true};
  }
  if(action==='product.edit-basic'){
   requireRole(canMaintain(id));const p=s.products.find(p=>p.id===data.id);if(!p)denied('PRODUCT_NOT_FOUND');if(p.updated_at!==data.updated_at)denied('REVISION_CONFLICT');if(!String(data.name||'').trim()||!String(data.unit||'').trim())denied('INVALID_PRODUCT_BASIC');
   Object.assign(p,{name:data.name.trim(),count_unit:data.unit.trim(),specification:data.specification||null,updated_at:stamp()});for(const z of s.zones)for(const zp of z.zone_products)if(zp.product_id===p.id){zp.count_unit=p.count_unit;zp.products=p;}audit();return p;
  }
  if(action.startsWith('stock.')){const r=stockOperation(s,action,data,{maintain:canMaintain(id),field:fieldRole(id)});audit();return r;}
  if(action==='product.lifecycle'){requireRole(canMaintain(id));const r=lifecycle(s,data);audit();return r;}
  if (action.startsWith('record.')) {
    let record=s.records.find(r=>r.id===data.id);
    if (action==='record.create') {
      requireRole(!['bulletin','company_task'].includes(data.kind)||identity.role!=='STAFF');
      record={id:uid(),kind:data.kind,title:data.title,body:data.body,category:data.category,status:'OPEN',created_by:userId(),actor_name:actor(),created_at:stamp(),responsible_id:null,responsible_name:null,due_at:null,expires_at:data.expires_at||null,completed_at:null,revision:1,read_at:null,audience:data.audience||roles,readers:[],events:[]};s.records.unshift(record);
    } else {
      if(!record)denied();
      if(action==='record.read'){record.read_at=stamp();record.readers.push({display_name:actor(),read_at:stamp()});}
      else if(['record.take','record.complete'].includes(action)){if(data.revision!==record.revision)denied('REVISION_CONFLICT');record.status=action==='record.complete'?'COMPLETE':'IN_PROGRESS';record.responsible_id=userId();record.responsible_name=actor();if(action==='record.complete')record.completed_at=stamp();record.revision++;record.events.push({id:uid(),action,note:data.note,actor_name:actor(),created_at:stamp()});}
      else denied();
    } audit();return record;
  }
  if (action.startsWith('movement.')) {
    requireRole(fieldRole(id));let record=s.movements.find(r=>r.id===data.id);
    if(action==='movement.create') {
      const other=b.stores.find(x=>x.id===data.other_store_id&&x.is_active);if(!other||other.id===id||!(Number(data.quantity)>0))denied();
      const p=Object.values(b.spaces).flatMap(x=>x.products).find(p=>p.id===data.product_id&&p.is_active);if(p&&!s.products.some(x=>x.id===p.id))s.products.push(clone(p));if(data.product_id&&!p)denied('INVALID_PRODUCT');const unit=normalizedUnit(data.unit);const qty=quantity(data.quantity);postStock(s,p,unit,data.mode==='loan'?qty:-qty);s.units=[...new Set([...(s.units||[]),unit])];
      const outgoing=data.mode!=='loan',here=b.stores.find(x=>x.id===id);
      record={id:uid(),from_store_id:outgoing?id:other.id,to_store_id:outgoing?other.id:id,from_name:outgoing?here.name:other.name,to_name:outgoing?other.name:here.name,kind:data.mode==='move'?'TRANSFER':'LOAN',product_id:p?.id||null,name:data.name||s.products.find(p=>p.id===data.product_id)?.name,quantity:Number(data.quantity),unit:data.unit,returned_quantity:0,expected_return_on:data.expected_return_on||null,status:data.mode==='move'?'COMPLETE':'OPEN',revision:1,actor_name:actor(),created_at:stamp(),closed_at:null,reference_price:null,events:[]};s.movements.unshift(record);space(other.id).movements.unshift(record);
    } else {
      if(!record||record.status!=='OPEN'||record.revision!==data.revision)denied('REVISION_CONFLICT');
      const qty=Number(data.quantity);if(!(qty>0)||(action==='movement.return'&&qty>record.quantity-record.returned_quantity))denied();if(action==='movement.return')postStock(s,s.products.find(p=>p.id===record.product_id),record.unit,id===record.to_store_id?-qty:qty);if(action==='movement.exchange'){record.status='EXCHANGED';record.closed_at=stamp();s.units=[...new Set([...(s.units||[]),normalizedUnit(data.unit)])];}
      if(action==='movement.return')record.returned_quantity+=qty;record.revision++;if(record.returned_quantity===record.quantity){record.status=action==='movement.exchange'?'EXCHANGED':'RETURNED';record.closed_at=stamp();}
      record.events.push({id:uid(),action:action==='movement.exchange'?'EXCHANGE':'RETURN',name:data.name||record.name,quantity:qty,unit:data.unit||record.unit,actor_name:actor(),created_at:stamp()});
    }audit();return record;
  }
  if (action==='product.save'||action==='supplier.save') {
    requireRole(canMaintain(id));const list=action==='product.save'?s.products:s.suppliers;let item=list.find(x=>x.id===data.id);if(!item){item={id:uid()};list.push(item);}Object.assign(item,data,{id:item.id,updated_at:stamp()});if(action==='product.save')Object.assign(item,{base_unit:data.unit,product_code:data.code,current_supplier_id:data.supplier_id||null,supplier_name:s.suppliers.find(x=>x.id===data.supplier_id)?.name||null});audit();return item;
  }
  if (['business.save','store.save','settings.save'].includes(action)) {
    requireRole(management(id));if(action==='business.save')requireRole(memberFor(id)?.role==='OWNER'||memberFor(id)?.is_owner);const store=b.stores.find(x=>x.id===id);
    if(action==='business.save')Object.assign(b.organization,data);
    if(action==='store.save'){if(data.is_active!==undefined&&data.is_active!==store.is_active)denied('USE_STORE_LIFECYCLE');Object.assign(store,{name:data.name,staff_login_mode:data.staff_login_mode,updated_at:stamp()});}
    if(action==='settings.save'){Object.assign(store.settings,data.settings);store.settings_revision++;}audit();return {saved:true};
  }
  if(action==='store.create'){
    requireRole(management(id));const name=String(data.name||'').trim();if(!name||name.length>160)denied('INVALID_STORE');
    const store={id:uid(),name,store_code:'S'+crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),organization_id:b.organization.id,staff_login_mode:'NAME_OR_NICKNAME',is_active:true,updated_at:stamp(),settings:{blind_count:true,count_cadence:identity.businessType==='CHAIN_RESTAURANT'?'DAILY':'MONTHLY',paper_required:identity.businessType==='CHAIN_RESTAURANT',remember_device:true,reauth_days:7},settings_revision:1};
    const owners=[...new Map(Object.values(b.spaces).flatMap(s=>s.members).filter(m=>m.is_active&&m.can_manage_business&&m.is_owner).map(m=>[m.user_id,m])).values()];
    const members=[clone(memberFor(id)),...owners.filter(m=>m.user_id!==userId()).map(clone)].map(m=>({...m,can_manage_business:true,zone_ids:[],pending_count:0,updated_at:stamp()}));
    b.stores.push(store);b.spaces[store.id]={products:[],suppliers:[],zones:[],sessions:[],drafts:[],progress:[],results:[],discrepancies:[],items:[],risks:[],waste:[],used:[],issues:[],records:[],members,invitations:[],delegations:[],batches:[],fields:[],movements:[],audit:[]};b.organization.store_mode='MULTI';audit();return {id:store.id,store};
  }
  if (['member.save','member.offboard','member.assign'].includes(action)) {
    requireRole(policy(id).can_manage_members);let member=s.members.find(m=>m.user_id===data.user_id);
    if(action==='member.assign'){requireRole(management(id));if(member)denied('REVISION_CONFLICT');const existing=Object.values(b.spaces).flatMap(x=>x.members).find(m=>m.user_id===data.user_id&&m.is_active);if(!existing)denied('MEMBER_NOT_FOUND');member={...clone(existing),can_manage_business:data.role==='OWNER',extra_permissions:[],zone_ids:[],pending_count:0};}
    if(!member)denied('MEMBER_NOT_FOUND');requireRole(member.user_id!==userId()&&!member.is_owner&&policy(id).assignable_roles.includes(action==='member.assign'?data.role:member.role)&&(management(id)||!member.can_manage_business));
    if(action!=='member.assign'&&data.updated_at!==member.updated_at)denied('REVISION_CONFLICT');
    if(action==='member.offboard')member.is_active=false;else {
     requireRole(policy(id).assignable_roles.includes(data.role));if(!management(id)&&(data.can_manage_business||data.extra_permissions?.length))denied('FORBIDDEN');
     if(data.extra_permissions?.some(p=>!feature(id,p)))denied('FORBIDDEN');Object.assign(member,data);if(action==='member.assign')s.members.push(member);
    }
    member.updated_at=stamp();audit();return member;
  }
  if(action==='delegation.create'||action==='delegation.revoke') {requireRole(management(id));if(action.endsWith('create'))s.delegations.push({...data,id:uid(),display_name:s.members.find(m=>m.user_id===data.user_id)?.display_name,revoked_at:null});else{const d=s.delegations.find(d=>d.id===data.id);if(d)d.revoked_at=stamp();}audit();return {saved:true};}
  // Identity verification, real invitations and management handoff are deliberately unavailable.
  denied();
}

function expiry(id) {
  const s=space(id),store=business().stores.find(x=>x.id===id),chain=business().organization.has_erp;
  return {today:day(),store_name:store.name,has_erp:chain,can_view_amount:!chain&&identity.role!=='STAFF',erp_time:'21:30',erp_reminder_due:chain,permissions:{field:fieldRole(id),manage:identity.role==='SUPERVISOR',audit:identity.role!=='STAFF'},items:s.items,risks:s.risks,zones:s.zones,products:s.products,waste:s.waste.map(w=>({...w,reference_price:chain||identity.role==='STAFF'?null:w.reference_price,reference_amount:chain||identity.role==='STAFF'?null:w.reference_amount})),used:s.used,issues:s.issues,erp_pending:chain?s.waste.filter(w=>!w.erp_report):[]};
}
function saveExpiry(id, action, data) {
  const s=space(id);requireRole(action==='ERP_COMPLETE'?identity.role==='SUPERVISOR':fieldRole());
  const existing=s.items.find(i=>i.id===data.expiry_id);if(data.expiry_id&&!existing){const prior=s.waste.find(w=>w.expiry_id===data.expiry_id)||s.used.find(w=>w.expiry_id===data.expiry_id);if(prior)return {id:prior.id,type:prior.quantity?'WASTE':'USED',already_completed:true};denied('EXPIRY_NOT_FOUND');}const risk=data.risk_id?s.risks.find(r=>r.id===data.risk_id&&r.is_active):null;if(data.risk_id&&!risk)denied('RISK_NOT_FOUND');const item=existing||data.new_expiry||(risk?{...data,zone_id:risk.zone_id,zone_name:risk.zone_name}:data);
  const zone=s.zones.find(z=>z.id===item.zone_id);const result={...item,...data,id:uid(),name:item.name||data.name,zone_name:zone?.name||item.zone_name||null,actor_name:actor(),created_at:stamp(),work_date:day()};
  if(action==='REMINDER')s.items.unshift({...result,category:data.expires_on<=day()?'urgent':data.expires_on<=day(3)?'upcoming':'special',source:'REMINDER',unit:data.unit||item.unit||null});
  else if(action==='USED'){s.items=s.items.filter(i=>i.id!==data.expiry_id);s.used.unshift(result);}
  else if(action==='WASTE'){if(!(Number(data.quantity)>0))denied();adjustKnownStock(s,data.product_id||item.product_id,data.unit||item.unit,item.zone_id,-Number(data.quantity));s.items=s.items.filter(i=>i.id!==data.expiry_id);s.waste.unshift({...result,quantity:Number(data.quantity),unit:data.unit||item.unit||'份',reason:data.reason||'效期到期',note:data.note||'',source:existing?'EXPIRY':'MANUAL',store_name:business().stores.find(x=>x.id===id).name,reference_price:null,reference_amount:null,erp_report:null});}
  else if(action==='ERP_COMPLETE'){s.waste.forEach(w=>{if(data.waste_ids.includes(w.id))w.erp_report={actor_name:actor(),created_at:stamp()};});}
  else if(action==='RISK_SAVE'){requireRole(identity.role==='SUPERVISOR');const risk=s.risks.find(r=>r.id===data.id);const value={...data,id:risk?.id||uid(),zone_name:s.zones.find(z=>z.id===data.zone_id)?.name||'',due:true,updated_at:stamp()};if(risk)Object.assign(risk,value);else s.risks.push(value);return {id:value.id,type:action,active:value.is_active};}
  else if(action==='RISK_ISSUE'){const risk=s.risks.find(r=>r.id===data.risk_id);if(!risk)denied();s.issues.unshift({id:uid(),type:data.type,note:data.note,actor_name:actor(),created_at:stamp(),snapshot:clone(risk)});risk.due=false;}
  else if(action==='RISK_CHECK'){const risk=s.risks.find(r=>r.id===data.risk_id);if(risk)risk.due=false;}
  else denied();
  return {id:result.id,type:action,active:false};
}
function openingFor(s,id){const row=s.importRows?.find(r=>r.product_id===id);return row?row.normalized_values?.opening_quantity??null:10;}
function findSession(id) {for(const [storeId,s] of Object.entries(business().spaces)){const session=s.sessions.find(c=>c.id===id);if(session){space(storeId);return {s,session};}}denied();}
function rpc(name,args) {
  const id=args.p_store_id||selectedStore;space(id,allowsArchive(name,args));
  if(name==='app_workspace')return workspace(id,args.p_section,args.p_filter);
  if(name==='app_operation')return operation(id,args.p_action,args.p_data);
  if(name==='save_inventory_import_review'){requireRole(canMaintain(id));return saveImportReview(space(id),args.p_file,args.p_rows);}
  if(name==='import_pilot_inventory'){requireRole(canMaintain(id));return importRows(space(id),args.p_rows);}
  if(name==='get_pilot_context_expiry'){
   const s=space(id);if(args.p_context_type==='RECEIPT')requireRole(reviewRole(id));else requireRole(fieldRole(id));const batch=s.batches.find(b=>b.id===args.p_context_id),session=s.sessions.find(c=>c.id===args.p_context_id);let items;
   if(args.p_context_type==='COUNT'){if(!session)denied();if(!['DRAFT','IN_PROGRESS'].includes(session.status))denied('COUNT_CONTEXT_CLOSED');items=session.snapshot.zones.filter(z=>!args.p_zone_id||z.zone_id===args.p_zone_id).map(z=>({key:z.product_id,name:z.product_name,unit:z.unit,zone_id:z.zone_id}));}
   else {if(!batch)denied();const fields=s.fields[batch.id]||[];items=[...new Set(fields.filter(f=>f.row_key!=='document').map(f=>f.row_key))].map(key=>({key,name:fields.find(f=>f.row_key===key&&f.field_name==='product')?.value,unit:fields.find(f=>f.row_key===key&&f.field_name==='unit')?.value,zone_id:s.zones.find(z=>z.zone_products.some(p=>p.product_id===(batch.mappings?.find(m=>m.row_key===key)?.product_id||(!batch.mappings?s.products[Number(key.split('-')[1])]?.id:null))))?.id||null}));}
   return {store_name:business().stores.find(x=>x.id===id).name,run_id:batch?`${batch.id}-ocr`:null,zones:s.zones.map(z=>({id:z.id,name:z.name})),items:items.map(i=>({...i,reminders:s.items.filter(e=>e.context_type===args.p_context_type&&e.context_id===args.p_context_id&&e.context_key===i.key)}))};
  }
  if(name==='save_pilot_context_expiry'){
   const options=rpc('get_pilot_context_expiry',args),d=args.p_data,item=options.items.find(i=>i.key===d.item_key);if(!item?.name)denied('CONTEXT_ITEM_REQUIRED');const s=space(id);if(args.p_context_type==='RECEIPT'&&d.run_id!==options.run_id)denied('RECEIPT_CONTEXT_CHANGED');
   const reason=args.p_context_type==='RECEIPT'?'包裝效期':d.attention_reason;if(!['包裝效期','保存期限短','使用速度慢','容易被遺忘','高單價食材（主管自訂）'].includes(reason)&&!/^其他：\S.{0,159}$/u.test(reason||''))denied('REMINDER_FIELDS_REQUIRED');const zone=d.zone_id?s.zones.find(z=>z.id===d.zone_id):null;if(d.zone_id&&!zone)denied('ZONE_REQUIRED');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(d.expires_on||'')||!Number.isFinite(Date.parse(d.expires_on)))denied('EXPIRY_DATE_REQUIRED');let old=item.reminders.find(e=>e.id===d.expiry_id);if(d.expiry_id&&!old)denied('EXPIRY_CHANGED');if(args.p_context_type==='RECEIPT'&&!d.new_batch)old ||= item.reminders[0];if(old&&d.expiry_id&&d.revision!==old.revision)denied('EXPIRY_CHANGED');
   const value={id:old?.id||uid(),name:item.name,unit:item.unit,expires_on:d.expires_on,zone_id:zone?.id||null,zone_name:zone?.name||'未分類',attention_reason:reason,revision:(old?.revision||0)+1,source:args.p_context_type==='RECEIPT'?'RECEIPT':'FIELD',created_at:old?.created_at||stamp(),context_type:args.p_context_type,context_id:args.p_context_id,context_key:item.key,category:d.expires_on<=day()?'urgent':d.expires_on<=day(3)?'upcoming':'special'};
   if(old)Object.assign(old,value);else s.items.unshift(value);return {id:value.id};
  }
  if(name==='get_app_dashboard')return dashboard(id);
  if(name==='ensure_pilot_daily_count')return space(id).sessions[0].id;
  if(name==='get_pilot_expiry_waste')return expiry(id);
  if(name==='save_pilot_expiry_waste')return saveExpiry(id,args.p_action,args.p_data);
  if(name==='get_pilot_inventory_catalog'){const s=space(id);return s.zones.flatMap(z=>z.zone_products.map(p=>{const source=s.importRows?.find(r=>r.product_id===p.product_id);return {product_id:p.product_id,name:p.products.name,unit:p.count_unit,zone:z.name,quantity:openingFor(s,p.product_id),imported_at:source?s.importFiles.find(f=>f.id===source.import_file_id)?.created_at:null,supplier:p.products.supplier_name,sheet:source?.sheet_name||null,source_row:source?.source_row||null};}));}
  if(name==='get_pilot_count_results'||name==='get_pilot_count_details'){if(name.endsWith('details'))requireRole(identity.role!=='STAFF');return findSession(args.p_session_id).s.results.filter(r=>r.session_id===args.p_session_id);}
  if(name==='get_pilot_count_completion'){const {s,session}=findSession(args.p_session_id);return {completed_by:session.completed_by||s.results.find(r=>r.session_id===session.id)?.entered_by||'小安（示範）',paper_completed_by:session.paper_completed_by||null};}
  if(name==='save_pilot_count_drafts') {
    requireRole(fieldRole());const {s,session}=findSession(args.p_session_id);if(session.status!=='IN_PROGRESS')denied();
    if(!Array.isArray(args.p_entries))denied('INVALID_COUNT_ENTRY');
    for(const entry of args.p_entries){const item=session.snapshot.zones.find(x=>x.zone_id===entry.zone_id&&x.product_id===entry.product_id);if(!item||entry.unit!==undefined&&item.unit!==entry.unit||entry.quantity!==null&&(typeof entry.quantity!=='number'||!Number.isFinite(entry.quantity)||entry.quantity<0))denied('INVALID_COUNT_ENTRY');if(s.progress.some(p=>p.session_id===session.id&&p.zone_id===entry.zone_id&&p.status==='COMPLETED'))denied('ZONE_ALREADY_COMPLETED');}
    return args.p_entries.map(entry=>{const row={...entry,unit:session.snapshot.zones.find(x=>x.zone_id===entry.zone_id&&x.product_id===entry.product_id).unit,session_id:session.id,updated_at:stamp()};const i=s.drafts.findIndex(d=>d.session_id===session.id&&d.zone_id===row.zone_id&&d.product_id===row.product_id);if(i>=0)s.drafts[i]=row;else s.drafts.push(row);return row;});
  }
  if(name==='complete_pilot_count_zone') {
    requireRole(fieldRole());const {s,session}=findSession(args.p_session_id);const zone=s.zones.find(z=>z.id===args.p_zone_id);if(!zone)denied();
    if(s.progress.some(p=>p.session_id===session.id&&p.zone_id===zone.id&&p.status==='COMPLETED'))return {saved:true};
    const scoped=zone.zone_products.filter(p=>session.snapshot.zones.some(x=>x.zone_id===zone.id&&x.product_id===p.product_id));if(!scoped.length)denied();const drafts=scoped.map(p=>s.drafts.find(d=>d.session_id===session.id&&d.zone_id===zone.id&&d.product_id===p.product_id));if(drafts.some(d=>!d||d.quantity===null))denied();
    s.results.push(...scoped.map((p,i)=>({id:uid(),session_id:session.id,product_id:p.product_id,zone_id:zone.id,zone:zone.name,name:session.snapshot.zones.find(x=>x.zone_id===zone.id&&x.product_id===p.product_id).product_name,unit:drafts[i].unit,quantity:drafts[i].quantity,entered_at:stamp(),entered_by:actor(),opening_quantity:openingFor(s,p.product_id),supplier:p.products.supplier_name})));
    s.progress.push({session_id:session.id,zone_id:zone.id,status:'COMPLETED',completed_at:stamp(),completed_by:actor()});
    if(session.snapshot.zones.every(z=>s.progress.some(p=>p.session_id===session.id&&p.zone_id===z.zone_id))){session.status='CLOSED';session.completed_at=stamp();session.completed_by=actor();for(const r of s.results.filter(r=>r.session_id===session.id)){const old=s.positions?.filter(p=>p.product_id===r.product_id&&p.zone_id===r.zone_id&&p.unit===r.unit)||[];if(s.stockInitialized?.includes(`${r.product_id}:${r.unit}`)&&old.reduce((n,p)=>n+p.quantity,0)!==r.quantity){old.forEach(p=>{p.quantity=0;p.revision++;});s.positions.push({id:uid(),store_id:session.store_id,product_id:r.product_id,zone_id:r.zone_id,unit:r.unit,quantity:r.quantity,state:s.stockSettings?.[r.product_id]?.thaw_enabled?'UNCONFIRMED':'READY',ready_at:null,revision:1,updated_at:stamp()});}}}return {saved:true};
  }
  if(name==='complete_pilot_count_paper'){requireRole(fieldRole()||identity.role==='OWNER');const {session}=findSession(args.p_session_id);if(args.p_review)session.paper_reviewed_at=stamp();else {session.paper_completed_at=stamp();session.paper_completed_by=actor();}return {saved:true};}
  if(name==='start_pilot_count'){requireRole(identity.role==='SUPERVISOR'||identity.role==='OWNER');const s=space(id);if(s.sessions[0].status==='IN_PROGRESS')return s.sessions[0].id;const next={...clone(s.sessions[0]),id:uid(),status:'IN_PROGRESS',started_at:stamp(),completed_at:null,paper_completed_at:null,paper_reviewed_at:null};next.snapshot={zones:s.zones.flatMap(z=>z.zone_products.filter(x=>s.products.find(p=>p.id===x.product_id)?.is_active).map(p=>({zone_id:z.id,zone_name:z.name,product_id:p.product_id,product_name:p.products.name,unit:p.count_unit})))};s.sessions.unshift(next);return next.id;}
  if(name==='begin_pilot_receipt_upload'){
   requireRole(fieldRole(id));const s=space(id);if(!['SAME_RECEIPT','SEPARATE_RECEIPTS'].includes(args.p_group_mode)||!Array.isArray(args.p_documents)||args.p_documents.length<1||args.p_documents.length>10||!args.p_fingerprint)denied('INVALID_UPLOAD');
   let batch=s.batches.find(b=>b.fingerprint===args.p_fingerprint);if(!batch){const batchId=uid();const documents=args.p_documents.map((d,i)=>{if(!/^[a-f0-9]{64}$/.test(d.sha256)||!d.name||d.byte_size<=0)denied('INVALID_DOCUMENT');return {...d,id:uid(),page_order:i+1,storage_path:`${business().organization.id}/${id}/${batchId}/${d.sha256}`,stored:false};});batch={id:batchId,fingerprint:args.p_fingerprint,batch_number:`示範貨單-${s.batches.length+1}`,status:'UPLOADING',uploaded_at:stamp(),work_date:day(),erp_required:identity.businessType==='CHAIN_RESTAURANT',erp_completed_at:null,erp_completed_by:null,pages:documents.length,supplier:'',ocr_status:null,review_allowed:reviewRole(id),retry_allowed:true,job_status:null,documents};s.batches.unshift(batch);}
   return {batch_id:batch.id,documents:batch.documents};
  }
  if(name==='get_pilot_receipts')return space(id).batches.map(b=>({...b,review_allowed:reviewRole(id)}));
  if(name==='get_pilot_receipt'){
    const s=space(id),batch=s.batches.find(b=>b.id===args.p_batch_id);if(!batch)denied();
    return {batch,review_allowed:reviewRole(id),full_access:memberFor(id)?.role!=='STAFF',erp_actor:batch.erp_completed_by,documents:(batch.documents||[]).map(d=>({...d,path:d.storage_path})),run:{id:`${batch.id}-ocr`,status:'SUCCEEDED',model:'預設示範資料',started_at:batch.uploaded_at,completed_at:batch.uploaded_at,error_code:null},job:{status:'SUCCEEDED',attempt_count:1},fields:(s.fields[batch.id]||[]).filter(f=>identity.role!=='STAFF'||['product','raw_product_name','supplier_name','receipt_date','document_number','quantity','unit','specification'].includes(f.field_name)),mappings:batch.mappings||s.products.slice(0,2).map((p,i)=>({row_key:`row-${i}`,product_id:p.id,name:p.name,code:p.product_code,unit:p.base_unit,specification:p.specification})),receipt:batch.review_saved?{id:batch.id,reviewed_at:stamp()}:null,review:{saved_rows:batch.review_saved?['row-0','row-1']:batch.saved_rows||[],complete:!!batch.review_saved}};
  }
  if(name==='correct_pilot_receipt_field'){requireRole(reviewRole());for(const s of authorizedSpaces())for(const fields of Object.values(s.fields)){const f=fields.find(f=>f.id===args.p_field_id);if(f){f.value=args.p_value;f.corrected=true;return {saved:true};}}denied();}
  if(name==='save_pilot_receipt_review'){requireRole(reviewRole());const batch=space(id).batches.find(b=>b.id===args.p_batch_id);if(!batch)denied();batch.saved_rows ||= [];if(!batch.saved_rows.includes(args.p_row_key))batch.saved_rows.push(args.p_row_key);const complete=[...new Set((space(id).fields[batch.id]||[]).filter(f=>f.row_key!=='document').map(f=>f.row_key))].every(key=>batch.saved_rows.includes(key));batch.review_saved=complete;if(complete){batch.status='COMPLETED';if(!batch.inventory_posted){const fields=space(id).fields[batch.id];for(const key of [...new Set(fields.filter(f=>f.row_key!=='document').map(f=>f.row_key))]){const row=Object.fromEntries(fields.filter(f=>f.row_key===key).map(f=>[f.field_name,f.value]));const mapping=batch.mappings?.find(m=>m.row_key===key)||(!batch.mappings?{product_id:space(id).products[Number(key.split('-')[1])]?.id}:null);const p=space(id).products.find(p=>p.id===mapping?.product_id);if(p&&row.unit===p.base_unit&&typeof row.quantity==='number'&&row.quantity>0)postStock(space(id),p,row.unit,row.quantity);}batch.inventory_posted=true;}}return {saved:true,complete};}
  if(name==='complete_pilot_receipt_erp'){requireRole(fieldRole());const batch=space(id).batches.find(b=>b.id===args.p_batch_id);if(!batch)denied();batch.erp_completed_at=stamp();batch.erp_completed_by=actor();return {saved:true};}
  if(name==='authorize_app_feature'){requireRole(feature(id,args.p_feature));return true;}
  denied();
}

// Supabase-shaped thenables let the production components keep their existing API.
function result(run) {
  let promise;
  const get=()=>promise ||= Promise.resolve().then(run).then(data=>({data:clone(data),error:null}),error=>({data:null,error:{message:error.message,code:error.code||(/^[A-Z_]+$/.test(error.message)?error.message:'DEMO_UNAVAILABLE')}}));
  return {then:(resolve,reject)=>get().then(resolve,reject),catch:reject=>get().catch(reject),finally:done=>get().finally(done),abortSignal(){return this;}};
}
function authorizedSpaces(){return Object.entries(business().spaces).filter(([id,s])=>business().stores.some(x=>x.id===id&&x.is_active)&&s.members.some(m=>m.user_id===userId()&&m.is_active)).map(([,s])=>s);}
function table(name) {
  const filters=[];let single=false,limit=Infinity,offset=0;const orders=[];
  const read=()=>{
    const spaces=authorizedSpaces();
    const tables={store_memberships:()=>spaces.flatMap(s=>s.members.map(m=>({...m,store_id:business().stores.find(x=>business().spaces[x.id]===s).id}))),staff_identities:()=>spaces.flatMap(s=>s.members),count_zones:()=>spaces.flatMap(s=>s.zones.map(z=>({...z,zone_products:z.zone_products.map(zp=>({...zp,products:s.products.find(p=>p.id===zp.product_id)}))}))),inventory_count_sessions:()=>spaces.flatMap(s=>s.sessions),count_entries:()=>spaces.flatMap(s=>s.results),count_zone_progress:()=>spaces.flatMap(s=>s.progress),count_drafts:()=>spaces.flatMap(s=>s.drafts),inventory_count_discrepancies:()=>spaces.flatMap(s=>s.discrepancies),products:()=>spaces.flatMap(s=>s.products.map(p=>({...p,organization_id:business().organization.id}))),inventory_import_files:()=>spaces.flatMap(s=>s.importFiles||[]),inventory_import_rows:()=>spaces.flatMap(s=>s.importRows||[]),inventory_import_batches:()=>[]};
    if(!tables[name])denied();let rows=tables[name]().filter(r=>filters.every(f=>f(r)));
    if(orders.length)rows.sort((a,b)=>{for(const order of orders){const x=a[order.key],y=b[order.key];const diff=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y));if(diff)return diff*(order.ascending?1:-1);}return 0;});rows=rows.slice(offset,offset+limit);return single?rows[0]||null:rows;
  };
  const query={...result(read),select(){return this;},eq(key,value){filters.push(r=>r[key]===value);return this;},in(key,values){filters.push(r=>values.includes(r[key]));return this;},is(key,value){filters.push(r=>r[key]===value);return this;},gte(key,value){filters.push(r=>r[key]>=value);return this;},lte(key,value){filters.push(r=>r[key]<=value);return this;},order(key,options={}){orders.push({key,ascending:options.ascending!==false});return this;},range(a,b){offset=a;limit=b-a+1;return this;},limit(n){limit=n;return this;},maybeSingle(){single=true;return this;},single(){single=true;return this;}};
  return query;
}
const hashToken=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function inspectDemoInvitation(token){restore();const hash=await hashToken(token);for(const [type,b] of Object.entries(businesses))for(const [id,s] of Object.entries(b.spaces)){const invite=s.staffInvites?.find(i=>i.hash===hash);if(!invite)continue;const member=s.members.find(m=>m.user_id===invite.user_id);const status=invite.used?'USED':invite.revoked?'REVOKED':invite.expires<Date.now()?'EXPIRED':!member?.is_active||!b.stores.find(x=>x.id===id)?.is_active?'REVOKED':'VALID';return {status,type,storeId:id,displayName:member?.display_name,storeName:b.stores.find(x=>x.id===id)?.name,role:member?.role};}return {status:'INVALID'};}
export async function activateDemoInvitation(token,pin){const context=await inspectDemoInvitation(token);if(context.status!=='VALID')throw Error(context.status);if(!/^\d{6}$/.test(pin))throw Error('INVALID_PIN');const hash=await hashToken(token);const s=businesses[context.type].spaces[context.storeId];const invite=s.staffInvites.find(i=>i.hash===hash);invite.used=true;invite.pinHash=await hashToken(pin);identity={role:context.role,businessType:context.type,admin:false,userId:invite.user_id,displayName:context.displayName};selectedStore=context.storeId;persist();return {...demoContext(),selectedStore};}
async function demoFunction(name,body){if(name==='enqueue-receipt-ocr'&&body?.batchId){const s=space();const batch=s.batches.find(b=>b.id===body.batchId);if(!batch)denied('FORBIDDEN');requireRole(fieldRole()||reviewRole());for(const d of batch.documents||[])await loadDemoFile(d.storage_path);if(batch.ocr_status!=='SUCCEEDED'){s.fields[batch.id]=receiptFields(batch.id,s.products,s.suppliers[0]?.name||'示範供應商');Object.assign(batch,{status:'OCR_DONE',ocr_status:'SUCCEEDED',job_status:'SUCCEEDED',supplier:s.suppliers[0]?.name||'示範供應商'});persist();}return {results:[{batchId:batch.id,queued:true}],demo:true};}if(!body||name!=='manage-staff')denied('DEMO_UNAVAILABLE');const id=body.storeId||selectedStore;const s=space(id);requireRole(policy(id).can_manage_members);if(!['create','reset_pin'].includes(body.action))denied('DEMO_UNAVAILABLE');s.staffInvites ||= [];let member;
 if(body.action==='reset_pin'){member=s.members.find(m=>m.user_id===body.staffId&&m.uses_pin&&m.is_active);if(!member||member.is_owner||member.user_id===userId()||Object.entries(business().spaces).some(([scope,x])=>x.members.some(m=>m.user_id===member.user_id&&m.is_active&&(!policy(scope).assignable_roles.includes(m.role)||(m.can_manage_business&&!management(scope))))))denied('FORBIDDEN');}
 else{if(!policy(id).assignable_roles.includes(body.role)||!body.displayName?.trim())denied('INVALID_STAFF_INPUT');body.loginIdentifier ||= business().stores.find(x=>x.id===id).staff_login_mode==='EMPLOYEE_NUMBER'?'E'+crypto.randomUUID().slice(0,8):body.displayName.trim();if(s.members.some(m=>m.login_identifier===body.loginIdentifier))denied('STAFF_ALREADY_EXISTS');member={user_id:uid(),display_name:body.displayName,login_identifier:body.loginIdentifier,role:body.role,is_active:true,is_owner:false,can_manage_business:body.role==='OWNER',uses_pin:true,email:null,extra_permissions:[],zone_ids:[],updated_at:stamp(),pending_count:0};s.members.push(member);}
 const token=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');s.staffInvites.filter(i=>i.user_id===member.user_id).forEach(i=>{i.revoked=true;});s.staffInvites.push({hash:await hashToken(token),user_id:member.user_id,expires:Date.now()+7*86400000,used:false,revoked:false});persist();return {staffId:member.user_id,activationCode:token,login:{storeCode:business().stores.find(x=>x.id===id).store_code,loginIdentifier:member.login_identifier,displayName:member.display_name,role:member.role,activationCode:token,expiresInDays:7}};
}
export function createDemoClient() {
  return {rpc(name,args={}){return result(()=>{restore();space(args.p_store_id||selectedStore,allowsArchive(name,args));if(args.p_session_id)findSession(args.p_session_id);const key=args.p_request_id?`${identity.businessType}:${name}:${args.p_request_id}`:null;const signature=JSON.stringify({actor:userId(),args});if(name==='app_operation'&&/^(store\.|settings\.|business\.|delegation\.|invite\.)/.test(args.p_action))requireRole(management(args.p_store_id));if(name==='app_operation'&&args.p_action==='receipt.edit-card')requireRole(reviewRole(args.p_store_id));if(name==='app_operation'&&args.p_action.startsWith('member.'))requireRole(policy(args.p_store_id).can_manage_members);if(key&&requests.has(key)){const saved=requests.get(key);if(saved.signature!==signature)denied('REQUEST_CONFLICT');return saved.data;}const before=clone(businesses);try{const data=rpc(name,args);if(key)requests.set(key,{signature,data:clone(data)});persist();return data;}catch(error){businesses=before;throw error;}});},from:table,
    auth:new Proxy({}, {get:()=>()=>result(()=>denied())}),
    functions:{invoke:(name,options)=>result(()=>demoFunction(name,options.body))},
    storage:{from:bucket=>({upload:(path,bytes)=>result(async()=>{authorizeDemoFile(bucket,path);await saveDemoFile(path,bytes);if(bucket==='receipt-documents'){for(const s of authorizedSpaces())for(const batch of s.batches){const doc=batch.documents?.find(d=>d.storage_path===path);if(doc)doc.stored=true;}persist();}return {path};}),download:path=>result(()=>{authorizeDemoFile(bucket,path);return loadDemoFile(path);}),createSignedUrls:(paths,seconds)=>result(async()=>Promise.all(paths.map(async path=>{authorizeDemoFile(bucket,path);return {path,signedUrl:await demoFileUrl(path,seconds)};}))),createSignedUrl:(path,seconds)=>result(async()=>{authorizeDemoFile(bucket,path);return {signedUrl:await demoFileUrl(path,seconds)};})})}};
}
function authorizeDemoFile(bucket,path){if(!['inventory-imports','receipt-documents'].includes(bucket))denied();if(bucket==='receipt-documents'){const [org,storeId]=path.split('/');if(org!==business().organization.id)denied();const s=space(storeId);if(!s.batches.some(b=>b.documents?.some(d=>d.storage_path===path)))denied();return;}const [org,storeId]=path.split('/');if(org!==business().organization.id)denied('FORBIDDEN');space(storeId);requireRole(canMaintain(storeId));}
export const demoClient = createDemoClient();
