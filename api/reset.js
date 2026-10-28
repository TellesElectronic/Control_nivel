import { load, save } from './_store.js';
// Vacía el historial de lecturas (base de datos)
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','no-store');
  const s=await load(); s.historial=[]; await save(s);
  res.json({ok:true,historial:[]});
}
