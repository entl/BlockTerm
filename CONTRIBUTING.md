# Contributing to BlockTerm

Thank you for your interest in contributing to BlockTerm! This document provides guidelines and instructions for contributing.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Create a feature branch** for your work
4. **Make your changes** following the guidelines below
5. **Submit a pull request** with a clear description

## Development Setup

### Prerequisites
- Node.js 18+
- Go 1.21+
- Protocol Buffer compiler (`protoc`)
- Git

### Initial Setup

```bash
git clone https://github.com/yourusername/BlockTerm.git
cd BlockTerm

# Install frontend dependencies
cd frontend
npm install
cd ..

# Download Go modules
cd backend
go mod download
cd ..
```

### Running in Development Mode

**Terminal 1: Backend**
```bash
cd backend
go run cmd/server/main.go
```

**Terminal 2: Frontend**
```bash
cd frontend
npm run dev
```

## Code Guidelines

### General Principles
- Keep changes focused and atomic
- Write clear, descriptive commit messages
- Add tests for new functionality
- Ensure existing tests pass before submitting

### Go Backend (`backend/`)
- Follow standard Go conventions
- Use meaningful variable and function names
- Add comments for exported functions and types
- Run `gofmt` and `go vet` before committing
- Add unit tests in `*_test.go` files

**Example:**
```bash
cd backend
go fmt ./...
go vet ./...
go test ./...
```

### Frontend (`frontend/`)
- Use TypeScript for type safety
- Follow React best practices
- Use functional components and hooks
- Keep components small and focused
- Add PropTypes or TypeScript interfaces

### Protocol Buffers (`proto/`)
- Keep messages focused on data transfer
- Use descriptive field names
- Add comments explaining complex messages
- When updating protos, regenerate both backend and frontend code

**Regenerating proto files:**
```bash
protoc \
  --go_out=backend/gen \
  --go-grpc_out=backend/gen \
  --ts_out=frontend/src \
  proto/blockterm.proto
```

## Commit Messages

Use clear, descriptive commit messages:

- `feat: add command history search`
- `fix: resolve PTY resize issue with split panes`
- `docs: update installation instructions`
- `test: add unit tests for suggestion scoring`
- `refactor: simplify session manager interface`

Start with a type prefix: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

## Pull Request Process

1. **Update README.md** if adding user-facing features
2. **Add/update tests** for any code changes
3. **Ensure all tests pass**: `npm test` and `go test ./...`
4. **Keep commits clean** – squash WIP commits before submitting
5. **Write a clear PR description** explaining what and why
6. **Reference related issues** using `#issue-number`

### PR Checklist
- [ ] Tests pass locally
- [ ] No console errors or warnings
- [ ] Code follows project style guidelines
- [ ] Documentation is updated
- [ ] Commit messages are clear and descriptive

## Testing

### Backend Tests
```bash
cd backend
go test ./... -v
go test ./... -cover
```

### Frontend Tests
```bash
cd frontend
npm test
```

### Building for Release
```bash
cd frontend
npm run build
```

## Reporting Issues

When reporting bugs:
- **Describe clearly** what you expected vs. what happened
- **Include steps to reproduce** the issue
- **Share your environment** (OS, Go version, Node version)
- **Attach logs** if applicable

## Questions & Discussion

- 💬 [GitHub Discussions](https://github.com/yourusername/BlockTerm/discussions)
- 📧 Open an issue with `question` label

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

---

Thank you for helping make BlockTerm better! 🚀
