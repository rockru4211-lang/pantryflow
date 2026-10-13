'use client';
import type {AppStore} from '@/lib/app-workspace';
import EquipmentRecords from './equipment-records';
type Props={store:AppStore;mobileMode:boolean;initialId?:string;onSuppliers:()=>void;registerLeave?:(handler:(()=>Promise<boolean>)|null)=>void};
export default function EquipmentWorkspace(props:Props){return <EquipmentRecords {...props}/>;}
