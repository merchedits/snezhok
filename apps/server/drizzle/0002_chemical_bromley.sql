CREATE TABLE `conversation_members` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `conversation_members_user_id_idx` ON `conversation_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `conversation_members_conv_id_idx` ON `conversation_members` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'dm' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `conversations` (`id`, `type`, `created_at`) VALUES ('global', 'global', 0);
--> statement-breakpoint
ALTER TABLE `messages` ADD `conversation_id` text DEFAULT 'global' NOT NULL REFERENCES conversations(id);--> statement-breakpoint
CREATE INDEX `messages_conversation_id_idx` ON `messages` (`conversation_id`);