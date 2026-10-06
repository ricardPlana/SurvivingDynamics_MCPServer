# Azure configuration: portal walkthrough

This guide describes the same resources as `infra/main.bicep` and `infra/apim.bicep`. The exact portal labels may change. Use the Bicep deployment for a repeatable setup; this walkthrough is useful for understanding or troubleshooting each resource.

## Prerequisites

- An Azure subscription with permission to create the listed resources and role assignments.
- A resource group and region supported by the chosen services.
- Azure Functions Core Tools v4 and Node.js 22 for publishing the Function code.
- A Power Platform environment and Copilot Studio access for the custom connector step.

## Create the resources

| Portal step | Resource or setting in Bicep |
| --- | --- |
| Create a Standard general-purpose v2 storage account; disable public blob access and shared-key access; require HTTPS and TLS 1.2. | `infra/main.bicep`: `storage` |
| Create a private Blob container named `function-packages` for Flex Consumption deployment packages. | `infra/main.bicep`: `storage/blobServices/containers` |
| Create a Flex Consumption plan (`FC1`) and a Linux Function App with Node.js 22 runtime. Enable system-assigned managed identity and HTTPS-only traffic. | `infra/main.bicep`: `functionPlan`, `functionApp` |
| Give the Function identity Blob Data Owner, Queue Data Contributor, and Table Data Contributor access to the storage account. Configure host storage to use managed identity. | `infra/main.bicep`: `blobRole`, `queueRole`, `tableRole`, `functionApp/appSettings` |
| Create a Free-tier Static Web App. Deploy the contents of `web/dist` with the Static Web Apps CLI deployment token. | `infra/main.bicep`: `staticWebApp`; `infra/deploy.ps1` |
| Create API Management on the Developer tier, setting a publisher name and contact email. | `infra/apim.bicep`: `apim` |
| Add a secret named value containing the Function host key. | `infra/apim.bicep`: `functionKeyValue` |
| Import the Function's OpenAPI 2.0 definition twice: a public `weather` API and a subscription-protected `copilot-weather` API. | `infra/apim.bicep`: `publicApi`, `copilotApi` |
| Attach CORS, per-IP rate-limit, and Function-key forwarding policies to both APIs. | `infra/apim.bicep`: `publicApiPolicy`, `copilotApiPolicy`; `infra/apim-policy.xml` |

The backend needs a function key, not the Function App master key. The deployment script reads the default host function key only after publishing the Function, supplies it to Bicep as a secure parameter file outside the repository, and removes the temporary file after the API Management deployment.

## Publish the web app and Function

1. Deploy the foundation resources from `infra/main.bicep`.
2. Publish the compiled TypeScript Function from the `api` directory using `func azure functionapp publish <function-app-name>`.
3. Retrieve the Function host key, then deploy `infra/apim.bicep` with that value as the secure `functionKey` parameter, plus the Function App name and Static Web App hostname.
4. Build the site with `VITE_WEATHER_API_BASE_URL` set to the APIM `weather` API URL, then deploy `web/dist` with the Static Web App deployment token.
5. Replace the `__APIM_HOST__` placeholder in `api/openapi/copilot.openapi.json` with the API Management gateway host before importing it into a custom connector. The deployment script writes this tenant-specific file under `deploy-output`.

The `infra/deploy.ps1` script runs these steps in order and creates the resource group if needed.

## Connect the API in Copilot Studio

1. In API Management, create a subscription scoped to the `Weather for Copilot Studio` API and copy its primary key. Do not put this key in the static site.
2. In Power Apps, create a custom connector by importing the generated `deploy-output/copilot-weather.openapi.json` file. The file uses OpenAPI 2.0 and defines `Ocp-Apim-Subscription-Key` as an API-key header.
3. Configure the connector's API-key authentication, create a connection using the APIM subscription key, and test `GetCurrentWeather`.
4. In Copilot Studio, add the custom connector as a tool and test it with a city.

Custom connector support, import constraints, authentication setup, and portal labels can change. Confirm the current requirements in [Microsoft's OpenAPI custom connector guidance](https://learn.microsoft.com/connectors/custom-connectors/define-openapi-definition) and [Copilot Studio connector guidance](https://learn.microsoft.com/microsoft-copilot-studio/advanced-connectors).

## Common failures

| Symptom | Likely cause | Check |
| --- | --- | --- |
| Function deployment or startup fails on storage access. | Managed-identity role assignments haven't propagated, or Flex deployment storage isn't configured. | Check the Function identity's storage data roles and `functionAppConfig.deployment.storage`; wait for role propagation and retry the publish/startup. |
| APIM returns `401` or `403` from the Function backend. | The named value is missing or the stored key is not a host/function key. | Refresh the Function host key, update the secret named value, and test the backend from APIM. |
| Browser calls fail with a CORS error. | The Static Web App hostname in the APIM CORS policy doesn't match the deployed site. | Compare `staticWebAppHostName` with the policy origin and redeploy the APIM policy. |
| Browser gets `429 Too Many Requests`. | The per-IP rate policy limit was reached. | Wait for the renewal interval; do not treat a shared or changing client IP as a durable user identity. |
| Copilot connector rejects a request. | No API-scoped APIM subscription or incorrect key header. | Confirm the connector connection uses `Ocp-Apim-Subscription-Key` for the `copilot-weather` API. |
| No city or weather data is returned. | The city search had no match, Open-Meteo is unavailable, or the free API is not suitable for the usage. | Check the JSON error response and Function logs; verify current Open-Meteo terms and service status. |
| API Management resource deployment takes a long time or fails. | APIM provisioning is slower than the other resources or the selected region/tier is unavailable. | Check the Azure deployment operation and current APIM regional availability before retrying. |

## Cleanup

Delete the dedicated resource group after the demo and check that no resources remain. Never delete a group that contains resources outside this sample.
