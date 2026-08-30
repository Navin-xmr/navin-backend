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
