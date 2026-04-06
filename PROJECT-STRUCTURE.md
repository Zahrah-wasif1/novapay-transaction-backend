# 🏗️ NovaPay Project Structure

## 📁 Complete Folder Structure

```
novapay-transaction-backend/
├── 📁 services/                    # Microservices architecture
│   ├── 📁 account-service/        # Account management service
│   │   ├── 📁 controller/          # Business logic
│   │   │   └── accountController.js
│   │   ├── 📁 models/              # Data models
│   │   │   └── Account.js
│   │   ├── 📁 routes/              # Route definitions
│   │   ├── 📁 middleware/          # Service-specific middleware
│   │   ├── 📁 validators/          # Input validation
│   │   │   └── accountValidator.js
│   │   ├── 📁 utils/               # Service utilities
│   │   └── index.js                # Service entry point
│   │
│   ├── 📁 transaction-service/     # Transaction processing
│   │   ├── 📁 controller/
│   │   │   └── transactionController.js
│   │   ├── 📁 models/
│   │   │   └── Transaction.js
│   │   ├── 📁 routes/
│   │   ├── 📁 middleware/
│   │   ├── 📁 validators/
│   │   ├── 📁 utils/
│   │   └── index.js
│   │
│   ├── 📁 ledger-service/          # Ledger management
│   │   ├── 📁 controller/
│   │   │   └── ledgerController.js
│   │   ├── 📁 models/
│   │   │   └── Ledger.js
│   │   ├── 📁 routes/
│   │   ├── 📁 middleware/
│   │   ├── 📁 validators/
│   │   ├── 📁 utils/
│   │   └── index.js
│   │
│   ├── 📁 payroll-service/         # Payroll & FX combined
│   │   ├── 📁 controller/
│   │   │   ├── payrollController.js
│   │   │   ├── fxController.js
│   │   │   └── employeeController.js
│   │   ├── 📁 models/
│   │   │   ├── PayrollJob.js
│   │   │   ├── Employee.js
│   │   │   └── FXQuote.js
│   │   ├── 📁 routes/
│   │   ├── 📁 middleware/
│   │   ├── 📁 validators/
│   │   │   ├── payrollValidator.js
│   │   │   ├── fxValidator.js
│   │   │   └── employeeValidator.js
│   │   ├── 📁 utils/
│   │   └── index.js
│   │
│   └── 📁 admin-service/           # Administrative functions
│       ├── 📁 controller/
│       │   └── adminController.js
│       ├── 📁 models/
│       ├── 📁 routes/
│       ├── 📁 middleware/
│       ├── 📁 validators/
│       ├── 📁 utils/
│       └── index.js
│
├── 📁 shared/                      # Shared resources
│   ├── 📁 utils/                   # Common utilities
│   │   ├── logger.js
│   │   ├── encryption.js
│   │   └── helpers.js
│   ├── 📁 config/                  # Configuration files
│   │   ├── database.js
│   │   ├── redis.js
│   │   └── metrics.js
│   └── 📁 middleware/              # Global middleware
│       ├── auth.js
│       ├── rateLimit.js
│       └── validation.js
│
├── 📁 infra/                       # Infrastructure as Code
│   ├── 📁 docker-compose/          # Docker configuration
│   │   └── docker-compose.yml
│   ├── 📁 nginx/                   # Nginx configuration
│   │   ├── nginx.conf
│   │   └── ssl/
│   ├── 📁 prometheus/              # Monitoring setup
│   │   └── prometheus.yml
│   └── 📁 grafana/                 # Dashboard configuration
│       └── provisioning/
│
├── 📁 .github/                    # GitHub workflows
│   └── 📁 workflows/
│       └── ci-cd.yml
│
├── 📁 scripts/                    # Utility scripts
│   ├── test-all-apis.js
│   ├── test-transfer-apis.js
│   ├── create-test-accounts.js
│   └── employee-payroll-workflow.js
│
├── 📁 postman-scripts/            # Postman automation
│   └── employee-workflow.js
│
├── index.js                       # Main application entry point
├── package.json                   # Dependencies and scripts
├── .env.example                   # Environment variables template
├── .gitignore                     # Git ignore rules
├── Dockerfile                     # Docker configuration
├── README.md                      # Project documentation
└── 📄 API Documentation
    ├── NovaPay.postman_collection.json
    ├── POSTMAN-COLLECTION-GUIDE.md
    └── EMPLOYEE-PAYROLL-WORKFLOW.md
```

## 🚀 Service Architecture

### **Account Service** (`/api/accounts`)
- **Responsibility:** Account creation, balance management, freezing/unfreezing
- **Controller:** `accountController.js`
- **Model:** `Account.js`
- **Endpoints:** 
  - `POST /` - Create account
  - `GET /user/:userId` - Get user accounts
  - `GET /:accountNumber` - Get account details
  - `GET /:accountNumber/balance` - Get balance
  - `POST /:accountNumber/freeze` - Freeze amount
  - `POST /:accountNumber/unfreeze` - Unfreeze amount

### **Transaction Service** (`/api/transactions`)
- **Responsibility:** Domestic transfers, transaction history, status tracking
- **Controller:** `transactionController.js`
- **Model:** `Transaction.js`
- **Endpoints:**
  - `POST /transfer` - Initiate transfer
  - `GET /:transactionId` - Get transaction status
  - `GET /history/:accountNumber` - Get transaction history
  - `POST /:transactionId/retry` - Retry failed transaction

### **Ledger Service** (`/api/ledger`)
- **Responsibility:** Double-entry bookkeeping, balance reconciliation
- **Controller:** `ledgerController.js`
- **Model:** `Ledger.js`
- **Endpoints:**
  - `GET /entries/:accountNumber` - Get ledger entries
  - `GET /balance/:accountNumber` - Get ledger balance

### **Payroll Service** (`/api/payroll`, `/api/fx`, `/api/employees`)
- **Responsibility:** Payroll processing, FX trading, employee management
- **Controllers:** `payrollController.js`, `fxController.js`, `employeeController.js`
- **Models:** `PayrollJob.js`, `Employee.js`, `FXQuote.js`
- **Endpoints:**
  - Payroll: `POST /jobs`, `GET /jobs/:jobId`, `POST /jobs/from-employees`
  - FX: `POST /quote`, `GET /rates`, `POST /transfers/international`
  - Employees: `POST /`, `GET /:employeeId`, `PATCH /:employeeId/salary`

### **Admin Service** (`/api/admin`)
- **Responsibility:** System monitoring, user management, administrative tasks
- **Controller:** `adminController.js`
- **Endpoints:**
  - `GET /system/status` - System health
  - `GET /users/:userId/activity` - User activity

## 🔧 Configuration

### **Environment Variables**
```bash
# Server
PORT=8080
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/novapay

# Redis
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your-secret-key
ENCRYPTION_KEY=your-encryption-key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### **Docker Setup**
```bash
# Build and run all services
docker-compose -f infra/docker-compose/docker-compose.yml up -d

# View logs
docker-compose logs -f novapay-api

# Scale services
docker-compose up -d --scale novapay-api=3
```

## 📊 Monitoring & Observability

### **Prometheus Metrics**
- Custom metrics for each service
- Request latency and error rates
- Database connection pools
- Redis performance metrics

### **Grafana Dashboards**
- System overview
- Service health
- Transaction volume
- Error tracking

### **Health Checks**
- `/health` - Overall system health
- Service-specific health endpoints
- Database connectivity checks
- Redis connectivity checks

## 🔄 CI/CD Pipeline

### **GitHub Actions Workflow**
1. **Test Phase**
   - Unit tests
   - Integration tests
   - API endpoint testing
   - Linting and code quality

2. **Security Phase**
   - Dependency vulnerability scanning
   - Snyk security analysis
   - Code security checks

3. **Deploy Phase**
   - Docker image building
   - Image pushing to registry
   - Production deployment
   - Health checks

4. **Performance Phase**
   - Load testing
   - Performance benchmarks
   - Result collection and reporting

## 🎯 Benefits of This Structure

1. **Microservices Architecture** - Each service is independent and scalable
2. **Clear Separation of Concerns** - Logical grouping of functionality
3. **Infrastructure as Code** - Complete setup with Docker and monitoring
4. **CI/CD Ready** - Automated testing, security scanning, and deployment
5. **Shared Resources** - Common utilities and configuration
6. **Monitoring Built-in** - Prometheus and Grafana integration
7. **Self-Contained** - No external setup required

## 🚀 Getting Started

1. **Clone the repository**
2. **Install dependencies**: `npm install`
3. **Set up environment**: Copy `.env.example` to `.env`
4. **Run locally**: `npm start`
5. **Run with Docker**: `docker-compose up -d`
6. **Run tests**: `npm test`
7. **Test APIs**: `node scripts/test-all-apis.js`

## 📝 Development Guidelines

- Each service should be self-contained
- Use shared utilities for common functionality
- Follow the established folder structure
- Add appropriate tests for new features
- Update documentation when making changes
- Use environment variables for configuration
