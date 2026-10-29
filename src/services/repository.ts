import type { Activity, ActivityKind, CatalogQuery, ExecutionState, PageResult, ParameterValue, Preferences, Report } from '../types';
import { reports, MOCK_REFERENCE_DATE } from '../data/mock/reports';
import { categories } from '../data/mock/categories';
import { seededActivity } from '../data/mock/activity';
export const defaultQuery:CatalogQuery={search:'',category:'',department:'',type:'',usage:'',sort:'name',page:1};
export function queryReports(source:Report[],q:CatalogQuery):PageResult<Report>{
 const search=q.search.trim().toLowerCase();
 const items=source.filter(r=>(!search||[r.name,r.description,r.code,categories.find(c=>c.id===r.categoryId)?.name,...r.keywords].join(' ').toLowerCase().includes(search))&&(!q.category||r.categoryId===q.category)&&(!q.department||r.department===q.department)&&(!q.type||r.reportType===q.type)&&(!q.usage||(q.usage==='frequent'?r.usageCount>=20:Date.parse(r.createdAt)>=Date.parse(MOCK_REFERENCE_DATE)-30*86400000)));
 items.sort((a,b)=>q.sort==='usage'?b.usageCount-a.usageCount||a.name.localeCompare(b.name):q.sort==='time'?a.typicalExecutionTimeSeconds-b.typicalExecutionTimeSeconds||a.name.localeCompare(b.name):q.sort==='added'?b.createdAt.localeCompare(a.createdAt)||a.name.localeCompare(b.name):a.name.localeCompare(b.name));
 const pages=Math.max(1,Math.ceil(items.length/20));const page=Math.min(Math.max(1,q.page),pages);return {items:items.slice((page-1)*20,page*20),total:items.length,pages};
}
export function validateParameters(report:Report,values:Record<string,ParameterValue>):Record<string,string>{
 const errors:Record<string,string>={};for(const p of report.parameters){const v=values[p.id];if(p.required&&(!v||!v.length||typeof v==='string'&&!v.trim()))errors[p.id]=`${p.label} is required.`;if(p.kind==='date'&&v&&typeof v==='string'&&!/^\d{4}-\d{2}-\d{2}$/.test(v))errors[p.id]='Enter a valid date.';}
 if(values.startDate&&values.endDate&&String(values.startDate)>String(values.endDate))errors.endDate='End date must be on or after start date.';return errors;
}
export function executionTransition(state:ExecutionState,action:'run'|'complete'|'reset'):ExecutionState{return action==='reset'?'idle':action==='run'&&state==='idle'?'processing':action==='complete'&&state==='processing'?'success':state;}
type Stored={version:1;favorites:string[];activity:Activity[];preferences:Preferences};
const initial=():Stored=>({version:1,favorites:['receivable-1','sales-1','inventory-1','finance-2'],activity:[],preferences:{view:'list',density:'comfortable'}});
export class LocalStore {
 data:Stored=initial();warning='';
 constructor(private storage?:Storage){try{const raw=storage?.getItem('efi-hub-v1');if(raw){const p:unknown=JSON.parse(raw);if(!this.valid(p))throw Error('Invalid stored preferences');this.data=p;}}catch{this.warning='Saved browser data could not be read. Using session defaults.';}}
 private valid(p:unknown):p is Stored {if(typeof p!=='object'||p===null)return false;const d=p as Partial<Stored>;return d.version===1&&Array.isArray(d.favorites)&&d.favorites.every(x=>typeof x==='string')&&Array.isArray(d.activity)&&d.activity.every(a=>a&&typeof a.id==='string'&&typeof a.reportId==='string'&&['viewed','favorite-added','favorite-removed','demo-started','demo-completed'].includes(a.kind)&&!Number.isNaN(Date.parse(a.at))&&a.source==='local')&&!!d.preferences&&['list','grid'].includes(d.preferences.view)&&['comfortable','compact'].includes(d.preferences.density);}
 save(){try{if(!this.storage)throw Error();this.storage.setItem('efi-hub-v1',JSON.stringify(this.data));}catch{this.warning='Browser storage is unavailable. Changes will last for this session only.';}}
 toggle(id:string){const exists=this.data.favorites.includes(id);this.data.favorites=exists?this.data.favorites.filter(x=>x!==id):[...this.data.favorites,id];this.record(id,exists?'favorite-removed':'favorite-added');return !exists;}
 record(reportId:string,kind:ActivityKind){const event:Activity={id:crypto.randomUUID(),reportId,kind,at:new Date().toISOString(),source:'local'};this.data.activity=[event,...this.data.activity].slice(0,500);this.save();}
}
let browserStorage:Storage|undefined;try{browserStorage=window.localStorage;}catch{/* private mode fallback */}
export const localStore=new LocalStore(browserStorage);
export interface ReportRepository {
 getReports(query:CatalogQuery,ids?:string[]):Promise<PageResult<Report>>;
 getReport(id:string):Promise<Report|undefined>;
 getCategories():Promise<typeof categories>;
 getActivity():Promise<Activity[]>;
 getFavorites():Promise<string[]>;
 toggleFavorite(id:string):Promise<boolean>;
 recordActivity(id:string,kind:ActivityKind):Promise<void>;
 executeDemo(id:string,action:'run'|'complete'|'reset',state:ExecutionState):Promise<ExecutionState>;
}
export const repository:ReportRepository={
 async getReports(q,ids){return queryReports(ids?reports.filter(r=>ids.includes(r.id)):reports,q);},async getReport(id){return reports.find(r=>r.id===id);},async getCategories(){return categories;},async getActivity(){return [...localStore.data.activity,...seededActivity].sort((a,b)=>b.at.localeCompare(a.at));},async getFavorites(){return [...localStore.data.favorites];},async toggleFavorite(id){return localStore.toggle(id);},async recordActivity(id,kind){localStore.record(id,kind);},async executeDemo(id,action,state){const next=executionTransition(state,action);if(next!==state&&action!=='reset')localStore.record(id,action==='run'?'demo-started':'demo-completed');return next;}
};
