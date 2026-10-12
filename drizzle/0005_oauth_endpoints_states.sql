-- Migração aditiva (sem recriar integration_profiles: o DROP TABLE zeraria connections.integration_profile_id,
-- que tem ON DELETE set null). M1: prefixo do endpoint de token. Linhas existentes mantêm o comportamento
-- anterior (token = path_prefix); perfis novos usam o padrão '' (URL documentada).
-- L3: state OAuth consumido, somente o hash SHA-256.
CREATE TABLE `oauth_consumed_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`consumed_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_consumed_states_expires_idx` ON `oauth_consumed_states` (`expires_at`);
--> statement-breakpoint
ALTER TABLE `integration_profiles` ADD `token_path_prefix` text DEFAULT '' NOT NULL CONSTRAINT "integration_profiles_token_path_prefix_check" CHECK("token_path_prefix" in ('', '/org'));
--> statement-breakpoint
UPDATE `integration_profiles` SET `token_path_prefix` = `path_prefix`;
