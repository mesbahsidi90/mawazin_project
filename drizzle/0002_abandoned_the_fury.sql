CREATE TABLE `kitchens` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kitchens_owner_unique` ON `kitchens` (`owner`);