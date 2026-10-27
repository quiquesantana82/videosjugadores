// Perfiles de jugadores registrados: alta (pendiente de aprobación), edición básica,
// subida de foto, aprobación y mails.
//
// Variables de entorno en Netlify (Site configuration → Environment variables):
//   SUPABASE_SECRET_KEY   clave secreta (sb_secret_…) o service_role del proyecto Supabase  [obligatoria]
//   APROBAR_SECRET        texto largo al azar para firmar los links de aprobación             [obligatoria]
//   ADMIN_PASSWORD        la misma contraseña del panel ⚙ (para aprobar desde el panel)        [obligatoria]
//   ADMIN_EMAIL           mail donde te llegan los avisos de registros nuevos                   [obligatoria]
//   RESEND_API_KEY        clave de resend.com para mandar los mails                             [obligatoria]
//   MAIL_FROM             remitente, ej: "VIDEOSJUGADORES <hola@videosjugadores.com>"            [opcional]
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://epvgqigrcyooavgskmzc.supabase.co';
const SUPABASE_PUBLIC = 'sb_publishable_-m_OmQzyG290M3pOaPCd8Q_e58eq4cT';
const EMPRESA = 'videosjugadores';
const BUCKET = 'fotos-jugadores';
const POSICIONES = ['Arquero','Defensa central','Lateral derecho','Lateral izquierdo','Volante defensivo','Volante mixto','Volante ofensivo','Extremo derecho','Extremo izquierdo','Delantero centro'];
// Campos que el jugador puede editar él mismo (nada de estadísticas, valor, agencia, etc.)
const CAMPOS_BASICOS = ['nombre','nacimiento','posicion','club','altura','video','video2','bio','libre_club_desde','libre_agente_desde'];
const COLS_PERFIL = 'id,nombre,nacimiento,posicion,club,altura,video,video2,bio,foto,estado,plan,owner_email,libre_club_desde,libre_agente_desde';

const env = k => (typeof Netlify !== 'undefined' && Netlify.env && Netlify.env.get(k)) || process.env[k] || '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function json(data, status = 200){
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function html(cuerpo, status = 200){
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VIDEOSJUGADORES</title>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090C;color:#F4F6F8;font-family:system-ui,sans-serif;padding:24px}
  .c{max-width:440px;text-align:center;background:#0E1218;border:1px solid #232C38;border-radius:14px;padding:32px 26px}
  h1{font-size:22px;margin:0 0 10px}p{color:#8B97A5;line-height:1.5;margin:0 0 20px}
  a{display:inline-block;background:#57B8E8;color:#07090C;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px}</style></head>
  <body><div class="c">${cuerpo}</div></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

// ---------- Supabase con la clave secreta (solo del lado del servidor) ----------
function hdrSecreto(extra = {}){
  const k = env('SUPABASE_SECRET_KEY');
  const h = { apikey: k, ...extra };
  if(!k.startsWith('sb_')) h.Authorization = 'Bearer ' + k; // clave service_role vieja (JWT)
  return h;
}
async function rest(path, opts = {}){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: hdrSecreto({ 'content-type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) })
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch(e) { data = txt; }
  if(!r.ok) throw new Error('Supabase ' + r.status + ': ' + (data && data.message ? data.message : txt).slice(0, 300));
  return data;
}
async function usuarioDesdeToken(req){
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if(!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_PUBLIC, Authorization: 'Bearer ' + token } });
  if(!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
async function perfilDe(uid){
  const rows = await rest(`players?empresa=eq.${EMPRESA}&owner_id=eq.${uid}&select=${COLS_PERFIL}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

// ---------- Firma de los links de aprobación ----------
function firma(id){
  const s = env('APROBAR_SECRET');
  if(!s) throw new Error('Falta APROBAR_SECRET');
  return crypto.createHmac('sha256', s).update('aprobar:' + id).digest('hex').slice(0, 32);
}
function firmaOk(id, t){
  try { const a = Buffer.from(firma(id)), b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); }
  catch(e) { return false; }
}

// ---------- Mails (Resend) ----------
function plantilla(titulo, parrafos, boton){
  return `<div style="background:#07090C;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#0E1218;border:1px solid #232C38;border-radius:14px;overflow:hidden">
    <div style="padding:18px 24px;border-bottom:1px solid #232C38;font-weight:800;letter-spacing:.06em;color:#F4F6F8">
      <span style="background:#F4F6F8;color:#07090C;padding:2px 6px">VIDEOS</span> JUGADORES</div>
    <div style="padding:26px 24px;color:#C9D2DC;font-size:15px;line-height:1.6">
      <h1 style="color:#F4F6F8;font-size:21px;margin:0 0 14px">${titulo}</h1>
      ${parrafos.map(p => `<p style="margin:0 0 14px">${p}</p>`).join('')}
      ${boton ? `<p style="margin:22px 0 6px"><a href="${esc(boton.url)}" style="display:inline-block;background:#57B8E8;color:#07090C;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">${esc(boton.txt)}</a></p>` : ''}
    </div>
  </div></div>`;
}
async function mandarMail(to, subject, htmlBody){
  const key = env('RESEND_API_KEY');
  if(!key || !to) return false;
  try{
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env('MAIL_FROM') || 'VIDEOSJUGADORES <onboarding@resend.dev>', to: [to], subject, html: htmlBody })
    });
    if(!r.ok) console.error('Resend', r.status, await r.text());
    return r.ok;
  }catch(e){ console.error('Resend', e); return false; }
}
function sitio(req){ return env('URL') || new URL(req.url).origin; }

async function avisarRegistro(req, p){
  const base = sitio(req);
  const linkAprobar = `${base}/.netlify/functions/perfil?accion=aprobar&id=${encodeURIComponent(p.id)}&t=${firma(p.id)}`;
  await mandarMail(env('ADMIN_EMAIL'), `Nuevo registro: ${p.nombre}`, plantilla('Nuevo jugador registrado', [
    `<b style="color:#F4F6F8">${esc(p.nombre)}</b> (${esc(p.owner_email)}) se registró y está esperando tu aprobación.`,
    'Podés aprobarlo con el botón, o revisarlo antes desde el panel ⚙ del sitio.'
  ], { url: linkAprobar, txt: 'Aprobar perfil' }));
  await mandarMail(p.owner_email, '¡Bienvenido a VIDEOSJUGADORES!', plantilla(`¡Hola ${esc(String(p.nombre).split(' ')[0])}!`, [
    'Gracias por registrarte en VIDEOSJUGADORES.',
    'Tu perfil quedó <b style="color:#F4F6F8">en espera de aprobación</b>. Apenas lo aprobemos te llega un mail de confirmación y queda publicado.',
    'Mientras tanto ya podés entrar y completarlo: tu foto, tus videos, posición, club y altura.'
  ], { url: `${base}/#mi-perfil`, txt: 'Completar mi perfil' }));
}
async function aprobar(req, id){
  const rows = await rest(`players?id=eq.${encodeURIComponent(id)}&empresa=eq.${EMPRESA}`, {
    method: 'PATCH', body: JSON.stringify({ estado: 'aprobado' })
  });
  const p = Array.isArray(rows) ? rows[0] : null;
  if(!p) return null;
  if(p.owner_email){
    const base = sitio(req);
    await mandarMail(p.owner_email, '¡Tu perfil fue aprobado!', plantilla('¡Tu perfil ya está publicado! ✅', [
      `${esc(String(p.nombre).split(' ')[0])}, tu perfil ya aparece en VIDEOSJUGADORES y lo podés compartir con clubes y representantes.`,
      'Desde <b style="color:#F4F6F8">Mi perfil</b> podés actualizar tu foto y tus videos cuando quieras.',
      '¿Querés destacarte más? Con el <b style="color:#F4F6F8">Perfil Pro</b> sumás estadísticas oficiales de Wyscout, hasta 4 videos, galería de fotos, PDF para clubes y piezas para redes. Respondé este mail o escribinos por WhatsApp y te contamos.'
    ], { url: `${base}/jugador/${p.id}`, txt: 'Ver mi perfil' }));
  }
  return p;
}

// ---------- Foto: data URL -> Supabase Storage ----------
async function subirFoto(uid, dataUrl){
  const m = String(dataUrl).match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if(!m) throw new Error('Formato de foto no válido');
  const bytes = Buffer.from(m[2], 'base64');
  if(bytes.length > 3 * 1024 * 1024) throw new Error('La foto es muy pesada');
  // Crea el bucket público la primera vez (si ya existe, Supabase responde error y seguimos)
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST', headers: hdrSecreto({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
  }).catch(() => {});
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const path = `${EMPRESA}/${uid}-${Date.now()}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: hdrSecreto({ 'content-type': 'image/' + (ext === 'jpg' ? 'jpeg' : ext), 'x-upsert': 'true', 'cache-control': '31536000' }),
    body: bytes
  });
  if(!r.ok) throw new Error('No se pudo subir la foto (' + r.status + ')');
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// ---------- Escudos: se guardan en Supabase Storage (bucket público "escudos") ----------
const BUCKET_ESC = 'escudos';
const TIPOS_ESC = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/svg+xml':'svg', 'image/gif':'gif' };
async function guardarEscudo(bytes, ctype, nombre){
  const ext = TIPOS_ESC[ctype];
  if(!ext) throw new Error('El archivo no es una imagen válida (' + (ctype || 'sin tipo') + ')');
  if(bytes.length > 1.5 * 1024 * 1024) throw new Error('La imagen pesa más de 1,5 MB');
  if(bytes.length < 80) throw new Error('La imagen está vacía');
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST', headers: hdrSecreto({ 'content-type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET_ESC, name: BUCKET_ESC, public: true })
  }).catch(() => {});
  const slug = String(nombre || 'club').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0, 50) || 'club';
  const path = `${slug}-${Date.now().toString(36)}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET_ESC}/${path}`, {
    method: 'POST', headers: hdrSecreto({ 'content-type': ctype, 'x-upsert': 'true', 'cache-control': '31536000' }), body: bytes
  });
  if(!r.ok) throw new Error('No se pudo guardar el escudo (' + r.status + ')');
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET_ESC}/${path}`;
}
async function escudoDesdeUrl(url, nombre){
  if(!/^https?:\/\//i.test(url)) throw new Error('Link no válido');
  if(url.startsWith(`${SUPABASE_URL}/storage/`)) return url; // ya es nuestro
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; VideosjugadoresBot/1.0)', accept: 'image/*' }, redirect: 'follow' });
  if(!r.ok) throw new Error('No se pudo bajar la imagen de ese link (' + r.status + ')');
  let ctype = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.from(await r.arrayBuffer());
  if(!TIPOS_ESC[ctype]){ // algunos servidores no mandan bien el tipo
    if(bytes[0] === 0x89 && bytes[1] === 0x50) ctype = 'image/png';
    else if(bytes[0] === 0xff && bytes[1] === 0xd8) ctype = 'image/jpeg';
    else if(bytes.slice(0, 200).toString().includes('<svg')) ctype = 'image/svg+xml';
    else if(bytes.slice(8, 12).toString() === 'WEBP') ctype = 'image/webp';
  }
  return guardarEscudo(bytes, ctype, nombre);
}

function limpiarBasicos(d){
  const out = {};
  for(const k of CAMPOS_BASICOS){
    if(!(k in d)) continue;
    let v = d[k];
    v = (v === null || v === undefined) ? '' : String(v).trim();
    if(k === 'nombre'){ v = v.slice(0, 80); if(!v) throw new Error('Falta el nombre'); }
    else if(k === 'nacimiento' || k === 'libre_club_desde' || k === 'libre_agente_desde'){ v = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
    else if(k === 'altura'){ const n = parseInt(v, 10); v = (n >= 140 && n <= 215) ? n : null; }
    else if(k === 'posicion'){ v = v.split(',').map(x => x.trim()).filter(x => POSICIONES.includes(x)).slice(0, 3).join(', ') || null; }
    else if(k === 'video' || k === 'video2'){ v = /^https?:\/\/\S+$/i.test(v) ? v.slice(0, 300) : null; }
    else if(k === 'bio'){ v = v.slice(0, 600) || null; }
    else { v = v.slice(0, 80) || null; }
    out[k] = v;
  }
  return out;
}

// ---------- Diagnóstico: /.netlify/functions/perfil?accion=diagnostico&clave=CLAVE_DEL_PANEL ----------
// Revisa la configuración sin mostrar ninguna clave. Con &mail=1 manda un mail de prueba a ADMIN_EMAIL.
async function diagnostico(req, url){
  const filas = [];
  const fila = (ok, titulo, detalle) => filas.push({ ok, titulo, detalle });
  const vars = ['SUPABASE_SECRET_KEY','RESEND_API_KEY','ADMIN_EMAIL','ADMIN_PASSWORD','APROBAR_SECRET','MAIL_FROM'];
  const clave = env('ADMIN_PASSWORD');
  if(clave && url.searchParams.get('clave') !== clave){
    return html('<h1>Diagnóstico</h1><p>Agregá <b>&amp;clave=</b> con la contraseña del panel ⚙ al final del link.</p>', 401);
  }
  for(const v of vars){
    const val = env(v);
    let det = val ? 'cargada' : 'falta cargarla en Netlify';
    if(v === 'ADMIN_EMAIL' && val) det = esc(val);
    if(v === 'MAIL_FROM' && val) det = esc(val);
    if(v === 'MAIL_FROM' && !val) det = 'opcional, pero sin ella los mails solo te llegan a vos (remitente de prueba de Resend)';
    if(v === 'SUPABASE_SECRET_KEY' && val && !/^(sb_secret_|eyJ)/.test(val)) det = 'cargada, pero no parece una clave secreta (debería empezar con sb_secret_ o eyJ)';
    if(v === 'RESEND_API_KEY' && val && !val.startsWith('re_')) det = 'cargada, pero no parece una key de Resend (debería empezar con re_)';
    fila(v === 'MAIL_FROM' ? (val ? true : null) : !!val && !/no parece/.test(det), v, det);
  }
  fila(true, 'Dirección del sitio', esc(sitio(req)) + ' <span style="color:#8B97A5">(se usa en los links de los mails)</span>');

  // Supabase: clave y columnas
  if(env('SUPABASE_SECRET_KEY')){
    try{ await rest(`players?empresa=eq.${EMPRESA}&select=id&limit=1`); fila(true, 'Conexión a Supabase con la clave secreta', 'funciona'); }
    catch(e){ fila(false, 'Conexión a Supabase con la clave secreta', esc(e.message)); }
    try{ await rest(`players?empresa=eq.${EMPRESA}&select=owner_id,owner_email,estado,plan,club,altura,club_escudo,libre_club_desde,libre_agente_desde&limit=1`); fila(true, 'Columnas nuevas en la tabla players', 'están todas'); }
    catch(e){ fila(false, 'Columnas nuevas en la tabla players', 'falta correr el SQL de las columnas — ' + esc(e.message)); }
    try{ const r = await rest('clubes?select=id,nombre,pais,escudo,alias&limit=1'); fila(true, 'Tabla de clubes (catálogo)', 'existe'); }
    catch(e){ fila(false, 'Tabla de clubes (catálogo)', 'falta crearla con el SQL — ' + esc(e.message)); }
    try{
      const r = await fetch(`${SUPABASE_URL}/rest/v1/clubes?select=id&limit=1`, { headers: { apikey: SUPABASE_PUBLIC, Authorization: 'Bearer ' + SUPABASE_PUBLIC } });
      fila(r.ok, 'Lectura pública del catálogo', r.ok ? 'el sitio puede leer los clubes' : 'el sitio no puede leer los clubes: falta la política de lectura del SQL');
    }catch(e){ fila(null, 'Lectura pública del catálogo', 'no se pudo revisar'); }
  }
  // Supabase Auth: confirmación de mail
  try{
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_PUBLIC } });
    const st = await r.json();
    if(st.disable_signup) fila(false, 'Registro de usuarios', 'está desactivado en Supabase (Authentication → Sign In / Providers → "Allow new users to sign up")');
    else fila(true, 'Registro de usuarios', 'habilitado');
    fila(st.mailer_autoconfirm ? true : false, '"Confirm email" apagado', st.mailer_autoconfirm ? 'sí, los jugadores entran directo al registrarse' : 'todavía está prendido: apagalo en Authentication → Sign In / Providers → Email');
  }catch(e){ fila(null, 'Configuración de Supabase Auth', 'no se pudo leer'); }
  // Resend: dominio
  if(env('RESEND_API_KEY')){
    try{
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY') } });
      const d = await r.json().catch(() => ({}));
      if(r.ok){
        const dom = (d.data || []).find(x => /videosjugadores\.com$/i.test(x.name));
        fila(dom && dom.status === 'verified', 'Dominio en Resend', dom ? esc(dom.name) + ': ' + esc(dom.status) : 'no aparece videosjugadores.com en esta cuenta de Resend');
      } else if(d && d.name === 'restricted_api_key'){
        fila(true, 'Key de Resend', 'válida (solo envío)');
      } else {
        fila(false, 'Key de Resend', 'Resend la rechaza: ' + esc(d.message || r.status));
      }
    }catch(e){ fila(null, 'Key de Resend', 'no se pudo consultar'); }
    const from = env('MAIL_FROM');
    if(from) fila(/@videosjugadores\.com>?\s*$/i.test(from), 'Remitente con tu dominio', esc(from));
  }
  // Mail de prueba
  if(url.searchParams.get('mail') === '1'){
    const ok = await mandarMail(env('ADMIN_EMAIL'), 'Prueba de VIDEOSJUGADORES ✅', plantilla('¡Los mails funcionan!', ['Este es un mail de prueba del diagnóstico. Si te llegó, los avisos de registro y aprobación también van a llegar.']));
    fila(ok, 'Mail de prueba a ' + esc(env('ADMIN_EMAIL') || '(sin ADMIN_EMAIL)'), ok ? 'enviado: revisá la bandeja (y el spam)' : 'no se pudo enviar (mirá los logs de la función en Netlify)');
  }
  const ico = ok => ok === true ? '✅' : ok === false ? '❌' : '⚠️';
  const linkMail = esc(url.pathname + '?accion=diagnostico&mail=1' + (clave ? '&clave=' + encodeURIComponent(url.searchParams.get('clave') || '') : ''));
  const todoOk = filas.every(f => f.ok !== false);
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Diagnóstico</title>
  <style>body{margin:0;background:#07090C;color:#F4F6F8;font-family:system-ui,sans-serif;padding:24px}main{max-width:720px;margin:0 auto}
  h1{font-size:24px}table{width:100%;border-collapse:collapse;background:#0E1218;border:1px solid #232C38;border-radius:12px;overflow:hidden}
  td{padding:12px 14px;border-bottom:1px solid #232C38;vertical-align:top;font-size:15px}td:first-child{width:28px}td b{display:block;margin-bottom:2px}
  .r{margin:16px 0;padding:14px 16px;border-radius:12px;background:${todoOk ? 'rgba(87,184,232,.1)' : 'rgba(232,87,87,.1)'};border:1px solid ${todoOk ? 'rgba(87,184,232,.4)' : 'rgba(232,87,87,.4)'}}
  a{display:inline-block;margin-top:16px;background:#57B8E8;color:#07090C;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:999px}</style></head>
  <body><main><h1>Diagnóstico de VIDEOSJUGADORES</h1>
  <div class="r">${todoOk ? 'Todo lo que se puede revisar desde acá está bien.' : 'Hay cosas para corregir (marcadas con ❌).'}</div>
  <table>${filas.map(f => `<tr><td>${ico(f.ok)}</td><td><b>${f.titulo}</b>${f.detalle}</td></tr>`).join('')}</table>
  <p style="color:#8B97A5;font-size:14px;margin-top:14px">No se puede revisar desde acá: las Redirect URLs de Supabase (solo afectan a "Me olvidé la contraseña").</p>
  <a href="${linkMail}">Mandarme un mail de prueba</a></main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export default async (req) => {
  const url = new URL(req.url);
  try{
    // ----- Aprobar desde el link del mail -----
    if(req.method === 'GET' && url.searchParams.get('accion') === 'diagnostico') return diagnostico(req, url);
    if(req.method === 'GET'){
      if(url.searchParams.get('accion') !== 'aprobar') return html('<h1>Nada por acá</h1>', 404);
      const id = url.searchParams.get('id') || '', t = url.searchParams.get('t') || '';
      if(!firmaOk(id, t)) return html('<h1>Link no válido</h1><p>El link de aprobación no es correcto o está incompleto.</p>', 403);
      const p = await aprobar(req, id);
      if(!p) return html('<h1>No se encontró el perfil</h1><p>Puede que lo hayas borrado desde el panel.</p>', 404);
      return html(`<h1>Perfil aprobado ✅</h1><p><b style="color:#F4F6F8">${esc(p.nombre)}</b> ya está publicado${p.owner_email ? ' y le mandamos el mail de confirmación' : ''}.</p><a href="${esc(sitio(req))}/jugador/${esc(p.id)}">Ver perfil</a>`);
    }
    if(req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
    const body = await req.json().catch(() => ({}));
    const accion = body.accion;

    // ----- Aprobar desde el panel ⚙ -----
    if(accion === 'aprobar_admin'){
      const clave = env('ADMIN_PASSWORD');
      if(!clave || body.clave !== clave) return json({ error: 'No autorizado' }, 401);
      const p = await aprobar(req, String(body.id || ''));
      return p ? json({ ok: true }) : json({ error: 'No encontrado' }, 404);
    }

    // ----- Catálogo de clubes (solo admin) -----
    if(String(accion || '').startsWith('club_')){
      const clave = env('ADMIN_PASSWORD');
      if(!clave || body.clave !== clave) return json({ error: 'No autorizado' }, 401);
      const limpiarClub = c => {
        const nombre = String(c.nombre || '').trim().slice(0, 90);
        if(!nombre) throw new Error('Falta el nombre del club');
        const escudo = String(c.escudo || '').trim();
        return {
          nombre,
          pais: String(c.pais || '').trim().slice(0, 60) || null,
          escudo: /^https?:\/\/\S+$/i.test(escudo) ? escudo.slice(0, 500) : null,
          alias: (Array.isArray(c.alias) ? c.alias : []).map(a => String(a).trim().slice(0, 60)).filter(Boolean).slice(0, 15)
        };
      };
      if(accion === 'club_guardar'){
        const c = body.club || {}, fila = limpiarClub(c);
        const rows = c.id
          ? await rest(`clubes?id=eq.${encodeURIComponent(c.id)}`, { method: 'PATCH', body: JSON.stringify(fila) })
          : await rest('clubes', { method: 'POST', body: JSON.stringify(fila) });
        return json({ club: rows[0] });
      }
      if(accion === 'club_escudo'){
        if(body.dataUrl){
          const m = String(body.dataUrl).match(/^data:(image\/[a-z+]+);base64,(.+)$/);
          if(!m) throw new Error('Formato de imagen no válido');
          return json({ url: await guardarEscudo(Buffer.from(m[2], 'base64'), m[1], body.nombre) });
        }
        return json({ url: await escudoDesdeUrl(String(body.url || '').trim(), body.nombre) });
      }
      if(accion === 'club_borrar'){
        await rest(`clubes?id=eq.${encodeURIComponent(String(body.id || ''))}`, { method: 'DELETE' });
        return json({ ok: true });
      }
      if(accion === 'club_importar'){
        const filas = (Array.isArray(body.clubes) ? body.clubes : []).slice(0, 300).map(limpiarClub);
        if(!filas.length) return json({ ok: true, n: 0 });
        const rows = await rest('clubes', { method: 'POST', body: JSON.stringify(filas) });
        return json({ ok: true, n: rows.length });
      }
      return json({ error: 'Acción desconocida' }, 400);
    }

    // ----- Acciones del jugador logueado -----
    const u = await usuarioDesdeToken(req);
    if(!u) return json({ error: 'Tenés que iniciar sesión' }, 401);
    const email = String(u.email || '').toLowerCase();

    if(accion === 'mio'){
      let p = await perfilDe(u.id);
      if(p) return json({ perfil: p });
      // ¿El admin ya le había armado un perfil con este mail? Lo vinculamos, sin pasar por aprobación.
      const previos = await rest(`players?empresa=eq.${EMPRESA}&owner_email=eq.${encodeURIComponent(email)}&owner_id=is.null&select=id&limit=1`);
      if(Array.isArray(previos) && previos[0]){
        const rows = await rest(`players?id=eq.${previos[0].id}&empresa=eq.${EMPRESA}&select=${COLS_PERFIL}`, {
          method: 'PATCH', body: JSON.stringify({ owner_id: u.id, owner_email: email })
        });
        return json({ perfil: rows[0], vinculado: true });
      }
      // Alta nueva: queda pendiente hasta que la apruebes
      const nombre = String((u.user_metadata && u.user_metadata.nombre) || body.nombre || email.split('@')[0]).trim().slice(0, 80);
      const rows = await rest(`players?select=${COLS_PERFIL}`, {
        method: 'POST',
        body: JSON.stringify({ empresa: EMPRESA, nombre, owner_id: u.id, owner_email: email, estado: 'pendiente', plan: 'basico' })
      });
      p = rows[0];
      await avisarRegistro(req, p);
      return json({ perfil: p, nuevo: true });
    }

    if(accion === 'guardar'){
      const p = await perfilDe(u.id);
      if(!p) return json({ error: 'No encontramos tu perfil' }, 404);
      const cambios = limpiarBasicos(body.datos || {});
      if(body.foto) cambios.foto = await subirFoto(u.id, body.foto);
      if(!Object.keys(cambios).length) return json({ perfil: p });
      const rows = await rest(`players?id=eq.${p.id}&owner_id=eq.${u.id}&empresa=eq.${EMPRESA}&select=${COLS_PERFIL}`, {
        method: 'PATCH', body: JSON.stringify(cambios)
      });
      return json({ perfil: rows[0] });
    }

    return json({ error: 'Acción desconocida' }, 400);
  }catch(e){
    console.error(e);
    return json({ error: e.message || 'Error inesperado' }, 500);
  }
};
