const express = require('express');
const Employee = require('../models/Employee');
const Account = require('../../account-service/models/Account');
const logger = require('../../../shared/utils/logger');
const { validateEmployeeCreation, validateEmployeeUpdate } = require('../validators/employeeValidator');

const router = express.Router();

// Create new employee
router.post('/', async (req, res) => {
  const requestId = req.requestId;
  const employeeData = req.body;

  try {
    // Validate input
    const { error } = validateEmployeeCreation(employeeData);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    // Check if employee ID already exists
    const existingEmployee = await Employee.findByEmployeeId(employeeData.employeeId);
    if (existingEmployee) {
      return res.status(409).json({
        error: 'Employee ID already exists',
        requestId
      });
    }

    // Reject unresolved Postman placeholders early
    if (typeof employeeData.employerId === 'string' && employeeData.employerId.includes('{{')) {
      return res.status(400).json({
        error: 'employerId contains an unresolved placeholder; replace {{employerId}} with a real accountNumber or userId',
        requestId
      });
    }

    // Validate employer account exists and is active
    let employerAccount = await Account.findOne({
      accountNumber: employeeData.employerId,
      status: 'active'
    });

    if (!employerAccount) {
      employerAccount = await Account.findOne({
        userId: employeeData.employerId,
        status: 'active'
      });
    }

    if (!employerAccount) {
      return res.status(404).json({
        error: 'Employer account not found or inactive',
        requestId
      });
    }

    // Normalize employerId if userId was supplied
    employeeData.employerId = employerAccount.accountNumber;

    // Validate employee bank account exists and is active
    const employeeAccount = await Account.findOne({
      accountNumber: employeeData.compensation.bankAccount.accountNumber,
      status: 'active'
    });

    if (!employeeAccount) {
      return res.status(400).json({
        error: 'Employee bank account not found or inactive',
        requestId
      });
    }

    // Create employee
    const employee = new Employee(employeeData);
    await employee.save();

    logger.info('Employee created successfully', {
      requestId,
      employeeId: employee.employeeId,
      employerId: employee.employerId,
      name: employee.personalInfo.fullName
    });

    res.status(201).json({
      message: 'Employee created successfully',
      employee: employee.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to create employee', {
      requestId,
      error: error.message,
      employeeId: employeeData.employeeId
    });

    res.status(500).json({
      error: 'Failed to create employee',
      requestId
    });
  }
});

// Get employee by ID
router.get('/:employeeId', async (req, res) => {
  const requestId = req.requestId;
  const { employeeId } = req.params;
  const { employerId } = req.query;

  try {
    const employee = await Employee.findByEmployeeId(employeeId, employerId);
    
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found',
        requestId
      });
    }

    res.json({
      employee: employee.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to get employee', {
      requestId,
      error: error.message,
      employeeId
    });

    res.status(500).json({
      error: 'Failed to retrieve employee',
      requestId
    });
  }
});

// Get all employees for an employer
router.get('/', async (req, res) => {
  const requestId = req.requestId;
  const { 
    employerId, 
    status, 
    department, 
    page = 1, 
    limit = 20 
  } = req.query;

  try {
    if (!employerId) {
      return res.status(400).json({
        error: 'Employer ID is required',
        requestId
      });
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      department
    };

    const employees = await Employee.findByEmployerId(employerId, options);
    const total = await Employee.getEmployeeCount(employerId, status);

    const formattedEmployees = employees.map(emp => emp.toSafeJSON());

    res.json({
      employees: formattedEmployees,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      requestId
    });

  } catch (error) {
    logger.error('Failed to get employees', {
      requestId,
      error: error.message,
      employerId
    });

    res.status(500).json({
      error: 'Failed to retrieve employees',
      requestId
    });
  }
});

// Update employee
router.put('/:employeeId', async (req, res) => {
  const requestId = req.requestId;
  const { employeeId } = req.params;
  const updateData = req.body;
  const { employerId } = req.query;

  try {
    // Validate input
    const { error } = validateEmployeeUpdate(updateData);
    if (error) {
      return res.status(400).json({
        error: error.details[0].message,
        requestId
      });
    }

    const employee = await Employee.findByEmployeeId(employeeId, employerId);
    
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found',
        requestId
      });
    }

    // If updating bank account, validate it exists
    if (updateData.compensation?.bankAccount?.accountNumber) {
      const newAccount = await Account.findOne({
        accountNumber: updateData.compensation.bankAccount.accountNumber,
        status: 'active'
      });

      if (!newAccount) {
        return res.status(400).json({
          error: 'New bank account not found or inactive',
          requestId
        });
      }
    }

    // Update employee
    Object.assign(employee, updateData);
    employee.updatedAt = new Date();
    await employee.save();

    logger.info('Employee updated successfully', {
      requestId,
      employeeId: employee.employeeId,
      employerId: employee.employerId
    });

    res.json({
      message: 'Employee updated successfully',
      employee: employee.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to update employee', {
      requestId,
      error: error.message,
      employeeId
    });

    res.status(500).json({
      error: 'Failed to update employee',
      requestId
    });
  }
});

// Update employee salary
router.patch('/:employeeId/salary', async (req, res) => {
  const requestId = req.requestId;
  const { employeeId } = req.params;
  const { salary, currency } = req.body;
  const { employerId } = req.query;

  try {
    if (!salary) {
      return res.status(400).json({
        error: 'Salary is required',
        requestId
      });
    }

    const employee = await Employee.findByEmployeeId(employeeId, employerId);
    
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found',
        requestId
      });
    }

    employee.updateSalary(salary, currency);
    await employee.save();

    logger.info('Employee salary updated', {
      requestId,
      employeeId: employee.employeeId,
      newSalary: salary,
      currency: currency || employee.compensation.currency
    });

    res.json({
      message: 'Salary updated successfully',
      employee: employee.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to update salary', {
      requestId,
      error: error.message,
      employeeId
    });

    res.status(500).json({
      error: 'Failed to update salary',
      requestId
    });
  }
});

// Terminate employee
router.patch('/:employeeId/terminate', async (req, res) => {
  const requestId = req.requestId;
  const { employeeId } = req.params;
  const { endDate, reason } = req.body;
  const { employerId } = req.query;

  try {
    const employee = await Employee.findByEmployeeId(employeeId, employerId);
    
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found',
        requestId
      });
    }

    if (employee.employment.status === 'terminated') {
      return res.status(400).json({
        error: 'Employee is already terminated',
        requestId
      });
    }

    employee.terminate(endDate, reason || 'Terminated by employer');
    await employee.save();

    logger.info('Employee terminated', {
      requestId,
      employeeId: employee.employeeId,
      reason: reason || 'Terminated by employer'
    });

    res.json({
      message: 'Employee terminated successfully',
      employee: employee.toSafeJSON(),
      requestId
    });

  } catch (error) {
    logger.error('Failed to terminate employee', {
      requestId,
      error: error.message,
      employeeId
    });

    res.status(500).json({
      error: 'Failed to terminate employee',
      requestId
    });
  }
});

// Delete employee (soft delete - mark as inactive)
router.delete('/:employeeId', async (req, res) => {
  const requestId = req.requestId;
  const { employeeId } = req.params;
  const { employerId } = req.query;

  try {
    const employee = await Employee.findByEmployeeId(employeeId, employerId);
    
    if (!employee) {
      return res.status(404).json({
        error: 'Employee not found',
        requestId
      });
    }

    employee.employment.status = 'inactive';
    employee.updatedAt = new Date();
    await employee.save();

    logger.info('Employee marked as inactive', {
      requestId,
      employeeId: employee.employeeId
    });

    res.json({
      message: 'Employee marked as inactive successfully',
      requestId
    });

  } catch (error) {
    logger.error('Failed to delete employee', {
      requestId,
      error: error.message,
      employeeId
    });

    res.status(500).json({
      error: 'Failed to delete employee',
      requestId
    });
  }
});

// Get active employees for payroll
router.get('/payroll/active/:employerId', async (req, res) => {
  const requestId = req.requestId;
  const { employerId } = req.params;

  try {
    const employees = await Employee.getPayrollEmployees(employerId);

    res.json({
      employees,
      count: employees.length,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get payroll employees', {
      requestId,
      error: error.message,
      employerId
    });

    res.status(500).json({
      error: 'Failed to retrieve payroll employees',
      requestId
    });
  }
});

// Get employee statistics
router.get('/stats/:employerId', async (req, res) => {
  const requestId = req.requestId;
  const { employerId } = req.params;

  try {
    const [
      totalEmployees,
      activeEmployees,
      inactiveEmployees,
      terminatedEmployees
    ] = await Promise.all([
      Employee.getEmployeeCount(employerId),
      Employee.getEmployeeCount(employerId, 'active'),
      Employee.getEmployeeCount(employerId, 'inactive'),
      Employee.getEmployeeCount(employerId, 'terminated')
    ]);

    // Get department breakdown
    const departmentStats = await Employee.aggregate([
      { $match: { employerId: employerId } },
      { $group: { _id: '$employment.department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      stats: {
        total: totalEmployees,
        active: activeEmployees,
        inactive: inactiveEmployees,
        terminated: terminatedEmployees,
        byDepartment: departmentStats
      },
      employerId,
      requestId
    });

  } catch (error) {
    logger.error('Failed to get employee statistics', {
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

module.exports = router;
