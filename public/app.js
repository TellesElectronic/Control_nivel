const $=id=>document.getElementById(id);let S=null,apiOK=false,est=0;
const chart=new Chart($('ch'),{type:'line',data:{labels:[],datasets:[
 {label:'Bomba',data:[],borderColor:'#c8303a',stepped:true,pointRadius:0},
 {label:'LS-101',data:[],borderColor:'#1a9b55',stepped:true,pointRadius:0},
 {label:'LSH-201',data:[],borderColor:'#e08b00',stepped:true,pointRadius:0},
 {label:'LSL-202',data:[],borderColor:'#123a8c',stepped:true,pointRadius:0}]},
 options:{maintainAspectRatio:false,animation:false,
  scales:{y:{min:0,max:1.2,ticks:{stepSize:1,callback:v=>['','OFF','ON'][v]||''}}}}});
// Mostrar las instrucciones solamente si existe su contenedor.
const ep = document.getElementById('ep');

if (ep) {
  ep.textContent =
`GET ${location.origin}/api/data?ls101=1&lsh201=0&lsl202=0&bomba=0&id=ESP32-01&fmt=txt
Respuesta: BOMBA=1;MODO=manual   (o JSON: {"ok":true,"bomba":1,"modo":"manual"})
Control:  GET ${location.origin}/api/control?modo=manual&bomba=1
Vaciar:   GET ${location.origin}/api/reset`;
}
function nivelLabel(v){return v>=98?'Lleno':v>=70?'Alto':v>=40?'Medio':v>2?'Bajo':'Vacío';}
function renderWater(){
  $('wa').setAttribute('height',1.5*est);$('wa').setAttribute('y',180-1.5*est);
  $('pctA').textContent=nivelLabel(est);
  const sub=S&&S.estado.ls101?70:6;$('ws').setAttribute('height',1.2*sub);$('ws').setAttribute('y',370-1.2*sub);
  $('kN').textContent=nivelLabel(est);}
function render(e,c){
  [['sLS','tLS',e.ls101],['sLSH','tLSH',e.lsh201],['sLSL','tLSL',e.lsl202]].forEach(([a,b,v])=>{$(a).classList.toggle('on',!!v);$(b).innerHTML=`<span class="pill ${v?'on':''}">${v?'ACTIVO':'INACTIVO'}</span>`});
  $('flow').classList.toggle('on',!!e.bomba);$('rotor').classList.toggle('on',!!e.bomba);
  $('kB').textContent=e.bomba?'ENCENDIDA':'APAGADA';$('kB').style.color=e.bomba?'#1a9b55':'#c8303a';
  $('kM').textContent=c.modo==='manual'?'Manual':'Automático';
  $('kT').textContent=e.ts?new Date(e.ts).toLocaleTimeString('es-VE'):'sin datos';
  document.querySelectorAll('.seg button').forEach(b=>b.classList.toggle('act',b.dataset.m===c.modo));
  $('on').disabled=$('off').disabled=c.modo!=='manual';
  renderWater();}

function renderAvisos(e) {
  const contenedor = $('alarmas');
  if (!contenedor) return;

  const avisos = [];
  const agregar = (tipo, texto) => avisos.push({ tipo, texto });

  const edad = e.ts
    ? (Date.now() - new Date(e.ts).getTime()) / 1000
    : Infinity;

  if (edad > 60) {
    agregar(
      'warn',
      'Sin datos recientes del ESP32. Los estados siguientes son la última lectura, no una confirmación del estado actual.'
    );
  }

  if (!e.ts) {
    agregar('info', 'Todavía no se ha recibido una lectura.');
  } else {
    if (e.lsh201 && !e.lsl202) {
      agregar(
        'danger',
        'MANTENIMIENTO: LSH-201 activo y LSL-202 inactivo. Revisar sensores, cableado y polaridad. La bomba debe permanecer bloqueada.'
      );
    }

    if (e.lsh201) {
      agregar(
        e.bomba ? 'danger' : 'info',
        e.bomba
          ? 'ALARMA: el ESP32 reporta tanque lleno y bomba encendida. Revisar inmediatamente el control y la salida.'
          : 'Tanque aéreo lleno: llenado detenido por nivel alto.'
      );
    }

    if (!e.ls101) {
      agregar(
        e.bomba ? 'danger' : 'warn',
        e.bomba
          ? 'ALARMA: bomba reportada encendida sin agua disponible en el tanque subterráneo.'
          : 'Sin agua disponible en el tanque subterráneo: bomba bloqueada.'
      );
    }

    if (e.fallo === 1) {
      agregar(
        'danger',
        `El ESP32 reporta una condición de falla. Código: ${e.codigo ?? 'no informado'}.`
      );
    } else if (e.fallo === null || e.fallo === undefined) {
      agregar(
        'warn',
        'Esta lectura todavía no incluye el indicador de falla. Actualiza el firmware del ESP32.'
      );
    }

    if (!avisos.length) {
      agregar('ok', 'Sin advertencias en la última lectura recibida.');
    }
  }

  // textContent evita interpretar los mensajes como HTML.
  contenedor.replaceChildren();

  for (const aviso of avisos) {
    const div = document.createElement('div');
    div.className = `aviso ${aviso.tipo}`;
    div.textContent = aviso.texto;
    contenedor.appendChild(div);
  }

  // Solo se limita el botón de encendido; se conserva el de apagado.
  $('on').disabled =
    S.control.modo !== 'manual' ||
    edad > 60 ||
    !e.ls101 ||
    !!e.lsh201 ||
    e.fallo !== 0;
}

function renderData() {
  if (!S) return;

  const h = S.historial;
  render(S.estado, S.control);
  renderAvisos(S.estado);
  chart.data.labels=h.map(x=>new Date(x.t).toLocaleTimeString('es-VE'));
  chart.data.datasets[0].data=h.map(x=>x.b);chart.data.datasets[1].data=h.map(x=>x.ls);
  chart.data.datasets[2].data=h.map(x=>x.lsh);chart.data.datasets[3].data=h.map(x=>x.lsl);chart.update();
  const tb=$('tb');if(!h.length){$('tbEmpty').style.display='block';tb.innerHTML='';return;}
  $('tbEmpty').style.display='none';
  const p=v=>`<span class="pill ${v?'on':''}">${v?'ACTIVO':'INACTIVO'}</span>`;
  tb.innerHTML=[...h].reverse().map(r=>`<tr><td class="num">${new Date(r.t).toLocaleTimeString('es-VE')}</td><td>${r.t===S.estado.ts?(S.estado.dispositivo||'ESP32'):'—'}</td><td>${p(r.ls)}</td><td>${p(r.lsh)}</td><td>${p(r.lsl)}</td><td>${p(r.b)}</td><td>${r.m||'—'}</td></tr>`).join('');}
function conn(t,c){$('connTxt').textContent=t;$('dot').className='dot '+c}
async function poll(){try{const r=await fetch('/api/data',{cache:'no-store'});if(!r.ok)throw 0;S=await r.json();apiOK=true;
    const age=S.estado.ts?(Date.now()-new Date(S.estado.ts))/1000:1e9;
    conn(age<60?'ESP32 en línea':'Sin datos recientes del ESP32',age<60?'ok':'');
    renderData();}
  catch{apiOK=false;conn('API no disponible (despliegue en Vercel)','bad');}}
async function ctl(q){await fetch('/api/control?'+new URLSearchParams(q));poll();}
document.querySelectorAll('.seg button').forEach(b=>b.onclick=()=>ctl({modo:b.dataset.m}));
$('on').onclick=()=>ctl({bomba:1});$('off').onclick=()=>ctl({bomba:0});
$('clear').onclick=async()=>{try{await fetch('/api/reset');}catch{}
  if(S){S.historial=[];renderData();}};
// Animación de llenado: solo con lo que envía el ESP32.
// Llena mientras la bomba trabaja con agua abajo; LSH-201 lo marca lleno; LSL-202 lo limita a bajo.
function tick() {
  if (!S || !apiOK || !S.estado.ts) return;

  const e = S.estado;
  const edad = (Date.now() - new Date(e.ts).getTime()) / 1000;

  if (edad > 60) return;

  if (e.lsh201) {
    est = 100;
  } else if (!e.lsl202) {
    est = Math.min(est, 20);
  }

  if (e.bomba && e.ls101 && !e.lsh201 && e.fallo === 0) {
    est = Math.min(100, est + 1.5);
  }

  renderWater();
}
