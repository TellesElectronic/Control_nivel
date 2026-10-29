// ============================================================
// MONITOREO DE TANQUE AÉREO · UPT ARAGUA
//
// Convención de sensores:
// LS-101  = 1: hay agua disponible en el tanque subterráneo.
// LSH-201 = 1: el agua alcanzó el sensor superior.
// LSL-202 = 1: el agua alcanzó el sensor inferior.
//
// La web muestra lo reportado por el ESP32.
// Las protecciones físicas deben ejecutarse en el ESP32.
// ============================================================

const $ = id => document.getElementById(id);

let S = null;
let apiOK = false;
let est = 0;
let consultando = false;
let enviandoControl = false;
let chart = null;

const MAX_EDAD_SEGUNDOS = 60;

// ============================================================
// GRÁFICA
// Si Chart.js no está disponible, la tabla y los avisos
// pueden seguir funcionando.
// ============================================================

if (typeof Chart !== 'undefined' && $('ch')) {
  chart = new Chart($('ch'), {
    type: 'line',

    data: {
      labels: [],

      datasets: [
        {
          label: 'Bomba',
          data: [],
          borderColor: '#c8303a',
          stepped: true,
          pointRadius: 0
        },
        {
          label: 'LS-101',
          data: [],
          borderColor: '#1a9b55',
          stepped: true,
          pointRadius: 0
        },
        {
          label: 'LSH-201',
          data: [],
          borderColor: '#e08b00',
          stepped: true,
          pointRadius: 0
        },
        {
          label: 'LSL-202',
          data: [],
          borderColor: '#123a8c',
          stepped: true,
          pointRadius: 0
        }
      ]
    },

    options: {
      maintainAspectRatio: false,
      animation: false,

      scales: {
        y: {
          min: 0,
          max: 1.2,

          ticks: {
            stepSize: 1,

            callback: valor =>
              valor === 0 ? 'OFF' :
              valor === 1 ? 'ON' : ''
          }
        }
      }
    }
  });
} else {
  console.warn(
    'Gráfica no disponible: comprueba Chart.js y el elemento #ch.'
  );
}

// ============================================================
// INSTRUCCIONES OPCIONALES DE LA API
// ============================================================

const ep = $('ep');

if (ep) {
  ep.textContent =
`GET ${location.origin}/api/data?ls101=1&lsh201=0&lsl202=0&bomba=1&fallo=0&codigo=0&id=ESP32-01&fmt=txt

Respuesta de ejemplo:
BOMBA=1;MODO=auto

Control:
GET ${location.origin}/api/control?modo=manual&bomba=1

Vaciar historial:
GET ${location.origin}/api/reset`;
}

// ============================================================
// FUNCIONES AUXILIARES
// ============================================================

function edadLectura(e) {
  if (!e || !e.ts) return Infinity;

  const tiempo = new Date(e.ts).getTime();

  if (!Number.isFinite(tiempo)) return Infinity;

  return Math.max(0, (Date.now() - tiempo) / 1000);
}

function horaLocal(fecha) {
  if (!fecha) return 'sin datos';

  const tiempo = new Date(fecha);

  if (!Number.isFinite(tiempo.getTime())) {
    return 'fecha inválida';
  }

  return tiempo.toLocaleTimeString('es-VE');
}

function nivelLabel(valor) {
  if (valor >= 98) return 'Lleno';
  if (valor >= 70) return 'Alto';
  if (valor >= 40) return 'Medio';
  if (valor > 2) return 'Bajo';

  return 'Vacío';
}

function conn(texto, clase) {
  if ($('connTxt')) {
    $('connTxt').textContent = texto;
  }

  if ($('dot')) {
    $('dot').className = `dot ${clase}`;
  }
}

function actualizarConexion() {
  if (!apiOK) {
    conn('No se pudieron actualizar los datos', 'bad');
    return;
  }

  const reciente =
    S &&
    edadLectura(S.estado) < MAX_EDAD_SEGUNDOS;

  conn(
    reciente
      ? 'ESP32 en línea'
      : 'Sin datos recientes del ESP32',
    reciente ? 'ok' : ''
  );
}

// ============================================================
// BOTONES DE CONTROL
// Esta limitación se ejecuta aunque falte el panel #alarmas.
// ============================================================

function actualizarBotones() {
  const e = S?.estado;
  const manual = S?.control?.modo === 'manual';

  const datosVigentes =
    apiOK &&
    e &&
    edadLectura(e) < MAX_EDAD_SEGUNDOS;

  const permitidoEncender =
    datosVigentes &&
    e.ls101 === 1 &&
    e.lsh201 === 0 &&
    e.fallo === 0;

  if ($('on')) {
    $('on').disabled =
      enviandoControl ||
      !manual ||
      !permitidoEncender;
  }

  if ($('off')) {
    // Se permite solicitar apagado en manual aunque
    // la última lectura esté desactualizada.
    $('off').disabled =
      enviandoControl ||
      !manual;
  }

  document.querySelectorAll('.seg button').forEach(boton => {
    boton.disabled = enviandoControl;
  });
}

// ============================================================
// REPRESENTACIÓN DEL AGUA
// La altura es ilustrativa, no un porcentaje medido.
// ============================================================

function renderWater() {
  const aguaAerea = $('wa');

  if (aguaAerea) {
    aguaAerea.setAttribute('height', 1.5 * est);
    aguaAerea.setAttribute('y', 180 - 1.5 * est);
  }

  if ($('pctA')) {
    $('pctA').textContent = nivelLabel(est);
  }

  if ($('kN')) {
    $('kN').textContent = nivelLabel(est);
  }

  const nivelSubterraneo = S?.estado?.ls101 ? 70 : 6;
  const aguaSubterranea = $('ws');

  if (aguaSubterranea) {
    aguaSubterranea.setAttribute(
      'height',
      1.2 * nivelSubterraneo
    );

    aguaSubterranea.setAttribute(
      'y',
      370 - 1.2 * nivelSubterraneo
    );
  }
}

// ============================================================
// ESTADO DE SENSORES, BOMBA Y MODO
// ============================================================

function render(e, control) {
  const sensores = [
    ['sLS', 'tLS', e.ls101],
    ['sLSH', 'tLSH', e.lsh201],
    ['sLSL', 'tLSL', e.lsl202]
  ];

  sensores.forEach(([idLed, idTexto, valor]) => {
    const activo = valor === 1;
    const led = $(idLed);
    const texto = $(idTexto);

    if (led) {
      led.classList.toggle('on', activo);
    }

    if (texto) {
      texto.innerHTML =
        `<span class="pill ${activo ? 'on' : ''}">` +
        `${activo ? 'ACTIVO' : 'INACTIVO'}</span>`;
    }
  });

  if ($('kB')) {
    $('kB').textContent =
      e.bomba === 1 ? 'ENCENDIDA' : 'APAGADA';

    $('kB').style.color =
      e.bomba === 1 ? '#1a9b55' : '#c8303a';
  }

  if ($('kM')) {
    $('kM').textContent =
      control.modo === 'manual' ? 'Manual' : 'Automático';
  }

  if ($('kT')) {
    $('kT').textContent = horaLocal(e.ts);
  }

  document.querySelectorAll('.seg button').forEach(boton => {
    boton.classList.toggle(
      'act',
      boton.dataset.m === control.modo
    );
  });

  // No mantener movimiento animado si los datos son antiguos.
  const animarBomba =
    apiOK &&
    edadLectura(e) < MAX_EDAD_SEGUNDOS &&
    e.bomba === 1;

  if ($('flow')) {
    $('flow').classList.toggle('on', animarBomba);
  }

  if ($('rotor')) {
    $('rotor').classList.toggle('on', animarBomba);
  }

  actualizarBotones();
  renderWater();
}

// ============================================================
// ADVERTENCIAS Y FALLAS
// ============================================================

function renderAvisos(e) {
  const contenedor = $('alarmas');

  if (!contenedor) return;

  const avisos = [];

  const agregar = (tipo, texto) => {
    avisos.push({ tipo, texto });
  };

  const edad = edadLectura(e);

  if (!apiOK) {
    agregar(
      'danger',
      'No se pudieron actualizar los datos. ' +
      'La información mostrada no confirma el estado actual del equipo.'
    );
  } else if (edad >= MAX_EDAD_SEGUNDOS) {
    agregar(
      'warn',
      'Sin datos recientes del ESP32. ' +
      'Los estados siguientes corresponden a la última lectura recibida.'
    );
  }

  if (!e.ts) {
    agregar(
      'info',
      'Todavía no se ha recibido una lectura del ESP32.'
    );
  } else {
    // Incoherencia según la convención: 1 = agua presente.
    if (e.lsh201 === 1 && e.lsl202 === 0) {
      agregar(
        'danger',
        'MANTENIMIENTO: LSH-201 activo y LSL-202 inactivo. ' +
        'Revisar sensores, cableado y polaridad. ' +
        'La bomba debe permanecer bloqueada.'
      );
    }

    if (e.lsh201 === 1) {
      agregar(
        e.bomba === 1 ? 'danger' : 'info',

        e.bomba === 1
          ? 'ALARMA: se reporta tanque lleno y salida de bomba ' +
            'encendida. Revisar inmediatamente el control y la salida.'
          : 'Tanque aéreo lleno. Se reporta la salida de bomba apagada.'
      );
    }

    if (e.ls101 === 0) {
      agregar(
        e.bomba === 1 ? 'danger' : 'warn',

        e.bomba === 1
          ? 'ALARMA: se reporta la salida de bomba encendida ' +
            'sin agua disponible en el tanque subterráneo.'
          : 'Sin agua disponible en el tanque subterráneo. ' +
            'La bomba debe permanecer bloqueada.'
      );
    }

    if (e.fallo === 1) {
      const descripciones = {
        0: 'Indicador de falla activo sin una causa específica.',
        1: 'Lecturas incoherentes entre LSH-201 y LSL-202.',
        2: 'Sin agua disponible en LS-101.',
        3: 'Lecturas incoherentes y ausencia de agua en LS-101.'
      };

      const descripcion =
        descripciones[e.codigo] ||
        'Código no informado o no reconocido.';

      agregar(
        'danger',
        `Falla reportada por el ESP32. ` +
        `Código: ${e.codigo ?? 'no informado'}. ${descripcion}`
      );
    } else if (e.fallo !== 0) {
      agregar(
        'warn',
        'La lectura no incluye un indicador de falla válido. ' +
        'Comprueba la API y el firmware del ESP32. ' +
        'El encendido manual permanece deshabilitado.'
      );
    }

    if (!avisos.length) {
      agregar(
        'ok',
        'Sin advertencias en la última lectura recibida.'
      );
    }
  }

  contenedor.replaceChildren();

  avisos.forEach(aviso => {
    const div = document.createElement('div');

    div.className = `aviso ${aviso.tipo}`;
    div.textContent = aviso.texto;

    contenedor.appendChild(div);
  });
}

// ============================================================
// TABLA DEL HISTORIAL
// Los valores recibidos se insertan como texto.
// ============================================================

function agregarCelda(fila, texto, clase = '') {
  const celda = document.createElement('td');

  celda.textContent = texto;

  if (clase) celda.className = clase;

  fila.appendChild(celda);

  return celda;
}

function agregarEstado(fila, valor) {
  const celda = document.createElement('td');
  const indicador = document.createElement('span');
  const activo = valor === 1;

  indicador.className = `pill ${activo ? 'on' : ''}`;
  indicador.textContent = activo ? 'ACTIVO' : 'INACTIVO';

  celda.appendChild(indicador);
  fila.appendChild(celda);
}

function renderTabla(historial) {
  const tabla = $('tb');

  if (!tabla) return;

  tabla.replaceChildren();

  if ($('tbEmpty')) {
    $('tbEmpty').style.display =
      historial.length ? 'none' : 'block';
  }

  const fragmento = document.createDocumentFragment();

  [...historial].reverse().forEach(registro => {
    const fila = document.createElement('tr');

    const dispositivo =
      registro.t === S.estado.ts
        ? (S.estado.dispositivo || 'ESP32')
        : '—';

    agregarCelda(fila, horaLocal(registro.t), 'num');
    agregarCelda(fila, dispositivo);

    agregarEstado(fila, registro.ls);
    agregarEstado(fila, registro.lsh);
    agregarEstado(fila, registro.lsl);
    agregarEstado(fila, registro.b);

    agregarCelda(fila, registro.m || '—');

    fragmento.appendChild(fila);
  });

  tabla.appendChild(fragmento);
}

// ============================================================
// ACTUALIZACIÓN GENERAL
// ============================================================

function renderData() {
  if (!S) return;

  const historial = Array.isArray(S.historial)
    ? S.historial
    : [];

  render(S.estado, S.control);
  renderAvisos(S.estado);

  if (chart) {
    chart.data.labels = historial.map(registro =>
      horaLocal(registro.t)
    );

    chart.data.datasets[0].data =
      historial.map(registro => registro.b);

    chart.data.datasets[1].data =
      historial.map(registro => registro.ls);

    chart.data.datasets[2].data =
      historial.map(registro => registro.lsh);

    chart.data.datasets[3].data =
      historial.map(registro => registro.lsl);

    chart.update();
  }

  renderTabla(historial);
}

// ============================================================
// CONSULTA DE DATOS
// ============================================================

async function poll() {
  if (consultando) return;

  consultando = true;

  try {
    const respuesta = await fetch('/api/data', {
      cache: 'no-store'
    });

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    const datos = await respuesta.json();

    if (
      !datos ||
      !datos.estado ||
      !datos.control ||
      !Array.isArray(datos.historial)
    ) {
      throw new Error('La API devolvió una estructura no válida.');
    }

    S = datos;
    apiOK = true;

    actualizarConexion();
    renderData();
  } catch (error) {
    apiOK = false;

    console.error('Error al consultar /api/data:', error);

    actualizarConexion();
    actualizarBotones();

    if (S) {
      render(S.estado, S.control);
      renderAvisos(S.estado);
    } else if ($('alarmas')) {
      $('alarmas').textContent =
        'No fue posible obtener los datos de la API. ' +
        'Consulta la consola del navegador.';
    }
  } finally {
    consultando = false;
  }
}

// ============================================================
// ÓRDENES MANUALES
// ============================================================

async function ctl(parametros) {
  if (enviandoControl) return;

  // Comprobación adicional antes de solicitar encendido.
  if (Number(parametros.bomba) === 1) {
    const e = S?.estado;

    const permitido =
      apiOK &&
      S?.control?.modo === 'manual' &&
      e &&
      edadLectura(e) < MAX_EDAD_SEGUNDOS &&
      e.ls101 === 1 &&
      e.lsh201 === 0 &&
      e.fallo === 0;

    if (!permitido) {
      alert(
        'No se permite solicitar el encendido. ' +
        'Comprueba el modo, los sensores, las fallas ' +
        'y la fecha de la última lectura.'
      );

      return;
    }
  }

  enviandoControl = true;
  actualizarBotones();

  try {
    const consulta = new URLSearchParams(parametros);

    const respuesta = await fetch(`/api/control?${consulta}`, {
      cache: 'no-store'
    });

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    await poll();
  } catch (error) {
    console.error('Error al enviar la orden:', error);

    alert(
      'No se pudo confirmar el envío de la orden. ' +
      'Verifica la conexión y el estado del equipo.'
    );
  } finally {
    enviandoControl = false;
    actualizarBotones();
  }
}

document.querySelectorAll('.seg button').forEach(boton => {
  boton.onclick = () => {
    ctl({ modo: boton.dataset.m });
  };
});

if ($('on')) {
  $('on').onclick = () => ctl({ bomba: 1 });
}

if ($('off')) {
  $('off').onclick = () => ctl({ bomba: 0 });
}

// ============================================================
// VACIAR HISTORIAL
// ============================================================

if ($('clear')) {
  $('clear').onclick = async () => {
    const confirmado = confirm(
      '¿Deseas vaciar el historial de lecturas?'
    );

    if (!confirmado) return;

    $('clear').disabled = true;

    try {
      const respuesta = await fetch('/api/reset', {
        cache: 'no-store'
      });

      if (!respuesta.ok) {
        throw new Error(`Error HTTP ${respuesta.status}`);
      }

      await poll();
    } catch (error) {
      console.error('Error al vaciar el historial:', error);

      alert(
        'No se pudo confirmar el vaciado del historial.'
      );
    } finally {
      $('clear').disabled = false;
    }
  };
}

// ============================================================
// ANIMACIÓN Y VIGENCIA DE LOS DATOS
// ============================================================

function tick() {
  actualizarConexion();
  actualizarBotones();

  if (!S) return;

  const e = S.estado;
  const edad = edadLectura(e);

  // Actualizar los mensajes aunque una consulta de red esté pendiente.
  renderAvisos(e);

  const vigente =
    apiOK &&
    edad < MAX_EDAD_SEGUNDOS;

  const animarBomba =
    vigente &&
    e.bomba === 1;

  if ($('flow')) {
    $('flow').classList.toggle('on', animarBomba);
  }

  if ($('rotor')) {
    $('rotor').classList.toggle('on', animarBomba);
  }

  if (!vigente || !e.ts) return;

  if (e.lsh201 === 1) {
    est = 100;
  } else if (e.lsl202 === 0) {
    est = Math.min(est, 20);
  }

  if (
    e.bomba === 1 &&
    e.ls101 === 1 &&
    e.lsh201 === 0 &&
    e.fallo === 0
  ) {
    est = Math.min(100, est + 1.5);
  }

  renderWater();
}

// ============================================================
// INICIO
// Estas instrucciones deben estar fuera de las funciones.
// ============================================================

actualizarBotones();

setInterval(poll, 3000);
setInterval(tick, 700);

poll();
