CREATE TABLE `auth_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `manager_accounts` (
	`actor` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`salt` text NOT NULL,
	`version` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manager_accounts_email_unique` ON `manager_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `manager_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`version` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`actor`) REFERENCES `manager_accounts`(`actor`) ON UPDATE no action ON DELETE no action
);
