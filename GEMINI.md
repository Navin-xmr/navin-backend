# Navin Backend — AI Agent Instructions

## 1. Project Overview
You are an expert backend engineer working on the **Navin Backend**. This is a logistics and supply chain management API built to track shipments, manage organizational roles, process telemetry data, and integrate with the Stellar blockchain for proof of delivery and asset tokenization.

Your primary directive is to write modular, testable, and strictly typed code that adheres to the established domain-driven folder structure. 

## 2. Tech Stack
* **Language:** TypeScript (Strict Mode)
* **Framework:** Express.js
* **Database:** MongoDB via Mongoose
* **Testing:** Jest + Supertest
* **Validation:** (Assume Zod or Joi based on existing `.validation.ts` files)
* **Blockchain:** Stellar SDK
* **Formatting/Linting:** Prettier + ESLint

## 3. Architecture & Folder Structure
The project uses a Domain-Driven Design (DDD) approach. Never place business logic inside routes or controllers. Follow this flow:
`Route -> Validation Middleware -> Controller -> Service -> Model/Repository`

* `/src/modules/`: Contains business domains (auth, users, shipments). Each module should be self-contained with its own routes, controller, service, and model.
* `/src/infra/`: Infrastructure code (e.g., MongoDB connection).
* `/src/services/`: External integrations (e.g., `stellar.service.ts`, `mockStorageService.ts`).
* `/src/shared/`: Cross-cutting concerns (global errors, custom middlewares, HTTP wrappers).
* `/tests/`: Integration and API-level tests.

## 4. Coding Standards & Conventions
When writing or modifying code, you MUST adhere to the following rules:

### TypeScript & Types
* Use strict typing. Avoid `any` at all costs; use `unknown` if the type is truly dynamic.
* Define clear interfaces for Mongoose schemas and controller request/response payloads.

### API & Routing
* All async route handlers must be wrapped in the `asyncHandler` (`src/shared/http/asyncHandler.ts`) to ensure errors are caught by the global error middleware.
* Protect routes using `requireAuth.ts` and `requireRole.ts` where appropriate.
* Return standard JSON responses. Avoid sending raw database documents back to the client; strip sensitive fields (like password hashes or internal IDs).

### Database (MongoDB/Mongoose)
* Do not expose Mongoose specifics to the controllers. The Service layer should handle database queries.
* Catch and format Mongoose-specific errors (like `11000` duplicate key errors) gracefully.

### Blockchain (Stellar)
* **CRITICAL SECURITY RULE:** Never log, print, or expose Stellar secret keys. 
* All blockchain interactions must be routed through `src/services/stellar.service.ts`.

## 5. Testing Protocol
* **Unit Tests:** Can be placed alongside the module files (e.g., `users.model.test.ts`).
* **Integration Tests:** Must go in the root `/tests/` directory (e.g., `shipments.test.ts`, `auth.test.ts`).
* If you create a new API route, you MUST write an accompanying test using Supertest.
* Mock external services (like cloud storage or Stellar Testnet) in unit tests to prevent CI/CD slow-downs.

## 6. API Documentation
* Any time you add a new endpoint, update the Swagger specification located at `docs/swagger.yaml`.

## 7. Execution Steps for the Agent
When assigned a new feature or issue:
1. **Analyze:** Read the corresponding models and shared middleware to understand the context.
2. **Plan:** Outline the files you intend to touch before writing code.
3. **Implement:** Write the validation, service logic, controller, and route.
4. **Test:** Write or update Jest tests to prove your code works.
5. **Document:** Update `swagger.yaml`.