const mongoose = require('mongoose');

const payrollEmployeeSchema = new mongoose.Schema({
  employeeId: {
    type: String,
    required: true
  },
  accountNumber: {
    type: String,
    required: true
  },
  amount: {
    type: mongoose.Decimal128,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    uppercase: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'skipped'],
    default: 'pending'
  },
  transactionId: String,
  failureReason: String,
  processedAt: Date,
  metadata: {
    department: String,
    position: String,
    email: String,
    employeeName: String
  }
});

const payrollJobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  employerId: {
    type: String,
    required: true,
    index: true
  },
  employerAccount: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: String,
  status: {
    type: String,
    enum: ['draft', 'queued', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'draft'
  },
  totalAmount: {
    type: mongoose.Decimal128,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    uppercase: true
  },
  employeeCount: {
    type: Number,
    required: true,
    min: 1
  },
  employees: [payrollEmployeeSchema],
  processing: {
    startedAt: Date,
    completedAt: Date,
    processedCount: {
      type: Number,
      default: 0
    },
    successCount: {
      type: Number,
      default: 0
    },
    failureCount: {
      type: Number,
      default: 0
    },
    skippedCount: {
      type: Number,
      default: 0
    },
    currentEmployeeIndex: {
      type: Number,
      default: 0
    },
    lastProcessedAt: Date,
    retryCount: {
      type: Number,
      default: 0
    },
    maxRetries: {
      type: Number,
      default: 3
    }
  },
  scheduling: {
    scheduledFor: Date,
    isRecurring: {
      type: Boolean,
      default: false
    },
    recurrencePattern: String, // cron expression
    nextRunDate: Date
  },
  metadata: {
    idempotencyKey: String,
    uploadedBy: String,
    department: String,
    costCenter: String,
    approvalRequired: {
      type: Boolean,
      default: false
    },
    approvedBy: String,
    approvedAt: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
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
payrollJobSchema.index({ employerId: 1, status: 1 });
payrollJobSchema.index({ status: 1, createdAt: -1 });
payrollJobSchema.index({ 'scheduling.scheduledFor': 1, status: 1 });
payrollJobSchema.index({ 'processing.startedAt': 1 });

// Virtuals
payrollJobSchema.virtual('progressPercentage').get(function() {
  if (this.employeeCount === 0) return 0;
  return Math.round((this.processing.processedCount / this.employeeCount) * 100);
});

payrollJobSchema.virtual('isProcessing').get(function() {
  return this.status === 'processing';
});

payrollJobSchema.virtual('canRetry').get(function() {
  return this.status === 'failed' && this.processing.retryCount < this.processing.maxRetries;
});

payrollJobSchema.virtual('totalAmountString').get(function() {
  return this.totalAmount.toString();
});

// Pre-save middleware
payrollJobSchema.pre('save', function(next) {
  if (this.isNew) {
    this.jobId = `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  }
  
  // Update employee count if employees array changes
  if (this.isModified('employees')) {
    this.employeeCount = this.employees.length;
    
    // Recalculate total amount
    const total = this.employees.reduce((sum, emp) => {
      return sum + parseFloat(emp.amount.toString());
    }, 0);
    this.totalAmount = total.toString();
  }
  
  next();
});

// Instance methods
payrollJobSchema.methods.startProcessing = function() {
  this.status = 'processing';
  this.processing.startedAt = new Date();
  this.processing.currentEmployeeIndex = 0;
  this.processing.processedCount = 0;
  this.processing.successCount = 0;
  this.processing.failureCount = 0;
  this.processing.skippedCount = 0;
  return this.save();
};

payrollJobSchema.methods.getNextEmployee = function() {
  if (this.processing.currentEmployeeIndex >= this.employees.length) {
    return null;
  }
  
  const employee = this.employees[this.processing.currentEmployeeIndex];
  this.processing.currentEmployeeIndex++;
  this.processing.lastProcessedAt = new Date();
  return employee;
};

payrollJobSchema.methods.markEmployeeProcessed = function(employeeIndex, result) {
  const employee = this.employees[employeeIndex];
  if (!employee) return this;

  employee.status = result.status;
  employee.transactionId = result.transactionId;
  employee.failureReason = result.failureReason;
  employee.processedAt = new Date();
  
  this.processing.processedCount++;
  
  if (result.status === 'completed') {
    this.processing.successCount++;
  } else if (result.status === 'failed') {
    this.processing.failureCount++;
  } else if (result.status === 'skipped') {
    this.processing.skippedCount++;
  }
  
  return this.save();
};

payrollJobSchema.methods.completeProcessing = function() {
  this.status = 'completed';
  this.processing.completedAt = new Date();
  return this.save();
};

payrollJobSchema.methods.failProcessing = function(reason) {
  this.status = 'failed';
  this.processing.retryCount++;
  this.metadata.failureReason = reason;
  return this.save();
};

payrollJobSchema.methods.cancel = function(reason) {
  this.status = 'cancelled';
  this.metadata.cancelledReason = reason;
  return this.save();
};

// Static methods
payrollJobSchema.statics.findQueuedJobs = function() {
  return this.find({ 
    status: 'queued',
    'scheduling.scheduledFor': { $lte: new Date() }
  }).sort({ 'scheduling.scheduledFor': 1 });
};

payrollJobSchema.statics.findProcessingJobs = function() {
  return this.find({ status: 'processing' });
};

payrollJobSchema.statics.findFailedJobs = function() {
  return this.find({ 
    status: 'failed',
    'processing.retryCount': { $lt: this.schema.paths.processing.maxRetries.default }
  });
};

payrollJobSchema.statics.getEmployerJobs = function(employerId, options = {}) {
  const { status, page = 1, limit = 20 } = options;
  
  const query = { employerId };
  if (status) query.status = status;
  
  const skip = (page - 1) * limit;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

payrollJobSchema.statics.getJobStats = async function(employerId, startDate, endDate) {
  const matchCondition = {};
  if (employerId) matchCondition.employerId = employerId;
  if (startDate && endDate) {
    matchCondition.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  const pipeline = [
    { $match: matchCondition },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDecimal: '$totalAmount' } },
        totalEmployees: { $sum: '$employeeCount' }
      }
    }
  ];

  const stats = await this.aggregate(pipeline);
  return stats.reduce((acc, stat) => {
    acc[stat._id] = {
      count: stat.count,
      totalAmount: stat.totalAmount.toString(),
      totalEmployees: stat.totalEmployees
    };
    return acc;
  }, {});
};

payrollJobSchema.statics.cleanupOldJobs = async function(daysOld = 90) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  const result = await this.deleteMany({
    status: { $in: ['completed', 'cancelled'] },
    updatedAt: { $lt: cutoffDate }
  });
  
  return {
    deletedCount: result.deletedCount
  };
};

module.exports = mongoose.model('PayrollJob', payrollJobSchema);
