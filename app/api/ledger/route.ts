import { getChatGPTUser } from '../../chatgpt-auth';
import { getDb } from '../../../db';
import { ledgers } from '../../../db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
const cents=z.number().int().min(0).max(100000000000);
const ledgerSchema=z.object({branch:z.string().trim().min(1).max(120),opening:cents,revision:z.number().int().min(0),entries:z.array(z.object({date:z.string(),capital:cents,purchases:cents,costs:cents,other:cents,type:z.enum(['pulang','pass']),to:z.string().max(200)})).max(10000)});
const json = (data: unknown, status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
export async function GET() {
 const user=await getChatGPTUser(); if(!user) return json({error:'Sila log masuk semula.'},401);
 const rows=await getDb().select().from(ledgers).where(eq(ledgers.userId,user.userId));
 return json(rows[0]?{...JSON.parse(rows[0].payload),revision:rows[0].revision}:{branch:'',opening:0,entries:[],revision:0});
}
export async function PUT(request: Request) {
 const user=await getChatGPTUser(); if(!user) return json({error:'Sila log masuk semula.'},401);
 let parsed; try {parsed=ledgerSchema.safeParse(await request.json());} catch{return json({error:'Data tidak sah.'},400);}
 if(!parsed.success)return json({error:'Data tidak sah.'},400);
 const b=parsed.data;
 const dates=new Set();
 for(const e of b.entries){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||Number.isNaN(Date.parse(e.date))||new Date(e.date).toISOString().slice(0,10)!==e.date||dates.has(e.date)) return json({error:'Rekod tidak sah atau tarikh berulang.'},400);
  dates.add(e.date);
 }
 const db=getDb();
 const payload=JSON.stringify({branch:b.branch,opening:b.opening,entries:b.entries});
 if(b.revision===0){const inserted=await db.insert(ledgers).values({userId:user.userId,payload,revision:1}).onConflictDoNothing().returning();if(inserted.length)return json({revision:1});}
 const result=await db.update(ledgers).set({payload,revision:b.revision+1}).where(and(eq(ledgers.userId,user.userId),eq(ledgers.revision,b.revision))).returning();
 return result.length?json({revision:b.revision+1}):json({error:'Rekod telah berubah di peranti lain. Muat semula sebelum mengedit.'},409);
}
