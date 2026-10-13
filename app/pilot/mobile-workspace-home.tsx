'use client';
import type {ComponentProps} from 'react';
import {localMonth} from '@/lib/app-workspace';
import MobileWorkHome from './mobile-work-home';
import {useWorkFeed} from './work-feed';

type Props=Omit<ComponentProps<typeof MobileWorkHome>,'rows'|'error'|'refresh'>;
export default function MobileWorkspaceHome(props:Props){
 const work=useWorkFeed(props.store,localMonth());
 return <MobileWorkHome {...props} rows={work.rows} error={work.error} refresh={work.refresh}/>;
}
