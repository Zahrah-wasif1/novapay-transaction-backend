const express = require('express');
const payrollController = require('./controller/payrollController');
const fxController = require('./controller/fxController');
const employeeController = require('./controller/employeeController');

const router = express.Router();

// Mount payroll controller routes
router.use('/payroll', payrollController);
router.use('/fx', fxController);
router.use('/employees', employeeController);

module.exports = router;
