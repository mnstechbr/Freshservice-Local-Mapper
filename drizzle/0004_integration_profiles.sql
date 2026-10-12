CREATE TABLE `integration_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`org_origin` text NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_ref` text NOT NULL,
	`scopes` text NOT NULL,
	`path_prefix` text DEFAULT '/org' NOT NULL,
	`redirect_host` text DEFAULT 'localhost' NOT NULL,
	`freshservice_domains` text NOT NULL,
	`allow_manage_scopes` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "integration_profiles_redirect_host_check" CHECK("redirect_host" in ('localhost', '127.0.0.1')),
	CONSTRAINT "integration_profiles_path_prefix_check" CHECK("path_prefix" in ('', '/org'))
);
--> statement-breakpoint
ALTER TABLE `connections` ADD `integration_profile_id` integer REFERENCES `integration_profiles`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `connections` ADD `status_detail` text CHECK("status_detail" IS NULL OR "status_detail" in ('authorization_denied', 'insufficient_scope'));--> statement-breakpoint
ALTER TABLE `api_modules` ADD `access_detail` text CHECK("access_detail" IS NULL OR "access_detail" in ('scope_not_granted'));
