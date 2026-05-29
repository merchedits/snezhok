ALTER TABLE `users` ADD `avatar_url` text;--> statement-breakpoint
CREATE INDEX `messages_created_at_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE INDEX `reactions_message_id_idx` ON `reactions` (`message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_message_user_emoji_idx` ON `reactions` (`message_id`,`user_id`,`emoji`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);