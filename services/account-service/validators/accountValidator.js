const Joi = require('joi');

const accountCreationSchema = Joi.object({
  userId: Joi.string().required().min(1).max(100),
  accountType: Joi.string().valid('individual', 'corporate', 'fee').required(),
  currency: Joi.string().required().length(3).uppercase(),
  initialBalance: Joi.number().min(0).optional(),
  metadata: Joi.object().optional()
}).unknown(true);

const accountUpdateSchema = Joi.object({
  status: Joi.string().valid('active', 'frozen', 'closed', 'suspended').optional(),
  kycLevel: Joi.string().valid('none', 'basic', 'enhanced').optional(),
  limits: Joi.object({
    dailyTransactionLimit: Joi.number().positive().optional(),
    monthlyTransactionLimit: Joi.number().positive().optional(),
    dailyTransactionCount: Joi.number().integer().positive().optional()
  }).optional(),
  metadata: Joi.object().optional()
});

const validateAccountCreation = (data) => {
  return accountCreationSchema.validate(data);
};

const validateAccountUpdate = (data) => {
  return accountUpdateSchema.validate(data);
};

module.exports = {
  validateAccountCreation,
  validateAccountUpdate
};
