CREATE TABLE `meal_services` (
	`owner` text NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`meals` integer NOT NULL,
	`production_grams` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`owner`, `date`, `meal`)
);
