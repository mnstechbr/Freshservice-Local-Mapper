CREATE TABLE `resource_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`resource_id` integer NOT NULL,
	`version_id` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `sync_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `resource_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resource_observations_resource_idx` ON `resource_observations` (`resource_id`);--> statement-breakpoint
CREATE INDEX `resource_observations_version_idx` ON `resource_observations` (`version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_observations_run_resource_uq` ON `resource_observations` (`run_id`,`resource_id`);