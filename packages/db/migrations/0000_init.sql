CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`actor` varchar(64) NOT NULL,
	`action` varchar(64) NOT NULL,
	`details` json,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`mode` enum('paper','live') NOT NULL,
	`status` enum('open','closed') NOT NULL,
	`token_mint` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_decimals` tinyint unsigned NOT NULL,
	`tracked_wallet_id` bigint unsigned,
	`opened_from_signal_id` bigint unsigned,
	`token_amount_raw` decimal(40,0) NOT NULL,
	`cost_lamports` decimal(40,0) NOT NULL,
	`proceeds_lamports` decimal(40,0) NOT NULL,
	`fees_lamports` decimal(40,0) NOT NULL,
	`realized_pnl_lamports` decimal(40,0),
	`close_reason` enum('follow_sell','take_profit','stop_loss','max_hold','manual'),
	`opened_at` datetime(3) NOT NULL,
	`closed_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`name` varchar(64) NOT NULL,
	`value` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `settings_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `signals` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`swap_event_id` bigint unsigned NOT NULL,
	`tracked_wallet_id` bigint unsigned NOT NULL,
	`mode` enum('paper','live') NOT NULL,
	`decision` enum('accepted','rejected') NOT NULL,
	`reasons` json NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `signals_id` PRIMARY KEY(`id`),
	CONSTRAINT `signals_swap_event_uq` UNIQUE(`swap_event_id`)
);
--> statement-breakpoint
CREATE TABLE `swap_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`signature` varchar(88) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`slot` bigint unsigned NOT NULL,
	`block_time` datetime(3) NOT NULL,
	`wallet` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`token_mint` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_amount_raw` decimal(40,0) NOT NULL,
	`token_decimals` tinyint unsigned NOT NULL,
	`quote_mint` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`quote_amount_raw` decimal(40,0) NOT NULL,
	`quote_decimals` tinyint unsigned NOT NULL,
	`source` varchar(32) NOT NULL,
	`raw` json,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `swap_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `swap_events_signature_wallet_uq` UNIQUE(`signature`,`wallet`)
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`mint` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`symbol` varchar(64),
	`name` varchar(255),
	`decimals` tinyint unsigned NOT NULL,
	`price_usd` decimal(50,30),
	`liquidity_usd` decimal(30,6),
	`mint_authority_active` boolean,
	`freeze_authority_active` boolean,
	`token_created_at` datetime(3),
	`is_blacklisted` boolean NOT NULL DEFAULT false,
	`market_data_fetched_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `tokens_mint` PRIMARY KEY(`mint`)
);
--> statement-breakpoint
CREATE TABLE `tracked_wallets` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`address` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`label` varchar(100),
	`source` enum('manual','discovered') NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`cooldown_until` datetime(3),
	`notes` text,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `tracked_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tracked_wallets_address_uq` UNIQUE(`address`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`position_id` bigint unsigned NOT NULL,
	`signal_id` bigint unsigned,
	`mode` enum('paper','live') NOT NULL,
	`side` enum('buy','sell') NOT NULL,
	`status` enum('simulated','pending','confirmed','failed') NOT NULL,
	`token_mint` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`token_amount_raw` decimal(40,0) NOT NULL,
	`token_decimals` tinyint unsigned NOT NULL,
	`sol_amount_lamports` decimal(40,0) NOT NULL,
	`price_sol` decimal(50,30),
	`network_fee_lamports` decimal(40,0) NOT NULL,
	`priority_fee_lamports` decimal(40,0) NOT NULL,
	`dex_fee_lamports` decimal(40,0) NOT NULL,
	`slippage_bps` int,
	`tx_signature` varchar(88) CHARACTER SET ascii COLLATE ascii_bin,
	`quote` json,
	`error` text,
	`executed_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updated_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`),
	CONSTRAINT `trades_tx_signature_uq` UNIQUE(`tx_signature`)
);
--> statement-breakpoint
CREATE TABLE `wallet_scores` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`wallet_address` varchar(44) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`score_date` date NOT NULL,
	`window_days` smallint unsigned NOT NULL,
	`realized_pnl_lamports` decimal(40,0) NOT NULL,
	`trade_count` int unsigned NOT NULL,
	`win_rate` decimal(7,6),
	`median_roi` decimal(30,10),
	`profit_concentration` decimal(7,6),
	`avg_hold_seconds` int unsigned,
	`median_hold_seconds` int unsigned,
	`copyability_pnl_lamports` decimal(40,0),
	`flags` json NOT NULL,
	`score` decimal(30,10),
	`created_at` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `wallet_scores_id` PRIMARY KEY(`id`),
	CONSTRAINT `wallet_scores_wallet_date_window_uq` UNIQUE(`wallet_address`,`score_date`,`window_days`)
);
--> statement-breakpoint
ALTER TABLE `positions` ADD CONSTRAINT `positions_tracked_wallet_id_tracked_wallets_id_fk` FOREIGN KEY (`tracked_wallet_id`) REFERENCES `tracked_wallets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `positions` ADD CONSTRAINT `positions_opened_from_signal_id_signals_id_fk` FOREIGN KEY (`opened_from_signal_id`) REFERENCES `signals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `signals` ADD CONSTRAINT `signals_swap_event_id_swap_events_id_fk` FOREIGN KEY (`swap_event_id`) REFERENCES `swap_events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `signals` ADD CONSTRAINT `signals_tracked_wallet_id_tracked_wallets_id_fk` FOREIGN KEY (`tracked_wallet_id`) REFERENCES `tracked_wallets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trades` ADD CONSTRAINT `trades_position_id_positions_id_fk` FOREIGN KEY (`position_id`) REFERENCES `positions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `trades` ADD CONSTRAINT `trades_signal_id_signals_id_fk` FOREIGN KEY (`signal_id`) REFERENCES `signals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `positions_mode_status_idx` ON `positions` (`mode`,`status`);--> statement-breakpoint
CREATE INDEX `positions_token_mint_idx` ON `positions` (`token_mint`);--> statement-breakpoint
CREATE INDEX `signals_created_at_idx` ON `signals` (`created_at`);--> statement-breakpoint
CREATE INDEX `swap_events_wallet_block_time_idx` ON `swap_events` (`wallet`,`block_time`);--> statement-breakpoint
CREATE INDEX `swap_events_token_mint_idx` ON `swap_events` (`token_mint`);--> statement-breakpoint
CREATE INDEX `trades_position_idx` ON `trades` (`position_id`);--> statement-breakpoint
CREATE INDEX `trades_mode_executed_at_idx` ON `trades` (`mode`,`executed_at`);--> statement-breakpoint
CREATE INDEX `wallet_scores_score_date_idx` ON `wallet_scores` (`score_date`);