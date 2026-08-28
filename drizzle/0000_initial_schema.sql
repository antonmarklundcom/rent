CREATE TABLE `activity_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`entity` varchar(60) NOT NULL,
	`entity_id` int,
	`action` varchar(80) NOT NULL,
	`user_id` int,
	`meta` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `availability_blocks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`start_at` datetime NOT NULL,
	`end_at` datetime NOT NULL,
	`reason` enum('owner_use','maintenance','external_ical') NOT NULL DEFAULT 'owner_use',
	`source_ref` varchar(255),
	`ical_source_id` int,
	`note` varchar(300),
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `availability_blocks_id` PRIMARY KEY(`id`),
	CONSTRAINT `availability_blocks_source_uq` UNIQUE(`ical_source_id`,`source_ref`)
);
--> statement-breakpoint
CREATE TABLE `booking_documents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`type` enum('cedula','passport','license','other') NOT NULL,
	`file_url` varchar(500) NOT NULL,
	`status` enum('pending','verified','rejected') NOT NULL DEFAULT 'pending',
	`reviewed_by` int,
	`reviewed_at` timestamp,
	`rejection_reason` varchar(300),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `booking_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `booking_extras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`extra_id` int NOT NULL,
	`name_snapshot` varchar(140) NOT NULL,
	`unit_price` decimal(14,2) NOT NULL,
	`qty` int NOT NULL DEFAULT 1,
	`line_total` decimal(14,2) NOT NULL,
	CONSTRAINT `booking_extras_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reference` varchar(24) NOT NULL,
	`listing_id` int NOT NULL,
	`guest_name` varchar(180) NOT NULL,
	`guest_phone` varchar(40),
	`guest_email` varchar(255),
	`start_at` datetime NOT NULL,
	`end_at` datetime NOT NULL,
	`status` enum('inquiry','confirmed','active','completed','cancelled') NOT NULL DEFAULT 'inquiry',
	`unit_price` decimal(14,2) NOT NULL DEFAULT '0',
	`units` int NOT NULL DEFAULT 1,
	`base_total` decimal(14,2) NOT NULL DEFAULT '0',
	`extras_total` decimal(14,2) NOT NULL DEFAULT '0',
	`discount_total` decimal(14,2) NOT NULL DEFAULT '0',
	`total` decimal(14,2) NOT NULL DEFAULT '0',
	`currency` varchar(3) NOT NULL DEFAULT 'PYG',
	`commission_pct` decimal(5,2),
	`commission_amount` decimal(14,2),
	`source` enum('web','whatsapp','manual') NOT NULL DEFAULT 'web',
	`promo_code_id` int,
	`cancellation_policy` enum('flexible','moderate','strict'),
	`notes` text,
	`guest_count` int,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `bookings_reference_uq` UNIQUE(`reference`)
);
--> statement-breakpoint
CREATE TABLE `car_details` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`vehicle_type` enum('auto','camioneta','suv','moto','otro') NOT NULL,
	`make` varchar(80),
	`model` varchar(80),
	`year` int,
	`transmission` varchar(40),
	`fuel` varchar(40),
	`seats` int,
	`plate` varchar(20),
	`daily_km_limit` int,
	`insurance_terms` text,
	CONSTRAINT `car_details_id` PRIMARY KEY(`id`),
	CONSTRAINT `car_details_listing_uq` UNIQUE(`listing_id`)
);
--> statement-breakpoint
CREATE TABLE `cleaning_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`booking_id` int,
	`status` enum('needed','in_progress','ready') NOT NULL DEFAULT 'needed',
	`assigned_user_id` int,
	`due_by` datetime,
	`magic_token` varchar(64) NOT NULL,
	`checklist` json,
	`notes` text,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cleaning_tasks_id` PRIMARY KEY(`id`),
	CONSTRAINT `cleaning_tasks_token_uq` UNIQUE(`magic_token`)
);
--> statement-breakpoint
CREATE TABLE `deposits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'PYG',
	`status` enum('held','returned','deducted') NOT NULL DEFAULT 'held',
	`deduction_amount` decimal(14,2),
	`deduction_reason` text,
	`inspection_id` int,
	`maintenance_ticket_id` int,
	`settled_by` int,
	`settled_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `deposits_id` PRIMARY KEY(`id`),
	CONSTRAINT `deposits_booking_uq` UNIQUE(`booking_id`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`category` enum('cleaning','supplies','repair','fuel','other') NOT NULL DEFAULT 'other',
	`amount` decimal(14,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'PYG',
	`incurred_on` date NOT NULL,
	`description` varchar(300),
	`maintenance_ticket_id` int,
	`cleaning_task_id` int,
	`statement_id` int,
	`created_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`),
	CONSTRAINT `expenses_ticket_uq` UNIQUE(`maintenance_ticket_id`)
);
--> statement-breakpoint
CREATE TABLE `extras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(140) NOT NULL,
	`description` varchar(300),
	`price` decimal(14,2) NOT NULL,
	`scope` enum('vertical','listing') NOT NULL DEFAULT 'vertical',
	`vertical` enum('stay','car'),
	`listing_id` int,
	`per_unit` boolean NOT NULL DEFAULT false,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `extras_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ical_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`url` varchar(700) NOT NULL,
	`label` varchar(120),
	`last_synced_at` timestamp,
	`last_status` varchar(255),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ical_sources_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `info_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`question` varchar(300) NOT NULL,
	`answer` text NOT NULL,
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `info_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `info_items_listing_question_uq` UNIQUE(`listing_id`,`question`)
);
--> statement-breakpoint
CREATE TABLE `inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`type` enum('pickup','return') NOT NULL,
	`odometer` int,
	`fuel_level` int,
	`notes` text,
	`damage_flag` boolean NOT NULL DEFAULT false,
	`confirmed_by_guest` boolean NOT NULL DEFAULT false,
	`performed_by` int,
	`performed_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspections_id` PRIMARY KEY(`id`),
	CONSTRAINT `inspections_booking_type_uq` UNIQUE(`booking_id`,`type`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(180) NOT NULL,
	`phone` varchar(40),
	`email` varchar(255),
	`message` text,
	`vertical` enum('stay','car'),
	`listing_id` int,
	`booking_id` int,
	`source_url` varchar(500),
	`forward_status` enum('pending','forwarded','failed') NOT NULL DEFAULT 'pending',
	`forwarded_at` timestamp,
	`forward_error` varchar(500),
	`crm_contact_id` varchar(80),
	`crm_deal_id` varchar(80),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listing_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`url` varchar(500) NOT NULL,
	`alt` varchar(300),
	`sort_order` int NOT NULL DEFAULT 0,
	`is_cover` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `listing_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `listings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(200) NOT NULL,
	`vertical` enum('stay','car') NOT NULL,
	`title` varchar(220) NOT NULL,
	`description` text,
	`price` decimal(14,2) NOT NULL,
	`price_unit` enum('per_night','per_day','per_month') NOT NULL DEFAULT 'per_night',
	`currency` varchar(3) NOT NULL DEFAULT 'PYG',
	`location_id` int,
	`lat` decimal(10,7),
	`lng` decimal(10,7),
	`status` enum('draft','published','paused') NOT NULL DEFAULT 'draft',
	`published_at` timestamp,
	`owner_id` int NOT NULL,
	`commission_pct` decimal(5,2),
	`cancellation_policy` enum('flexible','moderate','strict') NOT NULL DEFAULT 'moderate',
	`ical_export_token` varchar(64),
	`updated_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `listings_id` PRIMARY KEY(`id`),
	CONSTRAINT `listings_slug_uq` UNIQUE(`slug`),
	CONSTRAINT `listings_ical_token_uq` UNIQUE(`ical_export_token`)
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(140) NOT NULL,
	`slug` varchar(160) NOT NULL,
	`parent_id` int,
	`department` varchar(140),
	`lat` decimal(10,7),
	`lng` decimal(10,7),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `locations_id` PRIMARY KEY(`id`),
	CONSTRAINT `locations_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `maintenance_tickets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`reported_by` int,
	`title` varchar(200) NOT NULL,
	`description` text,
	`status` enum('open','in_progress','done') NOT NULL DEFAULT 'open',
	`assigned_user_id` int,
	`cost` decimal(14,2),
	`inspection_id` int,
	`resolved_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `maintenance_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `message_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(80) NOT NULL,
	`locale` varchar(5) NOT NULL DEFAULT 'es',
	`label` varchar(160) NOT NULL,
	`body` text NOT NULL,
	`trigger_event` varchar(60),
	`offset_minutes` int NOT NULL DEFAULT 0,
	`vertical` enum('stay','car'),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `message_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `message_templates_key_locale_uq` UNIQUE(`key`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int,
	`listing_id` int,
	`direction` enum('inbound','outbound') NOT NULL,
	`channel` enum('whatsapp','web') NOT NULL DEFAULT 'whatsapp',
	`contact_name` varchar(180),
	`contact_phone` varchar(40),
	`body` text NOT NULL,
	`ai_drafted` boolean NOT NULL DEFAULT false,
	`logged_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onboarding_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`onboarding_id` int NOT NULL,
	`step_key` varchar(60) NOT NULL,
	`label` varchar(160) NOT NULL,
	`status` enum('pending','done','skipped') NOT NULL DEFAULT 'pending',
	`sort_order` int NOT NULL DEFAULT 0,
	`completed_by` int,
	`completed_at` timestamp,
	CONSTRAINT `onboarding_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `onboarding_steps_uq` UNIQUE(`onboarding_id`,`step_key`)
);
--> statement-breakpoint
CREATE TABLE `owner_onboarding` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_id` int NOT NULL,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	`notes` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `owner_onboarding_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_onboarding_owner_uq` UNIQUE(`owner_id`)
);
--> statement-breakpoint
CREATE TABLE `owner_statements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`owner_id` int NOT NULL,
	`period` varchar(7) NOT NULL,
	`gross_total` decimal(14,2) NOT NULL DEFAULT '0',
	`commission_total` decimal(14,2) NOT NULL DEFAULT '0',
	`expenses_total` decimal(14,2) NOT NULL DEFAULT '0',
	`net_total` decimal(14,2) NOT NULL DEFAULT '0',
	`currency` varchar(3) NOT NULL DEFAULT 'PYG',
	`booking_count` int NOT NULL DEFAULT 0,
	`html_ref` varchar(500),
	`pdf_ref` varchar(500),
	`generated_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `owner_statements_id` PRIMARY KEY(`id`),
	CONSTRAINT `owner_statements_period_uq` UNIQUE(`owner_id`,`period`)
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`display_name` varchar(180) NOT NULL,
	`ruc` varchar(40),
	`default_commission_pct` decimal(5,2) NOT NULL DEFAULT '20.00',
	`payout_notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `owners_id` PRIMARY KEY(`id`),
	CONSTRAINT `owners_user_uq` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `payment_links` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`provider` varchar(80) NOT NULL,
	`url` varchar(700),
	`reference` varchar(160),
	`amount` decimal(14,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'PYG',
	`status` enum('pending','paid','expired') NOT NULL DEFAULT 'pending',
	`expires_at` datetime,
	`marked_paid_by` int,
	`marked_paid_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_links_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `promo_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(40) NOT NULL,
	`discount_type` enum('percent','fixed') NOT NULL,
	`discount_value` decimal(14,2) NOT NULL,
	`valid_from` datetime,
	`valid_until` datetime,
	`max_uses` int,
	`used_count` int NOT NULL DEFAULT 0,
	`vertical` enum('stay','car'),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `promo_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `promo_codes_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`template_id` int,
	`template_key` varchar(80) NOT NULL,
	`send_after` datetime NOT NULL,
	`status` enum('scheduled','due','sent','cancelled') NOT NULL DEFAULT 'scheduled',
	`rendered_body` text,
	`channel` enum('whatsapp','web') NOT NULL DEFAULT 'whatsapp',
	`sent_by` int,
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `scheduled_messages_booking_template_uq` UNIQUE(`booking_id`,`template_key`)
);
--> statement-breakpoint
CREATE TABLE `stay_details` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`property_type` enum('casa','departamento','habitacion','otro') NOT NULL,
	`bedrooms` int,
	`bathrooms` int,
	`max_guests` int,
	`area_m2` int,
	`amenities` json,
	`check_in_time` varchar(5) NOT NULL DEFAULT '14:00',
	`check_out_time` varchar(5) NOT NULL DEFAULT '11:00',
	CONSTRAINT `stay_details_id` PRIMARY KEY(`id`),
	CONSTRAINT `stay_details_listing_uq` UNIQUE(`listing_id`)
);
--> statement-breakpoint
CREATE TABLE `supplies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(140) NOT NULL,
	`unit` varchar(40) NOT NULL DEFAULT 'unidad',
	`consumed_per_cleaning` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `supplies_id` PRIMARY KEY(`id`),
	CONSTRAINT `supplies_name_uq` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `supply_levels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`supply_id` int NOT NULL,
	`listing_id` int NOT NULL,
	`qty` int NOT NULL DEFAULT 0,
	`low_threshold` int NOT NULL DEFAULT 0,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `supply_levels_id` PRIMARY KEY(`id`),
	CONSTRAINT `supply_levels_uq` UNIQUE(`supply_id`,`listing_id`)
);
--> statement-breakpoint
CREATE TABLE `task_photos` (
	`id` int AUTO_INCREMENT NOT NULL,
	`subject_type` enum('cleaning_task','maintenance_ticket','inspection') NOT NULL,
	`subject_id` int NOT NULL,
	`url` varchar(500) NOT NULL,
	`caption` varchar(300),
	`uploaded_by` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `task_photos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(180) NOT NULL,
	`email` varchar(255) NOT NULL,
	`phone` varchar(40),
	`password_hash` varchar(255),
	`role` enum('super_admin','admin','owner','cleaner') NOT NULL DEFAULT 'owner',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`listing_id` int NOT NULL,
	`type` enum('service','insurance','registration') NOT NULL,
	`label` varchar(160),
	`due_date` date,
	`due_km` int,
	`status` enum('upcoming','due','done') NOT NULL DEFAULT 'upcoming',
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vehicle_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `activity_log_entity_idx` ON `activity_log` (`entity`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `availability_blocks_listing_range_idx` ON `availability_blocks` (`listing_id`,`start_at`,`end_at`);--> statement-breakpoint
CREATE INDEX `booking_documents_booking_idx` ON `booking_documents` (`booking_id`,`status`);--> statement-breakpoint
CREATE INDEX `booking_extras_booking_idx` ON `booking_extras` (`booking_id`);--> statement-breakpoint
CREATE INDEX `bookings_listing_range_idx` ON `bookings` (`listing_id`,`start_at`,`end_at`);--> statement-breakpoint
CREATE INDEX `bookings_status_idx` ON `bookings` (`status`);--> statement-breakpoint
CREATE INDEX `cleaning_tasks_listing_idx` ON `cleaning_tasks` (`listing_id`);--> statement-breakpoint
CREATE INDEX `cleaning_tasks_assignee_due_idx` ON `cleaning_tasks` (`assigned_user_id`,`due_by`);--> statement-breakpoint
CREATE INDEX `cleaning_tasks_status_idx` ON `cleaning_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `expenses_listing_date_idx` ON `expenses` (`listing_id`,`incurred_on`);--> statement-breakpoint
CREATE INDEX `extras_scope_idx` ON `extras` (`scope`,`vertical`,`listing_id`);--> statement-breakpoint
CREATE INDEX `ical_sources_listing_idx` ON `ical_sources` (`listing_id`);--> statement-breakpoint
CREATE INDEX `info_items_listing_idx` ON `info_items` (`listing_id`);--> statement-breakpoint
CREATE INDEX `leads_forward_idx` ON `leads` (`forward_status`,`created_at`);--> statement-breakpoint
CREATE INDEX `listing_images_listing_idx` ON `listing_images` (`listing_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `listings_owner_idx` ON `listings` (`owner_id`);--> statement-breakpoint
CREATE INDEX `listings_vertical_status_idx` ON `listings` (`vertical`,`status`);--> statement-breakpoint
CREATE INDEX `listings_location_idx` ON `listings` (`location_id`);--> statement-breakpoint
CREATE INDEX `locations_parent_idx` ON `locations` (`parent_id`);--> statement-breakpoint
CREATE INDEX `maintenance_tickets_listing_idx` ON `maintenance_tickets` (`listing_id`);--> statement-breakpoint
CREATE INDEX `maintenance_tickets_status_idx` ON `maintenance_tickets` (`status`);--> statement-breakpoint
CREATE INDEX `messages_booking_idx` ON `messages` (`booking_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_listing_idx` ON `messages` (`listing_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_links_booking_idx` ON `payment_links` (`booking_id`,`status`);--> statement-breakpoint
CREATE INDEX `scheduled_messages_due_idx` ON `scheduled_messages` (`status`,`send_after`);--> statement-breakpoint
CREATE INDEX `task_photos_subject_idx` ON `task_photos` (`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `vehicle_reminders_listing_idx` ON `vehicle_reminders` (`listing_id`,`status`);