# 🚀 NovaPay Postman Collection Guide

## 📋 What's New in Updated Collection

### ✅ **Environment Variables Added**
- `baseUrl` - API base URL (default: http://localhost:8080)
- `employerId` - Employer account ID (default: employer_123)
- `sourceAccount` - Employer account number (default: ACC001)
- `destinationAccount` - Destination account (default: ACC002)
- `employeeId` - Auto-filled from database
- `employeeAccount` - Auto-filled from database
- `employeeIds` - Auto-filled JSON array of employee IDs
- And more...

### 🎯 **New Employee Payroll Workflow Folder**

Contains 4 automated steps for easy navigation:

1. **1. Get Active Employees (Prepare Payroll)**
2. **2. Create Payroll from Employee IDs**
3. **3. Check Payroll Status**
4. **4. Check Employee Transaction Status**

## 🔧 How to Use

### Step 1: Import Collection
1. Open Postman
2. Click Import
3. Select `NovaPay.postman_collection.json`
4. The collection will load with all folders

### Step 2: Set Environment Variables
1. Click on the collection name
2. Go to Variables tab
3. Update these variables as needed:
   - `baseUrl` - Your API server URL
   - `employerId` - Your employer ID
   - `sourceAccount` - Your employer account number

### Step 3: Run Employee Payroll Workflow

#### 1. Get Active Employees
- **Click:** "1. Get Active Employees (Prepare Payroll)"
- **What happens:** 
  - Fetches all active employees from database
  - Auto-sets `employeeId`, `employeeAccount`, `employeeIds` variables
- **Console output:**
  ```
  Employee IDs retrieved:
     1. emp001 - John Doe
     2. emp002 - Jane Smith
  Ready to process 2 employees
  ```

#### 2. Create Payroll from Employee IDs
- **Click:** "2. Create Payroll from Employee IDs"
- **What happens:**
  - Auto-fills employee IDs from Step 1
  - Creates payroll job using database information
- **Console output:**
  ```
  Auto-filling 2 employee IDs in payroll request
  Employee IDs to be used: ["emp001", "emp002"]
  Payroll job created: JOB_1234567890
     Employees: 2
     Total: 4700.00 USD
  ```

#### 3. Check Payroll Status
- **Click:** "3. Check Payroll Status"
- **What happens:**
  - Shows payroll processing progress
  - Displays success/failure counts
- **Console output:**
  ```
  Payroll Status: completed
     Progress: 100%
     Processed: 2
     Success: 2
     Failed: 0
  Payroll processing completed successfully!
  ```

#### 4. Check Employee Transaction Status
- **Click:** "4. Check Employee Transaction Status"
- **What happens:**
  - Gets transaction history for employee
  - Filters for specific employee transactions
  - Shows status with indicators
- **Console output:**
  ```
  Transactions for employee emp001:
  Found 1 employee transactions:
     1. PAY_1234567890 - 2500.00 USD - completed
        Transaction completed successfully!
  ```

## Collection Structure

```
NovaPay Transaction Backend
├── Account Service
│   ├── Create Account
│   ├── Get User Accounts
│   └── ...
├── Transaction Service
│   ├── Initiate Transfer
│   ├── Get Transaction Status
│   └── ...
├── FX Service
│   ├── Create FX Quote
│   ├── Execute International Transfer
│   └── ...
├── Employee Service (NEW)
│   ├── Create Employee
│   ├── Get Employee
│   ├── Update Employee
│   └── ...
├── Employee Payroll Workflow (NEW)
│   ├── 1. Get Active Employees (Prepare Payroll)
│   ├── 2. Create Payroll from Employee IDs
│   ├── 3. Check Payroll Status
│   └── 4. Check Employee Transaction Status
├── Payroll Service
│   ├── Create Payroll Job
│   ├── Create Payroll Job from Employee Database (NEW)
│   └── ...
└── System
    ├── Health Check
    └── Get Metrics
```

## Key Features

### Automation
- Employee IDs auto-filled from database
- Variables automatically set between steps
- No manual data entry required

### Visual Feedback
- Clear step numbering
- Console logging with status indicators
- Progress tracking

### Error Prevention
- Validates employee existence
- Checks account status
- Prevents duplicate processing

### Transaction Tracking
- Real-time payroll status
- Employee transaction verification
- Detailed progress reporting

## Troubleshooting

### No Employees Found
```
No active employees found
```
**Solution:** Create employees first using "Create Employee" in Employee Service folder

### Employee IDs Not Auto-filled
```
No employee IDs found. Please run Step 1 first.
```
**Solution:** Run "1. Get Active Employees" first

### Transaction Not Found
```
No transactions found for this employee
```
**Solution:** 
1. Check payroll status first
2. Wait for payroll processing to complete
3. Verify correct employee account

## Benefits

1. **Fast Processing** - Complete payroll in 4 clicks
2. **Error-Free** - No manual data entry mistakes
3. **Real-time Tracking** - See progress instantly
4. **Database Integration** - Always uses current employee data
5. **Transaction Verification** - Confirm payments were successful

## Quick Start

1. **Import** collection
2. **Set** your `baseUrl` and `employerId`
3. **Run** workflow steps in order
4. **Monitor** console output for progress

That's it! Your employee payroll is now fully automated!
