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
const CAMPOS_BASICOS = ['nombre','nacimiento','posicion','club','altura','video','video2','bio'];
const COLS_PERFIL = 'id,nombre,nacimiento,posicion,club,altura,video,video2,bio,foto,estado,plan,owner_email';

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

function limpiarBasicos(d){
  const out = {};
  for(const k of CAMPOS_BASICOS){
    if(!(k in d)) continue;
    let v = d[k];
    v = (v === null || v === undefined) ? '' : String(v).trim();
    if(k === 'nombre'){ v = v.slice(0, 80); if(!v) throw new Error('Falta el nombre'); }
    else if(k === 'nacimiento'){ v = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
    else if(k === 'altura'){ const n = parseInt(v, 10); v = (n >= 140 && n <= 215) ? n : null; }
    else if(k === 'posicion'){ v = v.split(',').map(x => x.trim()).filter(x => POSICIONES.includes(x)).slice(0, 3).join(', ') || null; }
    else if(k === 'video' || k === 'video2'){ v = /^https?:\/\/\S+$/i.test(v) ? v.slice(0, 300) : null; }
    else if(k === 'bio'){ v = v.slice(0, 600) || null; }
    else { v = v.slice(0, 80) || null; }
    out[k] = v;
  }
  return out;
}

export default async (req) => {
  const url = new URL(req.url);
  try{
    // ----- Aprobar desde el link del mail -----
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
