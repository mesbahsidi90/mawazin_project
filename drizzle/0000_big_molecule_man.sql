CREATE TABLE `waste_records` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`timestamp` text NOT NULL,
	`food` text NOT NULL,
	`stage` text NOT NULL,
	`reason` text NOT NULL,
	`meal` text NOT NULL,
	`grams` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`cost` integer NOT NULL,
	`source` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_waste_owner_time` ON `waste_records` (`owner`,`timestamp`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
