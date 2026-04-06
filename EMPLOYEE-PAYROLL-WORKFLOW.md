# Employee Payroll Workflow Guide

This guide shows you how to use the employee database to create payroll and check transaction status automatically.

## 🎯 What This Does

1. **Gets employee IDs from database** - No need to manually enter employee data
2. **Creates payroll using employee IDs** - Automatically fetches employee details
3. **Checks transaction status** - Verifies if employee payments were successful

## 📋 Step-by-Step Workflow

### Step 1: Set Up Environment Variables

In Postman, make sure you have these variables set:
- `baseUrl` - Your API base URL (e.g., `http://localhost:8080`)
- `employerId` - Your employer account ID
- `sourceAccount` - Your employer account number

### Step 2: Get Employee IDs

**Request:** `Get Active Employees (Prepare Payroll)`

- **Method:** GET
- **URL:** `{{baseUrl}}/api/employees/payroll/active/{{employerId}}`

**What it does:**
- Fetches all active employees from database
- Automatically sets `{{employeeId}}` and `{{employeeAccount}}` variables
- Sets `{{employeeIds}}` as JSON array for bulk operations

**Console Output:**
```
✅ Employee IDs retrieved:
   1. emp001 - John Doe
   2. emp002 - Jane Smith
```

### Step 3: Create Payroll Using Employee IDs

**Request:** `Create Payroll Job from Employee Database`

- **Method:** POST
- **URL:** `{{baseUrl}}/api/payroll/jobs/from-employees`

**What it does:**
- Automatically fills `employeeIds` from Step 2
- Creates payroll job using database employee information
- Sets `{{payrollJobId}}` for status checking

**Console Output:**
```
🔄 Auto-filling 2 employee IDs in payroll request
Employee IDs to be used: ["emp001", "emp002"]
✅ Payroll job created: JOB_1234567890
   Employees: 2
   Total: 4700.00 USD
```

### Step 4: Check Payroll Status

**Request:** `Get Payroll Job Status`

- **Method:** GET
- **URL:** `{{baseUrl}}/api/payroll/jobs/{{payrollJobId}}`

**What it does:**
- Shows payroll processing progress
- Displays success/failure counts
- Indicates when payroll is completed

### Step 5: Check Employee Transaction Status

**Request:** `Check Employee Transaction Status`

- **Method:** GET
- **URL:** `{{baseUrl}}/api/transactions/history/{{employeeAccount}}`

**What it does:**
- Gets transaction history for the employee
- Filters transactions for the specific employee
- Shows transaction status (completed/pending/failed)

**Console Output:**
```
📊 Transactions for employee emp001:
Found 1 employee transactions:
   1. PAY_1234567890 - 2500.00 USD - completed
      ✅ Transaction completed successfully!
```

## 🔧 Alternative: Node.js Script

You can also use the provided Node.js script:

```bash
# Install dependencies
npm install axios

# Set environment variables
export BASE_URL=http://localhost:8080
export EMPLOYER_ID=employer_123
export SOURCE_ACCOUNT=ACC001

# Run the workflow
node scripts/employee-payroll-workflow.js
```

## 📝 Example Request Bodies

### Create Payroll from Employee Database
```json
{
    "employerId": "{{employerId}}",
    "employerAccount": "{{sourceAccount}}",
    "title": "Monthly Payroll from Database",
    "description": "Monthly salary disbursement using employee database",
    "employeeIds": ["{{employeeId}}"],
    "metadata": {
        "idempotencyKey": "payroll_db_{{randomInt}}_{{timestamp}}",
        "uploadedBy": "admin"
    }
}
```

## 🎯 Benefits

1. **No Manual Data Entry** - Employee details come from database
2. **Always Up-to-Date** - Uses current salary and account information
3. **Error Prevention** - Validates employees exist and are active
4. **Easy Tracking** - Automatic transaction status checking
5. **Bulk Processing** - Handle multiple employees at once

## 🚨 Important Notes

- Make sure employees are created in the database first
- Employees must have `active` status to be included
- Employee accounts must be active and valid
- The workflow automatically handles ID generation and variable setting

## 🔍 Troubleshooting

### No Employees Found
- Check if employees exist in database
- Verify employee status is 'active'
- Confirm correct `employerId` is set

### Payroll Creation Fails
- Ensure employer account has sufficient balance
- Check if employee accounts are active
- Verify all employee IDs are valid

### Transaction Not Found
- Wait a few minutes for payroll processing
- Check payroll job status first
- Verify correct employee account number

## 📞 Support

If you encounter issues:
1. Check the console logs in Postman
2. Verify all environment variables are set
3. Ensure the API server is running
4. Check employee data in the database
