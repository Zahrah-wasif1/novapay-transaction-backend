const express = require('express');
const accountController = require('./controller/accountController');

const router = express.Router();

// Mount account controller routes
router.use('/', accountController);

module.exports = router;
