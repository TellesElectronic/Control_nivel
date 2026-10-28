// Almacenamiento: Upstash Redis (si existen variables) o memoria (volátil)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DEF = { estado:{nivel:0,ls101:0,lsh201:0,lsl202:1,bomba:0,ts:null,dispositivo:null},
  control:{modo:'auto',bomba:0}, historial:[] };
globalThis.__T = globalThis.__T || JSON.parse(JSON.stringify(DEF));
async function cmd(args){const r=await fetch(URL_,{method:'POST',headers:{Authorization:`Bearer ${TOK}`},body:JSON.stringify(args)});return (await r.json()).result;}
export async function load(){ if(!URL_) return globalThis.__T;
  const v=await cmd(['GET','tanque']); return v?JSON.parse(v):JSON.parse(JSON.stringify(DEF)); }
export async function save(s){ if(!URL_){globalThis.__T=s;return;} await cmd(['SET','tanque',JSON.stringify(s)]); }
export const persistente = !!URL_;
