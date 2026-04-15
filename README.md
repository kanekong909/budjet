# 🏗️ ObraGastos — Guía de instalación completa

Sistema de gestión de gastos para obras de construcción.
- **Frontend**: GitHub Pages (HTML + CSS + JS puro)
- **Backend**: Railway (Node.js + Express)
- **Base de datos**: MySQL en Railway

---

## 📁 Estructura del proyecto

```
obra-gastos/
├── backend/          ← Sube esto a Railway
│   ├── index.js
│   ├── package.json
│   ├── .env.example
│   ├── config/
│   │   └── db.js
│   ├── middleware/
│   │   └── auth.js
│   └── routes/
│       ├── auth.js
│       ├── obras.js
│       └── gastos.js
│
└── frontend/         ← Sube esto a GitHub Pages
    ├── index.html        (Login/Registro)
    ├── dashboard.html    (Lista de obras)
    ├── obra.html         (Gastos de una obra)
    ├── perfil.html       (Perfil de usuario)
    ├── css/
    │   └── styles.css
    └── js/
        └── config.js     ← ¡EDITA LA URL AQUÍ!
```

---

## 🚀 PASO 1: Configurar Railway (Backend + MySQL)

### 1.1 Crear base de datos MySQL en Railway

1. Entra a [railway.app](https://railway.app) y crea un proyecto nuevo
2. Haz clic en **"Add Service"** → **"Database"** → **"MySQL"**
3. Railway crea la BD automáticamente
4. En la BD MySQL, ve a **"Variables"** y copia:
   - `MYSQL_HOST`
   - `MYSQL_PORT`
   - `MYSQL_DATABASE`
   - `MYSQL_USER`
   - `MYSQL_PASSWORD`

### 1.2 Subir el backend a Railway

**Opción A: Desde GitHub (recomendado)**
1. Sube la carpeta `backend/` a un repositorio de GitHub
2. En Railway → **"Add Service"** → **"GitHub Repo"**
3. Selecciona el repositorio

**Opción B: Railway CLI**
```bash
npm install -g @railway/cli
cd backend/
railway login
railway init
railway up
```

### 1.3 Configurar variables de entorno en Railway

En tu servicio de backend → **"Variables"**, agrega:

```
DB_HOST=       (el MYSQL_HOST de tu BD Railway)
DB_PORT=3306
DB_NAME=       (el MYSQL_DATABASE)
DB_USER=       (el MYSQL_USER)
DB_PASS=       (el MYSQL_PASSWORD)
JWT_SECRET=    (inventa una clave larga, ej: MiClaveSecreta2024XYZ789)
FRONTEND_URL=  (la URL de tu GitHub Pages, ej: https://tu-usuario.github.io)
```

### 1.4 Obtener tu URL de Railway

En Railway → tu servicio → **"Settings"** → **"Networking"** → **"Generate Domain"**

Copia la URL, se verá así: `https://obra-gastos-backend.railway.app`

---

## 🌐 PASO 2: Configurar GitHub Pages (Frontend)

### 2.1 Editar la URL del backend

Abre `frontend/js/config.js` y cambia la primera línea:

```javascript
// ANTES:
const API_URL = 'https://TU-APP.railway.app';

// DESPUÉS (tu URL real de Railway):
const API_URL = 'https://obra-gastos-backend.railway.app';
```

### 2.2 Subir el frontend a GitHub

1. Crea un repositorio en GitHub (puede ser público o privado)
2. Sube **solo la carpeta `frontend/`** (no el backend):
   ```bash
   cd frontend/
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/obra-gastos.git
   git push -u origin main
   ```

### 2.3 Activar GitHub Pages

1. En GitHub → tu repositorio → **"Settings"** → **"Pages"**
2. Source: **"Deploy from a branch"**
3. Branch: **"main"** / **"/ (root)"**
4. Guardar

Tu app estará disponible en: `https://TU-USUARIO.github.io/obra-gastos/`

### 2.4 Actualizar FRONTEND_URL en Railway

Vuelve a Railway → Variables y actualiza:
```
FRONTEND_URL=https://TU-USUARIO.github.io
```

---

## 📸 PASO 3 (Opcional): Fotos de facturas con Cloudinary

Para poder subir fotos de facturas:

1. Crea cuenta gratis en [cloudinary.com](https://cloudinary.com)
   - Plan gratis: 25GB de almacenamiento, suficiente para muchas fotos
2. En el Dashboard de Cloudinary copia:
   - Cloud name
   - API Key  
   - API Secret
3. Agrega en Railway:
   ```
   CLOUDINARY_CLOUD_NAME=tu-cloud-name
   CLOUDINARY_API_KEY=tu-api-key
   CLOUDINARY_API_SECRET=tu-api-secret
   ```

Si no configuras Cloudinary, la app funciona igual pero sin subida de fotos.

---

## 🧪 Verificar que todo funciona

1. Abre tu URL de Railway + `/api/health`
   - Debe mostrar: `{"status":"ok","timestamp":"..."}`

2. Abre tu GitHub Pages y regístrate
3. Crea una obra y agrega un gasto de prueba

---

## 📱 Instalar como app en móvil (PWA manual)

**En Android (Chrome):**
1. Abre la URL en Chrome
2. Menú (3 puntos) → "Añadir a pantalla de inicio"
3. Se instala como app nativa

**En iPhone (Safari):**
1. Abre la URL en Safari
2. Botón de compartir → "Añadir a pantalla de inicio"

---

## 🔧 Comandos útiles de desarrollo local

```bash
# Backend local
cd backend/
cp .env.example .env
# (edita .env con tus credenciales locales)
npm install
npm run dev

# Frontend local
# Simplemente abre index.html en el navegador
# O usa Live Server de VS Code
```

---

## ❓ Problemas comunes

**"Error de CORS"**
→ Verifica que `FRONTEND_URL` en Railway sea exactamente tu URL de GitHub Pages (sin / al final)

**"Error 401 - Token inválido"**
→ La sesión expiró (duran 30 días). Cierra sesión y entra de nuevo.

**Las fotos no se suben**
→ Verifica las variables de Cloudinary en Railway

**La app no carga en GitHub Pages**
→ Espera 2-3 minutos después de hacer push. GitHub Pages tarda un poco.

---

## 💡 Funcionalidades incluidas

- ✅ Registro e inicio de sesión con JWT
- ✅ Múltiples obras por usuario
- ✅ Equipo de hasta 10 personas por obra
- ✅ Roles: admin y colaborador
- ✅ Tabla de gastos con descripción, monto, fecha, categoría, proveedor
- ✅ Filtros por categoría, fecha y búsqueda de texto
- ✅ Cálculo automático de totales
- ✅ Gráfica de gastos por categoría
- ✅ Presupuesto con barra de progreso
- ✅ Subida de fotos/facturas (requiere Cloudinary)
- ✅ Exportar a CSV (abre en Excel)
- ✅ Diseño 100% mobile-first
- ✅ Funciona sin conexión para ver datos (caché del navegador)
