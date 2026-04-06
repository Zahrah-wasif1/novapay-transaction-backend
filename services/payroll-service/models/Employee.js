const mongoose = require('mongoose');
const { encryptSensitiveData, decryptSensitiveData } = require('../../../shared/utils/encryption');

const employeeSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true,
    unique: true
  },
  employerId: {
    type: String,
    required: true,
    ref: 'Account'
  },
  personalInfo: {
    firstName: {
      type: String,
      required: true
    },
    lastName: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true
    },
    phone: {
      type: String,
      required: true
    },
    dateOfBirth: {
      type: Date,
      required: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    }
  },
  employment: {
    department: {
      type: String,
      required: true
    },
    position: {
      type: String,
      required: true
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: Date,
    employmentType: {
      type: String,
      enum: ['full-time', 'part-time', 'contract', 'intern'],
      default: 'full-time'
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'terminated', 'on-leave'],
      default: 'active'
    }
  },
  compensation: {
    salary: {
      type: mongoose.Decimal128,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: 'USD'
    },
    payFrequency: {
      type: String,
      enum: ['weekly', 'bi-weekly', 'monthly', 'semi-monthly'],
      default: 'monthly'
    },
    bankAccount: {
      accountNumber: {
        type: String,
        required: true
      },
      bankName: String,
      routingNumber: String,
      accountType: {
        type: String,
        enum: ['checking', 'savings'],
        default: 'checking'
      }
    }
  },
  benefits: {
    healthInsurance: {
      type: Boolean,
      default: false
    },
    dentalInsurance: {
      type: Boolean,
      default: false
    },
    retirement401k: {
      type: Boolean,
      default: false
    },
    paidTimeOff: {
      type: Number,
      default: 0
    }
  },
  tax: {
    federalTaxWithholding: {
      type: mongoose.Decimal128,
      default: 0.0
    },
    stateTaxWithholding: {
      type: mongoose.Decimal128,
      default: 0.0
    },
    socialSecurityNumber: String,
    taxFilingStatus: {
      type: String,
      enum: ['single', 'married-joint', 'married-separate', 'head-of-household'],
      default: 'single'
    }
  },
  metadata: {
    emergencyContact: {
      name: String,
      relationship: String,
      phone: String
    },
    notes: String,
    encrypted: {
      type: mongoose.Mixed,
      select: false
    },
    encryptedDataKey: {
      type: String,
      select: false
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
employeeSchema.index({ employeeId: 1 });
employeeSchema.index({ employerId: 1 });
employeeSchema.index({ 'employment.status': 1 });
employeeSchema.index({ 'personalInfo.email': 1 });
employeeSchema.index({ createdAt: -1 });

// Virtual for full name
employeeSchema.virtual('personalInfo.fullName').get(function() {
  return `${this.personalInfo.firstName} ${this.personalInfo.lastName}`;
});

// Virtual for employment duration
employeeSchema.virtual('employment.duration').get(function() {
  const start = new Date(this.employment.startDate);
  const end = this.employment.endDate ? new Date(this.employment.endDate) : new Date();
  return Math.floor((end - start) / (1000 * 60 * 60 * 24 * 30)); // months
});

// Pre-save middleware for encryption
employeeSchema.pre('save', function(next) {
  if (this.isModified('metadata.encrypted') && this.metadata.encrypted) {
    try {
      // Encrypt sensitive data before saving
      const sensitiveData = {
        socialSecurityNumber: this.tax.socialSecurityNumber,
        bankAccount: this.compensation.bankAccount,
        emergencyContact: this.metadata.emergencyContact
      };
      
      const { encrypted, encryptedDataKey } = encryptSensitiveData(sensitiveData);
      this.metadata.encrypted = encrypted;
      this.metadata.encryptedDataKey = encryptedDataKey;
      
      // Remove unencrypted sensitive data
      this.tax.socialSecurityNumber = undefined;
      this.compensation.bankAccount = undefined;
      this.metadata.emergencyContact = undefined;
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Instance methods
employeeSchema.methods.toSafeJSON = function() {
  const obj = this.toObject();
  
  // Remove sensitive encrypted data
  delete obj.metadata.encrypted;
  delete obj.metadata.encryptedDataKey;
  
  // Convert Decimal128 to string for JSON serialization
  if (obj.compensation) {
    if (obj.compensation.salary) obj.compensation.salary = obj.compensation.salary.toString();
  }
  if (obj.tax) {
    if (obj.tax.federalTaxWithholding) obj.tax.federalTaxWithholding = obj.tax.federalTaxWithholding.toString();
    if (obj.tax.stateTaxWithholding) obj.tax.stateTaxWithholding = obj.tax.stateTaxWithholding.toString();
  }
  
  return obj;
};

employeeSchema.methods.getDecryptedData = function() {
  if (!this.metadata.encrypted || !this.metadata.encryptedDataKey) {
    return {};
  }
  
  try {
    return decryptSensitiveData(this.metadata.encrypted, this.metadata.encryptedDataKey);
  } catch (error) {
    throw new Error('Failed to decrypt employee data');
  }
};

employeeSchema.methods.getPayrollData = function() {
  return {
    employeeId: this.employeeId,
    accountNumber: this.compensation.bankAccount.accountNumber,
    amount: this.compensation.salary,
    currency: this.compensation.currency,
    metadata: {
      employeeName: this.personalInfo.fullName,
      department: this.employment.department,
      position: this.employment.position
    }
  };
};

employeeSchema.methods.isActive = function() {
  return this.employment.status === 'active';
};

employeeSchema.methods.updateSalary = function(newSalary, currency) {
  this.compensation.salary = newSalary;
  if (currency) {
    this.compensation.currency = currency;
  }
  this.updatedAt = new Date();
};

employeeSchema.methods.terminate = function(endDate, reason) {
  this.employment.status = 'terminated';
  this.employment.endDate = endDate || new Date();
  this.metadata.notes = this.metadata.notes ? 
    `${this.metadata.notes}\nTerminated: ${reason}` : 
    `Terminated: ${reason}`;
  this.updatedAt = new Date();
};

// Static methods
employeeSchema.statics.findByEmployerId = function(employerId, options = {}) {
  const query = { employerId };
  if (options.status) {
    query['employment.status'] = options.status;
  }
  if (options.department) {
    query['employment.department'] = options.department;
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((options.page - 1) * options.limit)
    .limit(options.limit);
};

employeeSchema.statics.findByEmployeeId = function(employeeId, employerId) {
  const query = { employeeId };
  if (employerId) {
    query.employerId = employerId;
  }
  return this.findOne(query);
};

employeeSchema.statics.getActiveEmployees = function(employerId) {
  return this.find({
    employerId,
    'employment.status': 'active'
  }).sort({ 'personalInfo.lastName': 1, 'personalInfo.firstName': 1 });
};

employeeSchema.statics.getEmployeeCount = function(employerId, status) {
  const query = { employerId };
  if (status) {
    query['employment.status'] = status;
  }
  return this.countDocuments(query);
};

employeeSchema.statics.getPayrollEmployees = function(employerId) {
  return this.find({
    employerId,
    'employment.status': 'active'
  })
  .select('employeeId compensation.bankAccount.accountNumber compensation.salary compensation.currency personalInfo.firstName personalInfo.lastName employment.department employment.position')
  .lean();
};

module.exports = mongoose.model('Employee', employeeSchema);
