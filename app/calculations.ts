export type Entry={date:string;capital:number;purchases:number;costs:number;other:number;type:'pulang'|'pass';to:string};
export type Data={branch:string;opening:number;entries:Entry[];revision:number};
export function calculate(opening:number,entries:Entry[]){
 let balance=opening;
 return [...entries].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>{
  const start=balance,total=start+e.capital,subtotal=total-e.purchases-e.costs;
  balance=subtotal-e.other;return {...e,start,total,subtotal,balance};
 });
}
export function monthly(opening:number,entries:Entry[],month:string){
 const all=calculate(opening,entries),before=all.filter(e=>e.date<month+'-01'),rows=all.filter(e=>e.date.startsWith(month));
 const start=before.at(-1)?.balance??opening;
 const sum=(key:'capital'|'purchases'|'costs'|'other')=>rows.reduce((s,r)=>s+r[key],0);
 return {rows,start,capital:sum('capital'),total:start+sum('capital'),purchases:sum('purchases'),costs:sum('costs'),other:sum('other'),balance:rows.at(-1)?.balance??start};
}
export const money=(cents:number)=>'RM'+(cents/100).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2});
export const dateLabel=(date:string)=>date.split('-').reverse().join('/');
export function report(branch:string,row:ReturnType<typeof calculate>[number]){
 return `*DAILY REPORT*\n${dateLabel(row.date)}\nCawangan: ${branch || '[Cawangan]'}\n\n──────────────\nModal Awal: ${money(row.start)}\nModal Hari Ini: ${money(row.capital)}\n*Total Modal: ${money(row.total)}*\n\n──────────────\n*Total Kos: ${money(row.costs)}*\n*Total Belian: ${money(row.purchases)}*\n*Total Kos + Belian: ${money(row.costs+row.purchases)}*\n\n──────────────\n*${row.type==='pass'?'PASS':'PULANG'} MODAL*\nKepada: ${row.to||'-'}\n${money(row.other)}\n\n──────────────\n*BAKI MODAL*\n*${money(row.balance)}*`;
}
