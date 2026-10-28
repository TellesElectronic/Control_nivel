# Monitoreo de tanque aéreo · UPT Aragua
- `public/` web (animación de llenado, gráfica, tabla de lecturas, control manual, botón de vaciar historial)
- `api/data` (el ESP32 sube su estado por GET: sensores + bomba), `api/control` (modo/orden manual), `api/reset` (vacía el historial)
- La web no calcula nada: la bomba y los sensores mostrados son los que reporta el ESP32. En modo manual la orden se retransmite y el ESP32 decide (con protección LS-101).
- Despliegue: `npx vercel --prod`. Para persistencia real añade Upstash Redis (Marketplace de Vercel); sin ella los datos viven en memoria y pueden reiniciarse.
- Opcional: variable `API_KEY` y enviar `&key=...` desde el ESP32.
