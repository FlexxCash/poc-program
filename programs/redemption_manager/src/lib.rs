use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

declare_id!("BhBNrpuriccL3n6T1QvottBmZ1oHMeuaZus4UXjodxz9");

#[program]
pub mod redemption_manager {
    use super::*;

    pub fn initiate_redeem(ctx: Context<InitiateRedeem>, amount: u64) -> Result<()> {
        // 檢查系統是否處於暫停狀態
        require!(!ctx.accounts.system_state.is_paused, RedemptionError::SystemPaused);

        // 驗證用戶身份和簽名（通過 Anchor 的 Signer 約束自動完成）

        // 檢查用戶的鎖定狀態是否已結束
        let current_time = Clock::get()?.unix_timestamp;
        let lock_end_time = ctx.accounts.lock_record.start_time + (ctx.accounts.lock_record.lock_period as i64 * 86400);
        require!(current_time >= lock_end_time, RedemptionError::LockPeriodNotEnded);

        // 驗證贖回時間是否在有效期內
        let redemption_end_time = lock_end_time + (14 * 86400); // 14 days after lock period ends
        require!(current_time <= redemption_end_time, RedemptionError::RedemptionPeriodEnded);

        // 檢查用戶是否有足夠的 xxUSD 餘額
        require!(ctx.accounts.user_token_account.amount >= amount, RedemptionError::InsufficientBalance);

        // 鎖定用戶的 xxUSD 以準備贖回
        let cpi_accounts = token::Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.redemption_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        // 記錄贖回請求信息
        let redemption_request = &mut ctx.accounts.redemption_request;
        redemption_request.user = ctx.accounts.user.key();
        redemption_request.amount = amount;
        redemption_request.request_time = current_time;
        redemption_request.is_processed = false;

        // 發出事件
        emit!(RedemptionInitiatedEvent {
            user: ctx.accounts.user.key(),
            amount,
            request_time: current_time,
        });

        Ok(())
    }

    pub fn initialize_system_state(ctx: Context<InitializeSystemState>) -> Result<()> {
        ctx.accounts.system_state.is_paused = false;
        Ok(())
    }

    pub fn pause_system(ctx: Context<PauseSystem>) -> Result<()> {
        ctx.accounts.system_state.is_paused = true;
        Ok(())
    }

    pub fn unpause_system(ctx: Context<PauseSystem>) -> Result<()> {
        ctx.accounts.system_state.is_paused = false;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitiateRedeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ RedemptionError::InvalidOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub redemption_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"lock_record", user.key().as_ref()],
        bump,
        constraint = lock_record.owner == user.key() @ RedemptionError::InvalidOwner,
    )]
    pub lock_record: Account<'info, LockRecord>,
    #[account(
        init,
        payer = user,
        space = 8 + 32 + 8 + 8 + 1,
        seeds = [b"redemption_request", user.key().as_ref()],
        bump
    )]
    pub redemption_request: Account<'info, RedemptionRequest>,
    pub system_state: Account<'info, SystemState>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeSystemState<'info> {
    #[account(init, payer = authority, space = 8 + 1)]
    pub system_state: Account<'info, SystemState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PauseSystem<'info> {
    #[account(mut)]
    pub system_state: Account<'info, SystemState>,
    pub authority: Signer<'info>,
}

#[account]
pub struct RedemptionRequest {
    pub user: Pubkey,
    pub amount: u64,
    pub request_time: i64,
    pub is_processed: bool,
}

#[account]
pub struct SystemState {
    pub is_paused: bool,
}

#[account]
pub struct LockRecord {
    pub owner: Pubkey,
    pub amount: u64,
    pub lock_period: u64,
    pub start_time: i64,
}

#[error_code]
pub enum RedemptionError {
    #[msg("System is paused")]
    SystemPaused,
    #[msg("Lock period has not ended")]
    LockPeriodNotEnded,
    #[msg("Redemption period has ended")]
    RedemptionPeriodEnded,
    #[msg("Insufficient balance")]
    InsufficientBalance,
    #[msg("Invalid owner")]
    InvalidOwner,
}

#[event]
pub struct RedemptionInitiatedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub request_time: i64,
}