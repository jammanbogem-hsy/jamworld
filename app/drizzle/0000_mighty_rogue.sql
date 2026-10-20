CREATE TABLE `asset_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL,
	`rev` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`draft` text NOT NULL,
	`upload_key` text,
	`submitted_snapshot` text,
	`approved_snapshot` text,
	`approved_version` integer,
	`approved_by` text,
	`approved_at` integer,
	`reject_reason` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `requests_class_status_idx` ON `asset_requests` (`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `requests_student_idx` ON `asset_requests` (`student_id`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`name` text NOT NULL,
	`invite_hash` text NOT NULL,
	`invite_active` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `classes_teacher_idx` ON `classes` (`teacher_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `classes_invite_idx` ON `classes` (`invite_hash`);--> statement-breakpoint
CREATE TABLE `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`approved_version` integer NOT NULL,
	`attempt` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`outputs` text,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generations_idem_idx` ON `generations` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `generations_attempt_idx` ON `generations` (`request_id`,`attempt`);--> statement-breakpoint
CREATE TABLE `library_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`owner_student_id` text NOT NULL,
	`request_id` text NOT NULL,
	`generation_id` text NOT NULL,
	`manifest` text NOT NULL,
	`shared` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `library_assets_request_id_unique` ON `library_assets` (`request_id`);--> statement-breakpoint
CREATE INDEX `library_class_idx` ON `library_assets` (`class_id`);--> statement-breakpoint
CREATE INDEX `library_owner_idx` ON `library_assets` (`owner_student_id`);--> statement-breakpoint
CREATE TABLE `request_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_request_idx` ON `request_events` (`request_id`);--> statement-breakpoint
CREATE TABLE `student_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_student_idx` ON `student_sessions` (`student_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`nickname` text NOT NULL,
	`pin_hash` text NOT NULL,
	`pin_salt` text NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_class_nick_idx` ON `students` (`class_id`,`nickname`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`siwc_user_id` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_siwc_user_id_unique` ON `teachers` (`siwc_user_id`);