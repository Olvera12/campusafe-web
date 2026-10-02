# Seguridad y privacidad

## Protecciones de esta versión
- Historial nuevo y publicación de una lista explícita de archivos del cliente.
- Sin correos personales, rutas de Windows, credenciales administrativas ni archivos exportados.
- Reportes mostrados como texto escapado; IDs de reportes no se ejecutan como JavaScript.
- Política CSP sin scripts inline ni eval; eventos registrados desde app.js.
- Dependencia de iconos fijada a una versión, sin `@latest`.
- Sesión Firebase anónima; el perfil no pide una contraseña que no valida.
- Reportes nuevos no guardan matrícula ni alias como identidad pública.
- Las reglas existentes rechazan borrados y modificaciones arbitrarias de los reportes.

## Límites que requieren configuración del servicio
Las sesiones anónimas no verifican pertenencia a la universidad y pueden recrearse. Las reglas actuales permiten votar repetidamente y crear múltiples reportes: no hay limitación robusta por persona. App Check y controles de abuso del backend no están configurados por este repositorio.
Los datos históricos permanecen en Firestore. Esta publicación no elimina ni anonimiza datos antiguos: no equivale a una auditoría completa de privacidad de la base de datos.
Google Maps requiere restricciones de referer para los dominios publicados y localhost, restricciones de API y control de cuotas antes de habilitar facturación. La configuración Firebase debe limitarse a los servicios usados.
No publiques problemas de seguridad con datos reales en issues públicos. Describe primero el alcance sin adjuntar tokens, documentos de Firebase ni información personal.

Fuentes oficiales:
- https://firebase.google.com/docs/projects/api-keys
- https://developers.google.com/maps/api-security-best-practices
