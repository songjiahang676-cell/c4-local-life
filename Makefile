SHELL := /bin/bash

.PHONY: bootstrap dev build test lint typecheck infra-up infra-down db-generate db-validate

bootstrap:
	cp .env.example .env 2>/dev/null || true
	corepack enable
	pnpm install
	pnpm infra:up
	pnpm db:generate

dev:
	pnpm dev

build:
	pnpm build

test:
	pnpm test

lint:
	pnpm lint

typecheck:
	pnpm typecheck

infra-up:
	pnpm infra:up

infra-down:
	pnpm infra:down

db-generate:
	pnpm db:generate

db-validate:
	pnpm db:validate
