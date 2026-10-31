ALTER TABLE `positions` MODIFY COLUMN `close_reason` enum('follow_sell','take_profit','stop_loss','max_hold','unsellable','manual');--> statement-breakpoint
ALTER TABLE `positions` ADD `initial_token_amount_raw` decimal(40,0) NOT NULL;--> statement-breakpoint
ALTER TABLE `signals` ADD `risk_inputs` json;--> statement-breakpoint
ALTER TABLE `signals` ADD `received_at` datetime(3);--> statement-breakpoint
ALTER TABLE `trades` ADD `reason` enum('copy_buy','follow_sell','take_profit','stop_loss','max_hold','unsellable') NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` ADD `realized_pnl_lamports` decimal(40,0);--> statement-breakpoint
ALTER TABLE `trades` ADD `sol_usd_price` decimal(30,12);--> statement-breakpoint
ALTER TABLE `trades` ADD `quoted_at` datetime(3);