/**
 * Create Test Accounts for Transfer Testing
 */

const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

// Helper function to make API calls
async function testAPI(method, endpoint, data = null, expectedStatus = 200) {
    try {
        const config = {
            method,
            url: `${BASE_URL}${endpoint}`,
            headers: {
                'Content-Type': 'application/json',
                'X-Request-ID': `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            }
        };

        if (data) config.data = data;

        const response = await axios(config);
        
        if (response.status === expectedStatus) {
            return { success: true, status: response.status, data: response.data };
        } else {
            return { success: false, status: response.status, error: `Expected ${expectedStatus}, got ${response.status}` };
        }
    } catch (error) {
        if (error.response) {
            return { 
                success: false, 
                status: error.response.status, 
                error: error.response.data?.error || error.message 
            };
        } else {
            return { success: false, error: error.message };
        }
    }
}

// Create test accounts
async function createTestAccounts() {
    console.log('🏗️  Creating Test Accounts');
    console.log('========================');
    
    const accounts = [
        {
            userId: 'user_123',
            accountType: 'individual',
            currency: 'USD',
            initialBalance: 10000.00,
            metadata: {
                firstName: 'John',
                lastName: 'Doe',
                email: 'john.doe@test.com'
            }
        },
        {
            userId: 'user_456',
            accountType: 'individual',
            currency: 'USD',
            initialBalance: 5000.00,
            metadata: {
                firstName: 'Jane',
                lastName: 'Smith',
                email: 'jane.smith@test.com'
            }
        },
        {
            userId: 'user_789',
            accountType: 'individual',
            currency: 'EUR',
            initialBalance: 8000.00,
            metadata: {
                firstName: 'Bob',
                lastName: 'Johnson',
                email: 'bob.johnson@test.com'
            }
        }
    ];
    
    const createdAccounts = [];
    
    for (const accountData of accounts) {
        console.log(`\n📝 Creating account for ${accountData.userId} (${accountData.currency})...`);
        
        const result = await testAPI('POST', '/api/accounts', accountData, 201);
        
        if (result.success) {
            console.log(`✅ Account created: ${result.data.account.accountNumber}`);
            console.log(`   Balance: ${result.data.account.balance} ${result.data.account.currency}`);
            createdAccounts.push({
                userId: accountData.userId,
                accountNumber: result.data.account.accountNumber,
                currency: result.data.account.currency,
                balance: result.data.account.balance
            });
        } else if (result.status === 409) {
            console.log(`⚠️  Account already exists for ${accountData.userId}`);
            // Try to get existing account
            const existingResult = await testAPI('GET', `/api/accounts/user/${accountData.userId}`);
            if (existingResult.success && existingResult.data.accounts.length > 0) {
                const account = existingResult.data.accounts[0];
                console.log(`   Found: ${account.accountNumber} - Balance: ${account.balance} ${account.currency}`);
                createdAccounts.push({
                    userId: accountData.userId,
                    accountNumber: account.accountNumber,
                    currency: account.currency,
                    balance: account.balance
                });
            }
        } else {
            console.log(`❌ Failed to create account: ${result.error}`);
        }
    }
    
    console.log('\n📋 Created/Found Accounts:');
    createdAccounts.forEach((account, index) => {
        console.log(`${index + 1}. ${account.accountNumber} (${account.userId}) - ${account.balance} ${account.currency}`);
    });
    
    return createdAccounts;
}

// Run account creation
if (require.main === module) {
    createTestAccounts()
        .then(accounts => {
            console.log('\n✅ Test account setup completed');
            
            // Update test config with real account numbers
            console.log('\n🔄 Update your test config with:');
            console.log(`sourceAccount: "${accounts[0]?.accountNumber || 'ACC001'}"`);
            console.log(`destinationAccount: "${accounts[1]?.accountNumber || 'ACC002'}"`);
            console.log(`userId: "${accounts[0]?.userId || 'user_123'}"`);
            
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Account creation failed:', error);
            process.exit(1);
        });
}

module.exports = { createTestAccounts, testAPI };
