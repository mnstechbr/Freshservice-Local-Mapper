CREATE TABLE `api_modules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`module_key` text NOT NULL,
	`name` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`paginated` integer DEFAULT false NOT NULL,
	`access_status` text DEFAULT 'untested' NOT NULL,
	`http_status` integer,
	`last_attempt_at` integer,
	`error_message` text,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "api_modules_access_status_check" CHECK("access_status" in ('accessible', 'forbidden', 'not_found', 'unsupported', 'temporarily_unavailable', 'untested'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_modules_instance_module_uq` ON `api_modules` (`instance_id`,`module_key`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer,
	`run_id` integer,
	`level` text NOT NULL,
	`event_type` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "audit_events_level_check" CHECK("level" in ('debug', 'info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE INDEX `audit_events_instance_created_idx` ON `audit_events` (`instance_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_run_idx` ON `audit_events` (`run_id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `change_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`change_id` integer NOT NULL,
	`old_resource_id` integer NOT NULL,
	`new_resource_id` integer NOT NULL,
	`score` real NOT NULL,
	`score_breakdown` text NOT NULL,
	`status` text DEFAULT 'suggested' NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`change_id`) REFERENCES `detected_changes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`old_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`new_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "change_matches_status_check" CHECK("status" in ('suggested', 'confirmed', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `change_matches_change_idx` ON `change_matches` (`change_id`);--> statement-breakpoint
CREATE INDEX `change_matches_instance_idx` ON `change_matches` (`instance_id`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`auth_mode` text NOT NULL,
	`status` text NOT NULL,
	`account_label` text,
	`account_id` text,
	`scopes` text,
	`secret_ref` text,
	`token_expires_at` integer,
	`last_checked_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "connections_auth_mode_check" CHECK("auth_mode" in ('oauth', 'api_key_personal', 'api_key_integration')),
	CONSTRAINT "connections_status_check" CHECK("status" in ('disconnected', 'awaiting_authentication', 'awaiting_authorization', 'connected', 'session_expired', 'no_permission', 'connection_error'))
);
--> statement-breakpoint
CREATE INDEX `connections_instance_idx` ON `connections` (`instance_id`);--> statement-breakpoint
CREATE TABLE `detected_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`base_run_id` integer NOT NULL,
	`module_key` text NOT NULL,
	`change_type` text NOT NULL,
	`severity` text NOT NULL,
	`resource_id` integer,
	`previous_resource_id` integer,
	`previous_external_id` text,
	`current_external_id` text,
	`previous_name` text,
	`current_name` text,
	`field_diffs` text,
	`evidence` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`detected_at` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`previous_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "detected_changes_change_type_check" CHECK("change_type" in ('name_changed', 'possible_id_change', 'added', 'removed', 'not_observed', 'fields_changed')),
	CONSTRAINT "detected_changes_severity_check" CHECK("severity" in ('low', 'medium', 'high')),
	CONSTRAINT "detected_changes_review_status_check" CHECK("review_status" in ('pending', 'confirmed', 'rejected', 'not_applicable'))
);
--> statement-breakpoint
CREATE INDEX `detected_changes_run_idx` ON `detected_changes` (`run_id`);--> statement-breakpoint
CREATE INDEX `detected_changes_instance_module_idx` ON `detected_changes` (`instance_id`,`module_key`);--> statement-breakpoint
CREATE TABLE `instances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`base_url` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_base_url_unique` ON `instances` (`base_url`);--> statement-breakpoint
CREATE TABLE `resource_relations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`from_resource_id` integer NOT NULL,
	`to_resource_id` integer,
	`to_external_ref` text NOT NULL,
	`relation_type` text NOT NULL,
	`run_id` integer NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_relations_from_idx` ON `resource_relations` (`from_resource_id`);--> statement-breakpoint
CREATE INDEX `resource_relations_to_idx` ON `resource_relations` (`to_resource_id`);--> statement-breakpoint
CREATE INDEX `resource_relations_run_idx` ON `resource_relations` (`run_id`);--> statement-breakpoint
CREATE TABLE `resource_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`content_hash` text NOT NULL,
	`name` text,
	`category` text,
	`normalized_json` text NOT NULL,
	`raw_json` text,
	`source_endpoint` text,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_versions_resource_idx` ON `resource_versions` (`resource_id`);--> statement-breakpoint
CREATE INDEX `resource_versions_hash_idx` ON `resource_versions` (`content_hash`);--> statement-breakpoint
CREATE TABLE `resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`module_key` text NOT NULL,
	`external_id` text NOT NULL,
	`workspace_id` integer,
	`first_seen_run_id` integer NOT NULL,
	`last_seen_run_id` integer NOT NULL,
	`current_version_id` integer,
	`current_name` text,
	`current_category` text,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_seen_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`last_seen_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`current_version_id`) REFERENCES `resource_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resources_identity_no_ws_uq` ON `resources` (`instance_id`,`module_key`,`external_id`) WHERE "workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `resources_identity_ws_uq` ON `resources` (`instance_id`,`module_key`,`external_id`,`workspace_id`) WHERE "workspace_id" is not null;--> statement-breakpoint
CREATE INDEX `resources_instance_module_idx` ON `resources` (`instance_id`,`module_key`);--> statement-breakpoint
CREATE TABLE `sync_module_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`module_key` text NOT NULL,
	`status` text NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	`records_count` integer DEFAULT 0 NOT NULL,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`http_status` integer,
	`error_message` text,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_module_results_status_check" CHECK("status" in ('completed', 'failed', 'skipped', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_module_results_run_module_uq` ON `sync_module_results` (`run_id`,`module_key`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`identity_label` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`modules_requested` text NOT NULL,
	`modules_processed` integer DEFAULT 0 NOT NULL,
	`records_count` integer DEFAULT 0 NOT NULL,
	`failures_count` integer DEFAULT 0 NOT NULL,
	`changes_count` integer DEFAULT 0 NOT NULL,
	`compared_to_run_id` integer,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`compared_to_run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sync_runs_kind_check" CHECK("kind" in ('full', 'resync')),
	CONSTRAINT "sync_runs_status_check" CHECK("status" in ('running', 'completed', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `sync_runs_instance_started_idx` ON `sync_runs` (`instance_id`,`started_at`);