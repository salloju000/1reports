import type { ReportParameter } from '../../types';
const company:ReportParameter = {id:'company',label:'Company',kind:'select',required:true,options:['Northstar Packaging Ltd.','Northstar Print Division']};
const period:ReportParameter[]=[{id:'startDate',label:'Start date',kind:'date',required:true},{id:'endDate',label:'End date',kind:'date',required:true}];
export function parametersFor(category:string,index:number):ReportParameter[]{
 const scope:ReportParameter = category==='receivable'||category==='sales'?{id:'customer',label:'Customer',kind:'text'}:category==='payable'||category==='purchasing'?{id:'supplier',label:'Supplier',kind:'text'}:{id:'branches',label:'Branches',kind:'multi-select',options:['Mumbai','Pune','Bengaluru']};
 return [company,...(index%3===0?[{id:'asOf',label:'As of date',kind:'date',required:true} as ReportParameter]:period),scope,{id:'reportType',label:'Report detail',kind:'select',required:true,options:['Summary','Detailed']}];
}
