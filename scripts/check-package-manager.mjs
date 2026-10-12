#!/usr/bin/env node
/**
 * Hook `preinstall`: o projeto usa pnpm. Bloqueia `npm install` e `yarn` (salvo FSLM_ALLOW_NPM_INSTALL=1).
 * Regra de decisão em scripts/lib/bootstrap-core.mjs (checkPackageManagerInvocation).
 */
import { checkPackageManagerInvocation, PREFIX } from './lib/bootstrap-core.mjs';

const result = checkPackageManagerInvocation(process.env);
if (!result.allowed) {
  console.error(`${PREFIX} ${result.message}`);
  process.exit(1);
}
