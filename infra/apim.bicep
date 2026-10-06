@description('Azure region for API Management.')
param location string = resourceGroup().location

@description('Lowercase prefix used for resource names.')
@minLength(3)
@maxLength(10)
param namePrefix string = 'sdweather'

@description('Publisher email required by API Management.')
param publisherEmail string

@description('Publisher display name required by API Management.')
param publisherName string = 'Surviving Dynamics demo'

@description('Name of the deployed Azure Function App.')
param functionAppName string

@description('Default hostname of the deployed Static Web App.')
param staticWebAppHostName string

@description('Function host key injected by API Management. Never commit or log this value.')
@secure()
param functionKey string

var suffix = toLower(uniqueString(subscription().id, resourceGroup().id))
var apimName = take('${toLower(namePrefix)}-apim-${suffix}', 50)
var backendHostName = '${functionAppName}.azurewebsites.net'
var backendUrl = 'https://${backendHostName}/api'
var functionKeyName = 'function-key'
var publicApiPath = 'weather'
var copilotApiPath = 'copilot-weather'
var openApi = replace(loadTextContent('../api/openapi/weather.openapi.json'), '__FUNCTION_HOST__', backendHostName)
var policy = replace(loadTextContent('./apim-policy.xml'), '__STATIC_HOST__', staticWebAppHostName)

resource apim 'Microsoft.ApiManagement/service@2024-05-01' = {
  name: apimName
  location: location
  sku: {
    name: 'Developer'
    capacity: 1
  }
  properties: {
    publisherEmail: publisherEmail
    publisherName: publisherName
    virtualNetworkType: 'None'
    publicNetworkAccess: 'Enabled'
  }
}

resource functionKeyValue 'Microsoft.ApiManagement/service/namedValues@2022-08-01' = {
  parent: apim
  name: functionKeyName
  properties: {
    displayName: functionKeyName
    value: functionKey
    secret: true
  }
}

resource publicApi 'Microsoft.ApiManagement/service/apis@2022-08-01' = {
  parent: apim
  name: 'weather-public'
  properties: {
    displayName: 'Weather for the web'
    path: publicApiPath
    protocols: [
      'https'
    ]
    subscriptionRequired: false
    serviceUrl: backendUrl
    format: 'swagger-json'
    value: openApi
  }
}

resource copilotApi 'Microsoft.ApiManagement/service/apis@2022-08-01' = {
  parent: apim
  name: 'weather-copilot'
  properties: {
    displayName: 'Weather for Copilot Studio'
    path: copilotApiPath
    protocols: [
      'https'
    ]
    subscriptionRequired: true
    serviceUrl: backendUrl
    format: 'swagger-json'
    value: openApi
  }
}

resource publicApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2022-08-01' = {
  parent: publicApi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: policy
  }
  dependsOn: [
    functionKeyValue
  ]
}

resource copilotApiPolicy 'Microsoft.ApiManagement/service/apis/policies@2022-08-01' = {
  parent: copilotApi
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: policy
  }
  dependsOn: [
    functionKeyValue
  ]
}

output apimName string = apim.name
output apimGatewayUrl string = 'https://${apim.name}.azure-api.net'
output publicApiUrl string = 'https://${apim.name}.azure-api.net/${publicApiPath}'
output copilotApiUrl string = 'https://${apim.name}.azure-api.net/${copilotApiPath}'
