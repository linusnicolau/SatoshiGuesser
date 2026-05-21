# Guía de Despliegue en la Nube (Satoshi Guesser Cloud Miner)

Esta guía te guiará paso a paso para desplegar tu buscador de claves de Satoshi en un servidor en la nube de forma **100% gratuita y permanente (24/7)** utilizando **Hugging Face Spaces** con contenedor Docker. Además, configuraremos el bot de Telegram de forma automática para recibir actualizaciones periódicas y alertas inmediatas.

---

## Paso 1: Configurar Telegram y Obtener tu Chat ID

Ya has creado tu bot de Telegram y tienes el token:
`8961307464:AAEKetDqXwpAaKrh2vKlnsw9StMgMvjiAk0`

Para recibir notificaciones, el bot necesita saber tu **Chat ID** (tu identificador de usuario único en Telegram). Hemos creado un script automatizado que detectará tu Chat ID y enviará un mensaje de prueba para verificar que todo funciona:

1. Abre tu aplicación de Telegram.
2. Busca tu bot en la barra de búsqueda utilizando el nombre de usuario de tu bot.
3. Entra en el chat con tu bot y presiona el botón **Iniciar** (`/start`) o envíale cualquier mensaje (ej. "hola"). **(Muy importante: si no le envías un mensaje primero, el bot no podrá detectarte)**.
4. En tu terminal local, ejecuta el script de prueba:
   ```bash
   node scripts/test-telegram.js
   ```
5. El script consultará con la API de Telegram, **detectará tu Chat ID de forma automática**, y te enviará un mensaje de prueba al móvil.
6. Copia el número de tu **Chat ID** que se imprimirá en verde en la consola. Lo necesitarás en el Paso 3.

---

## Paso 2: Preparar tu Repositorio de Código

El proyecto ya está completamente listo con un `Dockerfile` y un archivo `.dockerignore` configurados especialmente para Hugging Face.

Si vas a subir el código a Hugging Face usando Git:
1. Haz commit de todos los cambios nuevos en tu repositorio local:
   ```bash
   git add .
   git commit -m "feat: add web workers, cloud miner and telegram alerts"
   ```

---

## Paso 3: Desplegar en Hugging Face Spaces (Gratis 24/7)

Hugging Face te permite ejecutar contenedores Docker de forma gratuita y sin límite de tiempo (siempre y cuando el contenedor responda a un puerto web, lo cual ya hemos resuelto con un panel web integrado).

Sigue estos pasos para subir tu código:

1. Ve a [Hugging Face](https://huggingface.co/) e inicia sesión.
2. Haz clic en tu perfil en la esquina superior derecha y selecciona **New Space**.
3. Configura el espacio:
   - **Space Name**: Dale un nombre (ej: `satoshi-miner`).
   - **License**: `mit` (opcional).
   - **SDK**: Selecciona **Docker**.
   - **Template**: Selecciona **Blank** (en blanco).
   - **Space Visibility**: Puedes dejarlo como **Public** o **Private** (funciona igual de bien).
4. Haz clic en **Create Space**.
5. Ahora ve a la pestaña **Settings** (Ajustes) de tu nuevo Space para configurar tus credenciales de Telegram de forma segura:
   - Desplázate hacia abajo hasta la sección **Variables and secrets**.
   - Haz clic en **New secret** para añadir tu token de bot:
     - **Name**: `TELEGRAM_BOT_TOKEN`
     - **Value**: `8961307464:AAEKetDqXwpAaKrh2vKlnsw9StMgMvjiAk0`
   - Haz clic en **New secret** de nuevo para añadir tu Chat ID:
     - **Name**: `TELEGRAM_CHAT_ID`
     - **Value**: `TU_CHAT_ID_DETECTADO` (el número que obtuviste en el Paso 1).
6. Sube tus archivos de código al espacio. Puedes hacerlo de dos formas:
   - **Método A (Muy fácil - Web)**: Ve a la pestaña **Files and versions**, haz clic en **Add file** -> **Upload files**, arrastra todos los archivos de tu proyecto local (evitando subir la carpeta `node_modules` y `.git` ya que se ignoran automáticamente) y haz commit.
   - **Método B (Git)**: Clona el repositorio de Hugging Face en tu ordenador utilizando los comandos de Git que te muestra Hugging Face en la página de inicio de tu Space, copia tus archivos de SatoshiGuesser dentro de esa carpeta, haz git commit y push:
     ```bash
     git remote add hf https://huggingface.co/spaces/TU_USUARIO/TU_SPACE
     git push hf main --force
     ```

---

## Paso 4: Monitoreo y Funcionamiento

Una vez subido el código, Hugging Face construirá la imagen Docker automáticamente y la pondrá en marcha:

1. **Dashboard en Tiempo Real**: Cuando abras la página de tu Space en Hugging Face, verás un panel web premium oscuro en vivo que muestra:
   - El estado de la búsqueda (Active & Searching 🟢).
   - El número total de claves probadas.
   - La velocidad actual y promedio en llaves por segundo (aprovechando el 100% de la CPU asignada).
   - El tiempo transcurrido desde el inicio.
   - El valor acumulado del Jackpot en BTC y USD.
2. **Alertas de Telegram**:
   - **Mensaje de Inicio**: En cuanto el contenedor arranque correctamente en la nube, recibirás un mensaje de Telegram confirmando que el minero se ha iniciado con éxito.
   - **Reportes cada 30 Minutos**: Cada media hora, el bot te enviará un reporte resumen con las claves comprobadas y la velocidad media.
   - **ALERTA INSTANTÁNEA**: Si en algún segundo del día el minero encuentra una de las claves de Satoshi, se detendrán los motores inmediatamente y recibirás una alerta roja urgente en Telegram con la clave privada en Hexadecimal, en formato WIF y la dirección Bitcoin exacta, con instrucciones detalladas de cómo retirar los fondos al instante.
