CREATE TABLE `call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int NOT NULL,
	`blandCallId` varchar(128) NOT NULL,
	`status` enum('pending','called','booked','no-answer') NOT NULL DEFAULT 'pending',
	`transcript` text,
	`recordingUrl` varchar(512),
	`outcome` varchar(255),
	`durationSeconds` int,
	`calendlyBookingUrl` varchar(512),
	`rawPayload` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255),
	`phone` varchar(32),
	`email` varchar(320),
	`facebookLeadId` varchar(64),
	`facebookFormId` varchar(64),
	`facebookPageId` varchar(64),
	`status` enum('pending','called','booked','no-answer') NOT NULL DEFAULT 'pending',
	`blandCallId` varchar(128),
	`calendlyBookingUrl` varchar(512),
	`calendlyEventId` varchar(128),
	`hadExistingBooking` int DEFAULT 0,
	`callScheduledAt` timestamp,
	`calledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `leads_facebookLeadId_unique` UNIQUE(`facebookLeadId`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(128) NOT NULL,
	`value` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `settings_key_unique` UNIQUE(`key`)
);
