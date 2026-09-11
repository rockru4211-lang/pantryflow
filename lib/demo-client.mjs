// This adapter has no network transport, credentials, real user IDs or persistence.
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
const uploads = new Map();
const requests = new Map();
const actor = () => `${demoNames[identity.role]}（示範）`;
const userId = () => `demo-user-${identity.businessType}-${identity.role}`;
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
function business() { return businesses[identity.businessType] ||= seedBusiness(identity.businessType); }
function space(id = selectedStore) { const value = business().spaces[id]; if (!value) denied('FORBIDDEN'); return value; }
const fieldRole = () => ['STAFF','SUPERVISOR'].includes(identity.role);
const memberFor = (id=selectedStore) => business().spaces[id]?.members.find(m=>m.user_id===userId());
const management = (id=selectedStore) => identity.admin || memberFor(id)?.can_manage_business === true;
const feature = (id,name) => identity.role!=='STAFF'||memberFor(id)?.extra_permissions.includes(name);
const canMaintain = (id=selectedStore) => management(id) || identity.role === 'SUPERVISOR' || (identity.role === 'LOGISTICS' && identity.businessType === 'SINGLE_RESTAURANT');
function requireRole(ok) { if (!ok) denied('FORBIDDEN'); }

export function configureDemo(role, businessType, admin = false) {
  if (!roles.includes(role) || !['SINGLE_RESTAURANT','CHAIN_RESTAURANT'].includes(businessType)) denied('FORBIDDEN');
  identity = {role, businessType, admin: role !== 'STAFF' && admin};
  selectedStore = `demo-${prefix()}-1`;
  return demoContext();
}
export function demoContext() {
  const b = business();
  return clone({user: {id: userId(), email: `${identity.role.toLowerCase()}@example.invalid`, app_metadata: {}, user_metadata: {}, aud: 'demo', created_at: stamp()}, profile: {display_name: actor(), role: identity.role}, stores: b.stores.map(s=>({...s, business_type: identity.businessType, has_erp: b.organization.has_erp, store_mode: b.organization.store_mode, role: identity.role, linked_store_count: b.stores.length, can_manage_business: management(s.id), is_business_responsible: identity.role === 'OWNER', permissions: {reports_view: !!feature(s.id,'REPORTS_VIEW'), data_export: !!feature(s.id,'DATA_EXPORT')}}))});
}
export function selectDemoStore(id) { space(id); selectedStore = id; }
export function resetDemo() { businesses = {}; requests.clear(); for (const url of uploads.values()) URL.revokeObjectURL(url); uploads.clear(); }

function dashboard(id) {
  const s = space(id);
  return {count: s.sessions[0], count_items: s.products.length, count_completed: s.sessions.filter(c=>c.status==='CLOSED').length, receipt_pending: s.batches.filter(b=>!b.review_saved).length, receipt_issues: 0, expiry_urgent: s.items.filter(i=>i.category==='urgent').length, incidents: s.records.filter(r=>r.kind==='incident'&&r.status!=='COMPLETE').length, handover: s.records.filter(r=>r.kind==='handover'&&r.status!=='COMPLETE').length, erp_pending: business().organization.has_erp ? s.batches.filter(b=>b.review_saved&&!b.erp_completed_at).length+s.waste.filter(w=>!w.erp_report).length : 0, month_receipt_amount: identity.role === 'STAFF' ? null : s.batches.filter(b=>b.review_saved).length*450, month_waste_amount: identity.role === 'STAFF' ? null : s.waste.reduce((n,w)=>n+(w.reference_amount||0),0), bulletins: s.records.filter(r=>r.kind==='bulletin'), shortages: [s.products[0]]};
}
function workspace(id, section) {
  const s = space(id); const b = business();
  const recordKinds = {incidents:'incident',handover:'handover',bulletins:'bulletin','company-tasks':'company_task'};
  if (recordKinds[section]) return {records: s.records.filter(r=>r.kind===recordKinds[section])};
  if (['activity','tasks','notifications'].includes(section)) return {records:s.records};
  if (section === 'transfers') return {records:s.movements, stores:b.stores, products:s.products.map(p=>({...p,unit:p.base_unit})), has_erp:b.organization.has_erp};
  if (section === 'transfer-search') return {stores:b.stores};
  if (section === 'catalog' || section === 'suppliers') return {editable:canMaintain(id),products:s.products,suppliers:s.suppliers};
  if (section === 'mappings') return {editable:canMaintain(id),lines:[],products:s.products.map(p=>({...p,unit:p.base_unit})),rules:[]};
  if (['business','settings'].includes(section)) return {organization:b.organization, stores:b.stores, settings:b.stores.find(x=>x.id===id).settings, editable:management(id)||identity.role==='SUPERVISOR', revision:b.stores.find(x=>x.id===id).settings_revision, devices:[]};
  if (['members','permissions'].includes(section)) { requireRole(management(id)||identity.role==='SUPERVISOR'); return {members:s.members,zones:s.zones,candidates:[],invitations:s.invitations,delegations:s.delegations}; }
  if (section === 'audit') { requireRole(management(id)); return {events:s.audit}; }
  if (section === 'reports') {
    requireRole(feature(id,'REPORTS_VIEW'));
    const receipts = s.batches.filter(b=>b.review_saved).map(b=>({id:b.id,source_batch_id:b.id,receipt_date:day(),document_number:b.batch_number,supplier_name:b.supplier,total_inc_tax:450}));
    return {counts:s.sessions.filter(c=>c.status==='CLOSED'),receipts,lines:receipts.flatMap(r=>s.products.slice(0,2).map(p=>({id:`${r.id}-${p.id}`,receipt_id:r.id,source_batch_id:r.id,product_id:p.id,name:p.name,quantity:5,unit:p.base_unit,unit_price:45,amount:225,receipt_date:day(),supplier_name:r.supplier_name,inventory_status:'POSTED'})))};
  }
  denied();
}

function operation(id, action, data) {
  const s=space(id), b=business();
  const audit=()=>s.audit.unshift({id:uid(),action,actor_name:actor(),entity_type:'示範操作',entity_id:data.id||id,old_value:null,new_value:clone(data),created_at:stamp()});
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
    requireRole(fieldRole());let record=s.movements.find(r=>r.id===data.id);
    if(action==='movement.create') {
      const other=b.stores.find(x=>x.id===data.other_store_id);if(!other||other.id===id||!(Number(data.quantity)>0))denied();
      const outgoing=data.mode!=='loan',here=b.stores.find(x=>x.id===id);
      record={id:uid(),from_store_id:outgoing?id:other.id,to_store_id:outgoing?other.id:id,from_name:outgoing?here.name:other.name,to_name:outgoing?other.name:here.name,kind:data.mode==='move'?'TRANSFER':'LOAN',name:data.name||s.products.find(p=>p.id===data.product_id)?.name,quantity:Number(data.quantity),unit:data.unit,returned_quantity:0,expected_return_on:data.expected_return_on||null,status:data.mode==='move'?'COMPLETE':'OPEN',revision:1,actor_name:actor(),created_at:stamp(),closed_at:null,reference_price:null,events:[]};s.movements.unshift(record);space(other.id).movements.unshift(record);
    } else {
      if(!record||record.status!=='OPEN'||record.revision!==data.revision)denied('REVISION_CONFLICT');
      const qty=Number(data.quantity);if(!(qty>0)||qty>record.quantity-record.returned_quantity)denied();
      record.returned_quantity+=qty;record.revision++;if(record.returned_quantity===record.quantity){record.status=action==='movement.exchange'?'EXCHANGED':'RETURNED';record.closed_at=stamp();}
      record.events.push({id:uid(),action:action==='movement.exchange'?'EXCHANGE':'RETURN',name:data.name||record.name,quantity:qty,unit:data.unit||record.unit,actor_name:actor(),created_at:stamp()});
    }audit();return record;
  }
  if (action==='product.save'||action==='supplier.save') {
    requireRole(canMaintain(id));const list=action==='product.save'?s.products:s.suppliers;let item=list.find(x=>x.id===data.id);if(!item){item={id:uid()};list.push(item);}Object.assign(item,data,{id:item.id,updated_at:stamp()});if(action==='product.save')Object.assign(item,{base_unit:data.unit,product_code:data.code,current_supplier_id:data.supplier_id||null,supplier_name:s.suppliers.find(x=>x.id===data.supplier_id)?.name||null});audit();return item;
  }
  if (['business.save','store.save','settings.save'].includes(action)) {
    requireRole(management(id)||(action==='settings.save'&&identity.role==='SUPERVISOR'));const store=b.stores.find(x=>x.id===id);
    if(action==='business.save')Object.assign(b.organization,data);
    if(action==='store.save')Object.assign(store,{name:data.name,staff_login_mode:data.staff_login_mode,is_active:data.is_active,updated_at:stamp()});
    if(action==='settings.save'){Object.assign(store.settings,data.settings);store.settings_revision++;}audit();return {saved:true};
  }
  if (action==='member.save'||action==='member.offboard') {
    const member=s.members.find(m=>m.user_id===data.user_id);if(!member)denied();requireRole(member.user_id!==userId()&&!member.is_owner&&(management(id)||(identity.role==='SUPERVISOR'&&member.role==='STAFF'&&!member.can_manage_business)));
    if(action==='member.offboard')member.is_active=false;else {if(!management(id)&&(data.role!=='STAFF'||data.can_manage_business||data.extra_permissions?.length))denied('FORBIDDEN');Object.assign(member,data);}
    member.updated_at=stamp();audit();return member;
  }
  if(action==='delegation.create'||action==='delegation.revoke') {requireRole(management(id));if(action.endsWith('create'))s.delegations.push({...data,id:uid(),display_name:s.members.find(m=>m.user_id===data.user_id)?.display_name,revoked_at:null});else{const d=s.delegations.find(d=>d.id===data.id);if(d)d.revoked_at=stamp();}audit();return {saved:true};}
  // Identity verification, real invitations and management handoff are deliberately unavailable.
  denied();
}

function expiry(id) {
  const s=space(id),store=business().stores.find(x=>x.id===id),chain=business().organization.has_erp;
  return {today:day(),store_name:store.name,has_erp:chain,erp_time:'21:30',erp_reminder_due:chain,permissions:{field:fieldRole(),manage:identity.role==='SUPERVISOR',audit:identity.role!=='STAFF'},items:s.items,risks:s.risks,zones:s.zones,products:s.products,waste:s.waste,used:s.used,issues:s.issues,erp_pending:chain?s.waste.filter(w=>!w.erp_report):[]};
}
function saveExpiry(id, action, data) {
  const s=space(id);requireRole(action==='ERP_COMPLETE'?identity.role==='SUPERVISOR':fieldRole());
  const existing=s.items.find(i=>i.id===data.expiry_id);const item=existing||data.new_expiry||data;
  const zone=s.zones.find(z=>z.id===item.zone_id);const result={...item,...data,id:uid(),name:item.name||data.name,zone_name:zone?.name||item.zone_name||null,actor_name:actor(),created_at:stamp(),work_date:day()};
  if(action==='REMINDER')s.items.unshift({...result,category:data.expires_on<=day()?'urgent':'upcoming',source:'REMINDER',unit:'份'});
  else if(action==='USED'){s.items=s.items.filter(i=>i.id!==data.expiry_id);s.used.unshift(result);}
  else if(action==='WASTE'){if(!(Number(data.quantity)>0))denied();s.items=s.items.filter(i=>i.id!==data.expiry_id);s.waste.unshift({...result,quantity:Number(data.quantity),unit:data.unit||item.unit||'份',reason:data.reason||'效期到期',note:data.note||'',source:existing?'EXPIRY':'MANUAL',store_name:business().stores.find(x=>x.id===id).name,reference_price:null,reference_amount:null,erp_report:null});}
  else if(action==='ERP_COMPLETE'){s.waste.forEach(w=>{if(data.waste_ids.includes(w.id))w.erp_report={actor_name:actor(),created_at:stamp()};});}
  else if(action==='RISK_SAVE'){requireRole(identity.role==='SUPERVISOR');const risk=s.risks.find(r=>r.id===data.id);const value={...data,id:risk?.id||uid(),zone_name:s.zones.find(z=>z.id===data.zone_id)?.name||'',due:true,updated_at:stamp()};if(risk)Object.assign(risk,value);else s.risks.push(value);return {id:value.id,type:action,active:value.is_active};}
  else if(action==='RISK_ISSUE'){const risk=s.risks.find(r=>r.id===data.risk_id);if(!risk)denied();s.issues.unshift({id:uid(),type:data.type,note:data.note,actor_name:actor(),created_at:stamp(),snapshot:clone(risk)});risk.due=false;}
  else if(action==='RISK_CHECK'){const risk=s.risks.find(r=>r.id===data.risk_id);if(risk)risk.due=false;}
  else denied();
  return {id:result.id,type:action,active:false};
}
function findSession(id) {for(const s of Object.values(business().spaces)){const session=s.sessions.find(c=>c.id===id);if(session)return {s,session};}denied();}
function rpc(name,args) {
  const id=args.p_store_id||selectedStore;
  if(name==='app_workspace')return workspace(id,args.p_section);
  if(name==='app_operation')return operation(id,args.p_action,args.p_data);
  if(name==='get_app_dashboard')return dashboard(id);
  if(name==='ensure_pilot_daily_count')return space(id).sessions[0].id;
  if(name==='get_pilot_expiry_waste')return expiry(id);
  if(name==='save_pilot_expiry_waste')return saveExpiry(id,args.p_action,args.p_data);
  if(name==='get_pilot_inventory_catalog')return space(id).zones.flatMap(z=>z.zone_products.map(p=>({product_id:p.product_id,name:p.products.name,unit:p.count_unit,zone:z.name,quantity:10,imported_at:null,supplier:p.products.supplier_name,sheet:null,source_row:null})));
  if(name==='get_pilot_count_results'||name==='get_pilot_count_details'){if(name.endsWith('details'))requireRole(identity.role!=='STAFF');return findSession(args.p_session_id).s.results.filter(r=>r.session_id===args.p_session_id);}
  if(name==='get_pilot_count_completion'){const {s,session}=findSession(args.p_session_id);return {completed_by:session.completed_by||s.results.find(r=>r.session_id===session.id)?.entered_by||'小安（示範）',paper_completed_by:session.paper_completed_by||null};}
  if(name==='save_pilot_count_drafts') {
    requireRole(fieldRole());const {s,session}=findSession(args.p_session_id);if(session.status!=='IN_PROGRESS')denied();
    return args.p_entries.map(entry=>{const row={...entry,session_id:session.id,updated_at:stamp()};const i=s.drafts.findIndex(d=>d.session_id===session.id&&d.zone_id===row.zone_id&&d.product_id===row.product_id);if(i>=0)s.drafts[i]=row;else s.drafts.push(row);return row;});
  }
  if(name==='complete_pilot_count_zone') {
    requireRole(fieldRole());const {s,session}=findSession(args.p_session_id);const zone=s.zones.find(z=>z.id===args.p_zone_id);if(!zone)denied();
    if(s.progress.some(p=>p.session_id===session.id&&p.zone_id===zone.id&&p.status==='COMPLETED'))return {saved:true};
    const drafts=zone.zone_products.map(p=>s.drafts.find(d=>d.session_id===session.id&&d.zone_id===zone.id&&d.product_id===p.product_id));if(drafts.some(d=>!d||d.quantity===null))denied();
    s.results.push(...zone.zone_products.map((p,i)=>({id:uid(),session_id:session.id,product_id:p.product_id,zone_id:zone.id,zone:zone.name,name:p.products.name,unit:p.count_unit,quantity:drafts[i].quantity,entered_at:stamp(),entered_by:actor(),opening_quantity:10,supplier:p.products.supplier_name})));
    s.progress.push({session_id:session.id,zone_id:zone.id,status:'COMPLETED',completed_at:stamp(),completed_by:actor()});
    if(s.zones.every(z=>s.progress.some(p=>p.session_id===session.id&&p.zone_id===z.id))){session.status='CLOSED';session.completed_at=stamp();session.completed_by=actor();}return {saved:true};
  }
  if(name==='complete_pilot_count_paper'){requireRole(fieldRole()||identity.role==='OWNER');const {session}=findSession(args.p_session_id);if(args.p_review)session.paper_reviewed_at=stamp();else {session.paper_completed_at=stamp();session.paper_completed_by=actor();}return {saved:true};}
  if(name==='start_pilot_count'){requireRole(identity.role==='SUPERVISOR'||identity.role==='OWNER');const s=space(id);if(s.sessions[0].status==='IN_PROGRESS')return s.sessions[0].id;const next={...clone(s.sessions[0]),id:uid(),status:'IN_PROGRESS',started_at:stamp(),completed_at:null,paper_completed_at:null,paper_reviewed_at:null};s.sessions.unshift(next);return next.id;}
  if(name==='get_pilot_receipts')return space(id).batches;
  if(name==='get_pilot_receipt'){
    const s=space(id),batch=s.batches.find(b=>b.id===args.p_batch_id);if(!batch)denied();
    return {batch,review_allowed:fieldRole(),full_access:identity.role!=='STAFF',erp_actor:batch.erp_completed_by,documents:[],run:{id:`${batch.id}-ocr`,status:'SUCCEEDED',model:'預設示範資料',started_at:batch.uploaded_at,completed_at:batch.uploaded_at,error_code:null},job:{status:'SUCCEEDED',attempt_count:1},fields:s.fields[batch.id],mappings:s.products.slice(0,2).map((p,i)=>({row_key:`row-${i}`,product_id:p.id,name:p.name,code:p.product_code,unit:p.base_unit,specification:p.specification})),receipt:batch.review_saved?{id:batch.id,reviewed_at:stamp()}:null,review:{saved_rows:batch.review_saved?['row-0','row-1']:batch.saved_rows||[],complete:!!batch.review_saved}};
  }
  if(name==='correct_pilot_receipt_field'){requireRole(fieldRole());for(const s of Object.values(business().spaces))for(const fields of Object.values(s.fields)){const f=fields.find(f=>f.id===args.p_field_id);if(f){f.value=args.p_value;f.corrected=true;return {saved:true};}}denied();}
  if(name==='save_pilot_receipt_review'){requireRole(fieldRole());const batch=space(id).batches.find(b=>b.id===args.p_batch_id);if(!batch)denied();batch.saved_rows ||= [];if(!batch.saved_rows.includes(args.p_row_key))batch.saved_rows.push(args.p_row_key);const complete=['row-0','row-1'].every(key=>batch.saved_rows.includes(key));batch.review_saved=complete;if(complete)batch.status='COMPLETED';return {saved:true,complete};}
  if(name==='complete_pilot_receipt_erp'){requireRole(fieldRole());const batch=space(id).batches.find(b=>b.id===args.p_batch_id);if(!batch)denied();batch.erp_completed_at=stamp();batch.erp_completed_by=actor();return {saved:true};}
  if(name==='authorize_app_feature'){requireRole(feature(id,args.p_feature));return true;}
  denied();
}

// Supabase-shaped thenables let the production components keep their existing API.
function result(run) {
  let promise;
  const get=()=>promise ||= Promise.resolve().then(run).then(data=>({data:clone(data),error:null}),error=>({data:null,error:{message:error.message,code:error.code||'DEMO_UNAVAILABLE'}}));
  return {then:(resolve,reject)=>get().then(resolve,reject),catch:reject=>get().catch(reject),finally:done=>get().finally(done),abortSignal(){return this;}};
}
function table(name) {
  const filters=[];let single=false,limit=Infinity,order;
  const read=()=>{
    const spaces=Object.values(business().spaces);
    const tables={count_zones:()=>spaces.flatMap(s=>s.zones),inventory_count_sessions:()=>spaces.flatMap(s=>s.sessions),count_entries:()=>spaces.flatMap(s=>s.results),count_zone_progress:()=>spaces.flatMap(s=>s.progress),count_drafts:()=>spaces.flatMap(s=>s.drafts),inventory_count_discrepancies:()=>spaces.flatMap(s=>s.discrepancies),products:()=>spaces.flatMap(s=>s.products.map(p=>({...p,organization_id:business().organization.id}))),inventory_import_files:()=>[],inventory_import_rows:()=>[],inventory_import_batches:()=>[]};
    if(!tables[name])denied();let rows=tables[name]().filter(r=>filters.every(f=>f(r)));
    if(order)rows.sort((a,b)=>String(a[order.key]).localeCompare(String(b[order.key]))*(order.ascending?1:-1));rows=rows.slice(0,limit);return single?rows[0]||null:rows;
  };
  const query={...result(read),select(){return this;},eq(key,value){filters.push(r=>r[key]===value);return this;},in(key,values){filters.push(r=>values.includes(r[key]));return this;},is(key,value){filters.push(r=>r[key]===value);return this;},gte(key,value){filters.push(r=>r[key]>=value);return this;},lte(key,value){filters.push(r=>r[key]<=value);return this;},order(key,options={}){order={key,ascending:options.ascending!==false};return this;},limit(n){limit=n;return this;},maybeSingle(){single=true;return this;},single(){single=true;return this;}};
  return query;
}
export function createDemoClient() {
  return {rpc(name,args={}){return result(()=>{const key=args.p_request_id?`${identity.businessType}:${name}:${args.p_request_id}`:null;if(key&&requests.has(key))return requests.get(key);const data=rpc(name,args);if(key)requests.set(key,clone(data));return data;});},from:table,
    auth:new Proxy({}, {get:()=>()=>result(()=>denied())}),
    functions:{invoke:()=>result(()=>denied())},
    storage:{from:()=>({upload:()=>result(()=>denied()),download:()=>result(()=>denied()),createSignedUrl:()=>result(()=>denied())})}};
}
export const demoClient = createDemoClient();
