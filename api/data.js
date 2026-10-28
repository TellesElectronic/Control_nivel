import { load, save, persistente } from './_store.js';

const b = v =>
  (v === '1' || v === 'true' || v === 'on' || v === 1) ? 1 : 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const q = req.query;
  const s = await load();

  const esSubida =
    q.ls101 !== undefined ||
    q.lsh201 !== undefined ||
    q.lsl202 !== undefined;

  if (!esSubida) {
    return res.json({ ...s, persistente });
  }

  if (process.env.API_KEY && q.key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'key inválida' });
  }

  const p = s.estado;

  const e = {
    ls101: q.ls101 !== undefined ? b(q.ls101) : p.ls101,
    lsh201: q.lsh201 !== undefined ? b(q.lsh201) : p.lsh201,
    lsl202: q.lsl202 !== undefined ? b(q.lsl202) : p.lsl202,

    // Estado reportado: no sustituirlo por la orden deseada.
    bomba: q.bomba !== undefined
      ? b(q.bomba)
      : (q.b !== undefined ? b(q.b) : p.bomba),

    // null identifica dispositivos que aún no reportan estos campos.
    fallo: q.fallo !== undefined ? b(q.fallo) : null,
    codigo: q.codigo !== undefined
      ? Math.max(0, Math.min(3, parseInt(q.codigo, 10) || 0))
      : null,

    ts: new Date().toISOString(),
    dispositivo: q.id || 'ESP32'
  };

  if (q.nivel !== undefined) {
    e.nivel = Math.max(0, Math.min(100, parseFloat(q.nivel) || 0));
  }

  s.estado = e;
  s.historial.push({
    t: e.ts,
    b: e.bomba,
    ls: e.ls101,
    lsh: e.lsh201,
    lsl: e.lsl202,
    f: e.fallo,
    cod: e.codigo,
    m: s.control.modo
  });

  if (s.historial.length > 200) {
    s.historial = s.historial.slice(-200);
  }

  await save(s);

  let orden = s.control.modo === 'manual'
    ? s.control.bomba
    : e.bomba;

  // Protección complementaria del servidor.
  // La protección principal sigue estando en el ESP32.
  if (!e.ls101 || e.lsh201 || e.fallo === 1) {
    orden = 0;
  }

  if (q.fmt === 'txt') {
    return res.send(`BOMBA=${orden};MODO=${s.control.modo}`);
  }

  return res.json({
    ok: true,
    bomba: orden,
    modo: s.control.modo,
    fallo: e.fallo,
    codigo: e.codigo
  });
}
