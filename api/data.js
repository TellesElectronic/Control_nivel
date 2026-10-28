import { load, save, persistente } from './_store.js';
const b = v => (v==='1'||v==='true'||v==='on'||v===1) ? 1 : 0;
// El ESP32 es la autoridad: la web solo guarda y muestra lo que él envía.
// La lógica de arranque/parada vive en el ESP32; el servidor solo retransmite la orden manual.
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Cache-Control','no-store');
  const q=req.query, s=await load();
  if(q.ls101!==undefined || q.lsh201!==undefined || q.lsl202!==undefined){ // ESP32 sube datos
    const k=q.key; if(process.env.API_KEY && k!==process.env.API_KEY) return res.status(401).json({error:'key inválida'});
    const p=s.estado;
    const e={ ls101: q.ls101!==undefined?b(q.ls101):p.ls101,
      lsh201: q.lsh201!==undefined?b(q.lsh201):p.lsh201,
      lsl202: q.lsl202!==undefined?b(q.lsl202):p.lsl202,
      bomba: (q.bomba!==undefined?b(q.bomba):(q.b!==undefined?b(q.b):p.bomba))||0,
      ts:new Date().toISOString(), dispositivo:q.id||'ESP32' };
    if(q.nivel!==undefined) e.nivel=Math.max(0,Math.min(100,parseFloat(q.nivel)||0));
    s.estado=e;
    s.historial.push({t:e.ts,b:e.bomba,ls:e.ls101,lsh:e.lsh201,lsl:e.lsl202,m:s.control.modo});
    if(s.historial.length>200) s.historial=s.historial.slice(-200);
    await save(s);
    const orden = s.control.modo==='manual' ? s.control.bomba : e.bomba; // orden manual se retransmite; en automático el ESP32 decide
    if(q.fmt==='txt') return res.send(`BOMBA=${orden};MODO=${s.control.modo}`);
    return res.json({ok:true,bomba:orden,modo:s.control.modo});
  }
  return res.json({...s,persistente});
}
