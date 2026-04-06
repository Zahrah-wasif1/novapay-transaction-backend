const express = require('express');
const ledgerController = require('./controller/ledgerController');

const router = express.Router();

// Mount ledger controller routes
router.use('/', ledgerController);

module.exports = router;
