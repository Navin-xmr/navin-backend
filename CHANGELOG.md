# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed
- `DELETE /api/users/:id` — replaced raw `res.json()` with `sendResponse()` wrapper in `deleteUserController` for consistent API envelope (#212)

### Added
- `DELETE /api/users/:id` — added full Swagger spec entry for the soft-delete user endpoint (#212)
- Integration tests for `DELETE /api/users/:id` covering 200, 401, 403, 400, 404 and SUPER_ADMIN access (#212)
