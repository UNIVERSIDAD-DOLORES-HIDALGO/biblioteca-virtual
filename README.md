# biblioteca-virtual

Pantalla de acceso de la Biblioteca Virtual UDHI (`biblioteca.udhi.edu.mx`).

- `index.html` — pide el correo institucional y manda al inicio de sesión de Google; solo pasan cuentas `@udhi.edu.mx`.
- `apps-script/` — código de la web app que muestra el catálogo (copia de lo publicado en Apps Script, proyecto
  "Biblioteca Virtual UDHI · Acceso @udhi.edu.mx", cuenta auxiliar.sistemas@udhi.edu.mx).
- Los PDFs viven en la unidad compartida **Biblioteca Virtual UDHI** de Google Drive, compartidos solo con el dominio.
  Para agregar un libro: subir el PDF a la carpeta de su categoría y correr `compartirConDominio()` en el script.
