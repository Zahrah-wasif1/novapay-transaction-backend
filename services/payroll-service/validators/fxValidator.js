const Joi = require('joi');

const quoteRequestSchema = Joi.object({
  sourceCurrency: Joi.string().required().length(3).uppercase(),
  targetCurrency: Joi.string().required().length(3).uppercase(),
  sourceAmount: Joi.number().positive().required().max(1000000),
  userId: Joi.string().required().min(1).max(100)
});

const internationalTransferSchema = Joi.object({
  idempotencyKey: Joi.string().required().min(1).max(255),
  sourceAccount: Joi.string().required().min(1).max(50),
  destinationAccount: Joi.string().required().min(1).max(50),
  amount: Joi.number().positive().required().max(1000000),
  sourceCurrency: Joi.string().required().length(3).uppercase(),
  targetCurrency: Joi.string().required().length(3).uppercase(),
  quoteId: Joi.string().required().min(1).max(50),
  description: Joi.string().required().min(1).max(500)
});

const validateQuoteRequest = (data) => {
  return quoteRequestSchema.validate(data);
};

const validateInternationalTransfer = (data) => {
  return internationalTransferSchema.validate(data);
};

module.exports = {
  validateQuoteRequest,
  validateInternationalTransfer
};
