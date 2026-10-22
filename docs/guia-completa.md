# De una API REST a herramientas MCP con Azure y Copilot Studio

Esta guía acompaña al ejemplo del blog y permite reproducirlo en tu propia suscripción. La pregunta de partida es sencilla: **"¿Me conviene salir a correr mañana en Barcelona?"** Lo interesante no es generar una respuesta convincente, sino conseguir que el agente use datos reales y una regla de negocio verificable.

El repositorio contiene la API, la web, los contratos OpenAPI, las pruebas y la infraestructura. No incluye credenciales, capturas del tenant ni un servicio compartido que debas usar. Necesitas desplegar tus propios recursos; los nombres de las herramientas y algunas etiquetas del portal pueden variar.

## 1. Qué hemos construido y por qué

Partimos de una consulta de tiempo actual y ampliamos el ejemplo con búsqueda de localidades, previsión diaria y evaluación de condiciones para correr. La web y Copilot Studio reutilizan la misma lógica.

```mermaid
flowchart LR
  Web["Web: Vite / Static Web Apps"] -->|REST público| Gateway["Azure API Management"]
  Agent["Copilot Studio"] -->|MCP sobre Streamable HTTP| MCP["Servidor MCP de APIM"]
  MCP -->|Invoca operaciones REST| Gateway
  Gateway -->|Agrega clave de Function| API["Azure Functions / TypeScript"]
  API -->|Busca localidades y previsión| Provider["Open-Meteo"]
```

**La Function no implementa MCP.** Expone cuatro operaciones HTTP y APIM las presenta como herramientas. El modelo elige herramientas y explica resultados; la API valida entradas, resuelve localidades y calcula la recomendación.

| Pieza | Responsabilidad | Dónde leerla |
| --- | --- | --- |
| Dominio | Contratos, validación y umbrales | [`api/src/domain/weather.ts`](../api/src/domain/weather.ts) |
| Adaptador meteorológico | Geocodificación, desambiguación y llamadas a Open-Meteo | [`api/src/services/openMeteo.ts`](../api/src/services/openMeteo.ts) |
| Adaptadores HTTP | Parámetros de entrada y errores HTTP/JSON | [`api/src/functions/weather.ts`](../api/src/functions/weather.ts) |
| Contratos | Importación en APIM y conector REST opcional | [`api/openapi`](../api/openapi) |
| Web | Selección de localidad y visualización | [`web/src/main.ts`](../web/src/main.ts) |
| Infraestructura | Recursos Azure, gateway y despliegue | [`infra`](../infra) |

No hay base de datos, cola ni modelo ejecutandose dentro de la Function. Las consultas al proveedor se hacen bajo demanda.

## 2. Qué hace cada herramienta

| Operación REST | Parámetros | Resultado |
| --- | --- | --- |
| `/locations` | `query` | Hasta diez localidades con nombre, país, región, coordenadas y zona horaria |
| `/weather` | `city`, `country`, `admin1` | Tiempo actual, sensación térmica, humedad, lluvia y viento |
| `/forecast` | Los anteriores y `date` | Mínima, máxima, precipitación, viento máximo y estado del cielo |
| `/running-assessment` | Los mismos de previsión | Recomendación, motivos, umbrales, previsión y aviso de limitaciones |

En la Function y en la API pública, `country` y `admin1` son opcionales. Si una ciudad es ambigua, hay que resolverla mediante la búsqueda. El workaround MCP del apartado 5 hace obligatorios ambos campos en las operaciones afectadas de la API de Copilot.

La regla devuelve `recommended` solo si se cumplen **todos** estos límites, incluidos sus extremos:

| Dato diario | Criterio de demostración |
| --- | --- |
| Temperatura mínima | Al menos 5 grados C |
| Temperatura máxima | Como máximo 30 grados C |
| Precipitación | Como máximo 2 mm |
| Viento máximo | Como máximo 25 km/h |

`reasons` enumera los límites incumplidos; está vacío cuando todos se cumplen. No son criterios médicos ni una garantía de seguridad. Una previsión diaria tampoco permite afirmar a qué hora concreta lloverá.

Las fechas usan `YYYY-MM-DD` y el rango de hoy a seis días después. **Limitación actual:** la validación del rango usa el día UTC del servidor; la previsión usa la zona horaria de la localidad. Cerca de medianoche puede haber diferencias con el día local del usuario. No se ha implementado una validación del rango por zona horaria.

## 3. Ejecutar el ejemplo localmente

Necesitas Node.js 22, npm, Azure Functions Core Tools v4 y Azurite disponibles en el equipo. No necesitas Azure ni Copilot Studio para probar la API y la web locales.

Desde la raíz del repositorio, prepara los dos proyectos:

```powershell
npm ci --prefix api
npm ci --prefix web
if (!(Test-Path .\api\local.settings.json)) {
  Copy-Item .\api\local.settings.example.json .\api\local.settings.json
}
npm test --prefix api
npm run check --prefix web
npm run build --prefix web
```

Abre tres terminales, todas inicialmente en la raíz. El orden importa:

| Terminal | Comando | Funcion |
| --- | --- | --- |
| 1 | `azurite --silent --location .\.azurite` | Almacenamiento local usado por el host |
| 2 | `npm start --prefix api` | Azure Functions en el puerto 7071 |
| 3 | `npm run dev --prefix web` | Vite; abre la URL que muestra |

`npm test` compila la API antes de ejecutar las pruebas. Tras editar TypeScript, vuelve a compilar con `npm run build --prefix api` y reinicia el host si hace falta. No hay un compilador en modo watch configurado.

Vite redirige `/api` a `http://127.0.0.1:7071`; no hay un servidor MCP local. Core Tools no activa la autorización completa salvo que se arranque con `--enableAuth`. En Azure, los endpoints de la Function requieren clave.

Prueba una búsqueda, selecciona Barcelona en Catalonia, Spain, y consulta la previsión o la evaluación. La web guarda la localidad seleccionada en `localStorage`; conserva la selección al recargar y la borra cuando editas el nombre de ciudad.

## 4. Desplegar tu propia infraestructura

Necesitas Azure CLI, Bicep, Core Tools y permisos para crear recursos y asignar roles de almacenamiento. Para la parte del agente necesitas además un entorno Power Platform con acceso a Copilot Studio y a la integración MCP.

```powershell
az login
az account set --subscription "<tu-suscripcion>"
az bicep install
.\infra\deploy.ps1 -ResourceGroupName rg-weather-blog -Location westeurope -PublisherEmail you@example.com
```

Sustituye el correo por tu contacto de publicador. Usa un grupo dedicado. El despliegue crea recursos facturables; APIM Developer no tiene SLA de producción y puede tardar en aprovisionarse.

El script:

1. Crea almacenamiento, una Function Flex Consumption con Node.js 22 y una Static Web App.
2. Configura identidad administrada y roles para el almacenamiento de la Function.
3. Instala dependencias, ejecuta pruebas de API y publica la Function, con reintentos limitados.
4. Obtiene una clave de Function y la suministra a APIM como parámetro seguro mediante un archivo temporal que elimina al terminar esa fase.
5. Crea APIM e importa la API dos veces: `weather`, pública para la web, y `copilot-weather`, con suscripción obligatoria.
6. Aplica CORS, límite por IP y la clave de Function en el gateway; compila y publica la web apuntando a la API pública.
7. Genera un OpenAPI en `deploy-output` para el camino alternativo del conector REST.

**No crea automáticamente el servidor MCP, la conexión de Copilot Studio ni el workaround de plantillas.** El OpenAPI generado para un conector REST no se importa en el asistente de alta MCP.

Para el mapa detallado entre portal y Bicep, consulta [Azure configuration](azure-configuration.md). Si vuelves a desplegar, las importaciones pueden sobrescribir los ajustes manuales siguientes.

## 5. Preparar las operaciones REST para MCP

En el entorno probado, APIM descubría las herramientas correctamente pero componía mal algunas llamadas con parámetros opcionales. Se observaron valores como `Barcelona?country=Spain` y errores `invalid_date` con una fecha correcta.

La llamada REST directa funcionaba con los mismos argumentos. El workaround verificado fue incluir todos los parámetros en la plantilla de URL.

En **APIM > APIs > APIs > Weather for Copilot Studio > Design**, selecciona cada operación y edita **Frontend**:

| Operación | Plantilla |
| --- | --- |
| Tiempo actual | `/weather?city={city}&country={country}&admin1={admin1}` |
| Previsión | `/forecast?city={city}&date={date}&country={country}&admin1={admin1}` |
| Running | `/running-assessment?city={city}&date={date}&country={country}&admin1={admin1}` |
| Búsqueda, sin cambios | `/locations?query={query}` |

Usa un único `?` y `&` entre parámetros. Si `country` y `admin1` quedan duplicados en **Query parameters**, elimina solo esas entradas y conserva las de **Template parameters**. Guarda cada operación.

**Trade-off:** esos campos pasan a ser obligatorios en estas operaciones de Copilot. Utiliza los valores devueltos por la búsqueda. Una localidad sin región requiere adaptar este workaround; no inventes una región. No hace falta modificar la API pública ni relajar la validación de la Function.

Esto documenta un comportamiento observado, no una afirmación de que todas las versiones de APIM tengan el mismo fallo. Revisa las plantillas después de importar o desplegar de nuevo.

## 6. Exponer MCP y conectar Copilot Studio

En **APIM > MCP Servers > Create MCP server > Expose an API as an MCP server**:

1. Selecciona **Weather for Copilot Studio** y sus cuatro operaciones.
2. Asigna un nombre, por ejemplo `weather-planning-mcp`, y una descripción del propósito.
3. Para proteger el servicio, incluye el MCP y la API REST origen en el mismo producto protegido. Activa **Subscription required** en ambos y crea o utiliza una suscripción activa a ese producto.
4. Copia la **Server URL** generada por APIM. Termina en `/mcp`; no es la URL base de la API REST.

En **Copilot Studio > Tools > Add a tool > Model Context Protocol**:

1. Introduce nombre, descripción y la Server URL.
2. Selecciona **Clave API**, ubicación **Encabezado**, nombre `Ocp-Apim-Subscription-Key`.
3. Introduce una clave de la suscripción del producto, no una clave de Function ni la suscripción global all-access.
4. Crea o selecciona la conexión y agrega las herramientas al agente.

La clave se guarda en la conexión, nunca en el prompt, el repositorio o el frontend. La Function tiene su propia clave y APIM la agrega hacia el backend; son credenciales diferentes.

Durante el diagnóstico se probó acceso anónimo con **Ninguno**, desactivando temporalmente el requisito en ambos recursos. No es la configuración recomendada para dejar publicado el endpoint. Un `401 missing subscription key` dentro del resultado de una herramienta puede venir de la API REST aunque el MCP admita conectar sin clave.

## 7. Instrucciones para el agente

Puedes utilizar este texto como punto de partida. Adapta los nombres si APIM genera otros; en el entorno probado la búsqueda aparecía como `findMatchingCitiesAndRegions`.

```text
Usa las herramientas MCP meteorológicas como fuente de datos.
Busca primero la localidad y conserva city, country y admin1 por separado,
con los valores devueltos. Si hay ambigüedad, pregunta al usuario;
no deduzcas su ubicación a partir de su nombre.
Envia todos los campos obligatorios del esquema.
Usa fechas YYYY-MM-DD dentro del rango admitido. Interpreta hoy/mañana
con la fecha actual y la zona horaria de la localidad.
Para preguntas sobre correr, usa la herramienta de evaluación y presenta
su recomendación, motivos, umbrales y aviso de que es una demostración.
Inspecciona el contenido por si contiene errores, aunque isError sea false.
Si parámetros válidos producen un error técnico, informa del fallo.
No inventes causas, no pruebes variantes arbitrarias y no sustituyas
silenciosamente el servicio por busquedas web.
No presentes una interpretación de la previsión como una evaluación
de running completada.
```

El prompt mejora el comportamiento del agente, pero **no repara URLs ni autenticación**. Para una demo centrada en las herramientas, desactiva la búsqueda web si no quieres una fuente alternativa.

## 8. Validar de extremo a extremo

Empieza por la API, después MCP y finalmente el agente. Así distingues un problema de datos de un problema de transporte o configuración.

### REST

Para validar localmente sin credenciales:

```powershell
$base = "http://127.0.0.1:7071/api"
$date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
Invoke-RestMethod "$base/locations?query=Barcelona"
Invoke-RestMethod "$base/forecast?city=Barcelona&date=$date&country=Spain&admin1=Catalonia"
Invoke-RestMethod "$base/running-assessment?city=Barcelona&date=$date&country=Spain&admin1=Catalonia"
```

Para probar la ruta protegida en Azure, usa tu base `https://<tu-apim>.azure-api.net/copilot-weather` y envia `Ocp-Apim-Subscription-Key` desde una variable de entorno o un almacén de credenciales. No pruebes autenticación solo contra la API pública.

### MCP

Usa un cliente compatible con Streamable HTTP y configura la Server URL y su encabezado de autenticación. Comprueba tres fases, siguiendo el ciclo de inicialización y sesión del cliente:

| Fase | Qué demuestra | Qué no demuestra |
| --- | --- | --- |
| `initialize` | Acceso al endpoint y negociación MCP | Que funcione la API REST origen |
| `tools/list` | Descubrimiento y esquema de herramientas | Que los parámetros se construyan bien al ejecutar |
| `tools/call` | Ejecución real | Éxito de negocio si no inspeccionas el contenido |

Ejemplo del mensaje de invocación; usa el nombre real de tu herramienta y una fecha actual:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "getTheDailyForecastForACity",
    "arguments": {
      "city": "Barcelona",
      "country": "Spain",
      "admin1": "Catalonia",
      "date": "YYYY-MM-DD"
    }
  }
}
```

En las respuestas observadas, APIM devolvía HTTP `200` e `isError: false` incluso cuando `content[].text` contenía un JSON con `401` o `invalid_date`. El éxito real requiere encontrar los campos de previsión o evaluación, no solo un código de transporte correcto.

### Copilot Studio y web

Prueba "¿Me conviene salir a correr hoy en Barcelona, Cataluña, España?" y revisa las entradas y salidas de las herramientas en la traza. Debe haber una localidad resuelta y una evaluación con `recommendation`, `thresholds`, `reasons` y `forecast`. Los datos exactos cambiarán: las capturas del blog son una ejecución de ejemplo, no un resultado fijo.

Prueba también un nombre ambiguo, una fecha fuera del rango y la persistencia de la localidad en la web. Las pruebas automatizadas son offline y verifican contratos, resolución de ciudades, validación, reintentos y límites de la regla; no sustituyen la validación del despliegue real.

## 9. Problemas encontrados y aprendizaje

| Problema | Qué hicimos | Idea reutilizable |
| --- | --- | --- |
| La app no tenía scripts para ejecutarse desde Copilot | Incorporamos `.github/github-app.yml` con preparación y sesiones separadas | Documentar también cómo arrancar el proyecto |
| Core Tools no identificaba correctamente el worker | Fijamos `FUNCTIONS_WORKER_RUNTIME=node` solo en configuración local | Flex define el runtime en `functionAppConfig.runtime`, no con ese app setting |
| Publicación Flex y roles de almacenamiento | Configuramos almacenamiento de paquetes, identidad administrada y reintentos limitados | Las asignaciones pueden tardar en propagarse |
| El botón de running apuntaba a una ruta inexistente | Alineamos la acción con `running-assessment` | Un contrato correcto no garantiza que la UI lo use |
| Fallos transitorios del proveedor | Dos intentos, timeout por intento y errores explícitos | No ocultar errores con datos inventados |
| Ciudades ambiguas y selección perdida al recargar | Búsqueda, calificadores y persistencia local; alias Lérida/Lleida | Resolver entidades antes de ejecutar una acción |
| Descubrimiento MCP correcto y ejecución con `401` | Revisamos por separado autenticación MCP y REST | Probar una llamada completa, no solo el handshake |
| Fechas válidas fallaban solo por MCP | Comparamos con REST y aplicamos las plantillas completas | Inspeccionar parámetros efectivos antes de cambiar validaciones |
| El agente probaba variantes y terminaba buscando en la web | Instrucciones de errores, fuentes y uso de evaluación | El prompt delimita comportamiento, no sustituye arreglos técnicos |

Los mensajes genéricos de alta de servidor en Copilot Studio no permitieron demostrar una causa única. No asumimos que cambiar el nombre o recrear la conexión los resuelva: conviene revisar la respuesta de red y el diagnóstico del entorno sin compartir tokens.

## 10. Ideas para el blog y para ampliar el ejemplo

El hilo conductor puede ser: **API existente > contrato explícito > gateway > herramientas > agente > validación real**. No hace falta reescribir la lógica como un servidor MCP propio para explorar este patrón.

| Idea | Lo que demuestra el ejemplo | Siguiente paso posible, no implementado |
| --- | --- | --- |
| Una regla fuera del prompt | La recomendación es verificable y compartida con la web | Versionar reglas por actividad |
| Herramientas pequeñas y componibles | Buscar, consultar y evaluar son operaciones distintas | Añadir otras actividades con contratos propios |
| Gateway como frontera | Claves, CORS y throttling fuera del frontend | OAuth/Entra ID, cuotas y observabilidad |
| Diagnóstico por capas | Separa protocolo, autenticación y negocio | Pruebas automatizadas de MCP y alertas |
| Infraestructura reproducible | Bicep y script para el despliegue base | Automatizar MCP y workaround cuando sea viable |

Para ilustrarlo, son útiles capturas de la arquitectura, las plantillas REST corregidas, la creación de MCP, el encabezado configurado sin valor visible, las instrucciones y una ejecución final con trazas. No están incluidas en este repositorio: sanea correos, identificadores, claves y hostnames antes de publicarlas.

## 11. Límites, costes y cierre

APIM Developer es un nivel de demostración facturable, sin SLA de producción. La API de la web es pública; CORS y límite por IP no equivalen a autenticación. La versión gratuita de Open-Meteo requiere atribución y tiene condiciones de uso no comercial: revisa sus [términos](https://open-meteo.com/en/terms) o usa un proveedor/plan adecuado.

No hay cobertura de alertas oficiales, salud, calidad del aire, rutas ni previsión por hora. No esta automatizada toda la configuración del portal. No se incluyen pruebas de integración cloud, ni una garantía de disponibilidad o exactitud del proveedor.

Al terminar, verifica que el grupo contiene únicamente recursos de este ejemplo. El siguiente comando **elimina todos los recursos del grupo indicado**:

```powershell
az group delete --name rg-weather-blog
```

Espera a que finalice y comprueba la eliminación en Azure. Elimina también conexiones o herramientas obsoletas en Copilot Studio; borrar Azure no las retira automáticamente. Consulta la [checklist de publicación](azure-configuration.md#publication-checklist) antes de compartir tu fork o sus capturas.

## Referencias

- [README y mapa del repositorio](../README.md)
- [Referencia operativa de Azure y troubleshooting](azure-configuration.md)
- [Exponer una API REST como MCP en APIM](https://learn.microsoft.com/azure/api-management/export-rest-mcp-server)
- [Proteger servidores MCP en APIM](https://learn.microsoft.com/azure/api-management/secure-mcp-servers)
- [Conectar un servidor MCP a Copilot Studio](https://learn.microsoft.com/microsoft-copilot-studio/mcp-add-existing-server-to-agent)
