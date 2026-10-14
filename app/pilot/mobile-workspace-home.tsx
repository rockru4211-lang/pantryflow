'use client';
import type {ComponentProps} from 'react';
import {localMonth} from '@/lib/app-workspace';
import FieldReminders from './field-reminders';
import MobileWorkHome from './mobile-work-home';
import {useWorkFeed} from './work-feed';

type Props=Omit<ComponentProps<typeof MobileWorkHome>,'rows'|'error'|'refresh'> & {userId:string};
export default function MobileWorkspaceHome(props:Props){
 const work=useWorkFeed(props.store,localMonth());
 return <MobileWorkHome {...props} reminders={<FieldReminders key={`${props.userId}:${props.store.id}`} store={props.store} userId={props.userId} rows={work.rows} feedError={work.error} onOpen={row=>props.onOpenWork?.(row)} refreshFeed={work.refresh}/>} rows={work.rows} error={work.error} refresh={work.refresh}/>;
}
