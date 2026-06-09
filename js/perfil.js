if (!requireAuth()) void 0;



const u = usuario();
if (u) {
    document.getElementById('avatar-letra').textContent = u.nombre.charAt(0).toUpperCase();
    document.getElementById('perfil-nombre').textContent = u.nombre;
    document.getElementById('perfil-email').textContent = u.email;
    document.getElementById('info-nombre').textContent = u.nombre;
    document.getElementById('info-email').textContent = u.email;
    document.getElementById('info-rol').textContent = u.rol;
}
if (u?.rol === 'superadmin') {
    document.getElementById('card-admin').style.display = 'block';
}
function confirmarLogout() {
    if (confirm('¿Seguro que quieres cerrar sesión?')) logout();
}

async function toggleNotificaciones() {
    const btn = document.getElementById('btn-notif');
    const activas = await verificarNotificaciones();
    if (activas) {
        const token = localStorage.getItem('og_push_token');
        if (token) await api.delete('/api/notificaciones/token', { token });
        localStorage.removeItem('og_push_token');
        btn.textContent = '🔔 Activar notificaciones';
        showToast('Notificaciones desactivadas');
    } else {
        setLoading(btn, true);
        await solicitarPermisoPush();
        setLoading(btn, false);
    }
    actualizarBtnNotif();
}

async function actualizarBtnNotif() {
    const activas = await verificarNotificaciones();
    const btn = document.getElementById('btn-notif');
    btn.textContent = activas ? '🔕 Desactivar notificaciones' : '🔔 Activar notificaciones';
    btn.className = activas ? 'btn btn-secundario w-full' : 'btn btn-primary w-full';
}

iniciarListenerForeground();
actualizarBtnNotif();

// ── Wallpapers predefinidos (Unsplash - libres de uso) ──
const WALLPAPERS = [
    {
        thumb: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920&q=90',
        label: 'Construcción'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1590496793929-36417d3117de?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1590496793929-36417d3117de?w=1920&q=90',
        label: 'Obra'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1920&q=90',
        label: 'Trabajo'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1920&q=90',
        label: 'Ciudad'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1920&q=90',
        label: 'Casa'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=90',
        label: 'Arquitectura'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1920&q=90',
        label: 'Campo'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=90',
        label: 'Montaña'
    },
    {
        thumb: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=80',
        full: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=90',
        label: 'Ciudad noche'
    }
];

const fondoActual = localStorage.getItem('og_fondo');

function renderGaleria() {
    document.getElementById('galeria-fondos').innerHTML = WALLPAPERS.map((w, i) => {
        const seleccionado = fondoActual === w.full;
        return `
          <div onclick="elegirWallpaper('${w.full}', ${i})" style="position:relative;cursor:pointer;border-radius:10px;overflow:hidden;border:3px solid ${seleccionado ? 'var(--amarillo)' : 'transparent'};transition:border .2s" id="wall-${i}">
            <img src="${w.thumb}" style="width:100%;aspect-ratio:16/9;object-fit:cover;display:block" loading="lazy">
            <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.5);color:white;font-size:.6rem;font-weight:600;padding:3px 5px">${w.label}</div>
            ${seleccionado ? '<div style="position:absolute;top:4px;right:4px;background:var(--amarillo);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:.7rem">✓</div>' : ''}
          </div>`;
    }).join('');

    // Mostrar botón quitar si hay fondo
    document.getElementById('btn-quitar-fondo').style.display = fondoActual ? 'block' : 'none';

    // Mostrar preview si hay fondo propio (no de galería)
    const esDeGaleria = WALLPAPERS.some(w => w.full === fondoActual);
    if (fondoActual && !esDeGaleria) {
        document.getElementById('fondo-preview-wrap').style.display = 'block';
        document.getElementById('fondo-preview-img').src = fondoActual;
    }
}

async function elegirWallpaper(url, idx) {
    await guardarFondoUrl(url);
}

async function subirFondoCloudinary(blob, nombreArchivo) {
    // Subir como FormData al backend que lo sube a Cloudinary
    const fd = new FormData();
    fd.append('foto', blob, nombreArchivo);
    fd.append('carpeta', 'fondos');
    const res = await fetch(`${API_URL}/api/auth/fondo-upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${api.token()}` },
        body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error subiendo');
    return data.url;
}

function subirFondoPropio(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return showToast('Máximo 15MB', 'error');

    showToast('⏳ Subiendo fondo…');

    // Comprimir primero
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    const reader = new FileReader();

    reader.onload = e => {
        img.onload = async () => {
            const maxW = 1920;
            const ratio = Math.min(1, maxW / img.width);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            canvas.toBlob(async (blob) => {
                try {
                    // Subir a Cloudinary via backend
                    const url = await subirFondoCloudinary(blob, file.name);
                    await guardarFondoUrl(url);
                } catch (err) {
                    // Fallback: guardar en localStorage si falla Cloudinary
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
                    guardarFondoLocal(dataUrl);
                    showToast('Guardado localmente (sin Cloudinary)', 'ok');
                }
            }, 'image/jpeg', 0.85);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function guardarFondoUrl(url) {
    // Guardar en servidor
    try {
        await api.put('/api/auth/fondo', { fondo_url: url });
    } catch (e) {
        showToast('Sin conexión, guardado solo localmente', 'ok');
    }
    // Aplicar localmente
    guardarFondoLocal(url);
    showToast('✓ Fondo aplicado');
    renderGaleria();
}

function guardarFondoLocal(url) {
    localStorage.setItem('og_fondo', url);
    document.body.style.backgroundImage = `url(${url})`;
    document.body.classList.add('con-fondo');
    document.getElementById('btn-quitar-fondo').style.display = 'block';
    const esBase64 = url.startsWith('data:');
    document.getElementById('fondo-preview-wrap').style.display = esBase64 ? 'block' : 'none';
    if (esBase64) document.getElementById('fondo-preview-img').src = url;
}

async function quitarFondo() {
    try { await api.put('/api/auth/fondo', { fondo_url: null }); } catch (e) { }
    localStorage.removeItem('og_fondo');
    document.body.style.backgroundImage = '';
    document.body.classList.remove('con-fondo');
    document.getElementById('fondo-preview-wrap').style.display = 'none';
    document.getElementById('btn-quitar-fondo').style.display = 'none';
    showToast('Fondo quitado');
    renderGaleria();
}

renderGaleria();