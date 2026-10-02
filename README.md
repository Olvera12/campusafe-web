# CampuSafe Web

Versión web pública del cliente de Campusafe, preparada desde la versión local.
El menú radial se abre con un clic o toque dentro de Street View en el punto pulsado. Arrastrar permite mirar alrededor y las flechas conservan la navegación.

## Ejecución local
Desde esta carpeta ejecuta `python -m http.server 8080` y abre `http://localhost:8080`.

## Datos y acceso
El cliente usa sesiones anónimas Firebase. No solicita matrícula, correo ni contraseña. La pertenencia de reportes nuevos se determina por `ownerUid`, no por una matrícula editable. Borrar los datos del navegador puede perder la identidad visitante.
Los reportes se muestran a los visitantes de la aplicación: evita publicar nombres, teléfonos, matrículas, domicilios particulares o detalles que identifiquen a una persona.

## Configuración pública
La configuración web Firebase identifica el proyecto y es visible por diseño. No es una credencial administrativa. La clave Google Maps del navegador también es visible y debe restringirse por sitio y por API en Google Cloud.
El mapa y Street View requieren una cuenta Google Maps con facturación habilitada; este repositorio no activa facturación ni contrata servicios.

## Seguridad
Lee SECURITY.md para conocer las protecciones aplicadas y los límites pendientes del backend. No se incluyen cuentas de servicio, tokens, exportaciones de reportes, archivos personales ni historial del repositorio anterior.
