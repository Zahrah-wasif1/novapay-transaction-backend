const express = require('express');
const transactionController = require('./controller/transactionController');

const router = express.Router();

// Mount transaction controller routes
router.use('/', transactionController);

module.exports = router;
