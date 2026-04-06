const Joi = require('joi');

// Employee creation validation schema
const employeeCreationSchema = Joi.object({
  employeeId: Joi.string().required().min(3).max(50),
  employerId: Joi.string().required().min(3).max(50),
  personalInfo: Joi.object({
    firstName: Joi.string().required().min(1).max(50),
    lastName: Joi.string().required().min(1).max(50),
    email: Joi.string().email().required(),
    phone: Joi.string().required().min(10).max(20),
    dateOfBirth: Joi.date().required().max('now'),
    address: Joi.object({
      street: Joi.string().max(200),
      city: Joi.string().max(100),
      state: Joi.string().max(100),
      zipCode: Joi.string().max(20),
      country: Joi.string().max(100)
    }).optional()
  }).required(),
  employment: Joi.object({
    department: Joi.string().required().min(1).max(100),
    position: Joi.string().required().min(1).max(100),
    startDate: Joi.date().required().max('now'),
    endDate: Joi.date().optional().min(Joi.ref('startDate')),
    employmentType: Joi.string().valid('full-time', 'part-time', 'contract', 'intern').default('full-time'),
    status: Joi.string().valid('active', 'inactive', 'terminated', 'on-leave').default('active')
  }).required(),
  compensation: Joi.object({
    salary: Joi.number().positive().required(),
    currency: Joi.string().length(3).default('USD'),
    payFrequency: Joi.string().valid('weekly', 'bi-weekly', 'monthly', 'semi-monthly').default('monthly'),
    bankAccount: Joi.object({
      accountNumber: Joi.string().required().min(3).max(50),
      bankName: Joi.string().max(100),
      routingNumber: Joi.string().max(50),
      accountType: Joi.string().valid('checking', 'savings').default('checking')
    }).required()
  }).required(),
  benefits: Joi.object({
    healthInsurance: Joi.boolean().default(false),
    dentalInsurance: Joi.boolean().default(false),
    retirement401k: Joi.boolean().default(false),
    paidTimeOff: Joi.number().min(0).default(0)
  }).optional(),
  tax: Joi.object({
    federalTaxWithholding: Joi.number().min(0).max(1).default(0),
    stateTaxWithholding: Joi.number().min(0).max(1).default(0),
    socialSecurityNumber: Joi.string().pattern(/^\d{3}-\d{2}-\d{4}$/).optional(),
    taxFilingStatus: Joi.string().valid('single', 'married-joint', 'married-separate', 'head-of-household').default('single')
  }).optional(),
  metadata: Joi.object({
    emergencyContact: Joi.object({
      name: Joi.string().max(100),
      relationship: Joi.string().max(50),
      phone: Joi.string().max(20)
    }).optional(),
    notes: Joi.string().max(1000)
  }).optional()
});

// Employee update validation schema
const employeeUpdateSchema = Joi.object({
  personalInfo: Joi.object({
    firstName: Joi.string().min(1).max(50),
    lastName: Joi.string().min(1).max(50),
    email: Joi.string().email(),
    phone: Joi.string().min(10).max(20),
    dateOfBirth: Joi.date().max('now'),
    address: Joi.object({
      street: Joi.string().max(200),
      city: Joi.string().max(100),
      state: Joi.string().max(100),
      zipCode: Joi.string().max(20),
      country: Joi.string().max(100)
    })
  }).optional(),
  employment: Joi.object({
    department: Joi.string().min(1).max(100),
    position: Joi.string().min(1).max(100),
    employmentType: Joi.string().valid('full-time', 'part-time', 'contract', 'intern'),
    status: Joi.string().valid('active', 'inactive', 'terminated', 'on-leave')
  }).optional(),
  compensation: Joi.object({
    salary: Joi.number().positive(),
    currency: Joi.string().length(3),
    payFrequency: Joi.string().valid('weekly', 'bi-weekly', 'monthly', 'semi-monthly'),
    bankAccount: Joi.object({
      accountNumber: Joi.string().min(3).max(50),
      bankName: Joi.string().max(100),
      routingNumber: Joi.string().max(50),
      accountType: Joi.string().valid('checking', 'savings')
    })
  }).optional(),
  benefits: Joi.object({
    healthInsurance: Joi.boolean(),
    dentalInsurance: Joi.boolean(),
    retirement401k: Joi.boolean(),
    paidTimeOff: Joi.number().min(0)
  }).optional(),
  tax: Joi.object({
    federalTaxWithholding: Joi.number().min(0).max(1),
    stateTaxWithholding: Joi.number().min(0).max(1),
    socialSecurityNumber: Joi.string().pattern(/^\d{3}-\d{2}-\d{4}$/),
    taxFilingStatus: Joi.string().valid('single', 'married-joint', 'married-separate', 'head-of-household')
  }).optional(),
  metadata: Joi.object({
    emergencyContact: Joi.object({
      name: Joi.string().max(100),
      relationship: Joi.string().max(50),
      phone: Joi.string().max(20)
    }),
    notes: Joi.string().max(1000)
  }).optional()
}).min(1);

// Salary update validation schema
const salaryUpdateSchema = Joi.object({
  salary: Joi.number().positive().required(),
  currency: Joi.string().length(3).optional()
});

// Employee termination validation schema
const employeeTerminationSchema = Joi.object({
  endDate: Joi.date().max('now').optional(),
  reason: Joi.string().max(500).optional()
});

// Validation functions
function validateEmployeeCreation(data) {
  return employeeCreationSchema.validate(data);
}

function validateEmployeeUpdate(data) {
  return employeeUpdateSchema.validate(data);
}

function validateSalaryUpdate(data) {
  return salaryUpdateSchema.validate(data);
}

function validateEmployeeTermination(data) {
  return employeeTerminationSchema.validate(data);
}

module.exports = {
  validateEmployeeCreation,
  validateEmployeeUpdate,
  validateSalaryUpdate,
  validateEmployeeTermination
};
