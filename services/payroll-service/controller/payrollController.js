const express = require('express');
const { Queue, Worker } = require('bullmq');
const crypto = require('crypto');
const PayrollJob = require('../models/PayrollJob');
const Employee = require('../models/Employee');
const Account = require('../../account-service/models/Account');
const { Transaction } = require('../../transaction-service/models/Transaction');
const LedgerEntry = require('../../ledger-service/models/Ledger');
const { getBullMQRedis } = require('../../../shared/config/redis');
const logger = require('../../../shared/utils/logger');

const router = express.Router();

// Initialize BullMQ queues (lazy initialization)
let payrollQueue = null;

function getPayrollQueue() {
  if (!payrollQueue) {
    try {
      payrollQueue = new Queue('payroll-processing', {
        connection: getBullMQRedis(),
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      });
    } catch (error) {
      throw new Error('Payroll queue not available - Redis may not be running');
    }
  }
  return payrollQueue;
}

// Create payroll job
router.post('/jobs', async (req, res) => {
  const requestId = req.requestId;
  const {
    employerId,
    employerAccount,
    title,
    description,
    employees,
    scheduling,
    metadata
  } = req.body;

  try {
    // Validate input
    const { error } = validatePayrollCreation(req.body);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    // Check idempotency for payroll creation
    if (metadata?.idempotencyKey) {
      const existingJob = await PayrollJob.findOne({
        'metadata.idempotencyKey': metadata.idempotencyKey
      });

      if (existingJob) {
        return res.status(409).json({
          error: 'Payroll job already created with this idempotency key',
          jobId: existingJob.jobId,
          requestId
        });
      }
    }

    // Validate employer account
    const employerAcc = await Account.findOne({
      accountNumber: employerAccount,
      status: 'active'
    });

    if (!employerAcc) {
      return res.status(404).json({
        error: 'Employer account not found or inactive',
        requestId
      });
    }

    // Calculate total amount and validate employee accounts
    let totalAmount = 0;
    const employeeAccounts = [];

    for (const employee of employees) {
      totalAmount += parseFloat(employee.amount);
      
      const empAccount = await Account.findOne({
        accountNumber: employee.accountNumber,
        status: 'active'
      });

      if (!empAccount) {
        return res.status(400).json({
          error: `Employee account not found: ${employee.accountNumber}`,
          requestId
        });
      }

      employeeAccounts.push(empAccount);
    }

    // Check employer has sufficient balance
    if (!employerAcc.hasSufficientBalance(totalAmount.toString())) {
      return res.status(400).json({
        error: 'Insufficient balance in employer account',
        requiredAmount: totalAmount.toString(),
        availableBalance: employerAcc.availableBalance.toString(),
        requestId
      });
    }

    // Create payroll job
    const payrollJob = new PayrollJob({
      employerId,
      employerAccount,
      title,
      description,
      employees,
      scheduling,
      metadata
    });

    await payrollJob.save();

    // Queue the job for processing
    if (scheduling?.scheduledFor) {
      const delay = new Date(scheduling.scheduledFor) - new Date();
      if (delay > 0) {
        await getPayrollQueue().add(
          `process-payroll-${payrollJob.jobId}`,
          {
            jobId: payrollJob.jobId,
            employerId,
            employerAccount,
            requestId
          },
          {
            delay,
            jobId: `payroll-${payrollJob.jobId}`,
            // Concurrency control per employer
            opts: {
              ...getPayrollQueue().opts.defaultJobOptions,
              // Use employer ID as part of the job ID for concurrency control
              jobId: `payroll-${employerId}-${payrollJob.jobId}`
            }
          }
        );
      }
    } else {
      await getPayrollQueue().add(
        `process-payroll-${payrollJob.jobId}`,
        {
          jobId: payrollJob.jobId,
          employerId,
          employerAccount,
          requestId
        },
        {
          jobId: `payroll-${employerId}-${payrollJob.jobId}`,
          // This ensures only one job per employer at a time
          opts: {
            ...getPayrollQueue().opts.defaultJobOptions,
            // Use employer ID for concurrency control
            jobId: `payroll-${employerId}-${Date.now()}`
          }
        }
      );
    }

    // Update job status to queued
    payrollJob.status = 'queued';
    await payrollJob.save();

    logger.info('Payroll job created and queued', {
      requestId,
      jobId: payrollJob.jobId,
      employerId,
      employeeCount: employees.length,
      totalAmount: totalAmount.toString()
    });

    res.status(201).json({
      message: 'Payroll job created successfully',
      job: {
        jobId: payrollJob.jobId,
        employerId,
        title,
        employeeCount: employees.length,
        totalAmount: payrollJob.totalAmount.toString(),
        currency: payrollJob.currency,
        status: payrollJob.status,
        scheduledFor: scheduling?.scheduledFor
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to create payroll job', {
      requestId,
      error: error.message,
      employerId
    });

    res.status(500).json({
      error: 'Failed to create payroll job',
      requestId
    });
  }
});

// Create payroll job from employee database
router.post('/jobs/from-employees', async (req, res) => {
  const requestId = req.requestId;
  const {
    employerId,
    employerAccount,
    title,
    description,
    employeeIds,
    scheduling,
    metadata
  } = req.body;

  try {
    // Validate required fields
    if (!employerId || !employerAccount || !title || !employeeIds || !Array.isArray(employeeIds)) {
      return res.status(400).json({
        error: 'Missing required fields: employerId, employerAccount, title, employeeIds',
        requestId
      });
    }

    // Check idempotency for payroll creation
    if (metadata?.idempotencyKey) {
      const existingJob = await PayrollJob.findOne({
        'metadata.idempotencyKey': metadata.idempotencyKey
      });

      if (existingJob) {
        return res.status(409).json({
          error: 'Payroll job already created with this idempotency key',
          jobId: existingJob.jobId,
          requestId
        });
      }
    }

    // Validate employer account
    const employerAcc = await Account.findOne({
      accountNumber: employerAccount,
      status: 'active'
    });

    if (!employerAcc) {
      return res.status(404).json({
        error: 'Employer account not found or inactive',
        requestId
      });
    }

    // Get employees from database
    const employees = await Employee.find({
      employeeId: { $in: employeeIds },
      employerId: employerId,
      'employment.status': 'active'
    });

    if (employees.length === 0) {
      return res.status(404).json({
        error: 'No active employees found for the provided employee IDs',
        requestId
      });
    }

    // Check for missing employees
    const foundEmployeeIds = employees.map(emp => emp.employeeId);
    const missingEmployeeIds = employeeIds.filter(id => !foundEmployeeIds.includes(id));
    
    if (missingEmployeeIds.length > 0) {
      return res.status(404).json({
        error: `Employees not found or inactive: ${missingEmployeeIds.join(', ')}`,
        requestId
      });
    }

    // Convert employees to payroll format
    const payrollEmployees = employees.map(emp => emp.getPayrollData());

    // Calculate total amount
    let totalAmount = 0;
    for (const employee of payrollEmployees) {
      totalAmount += parseFloat(employee.amount);
    }

    // Check employer has sufficient balance
    if (!employerAcc.hasSufficientBalance(totalAmount.toString())) {
      return res.status(400).json({
        error: 'Insufficient balance in employer account',
        requiredAmount: totalAmount.toString(),
        availableBalance: employerAcc.availableBalance.toString(),
        requestId
      });
    }

    // Create payroll job
    const payrollJob = new PayrollJob({
      employerId,
      employerAccount,
      title,
      description,
      employees: payrollEmployees,
      scheduling,
      metadata: {
        ...metadata,
        createdFrom: 'employee_database',
        originalEmployeeIds: employeeIds
      }
    });

    await payrollJob.save();

    // Queue the job for processing
    if (scheduling?.scheduledFor) {
      const delay = new Date(scheduling.scheduledFor) - new Date();
      if (delay > 0) {
        await getPayrollQueue().add(
          `process-payroll-${payrollJob.jobId}`,
          {
            jobId: payrollJob.jobId,
            employerId,
            employerAccount,
            requestId
          },
          {
            delay,
            jobId: `payroll-${payrollJob.jobId}`,
            opts: {
              ...getPayrollQueue().opts.defaultJobOptions,
              jobId: `payroll-${employerId}-${payrollJob.jobId}`
            }
          }
        );
      }
    } else {
      await getPayrollQueue().add(
        `process-payroll-${payrollJob.jobId}`,
        {
          jobId: payrollJob.jobId,
          employerId,
          employerAccount,
          requestId
        },
        {
          jobId: `payroll-${employerId}-${Date.now()}`,
          opts: {
            ...getPayrollQueue().opts.defaultJobOptions,
            jobId: `payroll-${employerId}-${Date.now()}`
          }
        }
      );
    }

    // Update job status to queued
    payrollJob.status = 'queued';
    await payrollJob.save();

    logger.info('Payroll job created from employee database', {
      requestId,
      jobId: payrollJob.jobId,
      employerId,
      employeeCount: payrollEmployees.length,
      totalAmount: totalAmount.toString()
    });

    res.status(201).json({
      message: 'Payroll job created successfully from employee database',
      job: {
        jobId: payrollJob.jobId,
        employerId,
        title,
        employeeCount: payrollEmployees.length,
        totalAmount: payrollJob.totalAmount.toString(),
        currency: payrollJob.currency,
        status: payrollJob.status,
        scheduledFor: scheduling?.scheduledFor,
        employees: payrollEmployees.map(emp => ({
          employeeId: emp.employeeId,
          amount: emp.amount,
          currency: emp.currency,
          metadata: emp.metadata
        }))
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to create payroll job from employees', {
      requestId,
      error: error.message,
      employerId
    });

    res.status(500).json({
      error: 'Failed to create payroll job',
      requestId
    });
  }
});

// Get payroll job status
router.get('/jobs/:jobId', async (req, res) => {
  const requestId = req.requestId;
  const { jobId } = req.params;

  try {
    const job = await PayrollJob.findOne({ jobId });
    
    if (!job) {
      return res.status(404).json({
        error: 'Payroll job not found',
        requestId
      });
    }

    // Get BullMQ job status
    const bullJob = await payrollQueue.getJob(`payroll-${job.employerId}-${jobId}`);

    res.json({
      job: {
        jobId: job.jobId,
        employerId: job.employerId,
        title: job.title,
        status: job.status,
        employeeCount: job.employeeCount,
        totalAmount: job.totalAmount.toString(),
        currency: job.currency,
        progress: {
          processedCount: job.processing.processedCount,
          successCount: job.processing.successCount,
          failureCount: job.processing.failureCount,
          skippedCount: job.processing.skippedCount,
          progressPercentage: job.progressPercentage
        },
        processing: {
          startedAt: job.processing.startedAt,
          completedAt: job.processing.completedAt,
          retryCount: job.processing.retryCount
        },
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      },
      bullJobStatus: bullJob ? {
        id: bullJob.id,
        status: await bullJob.getState(),
        progress: bullJob.progress,
        processedOn: bullJob.processedOn,
        finishedOn: bullJob.finishedOn
      } : null,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get payroll job', {
      requestId,
      error: error.message,
      jobId
    });

    res.status(500).json({
      error: 'Failed to retrieve payroll job',
      requestId
    });
  }
});

// Get employer's payroll jobs
router.get('/jobs/employer/:employerId', async (req, res) => {
  const requestId = req.requestId;
  const { employerId } = req.params;
  const { status, page = 1, limit = 20 } = req.query;

  try {
    const jobs = await PayrollJob.getEmployerJobs(employerId, {
      status,
      page: parseInt(page),
      limit: parseInt(limit)
    });

    const total = await PayrollJob.countDocuments({ employerId, ...(status && { status }) });

    const formattedJobs = jobs.map(job => ({
      jobId: job.jobId,
      title: job.title,
      status: job.status,
      employeeCount: job.employeeCount,
      totalAmount: job.totalAmount.toString(),
      currency: job.currency,
      progress: {
        processedCount: job.processing.processedCount,
        successCount: job.processing.successCount,
        failureCount: job.processing.failureCount,
        progressPercentage: job.progressPercentage
      },
      createdAt: job.createdAt,
      completedAt: job.processing.completedAt
    }));

    res.json({
      jobs: formattedJobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get employer payroll jobs', {
      requestId,
      error: error.message,
      employerId
    });

    res.status(500).json({
      error: 'Failed to retrieve payroll jobs',
      requestId
    });
  }
});

// Cancel payroll job
router.post('/jobs/:jobId/cancel', async (req, res) => {
  const requestId = req.requestId;
  const { jobId } = req.params;
  const { reason } = req.body;

  try {
    const job = await PayrollJob.findOne({ jobId });
    
    if (!job) {
      return res.status(404).json({
        error: 'Payroll job not found',
        requestId
      });
    }

    if (job.status === 'completed') {
      return res.status(400).json({
        error: 'Cannot cancel completed payroll job',
        requestId
      });
    }

    // Cancel BullMQ job
    const bullJob = await getPayrollQueue().getJob(`payroll-${job.employerId}-${jobId}`);
    if (bullJob) {
      await bullJob.remove();
    }

    // Update job status
    await job.cancel(reason || 'Cancelled by user');

    logger.info('Payroll job cancelled', {
      requestId,
      jobId,
      employerId: job.employerId,
      reason
    });

    res.json({
      message: 'Payroll job cancelled successfully',
      jobId,
      requestId
    });

  } catch (error) {
    logger.error('Failed to cancel payroll job', {
      requestId,
      error: error.message,
      jobId
    });

    res.status(500).json({
      error: 'Failed to cancel payroll job',
      requestId
    });
  }
});

// Get payroll statistics
router.get('/stats/employer/:employerId', async (req, res) => {
  const requestId = req.requestId;
  const { employerId } = req.params;
  const { startDate, endDate } = req.query;

  try {
    const stats = await PayrollJob.getJobStats(employerId, startDate, endDate);
    
    res.json({
      stats,
      employerId,
      period: { startDate, endDate },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get payroll statistics', {
      requestId,
      error: error.message,
      employerId
    });

    res.status(500).json({
      error: 'Failed to retrieve statistics',
      requestId
    });
  }
});

// Initialize payroll worker
function initializePayrollWorker() {
  const worker = new Worker(
    'payroll-processing',
    async (job) => {
      const { jobId, employerId, employerAccount, requestId } = job.data;
      
      logger.info('Processing payroll job', {
        jobId,
        employerId,
        bullJobId: job.id
      });

      try {
        await processPayrollJob(jobId, employerId, employerAccount, requestId);
        
        logger.info('Payroll job completed successfully', {
          jobId,
          employerId
        });

      } catch (error) {
        logger.error('Payroll job processing failed', {
          jobId,
          employerId,
          error: error.message
        });

        throw error;
      }
    },
    {
      connection: getBullMQRedis(),
      concurrency: 1, // Process one job at a time per worker
      limiter: {
        max: 1,
        duration: 1000,
        groupKey: (job) => job.data.employerId // Concurrency control per employer
      }
    }
  );

  worker.on('completed', (job) => {
    logger.info('Payroll worker completed job', {
      bullJobId: job.id,
      jobId: job.data.jobId
    });
  });

  worker.on('failed', (job, err) => {
    logger.error('Payroll worker failed job', {
      bullJobId: job.id,
      jobId: job.data.jobId,
      error: err.message
    });
  });

  return worker;
}

// Process individual payroll job
async function processPayrollJob(jobId, employerId, employerAccount, requestId) {
  const payrollJob = await PayrollJob.findOne({ jobId });
  
  if (!payrollJob) {
    throw new Error(`Payroll job not found: ${jobId}`);
  }

  if (payrollJob.status !== 'queued') {
    throw new Error(`Payroll job is not in queued status: ${payrollJob.status}`);
  }

  await payrollJob.startProcessing();

  const employerAcc = await Account.findOne({
    accountNumber: employerAccount,
    status: 'active'
  });

  if (!employerAcc) {
    throw new Error('Employer account not found or inactive');
  }

  let currentEmployee;
  while ((currentEmployee = payrollJob.getNextEmployee()) !== null) {
    const employeeIndex = payrollJob.processing.currentEmployeeIndex - 1;
    
    try {
      // Process individual employee payment
      const result = await processEmployeePayment(
        payrollJob,
        currentEmployee,
        employerAcc,
        requestId
      );

      await payrollJob.markEmployeeProcessed(employeeIndex, result);

      // Update job progress
      await payrollJob.save();

      // Update BullMQ job progress
      const bullJob = await getPayrollQueue().getJob(`payroll-${employerId}-${jobId}`);
      if (bullJob) {
        await bullJob.updateProgress(payrollJob.progressPercentage);
      }

    } catch (error) {
      logger.error('Employee payment failed', {
        requestId,
        jobId,
        employeeId: currentEmployee.employeeId,
        error: error.message
      });

      await payrollJob.markEmployeeProcessed(employeeIndex, {
        status: 'failed',
        failureReason: error.message
      });
    }
  }

  // Complete payroll job
  await payrollJob.completeProcessing();
}

// Process individual employee payment
async function processEmployeePayment(payrollJob, employee, employerAcc, requestId) {
  const transactionId = `PAY_${Date.now()}_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
  
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Check if employer still has sufficient balance
    if (!employerAcc.hasSufficientBalance(employee.amount)) {
      throw new Error('Insufficient balance for employee payment');
    }

    // Get employee account
    const employeeAcc = await Account.findOne({
      accountNumber: employee.accountNumber,
      status: 'active'
    }).session(session);

    if (!employeeAcc) {
      throw new Error('Employee account not found or inactive');
    }

    // Freeze amount from employer account
    employerAcc.freezeAmount(employee.amount);
    await employerAcc.save({ session });

    // Create transaction record
    const transaction = new Transaction({
      transactionId,
      type: 'payroll',
      amount: employee.amount,
      currency: employee.currency,
      sourceAccount: payrollJob.employerAccount,
      destinationAccount: employee.accountNumber,
      description: `Payroll: ${payrollJob.title} - ${employee.employeeId}`,
      metadata: {
        payrollJobId: payrollJob.jobId,
        employeeId: employee.employeeId,
        employerId: payrollJob.employerId
      }
    });

    await transaction.save({ session });

    // Create ledger entries
    const ledgerResult = await LedgerEntry.createDoubleEntry({
      transactionId,
      debitAccount: payrollJob.employerAccount,
      creditAccount: employee.accountNumber,
      amount: employee.amount,
      currency: employee.currency,
      description: `Payroll: ${payrollJob.title} - ${employee.employeeId}`,
      category: 'payroll'
    }, session);

    // Update transaction with ledger entry IDs
    transaction.ledgerEntries = [
      {
        entryId: ledgerResult.debitEntry.entryId,
        type: 'DEBIT',
        accountNumber: payrollJob.employerAccount,
        amount: employee.amount,
        currency: employee.currency
      },
      {
        entryId: ledgerResult.creditEntry.entryId,
        type: 'CREDIT',
        accountNumber: employee.accountNumber,
        amount: employee.amount,
        currency: employee.currency
      }
    ];

    transaction.markCompleted();
    await transaction.save({ session });

    await session.commitTransaction();

    return {
      status: 'completed',
      transactionId,
      amount: employee.amount.toString(),
      currency: employee.currency
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

// Initialize worker when module is loaded
let payrollWorker;
let initializationAttempts = 0;
const maxInitializationAttempts = 1; // Reduce to 1 to avoid spam

function initializePayrollWorkerWithRetry() {
  try {
    if (initializationAttempts >= maxInitializationAttempts) {
      logger.error('Max initialization attempts reached for payroll worker');
      return;
    }

    initializationAttempts++;
    
    // Check if Redis is available before initializing
    const { isRedisAvailable } = require('../../../shared/config/redis');
    if (!isRedisAvailable()) {
      logger.warn('Redis not available, payroll features will be disabled');
      return; // Don't retry at all if Redis is not available
    }

    payrollWorker = initializePayrollWorker();
    logger.info('Payroll worker initialized successfully');
    
  } catch (error) {
    logger.error('Failed to initialize payroll worker', { 
      error: error.message,
      attempt: initializationAttempts 
    });
    
    // Don't retry on error
    logger.error('Payroll worker initialization failed - payroll features will be disabled');
  }
}

// Start initialization after a delay
setTimeout(initializePayrollWorkerWithRetry, 2000);

module.exports = router;
