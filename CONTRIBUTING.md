# Contributing to Navin Backend

We're happy you want to contribute to the Navin backend!
Please read this to better understand how to contribute.
We only aim for effective and efficient contributions so our codebase stays healthy.

## Table of Contents

- [About the Project](#about-the-project)
- [Getting Started](#getting-started)
- [Making Contributions](#making-contributions)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Resolving Conflicts](#resolving-conflicts)
- [Build & Test Requirements](#build--test-requirements)
- [Getting Help](#getting-help)

---

## About the Project

**Navin** is a blockchain-powered logistics platform that improves supply chain visibility for enterprises through tokenized shipments, immutable milestone tracking, and automated settlements. 
By creating a zero-trust interface between logistics providers and their clients, Navin aims to ensure both parties access identical real-time data — removing information asymmetry and enabling seamless, dispute-free operations.

The backend service powers the off-chain layer of the platform, handling API logic, data aggregation, and integration with Soroban smart contracts.

- **Blockchain**: Stellar (Soroban smart contracts)
- **Language**: Rust
- **Related Repos**:
  - Smart Contracts: [navin-contracts](https://github.com/Navin-xmr/navin-contracts)

---

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Cargo (included with Rust)

### Fork & Clone

1. **Fork** this repository by clicking the "Fork" button on GitHub.

2. **Clone** your fork locally:

   ```bash
   git clone https://github.com/YOUR-USERNAME/navin-backend.git
   cd navin-backend
   ```

3. **(Optional)** Add the upstream remote so you can sync future updates:

   ```bash
   git remote add upstream https://github.com/Navin-xmr/navin-backend.git
   ```

### Verify Your Environment

```bash
rustc --version
cargo --version
```

---

## Making Contributions

### Step 1: Create a Branch

Never commit directly to your forked branch's `main`. 
This will make it hard to sync your fork and your fork won't match the original `navin-backend` repo as we merge more PRs.
Always work on a dedicated branch:
Do this: 

```bash
git checkout main # sync your fork on the github website then pull
git pull origin main        # or: git pull upstream main

git checkout -b issue#
```

### Step 2: Make Your Changes

- Follow the best practices of our repository and leverage the existing code patterns
- Keep changes focused — one concern per commit/branch
- Add or update tests for any new or modified logic
- Make sure all tests relating to your issue are passing before you make PR
- Update documentation if your change affects public APIs or setup steps (if not applicable you can ignore this)

---

## Commit Guidelines

Write clear, meaningful commit messages so maintainers and other contributors can understand the change history.

### Format

```
type: short description 

```

### Commit Types we prefer to use

| Type | When to use |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change with no functional difference |
| `chore` | Build config, dependencies, maintenance |

### Examples

```bash
git commit -m "feat: add delivery status endpoint"
git commit -m "fix: resolve JWT expiry handling on refresh"
git commit -m "test: add unit tests for order aggregation logic"
git commit -m "docs: update environment variable setup guide"
```

---

## Pull Request Process

### Step 1: Push Your Branch

```bash
git push origin issue#
```

### Step 2: Open a Pull Request

1. Go to your fork on GitHub and click **"Compare & pull request"**
2. Fill out the PR description:
   - **Title**: Clear, concise summary of the change
   - **Description**: What was changed and why
   - **Testing**: How you tested the change, how many tests passed, how many failed, how many tests were added or updated   
   - **Checklist**: Complete all items (see below)


### Review Process

1. **Automated checks** run on every push (CI must pass)
2. **Maintainer review** typically within 1–2 days
3. **Address feedback** — push additional commits to the same branch
4. Once approved and CI passes, a maintainer will merge your PR

---

## Resolving Conflicts 

Merge conflicts happen when your branch and `main` have diverged. Here's how to resolve them correctly:

```bash
# Update your local main
git checkout main
git pull upstream main      # or: git pull origin main

# Rebase your feature branch on top of updated main
git checkout issue#
git rebase main
```

> [!IMPORTANT]
> **Do not blindly combine both sides of a conflict.** Read each conflict carefully, understand what each side is doing, pick the correct resolution (or merge both intentionally), ensure numbering is correct if needed in codebase,then verify the build and tests still pass before pushing.


### Push the resolved branch to fix conflicts from other PRs being merged
```
git push origin issue# 
```
OR 

if your issue origin and upstream branch don't match, 
this can be an option if you know how it works

```
git push origin issue# --force-with-lease
```

PRs with unresolved or carelessly merged conflicts **will not be merged**.
We want high quality code so our contributors can work on their issues not fix other's mistakes. 


## Getting Help

If you're stuck, have questions, or want to discuss ideas before starting:

- **Issues**: Open a [GitHub Issue](https://github.com/Navin-xmr/navin-backend/issues) for bugs or feature requests
- **Security**: Email [navinxmr@gmail.com](mailto:navinxmr@gmail.com) for security vulnerabilities — do **not** open a public issue
- **Community**: Join our Telegram group and message us directly there — [Navin Community Chat](https://t.me/+3svwFsQME6k1YjI0)

---

Thank you for contributing to Navin-backend!
Together, we're building a transparent and secure delivery tracking platform on Stellar.
