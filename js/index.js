if (api.token()) window.location.href = 'dashboard.html';

function showTab(tab) {
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-registro').classList.toggle('active', tab === 'registro');
    document.getElementById('form-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('form-registro').style.display = tab === 'registro' ? 'block' : 'none';
    // Actualizar título desktop
    const titulo = document.getElementById('form-titulo-desktop');
    const sub = document.getElementById('form-sub-desktop');
    if (tab === 'login') {
    titulo.textContent = 'Bienvenido';
    sub.textContent = 'Ingresa a tu cuenta para continuar';
    } else {
    titulo.textContent = 'Crear cuenta';
    sub.textContent = 'Regístrate gratis, sin tarjeta de crédito';
    }
}

function showToastLocal(msg, tipo = 'ok') {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.className = `toast ${tipo === 'error' ? 'toast-error' : ''}`;
    el.textContent = msg;
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => el.classList.remove('show'), 3200);
}

async function login(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const orig = btn.textContent;
    btn.textContent = 'ENTRANDO…'; btn.disabled = true;
    try {
    const data = await api.post('/api/auth/login', {
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-pass').value
    });
    guardarSesion(data.token, data.usuario);
    btn.textContent = '✓ BIENVENIDO';
    setTimeout(() => window.location.href = 'dashboard.html', 400);
    } catch (err) {
    showToastLocal(err.message, 'error');
    btn.textContent = orig; btn.disabled = false;
    }
}

async function registro(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-registro');
    const orig = btn.textContent;
    btn.textContent = 'CREANDO…'; btn.disabled = true;
    try {
    const data = await api.post('/api/auth/registro', {
        nombre: document.getElementById('reg-nombre').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        password: document.getElementById('reg-pass').value
    });
    guardarSesion(data.token, data.usuario);
    btn.textContent = '✓ LISTO';
    setTimeout(() => window.location.href = 'dashboard.html', 400);
    } catch (err) {
    showToastLocal(err.message, 'error');
    btn.textContent = orig; btn.disabled = false;
    }
}