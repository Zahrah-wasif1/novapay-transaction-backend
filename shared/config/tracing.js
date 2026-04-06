const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const logger = require('../utils/logger');

let sdk = null;

async function initializeTracing() {
  try {
    const jaegerEndpoint = process.env.JAEGER_ENDPOINT;
    
    if (!jaegerEndpoint) {
      logger.info('Jaeger endpoint not configured, skipping tracing initialization');
      return;
    }

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: 'novapay-transaction-backend',
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development'
      }),
      traceExporter: new OTLPTraceExporter({
        url: jaegerEndpoint,
        headers: {
          'Content-Type': 'application/json'
        }
      }),
      instrumentations: [getNodeAutoInstrumentations()],
      spanLimits: {
        attributeCountLimit: 100,
        eventCountLimit: 100,
        linkCountLimit: 100,
        attributePerEventCountLimit: 100,
        attributePerLinkCountLimit: 100
      }
    });

    sdk.start();

    logger.info('OpenTelemetry tracing initialized', {
      jaegerEndpoint,
      serviceName: 'novapay-transaction-backend'
    });

  } catch (error) {
    logger.error('Failed to initialize tracing', { error: error.message });
    // Don't throw error, allow application to start without tracing
  }
}

async function shutdownTracing() {
  if (sdk) {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shutdown');
  }
}

module.exports = {
  initializeTracing,
  shutdownTracing
};
