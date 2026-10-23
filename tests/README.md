# Contract Tests

Run the backend integration contract checks with:

```bash
npm test -- tests/integration-contract.test.ts
```

`integration-contract.test.ts` probes the routes currently implemented from
`docs/archive/frontend-integration-requirements.md` (archived snapshot — treat it
as a test fixture list, not living documentation). It checks HTTP method/path registration,
protected-route authentication, role denial, and the standard response envelope.
Routes documented by the requirements file but not implemented by the backend are
intentionally excluded until their route, controller, validation, and service
layers exist. For current API truth, see `docs/swagger.yaml`.

## ESM Module Mocks

Use `mockModule()` from `tests/helpers/mockFactory.ts` for partial module mocks.
It spreads the real module exports before applying overrides, so newly added
exports remain available to the module under test.

Before:

```ts
await jest.unstable_mockModule('../src/modules/users/users.repo.js', () => ({
	createUser: jest.fn(),
	findUserByEmail: jest.fn(),
}));
```

After:

```ts
await mockModule('../src/modules/users/users.repo.js', {
	createUser: jest.fn(),
	findUserByEmail: jest.fn(),
});
```

Register mocks after `jest.resetModules()` and before the dynamic import of the
module under test.

For isolated service tests, use the complete factories in `tests/helpers/mocks.ts`
instead of loading a real provider module to discover its exports. In particular,
`createUsersRepoMock()` provides the users repository boundary, while
`createEmailServiceMock()` supplies email exports without initializing SMTP.
Arrange each repository response explicitly in the test that needs it.

`createUsersModelMock()` supplies both `UserModel` and `OrganizationModel` with
chainable lookup/list/update queries. Nested overrides merge with the defaults,
so overriding one operation preserves the other methods. Use
`createModelQuery(fixture)` to script direct `await` and `select/sort/skip/limit/lean`
paths; it reuses `fakeQuery()` from `tests/helpers/fakeModel.ts`. Query modifiers
record calls but do not perform database filtering or pagination. Use fixtures
from `tests/fixtures/factories.ts` for valid ObjectIds.

Socket contract helpers delegate to `createSocketIoMock()` so transitive imports
receive the same complete emitter surface, including payment and notification
emitters. Bulk telemetry tests assert the shipment and payload for each call.
