const SUPABASE_URL = 'https://epvgqigrcyooavgskmzc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-m_OmQzyG290M3pOaPCd8Q_e58eq4cT';
const EMPRESA = 'videosjugadores';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export default async (req) => {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').replace(/[^\w-]/g, '');
  let j = null;

  if (id) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/players?id=eq.${id}&empresa=eq.${EMPRESA}&select=nombre,foto,bio,posicion`,
        { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
      );
      const data = await r.json();
      j = Array.isArray(data) ? data[0] : null;
    } catch (e) { /* si falla, servimos la previa genérica */ }
  }

  const nombre = j?.nombre || 'VIDEOSJUGADORES';
  const titulo = j ? `${j.nombre} — VIDEOSJUGADORES` : 'VIDEOSJUGADORES';
  let desc = j?.bio || (j?.posicion ? j.posicion : 'Perfiles profesionales de futbolistas: datos, trayectoria y videos.');
  if (desc.length > 155) desc = desc.slice(0, 152).trimEnd() + '…';

  // WhatsApp solo puede mostrar fotos que sean un link real (no archivos subidos en base64)
  const foto = j?.foto && /^https?:\/\//i.test(j.foto) ? j.foto : null;

  const origen = url.origin;
  const urlCanonica = `${origen}/jugador/${id}`;
  const destino = `/#jugador-${id}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(titulo)}</title>
<meta property="og:type" content="profile">
<meta property="og:site_name" content="VIDEOSJUGADORES">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(urlCanonica)}">
${foto ? `<meta property="og:image" content="${esc(foto)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(foto)}">` : ''}
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta http-equiv="refresh" content="0;url=${destino}">
</head>
<body>
<p>Abriendo el perfil de ${esc(nombre)}…</p>
<script>location.replace('${destino}');</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' }
  });
};
