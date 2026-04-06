/**
 * Employee Payroll Workflow Script
 * This script demonstrates how to:
 * 1. Get employees from database
 * 2. Create payroll using employee IDs
 * 3. Check transaction status
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const EMPLOYER_ID = process.env.EMPLOYER_ID || 'employer_123';
const SOURCE_ACCOUNT = process.env.SOURCE_ACCOUNT || 'ACC001';

// Helper function to make API calls
async function apiCall(method, endpoint, data = null, params = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}/api${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      }
    };

    if (data) config.data = data;
    if (params) config.params = params;

    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`API Error [${method} ${endpoint}]:`, error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data || error.message 
    };
  }
}

// 1. Get active employees from database
async function getActiveEmployees(employerId) {
  console.log('\n📋 Getting active employees for employer:', employerId);
  
  const result = await apiCall('GET', `/employees/payroll/active/${employerId}`);
  
  if (result.success) {
    console.log(`✅ Found ${result.data.employees.length} active employees:`);
    result.data.employees.forEach((emp, index) => {
      console.log(`   ${index + 1}. ID: ${emp.employeeId}, Name: ${emp.metadata.employeeName}, Amount: ${emp.amount} ${emp.currency}`);
    });
    return result.data.employees;
  } else {
    console.error('❌ Failed to get employees:', result.error);
    return [];
  }
}

// 2. Create payroll using employee IDs
async function createPayrollFromEmployees(employerId, employerAccount, employees, title = 'Monthly Payroll') {
  console.log('\n💰 Creating payroll job for employees...');
  
  const employeeIds = employees.map(emp => emp.employeeId);
  console.log('Employee IDs:', employeeIds);
  
  const payrollData = {
    employerId,
    employerAccount,
    title,
    description: 'Monthly salary disbursement using employee database',
    employeeIds,
    metadata: {
      idempotencyKey: `payroll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      uploadedBy: 'workflow_script'
    }
  };
  
  const result = await apiCall('POST', '/payroll/jobs/from-employees', payrollData);
  
  if (result.success) {
    console.log('✅ Payroll job created successfully!');
    console.log(`   Job ID: ${result.data.job.jobId}`);
    console.log(`   Status: ${result.data.job.status}`);
    console.log(`   Employee Count: ${result.data.job.employeeCount}`);
    console.log(`   Total Amount: ${result.data.job.totalAmount} ${result.data.job.currency}`);
    return result.data.job.jobId;
  } else {
    console.error('❌ Failed to create payroll:', result.error);
    return null;
  }
}

// 3. Check payroll job status
async function checkPayrollStatus(jobId) {
  console.log('\n📊 Checking payroll job status...');
  
  const result = await apiCall('GET', `/payroll/jobs/${jobId}`);
  
  if (result.success) {
    const job = result.data.job;
    console.log(`✅ Job Status: ${job.status}`);
    console.log(`   Progress: ${job.progress.progressPercentage}%`);
    console.log(`   Processed: ${job.progress.processedCount}`);
    console.log(`   Success: ${job.progress.successCount}`);
    console.log(`   Failed: ${job.progress.failureCount}`);
    
    if (job.status === 'completed') {
      console.log('🎉 Payroll processing completed successfully!');
    } else if (job.status === 'failed') {
      console.log('❌ Payroll processing failed!');
    } else {
      console.log('⏳ Payroll processing in progress...');
    }
    
    return job;
  } else {
    console.error('❌ Failed to get job status:', result.error);
    return null;
  }
}

// 4. Get transaction details for an employee
async function getEmployeeTransactions(employeeId, accountNumber) {
  console.log(`\n🔍 Getting transactions for employee: ${employeeId}`);
  
  const result = await apiCall('GET', `/transactions/history/${accountNumber}`, null, { page: 1, limit: 10 });
  
  if (result.success) {
    console.log(`✅ Found ${result.data.transactions.length} transactions:`);
    result.data.transactions.forEach((tx, index) => {
      console.log(`   ${index + 1}. ID: ${tx.transactionId}, Amount: ${tx.amount} ${tx.currency}, Status: ${tx.status}`);
      if (tx.metadata?.employeeId === employeeId) {
        console.log(`      🎯 This is a payroll transaction for employee ${employeeId}`);
      }
    });
    return result.data.transactions;
  } else {
    console.error('❌ Failed to get transactions:', result.error);
    return [];
  }
}

// Main workflow function
async function runEmployeePayrollWorkflow() {
  console.log('🚀 Starting Employee Payroll Workflow');
  console.log('=====================================');
  
  try {
    // Step 1: Get active employees
    const employees = await getActiveEmployees(EMPLOYER_ID);
    
    if (employees.length === 0) {
      console.log('❌ No active employees found. Please create employees first.');
      return;
    }
    
    // Step 2: Create payroll job
    const jobId = await createPayrollFromEmployees(EMPLOYER_ID, SOURCE_ACCOUNT, employees);
    
    if (!jobId) {
      console.log('❌ Failed to create payroll job. Exiting workflow.');
      return;
    }
    
    // Step 3: Monitor payroll status
    console.log('\n⏱️  Monitoring payroll progress...');
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      
      const jobStatus = await checkPayrollStatus(jobId);
      
      if (!jobStatus) break;
      
      if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
        break;
      }
      
      attempts++;
    }
    
    // Step 4: Check transactions for each employee
    console.log('\n🔍 Checking employee transactions...');
    for (const employee of employees) {
      await getEmployeeTransactions(employee.employeeId, employee.accountNumber);
    }
    
    console.log('\n✅ Workflow completed successfully!');
    
  } catch (error) {
    console.error('❌ Workflow failed:', error.message);
  }
}

// Run the workflow if this script is executed directly
if (require.main === module) {
  runEmployeePayrollWorkflow();
}

// Export functions for use in other modules
module.exports = {
  getActiveEmployees,
  createPayrollFromEmployees,
  checkPayrollStatus,
  getEmployeeTransactions,
  runEmployeePayrollWorkflow
};
