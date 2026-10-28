import { load, save } from './_store.js';
// Solo guarda la orden (modo manual / arranque-parada). No fuerza el estado de la bomba: decide el ESP32.
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','no-store');
  const s=await load(), q=req.query;
  if(q.modo==='auto'||q.modo==='manual') s.control.modo=q.modo;
  if(q.bomba!==undefined) s.control.bomba=(q.bomba==='1'||q.bomba==='on')?1:0;
  await save(s); res.json({ok:true,control:s.control,estado:s.estado});
}
