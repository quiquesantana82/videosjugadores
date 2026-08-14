const SUPABASE_URL = 'https://epvgqigrcyooavgskmzc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_-m_OmQzyG290M3pOaPCd8Q_e58eq4cT';
const EMPRESA = 'videosjugadores';

// Ata la función directamente a la ruta que se comparte por WhatsApp.
export const config = { path: '/jugador/:id' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export default async (req, context) => {
  const url = new URL(req.url);

  // Leemos el ID de donde venga: parámetro de ruta (:id), query (?id=) o el propio path.
  let id = (context && context.params && context.params.id) || url.searchParams.get('id') || '';
  if (!id) {
    const m = url.pathname.match(/\/jugador\/([^/?#]+)/);
    if (m) id = m[1];
  }
  id = String(id).replace(/[^\w-]/g, '');

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

  // WhatsApp solo muestra fotos que sean un link real (http/https), no archivos subidos en base64.
  const foto = j?.foto && /^https?:\/\//i.test(j.foto) ? j.foto : null;

  const origen = url.origin;
  const urlCanonica = `${origen}/jugador/${id}`;
  // Redirige a la app (raíz + hash). NUNCA a /jugador/ID de nuevo, para no reinvocar la función.
  const destino = id ? `/#jugador-${id}` : '/';

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
<meta property="og:image:width" content="1080">
<meta property="og:image:height" content="1350">
<meta property="og:image:alt" content="${esc(nombre)}">
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
