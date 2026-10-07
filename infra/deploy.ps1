param(
  [string]$ResourceGroupName = "rg-sd-weather-demo",
  [string]$Location = "westeurope",
  [string]$PublisherEmail,
  [string]$PublisherName = "Surviving Dynamics demo"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $PublisherEmail) {
  $PublisherEmail = Read-Host "Enter an email for the API Management publisher contact"
}
if (-not $PublisherEmail) {
  throw "PublisherEmail is required by API Management."
}

az account show --output none
if ($LASTEXITCODE -ne 0) {
  throw "Sign in to Azure CLI first with 'az login'."
}

az group create --name $ResourceGroupName --location $Location --output none
if ($LASTEXITCODE -ne 0) {
  throw "Could not create or access resource group '$ResourceGroupName'."
}

$baseDeployment = az deployment group create `
  --resource-group $ResourceGroupName `
  --template-file (Join-Path $PSScriptRoot "main.bicep") `
  --parameters location=$Location `
  --query properties.outputs `
  --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "Base infrastructure deployment failed."
}

$functionAppName = $baseDeployment.functionAppName.value
$staticWebAppName = $baseDeployment.staticWebAppName.value
$staticWebAppHostName = $baseDeployment.staticWebAppHostName.value

Push-Location (Join-Path $repoRoot "api")
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "Function dependency installation failed." }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "Function tests failed." }
  $published = $false
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    func azure functionapp publish $functionAppName
    if ($LASTEXITCODE -eq 0) {
      $published = $true
      break
    }
    if ($attempt -lt 6) {
      Write-Host "Function publish attempt $attempt failed; waiting for storage role propagation before retrying."
      Start-Sleep -Seconds 20
    }
  }
  if (-not $published) { throw "Function deployment failed after 6 attempts." }
}
finally {
  Pop-Location
}

$functionKey = $null
for ($attempt = 1; $attempt -le 6; $attempt++) {
  $functionKey = az functionapp keys list `
    --name $functionAppName `
    --resource-group $ResourceGroupName `
    --query functionKeys.default `
    --output tsv
  if ($LASTEXITCODE -eq 0 -and $functionKey) {
    break
  }
  if ($attempt -lt 6) {
    Write-Host "Function key is not available yet; waiting before retrying."
    Start-Sleep -Seconds 20
  }
}
if (-not $functionKey) {
  throw "Could not retrieve the default Function key for API Management."
}

$parameterFile = Join-Path $env:TEMP "sd-weather-apim-$PID.parameters.json"
try {
  $parameters = @{
    location = @{ value = $Location }
    publisherEmail = @{ value = $PublisherEmail }
    publisherName = @{ value = $PublisherName }
    functionAppName = @{ value = $functionAppName }
    staticWebAppHostName = @{ value = $staticWebAppHostName }
    functionKey = @{ value = $functionKey }
  } | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($parameterFile, $parameters, [System.Text.UTF8Encoding]::new($false))

  $gatewayDeployment = az deployment group create `
    --resource-group $ResourceGroupName `
    --template-file (Join-Path $PSScriptRoot "apim.bicep") `
    --parameters "@$parameterFile" `
    --query properties.outputs `
    --output json | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) {
    throw "API Management deployment failed."
  }
}
finally {
  if (Test-Path -LiteralPath $parameterFile) {
    Remove-Item -LiteralPath $parameterFile -Force
  }
  Remove-Variable functionKey -ErrorAction SilentlyContinue
}

$staticWebAppToken = $null
for ($attempt = 1; $attempt -le 6; $attempt++) {
  $staticWebAppToken = az staticwebapp secrets list `
    --name $staticWebAppName `
    --query properties.apiKey `
    --output tsv
  if ($LASTEXITCODE -eq 0 -and $staticWebAppToken) {
    break
  }
  if ($attempt -lt 6) {
    Write-Host "Static Web App token is not available yet; waiting before retrying."
    Start-Sleep -Seconds 20
  }
}
if (-not $staticWebAppToken) {
  throw "Could not retrieve the Static Web App deployment token."
}

Push-Location (Join-Path $repoRoot "web")
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "Web dependency installation failed." }
  $env:VITE_WEATHER_API_BASE_URL = $gatewayDeployment.publicApiUrl.value
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Static web app build failed." }
}
finally {
  Remove-Item Env:VITE_WEATHER_API_BASE_URL -ErrorAction SilentlyContinue
  Pop-Location
}

$sitePublished = $false
for ($attempt = 1; $attempt -le 3; $attempt++) {
  npx --yes @azure/static-web-apps-cli deploy (Join-Path $repoRoot "web\dist") `
    --env production `
    --deployment-token $staticWebAppToken
  if ($LASTEXITCODE -eq 0) {
    $sitePublished = $true
    break
  }
  if ($attempt -lt 3) {
    Write-Host "Static Web App upload attempt $attempt failed; retrying shortly."
    Start-Sleep -Seconds 10
  }
}
if (-not $sitePublished) {
  throw "Static Web App deployment failed after 3 attempts."
}
Remove-Variable staticWebAppToken -ErrorAction SilentlyContinue

$copilotSpec = Get-Content (Join-Path $repoRoot "api\openapi\copilot.openapi.json") -Raw | ConvertFrom-Json
$copilotSpec.host = ($gatewayDeployment.apimGatewayUrl.value -replace "^https://", "")
$outputDirectory = Join-Path $repoRoot "deploy-output"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$specPath = Join-Path $outputDirectory "copilot-weather.openapi.json"
$serializedSpec = $copilotSpec | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($specPath, $serializedSpec, [System.Text.UTF8Encoding]::new($false))

Write-Host "Static web app: https://$staticWebAppHostName"
Write-Host "Weather API for the web: $($gatewayDeployment.publicApiUrl.value)"
Write-Host "Weather API for Copilot Studio: $($gatewayDeployment.copilotApiUrl.value)"
Write-Host "Import this OpenAPI 2.0 file into a Power Platform custom connector: $specPath"
Write-Host "Create an API-scoped APIM subscription before connecting the custom connector."
