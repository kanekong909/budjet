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