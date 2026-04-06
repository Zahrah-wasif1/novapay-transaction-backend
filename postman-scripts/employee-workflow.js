/**
 * Postman Pre-request Script for Employee Payroll Workflow
 * Add this script to your Postman collection to automatically get employee IDs
 */

// Function to get employee IDs from database
async function getEmployeeIdsFromDatabase() {
    const baseUrl = pm.collectionVariables.get('baseUrl');
    const employerId = pm.collectionVariables.get('employerId');
    
    try {
        const response = await pm.sendRequest({
            url: `${baseUrl}/api/employees/payroll/active/${employerId}`,
            method: 'GET',
            header: {
                'Content-Type': 'application/json',
                'X-Request-ID': pm.collectionVariables.get('requestId')
            }
        });
        
        if (response.code === 200) {
            const employees = response.json().employees;
            
            // Set employee IDs as collection variables
            if (employees.length > 0) {
                // Set first employee ID
                pm.collectionVariables.set('employeeId', employees[0].employeeId);
                
                // Set multiple employee IDs if needed
                const employeeIds = employees.map(emp => emp.employeeId);
                pm.collectionVariables.set('employeeIds', JSON.stringify(employeeIds));
                
                // Set employee account numbers
                pm.collectionVariables.set('employeeAccount', employees[0].accountNumber);
                
                console.log('✅ Employee IDs retrieved successfully:');
                employees.forEach((emp, index) => {
                    console.log(`   ${index + 1}. ${emp.employeeId} - ${emp.metadata.employeeName}`);
                });
                
                return employees;
            } else {
                console.log('❌ No active employees found');
                return [];
            }
        } else {
            console.log('❌ Failed to get employees:', response.json());
            return [];
        }
    } catch (error) {
        console.log('❌ Error getting employees:', error);
        return [];
    }
}

// Function to check if employee transaction is completed
async function checkEmployeeTransaction(employeeId, accountNumber) {
    const baseUrl = pm.collectionVariables.get('baseUrl');
    
    try {
        const response = await pm.sendRequest({
            url: `${baseUrl}/api/transactions/history/${accountNumber}?page=1&limit=10`,
            method: 'GET',
            header: {
                'Content-Type': 'application/json',
                'X-Request-ID': pm.collectionVariables.get('requestId')
            }
        });
        
        if (response.code === 200) {
            const transactions = response.json().transactions;
            
            // Look for payroll transactions for this employee
            const employeeTransactions = transactions.filter(tx => 
                tx.metadata?.employeeId === employeeId || 
                tx.description?.includes(employeeId)
            );
            
            console.log(`📊 Found ${employeeTransactions.length} transactions for employee ${employeeId}:`);
            employeeTransactions.forEach((tx, index) => {
                console.log(`   ${index + 1}. ${tx.transactionId} - ${tx.amount} ${tx.currency} - ${tx.status}`);
            });
            
            return employeeTransactions;
        } else {
            console.log('❌ Failed to get transactions:', response.json());
            return [];
        }
    } catch (error) {
        console.log('❌ Error getting transactions:', error);
        return [];
    }
}

// Main execution based on request name
const requestName = pm.info.requestName;

if (requestName.includes('Get Active Employees') || requestName.includes('Prepare Payroll')) {
    // Get employee IDs when preparing for payroll
    await getEmployeeIdsFromDatabase();
}

if (requestName.includes('Check Employee Transaction')) {
    // Check transactions for specific employee
    const employeeId = pm.collectionVariables.get('employeeId');
    const accountNumber = pm.collectionVariables.get('employeeAccount');
    
    if (employeeId && accountNumber) {
        await checkEmployeeTransaction(employeeId, accountNumber);
    } else {
        console.log('❌ Employee ID or account number not set');
    }
}

// Auto-fill employee IDs in payroll request
if (requestName.includes('Create Payroll Job from Employee Database')) {
    const employeeIds = pm.collectionVariables.get('employeeIds');
    
    if (employeeIds) {
        try {
            const ids = JSON.parse(employeeIds);
            console.log(`🔄 Auto-filling ${ids.length} employee IDs in payroll request`);
            
            // Update the request body with employee IDs
            const body = JSON.parse(pm.request.body.raw);
            body.employeeIds = ids;
            pm.request.body.raw = JSON.stringify(body, null, 2);
        } catch (error) {
            console.log('❌ Error parsing employee IDs:', error);
        }
    }
}
