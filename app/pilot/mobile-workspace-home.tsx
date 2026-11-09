'use client';
import type {ComponentProps} from 'react';
import {Camera,ChevronRight} from 'lucide-react';
import {localMonth} from '@/lib/app-workspace';
import FieldReminders from './field-reminders';
import MobileWorkHome from './mobile-work-home';
import {useWorkFeed} from './work-feed';
import {useReceiptRetakeFeed} from './use-receipt-retake-feed';

type Props=Omit<ComponentProps<typeof MobileWorkHome>,'rows'|'error'|'refresh'> & {userId:string};
export default function MobileWorkspaceHome(props:Props){
 const work=useWorkFeed(props.store,localMonth());
 const retakes=useReceiptRetakeFeed(props.store);
 const retakeNotice=(retakes.rows.length>0||retakes.error)&&<section className="bm-tasks" aria-label="貨單待重拍">
  <div className="bm-section-head"><h2>貨單待重拍{retakes.rows.length>0&&<span>{retakes.rows.length}</span>}</h2>
   {retakes.rows.length>3&&<button type="button" onClick={()=>props.onNavigate('tasks')}>查看全部<ChevronRight size={16}/></button>}
  </div>
  {retakes.error&&<p role="alert">{retakes.error}<button type="button" onClick={retakes.refresh}>重試</button></p>}
  <div className="bm-rows">{retakes.rows.slice(0,3).map(row=><button type="button" className="bm-row bm-task" key={row.key}
   onClick={()=>props.onOpenWork?props.onOpenWork(row):props.onNavigate('receiving')}>
   <span className="bm-icon"><Camera aria-hidden="true"/></span><span className="bm-copy"><strong>{row.copy}</strong><small>點此補拍</small></span><ChevronRight/>
  </button>)}</div>
 </section>;
 return <MobileWorkHome {...props} retakeNotice={retakeNotice} reminders={<FieldReminders key={`${props.userId}:${props.store.id}`} store={props.store} userId={props.userId} rows={work.rows} feedError={work.error} onOpen={row=>props.onOpenWork?.(row)} refreshFeed={work.refresh}/>} rows={work.rows} error={work.error} refresh={work.refresh}/>;
}
