CREATE TABLE `platform_admins` (
	`slot` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kitchen_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`kitchen_id` text NOT NULL,
	`name` text NOT NULL,
	`pair_hash` text NOT NULL,
	`pair_expires` integer NOT NULL,
	`token_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`last_seen` text,
	`last_sync` text,
	FOREIGN KEY (`kitchen_id`) REFERENCES `kitchens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_devices_pair_hash_unique` ON `kitchen_devices` (`pair_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `kitchen_devices_token_hash_unique` ON `kitchen_devices` (`token_hash`);--> statement-breakpoint
CREATE TABLE `manager_invites` (
	`hash` text PRIMARY KEY NOT NULL,
	`kitchen_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_by` text,
	FOREIGN KEY (`kitchen_id`) REFERENCES `kitchens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `kitchen_memberships` (
	`actor` text PRIMARY KEY NOT NULL,
	`kitchen_id` text NOT NULL,
	FOREIGN KEY (`kitchen_id`) REFERENCES `kitchens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `waste_records` ADD `device_id` text;